import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { DevtoSource } from '../../src/sources/devto.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ARTICLES = [
  {
    title: 'Getting Started with TypeScript',
    url: 'https://dev.to/alice/getting-started-with-typescript-1abc',
    tag_list: ['typescript', 'javascript', 'webdev'],
    user: { username: 'alice' },
    positive_reactions_count: 42,
    comments_count: 7,
    published_at: '2026-03-01T12:00:00Z',
  },
  {
    title: 'Advanced TypeScript Patterns',
    url: 'https://dev.to/bob/advanced-typescript-patterns-2def',
    tag_list: ['typescript', 'patterns'],
    user: { username: 'bob' },
    positive_reactions_count: 128,
    comments_count: 15,
    published_at: '2026-03-10T08:30:00Z',
  },
];

describe('DevtoSource', () => {
  const source = new DevtoSource();

  it('should have correct properties', () => {
    expect(source.name).toBe('devto');
    expect(source.sourceType).toBe('api');
    expect(source.requiresAuth).toBe(false);
  });

  it('should always be enabled', () => {
    const config = new Config();
    expect(source.enabled(config)).toBe(true);
  });

  it('should search successfully and parse results', async () => {
    server.use(
      http.get('https://dev.to/api/articles', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('tag')).toBe('typescript');
        expect(url.searchParams.get('per_page')).toBe('20');
        expect(url.searchParams.get('page')).toBe('1');
        return HttpResponse.json(ARTICLES);
      }),
    );

    const results = await source.search(['typescript best practices']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('Getting Started with TypeScript');
    expect(results[0].url).toBe('https://dev.to/alice/getting-started-with-typescript-1abc');
    expect(results[0].source).toBe('devto');
    expect(results[0].resultType).toBe('direct');
    expect(results[0].timestamp).toBe('2026-03-01T12:00:00Z');
    expect(results[0].snippet).toContain('by alice');
    expect(results[0].snippet).toContain('Tags: typescript, javascript, webdev');
    expect(results[0].snippet).toContain('Reactions: 42');
    expect(results[0].metadata).toEqual({
      reactions: 42,
      comments: 7,
      tags: ['typescript', 'javascript', 'webdev'],
      username: 'alice',
    });

    expect(results[1].title).toBe('Advanced TypeScript Patterns');
    expect(results[1].metadata?.reactions).toBe(128);
  });

  it('should extract tag from first word of query', async () => {
    let capturedTag = '';
    server.use(
      http.get('https://dev.to/api/articles', ({ request }) => {
        const url = new URL(request.url);
        capturedTag = url.searchParams.get('tag') ?? '';
        return HttpResponse.json([]);
      }),
    );

    await source.search(['react hooks tutorial']);
    expect(capturedTag).toBe('react');
  });

  it('should handle API errors gracefully', async () => {
    server.use(
      http.get('https://dev.to/api/articles', () => {
        return new HttpResponse('Server Error', { status: 500, statusText: 'Internal Server Error' });
      }),
    );

    const results = await source.search(['typescript']);
    expect(results).toHaveLength(0);
  });

  it('should handle non-array response', async () => {
    server.use(
      http.get('https://dev.to/api/articles', () => {
        return HttpResponse.json({ error: 'invalid' });
      }),
    );

    const results = await source.search(['typescript']);
    expect(results).toHaveLength(0);
  });

  it('should handle multiple queries', async () => {
    let callCount = 0;
    server.use(
      http.get('https://dev.to/api/articles', () => {
        callCount++;
        return HttpResponse.json([ARTICLES[0]]);
      }),
    );

    const results = await source.search(['typescript', 'javascript']);
    expect(callCount).toBe(2);
    expect(results).toHaveLength(2);
  });
});
