import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { WeChatSource } from '../../src/sources/wechat.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Build a fake Sogou WeChat search results page. */
function buildSogouHtml(items: Array<{
  id: number;
  title: string;
  url: string;
  snippet?: string;
  timestamp?: string;
}>): string {
  const lis = items
    .map(
      (item) => `
    <li id="sogou_vr_${item.id}_box_0" class="vrwrap">
      <div class="txt-box">
        <h3><a href="${item.url}">${item.title}</a></h3>
        <p class="txt-info">${item.snippet ?? ''}</p>
        ${item.timestamp ? `<script>document.write(timeConvert('${item.timestamp}'))</script>` : ''}
      </div>
    </li>`,
    )
    .join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div class="news-box"><ul>${lis}</ul></div>
</body></html>`;
}

describe('WeChatSource', () => {
  const source = new WeChatSource();

  it('should have correct properties', () => {
    expect(source.name).toBe('wechat');
    expect(source.sourceType).toBe('scrape');
    expect(source.requiresAuth).toBe(false);
  });

  it('should always be enabled', () => {
    const config = new Config();
    expect(source.enabled(config)).toBe(true);
  });

  it('should parse Sogou WeChat search results', async () => {
    const html = buildSogouHtml([
      {
        id: 1,
        title: 'TypeScript 入门指南',
        url: 'https://mp.weixin.qq.com/s/abc123',
        snippet: '本文介绍了 TypeScript 的基础知识和最佳实践。',
        timestamp: '1772548596',
      },
      {
        id: 2,
        title: 'React + TypeScript 实战',
        url: 'https://mp.weixin.qq.com/s/def456',
        snippet: '使用 TypeScript 构建 React 应用的完整指南。',
      },
    ]);

    server.use(
      http.get('https://weixin.sogou.com/weixin', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('type')).toBe('2');
        expect(url.searchParams.get('query')).toBe('typescript');
        expect(url.searchParams.get('ie')).toBe('utf8');
        return new HttpResponse(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }),
    );

    const results = await source.search(['typescript']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('TypeScript 入门指南');
    expect(results[0].url).toBe('https://mp.weixin.qq.com/s/abc123');
    expect(results[0].source).toBe('wechat');
    expect(results[0].snippet).toBe('本文介绍了 TypeScript 的基础知识和最佳实践。');
    expect(results[0].resultType).toBe('lead');
    expect(results[0].language).toBe('zh');
    expect(results[0].timestamp).toBe('1772548596');

    expect(results[1].title).toBe('React + TypeScript 实战');
    expect(results[1].timestamp).toBeUndefined();
  });

  it('should handle Sogou redirect URLs', () => {
    const html = `<!DOCTYPE html><html><body>
    <li id="sogou_vr_1_box_0">
      <div class="txt-box">
        <h3><a href="/link?url=someEncodedUrl">测试文章</a></h3>
        <p class="txt-info">测试摘要</p>
      </div>
    </li>
    </body></html>`;

    const results = source._parseHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://weixin.sogou.com/link?url=someEncodedUrl');
  });

  it('should throw on anti-spider detection', async () => {
    server.use(
      http.get('https://weixin.sogou.com/weixin', () => {
        return new HttpResponse(
          '<html><body>请输入验证码 /antispider/ detected</body></html>',
          { headers: { 'Content-Type': 'text/html' } },
        );
      }),
    );

    await expect(source.search(['test'])).rejects.toThrow(/antispider/);
  });

  it('should throw on fetch errors', async () => {
    server.use(
      http.get('https://weixin.sogou.com/weixin', () => {
        return new HttpResponse('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
      }),
    );

    await expect(source.search(['test'])).rejects.toThrow(/wechat: fetch failed/);
  });

  it('should handle empty results page', async () => {
    server.use(
      http.get('https://weixin.sogou.com/weixin', () => {
        return new HttpResponse(
          '<html><body><div class="news-box"><ul></ul></div></body></html>',
          { headers: { 'Content-Type': 'text/html' } },
        );
      }),
    );

    const results = await source.search(['nonexistent query']);
    expect(results).toHaveLength(0);
  });

  it('should fallback to div.txt-box when no sogou_vr items', () => {
    const html = `<!DOCTYPE html><html><body>
    <div class="txt-box">
      <h3><a href="https://mp.weixin.qq.com/s/xyz">备选标题</a></h3>
      <p class="txt-info">备选摘要</p>
    </div>
    </body></html>`;

    const results = source._parseHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('备选标题');
  });

  it('should decode HTML entities in title', () => {
    const html = `<!DOCTYPE html><html><body>
    <li id="sogou_vr_1_box_0">
      <h3><a href="https://mp.weixin.qq.com/s/test">TypeScript &amp; JavaScript &lt;3</a></h3>
      <p class="txt-info">Learn both!</p>
    </li>
    </body></html>`;

    const results = source._parseHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('TypeScript & JavaScript <3');
  });
});
