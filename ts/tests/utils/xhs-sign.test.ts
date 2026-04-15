import { describe, it, expect } from 'vitest';
import { signHeaders } from '../../src/utils/xhs-sign.js';

describe('signHeaders', () => {
  const cookies = { a1: 'test-a1-cookie-value-1234567890abcdef' };

  it('should return all required header keys', () => {
    const headers = signHeaders('POST', '/api/sns/web/v1/search/notes', cookies, {
      keyword: 'test',
    });

    expect(headers).toHaveProperty('x-s');
    expect(headers).toHaveProperty('x-s-common');
    expect(headers).toHaveProperty('x-t');
    expect(headers).toHaveProperty('x-b3-traceid');
    expect(headers).toHaveProperty('x-xray-traceid');
  });

  it('should produce x-s starting with XYS_ prefix', () => {
    const headers = signHeaders('POST', '/api/sns/web/v1/search/notes', cookies, {
      keyword: 'test',
    });

    expect(headers['x-s']).toMatch(/^XYS_/);
  });

  it('should produce valid x-t as numeric timestamp string', () => {
    const before = Date.now();
    const headers = signHeaders('GET', '/api/sns/web/v1/feed', cookies);
    const after = Date.now();

    const xt = Number(headers['x-t']);
    expect(xt).toBeGreaterThanOrEqual(before);
    expect(xt).toBeLessThanOrEqual(after);
  });
});
