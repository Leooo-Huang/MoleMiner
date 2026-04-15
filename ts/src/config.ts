/**
 * Configuration system for MoleMiner — TOML file + env var overrides.
 */

import TOML from '@iarna/toml';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';

const DEFAULT_CONFIG_PATH = join(homedir(), '.moleminer', 'config.toml');

/** Maps source names to the config field that must be set. */
const SOURCE_KEY_MAP: Record<string, keyof Config> = {
  brave: 'braveApiKey',
  github: 'githubToken',
} as const;

/** Metadata for interactive setup — maps config field to display info. */
export const SOURCE_SETUP_INFO: Record<string, { source: string; label: string; url: string; freeTier: string }> = {
  braveApiKey: {
    source: 'brave',
    label: 'Brave Search API Key',
    url: 'https://brave.com/search/api/',
    freeTier: '2,000 queries/month free',
  },
  githubToken: {
    source: 'github',
    label: 'GitHub Personal Access Token',
    url: 'https://github.com/settings/tokens',
    freeTier: 'Optional (higher rate limits with token)',
  },
} as const;

/** Optional dependencies that enable specific sources. */
export const OPTIONAL_DEPS: Record<string, { source: string; install: string; check: string }> = {
  'yt-dlp': {
    source: 'youtube',
    install: 'npm install moleminer --with-social',
    check: 'yt-dlp',
  },
  playwright: {
    source: 'cn sources (zhihu, xiaohongshu)',
    install: 'npm install moleminer --with-cn',
    check: 'playwright',
  },
} as const;

/** Field metadata for type coercion from env vars. */
interface FieldMeta {
  key: string;         // camelCase property name
  envKey: string;      // MOLEMINER_SNAKE_UPPER
  tomlKey: string;     // snake_case for TOML
  type: 'string' | 'number';
  defaultValue?: unknown;
}

const FIELDS: FieldMeta[] = [
  { key: 'braveApiKey',         envKey: 'MOLEMINER_BRAVE_API_KEY',          tomlKey: 'brave_api_key',          type: 'string' },
  { key: 'githubToken',         envKey: 'MOLEMINER_GITHUB_TOKEN',           tomlKey: 'github_token',           type: 'string' },
  { key: 'llmProfile',          envKey: 'MOLEMINER_LLM_PROFILE',            tomlKey: 'llm_profile',            type: 'string' },
  { key: 'llmProvider',         envKey: 'MOLEMINER_LLM_PROVIDER',           tomlKey: 'llm_provider',           type: 'string' },
  { key: 'llmModel',            envKey: 'MOLEMINER_LLM_MODEL',              tomlKey: 'llm_model',              type: 'string' },
  { key: 'llmFastModel',        envKey: 'MOLEMINER_LLM_FAST_MODEL',         tomlKey: 'llm_fast_model',         type: 'string' },
  { key: 'llmApiKey',           envKey: 'MOLEMINER_LLM_API_KEY',            tomlKey: 'llm_api_key',            type: 'string' },
  { key: 'llmBaseUrl',          envKey: 'MOLEMINER_LLM_BASE_URL',           tomlKey: 'llm_base_url',           type: 'string' },
  { key: 'sourceTimeoutApi',    envKey: 'MOLEMINER_SOURCE_TIMEOUT_API',     tomlKey: 'source_timeout_api',     type: 'number', defaultValue: 30 },
  { key: 'sourceTimeoutBrowser',envKey: 'MOLEMINER_SOURCE_TIMEOUT_BROWSER', tomlKey: 'source_timeout_browser', type: 'number', defaultValue: 60 },
  { key: 'browserConcurrency',  envKey: 'MOLEMINER_BROWSER_CONCURRENCY',    tomlKey: 'browser_concurrency',    type: 'number', defaultValue: 3 },
  { key: 'maxResultsPerSource', envKey: 'MOLEMINER_MAX_RESULTS_PER_SOURCE', tomlKey: 'max_results_per_source', type: 'number', defaultValue: 20 },
  { key: 'defaultMaxRounds',    envKey: 'MOLEMINER_MAX_ROUNDS',             tomlKey: 'default_max_rounds',     type: 'number' },
  { key: 'defaultSources',      envKey: 'MOLEMINER_SOURCES',                tomlKey: 'default_sources',        type: 'string' },
  { key: 'dbPath',              envKey: 'MOLEMINER_DB_PATH',                tomlKey: 'db_path',                type: 'string', defaultValue: join(homedir(), '.moleminer', 'moleminer.db') },
];

// Build lookup maps
const FIELD_BY_CAMEL = new Map(FIELDS.map(f => [f.key, f]));
const FIELD_BY_TOML = new Map(FIELDS.map(f => [f.tomlKey, f]));

/** Valid camelCase keys for setValue validation. */
const VALID_KEYS = new Set(FIELDS.map(f => f.key));

/** An LLM provider profile (stored in config.toml under [moleminer.profiles.<name>]). */
export interface LlmProfile {
  provider: string;
  model: string;
  fastModel?: string;
  apiKey: string;
  baseUrl?: string;
}

/** Built-in provider defaults for base URLs. */
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string; fastModel: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', fastModel: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6-20250514', fastModel: 'claude-haiku-4-5-20251001' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-3.1-pro-preview', fastModel: 'gemini-2.5-flash' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3', fastModel: 'llama3' },
};

export class Config {
  braveApiKey?: string;
  githubToken?: string;
  llmProvider?: string;
  llmModel?: string;
  llmFastModel?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmProfile?: string; // active profile name
  sourceTimeoutApi: number = 30;
  sourceTimeoutBrowser: number = 60;
  browserConcurrency: number = 3;
  maxResultsPerSource: number = 20;
  /** Default max rounds for search (overridden by --max-rounds flag). */
  defaultMaxRounds?: number;
  /** Default comma-separated source list (overridden by --sources flag). */
  defaultSources?: string;
  dbPath: string = join(homedir(), '.moleminer', 'moleminer.db');

  /** Saved LLM profiles (loaded from [moleminer.profiles.*] sections). */
  profiles: Record<string, LlmProfile> = {};

  /**
   * Load config from TOML file then apply env-var overrides.
   * Resolution order: defaults -> TOML -> env vars.
   */
  static load(configFile?: string): Config {
    const cfg = new Config();
    const tomlPath = configFile ?? DEFAULT_CONFIG_PATH;

    // 1. TOML file
    if (existsSync(tomlPath)) {
      try {
        const content = readFileSync(tomlPath, 'utf-8');
        const data = TOML.parse(content);
        const section = (data.moleminer ?? {}) as Record<string, unknown>;

        for (const [tomlKey, value] of Object.entries(section)) {
          if (tomlKey === 'profiles' && typeof value === 'object' && value !== null) {
            // Parse [moleminer.profiles.<name>] sections
            for (const [name, profileData] of Object.entries(value as Record<string, unknown>)) {
              const p = profileData as Record<string, unknown>;
              cfg.profiles[name] = {
                provider: String(p.provider ?? ''),
                model: String(p.model ?? ''),
                fastModel: p.fast_model ? String(p.fast_model) : undefined,
                apiKey: String(p.api_key ?? ''),
                baseUrl: p.base_url ? String(p.base_url) : undefined,
              };
            }
            continue;
          }
          const field = FIELD_BY_TOML.get(tomlKey);
          if (field) {
            (cfg as unknown as Record<string, unknown>)[field.key] = coerce(value, field.type);
          }
        }
      } catch {
        // Ignore parse errors — use defaults
      }
    }

    // 2. Env-var overrides (MOLEMINER_*)
    for (const field of FIELDS) {
      const envVal = process.env[field.envKey];
      if (envVal !== undefined) {
        (cfg as unknown as Record<string, unknown>)[field.key] = coerce(envVal, field.type);
      }
    }

    // 3. Apply active profile (overrides llm* fields if set)
    cfg.applyProfile();

    return cfg;
  }

  /**
   * Save non-default config values to TOML file.
   * Returns the path written to.
   */
  save(configFile?: string): string {
    const tomlPath = configFile ?? DEFAULT_CONFIG_PATH;
    mkdirSync(dirname(tomlPath), { recursive: true });

    const lines = ['[moleminer]'];
    for (const field of FIELDS) {
      const value = (this as Record<string, unknown>)[field.key];
      if (value === undefined || value === null) continue;
      if (field.key === 'dbPath') continue; // managed by system

      if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines.push(`${field.tomlKey} = "${escaped}"`);
      } else if (typeof value === 'boolean') {
        lines.push(`${field.tomlKey} = ${value ? 'true' : 'false'}`);
      } else if (typeof value === 'number') {
        lines.push(`${field.tomlKey} = ${value}`);
      }
    }

    // Write profiles
    for (const [name, profile] of Object.entries(this.profiles)) {
      lines.push('');
      lines.push(`[moleminer.profiles.${name}]`);
      lines.push(`provider = "${profile.provider}"`);
      lines.push(`model = "${profile.model}"`);
      if (profile.fastModel) lines.push(`fast_model = "${profile.fastModel}"`);
      lines.push(`api_key = "${profile.apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
      if (profile.baseUrl) lines.push(`base_url = "${profile.baseUrl}"`);
    }

    writeFileSync(tomlPath, lines.join('\n') + '\n', 'utf-8');

    if (platform() !== 'win32') {
      chmodSync(tomlPath, 0o600);
    }

    return tomlPath;
  }

  /** Apply the active llmProfile — overrides llm* fields from the named profile. */
  applyProfile(): void {
    const name = this.llmProfile;
    if (!name) {
      // No profile selected — apply provider defaults if provider is set but baseUrl is missing
      if (this.llmProvider && !this.llmBaseUrl) {
        const defaults = PROVIDER_DEFAULTS[this.llmProvider];
        if (defaults) {
          if (this.llmProvider === 'gemini') this.llmProvider = 'openai'; // gemini uses OpenAI compat
          this.llmBaseUrl = defaults.baseUrl;
          this.llmModel = this.llmModel ?? defaults.model;
          this.llmFastModel = this.llmFastModel ?? defaults.fastModel;
        }
      }
      return;
    }

    const profile = this.profiles[name];
    if (!profile) {
      // Profile name set but not found — check if it's a known provider shorthand
      const defaults = PROVIDER_DEFAULTS[name];
      if (defaults && this.llmApiKey) {
        this.llmProvider = name === 'gemini' ? 'openai' : name; // gemini uses OpenAI compat
        this.llmBaseUrl = defaults.baseUrl;
        this.llmModel = this.llmModel ?? defaults.model;
        this.llmFastModel = this.llmFastModel ?? defaults.fastModel;
      }
      return;
    }

    this.llmProvider = profile.provider === 'gemini' ? 'openai' : profile.provider;
    this.llmApiKey = profile.apiKey;
    this.llmModel = profile.model;
    this.llmFastModel = profile.fastModel;
    if (profile.baseUrl) {
      this.llmBaseUrl = profile.baseUrl;
    } else {
      const defaults = PROVIDER_DEFAULTS[profile.provider];
      if (defaults) this.llmBaseUrl = defaults.baseUrl;
    }
  }

  /** Save a new LLM profile. */
  saveProfile(name: string, profile: LlmProfile): void {
    this.profiles[name] = profile;
  }

  /** List all saved profile names. */
  listProfiles(): string[] {
    return Object.keys(this.profiles);
  }

  /** Check whether the required API key for the given source is configured. */
  hasKey(sourceName: string): boolean {
    const fieldName = SOURCE_KEY_MAP[sourceName];
    if (!fieldName) return false;
    return (this as Record<string, unknown>)[fieldName] != null;
  }

  /** Keys that should be managed via `moleminer profile`, not `config set`. */
  static readonly PROFILE_MANAGED_KEYS = new Set([
    'llmProvider', 'llmModel', 'llmFastModel', 'llmApiKey', 'llmBaseUrl',
  ]);

  /** Set a config field by camelCase name. */
  setValue(key: string, value: unknown): void {
    if (!VALID_KEYS.has(key)) {
      throw new Error(`Unknown config key: ${key}`);
    }
    if (Config.PROFILE_MANAGED_KEYS.has(key)) {
      throw new Error(
        `"${key}" is managed by LLM profiles. Use "moleminer profile add <name>" or "moleminer setup" instead.`,
      );
    }
    (this as Record<string, unknown>)[key] = value;
  }
}

/** Mask a secret value for display: show first 4 chars + ****. */
export function maskValue(value?: string | null): string {
  if (!value) return '(not set)';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****';
}

function coerce(value: unknown, type: 'string' | 'number'): unknown {
  if (type === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return String(value);
}
