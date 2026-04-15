/**
 * X (Twitter) source via twitter-cli reverse-engineered API.
 *
 * Requires: uv tool install twitter-cli (or pipx install twitter-cli)
 * Auth: browser cookie extraction (auto-detects Chrome/Firefox/Edge) or env vars.
 * No API key needed.
 */

import { BaseSource } from './base.js';
import { commandExists, execCommand } from '../utils/subprocess.js';
import { hasCookies, loadCookies } from '../utils/cookies.js';
import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';

interface TwitterAuthor {
  name?: string;
  screenName?: string;
  verified?: boolean;
}

interface TwitterMetrics {
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
}

interface TwitterTweet {
  id?: string;
  text?: string;
  createdAtISO?: string;
  author?: TwitterAuthor;
  metrics?: TwitterMetrics;
  urls?: string[];
  lang?: string;
}

interface TwitterResponse {
  ok?: boolean;
  data?: TwitterTweet[];
  error?: { code?: string; message?: string };
}

export class XSource extends BaseSource {
  readonly name = 'x';
  readonly sourceType = 'scrape' as const;
  readonly requiresAuth = true;

  enabled(_config: Config): boolean {
    return commandExists('twitter') && hasCookies('x');
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const cookies = loadCookies('x');
    const authToken = cookies.find((c) => c.name === 'auth_token')?.value;
    const ct0 = cookies.find((c) => c.name === 'ct0')?.value;
    if (!authToken || !ct0) return [];

    // Pass auth cookies as env vars — bypasses twitter-cli's browser cookie extraction
    const stdout = execCommand(
      'twitter',
      ['search', query, '--json', '--max', '20', '-t', 'Latest'],
      { timeout: 20_000, env: { TWITTER_AUTH_TOKEN: authToken, TWITTER_CT0: ct0 } },
    );

    if (!stdout) return [];

    let response: TwitterResponse;
    try {
      response = JSON.parse(stdout) as TwitterResponse;
    } catch {
      return [];
    }

    if (!response.ok || !response.data) return [];

    const results: SearchResult[] = [];
    for (const tweet of response.data) {
      const result = this.parseTweet(tweet);
      if (result) results.push(result);
    }
    return results;
  }

  private parseTweet(tweet: TwitterTweet): SearchResult | null {
    if (!tweet.id || !tweet.text) return null;

    const screenName = tweet.author?.screenName ?? 'unknown';
    const displayName = tweet.author?.name ?? screenName;

    return {
      title: tweet.text.slice(0, 100),
      url: `https://x.com/${screenName}/status/${tweet.id}`,
      source: 'x',
      snippet: tweet.text,
      resultType: 'lead',
      language: tweet.lang,
      timestamp: tweet.createdAtISO,
      metadata: {
        author: displayName,
        screenName,
        likes: tweet.metrics?.likes ?? 0,
        retweets: tweet.metrics?.retweets ?? 0,
        replies: tweet.metrics?.replies ?? 0,
        views: tweet.metrics?.views ?? 0,
        verified: tweet.author?.verified ?? false,
      },
    };
  }
}
