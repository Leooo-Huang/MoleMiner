import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/subprocess.js', () => ({
  commandExists: vi.fn(),
  execCommand: vi.fn(),
}));

vi.mock('../../src/utils/cookies.js', () => ({
  hasCookies: vi.fn(),
  loadCookies: vi.fn(),
}));

import { XSource } from '../../src/sources/x.js';
import { commandExists, execCommand } from '../../src/utils/subprocess.js';
import { hasCookies, loadCookies } from '../../src/utils/cookies.js';
import type { Config } from '../../src/config.js';

const mockCommandExists = vi.mocked(commandExists);
const mockExecCommand = vi.mocked(execCommand);
const mockHasCookies = vi.mocked(hasCookies);
const mockLoadCookies = vi.mocked(loadCookies);

const dummyConfig = {} as Config;

const validCookies = [
  { name: 'auth_token', value: 'abc123authtoken', domain: '.x.com' },
  { name: 'ct0', value: 'csrf_token_value', domain: '.x.com' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockHasCookies.mockReturnValue(true);
  mockLoadCookies.mockReturnValue(validCookies);
});

describe('XSource', () => {
  const src = new XSource();

  it('should have correct metadata', () => {
    expect(src.name).toBe('x');
    expect(src.sourceType).toBe('scrape');
    expect(src.requiresAuth).toBe(true);
  });

  it('should be enabled when twitter command exists and cookies present', () => {
    mockCommandExists.mockReturnValue(true);
    mockHasCookies.mockReturnValue(true);
    expect(src.enabled(dummyConfig)).toBe(true);
  });

  it('should be disabled when twitter command not found', () => {
    mockCommandExists.mockReturnValue(false);
    mockHasCookies.mockReturnValue(true);
    expect(src.enabled(dummyConfig)).toBe(false);
  });

  it('should be disabled when cookies not present', () => {
    mockCommandExists.mockReturnValue(true);
    mockHasCookies.mockReturnValue(false);
    expect(src.enabled(dummyConfig)).toBe(false);
  });

  it('should pass auth_token and ct0 as env vars to twitter-cli', async () => {
    mockExecCommand.mockReturnValue(JSON.stringify({ ok: true, data: [] }));

    await src.search(['test query']);

    expect(mockExecCommand).toHaveBeenCalledWith(
      'twitter',
      ['search', 'test query', '--json', '--max', '20', '-t', 'Latest'],
      expect.objectContaining({
        env: { TWITTER_AUTH_TOKEN: 'abc123authtoken', TWITTER_CT0: 'csrf_token_value' },
      }),
    );
  });

  it('should return empty array when auth_token cookie missing', async () => {
    mockLoadCookies.mockReturnValue([{ name: 'ct0', value: 'csrf', domain: '.x.com' }]);
    const results = await src.search(['test']);
    expect(results).toHaveLength(0);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  it('should parse twitter-cli JSON output into SearchResults', async () => {
    const twitterOutput = JSON.stringify({
      ok: true,
      data: [
        {
          id: '123456',
          text: 'Great AI hackathon happening this weekend! Check it out.',
          createdAtISO: '2026-03-20T10:00:00Z',
          author: {
            name: 'AI Builder',
            screenName: 'aibuilder',
            verified: true,
          },
          metrics: {
            likes: 150,
            retweets: 30,
            replies: 10,
            views: 5000,
          },
          lang: 'en',
        },
        {
          id: '789012',
          text: '深圳AI黑客松报名开始了',
          createdAtISO: '2026-03-19T08:00:00Z',
          author: {
            name: '科技频道',
            screenName: 'techcn',
            verified: false,
          },
          metrics: {
            likes: 50,
            retweets: 5,
            replies: 2,
            views: 1000,
          },
          lang: 'zh',
        },
      ],
    });

    mockExecCommand.mockReturnValue(twitterOutput);

    const results = await src.search(['AI hackathon']);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('Great AI hackathon happening this weekend! Check it out.');
    expect(results[0].url).toBe('https://x.com/aibuilder/status/123456');
    expect(results[0].source).toBe('x');
    expect(results[0].metadata?.likes).toBe(150);
    expect(results[0].metadata?.verified).toBe(true);
    expect(results[0].timestamp).toBe('2026-03-20T10:00:00Z');

    expect(results[1].url).toBe('https://x.com/techcn/status/789012');
    expect(results[1].language).toBe('zh');
  });

  it('should return empty array when twitter-cli fails', async () => {
    mockExecCommand.mockReturnValue(null);
    const results = await src.search(['test']);
    expect(results).toHaveLength(0);
  });

  it('should return empty array when response is not ok', async () => {
    mockExecCommand.mockReturnValue(JSON.stringify({
      ok: false,
      error: { code: 'not_authenticated', message: 'Login required' },
    }));
    const results = await src.search(['test']);
    expect(results).toHaveLength(0);
  });

  it('should handle invalid JSON output', async () => {
    mockExecCommand.mockReturnValue('not json at all');
    const results = await src.search(['test']);
    expect(results).toHaveLength(0);
  });

  it('should skip tweets without id or text', async () => {
    mockExecCommand.mockReturnValue(JSON.stringify({
      ok: true,
      data: [
        { id: null, text: 'no id' },
        { id: '111', text: '' },
        { id: '222', text: 'valid tweet' },
      ],
    }));
    const results = await src.search(['test']);
    expect(results).toHaveLength(1);
    expect(results[0].url).toContain('222');
  });
});
