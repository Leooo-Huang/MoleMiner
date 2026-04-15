import { describe, it, expect } from 'vitest';
import { formatJson, formatTable, formatMarkdown, formatTerminal, formatReport } from '../src/output.js';
import type { SearchResult, SearchResponse, SearchReport } from '../src/models.js';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: 'Test Result',
    url: 'https://example.com',
    source: 'brave',
    snippet: 'A test snippet',
    ...overrides,
  };
}

function makeResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: 'test query',
    rounds: 1,
    totalResults: 0,
    results: [],
    sources: [],
    ...overrides,
  };
}

// ─── formatJson ────────────────────────────────────────────────────────────

describe('formatJson', () => {
  it('should produce valid JSON with query/rounds/sources/results envelope', () => {
    const response = makeResponse({
      query: 'AI hackathon',
      rounds: 2,
      results: [
        makeResult({ title: 'Result 1', url: 'https://a.com', resultType: 'direct' }),
        makeResult({ title: 'Result 2', url: 'https://b.com', resultType: 'lead' }),
      ],
      totalResults: 2,
    });
    const parsed = JSON.parse(formatJson(response));
    expect(parsed.query).toBe('AI hackathon');
    expect(parsed.rounds).toBe(2);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].type).toBe('direct');
    expect(parsed.results[1].type).toBe('lead');
  });

  it('should include optional result fields only when present', () => {
    const response = makeResponse({
      results: [makeResult({ language: 'en', timestamp: '2025-01-01', summary: 'A summary' })],
      totalResults: 1,
    });
    const parsed = JSON.parse(formatJson(response));
    expect(parsed.results[0].language).toBe('en');
    expect(parsed.results[0].timestamp).toBe('2025-01-01');
    expect(parsed.results[0].summary).toBe('A summary');
  });

  it('should omit optional fields when not present', () => {
    const response = makeResponse({ results: [makeResult()], totalResults: 1 });
    const parsed = JSON.parse(formatJson(response));
    expect(parsed.results[0]).not.toHaveProperty('language');
    expect(parsed.results[0]).not.toHaveProperty('timestamp');
    expect(parsed.results[0]).not.toHaveProperty('summary');
  });

  it('should return empty results array for no results', () => {
    const parsed = JSON.parse(formatJson(makeResponse()));
    expect(parsed.results).toEqual([]);
    expect(parsed.query).toBe('test query');
  });

  it('should default type to direct when resultType is undefined', () => {
    const response = makeResponse({ results: [makeResult()], totalResults: 1 });
    const parsed = JSON.parse(formatJson(response));
    expect(parsed.results[0].type).toBe('direct');
  });

  it('should include importanceScore when set', () => {
    const response = makeResponse({
      results: [makeResult({ importanceScore: 0.75 })],
      totalResults: 1,
    });
    const parsed = JSON.parse(formatJson(response));
    expect(parsed.results[0].importanceScore).toBe(0.75);
  });

  it('should include entities when present', () => {
    const response = makeResponse({
      entities: [{ name: 'Test Entity', confidence: 0.8, reason: 'found in leads' }],
    });
    const parsed = JSON.parse(formatJson(response));
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0].name).toBe('Test Entity');
  });
});

// ─── formatTable ───────────────────────────────────────────────────────────

describe('formatTable', () => {
  it('should return "No results found." for empty results', () => {
    expect(formatTable([])).toBe('No results found.');
  });

  it('should include header row with expected columns', () => {
    const results = [makeResult()];
    const table = formatTable(results);
    expect(table).toContain('#');
    expect(table).toContain('Title');
    expect(table).toContain('Source');
    expect(table).toContain('Type');
    expect(table).toContain('URL');
  });

  it('should include numbered rows', () => {
    const results = [
      makeResult({ title: 'First' }),
      makeResult({ title: 'Second', url: 'https://second.com' }),
    ];
    const table = formatTable(results);
    expect(table).toContain('First');
    expect(table).toContain('Second');
    expect(table).toContain('https://second.com');
  });

  it('should include result type in row', () => {
    const results = [makeResult({ resultType: 'lead' })];
    const table = formatTable(results);
    expect(table).toContain('lead');
  });

  it('should truncate long titles', () => {
    const longTitle = 'A'.repeat(100);
    const results = [makeResult({ title: longTitle })];
    const table = formatTable(results);
    // Should not contain the full 100-char title
    expect(table).not.toContain(longTitle);
    // Uses Unicode ellipsis '…'
    expect(table).toContain('…');
  });
});

// ─── formatMarkdown ────────────────────────────────────────────────────────

describe('formatMarkdown', () => {
  it('should return "No results found." for empty results', () => {
    expect(formatMarkdown([])).toBe('No results found.');
  });

  it('should include markdown headers', () => {
    const results = [makeResult({ title: 'My Result' })];
    const md = formatMarkdown(results);
    expect(md).toContain('### 1. My Result');
  });

  it('should include source, type, and URL', () => {
    const results = [makeResult({ source: 'brave', resultType: 'direct', url: 'https://brave.com' })];
    const md = formatMarkdown(results);
    expect(md).toContain('**Source:** brave');
    expect(md).toContain('**Type:** direct');
    expect(md).toContain('**URL:** https://brave.com');
  });

  it('should include snippet when present', () => {
    const results = [makeResult({ snippet: 'Important snippet' })];
    const md = formatMarkdown(results);
    expect(md).toContain('**Snippet:** Important snippet');
  });

  it('should include mentions when present', () => {
    const results = [makeResult({ mentions: ['React', 'Vue'] })];
    const md = formatMarkdown(results);
    expect(md).toContain('**Mentions:** React, Vue');
  });
});

// ─── formatTerminal ────────────────────────────────────────────────────────

describe('formatTerminal', () => {
  it('should include stats line', () => {
    const response = makeResponse({
      results: [makeResult({ resultType: 'direct' })],
      sources: [{ name: 'brave', status: 'ok', resultCount: 1 }],
      totalResults: 1,
      rounds: 2,
    });
    const out = formatTerminal(response);
    expect(out).toContain('1 results');
    expect(out).toContain('1 source');
    expect(out).toContain('2 rounds');
  });

  it('should show "No results found." for empty response', () => {
    const out = formatTerminal(makeResponse());
    expect(out).toContain('No results found.');
  });

  it('should separate direct sources and leads', () => {
    const response = makeResponse({
      results: [
        makeResult({ resultType: 'direct', title: 'Primary Source' }),
        makeResult({ resultType: 'lead', title: 'Lead Article' }),
      ],
      totalResults: 2,
    });
    const out = formatTerminal(response);
    expect(out).toContain('Direct Sources');
    expect(out).toContain('Leads');
    expect(out).toContain('Primary Source');
    expect(out).toContain('Lead Article');
  });

  it('should show key entities when present', () => {
    const response = makeResponse({
      entities: [{ name: 'OpenAI', confidence: 0.9, reason: 'mentioned' }],
    });
    const out = formatTerminal(response);
    expect(out).toContain('Key Entities');
    expect(out).toContain('OpenAI');
  });

  it('should show coverage footer with source names', () => {
    const response = makeResponse({
      sources: [
        { name: 'brave', status: 'ok', resultCount: 5 },
        { name: 'github', status: 'error', resultCount: 0, error: 'timeout' },
      ],
    });
    const out = formatTerminal(response);
    expect(out).toContain('brave(5)');
    expect(out).toContain('✗github');
  });

  it('should use Chinese labels when query contains Chinese characters', () => {
    const response = makeResponse({
      query: '深圳AI创业',
      results: [
        makeResult({ resultType: 'direct', title: '直接来源标题' }),
        makeResult({ resultType: 'lead', title: '线索标题', url: 'https://lead.com' }),
      ],
      entities: [{ name: '深圳', confidence: 0.9, reason: 'found' }],
      sources: [{ name: 'brave', status: 'ok', resultCount: 2 }],
      totalResults: 2,
    });
    const out = formatTerminal(response);
    expect(out).toContain('条结果');
    expect(out).toContain('关键实体');
    expect(out).toContain('直接来源');
    expect(out).toContain('线索');
    expect(out).toContain('已搜索');
  });

  it('should cluster similar leads instead of listing individually', () => {
    const response = makeResponse({
      results: [
        // 3 leads with similar titles (should cluster)
        makeResult({ resultType: 'lead', title: '深圳OPC新政重磅来袭!1200万补贴', source: 'wechat', url: 'https://a.com' }),
        makeResult({ resultType: 'lead', title: '深圳OPC政策全解析,一人开公司最高省千万', source: 'wechat', url: 'https://b.com' }),
        makeResult({ resultType: 'lead', title: '深圳OPC政策,我帮你把所有细节查清楚了', source: 'wechat', url: 'https://c.com' }),
        // 1 completely different lead (different topic)
        makeResult({ resultType: 'lead', title: 'GitHub Copilot workspace review and tutorial', source: 'devto', url: 'https://d.com' }),
      ],
      totalResults: 4,
    });
    const out = formatTerminal(response);
    // Should show topic count (3 OPC grouped + 1 separate = 2 topics)
    expect(out).toMatch(/2 topic/);
    // OPC cluster should show ×3
    expect(out).toContain('×3');
  });
});

// ─── formatReport ──────────────────────────────────────────────────────────

describe('formatReport', () => {
  function makeReport(overrides: Partial<SearchReport> = {}): SearchReport {
    return {
      summary: 'Test summary sentence.',
      keyFindings: ['Finding one', 'Finding two'],
      rankedResults: [
        { rank: 1, title: 'Top Result', url: 'https://top.com', source: 'brave', why: 'Most relevant source.' },
      ],
      keyEntities: [
        { name: 'EntityA', description: 'Description of EntityA' },
      ],
      informationGaps: ['Missing academic papers'],
      searchQuality: {
        coverage: 'high',
        directSourceRatio: 0.6,
        totalResults: 10,
      },
      ...overrides,
    };
  }

  it('should include summary', () => {
    const out = formatReport(makeReport());
    expect(out).toContain('Test summary sentence.');
  });

  it('should include key findings', () => {
    const out = formatReport(makeReport());
    expect(out).toContain('Finding one');
    expect(out).toContain('Finding two');
  });

  it('should include ranked results with why', () => {
    const out = formatReport(makeReport());
    expect(out).toContain('Top Result');
    expect(out).toContain('Most relevant source.');
    expect(out).toContain('https://top.com');
  });

  it('should include key entities', () => {
    const out = formatReport(makeReport());
    expect(out).toContain('EntityA');
    expect(out).toContain('Description of EntityA');
  });

  it('should include information gaps', () => {
    const out = formatReport(makeReport());
    expect(out).toContain('Missing academic papers');
  });

  it('should include search quality', () => {
    const out = formatReport(makeReport());
    expect(out).toContain('high');
    expect(out).toContain('60%');
  });
});
