/** Hacker News search via Algolia API (free, no key needed). */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchJson } from '../utils/http.js';

const HN_API = 'https://hn.algolia.com/api/v1/search';
const HN_ITEM_URL = 'https://news.ycombinator.com/item?id=';

interface HNHit {
  objectID: string;
  title?: string;
  url?: string;
  created_at?: string;
  points?: number;
  num_comments?: number;
  author?: string;
}

interface HNResponse {
  hits: HNHit[];
}

export class HackerNewsSource extends BaseSource {
  readonly name = 'hackernews';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  enabled(_config: Config): boolean {
    return true;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      query,
      tags: 'story',
      hitsPerPage: '20',
    });
    const data = await fetchJson<HNResponse>(`${HN_API}?${params}`);

    return (data.hits ?? []).map((hit) => ({
      title: hit.title ?? '',
      url: hit.url || `${HN_ITEM_URL}${hit.objectID}`,
      source: 'hackernews',
      snippet: hit.title ?? '',
      resultType: 'lead' as const,
      timestamp: hit.created_at,
      metadata: {
        points: hit.points ?? 0,
        num_comments: hit.num_comments ?? 0,
        hn_id: hit.objectID,
        author: hit.author,
      },
    }));
  }
}
