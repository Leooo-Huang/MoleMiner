import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Pipeline } from '../src/pipeline.js';
import { SourceRegistry } from '../src/registry.js';
import { Config } from '../src/config.js';
import { LLMClient } from '../src/llm.js';
import { SearchStore } from '../src/store.js';
import { BaseSource } from '../src/sources/base.js';
import type { SearchResult } from '../src/models.js';

// --- Mock sources ---

class MockSourceA extends BaseSource {
  readonly name = 'source_a';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  private _results: SearchResult[] = [
    { title: 'test Result A1', url: 'https://a1.com', source: 'source_a', snippet: 'test Snippet A1' },
    { title: 'test Result A2', url: 'https://a2.com', source: 'source_a', snippet: 'test Snippet A2' },
  ];

  setResults(results: SearchResult[]) {
    this._results = results;
  }

  async search(_queries: string[]): Promise<SearchResult[]> {
    return this._results;
  }

  enabled(_config: Config): boolean {
    return true;
  }
}

class MockSourceB extends BaseSource {
  readonly name = 'source_b';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  private _results: SearchResult[] = [
    { title: 'test Result B1', url: 'https://b1.com', source: 'source_b', snippet: 'test Snippet B1' },
  ];

  setResults(results: SearchResult[]) {
    this._results = results;
  }

  async search(_queries: string[]): Promise<SearchResult[]> {
    return this._results;
  }

  enabled(_config: Config): boolean {
    return true;
  }
}

class MockSlowSource extends BaseSource {
  readonly name = 'source_slow';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  async search(_queries: string[]): Promise<SearchResult[]> {
    await new Promise(resolve => setTimeout(resolve, 5000));
    return [];
  }

  enabled(_config: Config): boolean {
    return true;
  }
}

class MockBraveSource extends BaseSource {
  readonly name = 'brave';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  private _results: SearchResult[] = [];
  private _searchFn?: (queries: string[]) => Promise<SearchResult[]>;

  setResults(results: SearchResult[]) {
    this._results = results;
  }

  setSearchFn(fn: (queries: string[]) => Promise<SearchResult[]>) {
    this._searchFn = fn;
  }

  async search(queries: string[]): Promise<SearchResult[]> {
    if (this._searchFn) return this._searchFn(queries);
    return this._results;
  }

  enabled(_config: Config): boolean {
    return true;
  }
}

class MockErrorSource extends BaseSource {
  readonly name = 'source_error';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  async search(_queries: string[]): Promise<SearchResult[]> {
    throw new Error('Source failed');
  }

  enabled(_config: Config): boolean {
    return true;
  }
}

function makeRegistry(...sources: BaseSource[]): SourceRegistry {
  const registry = new SourceRegistry();
  for (const s of sources) registry.register(s);
  return registry;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  const config = new Config();
  config.sourceTimeoutApi = 1; // 1 second timeout for fast tests
  Object.assign(config, overrides);
  return config;
}

// --- MSW server for LLM calls ---

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeLlm(): LLMClient {
  return new LLMClient('openai', 'gpt-test', 'sk-test', 'https://api.openai.com/v1');
}

/** Set up the MSW server to return sequential LLM responses. */
function mockLlmSequence(responses: unknown[]) {
  let callIndex = 0;
  server.use(
    http.post('https://api.openai.com/v1/chat/completions', async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return HttpResponse.json({
        choices: [{ message: { content: JSON.stringify(response) } }],
      });
    }),
  );
}

// --- Tests ---

describe('Pipeline', () => {
  describe('no LLM (single round, raw query)', () => {
    it('should dispatch to all sources and return deduped results', async () => {
      const sourceA = new MockSourceA();
      const sourceB = new MockSourceB();
      const registry = makeRegistry(sourceA, sourceB);
      const config = makeConfig();

      const pipeline = new Pipeline(registry, config);
      const response = await pipeline.search('test query', { skipContentExtraction: true });

      expect(response.query).toBe('test query');
      expect(response.rounds).toBe(1);
      expect(response.totalResults).toBe(3);
      expect(response.results).toHaveLength(3);
    });

    it('should track source statuses', async () => {
      const sourceA = new MockSourceA();
      const sourceB = new MockSourceB();
      const registry = makeRegistry(sourceA, sourceB);
      const config = makeConfig();

      const pipeline = new Pipeline(registry, config);
      const response = await pipeline.search('test', { skipContentExtraction: true });

      expect(response.sources).toHaveLength(2);
      expect(response.sources[0].status).toBe('ok');
      expect(response.sources[0].resultCount).toBe(2);
      expect(response.sources[1].status).toBe('ok');
      expect(response.sources[1].resultCount).toBe(1);
      expect(response.sources[0].elapsedSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should filter by specified source names', async () => {
      const sourceA = new MockSourceA();
      const sourceB = new MockSourceB();
      const registry = makeRegistry(sourceA, sourceB);
      const config = makeConfig();

      const pipeline = new Pipeline(registry, config);
      const response = await pipeline.search('test', { sources: ['source_a'], skipContentExtraction: true });

      expect(response.results).toHaveLength(2);
      expect(response.sources).toHaveLength(1);
      expect(response.sources[0].name).toBe('source_a');
    });

    it('should deduplicate results with same URL', async () => {
      const sourceA = new MockSourceA();
      sourceA.setResults([
        { title: 'test Dup', url: 'https://same.com', source: 'source_a', snippet: 'test A' },
      ]);
      const sourceB = new MockSourceB();
      sourceB.setResults([
        { title: 'test Dup', url: 'https://same.com', source: 'source_b', snippet: 'test B' },
      ]);
      const registry = makeRegistry(sourceA, sourceB);
      const config = makeConfig();

      const pipeline = new Pipeline(registry, config);
      const response = await pipeline.search('test', { skipContentExtraction: true });

      expect(response.results).toHaveLength(1);
      expect(response.results[0].url).toBe('https://same.com');
    });
  });

  describe('timeout and error handling', () => {
    it('should handle source timeout', async () => {
      const slow = new MockSlowSource();
      const registry = makeRegistry(slow);
      const config = makeConfig({ sourceTimeoutApi: 0.1 }); // 100ms timeout

      const pipeline = new Pipeline(registry, config);
      const response = await pipeline.search('test', { skipContentExtraction: true });

      expect(response.results).toHaveLength(0);
      expect(response.sources).toHaveLength(1);
      expect(response.sources[0].status).toBe('timeout');
      expect(response.sources[0].error).toBe('timeout');
    });

    it('should handle source error while other sources succeed', async () => {
      const sourceA = new MockSourceA();
      const errorSource = new MockErrorSource();
      const registry = makeRegistry(sourceA, errorSource);
      const config = makeConfig();

      const pipeline = new Pipeline(registry, config);
      const response = await pipeline.search('test', { skipContentExtraction: true });

      // source_a results still returned
      expect(response.results).toHaveLength(2);

      // Both statuses reported
      const okStatus = response.sources.find(s => s.name === 'source_a');
      const errStatus = response.sources.find(s => s.name === 'source_error');
      expect(okStatus?.status).toBe('ok');
      expect(errStatus?.status).toBe('error');
      expect(errStatus?.error).toBe('Source failed');
    });
  });

  describe('with LLM (recursive loop)', () => {
    it('should classify results into direct, lead, and irrelevant', async () => {
      const sourceA = new MockSourceA();
      sourceA.setResults([
        { title: 'Official test Site', url: 'https://official.com', source: 'source_a', snippet: 'Official test' },
        { title: 'HN test Discussion', url: 'https://hn.com/item', source: 'source_a', snippet: 'test Discussion' },
        { title: 'Unrelated Weather', url: 'https://weather.com', source: 'source_a', snippet: 'test weather' },
      ]);
      const registry = makeRegistry(sourceA);
      const config = makeConfig();
      const llm = makeLlm();

      // LLM calls: 1) generate queries, 2) classify, 3) extract entities (returns empty → stops)
      mockLlmSequence([
        // generate queries
        { queries: [{ platform: 'source_a', queries: ['test'] }] },
        // classify — includes irrelevant
        {
          results: [
            { index: 0, type: 'direct', summary: 'Official site' },
            { index: 1, type: 'lead', summary: 'Discussion' },
            { index: 2, type: 'irrelevant', summary: 'Not related' },
          ],
        },
        // extract entities (empty → stop)
        { entities: [] },
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { skipContentExtraction: true });

      expect(response.rounds).toBe(1);
      // irrelevant results are dropped — only direct + lead remain
      expect(response.totalResults).toBe(2);
      expect(response.results[0].resultType).toBe('direct');
      expect(response.results[1].resultType).toBe('lead');
    });

    it('should recurse: classify → extract entities → generate new queries → round 2', async () => {
      // Round 1 uses source_a, Round 2 uses brave (Round 1+ only dispatches brave)
      const sourceA = new MockSourceA();
      sourceA.setResults([
        { title: 'Discussion about test ToolX', url: 'https://discuss.com/1', source: 'source_a', snippet: 'test ToolX mentioned' },
      ]);
      const brave = new MockBraveSource();
      let braveCall = 0;
      brave.setSearchFn(async (): Promise<SearchResult[]> => {
        braveCall++;
        if (braveCall === 1) {
          return [
            { title: 'test ToolX discussion', url: 'https://brave-r1.com', source: 'brave', snippet: 'test ToolX thread' },
          ];
        }
        return [
          { title: 'ToolX test Official', url: 'https://toolx.io', source: 'brave', snippet: 'Official test ToolX site' },
        ];
      });
      const registry = makeRegistry(sourceA, brave);
      const config = makeConfig();
      const llm = makeLlm();

      mockLlmSequence([
        // Round 1: generate queries from intent
        { queries: [{ platform: 'source_a', queries: ['test'] }, { platform: 'brave', queries: ['test'] }] },
        // Round 1: classify → all leads (2 results: 1 from source_a, 1 from brave)
        { results: [{ index: 0, type: 'lead', summary: 'Discussion mentioning ToolX' }, { index: 1, type: 'lead', summary: 'Brave lead' }] },
        // Round 1: extract entities → found ToolX
        { entities: [{ name: 'ToolX', confidence: 0.8, reason: 'mentioned' }] },
        // Round 2: generate queries from entities (only brave)
        { queries: [{ platform: 'brave', queries: ['ToolX test official'] }] },
        // Round 2: classify → direct
        { results: [{ index: 0, type: 'direct', summary: 'Official ToolX site' }] },
        // Round 2: no leads → no extract entities call needed (leads.length === 0 → break)
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { maxRounds: 3, skipContentExtraction: true });

      expect(response.rounds).toBe(2);
      // Should have direct from round 2 and lead from round 1
      expect(response.results.some(r => r.resultType === 'direct')).toBe(true);
      expect(response.results.some(r => r.resultType === 'lead')).toBe(true);
    });

    it('should stop when no entities are extracted (convergence)', async () => {
      const sourceA = new MockSourceA();
      sourceA.setResults([
        { title: 'test Result A1', url: 'https://a1.com', source: 'source_a', snippet: 'test Snippet A1' },
        { title: 'test Result A2', url: 'https://a2.com', source: 'source_a', snippet: 'test Snippet A2' },
      ]);
      const registry = makeRegistry(sourceA);
      const config = makeConfig();
      const llm = makeLlm();

      mockLlmSequence([
        // generate queries
        { queries: [{ platform: 'source_a', queries: ['test'] }] },
        // classify → 1 lead
        { results: [
          { index: 0, type: 'direct', summary: 'Direct result' },
          { index: 1, type: 'lead', summary: 'A lead' },
        ]},
        // extract entities → empty
        { entities: [] },
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { maxRounds: 5, skipContentExtraction: true });

      expect(response.rounds).toBe(1); // stopped after round 1
    });

    it('should stop when max rounds reached', async () => {
      const brave = new MockBraveSource();
      let braveCall = 0;
      brave.setSearchFn(async (): Promise<SearchResult[]> => {
        braveCall++;
        return [
          { title: `test Result ${braveCall}`, url: `https://r${braveCall}.com`, source: 'brave', snippet: `test Snippet ${braveCall}` },
        ];
      });
      const registry = makeRegistry(brave);
      const config = makeConfig();
      const llm = makeLlm();

      // Every round: generate queries, classify as lead, extract entity → loop
      mockLlmSequence([
        // Round 1
        { queries: [{ platform: 'brave', queries: ['test'] }] },
        { results: [{ index: 0, type: 'lead', summary: 'Lead' }] },
        { entities: [{ name: 'Entity1', confidence: 0.8, reason: 'mentioned' }] },
        // Round 2 (only brave dispatched)
        { queries: [{ platform: 'brave', queries: ['Entity1 test'] }] },
        { results: [{ index: 0, type: 'lead', summary: 'Lead 2' }] },
        { entities: [{ name: 'Entity2', confidence: 0.7, reason: 'mentioned' }] },
        // Round 3 would be blocked by maxRounds=2
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { maxRounds: 2, skipContentExtraction: true });

      expect(response.rounds).toBe(2);
    });

    it('should stop when deduped results are empty (all URLs already seen)', async () => {
      const brave = new MockBraveSource();
      // Always return the same URL
      brave.setSearchFn(async (): Promise<SearchResult[]> => {
        return [
          { title: 'test Same URL', url: 'https://same.com', source: 'brave', snippet: 'test Same' },
        ];
      });
      const registry = makeRegistry(brave);
      const config = makeConfig();
      const llm = makeLlm();

      mockLlmSequence([
        // Round 1
        { queries: [{ platform: 'brave', queries: ['test'] }] },
        { results: [{ index: 0, type: 'lead', summary: 'Lead' }] },
        { entities: [{ name: 'Entity', confidence: 0.8, reason: 'mentioned' }] },
        // Round 2: same URL → deduped to 0 → break
        { queries: [{ platform: 'brave', queries: ['Entity test'] }] },
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { maxRounds: 5, skipContentExtraction: true });

      // Round 2 dispatched but deduped to 0, so broke before classify
      expect(response.rounds).toBe(2);
    });

    it('should stop when no leads after classify', async () => {
      const sourceA = new MockSourceA(); // default results already contain 'test'
      const registry = makeRegistry(sourceA);
      const config = makeConfig();
      const llm = makeLlm();

      mockLlmSequence([
        // generate queries
        { queries: [{ platform: 'source_a', queries: ['test'] }] },
        // classify → all direct, no leads
        { results: [
          { index: 0, type: 'direct', summary: 'Direct 1' },
          { index: 1, type: 'direct', summary: 'Direct 2' },
        ]},
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { maxRounds: 3, skipContentExtraction: true });

      expect(response.rounds).toBe(1);
      expect(response.results).toHaveLength(2);
      expect(response.results.every(r => r.resultType === 'direct')).toBe(true);
    });
  });

  describe('cross-round URL dedup', () => {
    it('should not include URLs from previous rounds', async () => {
      const brave = new MockBraveSource();
      let callCount = 0;
      brave.setSearchFn(async (): Promise<SearchResult[]> => {
        callCount++;
        if (callCount === 1) {
          return [
            { title: 'test First', url: 'https://first.com', source: 'brave', snippet: 'test 1' },
            { title: 'test Shared', url: 'https://shared.com', source: 'brave', snippet: 'test shared' },
          ];
        }
        return [
          { title: 'test Shared again', url: 'https://shared.com', source: 'brave', snippet: 'test shared2' },
          { title: 'test Second', url: 'https://second.com', source: 'brave', snippet: 'test 2' },
        ];
      });
      const registry = makeRegistry(brave);
      const config = makeConfig();
      const llm = makeLlm();

      mockLlmSequence([
        // Round 1
        { queries: [{ platform: 'brave', queries: ['test'] }] },
        { results: [
          { index: 0, type: 'lead', summary: 'Lead' },
          { index: 1, type: 'lead', summary: 'Lead' },
        ]},
        { entities: [{ name: 'Entity', confidence: 0.8, reason: 'mentioned' }] },
        // Round 2 (only brave dispatched)
        { queries: [{ platform: 'brave', queries: ['Entity test'] }] },
        // Only 1 new result (shared.com deduped)
        { results: [{ index: 0, type: 'direct', summary: 'Direct' }] },
        // No leads → stop
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { maxRounds: 3, skipContentExtraction: true });

      expect(response.rounds).toBe(2);
      // All unique URLs across both rounds
      const urls = response.results.map(r => r.url);
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(urls.length);
    });
  });

  describe('Round 1+ only dispatches brave', () => {
    it('should only dispatch brave source in Round 2+', async () => {
      const sourceA = new MockSourceA();
      const searchSpyA = vi.spyOn(sourceA, 'search');
      sourceA.setResults([
        { title: 'test A1', url: 'https://a1.com', source: 'source_a', snippet: 'test A1' },
      ]);

      const brave = new MockBraveSource();
      const searchSpyBrave = vi.spyOn(brave, 'search');
      let braveCallCount = 0;
      brave.setSearchFn(async (): Promise<SearchResult[]> => {
        braveCallCount++;
        return [
          { title: `test Brave ${braveCallCount}`, url: `https://brave${braveCallCount}.com`, source: 'brave', snippet: `test Brave result ${braveCallCount}` },
        ];
      });

      const registry = makeRegistry(sourceA, brave);
      const config = makeConfig();
      const llm = makeLlm();

      mockLlmSequence([
        // Round 1: generate queries for both sources
        { queries: [{ platform: 'source_a', queries: ['test'] }, { platform: 'brave', queries: ['test'] }] },
        // Round 1: classify → leads
        { results: [
          { index: 0, type: 'lead', summary: 'Lead A' },
          { index: 1, type: 'lead', summary: 'Lead Brave' },
        ]},
        // Round 1: extract entities
        { entities: [{ name: 'FoundEntity', confidence: 0.9, reason: 'mentioned' }] },
        // Round 2: generate queries (only brave)
        { queries: [{ platform: 'brave', queries: ['FoundEntity test'] }] },
        // Round 2: classify → direct
        { results: [{ index: 0, type: 'direct', summary: 'Direct result' }] },
        // Round 2: no leads → stop
      ]);

      const pipeline = new Pipeline(registry, config, undefined, llm);
      const response = await pipeline.search('test', { maxRounds: 3, skipContentExtraction: true });

      expect(response.rounds).toBe(2);
      // source_a should only be called in Round 1
      expect(searchSpyA).toHaveBeenCalledTimes(1);
      // brave should be called in both rounds
      expect(searchSpyBrave).toHaveBeenCalledTimes(2);
    });
  });

  describe('store integration', () => {
    it('should save search to store when provided', async () => {
      const sourceA = new MockSourceA();
      const registry = makeRegistry(sourceA);
      const config = makeConfig();
      const store = await SearchStore.create(); // in-memory

      const pipeline = new Pipeline(registry, config, store);
      await pipeline.search('test query', { skipContentExtraction: true });

      const searches = store.listSearches();
      expect(searches).toHaveLength(1);
      expect(searches[0].query).toBe('test query');

      const results = store.getResults(searches[0].id as number);
      expect(results.length).toBeGreaterThan(0);

      store.close();
    });

    it('should work without store', async () => {
      const sourceA = new MockSourceA();
      const registry = makeRegistry(sourceA);
      const config = makeConfig();

      const pipeline = new Pipeline(registry, config);
      const response = await pipeline.search('test', { skipContentExtraction: true });

      expect(response.results).toHaveLength(2);
    });
  });

  describe('configure sources', () => {
    it('should call configure on each source', async () => {
      const sourceA = new MockSourceA();
      const configureSpy = vi.spyOn(sourceA, 'configure');
      const registry = makeRegistry(sourceA);
      const config = makeConfig();

      const pipeline = new Pipeline(registry, config);
      await pipeline.search('test', { skipContentExtraction: true });

      expect(configureSpy).toHaveBeenCalledWith(config);
    });
  });
});
