/**
 * Page fetcher: retrieves HTML content from a URL.
 *
 * Strategy per URL:
 * 1. Domains requiring JS challenge (zhihu.com) → Playwright directly (with cookies)
 * 2. Simple fetch with cookies (fast, works for most sites)
 * 3. SSL error → retry with relaxed TLS ciphers (gov.cn compatibility)
 * 4. SPA shell detected → Playwright fallback (with cookies)
 */

import { loadCookies, cookiesToHeader } from './cookies.js';
import type { CookieEntry } from './cookies.js';

const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Domains that require Playwright (JS challenge, can't be bypassed by fetch). */
const PLAYWRIGHT_ONLY_DOMAINS = ['zhihu.com', 'zhuanlan.zhihu.com'];

/** Domain → platform name for cookie lookup. */
const COOKIE_PLATFORM_MAP: Record<string, string> = {
  'zhihu.com': 'zhihu',
  'zhuanlan.zhihu.com': 'zhihu',
  'weibo.com': 'weibo',
  'weibo.cn': 'weibo',
  'm.weibo.cn': 'weibo',
  'xiaohongshu.com': 'xiaohongshu',
  'xhslink.com': 'xiaohongshu',
  'x.com': 'x',
  'twitter.com': 'x',
  'mp.weixin.qq.com': 'wechat',
};

export interface FetchPageResult {
  html: string;
  method: 'fetch' | 'fetch-relaxed-tls' | 'playwright';
  status: number;
  durationMs: number;
}

export interface FetchPageOptions {
  usePlaywrightFallback?: boolean;
  timeout?: number;
}

/**
 * Fetch a page's HTML content with automatic SSL retry and cookie injection.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult | null> {
  const { usePlaywrightFallback = true, timeout = FETCH_TIMEOUT_MS } = options;
  const hostname = getHostname(url);

  // Route 1: Domains that require Playwright (JS challenge)
  if (usePlaywrightFallback && PLAYWRIGHT_ONLY_DOMAINS.some(d => hostname.endsWith(d))) {
    return playwrightFetch(url, timeout, hostname);
  }

  // Route 2: Simple fetch (with cookies if available)
  const cookies = getCookieHeader(hostname);
  const fetchResult = await simpleFetch(url, timeout, cookies);

  if (fetchResult) {
    const textLength = estimateTextContent(fetchResult.html);
    if (textLength >= 200) return fetchResult;
    // SPA shell — try Playwright
    if (usePlaywrightFallback) {
      const pwResult = await playwrightFetch(url, timeout, hostname);
      if (pwResult) return pwResult;
    }
    return fetchResult;
  }

  // Route 3: fetch returned null — could be SSL error, try relaxed TLS
  const relaxedResult = await simpleFetchRelaxedTLS(url, timeout, cookies);
  if (relaxedResult) {
    const textLength = estimateTextContent(relaxedResult.html);
    if (textLength >= 200) return relaxedResult;
  }

  // Route 4: Playwright fallback
  if (usePlaywrightFallback) {
    const pwResult = await playwrightFetch(url, timeout, hostname);
    if (pwResult) return pwResult;
  }

  return relaxedResult ?? null;
}

/**
 * Fetch multiple pages concurrently. Shares a single Playwright browser
 * instance across all URLs that need it.
 */
export async function fetchPages(
  urls: string[],
  concurrency = 10,
): Promise<Map<string, FetchPageResult>> {
  const results = new Map<string, FetchPageResult>();
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift()!;
      try {
        const result = await fetchPage(url);
        if (result) results.set(url, result);
      } catch {
        // Skip failed URLs silently
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function getHostname(url: string): string {
  try { return new URL(url).hostname; }
  catch { return ''; }
}

/** Look up cookie header for a URL's hostname. */
function getCookieHeader(hostname: string): string | undefined {
  for (const [domain, platform] of Object.entries(COOKIE_PLATFORM_MAP)) {
    if (hostname.endsWith(domain)) {
      const cookies = loadCookies(platform);
      if (cookies.length > 0) {
        return cookiesToHeader(cookies, hostname);
      }
      return undefined;
    }
  }
  return undefined;
}

/** Standard fetch with browser UA and optional cookies. */
async function simpleFetch(
  url: string,
  timeout: number,
  cookies?: string,
): Promise<FetchPageResult | null> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    if (cookies) headers['Cookie'] = cookies;

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html') && !contentType.includes('xml') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await response.text();
    return { html, method: 'fetch', status: response.status, durationMs: Date.now() - start };
  } catch {
    return null;
  }
}

/**
 * Retry fetch with relaxed TLS — excludes ECDHE ciphers to handle
 * servers with bad EC point encoding (e.g., sz.gov.cn).
 */
async function simpleFetchRelaxedTLS(
  url: string,
  timeout: number,
  cookies?: string,
): Promise<FetchPageResult | null> {
  const start = Date.now();
  try {
    // Dynamic import undici for custom TLS agent
    const { Agent, fetch: undiciFetch } = await import('undici');
    const agent = new Agent({
      connect: {
        ciphers: 'AES128-GCM-SHA256:AES256-GCM-SHA384:!ECDHE',
        maxVersion: 'TLSv1.2' as const,
      },
    });

    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    if (cookies) headers['Cookie'] = cookies;

    const response = await undiciFetch(url, {
      dispatcher: agent,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html') && !contentType.includes('xml') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await response.text();
    return { html, method: 'fetch-relaxed-tls', status: response.status, durationMs: Date.now() - start };
  } catch {
    return null;
  }
}

/** Playwright fetch with cookie injection and anti-detection. */
async function playwrightFetch(
  url: string,
  timeout: number,
  hostname: string,
): Promise<FetchPageResult | null> {
  const start = Date.now();
  try {
    const pw = await import('playwright');
    const browser = await pw.chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    try {
      const context = await browser.newContext({
        userAgent: BROWSER_UA,
      });

      // Inject cookies if available for this domain
      const platformCookies = getPlatformCookies(hostname);
      if (platformCookies.length > 0) {
        // Adapt CookieEntry to Playwright's cookie format (sameSite type difference)
        const pwCookies = platformCookies.map(c => ({
          ...c,
          sameSite: (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None')
            ? c.sameSite as 'Strict' | 'Lax' | 'None'
            : undefined,
        }));
        await context.addCookies(pwCookies);
      }

      const page = await context.newPage();

      // Remove webdriver flag
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Use domcontentloaded instead of networkidle — sites like YouTube/X
      // have persistent network activity that prevents networkidle from ever firing.
      // Then wait briefly for JS to render dynamic content.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForTimeout(3000);
      const html = await page.content();

      return { html, method: 'playwright', status: 0, durationMs: Date.now() - start };
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

/** Load Playwright-format cookies for a hostname. */
function getPlatformCookies(hostname: string): CookieEntry[] {
  for (const [domain, platform] of Object.entries(COOKIE_PLATFORM_MAP)) {
    if (hostname.endsWith(domain)) {
      return loadCookies(platform);
    }
  }
  return [];
}

/** Rough estimate of text content length in HTML. */
function estimateTextContent(html: string): number {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length;
}
