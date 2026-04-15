import type { SearchListItem, SearchDetail } from './types.js';

const BASE = '/api';

export async function fetchSearches(): Promise<{
  searches: SearchListItem[];
  active: Array<{ tempId: string; query: string; searchedAt: string; status: 'searching' }>;
}> {
  const res = await fetch(`${BASE}/searches`);
  if (!res.ok) throw new Error(`Failed to fetch searches: ${res.status}`);
  const data = await res.json();
  return { searches: data.searches ?? [], active: data.active ?? [] };
}

export async function fetchSearchDetail(id: number): Promise<SearchDetail> {
  const res = await fetch(`${BASE}/searches/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch search: ${res.status}`);
  return res.json();
}

export async function startSearch(query: string, deep?: boolean): Promise<string> {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, ...(deep ? { deep: true } : {}) }),
  });
  if (!res.ok) throw new Error(`Failed to start search: ${res.status}`);
  const data = await res.json();
  return data.searchId;
}

export interface SourceLastStatus {
  status: 'ok' | 'error' | 'timeout' | 'disabled' | 'skipped';
  resultCount: number;
  error?: string;
  elapsedSeconds?: number;
  createdAt: string;
}

export interface SourceInfo {
  name: string;
  type: string;
  requiresAuth: boolean;
  enabled: boolean;
  hasCredentials: boolean;
  isInDefaultSources: boolean;
  lastStatus: SourceLastStatus | null;
}

export interface ConfigInfo {
  llmProfile: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  braveApiKey: string;
  githubToken: string;
  defaultMaxRounds: number;
  sourceTimeoutApi: number;
  sourceTimeoutBrowser: number;
  version: string;
}

export async function fetchSources(): Promise<SourceInfo[]> {
  const res = await fetch(`${BASE}/sources`);
  if (!res.ok) throw new Error(`Failed to fetch sources: ${res.status}`);
  const data = await res.json();
  return data.sources;
}

export async function fetchConfig(): Promise<ConfigInfo> {
  const res = await fetch(`${BASE}/config`);
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  return res.json();
}

export async function patchConfig(key: string, value: string | number): Promise<void> {
  const res = await fetch(`${BASE}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error ?? `Failed to update config: ${res.status}`);
  }
}

export async function patchSource(name: string, enabled: boolean): Promise<void> {
  const res = await fetch(`${BASE}/sources/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Failed to update source: ${res.status}`);
}

export async function deleteSearchById(id: number): Promise<void> {
  const res = await fetch(`${BASE}/searches/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete search: ${res.status}`);
}

export async function startPlatformLogin(platform: string): Promise<{ loginId: string }> {
  const res = await fetch(`${BASE}/login/${platform}`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error ?? `Failed to start login: ${res.status}`);
  }
  return res.json();
}

export function subscribePlatformLogin(
  loginId: string,
  handlers: {
    onQrReady: (qrDataUrl: string) => void;
    onSuccess: () => void;
    onError: (message: string) => void;
  },
): () => void {
  const source = new EventSource(`${BASE}/login/stream?id=${loginId}`);

  source.addEventListener('qr_ready', (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    handlers.onQrReady(data.qrDataUrl);
  });

  source.addEventListener('success', () => {
    handlers.onSuccess();
    source.close();
  });

  source.addEventListener('error', (e) => {
    const me = e as MessageEvent;
    if (me.data) {
      try { handlers.onError(JSON.parse(me.data).message); } catch { handlers.onError('Login failed'); }
      source.close();
    } else if (source.readyState === EventSource.CLOSED) {
      handlers.onError('Connection lost');
      source.close();
    }
  });

  source.addEventListener('cancelled', () => source.close());

  return () => source.close();
}

export async function cancelPlatformLogin(loginId: string): Promise<void> {
  await fetch(`${BASE}/login/${loginId}`, { method: 'DELETE' });
}

export function subscribeProgress(
  searchId: string,
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void,
  onComplete: (storeId: number) => void,
  onError: (message: string) => void,
): () => void {
  const source = new EventSource(`${BASE}/search/stream?id=${searchId}`);

  source.addEventListener('progress', (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    onEvent({ type: 'progress', data });
  });

  source.addEventListener('complete', (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    onComplete(data.searchId);
    source.close();
  });

  // Named 'error' events from server (event: error\ndata: {...})
  source.addEventListener('error', (e) => {
    const me = e as MessageEvent;
    // Server-sent error event has data
    if (me.data) {
      try {
        onError(JSON.parse(me.data).message);
      } catch {
        onError('Unknown error');
      }
      source.close();
    } else if (source.readyState === EventSource.CLOSED) {
      // Connection was permanently closed by server
      // If we never got a complete event, report error
      onError('Connection closed');
      source.close();
    }
    // readyState === CONNECTING means browser is auto-reconnecting — let it retry
  });

  return () => source.close();
}
