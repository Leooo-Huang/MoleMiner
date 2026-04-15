import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { HackerNewsSource } from '../../src/sources/hackernews.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('HackerNewsSource', () => {
  const source = new HackerNewsSource();

  it('has correct metadata', () => {
    expect(source.name).toBe('hackernews');
    expect(source.sourceType).toBe('api');
    expect(source.requiresAuth).toBe(false);
    expect(source.enabled(new Config())).toBe(true);
  });

  it('should return results for a successful search', async () => {
    server.use(
      http.get('https://hn.algolia.com/api/v1/search', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('query')).toBe('typescript');
        expect(url.searchParams.get('tags')).toBe('story');
        expect(url.searchParams.get('hitsPerPage')).toBe('20');

        return HttpResponse.json({
          hits: [
            {
              objectID: '12345',
              title: 'TypeScript is Great',
              url: 'https://example.com/ts-great',
              created_at: '2026-01-15T10:00:00Z',
              points: 150,
              num_comments: 42,
              author: 'devuser',
            },
            {
              objectID: '67890',
              title: 'Why TypeScript',
              url: 'https://example.com/why-ts',
              created_at: '2026-01-10T08:00:00Z',
              points: 80,
              num_comments: 15,
              author: 'coder123',
            },
          ],
        });
      }),
    );

    const results = await source.search(['typescript']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('TypeScript is Great');
    expect(results[0].url).toBe('https://example.com/ts-great');
    expect(results[0].source).toBe('hackernews');
    expect(results[0].resultType).toBe('lead');
    expect(results[0].timestamp).toBe('2026-01-15T10:00:00Z');
    expect(results[0].metadata?.points).toBe(150);
    expect(results[0].metadata?.num_comments).toBe(42);
    expect(results[0].metadata?.author).toBe('devuser');
    expect(results[0].metadata?.hn_id).toBe('12345');
  });

  it('should return empty array for no results', async () => {
    server.use(
      http.get('https://hn.algolia.com/api/v1/search', () => {
        return HttpResponse.json({ hits: [] });
      }),
    );

    const results = await source.search(['nonexistent-query-xyz']);
    expect(results).toHaveLength(0);
  });

  it('should use HN item URL when url field is missing', async () => {
    server.use(
      http.get('https://hn.algolia.com/api/v1/search', () => {
        return HttpResponse.json({
          hits: [
            {
              objectID: '99999',
              title: 'Ask HN: Something',
              created_at: '2026-02-01T12:00:00Z',
              points: 25,
              num_comments: 10,
              author: 'asker',
            },
          ],
        });
      }),
    );

    const results = await source.search(['ask hn']);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://news.ycombinator.com/item?id=99999');
    expect(results[0].title).toBe('Ask HN: Something');
  });
});
