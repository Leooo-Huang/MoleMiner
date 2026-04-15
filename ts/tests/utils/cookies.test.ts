import { describe, it, expect, afterEach } from 'vitest';
import { cookiesToHeader, hasCookies, saveCookies, clearCookies } from '../../src/utils/cookies.js';

const PAST = Math.floor(Date.now() / 1000) - 3600;   // 1 hour ago
const FUTURE = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
const TEST_PLATFORM = '__test_expires__';

describe('hasCookies', () => {
  afterEach(() => {
    clearCookies(TEST_PLATFORM);
  });

  it('should return false when no cookie file exists', () => {
    expect(hasCookies(TEST_PLATFORM)).toBe(false);
  });

  it('should return false when all cookies are expired', () => {
    saveCookies(TEST_PLATFORM, [
      { name: 'token', value: 'old', domain: '.example.com', expires: PAST },
    ]);
    expect(hasCookies(TEST_PLATFORM)).toBe(false);
  });

  it('should return true when at least one cookie is valid', () => {
    saveCookies(TEST_PLATFORM, [
      { name: 'stale', value: 'old', domain: '.example.com', expires: PAST },
      { name: 'fresh', value: 'new', domain: '.example.com', expires: FUTURE },
    ]);
    expect(hasCookies(TEST_PLATFORM)).toBe(true);
  });

  it('should return true for session cookies (no expires)', () => {
    saveCookies(TEST_PLATFORM, [
      { name: 'sess', value: 'abc', domain: '.example.com' },
    ]);
    expect(hasCookies(TEST_PLATFORM)).toBe(true);
  });
});

describe('cookiesToHeader', () => {
  const cookies = [
    { name: 'z_c0', value: 'token123', domain: '.zhihu.com' },
    { name: '_xsrf', value: 'xsrf456', domain: '.zhihu.com' },
    { name: 'other', value: 'val', domain: '.other.com' },
  ];

  it('should skip expired cookies', () => {
    const header = cookiesToHeader(
      [
        { name: 'stale', value: 'old', domain: '.zhihu.com', expires: PAST },
        { name: 'fresh', value: 'new', domain: '.zhihu.com', expires: FUTURE },
      ],
      'www.zhihu.com',
    );
    expect(header).toBe('fresh=new');
  });

  it('should return undefined when all cookies are expired', () => {
    const header = cookiesToHeader(
      [{ name: 'z_c0', value: 'old', domain: '.zhihu.com', expires: PAST }],
      'www.zhihu.com',
    );
    expect(header).toBeUndefined();
  });

  it('should treat session cookies (no expires) as valid', () => {
    const header = cookiesToHeader(
      [{ name: 'sess', value: 'abc', domain: '.zhihu.com' }],
      'www.zhihu.com',
    );
    expect(header).toBe('sess=abc');
  });

  it('should filter cookies by domain', () => {
    const header = cookiesToHeader(cookies, 'www.zhihu.com');
    expect(header).toBe('z_c0=token123; _xsrf=xsrf456');
  });

  it('should return undefined when no cookies match domain', () => {
    const header = cookiesToHeader(cookies, 'www.example.com');
    expect(header).toBeUndefined();
  });

  it('should return undefined for empty cookies array', () => {
    const header = cookiesToHeader([], 'www.zhihu.com');
    expect(header).toBeUndefined();
  });

  it('should match domain with leading dot', () => {
    const header = cookiesToHeader(
      [{ name: 'a1', value: 'sess', domain: '.xiaohongshu.com' }],
      'www.xiaohongshu.com',
    );
    expect(header).toBe('a1=sess');
  });

  it('should skip cookies without name', () => {
    const header = cookiesToHeader(
      [
        { name: '', value: 'noname', domain: '.zhihu.com' },
        { name: 'valid', value: 'yes', domain: '.zhihu.com' },
      ],
      'www.zhihu.com',
    );
    expect(header).toBe('valid=yes');
  });
});
