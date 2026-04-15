/** HTTP fetch wrapper with sensible defaults. */

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (compatible; MoleMiner/0.3; +https://github.com/moleminer/moleminer)',
};

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Fetch with default headers and timeout. */
export async function fetchWithDefaults(
  url: string,
  opts?: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOpts } = opts ?? {};
  const headers = { ...DEFAULT_HEADERS, ...(fetchOpts.headers as Record<string, string>) };
  return fetch(url, {
    ...fetchOpts,
    headers,
    signal: AbortSignal.timeout(timeout),
  });
}

/** Fetch and parse JSON, throwing on non-ok status. */
export async function fetchJson<T = unknown>(
  url: string,
  opts?: RequestInit & { timeout?: number },
): Promise<T> {
  const resp = await fetchWithDefaults(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json() as Promise<T>;
}

/** Fetch and return text, throwing on non-ok status. */
export async function fetchText(
  url: string,
  opts?: RequestInit & { timeout?: number },
): Promise<string> {
  const resp = await fetchWithDefaults(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.text();
}
