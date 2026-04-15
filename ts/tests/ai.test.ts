import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { aiClassify, aiExtractEntities, aiGenerateQueries } from '../src/ai.js';
import { LLMClient } from '../src/llm.js';
import type { SearchResult } from '../src/models.js';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: 'Default Title for Testing',
    url: 'https://example.com',
    source: 'google',
    snippet: 'A snippet',
    ...overrides,
  };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mockOpenAI(responseContent: unknown) {
  server.use(
    http.post('https://api.openai.com/v1/chat/completions', async () => {
      return HttpResponse.json({
        choices: [{ message: { content: JSON.stringify(responseContent) } }],
      });
    }),
  );
}

function makeClient(): LLMClient {
  return new LLMClient('openai', 'gpt-5.4', 'sk-test', 'https://api.openai.com/v1');
}

describe('aiClassify', () => {
  it('should classify results and return modified copies', async () => {
    const results = [
      makeResult({ title: 'Node.js Official', url: 'https://nodejs.org', source: 'google' }),
      makeResult({ title: 'Discussion on HN', url: 'https://news.ycombinator.com/item?id=1', source: 'hackernews' }),
    ];

    mockOpenAI({
      results: [
        { index: 0, type: 'direct', summary: 'Official Node.js site' },
        { index: 1, type: 'lead', summary: 'HN discussion about Node.js' },
      ],
    });

    const llm = makeClient();
    const classified = await aiClassify('test query', results, llm);

    expect(classified).toHaveLength(2);
    expect(classified[0].resultType).toBe('direct');
    expect(classified[1].resultType).toBe('lead');
    // summary field should NOT be set by classify (reserved for page content extraction)
    expect(classified[0].summary).toBeUndefined();
    expect(classified[1].summary).toBeUndefined();
    // Original results should not be mutated
    expect(results[0].resultType).toBeUndefined();
  });

  it('should return empty array for empty input', async () => {
    const llm = makeClient();
    const classified = await aiClassify('test query', [], llm);
    expect(classified).toEqual([]);
  });

  it('should classify results as irrelevant', async () => {
    const results = [
      makeResult({ title: 'Node.js Official', url: 'https://nodejs.org', source: 'google' }),
      makeResult({ title: 'Weather Report', url: 'https://weather.com', source: 'google' }),
    ];

    mockOpenAI({
      results: [
        { index: 0, type: 'direct', summary: 'Official Node.js site' },
        { index: 1, type: 'irrelevant', summary: 'Not related to query' },
      ],
    });

    const llm = makeClient();
    const classified = await aiClassify('Node.js framework', results, llm);

    expect(classified).toHaveLength(2);
    expect(classified[0].resultType).toBe('direct');
    expect(classified[1].resultType).toBe('irrelevant');
  });

  it('should return original results if LLM returns invalid response', async () => {
    mockOpenAI({ invalid: true });

    const results = [makeResult({ title: 'Test', url: 'https://test.com' })];
    const llm = makeClient();
    const classified = await aiClassify('test query', results, llm);

    expect(classified).toEqual(results);
  });
});

describe('aiExtractEntities', () => {
  it('should extract entities with confidence scores', async () => {
    const leads = [
      makeResult({ title: 'Discussion about React and Next.js', source: 'reddit' }),
    ];

    mockOpenAI({
      entities: [
        { name: 'React', confidence: 0.9, reason: 'widely mentioned' },
        { name: 'Next.js', confidence: 0.7, reason: 'mentioned once' },
      ],
    });

    const llm = makeClient();
    const entities = await aiExtractEntities('test query', leads, llm);

    expect(entities).toHaveLength(2);
    expect(entities[0].name).toBe('React');
    expect(entities[0].confidence).toBe(0.9);
    expect(entities[1].name).toBe('Next.js');
  });

  it('should deduplicate entities case-insensitively, keeping highest confidence', async () => {
    const leads = [makeResult({ title: 'Discussion', source: 'reddit' })];

    mockOpenAI({
      entities: [
        { name: 'React', confidence: 0.6, reason: 'first mention' },
        { name: 'react', confidence: 0.9, reason: 'high engagement' },
        { name: 'Next.js', confidence: 0.8, reason: 'specific' },
      ],
    });

    const llm = makeClient();
    const entities = await aiExtractEntities('test query', leads, llm);

    expect(entities).toHaveLength(2);
    expect(entities[0].name).toBe('react'); // higher confidence version kept
    expect(entities[0].confidence).toBe(0.9);
    expect(entities[1].name).toBe('Next.js');
  });

  it('should return empty array for empty input', async () => {
    const llm = makeClient();
    const entities = await aiExtractEntities('test query', [], llm);
    expect(entities).toEqual([]);
  });

  it('should return empty array for invalid LLM response', async () => {
    const leads = [makeResult({ title: 'Discussion', source: 'reddit' })];
    mockOpenAI({ invalid: true });

    const llm = makeClient();
    const entities = await aiExtractEntities('test query', leads, llm);
    expect(entities).toEqual([]);
  });

  it('should filter entities below 0.7 confidence and limit to top 10', async () => {
    const leads = [makeResult({ title: 'Discussion', source: 'reddit' })];

    // Return 15 entities: confidence 1.0, 0.93, 0.87, 0.80, 0.73, 0.67, ...
    // Only first 5 (Entity0-Entity4) have confidence >= 0.7
    const manyEntities = Array.from({ length: 15 }, (_, i) => ({
      name: `Entity${i}`,
      confidence: (15 - i) / 15,
      reason: `reason ${i}`,
    }));

    mockOpenAI({ entities: manyEntities });

    const llm = makeClient();
    const entities = await aiExtractEntities('test query', leads, llm);

    expect(entities).toHaveLength(5); // only >=0.7 survive
    for (let i = 1; i < entities.length; i++) {
      expect(entities[i - 1].confidence).toBeGreaterThanOrEqual(entities[i].confidence);
    }
    for (const e of entities) {
      expect(e.confidence).toBeGreaterThanOrEqual(0.7);
    }
    expect(entities[0].name).toBe('Entity0');
  });
});

describe('aiGenerateQueries', () => {
  it('should generate per-platform queries from dimensions and skip irrelevant sources', async () => {
    // New schema: AI outputs base_keywords + dimensions, code combines them
    mockOpenAI({
      language: 'en',
      base_keywords: 'AI hackathon 2026',
      dimensions: [],  // simple query, no dimensions
      platforms: [
        { platform: 'brave', skip: false, skip_reason: '' },
        { platform: 'hackernews', skip: false, skip_reason: '' },
        { platform: 'zhihu', skip: true, skip_reason: 'English query, Chinese platform' },
      ],
    });

    const llm = makeClient();
    const result = await aiGenerateQueries(
      { intent: 'AI hackathon 2026', sourceNames: ['brave', 'hackernews', 'zhihu'] },
      llm,
    );

    expect(result.queries.brave).toContain('AI hackathon 2026');
    expect(result.queries.hackernews).toContain('AI hackathon 2026');
    expect(result.skipped).toContain('zhihu');
    expect(result.language).toBe('en');
  });

  it('should generate queries from entities', async () => {
    mockOpenAI({
      language: 'en',
      platforms: [
        { platform: 'brave', skip: false, skip_reason: '', queries: ['React official site'] },
        { platform: 'github', skip: false, skip_reason: '', queries: ['React framework'] },
      ],
    });

    const llm = makeClient();
    const result = await aiGenerateQueries(
      { entities: [{ name: 'React', confidence: 0.9, reason: 'high engagement' }], sourceNames: ['brave', 'github'] },
      llm,
    );

    expect(result.queries.brave).toEqual(['React official site']);
    expect(result.queries.github).toEqual(['React framework']);
    expect(result.skipped).toEqual([]);
  });

  it('should handle Chinese query with dimension expansion', async () => {
    mockOpenAI({
      language: 'zh',
      base_keywords: '深圳 AI创业补贴',
      dimensions: [
        { label: '行政区', priority: 'primary', values: ['南山区 AI创业补贴', '前海 AI创业补贴', '龙岗区 AI创业补贴'] },
        { label: '类型', priority: 'secondary', values: ['资金补贴', '场地优惠'] },
      ],
      platforms: [
        { platform: 'zhihu', skip: false, skip_reason: '' },
        { platform: 'brave', skip: false, skip_reason: '' },
        { platform: 'hackernews', skip: true, skip_reason: 'Chinese local policy' },
      ],
    });

    const llm = makeClient();
    const result = await aiGenerateQueries(
      { intent: '深圳对AI创业补贴', sourceNames: ['zhihu', 'brave', 'hackernews'] },
      llm,
    );

    // brave (search engine) gets full dimension-expanded queries
    expect(result.queries.brave).toContain('深圳 AI创业补贴');
    expect(result.queries.brave).toContain('南山区 AI创业补贴');
    expect(result.queries.brave).toContain('前海 AI创业补贴');
    expect(result.queries.brave).toContain('龙岗区 AI创业补贴');
    expect(result.queries.brave).toContain('深圳 AI创业补贴 资金补贴');
    expect(result.queries.brave!.length).toBe(6); // 1 base + 3 primary + 2 secondary
    // zhihu (social/community source) gets base queries only
    expect(result.queries.zhihu).toContain('深圳 AI创业补贴');
    expect(result.queries.zhihu!.length).toBe(1);
    expect(result.skipped).toContain('hackernews');
    expect(result.language).toBe('zh');
  });

  it('should return raw query for all sources if LLM fails', async () => {
    mockOpenAI({ invalid: true });

    const llm = makeClient();
    const result = await aiGenerateQueries(
      { intent: 'AI hackathon', sourceNames: ['brave', 'hackernews'] },
      llm,
    );

    // Fallback: all sources get the raw query, none skipped
    expect(result.queries.brave).toEqual(['AI hackathon']);
    expect(result.queries.hackernews).toEqual(['AI hackathon']);
    expect(result.skipped).toEqual([]);
  });

  it('should return empty QueryPlan if no intent or entities', async () => {
    const llm = makeClient();
    const result = await aiGenerateQueries(
      { sourceNames: ['brave'] },
      llm,
    );
    expect(result.queries).toEqual({});
    expect(result.skipped).toEqual([]);
  });
});
