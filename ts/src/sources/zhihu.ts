/**
 * Zhihu source via internal search API (requires cookie auth).
 */

import { BaseSource } from './base.js';
import { fetchWithDefaults } from '../utils/http.js';
import { BROWSER_UA } from '../utils/http.js';
import { stripHtml } from '../utils/html.js';
import { hasCookies, loadCookies, cookiesToHeader } from '../utils/cookies.js';
import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';

const SEARCH_URL = 'https://www.zhihu.com/api/v4/search_v3';

const HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  Referer: 'https://www.zhihu.com/search',
  Accept: 'application/json, text/plain, */*',
  'x-requested-with': 'fetch',
};

interface ZhihuSearchItem {
  type?: string;
  object?: {
    id?: string | number;
    type?: string;
    title?: string;
    name?: string;
    url?: string;
    excerpt?: string;
    description?: string;
    voteup_count?: number;
    comment_count?: number;
    created_time?: number;
    created?: number;
    question?: { id?: string | number };
    author?: { name?: string } | string;
  };
  highlight?: {
    title?: string;
    description?: string;
  };
}

interface ZhihuResponse {
  data?: ZhihuSearchItem[];
}

/** Build the correct URL for a Zhihu object based on its type. */
export function buildZhihuUrl(objType: string, objId: string | number, questionId?: string | number): string | null {
  switch (objType) {
    case 'answer':
      return questionId
        ? `https://www.zhihu.com/question/${questionId}/answer/${objId}`
        : null;
    case 'article':
      return `https://zhuanlan.zhihu.com/p/${objId}`;
    case 'question':
      return `https://www.zhihu.com/question/${objId}`;
    case 'zvideo':
      return `https://www.zhihu.com/zvideo/${objId}`;
    default:
      return null;
  }
}

export class ZhihuSource extends BaseSource {
  readonly name = 'zhihu';
  readonly sourceType = 'browser' as const;
  readonly requiresAuth = true;
  override readonly installExtra = 'cn';

  enabled(_config: Config): boolean {
    try {
      return hasCookies('zhihu');
    } catch {
      return false;
    }
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const cookies = loadCookies('zhihu');
    if (cookies.length === 0) {
      throw new Error('zhihu: no cookies, please login: moleminer login zhihu');
    }

    const cookieHeader = cookiesToHeader(cookies, 'www.zhihu.com');
    if (!cookieHeader) {
      throw new Error('zhihu: invalid cookies format, please re-login: moleminer login zhihu');
    }

    const params = new URLSearchParams({
      gk_version: 'gz-gaokao',
      t: 'general',
      q: query,
      correction: '1',
      offset: '0',
      limit: '20',
      lc_idx: '0',
      show_all_topics: '0',
      search_source: 'Normal',
    });

    const url = `${SEARCH_URL}?${params.toString()}`;

    const resp = await fetchWithDefaults(url, {
      headers: { ...HEADERS, Cookie: cookieHeader },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`zhihu HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    let data: ZhihuResponse;
    try {
      data = (await resp.json()) as ZhihuResponse;
    } catch (e) {
      throw new Error(`zhihu: invalid JSON response: ${(e as Error).message}`);
    }

    // Legal empty result (HTTP 200 + empty data.data) → return []
    const results: SearchResult[] = [];
    for (const item of data.data ?? []) {
      const result = this.parseItem(item);
      if (result) results.push(result);
    }
    return results;
  }

  private parseItem(item: ZhihuSearchItem): SearchResult | null {
    const obj = item.object ?? {};

    // Extract title -- may contain HTML highlight tags
    let title = obj.title ?? obj.name ?? '';
    title = stripHtml(title);
    if (!title) return null;

    // Extract URL
    let url = obj.url ?? '';
    if (!url) {
      const objType = obj.type ?? '';
      const objId = obj.id ?? '';
      if (!objId) return null;

      const questionId = obj.question?.id;
      const built = buildZhihuUrl(objType, objId, questionId);
      if (!built) return null;
      url = built;
    }

    // Normalize api.zhihu.com URLs
    if (url.includes('api.zhihu.com')) {
      url = url.replace('api.zhihu.com', 'www.zhihu.com');
    }

    // Extract snippet
    let snippet = obj.excerpt ?? obj.description ?? '';
    snippet = stripHtml(snippet).slice(0, 300);

    // Author
    const authorObj = obj.author;
    const authorName =
      authorObj && typeof authorObj === 'object' ? authorObj.name ?? '' : '';

    // Timestamp
    const created = obj.created_time ?? obj.created;
    const timestamp =
      created && typeof created === 'number'
        ? new Date(created * 1000).toISOString()
        : undefined;

    return {
      title,
      url,
      source: 'zhihu',
      snippet,
      resultType: 'lead',
      language: 'zh',
      timestamp,
      metadata: {
        author: authorName,
        voteup_count: obj.voteup_count ?? 0,
        comment_count: obj.comment_count ?? 0,
        type: obj.type ?? '',
      },
    };
  }
}
