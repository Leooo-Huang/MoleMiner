import { describe, it, expect, beforeEach } from 'vitest';
import { SourceRegistry } from '../src/registry.js';
import { BaseSource } from '../src/sources/base.js';
import { Config } from '../src/config.js';
import type { SearchResult } from '../src/models.js';

/** A mock source for testing */
class MockApiSource extends BaseSource {
  readonly name = 'mock_api';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = false;

  async search(_queries: string[]): Promise<SearchResult[]> {
    return [{ title: 'Mock', url: 'https://mock.com', source: 'mock_api', snippet: 'mock' }];
  }

  enabled(_config: Config): boolean {
    return true;
  }
}

/** A mock source that requires auth */
class MockAuthSource extends BaseSource {
  readonly name = 'mock_auth';
  readonly sourceType = 'api' as const;
  readonly requiresAuth = true;

  async search(_queries: string[]): Promise<SearchResult[]> {
    return [];
  }

  enabled(config: Config): boolean {
    return config.hasKey('mock_auth');
  }
}

/** A mock source that is always disabled */
class MockDisabledSource extends BaseSource {
  readonly name = 'mock_disabled';
  readonly sourceType = 'scrape' as const;
  readonly requiresAuth = false;

  async search(_queries: string[]): Promise<SearchResult[]> {
    return [];
  }

  enabled(_config: Config): boolean {
    return false;
  }
}

describe('SourceRegistry', () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    registry = new SourceRegistry();
  });

  it('should register and retrieve a source by name', () => {
    const source = new MockApiSource();
    registry.register(source);
    const retrieved = registry.getSource('mock_api');
    expect(retrieved).toBe(source);
    expect(retrieved.name).toBe('mock_api');
  });

  it('should list all registered source names', () => {
    registry.register(new MockApiSource());
    registry.register(new MockAuthSource());
    const names = registry.listSources();
    expect(names).toContain('mock_api');
    expect(names).toContain('mock_auth');
    expect(names).toHaveLength(2);
  });

  it('should throw for nonexistent source', () => {
    expect(() => registry.getSource('nonexistent')).toThrow(/not registered/);
  });

  it('should return only enabled sources', () => {
    registry.register(new MockApiSource());
    registry.register(new MockAuthSource());
    registry.register(new MockDisabledSource());

    // MockAuthSource.enabled checks config.hasKey('mock_auth') which returns false
    // MockDisabledSource.enabled always returns false
    // Only MockApiSource should be enabled
    const config = Config.load(/* nonexistent file */);
    const enabled = registry.getEnabledSources(config);

    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('mock_api');
  });
});
