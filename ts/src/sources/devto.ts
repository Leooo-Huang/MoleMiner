/** Dev.to article search via public Forem API (free, no auth needed). */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchJson } from '../utils/http.js';

const DEVTO_API = 'https://dev.to/api/articles';

interface DevtoArticle {
  title?: string;
  url?: string;
  tag_list?: string[];
  user?: { username?: string };
  positive_reactions_count?: number;
  comments_count?: number;
  published_at?: string;
}

export class DevtoSource extends BaseSource {
  readonly name = 'devto';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  enabled(_config: Config): boolean {
    return true;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const tag = query.trim() ? query.split(/\s+/)[0].toLowerCase() : query;
    const params = new URLSearchParams({
      per_page: '20',
      page: '1',
      tag,
    });

    let data: DevtoArticle[];
    try {
      data = await fetchJson<DevtoArticle[]>(`${DEVTO_API}?${params}`);
    } catch {
      return [];
    }

    if (!Array.isArray(data)) return [];

    return data.map((item) => {
      const username = item.user?.username ?? '';
      const tagList = item.tag_list ?? [];
      const reactions = item.positive_reactions_count ?? 0;
      const comments = item.comments_count ?? 0;

      const snippetParts: string[] = [];
      if (username) snippetParts.push(`by ${username}`);
      if (tagList.length > 0) snippetParts.push(`Tags: ${tagList.join(', ')}`);
      snippetParts.push(`Reactions: ${reactions}`);

      return {
        title: item.title ?? '',
        url: item.url ?? '',
        source: 'devto',
        snippet: snippetParts.join(' | '),
        resultType: 'direct' as const,
        timestamp: item.published_at,
        metadata: {
          reactions,
          comments,
          tags: tagList,
          username,
        },
      };
    });
  }
}
