import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { WeiboSource, parseWeiboTime } from '../../src/sources/weibo.js';
import { Config } from '../../src/config.js';

// Mock cookies module to avoid dependency on disk state
vi.mock('../../src/utils/cookies.js', () => ({
  hasCookies: vi.fn(() => false),
  loadCookies: vi.fn(() => [{ name: 'SUBID', value: 'test_token', domain: '.weibo.cn' }]),
  cookiesToHeader: vi.fn(() => 'SUBID=test_token'),
}));

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('WeiboSource', () => {
  const source = new WeiboSource();

  it('has correct metadata', () => {
    expect(source.name).toBe('weibo');
    expect(source.sourceType).toBe('scrape');
    expect(source.requiresAuth).toBe(true);
    expect(source.enabled(new Config())).toBe(false); // mocked: no cookies
  });

  it('should return results for a successful search', async () => {
    server.use(
      http.get('https://m.weibo.cn/api/container/getIndex', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('containerid')).toContain('typescript');

        return HttpResponse.json({
          data: {
            cards: [
              {
                card_type: 9,
                mblog: {
                  id: '5000001',
                  mid: '5000001',
                  text: '<a href="#">TypeScript</a> is amazing for large projects',
                  user: {
                    id: 1234567,
                    screen_name: 'DevExpert',
                    verified: true,
                  },
                  created_at: '30分钟前',
                  reposts_count: 10,
                  comments_count: 25,
                  attitudes_count: 100,
                },
              },
              {
                card_type: 9,
                mblog: {
                  id: '5000002',
                  text: 'Learning <em>TypeScript</em> today',
                  user: {
                    id: 7654321,
                    screen_name: 'JSFan',
                    verified: false,
                  },
                  created_at: '2小时前',
                  reposts_count: 2,
                  comments_count: 5,
                  attitudes_count: 20,
                },
              },
            ],
          },
        });
      }),
    );

    const results = await source.search(['typescript']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('TypeScript is amazing for large projects');
    expect(results[0].url).toBe('https://weibo.com/1234567/5000001');
    expect(results[0].source).toBe('weibo');
    expect(results[0].resultType).toBe('lead');
    expect(results[0].language).toBe('zh');
    expect(results[0].snippet).not.toContain('<a');
    expect(results[0].metadata?.author).toBe('DevExpert');
    expect(results[0].metadata?.reposts).toBe(10);
    expect(results[0].metadata?.comments).toBe(25);
    expect(results[0].metadata?.likes).toBe(100);
    expect(results[0].metadata?.verified).toBe(true);

    expect(results[1].url).toBe('https://weibo.com/7654321/5000002');
    expect(results[1].metadata?.author).toBe('JSFan');
  });

  it('should handle card_type 11 (card groups)', async () => {
    server.use(
      http.get('https://m.weibo.cn/api/container/getIndex', () => {
        return HttpResponse.json({
          data: {
            cards: [
              {
                card_type: 11,
                card_group: [
                  {
                    card_type: 9,
                    mblog: {
                      id: '6000001',
                      text: 'Grouped post content',
                      user: { id: 111, screen_name: 'User1' },
                      created_at: '昨天 14:30',
                    },
                  },
                  {
                    card_type: 7,  // non-post card, should be skipped
                  },
                ],
              },
            ],
          },
        });
      }),
    );

    const results = await source.search(['test']);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Grouped post content');
  });

  it('should throw on HTTP error', async () => {
    server.use(
      http.get('https://m.weibo.cn/api/container/getIndex', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    await expect(source.search(['error'])).rejects.toThrow(/weibo HTTP 500/);
  });

  it('should skip posts without text', async () => {
    server.use(
      http.get('https://m.weibo.cn/api/container/getIndex', () => {
        return HttpResponse.json({
          data: {
            cards: [
              {
                card_type: 9,
                mblog: {
                  id: '7000001',
                  text: '',
                  user: { id: 999, screen_name: 'Empty' },
                },
              },
            ],
          },
        });
      }),
    );

    const results = await source.search(['empty']);
    expect(results).toHaveLength(0);
  });

  it('should use m.weibo.cn URL when user id is missing', async () => {
    server.use(
      http.get('https://m.weibo.cn/api/container/getIndex', () => {
        return HttpResponse.json({
          data: {
            cards: [
              {
                card_type: 9,
                mblog: {
                  id: '8000001',
                  text: 'Post without user info',
                },
              },
            ],
          },
        });
      }),
    );

    const results = await source.search(['no-user']);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://m.weibo.cn/detail/8000001');
  });

  it('should handle empty cards array', async () => {
    server.use(
      http.get('https://m.weibo.cn/api/container/getIndex', () => {
        return HttpResponse.json({ data: { cards: [] } });
      }),
    );

    const results = await source.search(['nothing']);
    expect(results).toHaveLength(0);
  });
});

describe('parseWeiboTime', () => {
  it('should parse "X分钟前" (minutes ago)', () => {
    const result = parseWeiboTime('30分钟前');
    expect(result).toBeDefined();
    const diff = Date.now() - new Date(result!).getTime();
    // Should be roughly 30 minutes ago (allow 5s tolerance)
    expect(diff).toBeGreaterThan(29 * 60_000);
    expect(diff).toBeLessThan(31 * 60_000);
  });

  it('should parse "X小时前" (hours ago)', () => {
    const result = parseWeiboTime('2小时前');
    expect(result).toBeDefined();
    const diff = Date.now() - new Date(result!).getTime();
    expect(diff).toBeGreaterThan(1.9 * 3_600_000);
    expect(diff).toBeLessThan(2.1 * 3_600_000);
  });

  it('should parse "昨天 HH:MM" (yesterday)', () => {
    const result = parseWeiboTime('昨天 14:30');
    expect(result).toBeDefined();
    const parsed = new Date(result!);
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('should parse "MM-DD" format (current year)', () => {
    const result = parseWeiboTime('03-15');
    expect(result).toBeDefined();
    const parsed = new Date(result!);
    expect(parsed.getMonth()).toBe(2); // March = 2 (0-indexed)
    expect(parsed.getDate()).toBe(15);
    expect(parsed.getFullYear()).toBe(new Date().getFullYear());
  });

  it('should return undefined for empty string', () => {
    expect(parseWeiboTime('')).toBeUndefined();
  });

  it('should parse Unix timestamp string', () => {
    const result = parseWeiboTime('1700000000');
    expect(result).toBeDefined();
    expect(new Date(result!).getTime()).toBe(1700000000 * 1000);
  });

  it('should parse standard date strings', () => {
    const result = parseWeiboTime('Wed Mar 12 10:30:00 +0800 2026');
    expect(result).toBeDefined();
    const parsed = new Date(result!);
    expect(parsed.getFullYear()).toBe(2026);
  });
});
