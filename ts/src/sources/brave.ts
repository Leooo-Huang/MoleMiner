/** Brave Search API source (requires API key). */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchJson } from '../utils/http.js';

const BRAVE_API = 'https://api.search.brave.com/res/v1/web/search';

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
  language?: string;
}

interface BraveResponse {
  web: {
    results: BraveResult[];
  };
}

export class BraveSource extends BaseSource {
  readonly name = 'brave';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = true;

  private apiKey?: string;

  enabled(config: Config): boolean {
    return config?.braveApiKey != null;
  }

  configure(config: Config): void {
    this.apiKey = config.braveApiKey;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    const params = new URLSearchParams({
      q: query,
      count: '20',
    });

    const data = await fetchJson<BraveResponse>(`${BRAVE_API}?${params}`, {
      headers: {
        'X-Subscription-Token': this.apiKey,
      },
    });

    const results = data?.web?.results ?? [];
    return results.map((item) => ({
      title: item.title ?? '',
      url: item.url ?? '',
      source: 'brave',
      snippet: item.description ?? '',
      resultType: 'direct' as const,
      timestamp: item.page_age,
      language: item.language,
    }));
  }
}
