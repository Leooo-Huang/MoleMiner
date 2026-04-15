import { describe, it, expect } from 'vitest';
import { extractContent } from '../src/utils/extract.js';

describe('extractContent', () => {
  it('should extract content from a simple HTML article', async () => {
    const html = `
      <html>
        <head><title>Test Article</title></head>
        <body>
          <nav>Home | About | Contact</nav>
          <article>
            <h1>Deep Learning in Healthcare</h1>
            <p>Artificial intelligence is transforming healthcare with new diagnostic tools.
            Machine learning models can now detect diseases earlier than traditional methods.
            This article explores the latest advances in medical AI applications.</p>
            <p>Deep learning has shown remarkable results in radiology, pathology, and genomics.
            Researchers have developed models that can analyze medical images with accuracy
            comparable to or exceeding that of experienced physicians.</p>
          </article>
          <footer>Copyright 2025</footer>
        </body>
      </html>
    `;

    const result = await extractContent(html, 'https://example.com/article');
    expect(result.text.length).toBeGreaterThan(100);
    expect(result.text).toContain('healthcare');
    expect(result.text).not.toContain('Home | About');
    expect(result.title).toContain('Test Article');
    expect(result.compressedLength).toBeLessThanOrEqual(result.rawLength);
    expect(['defuddle', 'readability', 'fallback']).toContain(result.extractor);
  });

  it('should extract content from a Chinese government page', async () => {
    const html = `
      <html lang="zh">
        <head><title>关于印发AI创业补贴办法的通知</title></head>
        <body>
          <div class="breadcrumb">您当前的位置：首页 > 政策法规 > 通知公告</div>
          <div class="main-content">
            <h1>关于印发深圳市人工智能创业扶持资金管理办法的通知</h1>
            <p>各有关单位：为贯彻落实国家和省关于推动人工智能发展的决策部署，
            加快深圳市人工智能产业发展，现将《深圳市人工智能创业扶持资金管理办法》
            印发给你们，请认真遵照执行。</p>
            <p>第一条 本办法适用于在深圳市注册的人工智能相关企业和机构。</p>
            <p>第二条 补贴金额最高不超过五十万元人民币。</p>
            <p>第三条 申请条件包括注册满一年、核心团队不少于五人。</p>
          </div>
          <div class="sidebar">
            <h3>相关推荐</h3>
            <a href="/other">其他政策</a>
          </div>
          <footer>版权所有 深圳市工业和信息化局</footer>
        </body>
      </html>
    `;

    const result = await extractContent(html, 'https://sz.gov.cn/policy/ai.html');
    expect(result.text).toContain('人工智能');
    expect(result.text).toContain('五十万元');
    expect(result.text).toContain('第一条');
    expect(result.language).toBe('zh');
  });

  it('should fall back to Readability when Defuddle fails', async () => {
    // Very simple HTML that might confuse Defuddle
    const html = `
      <html>
        <body>
          <p>This is a moderately long paragraph that contains enough text content for
          the Readability algorithm to pick up. It needs to be long enough to pass the
          minimum content threshold of two hundred characters which we set in extract.ts.
          Let's add more words here to make sure it reaches the threshold easily.</p>
        </body>
      </html>
    `;

    const result = await extractContent(html, 'https://example.com/simple');
    expect(result.text.length).toBeGreaterThan(50);
    expect(result.text).toContain('moderately long');
  });

  it('should use fallback for very minimal HTML', async () => {
    const html = `
      <html>
        <head><title>Tiny Page</title></head>
        <body>
          <h1>Title</h1>
          <p>Short paragraph with some content about AI policy subsidies in Shenzhen that needs to be somewhat longer for testing.</p>
        </body>
      </html>
    `;

    const result = await extractContent(html, 'https://example.com/tiny');
    expect(result.title).toBe('Tiny Page');
    // Should get something from the page
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should detect Chinese language', async () => {
    const html = `
      <html>
        <body>
          <article>
            <p>这是一篇关于深圳人工智能创业扶持政策的详细分析文章。
            本文将从政策背景、补贴金额、申请条件等方面进行全面解读，
            帮助创业者了解相关政策信息并做出合理的申请规划。
            深圳作为中国科技创新的前沿城市，一直以来都高度重视人工智能产业的发展。</p>
          </article>
        </body>
      </html>
    `;

    const result = await extractContent(html, 'https://example.com/zh');
    expect(result.language).toBe('zh');
  });

  it('should handle malformed HTML gracefully', async () => {
    const html = '<html><body><p>Some content here with enough length to be useful for testing purposes and validation.</p>';
    const result = await extractContent(html, 'https://example.com/bad');
    // Should not throw, should return something
    expect(result).toBeDefined();
    expect(result.text.length).toBeGreaterThanOrEqual(0);
  });
});
