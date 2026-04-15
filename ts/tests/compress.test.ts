import { describe, it, expect } from 'vitest';
import { compressText } from '../src/utils/compress.js';

describe('compressText', () => {
  // ─── P0: Basic rules ──────────────────────────────────────────────────

  it('should collapse whitespace within lines', () => {
    const input = '  Hello   world   this  is   a  test  ';
    const result = compressText(input, { language: 'en' });
    expect(result).toBe('Hello world this is a test');
  });

  it('should remove exact duplicate lines', () => {
    const input = 'Line A\nLine B\nLine A\nLine C\nLine B';
    const result = compressText(input, { language: 'en' });
    expect(result).toContain('Line A');
    expect(result).toContain('Line B');
    expect(result).toContain('Line C');
    // Only one occurrence of each
    const lines = result.split('\n').filter(l => l.trim());
    const aCount = lines.filter(l => l === 'Line A').length;
    expect(aCount).toBe(1);
  });

  it('should remove template boilerplate (English)', () => {
    const input = [
      'This is the article content that should remain here.',
      'Share on Twitter',
      'Copyright 2025 Company Inc.',
      'All rights reserved.',
      'Subscribe to our newsletter',
      'More great content is here in this paragraph.',
    ].join('\n');
    const result = compressText(input, { language: 'en' });
    expect(result).toContain('article content');
    expect(result).toContain('great content');
    expect(result).not.toContain('Share on Twitter');
    expect(result).not.toContain('Copyright');
    expect(result).not.toContain('All rights reserved');
    expect(result).not.toContain('Subscribe');
  });

  it('should remove template boilerplate (Chinese)', () => {
    const input = [
      '这是文章正文内容，包含关于深圳AI创业补贴政策的重要信息。',
      '分享到：微信 微博 QQ',
      '点击关注我们的公众号',
      '转载请注明出处',
      '编辑：张三',
      '来源：深圳市政府网站',
      '上一篇：关于人工智能的另一个政策',
      '这是第二段文章正文内容，详细说明了补贴的具体条件和金额。',
    ].join('\n');
    const result = compressText(input, { language: 'zh' });
    expect(result).toContain('AI创业补贴');
    expect(result).toContain('第二段文章正文');
    expect(result).not.toContain('分享到');
    expect(result).not.toContain('点击关注');
    expect(result).not.toContain('转载请注明');
    expect(result).not.toContain('编辑：张三');
    expect(result).not.toContain('上一篇');
  });

  // ─── P0: Link density ─────────────────────────────────────────────────

  it('should remove high link-density lines (navigation residue)', () => {
    const input = [
      'This is a real paragraph with actual article content here.',
      '[Home](/) [About](/about) [Contact](/contact) [Blog](/blog) [FAQ](/faq)',
      'Another real paragraph of article text that should be kept.',
    ].join('\n');
    const result = compressText(input, { language: 'en' });
    expect(result).toContain('real paragraph');
    expect(result).toContain('Another real');
    expect(result).not.toContain('[Home]');
  });

  // ─── P0: Isolated short lines ─────────────────────────────────────────

  it('should remove isolated short English lines (UI chrome)', () => {
    const input = [
      '',
      'Menu',
      '',
      'This is the first real paragraph of the article with substantial content.',
      'This is the second paragraph with more detailed information about the topic.',
      '',
      'X',
      '',
    ].join('\n');
    const result = compressText(input, { language: 'en' });
    expect(result).toContain('first real paragraph');
    expect(result).not.toContain('Menu');
  });

  it('should keep list items even if short', () => {
    const input = [
      'Requirements for applying:',
      '- Must be registered in Shenzhen',
      '- Founded within 3 years',
      '- More than 5 employees',
    ].join('\n');
    const result = compressText(input, { language: 'en' });
    expect(result).toContain('- Must be registered');
    expect(result).toContain('- Founded within');
    expect(result).toContain('- More than 5');
  });

  it('should keep Chinese legal clause numbers', () => {
    const input = [
      '第一条 总则',
      '本办法适用于深圳市辖区内注册的人工智能相关企业和机构。',
      '第二条 申请条件',
      '申请单位应当满足以下基本条件。',
    ].join('\n');
    const result = compressText(input, { language: 'zh' });
    expect(result).toContain('第一条');
    expect(result).toContain('第二条');
  });

  // ─── P1: Chinese platform noise ───────────────────────────────────────

  it('should remove government breadcrumbs', () => {
    const input = [
      '您当前的位置：首页 > 政策法规 > 通知公告',
      '关于印发深圳市人工智能产业发展专项资金管理办法的通知',
      '这是通知的正文内容，包含详细的补贴政策条款和申请要求。',
    ].join('\n');
    const result = compressText(input, { language: 'zh' });
    expect(result).not.toContain('您当前的位置');
    expect(result).toContain('关于印发');
    expect(result).toContain('正文内容');
  });

  it('should remove Zhihu noise', () => {
    const input = [
      '深圳AI补贴的详细回答内容，这里有很多有价值的一手信息。',
      '125个赞同',
      '添加评论',
      '写下你的评论',
      '关注问题',
    ].join('\n');
    const result = compressText(input, { language: 'zh' });
    expect(result).toContain('详细回答内容');
    expect(result).not.toContain('个赞同');
    expect(result).not.toContain('添加评论');
  });

  it('should remove Xiaohongshu hashtag clusters', () => {
    const input = [
      '分享我的深圳AI创业经验和补贴申请过程，希望对大家有帮助。',
      '#深圳创业 #AI补贴 #创业补贴 #科技创新',
    ].join('\n');
    const result = compressText(input, { language: 'zh' });
    expect(result).toContain('分享我的深圳');
    expect(result).not.toContain('#深圳创业 #AI补贴 #创业补贴');
  });

  // ─── P1: Related content tail ─────────────────────────────────────────

  it('should truncate "Related articles" tail section', () => {
    // Build content where related section is in the last 30%
    const mainContent = Array.from({ length: 10 }, (_, i) =>
      `This is paragraph ${i + 1} of the main article content.`
    ).join('\n');
    const tail = [
      '## Related Articles',
      'Some other article about AI',
      'Another article about startups',
      'Yet another link to somewhere',
    ].join('\n');

    const input = mainContent + '\n' + tail;
    const result = compressText(input, { language: 'en' });
    expect(result).toContain('paragraph 1');
    expect(result).toContain('paragraph 10');
    expect(result).not.toContain('Related Articles');
    expect(result).not.toContain('Some other article');
  });

  it('should truncate Chinese "推荐阅读" tail', () => {
    const mainContent = Array.from({ length: 10 }, (_, i) =>
      `这是第${i + 1}段正文内容，包含关于深圳AI创业补贴政策的详细说明。`
    ).join('\n');
    const tail = [
      '## 推荐阅读',
      '另一篇关于AI的文章',
      '深圳创业指南',
    ].join('\n');

    const input = mainContent + '\n' + tail;
    const result = compressText(input, { language: 'zh' });
    expect(result).toContain('第1段正文');
    expect(result).not.toContain('推荐阅读');
  });

  // ─── P1: Navigation residue ───────────────────────────────────────────

  it('should remove breadcrumb-style navigation', () => {
    const input = [
      'Home > Policy > Announcements > Current Page',
      'This is the actual article content about AI subsidies.',
    ].join('\n');
    const result = compressText(input, { language: 'en' });
    expect(result).not.toContain('Home > Policy');
    expect(result).toContain('actual article content');
  });

  // ─── Safety: never produce empty output ───────────────────────────────

  it('should never produce empty output from non-empty input', () => {
    const input = 'Short.';
    const result = compressText(input, { language: 'en' });
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return empty string for empty input', () => {
    expect(compressText('', { language: 'en' })).toBe('');
    expect(compressText('   ', { language: 'en' })).toBe('');
  });

  // ─── Safety: compression ratio guard ──────────────────────────────────

  it('should roll back a rule that removes >70% of content', () => {
    // Create input where most lines are "short" to trigger aggressive removal
    // but the safety check should prevent losing everything
    const input = [
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'This is the only real paragraph that has enough length to survive.',
    ].join('\n');
    const result = compressText(input, { language: 'en' });
    // Should still have the real paragraph at minimum
    expect(result).toContain('only real paragraph');
  });

  // ─── P2: Blank line collapse ──────────────────────────────────────────

  it('should collapse 3+ blank lines into 1', () => {
    const input = 'Para 1\n\n\n\n\nPara 2';
    const result = compressText(input, { language: 'en' });
    expect(result).toBe('Para 1\n\nPara 2');
  });
});
