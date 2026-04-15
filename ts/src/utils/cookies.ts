/**
 * Cookie management for browser-authenticated Chinese platform sources.
 *
 * Handles:
 * - Persistent cookie storage in ~/.moleminer/cookies/{platform}.json
 * - Cookie loading for fetch requests
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const COOKIES_DIR = join(homedir(), '.moleminer', 'cookies');

/** Get the cookie file path for a platform. */
export function getCookiePath(platformName: string): string {
  return join(COOKIES_DIR, `${platformName}.json`);
}

/** Cookie entry from Playwright storage_state format. */
export interface CookieEntry {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number; // Unix timestamp (seconds). -1 or 0 = session cookie.
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

/** Returns true if the cookie has not expired.
 *  Session cookies (no expires or expires <= 0) are treated as always valid. */
function isCookieValid(c: CookieEntry): boolean {
  if (!c.expires || c.expires <= 0) return true;
  return c.expires > Math.floor(Date.now() / 1000);
}

/** Check if valid (non-expired) cookies exist for a platform. */
export function hasCookies(platformName: string): boolean {
  const path = getCookiePath(platformName);
  if (!existsSync(path)) return false;
  try {
    const cookies = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(cookies) && cookies.some(isCookieValid);
  } catch {
    return false;
  }
}

/** Load cookies from disk for a platform. */
export function loadCookies(platformName: string): CookieEntry[] {
  const path = getCookiePath(platformName);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

/** Save cookies to disk. Returns the path written to. */
export function saveCookies(platformName: string, cookies: CookieEntry[]): string {
  mkdirSync(COOKIES_DIR, { recursive: true });
  const path = getCookiePath(platformName);
  writeFileSync(path, JSON.stringify(cookies, null, 2), 'utf-8');

  // Set file permissions to owner-only on Unix (cookies are sensitive)
  if (platform() !== 'win32') {
    chmodSync(path, 0o600);
  }

  return path;
}

/** Convert stored cookies to a Cookie header string for fetch.
 *  Filters cookies by domain (and skips expired cookies).
 *  Builds "name1=val1; name2=val2" format. */
export function cookiesToHeader(cookies: CookieEntry[], domain: string): string | undefined {
  const parts: string[] = [];
  for (const c of cookies) {
    if (!isCookieValid(c)) continue;
    const cookieDomain = c.domain ?? '';
    if (
      cookieDomain &&
      (domain.endsWith(cookieDomain) ||
        domain.endsWith(cookieDomain.replace(/^\./, '')) ||
        cookieDomain.endsWith(domain))
    ) {
      if (c.name) {
        parts.push(`${c.name}=${c.value}`);
      }
    }
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * Platform login configurations.
 *
 * Headless QR terminal rendering works for: zhihu, weibo (via network interception).
 * Xiaohongshu blocks headless browsers → always falls back to visible browser window.
 * X/Twitter has no web QR login → always uses visible browser (headfulOnly).
 */
const LOGIN_CONFIGS: Record<string, {
  url: string;
  /** CSS selector for the QR code image element. */
  qrSelector: string;
  /** How to extract the QR data URL from the element. */
  qrAttr: 'src' | 'data-qrcode' | 'screenshot';
  /** CSS selector or URL pattern that indicates login success. */
  successIndicator: { type: 'url'; pattern: string } | { type: 'selector'; selector: string } | { type: 'cookie'; name: string };
  /** Cookie domain to filter (partial match). */
  domain: string;
  /** URL to visit after login to trigger SSO and collect additional cookies. */
  postLoginUrl?: string;
  /** Skip headless QR attempt and go straight to visible browser window. */
  headfulOnly?: boolean;
  /** Message shown to user when browser window opens. */
  loginMessage?: string;
}> = {
  zhihu: {
    url: 'https://www.zhihu.com/signin?next=%2F',
    qrSelector: '.Qrcode-img img, img[alt*="二维码"], .Login-qrcode img',
    qrAttr: 'screenshot',
    successIndicator: { type: 'cookie', name: 'z_c0' },
    domain: 'zhihu.com',
  },
  xiaohongshu: {
    url: 'https://www.xiaohongshu.com/explore',
    qrSelector: '.qrcode-img img, .login-qrcode img, canvas.qrcode',
    qrAttr: 'screenshot',
    successIndicator: { type: 'cookie', name: 'web_session' },
    domain: 'xiaohongshu.com',
  },
  weibo: {
    url: 'https://passport.weibo.com/sso/signin?entry=wapsso&source=wapssowb&url=https%3A%2F%2Fm.weibo.cn%2F',
    qrSelector: '.qr-code img, img[src*="qrcode"]',
    qrAttr: 'screenshot',
    successIndicator: { type: 'cookie', name: 'SUB' },
    domain: 'weibo',
    /** After login, visit m.weibo.cn to trigger SSO and get mobile cookies. */
    postLoginUrl: 'https://m.weibo.cn/',
  },
  x: {
    url: 'https://x.com/i/flow/login',
    qrSelector: '',
    qrAttr: 'screenshot',
    successIndicator: { type: 'cookie', name: 'auth_token' },
    domain: 'x.com',
    headfulOnly: true,
    loginMessage: 'Please log in to X/Twitter in the browser window that opened.\n  Use any login method (username/password, Google, Apple, etc.).',
  },
};

/**
 * Launch headless Playwright browser, display QR code in terminal, wait for user to scan.
 * Returns saved cookie count on success.
 */
export async function playwrightLogin(
  platformName: string,
  opts?: {
    timeout?: number;
    onStatus?: (msg: string) => void;
    /** Web server hook: called with a PNG data URL once QR is captured. */
    onQrReady?: (qrDataUrl: string) => void;
    /** Shared mutable token — set .cancelled = true to abort mid-session. */
    cancelToken?: { cancelled: boolean };
  },
): Promise<{ cookieCount: number; path: string }> {
  const config = LOGIN_CONFIGS[platformName];
  if (!config) {
    throw new Error(`No login config for platform: ${platformName}. Supported: ${Object.keys(LOGIN_CONFIGS).join(', ')}`);
  }

  const log = opts?.onStatus ?? (() => {});
  const timeoutMs = opts?.timeout ?? 120_000;

  // Dynamic import — playwright is optional
  let chromium: typeof import('playwright').chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    throw new Error(
      'Playwright is not installed. Run: npm install playwright && npx playwright install chromium',
    );
  }

  // Platforms that have no web QR login (e.g. X/Twitter) go straight to visible browser
  if (config.headfulOnly) {
    log(config.loginMessage ?? 'Please log in in the browser window that opened.');
    return _fallbackVisibleLogin(chromium, config, platformName, timeoutMs, log);
  }

  // Dynamic import — qrcode for terminal rendering
  let qrcodeToTerminal: (text: string) => Promise<string>;
  try {
    const qrcode = await import('qrcode');
    qrcodeToTerminal = (text: string) =>
      qrcode.toString(text, { type: 'utf8', small: true });
  } catch {
    throw new Error('qrcode package is not installed. Run: npm install qrcode');
  }

  log('Launching browser...');

  // --- Strategy: intercept network requests to capture QR code URL ---
  // Chinese platforms generate QR codes via API calls. We intercept those
  // responses to extract the QR URL, then render it in the terminal.
  const QR_URL_PATTERNS: Record<string, RegExp[]> = {
    zhihu: [/api.*login.*qrcode/i, /qrcode/i, /udid/i],
    xiaohongshu: [/qrcode/i, /login.*qr/i, /sns.*qr/i],
    weibo: [/qr\.weibo\.cn\/inf\/gen/i, /qrcode\/image/i, /sso.*qr/i],
  };

  let capturedQrUrl: string | null = null;
  const urlPatterns = QR_URL_PATTERNS[platformName] ?? [];

  // Anti-detection flags — required for XHS (blocks default headless Playwright)
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });
  const page = await context.newPage();

  // Intercept API responses that might contain QR data
  page.on('response', async (response) => {
    const reqUrl = response.url();
    if (capturedQrUrl) return; // already found
    if (!urlPatterns.some((p) => p.test(reqUrl))) return;

    try {
      // Weibo: QR scan URL is in the request URL's `data` query parameter
      // e.g. v2.qr.weibo.cn/inf/gen?data=https://passport.weibo.cn/signin/qrcode/scan?qr=XXX
      if (reqUrl.includes('qr.weibo.cn/inf/gen')) {
        const parsed = new URL(reqUrl);
        const dataParam = parsed.searchParams.get('data');
        if (dataParam && dataParam.includes('qrcode/scan')) {
          capturedQrUrl = dataParam;
          return;
        }
      }

      const body = await response.text();
      // Try to parse JSON first — XHS returns {"data":{"url":"https://..."}} structure
      try {
        const json = JSON.parse(body) as Record<string, unknown>;
        // XHS QR create: data.url contains the scan URL
        const data = json.data as Record<string, unknown> | undefined;
        if (data?.url && typeof data.url === 'string' && data.url.startsWith('http')) {
          capturedQrUrl = data.url;
          return;
        }
        // Zhihu: token in response
        if (json.token && typeof json.token === 'string') {
          capturedQrUrl = `https://www.zhihu.com/api/v3/account/api/login/qrcode/${json.token}/image`;
          return;
        }
        // Generic: walk top-level values looking for a QR/login URL
        for (const v of Object.values(json)) {
          if (typeof v === 'string' && v.startsWith('http') && /qr|scan|login/i.test(v)) {
            capturedQrUrl = v;
            return;
          }
        }
      } catch { /* not JSON — fall through to regex */ }
      // Fallback: regex scan for URLs containing QR/login/scan/token
      const urlMatch = body.match(/https?:\/\/[^\s"'\\]+(?:qrId|qr_id|qrcode|scan|token|login)[^\s"'\\]*/i);
      if (urlMatch) {
        capturedQrUrl = urlMatch[0];
        return;
      }
    } catch { /* response body unavailable */ }
  });

  try {
    log(`Opening ${platformName} login page...`);
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {
      throw new Error(
        `Cannot reach ${config.url}. If you're outside China, you may need a proxy to access Chinese platforms.`,
      );
    });

    // Try to switch to QR code login tab
    if (platformName === 'zhihu') {
      const qrTab = page.locator('div:has-text("二维码登录"), .Login-qrcode-tab');
      if (await qrTab.count() > 0) {
        await qrTab.first().click().catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    if (platformName === 'xiaohongshu') {
      const loginBtn = page.locator('text=登录, .login-btn');
      if (await loginBtn.count() > 0) {
        await loginBtn.first().click().catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    log('Looking for QR code...');
    // Wait a bit for API responses to be intercepted
    await page.waitForTimeout(3000);

    // If we captured a QR URL via network interception, render it
    if (capturedQrUrl) {
      // Web: generate PNG data URL and call callback
      if (opts?.onQrReady) {
        const qrcode = await import('qrcode');
        const dataUrl = await qrcode.toDataURL(capturedQrUrl, { width: 280, margin: 2 });
        opts.onQrReady(dataUrl);
      } else {
        // CLI: render QR to terminal
        const qrString = await qrcodeToTerminal(capturedQrUrl);
        log('\n' + qrString);
        log(`Scan the QR code above with ${platformName} app...`);
      }

      // Record initial cookie state — XHS sets web_session for anonymous visitors
      // so we must detect login by VALUE CHANGE, not mere presence.
      const initialCookies = await context.cookies();
      const initialAuthValue = initialCookies.find((c) => c.name === config.successIndicator.name)?.value ?? '';

      // Wait for login success in headless mode
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);

        if (opts?.cancelToken?.cancelled) {
          throw new Error('Login cancelled');
        }

        if (config.successIndicator.type === 'cookie') {
          const cookies = await context.cookies();
          const authCookie = cookies.find((c) => c.name === config.successIndicator.name);
          if (authCookie && authCookie.value !== initialAuthValue && authCookie.value.length > 20) {
            break;
          }
        }
      }

      // Visit postLoginUrl to trigger SSO and collect additional cookies
      if (config.postLoginUrl) {
        log('Completing SSO redirect...');
        await page.goto(config.postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }

      const cookies = await context.cookies();
      const filtered = cookies.filter((c) => c.domain.includes(config.domain));
      if (filtered.length === 0) {
        throw new Error(`Login timed out. No ${platformName} cookies captured.`);
      }
      const path = saveCookies(platformName, filtered);
      return { cookieCount: filtered.length, path };
    }

    // Fallback: could not intercept QR URL → open visible browser
    log('Could not extract QR code in headless mode. Opening browser window...');
    await browser.close();
    return _fallbackVisibleLogin(chromium, config, platformName, timeoutMs, log, opts?.cancelToken);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Fallback: open a visible browser window for QR scan. */
async function _fallbackVisibleLogin(
  chromium: typeof import('playwright').chromium,
  config: (typeof LOGIN_CONFIGS)[string],
  platformName: string,
  timeoutMs: number,
  log: (msg: string) => void,
  cancelToken?: { cancelled: boolean },
): Promise<{ cookieCount: number; path: string }> {
  // Use stealth-like args to reduce bot detection (XHS blocks default Playwright)
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  // Remove webdriver property to reduce detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);

    // Try to switch to QR code login tab
    if (platformName === 'zhihu') {
      const qrTab = page.locator('div:has-text("二维码登录")');
      if (await qrTab.count() > 0) await qrTab.first().click().catch(() => {});
    }

    log(config.loginMessage ?? 'Please scan the QR code in the browser window...');

    // Record initial cookie state — some platforms (XHS) set web_session for
    // anonymous visitors too, so we detect LOGIN by watching for a VALUE CHANGE.
    const initialCookies = await context.cookies();
    const initialAuthValue = initialCookies.find((c) => c.name === config.successIndicator.name)?.value ?? '';

    // Wait for login success: cookie value changed to an authenticated (longer) token
    const deadline = Date.now() + timeoutMs;
    let success = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);

      if (cancelToken?.cancelled) {
        throw new Error('Login cancelled');
      }

      if (config.successIndicator.type === 'cookie') {
        const cookies = await context.cookies();
        const authCookie = cookies.find((c) => c.name === config.successIndicator.name);
        if (authCookie && authCookie.value !== initialAuthValue && authCookie.value.length > 20) {
          success = true;
          break;
        }
      }
    }

    if (!success) {
      // Timed out waiting for scan — but still try to collect any cookies present
      log('Timeout waiting for scan. Collecting available cookies...');
    }

    if (success) await page.waitForTimeout(2000);

    // Visit postLoginUrl to trigger SSO and collect additional cookies
    if (config.postLoginUrl) {
      log('Completing SSO redirect...');
      await page.goto(config.postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    const cookies = await context.cookies();
    const filtered = cookies.filter((c) => c.domain.includes(config.domain));

    if (filtered.length === 0) {
      throw new Error(
        `Login timed out or failed. No ${platformName} cookies captured.\n` +
          `If the browser window showed a blank page, ${platformName} may have blocked automated browsers.\n` +
          `Try opening ${config.url} manually in Chrome, log in, then export cookies.`,
      );
    }

    // Verify the expected auth cookie is present
    const authCookie = config.successIndicator.name;
    if (!filtered.some((c) => c.name === authCookie)) {
      throw new Error(
        `Browser opened but ${platformName} login was not completed (missing ${authCookie} cookie).\n` +
          `Please scan the QR code and complete login within ${timeoutMs / 1000}s.`,
      );
    }

    const path = saveCookies(platformName, filtered);
    return { cookieCount: filtered.length, path };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Lightweight validation endpoints per platform.
 *  Returns ok:true if cookies are still valid. */
const VALIDATION_ENDPOINTS: Record<string, {
  url: string;
  domain: string;
  isValid: (status: number, body: string) => boolean;
}> = {
  weibo: {
    url: 'https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3Dtest&page_type=searchall',
    domain: 'weibo',
    isValid: (_status, body) => {
      try { const j = JSON.parse(body); return j?.ok === 0 && (j?.data?.cards?.length ?? 0) > 0; } catch { return false; }
    },
  },
  zhihu: {
    url: 'https://www.zhihu.com/api/v4/me',
    domain: 'zhihu.com',
    isValid: (status) => status === 200,
  },
  xiaohongshu: {
    url: 'https://edith.xiaohongshu.com/api/sns/web/v1/user/me',
    domain: 'xiaohongshu.com',
    isValid: (status) => status === 200,
  },
};

/** Check if stored cookies are still valid by hitting a lightweight endpoint.
 *  Returns 'valid' | 'expired' | 'no_cookies' | 'unknown' (no validation endpoint). */
export async function validateCookies(platformName: string): Promise<'valid' | 'expired' | 'no_cookies' | 'unknown'> {
  if (!hasCookies(platformName)) return 'no_cookies';

  const endpoint = VALIDATION_ENDPOINTS[platformName];
  if (!endpoint) return 'unknown';

  const cookies = loadCookies(platformName);
  const cookieHeader = cookiesToHeader(cookies, endpoint.domain);
  if (!cookieHeader) return 'expired';

  try {
    const resp = await fetch(endpoint.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Cookie: cookieHeader,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await resp.text();
    return endpoint.isValid(resp.status, body) ? 'valid' : 'expired';
  } catch {
    return 'expired';
  }
}

/** Delete stored cookies for a platform. Returns true if file existed. */
export function clearCookies(platformName: string): boolean {
  const path = getCookiePath(platformName);
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}
