import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RedditSource } from '../../src/sources/reddit.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('RedditSource', () => {
  const source = new RedditSource();

  it('has correct metadata', () => {
    expect(source.name).toBe('reddit');
    expect(source.sourceType).toBe('api');
    expect(source.requiresAuth).toBe(false);
    expect(source.enabled(new Config())).toBe(true);
  });

  it('should return results for a successful search', async () => {
    server.use(
      http.get('https://www.reddit.com/search/.json', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('rust programming');
        expect(url.searchParams.get('sort')).toBe('new');
        expect(url.searchParams.get('t')).toBe('year');
        expect(url.searchParams.get('limit')).toBe('20');
        expect(url.searchParams.get('raw_json')).toBe('1');

        // Verify custom User-Agent
        expect(request.headers.get('user-agent')).toContain('MoleMiner');

        return HttpResponse.json({
          data: {
            children: [
              {
                data: {
                  title: 'Rust vs Go for CLI tools',
                  permalink: '/r/rust/comments/abc123/rust_vs_go/',
                  selftext: 'I have been comparing Rust and Go for building CLI tools...',
                  subreddit: 'rust',
                  score: 234,
                  num_comments: 89,
                  created_utc: 1710000000,
                },
              },
              {
                data: {
                  title: 'New Rust release',
                  permalink: '/r/programming/comments/def456/new_rust/',
                  selftext: 'The latest Rust release brings exciting features...',
                  subreddit: 'programming',
                  score: 567,
                  num_comments: 123,
                  created_utc: 1710100000,
                },
              },
            ],
          },
        });
      }),
    );

    const results = await source.search(['rust programming']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('Rust vs Go for CLI tools');
    expect(results[0].url).toBe('https://www.reddit.com/r/rust/comments/abc123/rust_vs_go/');
    expect(results[0].source).toBe('reddit');
    expect(results[0].resultType).toBe('lead');
    expect(results[0].snippet).toBe('I have been comparing Rust and Go for building CLI tools...');
    expect(results[0].metadata?.subreddit).toBe('rust');
    expect(results[0].metadata?.score).toBe(234);
    expect(results[0].metadata?.num_comments).toBe(89);
  });

  it('should return empty array for empty data', async () => {
    server.use(
      http.get('https://www.reddit.com/search/.json', () => {
        return HttpResponse.json({
          data: {
            children: [],
          },
        });
      }),
    );

    const results = await source.search(['nonexistent-query-xyz']);
    expect(results).toHaveLength(0);
  });
});
