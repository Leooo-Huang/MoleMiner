import { describe, it, expect } from 'vitest';
import {
  parseTimestamp,
  filterByFreshness,
  aggregateResults,
} from '../src/aggregate.js';
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

describe('parseTimestamp', () => {
  it('should parse ISO 8601 with Z suffix', () => {
    const d = parseTimestamp('2025-06-15T10:30:00Z');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(5); // 0-indexed
    expect(d!.getUTCDate()).toBe(15);
  });

  it('should parse ISO 8601 with milliseconds', () => {
    const d = parseTimestamp('2025-06-15T10:30:00.123Z');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
  });

  it('should parse unix timestamp (10 digits, seconds)', () => {
    const d = parseTimestamp('1718451000'); // ~2024-06-15
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2024);
  });

  it('should parse unix timestamp (13 digits, milliseconds)', () => {
    const d = parseTimestamp('1718451000000');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2024);
  });

  it('should parse date-only format', () => {
    const d = parseTimestamp('2025-06-15');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
  });

  it('should return null for empty string', () => {
    expect(parseTimestamp('')).toBeNull();
  });

  it('should return null for garbage input', () => {
    expect(parseTimestamp('not-a-date')).toBeNull();
  });
});

describe('filterByFreshness', () => {
  it('should return all results if maxAgeDays is undefined', () => {
    const results = [makeResult({ timestamp: '2020-01-01' })];
    expect(filterByFreshness(results)).toEqual(results);
  });

  it('should keep results within maxAgeDays', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const results = [makeResult({ timestamp: recent.toISOString() })];
    expect(filterByFreshness(results, 30)).toHaveLength(1);
  });

  it('should remove results older than maxAgeDays', () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 5);
    const results = [makeResult({ timestamp: old.toISOString() })];
    expect(filterByFreshness(results, 30)).toHaveLength(0);
  });

  it('should keep results with no parseable timestamp', () => {
    const results = [makeResult({ timestamp: undefined })];
    expect(filterByFreshness(results, 30)).toHaveLength(1);
  });

  it('should handle empty results array', () => {
    expect(filterByFreshness([], 30)).toEqual([]);
  });
});

describe('aggregateResults', () => {
  it('should return empty array for empty input', () => {
    expect(aggregateResults([])).toEqual([]);
  });

  it('should deduplicate by URL', () => {
    const results = [
      makeResult({ url: 'https://example.com/page?utm_source=x', source: 'google' }),
      makeResult({ url: 'https://example.com/page', source: 'brave' }),
    ];
    const agg = aggregateResults(results);
    expect(agg).toHaveLength(1);
  });

  it('should filter by freshness when maxAgeDays is set', () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 5);
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const results = [
      makeResult({ url: 'https://a.com', timestamp: old.toISOString() }),
      makeResult({ url: 'https://b.com', timestamp: recent.toISOString() }),
    ];
    const agg = aggregateResults(results, { maxAgeDays: 30 });
    expect(agg).toHaveLength(1);
    expect(agg[0].url).toBe('https://b.com');
  });

  it('should deduplicate against existingUrls (cross-round dedup)', () => {
    const results = [
      makeResult({ title: 'Page A unique title here', url: 'https://a.com/page', source: 'google' }),
      makeResult({ title: 'Page B different title here', url: 'https://b.com/page', source: 'brave' }),
    ];
    const existing = new Set(['https://a.com/page']);
    const agg = aggregateResults(results, { existingUrls: existing });
    expect(agg).toHaveLength(1);
    expect(agg[0].url).toBe('https://b.com/page');
  });

  it('should run full pipeline: dedup + freshness + cross-round', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const old = new Date();
    old.setFullYear(old.getFullYear() - 5);
    const results = [
      makeResult({ url: 'https://a.com', timestamp: recent.toISOString(), source: 'google' }),
      makeResult({ url: 'https://a.com?utm_source=x', timestamp: recent.toISOString(), source: 'brave' }), // dup of a.com
      makeResult({ url: 'https://b.com', timestamp: old.toISOString(), source: 'google' }), // too old
      makeResult({ url: 'https://c.com', timestamp: recent.toISOString(), source: 'google' }), // already seen
    ];
    const existing = new Set(['https://c.com']);
    const agg = aggregateResults(results, { maxAgeDays: 30, existingUrls: existing });
    expect(agg).toHaveLength(1);
    expect(agg[0].url).toBe('https://a.com');
  });
});
