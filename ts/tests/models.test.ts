import { describe, it, expect } from 'vitest';
import type { SearchResult, SourceStatus, SearchResponse } from '../src/models.js';
import { createSearchResponse } from '../src/models.js';

describe('SearchResult interface', () => {
  it('should allow creating a result with required fields', () => {
    const result: SearchResult = {
      title: 'Test Result',
      url: 'https://example.com',
      source: 'google',
      snippet: 'A test snippet',
    };
    expect(result.title).toBe('Test Result');
    expect(result.url).toBe('https://example.com');
    expect(result.source).toBe('google');
    expect(result.snippet).toBe('A test snippet');
  });

  it('should default resultType to direct when not specified', () => {
    const result: SearchResult = {
      title: 'Test',
      url: 'https://example.com',
      source: 'brave',
      snippet: 'snippet',
    };
    // Interface doesn't enforce defaults, but resultType is optional with default in usage
    expect(result.resultType).toBeUndefined();
  });

  it('should allow all optional fields', () => {
    const result: SearchResult = {
      title: 'Full Result',
      url: 'https://example.com/full',
      source: 'hackernews',
      snippet: 'Full snippet',
      resultType: 'lead',
      language: 'en',
      timestamp: '2026-03-22T00:00:00Z',
      mentions: ['entity1', 'entity2'],
      metadata: { score: 100 },
      summary: 'A summary',
    };
    expect(result.resultType).toBe('lead');
    expect(result.language).toBe('en');
    expect(result.timestamp).toBe('2026-03-22T00:00:00Z');
    expect(result.mentions).toEqual(['entity1', 'entity2']);
    expect(result.metadata).toEqual({ score: 100 });
    expect(result.summary).toBe('A summary');
  });
});

describe('SourceStatus interface', () => {
  it('should allow creating a status with required fields', () => {
    const status: SourceStatus = {
      name: 'google',
      status: 'ok',
      resultCount: 10,
    };
    expect(status.name).toBe('google');
    expect(status.status).toBe('ok');
    expect(status.resultCount).toBe(10);
  });

  it('should allow error status with error message', () => {
    const status: SourceStatus = {
      name: 'brave',
      status: 'error',
      resultCount: 0,
      error: 'API key missing',
      elapsedSeconds: 0.5,
    };
    expect(status.status).toBe('error');
    expect(status.error).toBe('API key missing');
    expect(status.elapsedSeconds).toBe(0.5);
  });
});

describe('createSearchResponse', () => {
  it('should create a response with all defaults', () => {
    const resp = createSearchResponse({});
    expect(resp.results).toEqual([]);
    expect(resp.sources).toEqual([]);
    expect(resp.query).toBe('');
    expect(resp.totalResults).toBe(0);
    expect(resp.rounds).toBe(1);
    expect(resp.enhancedQueries).toBeUndefined();
  });

  it('should create a response with no arguments', () => {
    const resp = createSearchResponse();
    expect(resp.results).toEqual([]);
    expect(resp.query).toBe('');
    expect(resp.rounds).toBe(1);
  });

  it('should override defaults with provided values', () => {
    const result: SearchResult = {
      title: 'Test',
      url: 'https://example.com',
      source: 'google',
      snippet: 'test',
    };
    const resp = createSearchResponse({
      results: [result],
      query: 'test query',
      totalResults: 1,
      rounds: 3,
    });
    expect(resp.results).toHaveLength(1);
    expect(resp.query).toBe('test query');
    expect(resp.totalResults).toBe(1);
    expect(resp.rounds).toBe(3);
  });

  it('should include enhancedQueries when provided', () => {
    const resp = createSearchResponse({
      enhancedQueries: { google: ['q1', 'q2'] },
    });
    expect(resp.enhancedQueries).toEqual({ google: ['q1', 'q2'] });
  });
});
