/**
 * Base class for all search sources.
 */

import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';

export abstract class BaseSource {
  /** Unique source identifier (e.g. 'brave', 'google'). */
  abstract readonly name: string;

  /** How this source fetches data. */
  abstract readonly sourceType: 'api' | 'scrape' | 'browser';

  /** Whether this source requires an API key or auth token. */
  abstract readonly requiresAuth: boolean;

  /** Which install extra enables this source. */
  readonly installExtra: string = 'core';

  /** Execute search across multiple queries in parallel and return results.
   *  @param maxPerQuery — cap results per individual query for balanced distribution across dimension values. */
  async search(queries: string[], maxPerQuery?: number): Promise<SearchResult[]> {
    const batches = await Promise.all(queries.map(q => this.searchOne(q)));
    if (maxPerQuery && maxPerQuery > 0) {
      return batches.flatMap(batch => batch.slice(0, maxPerQuery));
    }
    return batches.flat();
  }

  /** Execute search for a single query. Override in subclasses. */
  protected async searchOne(_query: string): Promise<SearchResult[]> {
    return [];
  }

  /** Check if this source is available (deps installed, auth present). */
  abstract enabled(config: Config): boolean;

  /** Apply configuration to this source. Override in subclasses as needed. */
  configure(_config: Config): void {}
}
