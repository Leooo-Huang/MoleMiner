/**
 * Source registry for discovering and managing search sources.
 */

import type { Config } from './config.js';
import type { BaseSource } from './sources/base.js';

export class SourceRegistry {
  private sources = new Map<string, BaseSource>();

  /** Register a source instance. */
  register(source: BaseSource): void {
    this.sources.set(source.name, source);
  }

  /** Get a registered source by name. Throws if not found. */
  getSource(name: string): BaseSource {
    const source = this.sources.get(name);
    if (!source) {
      throw new Error(`Source '${name}' not registered`);
    }
    return source;
  }

  /** Return all sources that are currently enabled given the config. */
  getEnabledSources(config: Config): BaseSource[] {
    const result: BaseSource[] = [];
    for (const source of this.sources.values()) {
      if (source.enabled(config)) {
        result.push(source);
      }
    }
    return result;
  }

  /** List all registered source names. */
  listSources(): string[] {
    return [...this.sources.keys()];
  }
}
