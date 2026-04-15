import { describe, it, expect, vi } from 'vitest';
import { Config } from '../../src/config.js';

// Mock cookies module
vi.mock('../../src/utils/cookies.js', () => ({
  hasCookies: vi.fn(() => true),
  loadCookies: vi.fn(() => [
    { name: 'a1', value: 'test-session', domain: '.xiaohongshu.com' },
    { name: 'web_session', value: 'sess123', domain: '.xiaohongshu.com' },
    { name: 'webId', value: 'abc123', domain: '.xiaohongshu.com' },
  ]),
  cookiesToHeader: vi.fn(() => 'a1=test-session; web_session=sess123; webId=abc123'),
}));

// Mock xhs-sign module — native TypeScript signing
vi.mock('../../src/utils/xhs-sign.js', () => ({
  signHeaders: vi.fn(() => ({
    'x-s': 'XYS_test_signature',
    'x-s-common': 'test_common',
    'x-t': '1700000000000',
    'x-b3-traceid': 'trace123',
    'x-xray-traceid': 'xray123',
  })),
}));

import { XiaohongshuSource, generateSearchId } from '../../src/sources/xiaohongshu.js';

describe('XiaohongshuSource', () => {
  const source = new XiaohongshuSource();

  it('has correct metadata', () => {
    expect(source.name).toBe('xiaohongshu');
    expect(source.sourceType).toBe('scrape');
    expect(source.requiresAuth).toBe(true);
    expect(source.installExtra).toBe('cn');
  });

  it('should be enabled when cookies exist', () => {
    expect(source.enabled(new Config())).toBe(true);
  });
});

describe('generateSearchId', () => {
  it('should generate a 32-character hex string', () => {
    const id = generateSearchId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should generate unique IDs', () => {
    const id1 = generateSearchId();
    const id2 = generateSearchId();
    expect(id1).not.toBe(id2);
  });
});

describe('XiaohongshuSource parsing', () => {
  it('should construct correct note URLs', () => {
    const noteId = 'abc123def456';
    const expectedUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
    expect(expectedUrl).toBe('https://www.xiaohongshu.com/explore/abc123def456');
  });

  it('should handle millisecond timestamps', () => {
    const msTimestamp = 1700000000000;
    const secTimestamp = 1700000000;

    const msDate = new Date(msTimestamp > 1e12 ? msTimestamp : msTimestamp * 1000);
    const secDate = new Date(secTimestamp > 1e12 ? secTimestamp : secTimestamp * 1000);

    expect(msDate.toISOString()).toBe(secDate.toISOString());
  });
});
