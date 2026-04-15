/** YouTube search via HTML scraping (no API key needed). */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchText, BROWSER_UA } from '../utils/http.js';

const YOUTUBE_SEARCH_URL = 'https://www.youtube.com/results';

const BROWSER_HEADERS = {
  'User-Agent': BROWSER_UA,
  'Accept-Language': 'en',
};

interface VideoRenderer {
  videoId?: string;
  title?: { runs?: { text?: string }[] };
  descriptionSnippet?: { runs?: { text?: string }[] };
  publishedTimeText?: { simpleText?: string };
  viewCountText?: { simpleText?: string };
  lengthText?: { simpleText?: string };
  ownerText?: { runs?: { text?: string }[] };
}

export class YouTubeSource extends BaseSource {
  readonly name = 'youtube';
  readonly sourceType = 'scrape' as const;
  readonly requiresAuth = false;

  enabled(_config: Config): boolean {
    return true;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ search_query: query });
    const url = `${YOUTUBE_SEARCH_URL}?${params}`;

    let html: string;
    try {
      html = await fetchText(url, { headers: BROWSER_HEADERS });
    } catch {
      return [];
    }

    return this._parseHtml(html);
  }

  /** Extract ytInitialData JSON from the HTML and parse video results. */
  _parseHtml(html: string): SearchResult[] {
    const match = html.match(/var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!match) return [];

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(match[1]);
    } catch {
      return [];
    }

    const contents = this._navigateToContents(data);
    if (!contents || !Array.isArray(contents)) return [];

    const results: SearchResult[] = [];
    for (const item of contents) {
      const renderer = (item as Record<string, unknown>).videoRenderer as VideoRenderer | undefined;
      if (!renderer || !renderer.videoId) continue;

      const title = renderer.title?.runs?.[0]?.text ?? '';
      const videoId = renderer.videoId;
      const snippet = renderer.descriptionSnippet?.runs?.map((r) => r.text ?? '').join('') ?? '';
      const channel = renderer.ownerText?.runs?.[0]?.text ?? '';
      const publishedTime = renderer.publishedTimeText?.simpleText ?? '';
      const viewCount = renderer.viewCountText?.simpleText ?? '';
      const duration = renderer.lengthText?.simpleText ?? '';

      results.push({
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: 'youtube',
        snippet,
        resultType: 'direct',
        metadata: {
          channel,
          publishedTime,
          viewCount,
          duration,
        },
      });
    }

    return results;
  }

  /** Navigate the ytInitialData structure to reach video items. */
  private _navigateToContents(data: Record<string, unknown>): unknown[] | null {
    try {
      const contents = data.contents as Record<string, unknown>;
      const twoCol = contents.twoColumnSearchResultsRenderer as Record<string, unknown>;
      const primary = twoCol.primaryContents as Record<string, unknown>;
      const sectionList = primary.sectionListRenderer as Record<string, unknown>;
      const sections = sectionList.contents as Record<string, unknown>[];
      const itemSection = sections[0].itemSectionRenderer as Record<string, unknown>;
      return itemSection.contents as unknown[];
    } catch {
      return null;
    }
  }
}
