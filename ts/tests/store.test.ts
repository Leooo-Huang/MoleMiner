import { describe, it, expect, beforeEach } from 'vitest';
import { SearchStore } from '../src/store.js';
import type { SearchResult } from '../src/models.js';

describe('SearchStore', () => {
  let store: SearchStore;

  beforeEach(async () => {
    store = await SearchStore.create(); // in-memory
  });

  it('should create an in-memory store', () => {
    expect(store).toBeInstanceOf(SearchStore);
  });

  it('should save a search and return its id', () => {
    const results: SearchResult[] = [
      {
        title: 'Test Result',
        url: 'https://example.com',
        source: 'google',
        snippet: 'A test snippet',
      },
    ];
    const id = store.saveSearch('test query', ['google'], results);
    expect(id).toBe(1);
  });

  it('should retrieve a saved search by id', () => {
    const results: SearchResult[] = [
      {
        title: 'Result 1',
        url: 'https://example.com/1',
        source: 'brave',
        snippet: 'Snippet 1',
        resultType: 'direct',
        language: 'en',
      },
    ];
    const id = store.saveSearch('my query', ['brave'], results);
    const search = store.getSearch(id);

    expect(search).not.toBeNull();
    expect(search!.query).toBe('my query');
    expect(search!.sources_used).toBe(JSON.stringify(['brave']));
    expect(search!.result_count).toBe(1);
    expect(search!.searched_at).toBeTruthy();
  });

  it('should return null for nonexistent search', () => {
    const search = store.getSearch(999);
    expect(search).toBeNull();
  });

  it('should retrieve results for a search', () => {
    const results: SearchResult[] = [
      {
        title: 'R1',
        url: 'https://example.com/1',
        source: 'google',
        snippet: 'S1',
        resultType: 'direct',
        language: 'en',
        timestamp: '2026-01-01T00:00:00Z',
        mentions: ['entity1'],
        metadata: { score: 42 },
      },
      {
        title: 'R2',
        url: 'https://example.com/2',
        source: 'brave',
        snippet: 'S2',
      },
    ];
    const id = store.saveSearch('query', ['google', 'brave'], results);
    const rows = store.getResults(id);

    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('R1');
    expect(rows[0].source).toBe('google');
    expect(rows[0].result_type).toBe('direct');
    expect(rows[0].language).toBe('en');
    expect(rows[0].mentions).toBe(JSON.stringify(['entity1']));
    expect(rows[0].metadata).toBe(JSON.stringify({ score: 42 }));

    expect(rows[1].title).toBe('R2');
    expect(rows[1].source).toBe('brave');
  });

  it('should list searches with limit', () => {
    store.saveSearch('q1', ['google'], []);
    store.saveSearch('q2', ['brave'], []);
    store.saveSearch('q3', ['reddit'], []);

    const all = store.listSearches();
    expect(all).toHaveLength(3);
    // Most recent first
    expect(all[0].query).toBe('q3');
    expect(all[2].query).toBe('q1');

    const limited = store.listSearches(2);
    expect(limited).toHaveLength(2);
  });

  it('should close without error', () => {
    expect(() => store.close()).not.toThrow();
  });
});
