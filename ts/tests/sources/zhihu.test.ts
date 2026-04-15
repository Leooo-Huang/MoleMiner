import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ZhihuSource, buildZhihuUrl } from '../../src/sources/zhihu.js';
import { Config } from '../../src/config.js';

// Mock the cookies module so we don't need real cookie files
vi.mock('../../src/utils/cookies.js', () => ({
  hasCookies: vi.fn(() => true),
  loadCookies: vi.fn(() => [
    { name: 'z_c0', value: 'test-token', domain: '.zhihu.com' },
    { name: '_xsrf', value: 'abc123', domain: '.zhihu.com' },
  ]),
  cookiesToHeader: vi.fn(() => 'z_c0=test-token; _xsrf=abc123'),
}));

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('ZhihuSource', () => {
  const source = new ZhihuSource();

  it('has correct metadata', () => {
    expect(source.name).toBe('zhihu');
    expect(source.sourceType).toBe('browser');
    expect(source.requiresAuth).toBe(true);
    expect(source.installExtra).toBe('cn');
  });

  it('should be enabled when cookies exist', () => {
    expect(source.enabled(new Config())).toBe(true);
  });

  it('should return results for a successful search', async () => {
    server.use(
      http.get('https://www.zhihu.com/api/v4/search_v3', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('typescript');
        expect(url.searchParams.get('t')).toBe('general');
        expect(url.searchParams.get('limit')).toBe('20');

        return HttpResponse.json({
          data: [
            {
              type: 'search_result',
              object: {
                id: '12345',
                type: 'answer',
                title: '<em>TypeScript</em> Best Practices',
                excerpt: 'Here are some tips for writing better TypeScript code...',
                url: '',
                question: { id: '67890' },
                author: { name: 'TSExpert' },
                voteup_count: 500,
                comment_count: 42,
                created_time: 1700000000,
              },
            },
            {
              type: 'search_result',
              object: {
                id: '99999',
                type: 'article',
                title: 'Advanced TypeScript Patterns',
                excerpt: 'Deep dive into advanced TypeScript patterns...',
                author: { name: 'ArticleWriter' },
                voteup_count: 200,
                comment_count: 15,
                created_time: 1699000000,
              },
            },
            {
              type: 'search_result',
              object: {
                id: '55555',
                type: 'question',
                title: 'How to learn TypeScript?',
                excerpt: 'What resources do you recommend...',
                author: { name: 'Beginner' },
                voteup_count: 100,
                comment_count: 30,
              },
            },
          ],
        });
      }),
    );

    const results = await source.search(['typescript']);
    expect(results).toHaveLength(3);

    // Answer type
    expect(results[0].title).toBe('TypeScript Best Practices');
    expect(results[0].url).toBe('https://www.zhihu.com/question/67890/answer/12345');
    expect(results[0].source).toBe('zhihu');
    expect(results[0].resultType).toBe('lead');
    expect(results[0].language).toBe('zh');
    expect(results[0].metadata?.author).toBe('TSExpert');
    expect(results[0].metadata?.voteup_count).toBe(500);
    expect(results[0].metadata?.type).toBe('answer');
    expect(results[0].timestamp).toBeDefined();

    // Article type
    expect(results[1].url).toBe('https://zhuanlan.zhihu.com/p/99999');
    expect(results[1].metadata?.type).toBe('article');

    // Question type
    expect(results[2].url).toBe('https://www.zhihu.com/question/55555');
    expect(results[2].metadata?.type).toBe('question');
  });

  it('should normalize api.zhihu.com URLs', async () => {
    server.use(
      http.get('https://www.zhihu.com/api/v4/search_v3', () => {
        return HttpResponse.json({
          data: [
            {
              type: 'search_result',
              object: {
                id: '11111',
                type: 'answer',
                title: 'Test Answer',
                url: 'https://api.zhihu.com/question/22222/answer/11111',
                author: { name: 'Someone' },
              },
            },
          ],
        });
      }),
    );

    const results = await source.search(['test']);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://www.zhihu.com/question/22222/answer/11111');
  });

  it('should throw on HTTP error', async () => {
    server.use(
      http.get('https://www.zhihu.com/api/v4/search_v3', () => {
        return new HttpResponse(null, { status: 403 });
      }),
    );

    await expect(source.search(['error'])).rejects.toThrow(/zhihu HTTP 403/);
  });

  it('should skip items without title', async () => {
    server.use(
      http.get('https://www.zhihu.com/api/v4/search_v3', () => {
        return HttpResponse.json({
          data: [
            {
              type: 'search_result',
              object: {
                id: '33333',
                type: 'answer',
                title: '',
                question: { id: '44444' },
              },
            },
          ],
        });
      }),
    );

    const results = await source.search(['no-title']);
    expect(results).toHaveLength(0);
  });

  it('should handle empty data array', async () => {
    server.use(
      http.get('https://www.zhihu.com/api/v4/search_v3', () => {
        return HttpResponse.json({ data: [] });
      }),
    );

    const results = await source.search(['empty']);
    expect(results).toHaveLength(0);
  });
});

describe('buildZhihuUrl', () => {
  it('should build answer URL with question ID', () => {
    expect(buildZhihuUrl('answer', '123', '456')).toBe(
      'https://www.zhihu.com/question/456/answer/123',
    );
  });

  it('should return null for answer without question ID', () => {
    expect(buildZhihuUrl('answer', '123')).toBeNull();
  });

  it('should build article URL', () => {
    expect(buildZhihuUrl('article', '789')).toBe(
      'https://zhuanlan.zhihu.com/p/789',
    );
  });

  it('should build question URL', () => {
    expect(buildZhihuUrl('question', '101')).toBe(
      'https://www.zhihu.com/question/101',
    );
  });

  it('should build zvideo URL', () => {
    expect(buildZhihuUrl('zvideo', '202')).toBe(
      'https://www.zhihu.com/zvideo/202',
    );
  });

  it('should return null for unknown type', () => {
    expect(buildZhihuUrl('unknown', '999')).toBeNull();
  });
});
