/**
 * Recursive AI search pipeline — dispatch, classify, follow leads, repeat.
 *
 * This is the core orchestrator of MoleMiner.
 */

import { SourceRegistry } from './registry.js';
import { SearchStore } from './store.js';
import { LLMClient } from './llm.js';
import { Config } from './config.js';
import { aiClassify, aiExtractEntities, aiGenerateQueries, aiExtractLocations, setFastModel, type QueryPlan, type ExtractedEntity } from './ai.js';
import { aggregateResults } from './aggregate.js';
import { normalizeUrl } from './utils/dedupe.js';
import type { SearchResult, SourceStatus, SearchResponse } from './models.js';
import { createSearchResponse } from './models.js';
import type { BaseSource } from './sources/base.js';
import { fetchPages } from './utils/fetch-page.js';
import { extractContent } from './utils/extract.js';

export interface SearchOptions {
  sources?: string[];
  maxRounds?: number;
  /** Deep search mode — enables dimension expansion, cross-language queries, multi-round. */
  deep?: boolean;
  /** Skip page content extraction step (useful for tests or quick searches). */
  skipContentExtraction?: boolean;
  /** Progress callback — called at each pipeline step for real-time CLI output. */
  onProgress?: (event: ProgressEvent) => void;
}

/** Scope-driven parameters for balanced search distribution. */
interface ScopeConfig {
  /** Max results per individual query (ensures even distribution across dimension values). */
  resultsPerQuery: number;
  /** Total results cap per source. */
  perSourceCap: number;
  /** Max pages to fetch for content extraction. */
  maxContentPages: number;
  /** Concurrent page fetches. */
  fetchConcurrency: number;
}

function getScopeConfig(scope: 'local' | 'national' | 'global'): ScopeConfig {
  const configs: Record<string, ScopeConfig> = {
    local:    { resultsPerQuery: 10, perSourceCap: 30,  maxContentPages: 20, fetchConcurrency: 5  },
    national: { resultsPerQuery: 5,  perSourceCap: 80,  maxContentPages: 40, fetchConcurrency: 10 },
    global:   { resultsPerQuery: 3,  perSourceCap: 150, maxContentPages: 60, fetchConcurrency: 15 },
  };
  return configs[scope];
}

export type ProgressEvent =
  | { type: 'round_start'; round: number; maxRounds: number }
  | { type: 'generating_queries'; round: number }
  | { type: 'queries_generated'; round: number; activeCount: number; skippedCount: number; language: string }
  | { type: 'dispatching'; round: number; sourceCount: number }
  | { type: 'dispatch_done'; round: number; resultCount: number; statuses: SourceStatus[] }
  | { type: 'classifying'; round: number; resultCount: number; batchCount: number }
  | { type: 'classified'; round: number; directCount: number; leadCount: number }
  | { type: 'extracting_entities'; round: number; leadCount: number }
  | { type: 'entities_extracted'; round: number; entities: string[] }
  | { type: 'converged'; round: number; reason: string }
  | { type: 'extracting_content'; totalUrls: number }
  | { type: 'content_extracted'; successCount: number; failCount: number };

export class Pipeline {
  constructor(
    private registry: SourceRegistry,
    private config: Config,
    private store?: SearchStore,
    private llm?: LLMClient,
  ) {
    setFastModel(config.llmFastModel);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResponse> {
    const maxRounds = opts?.maxRounds ?? 3;
    const sourceInstances = this.getSources(opts?.sources);
    const sourceNames = sourceInstances.map(s => s.name);

    const seenUrls = new Set<string>();
    const seenEntities = new Set<string>(); // cross-round entity dedup
    const allDirects: SearchResult[] = [];
    const allLeads: SearchResult[] = [];
    const allStatuses: SourceStatus[] = [];
    let searchDimensions: import('./models.js').SearchDimension[] | undefined;
    let entities: ExtractedEntity[] = [];
    let rounds = 0;
    let lastScopeConfig: ScopeConfig = getScopeConfig('national');

    const emit = opts?.onProgress ?? (() => {});

    for (let roundNum = 0; roundNum < maxRounds; roundNum++) {
      rounds = roundNum + 1;
      emit({ type: 'round_start', round: rounds, maxRounds });

      // Step 1: Generate queries (AI decides which sources to search)
      emit({ type: 'generating_queries', round: rounds });
      let plan: QueryPlan;
      if (this.llm) {
        if (roundNum === 0) {
          plan = await aiGenerateQueries(
            { intent: query, sourceNames, deep: opts?.deep },
            this.llm,
          );
        } else {
          plan = await aiGenerateQueries(
            { intent: query, entities: entities, sourceNames: ['brave'], deep: opts?.deep },
            this.llm,
          );
        }
      } else {
        plan = {
          queries: Object.fromEntries(sourceNames.map(n => [n, [query]])),
          skipped: [],
          language: 'en',
        };
      }
      const activeCount = Object.keys(plan.queries).length;
      if (roundNum === 0 && plan.dimensions?.length) {
        searchDimensions = plan.dimensions;
      }
      // Scope-aware config — drives per-query caps, content extraction limits, concurrency
      const scopeConfig = getScopeConfig(plan.scope ?? 'national');
      lastScopeConfig = scopeConfig;
      emit({ type: 'queries_generated', round: rounds, activeCount, skippedCount: plan.skipped.length, language: plan.language });

      // Step 2: Filter sources and dispatch
      // Round 0: all non-skipped sources; Round 1+: only brave (search engine finds primary sources)
      const activeSources = roundNum === 0
        ? sourceInstances.filter(s => !plan.skipped.includes(s.name))
        : sourceInstances.filter(s => s.name === 'brave');
      emit({ type: 'dispatching', round: rounds, sourceCount: activeSources.length });
      const { results: raw, statuses } = await this.dispatch(plan.queries, activeSources, scopeConfig);
      allStatuses.push(...statuses);

      // Record skipped sources in status
      for (const name of plan.skipped) {
        allStatuses.push({ name, status: 'skipped', resultCount: 0, elapsedSeconds: 0 });
      }

      emit({ type: 'dispatch_done', round: rounds, resultCount: raw.length, statuses });

      // Step 3: Aggregate (dedup against previously seen URLs)
      const deduped = aggregateResults(raw, { existingUrls: seenUrls });
      for (const r of deduped) seenUrls.add(normalizeUrl(r.url));

      if (deduped.length === 0) {
        emit({ type: 'converged', round: rounds, reason: 'no new results' });
        break;
      }

      if (!this.llm) {
        allDirects.push(...deduped);
        break;
      }

      // Step 4: AI classify (relevance judgment is fully LLM-driven, no rule-based pre-filter)
      // Hard cap to prevent LLM input explosion when many sources return large result sets
      const MAX_CLASSIFY_INPUT = 300;
      const toClassify = deduped.length > MAX_CLASSIFY_INPUT
        ? deduped.slice(0, MAX_CLASSIFY_INPUT)
        : deduped;

      const batchCount = Math.ceil(toClassify.length / 30);
      emit({ type: 'classifying', round: rounds, resultCount: toClassify.length, batchCount });
      const classified = await aiClassify(query, toClassify, this.llm);
      const directs = classified.filter(r => r.resultType === 'direct');
      const leads = classified.filter(r => r.resultType === 'lead');
      // irrelevant results are silently dropped
      allDirects.push(...directs);
      allLeads.push(...leads);
      emit({ type: 'classified', round: rounds, directCount: directs.length, leadCount: leads.length });

      if (leads.length === 0) {
        emit({ type: 'converged', round: rounds, reason: 'no leads to follow' });
        break;
      }

      // Step 6: AI extract entities from leads (with confidence scores)
      emit({ type: 'extracting_entities', round: rounds, leadCount: leads.length });
      const rawEntities = await aiExtractEntities(query, leads, this.llm);

      // Cross-round dedup: skip entities already searched in previous rounds
      entities = rawEntities.filter(e => {
        const key = e.name.toLowerCase().trim();
        if (seenEntities.has(key)) return false;
        seenEntities.add(key);
        return true;
      });

      emit({
        type: 'entities_extracted',
        round: rounds,
        entities: entities.map(e => `${e.name}(${e.confidence.toFixed(1)})`),
      });
      if (entities.length === 0) {
        emit({ type: 'converged', round: rounds, reason: 'no new entities' });
        break;
      }
    }

    // Combine: directs first, then leads
    const results = [...allDirects, ...allLeads];

    // Step: Content extraction — fetch pages and fill summary field
    if (!opts?.skipContentExtraction) {
      await this.enrichWithContent(results, emit, lastScopeConfig);

      // Remove fragment results (both summary and snippet too short to be useful)
      const MIN_USEFUL_LENGTH = 100;
      for (let i = results.length - 1; i >= 0; i--) {
        const r = results[i];
        const summaryLen = r.summary?.length ?? 0;
        const snippetLen = r.snippet?.length ?? 0;
        if (summaryLen < MIN_USEFUL_LENGTH && snippetLen < MIN_USEFUL_LENGTH) {
          results.splice(i, 1);
        }
      }

      // Dedup by policy document number: keep most authoritative source per policy
      deduplicateByPolicyNumber(results);

      // Extract geographic locations from full page content
      if (this.llm) {
        await aiExtractLocations(results, this.llm);
      }
    }

    // Cross-session diff: mark results as NEW or KNOWN
    if (this.store) {
      const historicalUrls = this.store.getHistoricalUrls(query);
      for (const r of results) {
        r.isNew = !historicalUrls.has(r.url);
      }
    }

    // Store
    if (this.store) {
      const searchId = this.store.saveSearch(query, sourceNames, results);
      this.store.saveSourceStatuses(searchId, allStatuses);
    }

    // Collect all entities seen across rounds for the response
    const finalEntities = entities.length > 0 ? entities : undefined;

    return createSearchResponse({
      results,
      sources: allStatuses,
      query,
      totalResults: results.length,
      rounds,
      dimensions: searchDimensions,
      entities: finalEntities,
    });
  }

  private getSources(sourceNames?: string[]): BaseSource[] {
    let sources: BaseSource[];
    if (sourceNames && sourceNames.length > 0) {
      sources = sourceNames.map(s => this.registry.getSource(s));
    } else {
      sources = this.registry.getEnabledSources(this.config);
    }
    for (const s of sources) {
      s.configure(this.config);
    }
    return sources;
  }

  /**
   * Fetch and extract content for all results, filling the `summary` field.
   * Runs concurrently with a scope-driven concurrency limit. Failures are silently skipped.
   * @param scopeConfig — controls maxContentPages and fetchConcurrency based on search scope.
   */
  private async enrichWithContent(
    results: SearchResult[],
    emit: (event: ProgressEvent) => void,
    scopeConfig: ScopeConfig,
  ): Promise<void> {
    // Only fetch URLs that don't already have a summary
    const toFetch = results.filter(r => !r.summary && r.url);
    if (toFetch.length === 0) return;

    // Scope-aware page limit: prioritize direct results over leads, then cap
    const typePriority = (r: SearchResult) => r.resultType === 'direct' ? 2 : 1;
    const sorted = [...toFetch].sort((a, b) => typePriority(b) - typePriority(a));
    const limited = sorted.slice(0, scopeConfig.maxContentPages);

    const urls = [...new Set(limited.map(r => r.url))]; // dedup URLs
    emit({ type: 'extracting_content', totalUrls: urls.length });

    const pageResults = await fetchPages(urls, scopeConfig.fetchConcurrency);

    let successCount = 0;
    let failCount = 0;

    // Extract content from fetched pages (only for the scope-limited subset)
    const extractionTasks = limited.map(async (result) => {
      const pageResult = pageResults.get(result.url);
      if (!pageResult) {
        failCount++;
        return;
      }
      try {
        const extracted = await extractContent(pageResult.html, result.url);
        if (extracted.text.length > 0 && !isInvalidPage(extracted.text)) {
          result.summary = extracted.text;
          // Fill timestamp from extracted published date if not already set
          if (!result.timestamp && extracted.published) {
            result.timestamp = extracted.published;
          }
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    });

    await Promise.all(extractionTasks);
    emit({ type: 'content_extracted', successCount, failCount });
  }

  private async dispatch(
    queryMap: Record<string, string[]>,
    sources: BaseSource[],
    scopeConfig: ScopeConfig,
  ): Promise<{ results: SearchResult[]; statuses: SourceStatus[] }> {
    const timeoutMs = (this.config.sourceTimeoutApi ?? 30) * 1000;

    const tasks = sources.map(async (source) => {
      const queries = queryMap[source.name];
      if (!queries || queries.length === 0) {
        // No queries for this source — skip it
        return {
          results: [] as SearchResult[],
          status: { name: source.name, status: 'skipped' as const, resultCount: 0 },
        };
      }
      const start = Date.now();
      let timer: ReturnType<typeof setTimeout>;
      try {
        // Per-query cap for balanced distribution across dimension values
        const results = await Promise.race([
          source.search(queries, scopeConfig.resultsPerQuery),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
          }),
        ]);
        clearTimeout(timer!);
        const capped = results.slice(0, scopeConfig.perSourceCap);
        return {
          results: capped,
          status: {
            name: source.name,
            status: 'ok' as const,
            resultCount: capped.length,
            elapsedSeconds: (Date.now() - start) / 1000,
          },
        };
      } catch (err) {
        clearTimeout(timer!);
        const isTimeout = err instanceof Error && err.message === 'timeout';
        return {
          results: [] as SearchResult[],
          status: {
            name: source.name,
            status: (isTimeout ? 'timeout' : 'error') as 'timeout' | 'error',
            resultCount: 0,
            error: err instanceof Error ? err.message : String(err),
            elapsedSeconds: (Date.now() - start) / 1000,
          },
        };
      }
    });

    const settled = await Promise.all(tasks);
    return {
      results: settled.flatMap(s => s.results),
      statuses: settled.map(s => s.status),
    };
  }
}

/**
 * Detect login/captcha/anti-bot pages that were fetched as HTTP 200
 * but contain no real content.
 */
const INVALID_PAGE_PATTERNS = [
  /请登录|请先登录|登录后查看|sign\s*in|log\s*in/i,
  /扫码登录|扫一扫登录|手机验证码登录/,
  /请完成验证|验证码|captcha|challenge/i,
  /访问受限|access\s*denied|forbidden/i,
  /浏览器.*?不支持|enable\s*javascript/i,
];

function isInvalidPage(text: string): boolean {
  // Short text that matches login/captcha patterns → invalid
  if (text.length < 500) {
    return INVALID_PAGE_PATTERNS.some(p => p.test(text));
  }
  // Longer text — check if the dominant content is login-related
  // (first 300 chars contain login keywords)
  const head = text.slice(0, 300);
  const matchCount = INVALID_PAGE_PATTERNS.filter(p => p.test(head)).length;
  return matchCount >= 2; // Multiple login keywords in the beginning = invalid
}

/** Chinese policy document number pattern: XX规〔YYYY〕N号, XX发〔YYYY〕N号 etc. */
const POLICY_NUMBER_RE = /[\u4e00-\u9fff]+[规发办函令]〔\d{4}〕\d+号/g;

/** Authority score for dedup: .gov.cn > .org.cn > others */
function domainAuthority(url: string): number {
  if (url.includes('.gov.cn')) return 3;
  if (url.includes('.org.cn')) return 2;
  return 1;
}

/**
 * If multiple results cite the same policy document number,
 * keep the most authoritative source and remove the rest.
 */
function deduplicateByPolicyNumber(results: SearchResult[]): void {
  const policyMap = new Map<string, number[]>(); // policyNumber → result indices

  for (let i = 0; i < results.length; i++) {
    const text = results[i].summary ?? results[i].snippet ?? '';
    const matches = text.match(POLICY_NUMBER_RE);
    if (!matches) continue;
    for (const pn of matches) {
      const indices = policyMap.get(pn) ?? [];
      indices.push(i);
      policyMap.set(pn, indices);
    }
  }

  const toRemove = new Set<number>();
  for (const [, indices] of policyMap) {
    if (indices.length <= 1) continue;
    // Keep the result with highest domain authority; tie-break by index (earlier = higher rank)
    indices.sort((a, b) => {
      const authDiff = domainAuthority(results[b].url) - domainAuthority(results[a].url);
      return authDiff !== 0 ? authDiff : a - b;
    });
    // Remove all except the first (most authoritative)
    for (let k = 1; k < indices.length; k++) {
      toRemove.add(indices[k]);
    }
  }

  // Remove in reverse order to preserve indices
  const sorted = [...toRemove].sort((a, b) => b - a);
  for (const idx of sorted) {
    results.splice(idx, 1);
  }
}
