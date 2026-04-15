/**
 * Weibo source via mobile web API (no auth required).
 */

import { BaseSource } from './base.js';
import { fetchWithDefaults } from '../utils/http.js';
import { MOBILE_UA } from '../utils/http.js';
import { stripHtml } from '../utils/html.js';
import { hasCookies, loadCookies, cookiesToHeader } from '../utils/cookies.js';
import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';

const SEARCH_URL = 'https://m.weibo.cn/api/container/getIndex';

const HEADERS: Record<string, string> = {
  'User-Agent': MOBILE_UA,
  Referer: 'https://m.weibo.cn/',
  Accept: 'application/json, text/plain, */*',
  'X-Requested-With': 'XMLHttpRequest',
};

/**
 * Parse Weibo's Chinese relative time formats into an ISO 8601 string.
 *
 * Supported formats:
 * - "X分钟前" (X minutes ago)
 * - "X小时前" (X hours ago)
 * - "昨天 HH:MM" (yesterday)
 * - "MM-DD" (current year)
 * - Full date strings like "Wed Mar 12 10:30:00 +0800 2026"
 */
export function parseWeiboTime(createdAt: string): string | undefined {
  if (!createdAt) return undefined;

  // Already a Unix timestamp
  if (/^\d+$/.test(createdAt)) {
    return new Date(Number(createdAt) * 1000).toISOString();
  }

  const now = Date.now();

  // "X分钟前" — X minutes ago
  const minuteMatch = createdAt.match(/(\d+)分钟前/);
  if (minuteMatch) {
    return new Date(now - Number(minuteMatch[1]) * 60_000).toISOString();
  }

  // "X小时前" — X hours ago
  const hourMatch = createdAt.match(/(\d+)小时前/);
  if (hourMatch) {
    return new Date(now - Number(hourMatch[1]) * 3_600_000).toISOString();
  }

  // "昨天 HH:MM" — yesterday
  const yesterdayMatch = createdAt.match(/昨天\s*(\d{2}):(\d{2})/);
  if (yesterdayMatch) {
    const d = new Date(now - 86_400_000);
    d.setHours(Number(yesterdayMatch[1]), Number(yesterdayMatch[2]), 0, 0);
    return d.toISOString();
  }

  // "MM-DD" format (current year)
  const mmddMatch = createdAt.match(/^(\d{2})-(\d{2})$/);
  if (mmddMatch) {
    const year = new Date().getFullYear();
    const d = new Date(year, Number(mmddMatch[1]) - 1, Number(mmddMatch[2]));
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  // Full date: try native Date parsing (handles most standard formats)
  const parsed = new Date(createdAt);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return undefined;
}

interface WeiboMblog {
  id?: string;
  mid?: string;
  text?: string;
  user?: {
    id?: number | string;
    screen_name?: string;
    verified?: boolean;
  };
  created_at?: string;
  reposts_count?: number;
  comments_count?: number;
  attitudes_count?: number;
}

interface WeiboCard {
  card_type?: number;
  mblog?: WeiboMblog;
  card_group?: WeiboCard[];
}

interface WeiboResponse {
  data?: {
    cards?: WeiboCard[];
  };
}

export class WeiboSource extends BaseSource {
  readonly name = 'weibo';
  readonly sourceType = 'scrape' as const;
  readonly requiresAuth = true;

  enabled(_config: Config): boolean {
    return hasCookies('weibo');
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const containerId = `100103type=1&q=${query}`;
    const url = `${SEARCH_URL}?containerid=${encodeURIComponent(containerId)}&page_type=searchall`;

    const headers = { ...HEADERS };
    const cookies = loadCookies('weibo');
    const cookieHeader = cookiesToHeader(cookies, 'weibo.com');
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    } else if (cookies.length === 0) {
      throw new Error('weibo: no cookies, please login: moleminer login weibo');
    }

    const resp = await fetchWithDefaults(url, { headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`weibo HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    let data: WeiboResponse;
    try {
      data = (await resp.json()) as WeiboResponse;
    } catch (e) {
      throw new Error(`weibo: invalid JSON response: ${(e as Error).message}`);
    }

    const results: SearchResult[] = [];
    const cards = data.data?.cards ?? [];

    for (const card of cards) {
      if (card.card_type === 9 && card.mblog) {
        const result = this.parseMblog(card.mblog);
        if (result) results.push(result);
      } else if (card.card_type === 11 && card.card_group) {
        for (const sub of card.card_group) {
          if (sub.card_type === 9 && sub.mblog) {
            const result = this.parseMblog(sub.mblog);
            if (result) results.push(result);
          }
        }
      }
    }

    return results;
  }

  private parseMblog(mblog: WeiboMblog): SearchResult | null {
    const mid = mblog.id ?? mblog.mid;
    if (!mid) return null;

    const rawText = mblog.text ?? '';
    const text = stripHtml(rawText);
    if (!text) return null;

    const user = mblog.user ?? {};
    const uid = user.id;
    const postUrl = uid
      ? `https://weibo.com/${uid}/${mid}`
      : `https://m.weibo.cn/detail/${mid}`;

    const title = text.split('\n')[0].slice(0, 100);
    const timestamp = parseWeiboTime(mblog.created_at ?? '');

    return {
      title,
      url: postUrl,
      source: 'weibo',
      snippet: text.slice(0, 300),
      resultType: 'lead',
      language: 'zh',
      timestamp,
      metadata: {
        author: user.screen_name ?? '',
        reposts: mblog.reposts_count ?? 0,
        comments: mblog.comments_count ?? 0,
        likes: mblog.attitudes_count ?? 0,
        verified: user.verified ?? false,
      },
    };
  }
}
