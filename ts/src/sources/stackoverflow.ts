/** Stack Overflow search via StackExchange API (free, no auth needed). */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchJson } from '../utils/http.js';

const SO_API = 'https://api.stackexchange.com/2.3/search';

interface SOItem {
  title?: string;
  link?: string;
  tags?: string[];
  score?: number;
  answer_count?: number;
  is_answered?: boolean;
}

interface SOResponse {
  items: SOItem[];
}

export class StackOverflowSource extends BaseSource {
  readonly name = 'stackoverflow';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  enabled(_config: Config): boolean {
    return true;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      intitle: query,
      site: 'stackoverflow',
      sort: 'relevance',
      pagesize: '20',
    });

    const data = await fetchJson<SOResponse>(`${SO_API}?${params}`);

    return (data.items ?? []).map((item) => {
      const tags = item.tags ?? [];
      const score = item.score ?? 0;
      const answerCount = item.answer_count ?? 0;
      const isAnswered = item.is_answered ?? false;

      const snippetParts: string[] = [];
      if (tags.length > 0) {
        snippetParts.push(`Tags: ${tags.join(', ')}`);
      }
      snippetParts.push(`Score: ${score}`);
      snippetParts.push(`Answers: ${answerCount}`);
      if (isAnswered) {
        snippetParts.push('(answered)');
      }

      return {
        title: item.title ?? '',
        url: item.link ?? '',
        source: 'stackoverflow',
        snippet: snippetParts.join(' | '),
        resultType: 'direct' as const,
        metadata: {
          score,
          answer_count: answerCount,
          is_answered: isAnswered,
          tags,
        },
      };
    });
  }
}
