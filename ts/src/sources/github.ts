/** GitHub repository search via GitHub REST API (free, optional auth). */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchJson } from '../utils/http.js';

const GITHUB_API = 'https://api.github.com/search/repositories';

interface GitHubRepo {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  topics?: string[];
  homepage?: string | null;
}

interface GitHubResponse {
  items: GitHubRepo[];
}

export class GitHubSource extends BaseSource {
  readonly name = 'github';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  private token?: string;

  enabled(_config: Config): boolean {
    return true;
  }

  configure(config: Config): void {
    this.token = config.githubToken;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      sort: 'stars',
      per_page: '20',
    });

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const data = await fetchJson<GitHubResponse>(`${GITHUB_API}?${params}`, { headers });

    return (data.items ?? []).map((item) => {
      const hasHomepage = Boolean(item.homepage);
      return {
        title: item.full_name ?? '',
        url: item.html_url ?? '',
        source: 'github',
        snippet: item.description ?? '',
        resultType: (hasHomepage ? 'direct' : 'lead') as 'direct' | 'lead',
        language: item.language ?? undefined,
        metadata: {
          stars: item.stargazers_count ?? 0,
          language: item.language,
          topics: item.topics ?? [],
        },
      };
    });
  }
}
