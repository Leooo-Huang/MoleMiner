/** Reddit source via public JSON endpoint (no auth required). */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchJson } from '../utils/http.js';

const SEARCH_URL = 'https://www.reddit.com/search/.json';

interface RedditPost {
  data: {
    title?: string;
    permalink?: string;
    selftext?: string;
    subreddit?: string;
    score?: number;
    num_comments?: number;
    created_utc?: number;
  };
}

interface RedditResponse {
  data: {
    children: RedditPost[];
  };
}

export class RedditSource extends BaseSource {
  readonly name = 'reddit';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  enabled(_config: Config): boolean {
    return true;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      sort: 'new',
      t: 'year',
      limit: '20',
      raw_json: '1',
    });

    const data = await fetchJson<RedditResponse>(`${SEARCH_URL}?${params}`, {
      headers: {
        'User-Agent': 'MoleMiner/0.3 (Multi-source search CLI)',
        Accept: 'application/json',
      },
    });

    const children = data?.data?.children ?? [];
    return children.map((post) => {
      const d = post.data;
      const permalink = d.permalink ?? '';
      const url = permalink ? `https://www.reddit.com${permalink}` : '';

      return {
        title: d.title ?? '',
        url,
        source: 'reddit',
        snippet: (d.selftext ?? '').slice(0, 300),
        resultType: 'lead' as const,
        timestamp: d.created_utc ? String(Math.floor(d.created_utc)) : undefined,
        metadata: {
          subreddit: d.subreddit ?? '',
          score: d.score ?? 0,
          num_comments: d.num_comments ?? 0,
        },
      };
    });
  }
}
