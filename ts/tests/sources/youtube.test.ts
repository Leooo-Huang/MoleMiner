import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { YouTubeSource } from '../../src/sources/youtube.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Build a fake YouTube HTML page with embedded ytInitialData. */
function buildYouTubeHtml(videos: Array<{
  videoId: string;
  title: string;
  description?: string;
  channel?: string;
  publishedTime?: string;
  viewCount?: string;
  duration?: string;
}>): string {
  const videoRenderers = videos.map((v) => ({
    videoRenderer: {
      videoId: v.videoId,
      title: { runs: [{ text: v.title }] },
      descriptionSnippet: v.description ? { runs: [{ text: v.description }] } : undefined,
      ownerText: v.channel ? { runs: [{ text: v.channel }] } : undefined,
      publishedTimeText: v.publishedTime ? { simpleText: v.publishedTime } : undefined,
      viewCountText: v.viewCount ? { simpleText: v.viewCount } : undefined,
      lengthText: v.duration ? { simpleText: v.duration } : undefined,
    },
  }));

  const ytInitialData = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: videoRenderers,
                },
              },
            ],
          },
        },
      },
    },
  };

  return `<!DOCTYPE html><html><head></head><body>
<script nonce="abc123">var ytInitialData = ${JSON.stringify(ytInitialData)};</script>
</body></html>`;
}

describe('YouTubeSource', () => {
  const source = new YouTubeSource();

  it('should have correct properties', () => {
    expect(source.name).toBe('youtube');
    expect(source.sourceType).toBe('scrape');
    expect(source.requiresAuth).toBe(false);
  });

  it('should always be enabled', () => {
    const config = new Config();
    expect(source.enabled(config)).toBe(true);
  });

  it('should parse YouTube search results from HTML', async () => {
    const html = buildYouTubeHtml([
      {
        videoId: 'abc123',
        title: 'Learn TypeScript in 10 Minutes',
        description: 'A quick intro to TypeScript',
        channel: 'CodeChannel',
        publishedTime: '2 months ago',
        viewCount: '1,234,567 views',
        duration: '10:32',
      },
      {
        videoId: 'def456',
        title: 'TypeScript Advanced Tips',
        description: 'Pro tips for TS developers',
        channel: 'DevPro',
        publishedTime: '1 week ago',
        viewCount: '456,789 views',
        duration: '25:10',
      },
    ]);

    server.use(
      http.get('https://www.youtube.com/results', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('search_query')).toBe('typescript tutorial');
        return new HttpResponse(html, {
          headers: { 'Content-Type': 'text/html' },
        });
      }),
    );

    const results = await source.search(['typescript tutorial']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('Learn TypeScript in 10 Minutes');
    expect(results[0].url).toBe('https://www.youtube.com/watch?v=abc123');
    expect(results[0].source).toBe('youtube');
    expect(results[0].snippet).toBe('A quick intro to TypeScript');
    expect(results[0].resultType).toBe('direct');
    expect(results[0].metadata).toEqual({
      channel: 'CodeChannel',
      publishedTime: '2 months ago',
      viewCount: '1,234,567 views',
      duration: '10:32',
    });

    expect(results[1].title).toBe('TypeScript Advanced Tips');
    expect(results[1].url).toBe('https://www.youtube.com/watch?v=def456');
  });

  it('should handle HTML without ytInitialData', async () => {
    server.use(
      http.get('https://www.youtube.com/results', () => {
        return new HttpResponse('<html><body>No data</body></html>', {
          headers: { 'Content-Type': 'text/html' },
        });
      }),
    );

    const results = await source.search(['test query']);
    expect(results).toHaveLength(0);
  });

  it('should skip non-video items in results', () => {
    // Items without videoRenderer should be skipped
    const ytInitialData = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      { shelfRenderer: { title: 'Some shelf' } },
                      {
                        videoRenderer: {
                          videoId: 'xyz789',
                          title: { runs: [{ text: 'Real Video' }] },
                        },
                      },
                      { adSlotRenderer: {} },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };

    const html = `<html><body><script>var ytInitialData = ${JSON.stringify(ytInitialData)};</script></body></html>`;
    const results = source._parseHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Real Video');
  });

  it('should handle fetch errors gracefully', async () => {
    server.use(
      http.get('https://www.youtube.com/results', () => {
        return new HttpResponse('Forbidden', { status: 403, statusText: 'Forbidden' });
      }),
    );

    const results = await source.search(['test']);
    expect(results).toHaveLength(0);
  });
});
