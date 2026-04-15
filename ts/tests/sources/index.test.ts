import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../src/sources/index.js';

describe('createDefaultRegistry', () => {
  it('should register all 12 sources', () => {
    const registry = createDefaultRegistry();
    const names = registry.listSources();

    expect(names).toHaveLength(12);
    expect(names).toContain('hackernews');
    expect(names).toContain('reddit');
    expect(names).toContain('github');
    expect(names).toContain('stackoverflow');
    expect(names).toContain('devto');
    expect(names).toContain('brave');
    expect(names).toContain('youtube');
    expect(names).toContain('wechat');
    expect(names).toContain('weibo');
    expect(names).toContain('zhihu');
    expect(names).toContain('xiaohongshu');
    expect(names).toContain('x');
  });

  it('should return a SourceRegistry with retrievable sources', () => {
    const registry = createDefaultRegistry();

    const weibo = registry.getSource('weibo');
    expect(weibo.name).toBe('weibo');
    expect(weibo.sourceType).toBe('scrape');

    const zhihu = registry.getSource('zhihu');
    expect(zhihu.name).toBe('zhihu');
    expect(zhihu.sourceType).toBe('browser');

    const xhs = registry.getSource('xiaohongshu');
    expect(xhs.name).toBe('xiaohongshu');
    expect(xhs.sourceType).toBe('scrape');

    const x = registry.getSource('x');
    expect(x.name).toBe('x');
    expect(x.sourceType).toBe('scrape');
  });

  it('should throw for unknown source names', () => {
    const registry = createDefaultRegistry();
    expect(() => registry.getSource('nonexistent')).toThrow("Source 'nonexistent' not registered");
  });
});
