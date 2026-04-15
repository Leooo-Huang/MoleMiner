import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { Config, maskValue } from '../src/config.js';

// Use a temp dir for test TOML files
const TEST_DIR = join(tmpdir(), 'moleminer-config-test-' + Date.now());
const TEST_TOML = join(TEST_DIR, 'config.toml');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Clear all MOLEMINER_ env vars
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MOLEMINER_')) {
      delete process.env[key];
    }
  }
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MOLEMINER_')) {
      delete process.env[key];
    }
  }
});

describe('Config', () => {
  it('should have correct defaults', () => {
    const cfg = Config.load(TEST_TOML); // file doesn't exist yet
    expect(cfg.llmProvider).toBeUndefined();
    expect(cfg.llmModel).toBeUndefined();
    expect(cfg.llmApiKey).toBeUndefined();
    expect(cfg.llmBaseUrl).toBeUndefined();
    expect(cfg.braveApiKey).toBeUndefined();
    expect(cfg.githubToken).toBeUndefined();
    expect(cfg.producthuntToken).toBeUndefined();
    expect(cfg.sourceTimeoutApi).toBe(30);
    expect(cfg.sourceTimeoutBrowser).toBe(60);
    expect(cfg.browserConcurrency).toBe(3);
    expect(cfg.maxResultsPerSource).toBe(20);
    expect(cfg.dbPath).toContain('moleminer.db');
  });

  it('should load from TOML file', () => {
    writeFileSync(TEST_TOML, [
      '[moleminer]',
      'brave_api_key = "toml-brave-key"',
      'llm_provider = "anthropic"',
      'source_timeout_api = 45',
      '',
    ].join('\n'));

    const cfg = Config.load(TEST_TOML);
    expect(cfg.braveApiKey).toBe('toml-brave-key');
    expect(cfg.llmProvider).toBe('anthropic');
    expect(cfg.sourceTimeoutApi).toBe(45);
    // Defaults still work for non-specified fields
    expect(cfg.sourceTimeoutBrowser).toBe(60);
  });

  it('should override with MOLEMINER_* env vars', () => {
    process.env.MOLEMINER_BRAVE_API_KEY = 'env-brave-key';
    process.env.MOLEMINER_LLM_PROVIDER = 'ollama';
    process.env.MOLEMINER_SOURCE_TIMEOUT_API = '99';

    const cfg = Config.load(TEST_TOML);
    expect(cfg.braveApiKey).toBe('env-brave-key');
    expect(cfg.llmProvider).toBe('ollama');
    expect(cfg.sourceTimeoutApi).toBe(99);
  });

  it('should let env vars override TOML values', () => {
    writeFileSync(TEST_TOML, [
      '[moleminer]',
      'brave_api_key = "toml-key"',
      'llm_provider = "openai"',
      '',
    ].join('\n'));
    process.env.MOLEMINER_BRAVE_API_KEY = 'env-key';

    const cfg = Config.load(TEST_TOML);
    expect(cfg.braveApiKey).toBe('env-key');
    // TOML value kept when no env override
    expect(cfg.llmProvider).toBe('openai');
  });

  it('should handle missing config file gracefully', () => {
    const cfg = Config.load(join(TEST_DIR, 'nonexistent.toml'));
    expect(cfg.sourceTimeoutApi).toBe(30);
    expect(cfg.braveApiKey).toBeUndefined();
  });

  it('hasKey should check source API key presence', () => {
    const cfg = Config.load(TEST_TOML);
    expect(cfg.hasKey('brave')).toBe(false);
    expect(cfg.hasKey('github')).toBe(false);
    expect(cfg.hasKey('unknown_source')).toBe(false);

    cfg.braveApiKey = 'some-key';
    expect(cfg.hasKey('brave')).toBe(true);
  });

  it('setValue should set known fields and reject unknown', () => {
    const cfg = Config.load(TEST_TOML);
    cfg.setValue('braveApiKey', 'new-key');
    expect(cfg.braveApiKey).toBe('new-key');

    cfg.setValue('sourceTimeoutApi', 99);
    expect(cfg.sourceTimeoutApi).toBe(99);

    expect(() => cfg.setValue('nonexistent_field', 'val')).toThrow(/Unknown config key/);
  });

  it('save should write TOML and re-load correctly', () => {
    const cfg = Config.load(TEST_TOML);
    cfg.braveApiKey = 'save-test-key';
    cfg.llmProvider = 'openai';
    cfg.sourceTimeoutApi = 55;

    const savedPath = cfg.save(TEST_TOML);
    expect(savedPath).toBe(TEST_TOML);

    const content = readFileSync(TEST_TOML, 'utf-8');
    expect(content).toContain('[moleminer]');
    expect(content).toContain('brave_api_key = "save-test-key"');

    // Re-load and verify round-trip
    const cfg2 = Config.load(TEST_TOML);
    expect(cfg2.braveApiKey).toBe('save-test-key');
    expect(cfg2.llmProvider).toBe('openai');
    expect(cfg2.sourceTimeoutApi).toBe(55);
  });
});

describe('maskValue', () => {
  it('should mask secrets correctly', () => {
    expect(maskValue(undefined)).toBe('(not set)');
    expect(maskValue('')).toBe('(not set)');
    expect(maskValue('short')).toBe('****');
    expect(maskValue('12345678')).toBe('****');
    expect(maskValue('123456789')).toBe('1234****');
    expect(maskValue('abcdefghijklmnop')).toBe('abcd****');
  });
});
