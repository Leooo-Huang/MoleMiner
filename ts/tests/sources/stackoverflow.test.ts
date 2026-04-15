import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StackOverflowSource } from '../../src/sources/stackoverflow.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('StackOverflowSource', () => {
  const source = new StackOverflowSource();

  it('has correct metadata', () => {
    expect(source.name).toBe('stackoverflow');
    expect(source.sourceType).toBe('api');
    expect(source.requiresAuth).toBe(false);
    expect(source.enabled(new Config())).toBe(true);
  });

  it('should return results for a successful search', async () => {
    server.use(
      http.get('https://api.stackexchange.com/2.3/search', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('intitle')).toBe('async await');
        expect(url.searchParams.get('site')).toBe('stackoverflow');
        expect(url.searchParams.get('sort')).toBe('relevance');
        expect(url.searchParams.get('pagesize')).toBe('20');

        return HttpResponse.json({
          items: [
            {
              title: 'How to use async/await in JavaScript?',
              link: 'https://stackoverflow.com/questions/123/how-to-use-async-await',
              tags: ['javascript', 'async-await', 'promises'],
              score: 150,
              answer_count: 5,
              is_answered: true,
            },
            {
              title: 'Async await not working',
              link: 'https://stackoverflow.com/questions/456/async-await-not-working',
              tags: ['typescript', 'async-await'],
              score: 30,
              answer_count: 2,
              is_answered: false,
            },
          ],
        });
      }),
    );

    const results = await source.search(['async await']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('How to use async/await in JavaScript?');
    expect(results[0].url).toBe('https://stackoverflow.com/questions/123/how-to-use-async-await');
    expect(results[0].source).toBe('stackoverflow');
    expect(results[0].snippet).toBe('Tags: javascript, async-await, promises | Score: 150 | Answers: 5 | (answered)');
    expect(results[0].metadata?.score).toBe(150);
    expect(results[0].metadata?.answer_count).toBe(5);
    expect(results[0].metadata?.is_answered).toBe(true);
    expect(results[0].metadata?.tags).toEqual(['javascript', 'async-await', 'promises']);

    // Second result: not answered — no "(answered)" suffix
    expect(results[1].snippet).toBe('Tags: typescript, async-await | Score: 30 | Answers: 2');
  });

  it('should return empty array for empty items', async () => {
    server.use(
      http.get('https://api.stackexchange.com/2.3/search', () => {
        return HttpResponse.json({ items: [] });
      }),
    );

    const results = await source.search(['nonexistent-xyz-query']);
    expect(results).toHaveLength(0);
  });
});
