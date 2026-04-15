/**
 * Xiaohongshu (RedNote) source with native TypeScript API signing.
 *
 * Architecture:
 * - Login: Playwright headful → QR scan → save cookies (one-time)
 * - Search: xhs-sign.ts computes x-s/x-t signatures natively,
 *   then fetch calls XHS API with signed headers.
 */

import { createHash, randomBytes } from 'node:crypto';
import { BaseSource } from './base.js';
import { fetchWithDefaults, BROWSER_UA } from '../utils/http.js';
import { hasCookies, loadCookies, cookiesToHeader } from '../utils/cookies.js';
import { signHeaders as xhsSignHeaders } from '../utils/xhs-sign.js';
import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import type { CookieEntry } from '../utils/cookies.js';

const SEARCH_URL = 'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes';
const SEARCH_URI = '/api/sns/web/v1/search/notes';

const HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  Origin: 'https://www.xiaohongshu.com',
  Referer: 'https://www.xiaohongshu.com/',
  'Content-Type': 'application/json;charset=UTF-8',
};

/** Generate a random search_id for XHS API. */
export function generateSearchId(): string {
  const raw = Buffer.concat([randomBytes(16), Buffer.from(String(Date.now()))]);
  return createHash('md5').update(raw).digest('hex');
}

/** Convert CookieEntry[] to simple {name: value} dict for xhshow. */
function cookiesToDict(cookies: CookieEntry[]): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const c of cookies) {
    if (c.name && c.value) dict[c.name] = c.value;
  }
  return dict;
}

/**
 * Get signing headers via native TypeScript implementation.
 * Returns x-s, x-s-common, x-t, x-b3-traceid, x-xray-traceid or empty object on failure.
 */
export function getSignHeaders(
  method: string,
  uri: string,
  cookiesDict: Record<string, string>,
  payload?: Record<string, unknown>,
): Record<string, string> {
  try {
    return xhsSignHeaders(method, uri, cookiesDict, payload);
  } catch {
    return {};
  }
}

interface XhsNoteCard {
  display_title?: string;
  desc?: string;
  user?: { nickname?: string };
  interact_info?: { liked_count?: string | number };
  last_update_time?: number;
  type?: string;
}

interface XhsItem {
  id?: string;
  note_card?: XhsNoteCard;
}

interface XhsResponse {
  data?: {
    items?: XhsItem[];
  };
}

export class XiaohongshuSource extends BaseSource {
  readonly name = 'xiaohongshu';
  readonly sourceType = 'scrape' as const;
  readonly requiresAuth = true;
  override readonly installExtra = 'cn';

  enabled(_config: Config): boolean {
    return hasCookies('xiaohongshu');
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const cookies = loadCookies('xiaohongshu');
    if (cookies.length === 0) {
      throw new Error('xiaohongshu: no cookies, please login: moleminer login xiaohongshu');
    }

    const cookiesDict = cookiesToDict(cookies);
    if (!cookiesDict.a1) {
      throw new Error('xiaohongshu: missing a1 cookie, please re-login: moleminer login xiaohongshu');
    }

    const payload = {
      keyword: query,
      page: 1,
      page_size: 20,
      search_id: generateSearchId(),
      sort: 'general',
      note_type: 0,
      ext_flags: [],
      geo: '',
      image_formats: ['jpg', 'webp', 'avif'],
    };
    const payloadStr = JSON.stringify(payload);

    // Get sign headers via native TypeScript signing
    const signHeaders = getSignHeaders('POST', SEARCH_URI, cookiesDict, payload);
    if (!signHeaders['x-s']) {
      throw new Error('xiaohongshu: sign function failed (xhsSignHeaders returned empty)');
    }

    const cookieHeader = cookiesToHeader(cookies, 'www.xiaohongshu.com');
    if (!cookieHeader) {
      throw new Error('xiaohongshu: invalid cookies format');
    }

    const headers: Record<string, string> = {
      ...HEADERS,
      Cookie: cookieHeader,
      ...signHeaders,
    };

    const resp = await fetchWithDefaults(SEARCH_URL, {
      method: 'POST',
      headers,
      body: payloadStr,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`xiaohongshu HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    let data: XhsResponse;
    try {
      data = (await resp.json()) as XhsResponse;
    } catch (e) {
      throw new Error(`xiaohongshu: invalid JSON response: ${(e as Error).message}`);
    }

    const results: SearchResult[] = [];
    for (const item of data.data?.items ?? []) {
      const result = this.parseItem(item);
      if (result) results.push(result);
    }
    return results;
  }

  private parseItem(item: XhsItem): SearchResult | null {
    const noteCard = item.note_card;
    if (!noteCard) return null;

    const noteId = item.id;
    if (!noteId) return null;

    const title = noteCard.display_title;
    if (!title) return null;

    const url = `https://www.xiaohongshu.com/explore/${noteId}`;
    const desc = noteCard.desc ?? '';
    const author = noteCard.user?.nickname ?? '';
    const likedCount = noteCard.interact_info?.liked_count ?? '0';

    let timestamp: string | undefined;
    const lastUpdate = noteCard.last_update_time;
    if (lastUpdate && typeof lastUpdate === 'number') {
      const ms = lastUpdate > 1e12 ? lastUpdate : lastUpdate * 1000;
      timestamp = new Date(ms).toISOString();
    }

    return {
      title,
      url,
      source: 'xiaohongshu',
      snippet: desc ? desc.slice(0, 300) : title,
      resultType: 'lead',
      language: 'zh',
      timestamp,
      metadata: {
        author,
        liked_count: likedCount,
        type: noteCard.type ?? '',
      },
    };
  }
}
