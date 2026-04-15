import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  normalizeTitle,
  trigramSet,
  titleSimilarity,
  dedupeResults,
} from '../../src/utils/dedupe.js';
import type { SearchResult } from '../../src/models.js';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: 'Default Title for Testing',
    url: 'https://example.com',
    source: 'google',
    snippet: 'A snippet',
    ...overrides,
  };
}

describe('normalizeUrl', () => {
  it('should strip utm tracking params', () => {
    const url = 'https://example.com/page?utm_source=twitter&utm_medium=social&id=123';
    expect(normalizeUrl(url)).toBe('https://example.com/page?id=123');
  });

  it('should strip fbclid and gclid', () => {
    const url = 'https://example.com/page?fbclid=abc&gclid=def&real=1';
    expect(normalizeUrl(url)).toBe('https://example.com/page?real=1');
  });

  it('should strip ref, source, via params', () => {
    const url = 'https://example.com/page?ref=homepage&source=feed&via=api';
    expect(normalizeUrl(url)).toBe('https://example.com/page');
  });

  it('should sort remaining query params', () => {
    const url = 'https://example.com/page?z=1&a=2';
    expect(normalizeUrl(url)).toBe('https://example.com/page?a=2&z=1');
  });

  it('should strip trailing slash', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
  });

  it('should strip fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('should normalize scheme to https', () => {
    expect(normalizeUrl('http://example.com/page')).toBe('https://example.com/page');
  });

  it('should lowercase netloc', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/Page')).toBe('https://example.com/Page');
  });

  it('should handle URL with no query', () => {
    expect(normalizeUrl('https://example.com/page')).toBe('https://example.com/page');
  });
});

describe('normalizeTitle', () => {
  it('should lowercase', () => {
    expect(normalizeTitle('Hello World')).toBe('hello world');
  });

  it('should replace punctuation with space', () => {
    expect(normalizeTitle('hello-world: test!')).toBe('hello world test');
  });

  it('should collapse whitespace', () => {
    expect(normalizeTitle('hello   world    test')).toBe('hello world test');
  });

  it('should handle Unicode characters', () => {
    // Unicode letters should be preserved
    expect(normalizeTitle('你好世界')).toBe('你好世界');
  });

  it('should trim', () => {
    expect(normalizeTitle('  hello  ')).toBe('hello');
  });
});

describe('trigramSet', () => {
  it('should generate trigrams from a word', () => {
    const trigrams = trigramSet('hello');
    expect(trigrams).toEqual(new Set(['hel', 'ell', 'llo']));
  });

  it('should return the text itself if shorter than 3 chars', () => {
    expect(trigramSet('ab')).toEqual(new Set(['ab']));
  });

  it('should return empty set for empty string', () => {
    expect(trigramSet('')).toEqual(new Set());
  });

  it('should handle exactly 3 chars', () => {
    expect(trigramSet('abc')).toEqual(new Set(['abc']));
  });
});

describe('titleSimilarity', () => {
  it('should return 1.0 for identical titles', () => {
    expect(titleSimilarity('Hello World', 'Hello World')).toBe(1.0);
  });

  it('should return 1.0 for titles that normalize to the same', () => {
    expect(titleSimilarity('Hello, World!', 'hello world')).toBe(1.0);
  });

  it('should return 0.0 for completely different titles', () => {
    const sim = titleSimilarity('abcdefghij', 'klmnopqrst');
    expect(sim).toBe(0.0);
  });

  it('should return high similarity for near-identical titles', () => {
    const sim = titleSimilarity(
      'How to build a REST API in Node.js',
      'How to build a REST API in NodeJS',
    );
    expect(sim).toBeGreaterThan(0.85);
  });

  it('should return 0.0 when one title is empty', () => {
    expect(titleSimilarity('hello world test', '')).toBe(0.0);
  });
});

describe('dedupeResults', () => {
  it('should return empty array for empty input', () => {
    expect(dedupeResults([])).toEqual([]);
  });

  it('should remove URL duplicates', () => {
    const results = [
      makeResult({ url: 'https://example.com/page?utm_source=x', source: 'google' }),
      makeResult({ url: 'https://example.com/page', source: 'brave' }),
    ];
    const deduped = dedupeResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].source).toBe('google'); // keeps first
  });

  it('should remove title duplicates across different sources', () => {
    const results = [
      makeResult({
        title: 'How to build a REST API in Node.js',
        url: 'https://site-a.com/post',
        source: 'google',
      }),
      makeResult({
        title: 'How to build a REST API in NodeJS',
        url: 'https://site-b.com/post',
        source: 'brave',
      }),
    ];
    const deduped = dedupeResults(results);
    expect(deduped).toHaveLength(1);
  });

  it('should NOT remove title duplicates from the same source', () => {
    const results = [
      makeResult({
        title: 'How to build a REST API in Node.js',
        url: 'https://site-a.com/post1',
        source: 'google',
      }),
      makeResult({
        title: 'How to build a REST API in NodeJS',
        url: 'https://site-a.com/post2',
        source: 'google',
      }),
    ];
    const deduped = dedupeResults(results);
    expect(deduped).toHaveLength(2);
  });

  it('should skip title dedup for short titles (< 10 chars)', () => {
    const results = [
      makeResult({ title: 'React', url: 'https://a.com', source: 'google' }),
      makeResult({ title: 'React', url: 'https://b.com', source: 'brave' }),
    ];
    const deduped = dedupeResults(results);
    expect(deduped).toHaveLength(2);
  });

  it('should respect custom title threshold', () => {
    const results = [
      makeResult({
        title: 'Introduction to Machine Learning',
        url: 'https://a.com/ml',
        source: 'google',
      }),
      makeResult({
        title: 'Introduction to Machine Learning Basics',
        url: 'https://b.com/ml',
        source: 'brave',
      }),
    ];
    // With very high threshold, should keep both
    const deduped = dedupeResults(results, 0.99);
    expect(deduped).toHaveLength(2);
  });
});
