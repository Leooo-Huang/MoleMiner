/**
 * Web server for MoleMiner visualization UI.
 * Node.js native http — no Express/Fastify.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SearchStore } from '../store.js';
import { Pipeline, type ProgressEvent } from '../pipeline.js';
import { SourceRegistry } from '../registry.js';
import { Config } from '../config.js';
import { LLMClient } from '../llm.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

interface ActiveSearch {
  query: string;
  listeners: Set<ServerResponse>;
  bufferedEvents: string[];
  completionEvent?: string;
  storeId?: number;
  done: boolean;
  error?: string;
  startedAt: number;
}

interface ActiveLogin {
  id: string;
  platform: string;
  listeners: Set<ServerResponse>;
  bufferedEvents: string[];
  done: boolean;
  cancel?: () => void;
}

export function createWebServer(opts: {
  store: SearchStore;
  registry: SourceRegistry;
  config: Config;
  llm: LLMClient;
}) {
  const { store, registry, config, llm } = opts;
  const activeSearches = new Map<string, ActiveSearch>();
  let searchCounter = 0;
  const activeLogins = new Map<string, ActiveLogin>();
  let loginCounter = 0;

  // Resolve static files directory.
  const webDistDir = normalize(
    existsSync(join(__dirname, 'web'))
      ? join(__dirname, 'web')
      : join(__dirname, '..', '..', 'dist', 'web'),
  );

  function sendJson(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
  }

  function sendError(res: ServerResponse, message: string, status: number) {
    sendJson(res, { error: message, status }, status);
  }

  function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Body too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(res: ServerResponse, urlPath: string): boolean {
    const safePath = urlPath.replace(/^\/+/, '');
    const filePath = normalize(resolve(webDistDir, safePath || 'index.html'));

    // Path traversal protection: resolved path must be inside webDistDir
    if (!filePath.startsWith(webDistDir)) {
      return false;
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(readFileSync(filePath));
      return true;
    }
    return false;
  }

  // --- API handlers ---

  function handleGetSearches(res: ServerResponse) {
    const searches = store.listSearches(50);
    const enriched = searches.map((s) => {
      const stats = store.getSearchStats(s.id as number);
      return {
        id: s.id,
        query: s.query,
        sourcesUsed: typeof s.sources_used === 'string' ? JSON.parse(s.sources_used) : s.sources_used,
        resultCount: s.result_count,
        searchedAt: s.searched_at,
        ...stats,
      };
    });

    // Include active (in-progress) searches
    const active = Array.from(activeSearches.entries())
      .filter(([, s]) => !s.done)
      .map(([id, s]) => ({
        id: -1,
        tempId: id,
        query: s.query,
        sourcesUsed: [],
        resultCount: 0,
        searchedAt: new Date(s.startedAt).toISOString(),
        directCount: 0,
        leadCount: 0,
        locationCount: 0,
        sourceBreakdown: {},
        status: 'searching' as const,
      }));

    sendJson(res, { searches: enriched, active });
  }

  function handleGetSearch(res: ServerResponse, searchId: number) {
    const search = store.getSearch(searchId);
    if (!search) {
      sendError(res, 'Search not found', 404);
      return;
    }

    const results = store.getResults(searchId);
    const stats = store.getSearchStats(searchId);

    sendJson(res, {
      search: {
        id: search.id,
        query: search.query,
        sourcesUsed: typeof search.sources_used === 'string' ? JSON.parse(search.sources_used) : search.sources_used,
        resultCount: search.result_count,
        searchedAt: search.searched_at,
      },
      results: results.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        source: r.source,
        snippet: r.snippet,
        resultType: r.result_type,
        language: r.language,
        timestamp: r.timestamp,
        summary: r.summary,
        location: r.location,
        metadata: r.metadata,
        importanceScore: r.importance_score ?? undefined,
      })),
      stats,
    });
  }

  async function handlePostSearch(req: IncomingMessage, res: ServerResponse) {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid request';
      sendError(res, msg, msg === 'Body too large' ? 413 : 400);
      return;
    }

    const query = body.query;
    if (!query || typeof query !== 'string') {
      sendError(res, 'query is required', 400);
      return;
    }

    const searchId = `search-${++searchCounter}`;
    const search: ActiveSearch = {
      query,
      listeners: new Set(),
      bufferedEvents: [],
      done: false,
      startedAt: Date.now(),
    };
    activeSearches.set(searchId, search);

    sendJson(res, { searchId, message: 'Search started' });

    // Run search asynchronously
    const pipeline = new Pipeline(registry, config, store, llm);
    const rawSources = body.sources as string[] | undefined;
    // Source priority: body.sources → config.defaultSources → undefined (all enabled), matches CLI
    const sources: string[] | undefined = (rawSources && rawSources.length > 0)
      ? rawSources
      : (config.defaultSources
          ? config.defaultSources.split(',').map(s => s.trim()).filter(Boolean)
          : undefined);
    const maxRounds = body.maxRounds as number | undefined;
    const deep = body.deep === true;

    const broadcast = (chunk: string) => {
      for (const listener of search.listeners) {
        listener.write(chunk);
      }
    };

    const onProgress = (event: ProgressEvent) => {
      const sseChunk = `event: progress\ndata: ${JSON.stringify(event)}\n\n`;
      search.bufferedEvents.push(sseChunk);
      broadcast(sseChunk);
    };

    pipeline.search(query, { sources, maxRounds, deep, onProgress })
      .then((response) => {
        console.log(`[web] Search completed: "${query}" — ${response.totalResults} results`);
        const sourcesUsed = response.sources.map(s => s.name);
        const storeId = store.saveSearch(query, sourcesUsed, response.results);
        store.saveSourceStatuses(storeId, response.sources);
        store.flush();
        search.storeId = storeId;

        const completeChunk = `event: complete\ndata: ${JSON.stringify({ searchId: storeId, totalResults: response.totalResults })}\n\n`;
        search.completionEvent = completeChunk;
        search.bufferedEvents.push(completeChunk);
        broadcast(completeChunk);

        for (const listener of search.listeners) {
          listener.end();
        }
        search.done = true;
        // Keep in activeSearches for 60s so late SSE connections can get the result
        setTimeout(() => activeSearches.delete(searchId), 60_000);
      })
      .catch((err) => {
        console.error(`[web] Search failed: "${query}" —`, err);
        const errMsg = err instanceof Error ? err.message : String(err);
        search.error = errMsg;

        const errorChunk = `event: error\ndata: ${JSON.stringify({ message: errMsg })}\n\n`;
        search.completionEvent = errorChunk;
        search.bufferedEvents.push(errorChunk);
        broadcast(errorChunk);

        for (const listener of search.listeners) {
          listener.end();
        }
        search.done = true;
        setTimeout(() => activeSearches.delete(searchId), 60_000);
      });
  }

  function handleSearchStream(res: ServerResponse, searchId: string) {
    const search = activeSearches.get(searchId);
    if (!search) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Search not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Replay all buffered events (handles late-connecting clients)
    for (const chunk of search.bufferedEvents) {
      res.write(chunk);
    }

    // If search already finished, close immediately after replay
    if (search.done) {
      res.end();
      return;
    }

    search.listeners.add(res);
    res.on('close', () => {
      search.listeners.delete(res);
    });
  }

  // --- Router ---

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      // API routes
      if (path === '/api/searches' && method === 'GET') {
        handleGetSearches(res);
        return;
      }

      const searchMatch = path.match(/^\/api\/searches\/(\d+)$/);
      if (searchMatch && method === 'GET') {
        handleGetSearch(res, parseInt(searchMatch[1], 10));
        return;
      }

      // DELETE /api/searches/:id
      if (method === 'DELETE' && searchMatch) {
        const searchId = parseInt(searchMatch[1], 10);
        const deleted = store.deleteSearch(searchId);
        if (deleted) {
          sendJson(res, { deleted: true, id: searchId });
        } else {
          sendError(res, 'Search not found', 404);
        }
        return;
      }

      // GET /api/sources — list all sources with status
      if (path === '/api/sources' && method === 'GET') {
        const { hasCookies } = await import('../utils/cookies.js');
        const names = registry.listSources().sort();
        const defaultSourcesList = config.defaultSources
          ? config.defaultSources.split(',').map(s => s.trim()).filter(Boolean)
          : [];
        const isAllSources = defaultSourcesList.length === 0;
        const lastStatuses = store.getLastSourceStatuses();
        const sources = names.map(name => {
          const source = registry.getSource(name);
          return {
            name,
            type: source.sourceType,
            requiresAuth: source.requiresAuth,
            enabled: source.enabled(config),
            hasCredentials: source.requiresAuth
              ? (source.sourceType === 'browser' ? hasCookies(name) : source.enabled(config))
              : true,
            isInDefaultSources: isAllSources || defaultSourcesList.includes(name),
            lastStatus: lastStatuses.get(name) ?? null,
          };
        });
        sendJson(res, { sources });
        return;
      }

      // PATCH /api/sources/:name — toggle source in defaultSources
      const sourcePatchMatch = path.match(/^\/api\/sources\/([a-z]+)$/);
      if (sourcePatchMatch && method === 'PATCH') {
        const sourceName = sourcePatchMatch[1];
        const allNames = registry.listSources();
        if (!allNames.includes(sourceName)) {
          sendError(res, `Unknown source: ${sourceName}`, 404);
          return;
        }

        let body: Record<string, unknown>;
        try {
          body = await parseBody(req);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Invalid request';
          sendError(res, msg, 400);
          return;
        }

        if (typeof body.enabled !== 'boolean') {
          sendError(res, '"enabled" (boolean) is required', 400);
          return;
        }

        const enabled = body.enabled as boolean;
        let currentList = config.defaultSources
          ? config.defaultSources.split(',').map(s => s.trim()).filter(Boolean)
          : [];

        // If defaultSources is empty (all sources mode) and disabling, build the full list first
        if (currentList.length === 0 && !enabled) {
          currentList = allNames.sort();
        }

        let newList: string[];
        if (enabled) {
          newList = currentList.includes(sourceName)
            ? currentList
            : [...currentList, sourceName].sort();
        } else {
          newList = currentList.filter(n => n !== sourceName);
        }

        // If newList contains all sources, clear defaultSources (= all sources mode)
        const allEnabled = allNames.every(n => newList.includes(n));
        const newValue = allEnabled ? undefined : newList.join(',');

        config.setValue('defaultSources', newValue);
        config.save();

        sendJson(res, { ok: true, defaultSources: allEnabled ? [] : newList });
        return;
      }

      // GET /api/config — expose safe config info for settings page
      if (path === '/api/config' && method === 'GET') {
        const profile = config.llmProfile && config.profiles[config.llmProfile]
          ? config.profiles[config.llmProfile]
          : null;
        sendJson(res, {
          llmProfile: config.llmProfile ?? null,
          llmProvider: profile?.provider ?? config.llmProvider ?? null,
          llmModel: profile?.model ?? config.llmModel ?? null,
          braveApiKey: config.braveApiKey ?? '',
          githubToken: config.githubToken ?? '',
          defaultMaxRounds: config.defaultMaxRounds ?? 3,
          sourceTimeoutApi: config.sourceTimeoutApi ?? 30,
          sourceTimeoutBrowser: config.sourceTimeoutBrowser ?? 60,
          version: '0.3.0',
        });
        return;
      }

      // PATCH /api/config — update a single config value
      if (path === '/api/config' && method === 'PATCH') {
        let body: Record<string, unknown>;
        try {
          body = await parseBody(req);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Invalid request';
          sendError(res, msg, 400);
          return;
        }

        const { key, value } = body;
        if (!key || typeof key !== 'string') {
          sendError(res, '"key" (string) is required', 400);
          return;
        }
        if (value === undefined || value === null) {
          sendError(res, '"value" (string | number) is required', 400);
          return;
        }

        try {
          config.setValue(key, value);
          config.save();
          sendJson(res, { ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, { error: msg }, 400);
        }
        return;
      }

      if (path === '/api/search' && method === 'POST') {
        await handlePostSearch(req, res);
        return;
      }

      if (path === '/api/search/stream' && method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) {
          sendError(res, 'id parameter required', 400);
          return;
        }
        handleSearchStream(res, id);
        return;
      }

      // POST /api/login/:platform — start QR login flow
      const loginStartMatch = path.match(/^\/api\/login\/([a-z]+)$/);
      if (loginStartMatch && method === 'POST') {
        const platform = loginStartMatch[1];
        const supported = ['zhihu', 'xiaohongshu', 'weibo'];
        if (!supported.includes(platform)) {
          sendError(res, `Login not supported for: ${platform}`, 400);
          return;
        }

        const loginId = `login-${++loginCounter}`;
        const login: ActiveLogin = {
          id: loginId,
          platform,
          listeners: new Set(),
          bufferedEvents: [],
          done: false,
        };
        activeLogins.set(loginId, login);

        const broadcast = (chunk: string) => {
          login.bufferedEvents.push(chunk);
          for (const l of login.listeners) l.write(chunk);
        };

        const cancelToken = { cancelled: false };
        let cancelled = false;
        login.cancel = () => { cancelled = true; cancelToken.cancelled = true; };

        // Run Playwright login in background
        (async () => {
          try {
            const { playwrightLogin } = await import('../utils/cookies.js');
            await playwrightLogin(platform, {
              timeout: 180_000,
              cancelToken,
              onQrReady: (dataUrl) => {
                if (cancelled) return;
                broadcast(`event: qr_ready\ndata: ${JSON.stringify({ loginId, platform, qrDataUrl: dataUrl })}\n\n`);
              },
            });
            if (!cancelled) {
              broadcast(`event: success\ndata: ${JSON.stringify({ loginId, platform })}\n\n`);
            }
          } catch (err) {
            if (!cancelled) {
              const msg = err instanceof Error ? err.message : String(err);
              broadcast(`event: error\ndata: ${JSON.stringify({ loginId, message: msg })}\n\n`);
            }
          } finally {
            login.done = true;
            for (const l of login.listeners) l.end();
            setTimeout(() => activeLogins.delete(loginId), 60_000);
          }
        })();

        sendJson(res, { loginId, platform });
        return;
      }

      // GET /api/login/stream?id={loginId} — SSE stream for login progress
      if (path === '/api/login/stream' && method === 'GET') {
        const loginId = url.searchParams.get('id');
        if (!loginId) { sendError(res, 'id parameter required', 400); return; }
        const login = activeLogins.get(loginId);
        if (!login) { sendError(res, 'Login session not found', 404); return; }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        for (const chunk of login.bufferedEvents) res.write(chunk);
        if (login.done) { res.end(); return; }
        login.listeners.add(res);
        res.on('close', () => login.listeners.delete(res));
        return;
      }

      // DELETE /api/login/:loginId — user skips/cancels
      const loginDeleteMatch = path.match(/^\/api\/login\/(login-\d+)$/);
      if (loginDeleteMatch && method === 'DELETE') {
        const loginId = loginDeleteMatch[1];
        const login = activeLogins.get(loginId);
        if (login) {
          login.cancel?.();
          login.done = true;
          const chunk = `event: cancelled\ndata: ${JSON.stringify({ loginId })}\n\n`;
          for (const l of login.listeners) { l.write(chunk); l.end(); }
          activeLogins.delete(loginId);
        }
        sendJson(res, { ok: true });
        return;
      }

      // Static files
      if (!path.startsWith('/api/')) {
        if (serveStatic(res, path)) return;
        if (serveStatic(res, '/index.html')) return;
      }

      sendError(res, 'Not found', 404);
    } catch (err) {
      sendError(res, String(err), 500);
    }
  });

  return server;
}
