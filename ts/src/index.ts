#!/usr/bin/env node
/**
 * MoleMiner CLI entry point.
 *
 * Commands:
 *   search <query>           AI-powered multi-source recursive search (default)
 *   sources                  List available sources and their status
 *   sources test <name>      Run a test query on a specific source
 *   config list              Show all configuration values
 *   config set <k> <v>       Set a configuration value
 *   config path              Show path to config file
 *   profile add <name>       Save a new LLM provider profile
 *   profile list             List saved profiles
 *   profile use <name>       Switch active profile
 *   doctor                   Check environment and configuration
 *   setup                    Interactive setup wizard
 *   login <platform>         QR/browser login for CN sources and X
 *   logout <platform>        Clear stored cookies
 *   web                      Start web visualization UI
 *   history                  List recent searches
 *   history show <id>        Show details for a specific search
 *
 * Exit codes:
 *   0  success
 *   1  configuration error (no LLM, missing key, unknown source)
 *   2  LLM failure (all AI calls failed)
 *   3  all sources failed (network/timeout)
 */

import { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { Config, maskValue, SOURCE_SETUP_INFO } from './config.js';
import { createLlmFromConfig } from './llm.js';
import { Pipeline } from './pipeline.js';
import { SearchStore } from './store.js';
import { createDefaultRegistry } from './sources/index.js';
import { formatJson, formatTable, formatMarkdown, formatTerminal, formatReport } from './output.js';
import { computeImportanceScores } from './utils/scoring.js';
import { aiGenerateReport } from './ai.js';
import type { SearchResponse } from './models.js';
import { hasCookies, clearCookies, playwrightLogin } from './utils/cookies.js';
import { runSetup } from './setup.js';

const VERSION = '0.3.0';

function showBanner(): string {
  const art = [
    '    ╔╦╗╔═╗╦  ╔═╗╔╦╗╦╔╗╔╔═╗╦═╗',
    '    ║║║║ ║║  ║╣ ║║║║║║║║╣ ╠╦╝',
    '    ╩ ╩╚═╝╩═╝╚═╝╩ ╩╩╝╚╝╚═╝╩╚═',
  ];
  const lines = [
    '',
    ...art.map(line => chalk.cyan(line)),
    chalk.dim(`    v${VERSION}  ·  AI-powered multi-source search`),
    '',
  ];
  return lines.join('\n');
}

const KNOWN_COMMANDS = [
  'search', 'sources', 'setup', 'config', 'profile', 'doctor',
  'login', 'logout', 'history', 'web', 'help',
];

const program = new Command('moleminer')
  .version(VERSION, '-V, --version')
  .description('AI-powered multi-source recursive search')
  .addHelpText('beforeAll', showBanner());

// ─── search ───────────────────────────────────────────────────────────────

program
  .command('search <query>')
  .description('Search across multiple sources with AI-powered recursive lead tracking')
  .option('-s, --sources <list>', 'comma-separated source names (overrides config default)')
  .option('-f, --format <type>', 'output format: terminal|table|json|markdown|report', 'terminal')
  .option('-r, --max-rounds <n>', 'max recursive rounds (overrides config default)')
  .option('-v, --verbose', 'show full results in terminal mode (URLs, sources, summaries)')
  .option('-d, --deep', 'deep search: dimension expansion, cross-language queries, broader coverage')
  .option('-e, --export <path>', 'auto-export results to Markdown file after search')
  .option('--summary', 'use LLM to generate structured summary in export (requires --export)')
  .action(async (query: string, opts: { sources?: string; format: string; maxRounds?: string; verbose?: boolean; deep?: boolean; export?: string; summary?: boolean }) => {
    const config = Config.load();

    // First-run detection
    if (!config.llmProvider && !config.llmProfile && Object.keys(config.profiles).length === 0) {
      console.error('\nNo AI engine configured.');
      console.error('Run "moleminer setup" to get started.\n');
      process.exitCode = 1;
      return;
    }

    // --summary requires --export
    if (opts.summary && !opts.export) {
      console.error('--summary requires --export <path>. Example: moleminer search "query" --export results.md --summary');
      process.exitCode = 1;
      return;
    }

    const registry = createDefaultRegistry();
    const llm = createLlmFromConfig(config);
    const store = config.dbPath ? await SearchStore.create(config.dbPath) : undefined;

    const pipeline = new Pipeline(registry, config, store, llm ?? undefined);

    // Source list: CLI flag → config default → undefined (all enabled)
    const sourceList = opts.sources
      ? opts.sources.split(',').map(s => s.trim())
      : config.defaultSources
        ? config.defaultSources.split(',').map(s => s.trim())
        : undefined;

    // Max rounds: CLI flag → config default → 3
    const maxRoundsRaw = opts.maxRounds ?? String(config.defaultMaxRounds ?? 3);
    const maxRounds = parseInt(maxRoundsRaw, 10) || 3;

    let response: SearchResponse;
    try {
      response = await pipeline.search(query, {
        sources: sourceList,
        maxRounds,
        deep: opts.deep,
        onProgress: (event) => {
          switch (event.type) {
            case 'round_start':
              process.stderr.write(`\n[Round ${event.round}/${event.maxRounds}] `);
              break;
            case 'generating_queries':
              process.stderr.write('Generating queries...\n');
              break;
            case 'queries_generated':
              process.stderr.write(`  → ${event.activeCount} sources, ${event.skippedCount} skipped (${event.language})\n`);
              break;
            case 'dispatching':
              process.stderr.write(`  Searching ${event.sourceCount} sources...`);
              break;
            case 'dispatch_done': {
              const ok  = event.statuses.filter(s => s.status === 'ok');
              const err = event.statuses.filter(s => s.status === 'error' || s.status === 'timeout');
              const parts = ok.map(s => `${s.name}(${s.resultCount})`);
              if (err.length > 0) parts.push(...err.map(s => `✗${s.name}`));
              process.stderr.write(` ${parts.join(' ')}\n`);
              process.stderr.write(`  ${event.resultCount} raw results\n`);
              break;
            }
            case 'classifying':
              process.stderr.write(`  Classifying ${event.resultCount} results (${event.batchCount} batch${event.batchCount > 1 ? 'es' : ''})...\n`);
              break;
            case 'classified':
              process.stderr.write(`  → ${event.directCount} direct, ${event.leadCount} leads\n`);
              break;
            case 'extracting_entities':
              process.stderr.write(`  Extracting entities from ${event.leadCount} leads...\n`);
              break;
            case 'entities_extracted':
              process.stderr.write(`  → ${event.entities.join(', ')}\n`);
              break;
            case 'converged':
              process.stderr.write(`  Converged: ${event.reason}\n`);
              break;
            case 'extracting_content':
              process.stderr.write(`\n  Reading ${event.totalUrls} pages...`);
              break;
            case 'content_extracted':
              process.stderr.write(` ${event.successCount} ok, ${event.failCount} failed\n`);
              break;
          }
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('LLM') || msg.includes('API') || msg.includes('model')) {
        console.error(`\nLLM error: ${msg}`);
        process.exitCode = 2;
      } else {
        console.error(`\nSearch failed: ${msg}`);
        process.exitCode = 3;
      }
      if (store) store.close();
      return;
    }

    // Check if all sources failed
    const allFailed = response.sources.length > 0 &&
      response.sources.every(s => s.status === 'error' || s.status === 'timeout' || s.status === 'skipped');
    if (allFailed && response.results.length === 0) {
      process.exitCode = 3;
    }

    // When --export is specified with a non-default --format, use the unified
    // pipeline (printOutput handles both stdout and file).  When format is
    // the default 'terminal', use generateRawExport which preserves full
    // page content (the format functions truncate summaries).
    const useUnifiedExport = opts.export && opts.format !== 'terminal';

    if (useUnifiedExport) {
      await printOutput(response, opts.format, llm ?? undefined, opts.verbose, opts.export);
    } else {
      await printOutput(response, opts.format, llm ?? undefined, opts.verbose);

      // Legacy export path: full-content Markdown export
      if (opts.export && store) {
        const latestSearches = store.listSearches(1);
        if (latestSearches.length > 0) {
          const searchId = latestSearches[0].id as number;
          const search = store.getSearch(searchId);
          const rawResults = store.getResults(searchId);

          if (search && rawResults.length > 0) {
            let md: string;
            if (opts.summary && llm) {
              // Generate AI report (generic, not policy-specific)
              process.stderr.write('\nGenerating AI summary for export...\n');
              const report = await aiGenerateReport(response, llm);
              md = formatReport(report);
            } else {
              md = generateRawExport(query, rawResults, search);
            }

            const { writeFileSync: writeFile } = await import('node:fs');
            writeFile(opts.export, md, 'utf-8');
            process.stderr.write(`\nExported to ${opts.export} (${rawResults.length} results, ${(md.length / 1024).toFixed(1)} KB)\n`);
          }
        }
      }
    }

    if (store) store.close();
  });

// ─── sources ──────────────────────────────────────────────────────────────

const sourcesCmd = program
  .command('sources')
  .description('List available sources and their status');

sourcesCmd
  .option('--json', 'output as JSON')
  .action((opts: { json?: boolean }) => {
    const config = Config.load();
    const registry = createDefaultRegistry();
    const names = registry.listSources().sort();

    if (opts.json) {
      const data = names.map(name => {
        const source = registry.getSource(name);
        return {
          name,
          type: source.sourceType,
          requiresAuth: source.requiresAuth,
          enabled: source.enabled(config),
        };
      });
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const lines: string[] = [];
    lines.push(`${'Name'.padEnd(16)} ${'Type'.padEnd(10)} ${'Auth'.padEnd(6)} Status`);
    lines.push('-'.repeat(55));

    let enabledCount = 0;
    for (const name of names) {
      const source = registry.getSource(name);
      const enabled = source.enabled(config);
      if (enabled) enabledCount++;
      const status = enabled ? 'enabled' : 'disabled';
      const auth = source.requiresAuth ? 'yes' : 'no';
      lines.push(`${name.padEnd(16)} ${source.sourceType.padEnd(10)} ${auth.padEnd(6)} ${status}`);
    }

    lines.push('');
    lines.push(`${enabledCount}/${names.length} sources enabled`);
    lines.push('');
    lines.push('Use "moleminer sources test <name>" to run a live test on a source.');
    console.log(lines.join('\n'));
  });

sourcesCmd
  .command('test <name>')
  .description('Run a live test query on a specific source')
  .option('-q, --query <q>', 'test query', 'AI startup 2025')
  .action(async (name: string, opts: { query: string }) => {
    const config = Config.load();
    const registry = createDefaultRegistry();

    let source;
    try {
      source = registry.getSource(name);
    } catch {
      console.error(`Unknown source: ${name}`);
      console.error(`Available: ${registry.listSources().sort().join(', ')}`);
      process.exitCode = 1;
      return;
    }

    if (!source.enabled(config)) {
      console.error(`Source "${name}" is disabled (missing API key, cookies, or optional dependency).`);
      console.error('Run "moleminer doctor" for details.');
      process.exitCode = 1;
      return;
    }

    source.configure(config);
    console.log(`Testing source "${name}" with query: "${opts.query}"`);

    const start = Date.now();
    try {
      const results = await source.search([opts.query]);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`✓ ${results.length} results in ${elapsed}s`);
      if (results.length > 0) {
        console.log(`  [1] ${results[0].title}`);
        console.log(`      ${results[0].url}`);
      }
      if (results.length > 1) {
        console.log(`  [2] ${results[1].title}`);
      }
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`✗ Error after ${elapsed}s: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

// ─── config ───────────────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage configuration values');

configCmd
  .command('list')
  .description('Show all configuration values (secrets are masked)')
  .action(() => {
    const config = Config.load();
    const lines: string[] = [];
    lines.push(`${'Key'.padEnd(26)} Value`);
    lines.push('-'.repeat(70));

    const entries = configEntries(config);
    for (const [key, value] of entries) {
      const isSecret = /key|token/i.test(key);
      const display = value == null
        ? '(not set)'
        : isSecret
          ? maskValue(String(value))
          : String(value);
      lines.push(`${key.padEnd(26)} ${display}`);
    }
    console.log(lines.join('\n'));
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value and save to config file')
  .action((key: string, value: string) => {
    const config = Config.load();
    try {
      config.setValue(key, value);
    } catch (err) {
      console.error(err instanceof Error ? err.message : `Unknown config key: ${key}`);
      process.exitCode = 1;
      return;
    }
    const path = config.save();
    console.log(`Set ${key} → saved to ${path}`);
  });

configCmd
  .command('path')
  .description('Show the path to the config file')
  .action(() => {
    console.log(join(homedir(), '.moleminer', 'config.toml'));
  });

// ─── profile ──────────────────────────────────────────────────────────────

const profileCmd = program.command('profile').description('Manage LLM provider profiles');

profileCmd
  .command('add <name>')
  .description('Save a new LLM provider profile')
  .requiredOption('-p, --provider <provider>', 'provider name (openai, anthropic, gemini, ollama)')
  .requiredOption('-k, --key <apiKey>', 'API key')
  .option('-m, --model <model>', 'model name')
  .option('-F, --fast-model <model>', 'fast model for classification')
  .option('-u, --base-url <url>', 'custom base URL')
  .action((name: string, opts: { provider: string; key: string; model?: string; fastModel?: string; baseUrl?: string }) => {
    const config = Config.load();
    config.saveProfile(name, {
      provider: opts.provider,
      model: opts.model ?? '',
      fastModel: opts.fastModel,
      apiKey: opts.key,
      baseUrl: opts.baseUrl,
    });
    const path = config.save();
    console.log(`Profile "${name}" saved to ${path}`);
  });

profileCmd
  .command('list')
  .description('List saved LLM profiles')
  .action(() => {
    const config = Config.load();
    const profiles = config.listProfiles();
    if (profiles.length === 0) {
      console.log('No profiles saved. Use "moleminer profile add <name>" to create one.');
      return;
    }
    console.log(`Active: ${config.llmProfile ?? '(none)'}\n`);
    for (const name of profiles) {
      const p = config.profiles[name];
      const marker = name === config.llmProfile ? ' ←' : '';
      console.log(`  ${name}${marker}`);
      console.log(`    provider: ${p.provider}, model: ${p.model}, fast: ${p.fastModel ?? '(default)'}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a saved LLM profile')
  .action((name: string) => {
    const config = Config.load();
    if (!config.profiles[name]) {
      console.error(`Profile "${name}" not found. Available: ${config.listProfiles().join(', ') || '(none)'}`);
      process.exitCode = 1;
      return;
    }
    config.llmProfile = name;
    const path = config.save();
    const p = config.profiles[name];
    console.log(`Switched to "${name}" (${p.provider}/${p.model})`);
    console.log(`Saved to ${path}`);
  });

// ─── doctor ───────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Check environment, dependencies, and API key configuration')
  .action(async () => {
    const config = Config.load();
    const registry = createDefaultRegistry();
    const issues: string[] = [];

    console.log('\nMoleMiner Doctor\n');

    // Environment
    console.log('Environment:');
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (nodeMajor >= 18) {
      console.log(`  OK  Node.js: ${nodeVersion}`);
    } else {
      console.log(`  X   Node.js: ${nodeVersion} (requires >=18)`);
      issues.push('Upgrade Node.js to version 18 or later: https://nodejs.org/');
    }

    let playwrightInstalled = false;
    let chromiumInstalled = false;
    try {
      const pw = await import('playwright');
      playwrightInstalled = true;
      const execPath = pw.chromium.executablePath();
      const { existsSync } = await import('node:fs');
      chromiumInstalled = execPath ? existsSync(execPath) : false;
    } catch {
      // playwright not installed
    }

    if (playwrightInstalled) {
      console.log('  OK  Playwright: installed');
      if (chromiumInstalled) {
        console.log('  OK  Chromium: installed');
      } else {
        console.log('  !   Chromium: not installed');
        issues.push('Install Chromium for login: npx playwright install chromium');
      }
    } else {
      console.log('  -   Playwright: not installed (needed for zhihu, xiaohongshu, weibo, x)');
      console.log('  -   Chromium: n/a');
    }

    // LLM
    console.log('LLM:');
    if (config.llmProvider) {
      console.log(`  OK  Provider: ${config.llmProvider}`);
      console.log(`  OK  Model: ${config.llmModel ?? '(default)'}`);
      if (config.llmApiKey) {
        console.log(`  OK  API Key: ${maskValue(config.llmApiKey)}`);
      } else if (config.llmProvider !== 'ollama') {
        console.log('  !   API Key: not set');
        issues.push('Set llmApiKey: moleminer config set llmApiKey <key>');
      }
    } else if (config.llmProfile && config.profiles[config.llmProfile]) {
      const p = config.profiles[config.llmProfile];
      console.log(`  OK  Profile: ${config.llmProfile} (${p.provider}/${p.model})`);
      console.log(`  OK  API Key: ${maskValue(p.apiKey)}`);
    } else {
      console.log('  X   Not configured');
      issues.push('Configure LLM: moleminer setup');
    }

    // LLM connectivity test
    const llm = createLlmFromConfig(config);
    if (llm) {
      process.stdout.write('  Testing LLM connectivity...');
      try {
        const response = await llm.extractJson<{ ok: boolean }>(
          'Respond with exactly: {"ok": true}',
          { system: 'You are a connectivity test. Output only valid JSON.', model: config.llmFastModel },
        );
        if (response && 'ok' in response) {
          process.stdout.write(' OK\n');
        } else {
          process.stdout.write(' unexpected response\n');
          issues.push('LLM responded but returned unexpected format');
        }
      } catch (err) {
        process.stdout.write(` failed: ${err instanceof Error ? err.message : String(err)}\n`);
        issues.push('LLM connectivity failed — check API key and network');
      }
    }

    // API Keys
    console.log('\nAPI Keys:');
    for (const [field, info] of Object.entries(SOURCE_SETUP_INFO)) {
      const value = (config as unknown as Record<string, unknown>)[field] as string | undefined;
      if (value) {
        console.log(`  OK  ${info.source}: ${maskValue(value)}`);
      } else {
        console.log(`  -   ${info.source}: not configured (${info.freeTier})`);
      }
    }

    // Sources
    console.log('\nSources:');
    const names = registry.listSources().sort();
    let enabledCount = 0;
    for (const name of names) {
      const source = registry.getSource(name);
      if (source.enabled(config)) {
        enabledCount++;
        console.log(`  OK  ${name}`);
      } else {
        console.log(`  -   ${name}: disabled`);
      }
    }
    console.log(`\n${enabledCount}/${names.length} sources enabled.`);

    // Flag missing Playwright if auth sources have cookies
    if (!playwrightInstalled) {
      const authSources = ['zhihu', 'xiaohongshu', 'weibo', 'x'];
      const hasAnyCookies = authSources.some(n => hasCookies(n));
      if (hasAnyCookies) {
        issues.push('Playwright needed for login-based sources: npm install playwright && npx playwright install chromium');
      }
    }

    if (issues.length > 0) {
      console.log('\nRecommendations:');
      for (const issue of issues) {
        console.log(`  → ${issue}`);
      }
    } else {
      console.log('\nAll checks passed.');
    }
    console.log('');
  });

// ─── setup ────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Interactive setup wizard — configure AI engine, API keys, and platform logins')
  .action(async () => {
    await runSetup();
  });

// ─── login / logout ───────────────────────────────────────────────────────

const SUPPORTED_PLATFORMS = ['zhihu', 'xiaohongshu', 'weibo', 'x'];

program
  .command('login <platform>')
  .description('Login to a platform via QR code or browser (zhihu, xiaohongshu, weibo, x)')
  .option('-t, --timeout <seconds>', 'login timeout in seconds', '120')
  .action(async (platform: string, opts: { timeout: string }) => {
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      console.error(`Unknown platform: ${platform}. Supported: ${SUPPORTED_PLATFORMS.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    if (hasCookies(platform)) {
      const { validateCookies } = await import('./utils/cookies.js');
      const status = await validateCookies(platform);
      if (status === 'valid') {
        console.log(`✓ Already logged in to ${platform} (cookies valid).`);
        return;
      }
      console.log(`Cookies for ${platform} expired. Re-logging in...`);
      clearCookies(platform);
    }

    const timeoutMs = (parseInt(opts.timeout, 10) || 120) * 1000;

    try {
      const result = await playwrightLogin(platform, {
        timeout: timeoutMs,
        onStatus: (msg) => console.log(msg),
      });
      console.log(`\n✓ ${platform} login successful! (${result.cookieCount} cookies saved)`);
      console.log(`  Cookies: ${result.path}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ Login failed: ${msg}`);
      process.exitCode = 1;
    }
  });

program
  .command('logout <platform>')
  .description('Clear stored cookies for a platform')
  .action((platform: string) => {
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      console.error(`Unknown platform: ${platform}. Supported: ${SUPPORTED_PLATFORMS.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    if (clearCookies(platform)) {
      console.log(`✓ Logged out from ${platform}. Cookies cleared.`);
    } else {
      console.log(`No cookies found for ${platform}.`);
    }
  });

// ─── web ─────────────────────────────────────────────────────────────────

program
  .command('web')
  .description('Start web visualization UI')
  .option('-p, --port <port>', 'HTTP server port', '3456')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (opts: { port: string; open: boolean }) => {
    const config = Config.load();
    const dbPath = config.dbPath || join(homedir(), '.moleminer', 'searches.db');
    const store = await SearchStore.create(dbPath);
    const registry = createDefaultRegistry();
    for (const name of registry.listSources()) {
      registry.getSource(name).configure(config);
    }
    const llm = createLlmFromConfig(config);
    if (!llm) {
      console.error('LLM not configured. Run "moleminer setup" first.');
      process.exitCode = 1;
      store.close();
      return;
    }

    const { createWebServer } = await import('./web/server.js');
    const server = createWebServer({ store, registry, config, llm });
    const port = parseInt(opts.port, 10);

    const { exec } = await import('node:child_process');
    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(showBanner());
      console.log(`MoleMiner Web UI running at ${url}`);

      if (opts.open) {
        const cmd = process.platform === 'win32' ? `start ${url}`
          : process.platform === 'darwin' ? `open ${url}`
          : `xdg-open ${url}`;
        exec(cmd);
      }
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      server.close();
      store.close();
      process.exit(0);
    });
  });

// ─── history ──────────────────────────────────────────────────────────────

const historyCmd = program.command('history').description('Manage search history');

historyCmd
  .option('-n, --limit <n>', 'number of recent searches to show', '20')
  .action(async (opts: { limit: string }) => {
    const config = Config.load();
    const store = await SearchStore.create(config.dbPath);
    const limit = parseInt(opts.limit, 10) || 20;
    const searches = store.listSearches(limit);

    if (searches.length === 0) {
      console.log('No search history yet.');
      store.close();
      return;
    }

    const lines: string[] = [];
    lines.push(`${'ID'.padEnd(5)} ${'Query'.padEnd(50)} ${'Results'.padEnd(8)} Date`);
    lines.push('-'.repeat(90));

    for (const s of searches) {
      const id    = String(s.id ?? '').padEnd(5);
      const query = String(s.query ?? '').slice(0, 50).padEnd(50);
      const count = String(s.result_count ?? 0).padEnd(8);
      const date  = String(s.searched_at ?? '').slice(0, 19).replace('T', ' ');
      lines.push(`${id} ${query} ${count} ${date}`);
    }

    console.log(lines.join('\n'));
    store.close();
  });

historyCmd
  .command('show <id>')
  .description('Show results for a specific search by ID')
  .option('-f, --format <type>', 'output format: terminal|table|json|markdown|report', 'terminal')
  .option('-v, --verbose', 'show full results in terminal mode (URLs, sources, summaries)')
  .action(async (id: string, opts: { format: string; verbose?: boolean }) => {
    const config = Config.load();
    const store = await SearchStore.create(config.dbPath);
    const searchId = parseInt(id, 10);

    const search = store.getSearch(searchId);
    if (!search) {
      console.error(`No search found with ID ${id}`);
      process.exitCode = 1;
      store.close();
      return;
    }

    const rawResults = store.getResults(searchId);
    const results = rawResults.map(r => ({
      title:      String(r.title ?? ''),
      url:        String(r.url ?? ''),
      source:     String(r.source ?? ''),
      snippet:    String(r.snippet ?? ''),
      resultType: (r.result_type === 'direct' || r.result_type === 'lead')
        ? r.result_type
        : undefined,
      timestamp:  r.timestamp ? String(r.timestamp) : undefined,
      metadata:   r.metadata ? JSON.parse(String(r.metadata)) as Record<string, unknown> : undefined,
      summary:    r.summary ? String(r.summary) : undefined,
    } as import('./models.js').SearchResult));

    const response: SearchResponse = {
      results,
      sources: [],
      query: String(search.query ?? ''),
      totalResults: results.length,
      rounds: 1,
    };

    const llm = createLlmFromConfig(config);
    await printOutput(response, opts.format, llm ?? undefined, opts.verbose);
    store.close();
  });

/** Demote markdown headings in page content so they don't clash with result-level headings. */
function demoteHeadings(text: string): string {
  return text.replace(/^(#{1,5})\s/gm, (_, hashes: string) => '#' + hashes + ' ');
}

historyCmd
  .command('export <id>')
  .description('Export a search to file (default: Markdown with full content)')
  .option('-f, --format <type>', 'output format: json|markdown|table|report (default: full-content markdown)')
  .option('-o, --output <path>', 'output file path (default: moleminer-<id>.{ext})')
  .option('--summary', 'Generate structured summary using LLM (concise policy brief)')
  .action(async (id: string, opts: { format?: string; output?: string; summary?: boolean }) => {
    const config = Config.load();
    const store = await SearchStore.create(config.dbPath);
    const searchId = parseInt(id, 10);

    const search = store.getSearch(searchId);
    if (!search) {
      console.error(`No search found with ID ${id}`);
      process.exitCode = 1;
      store.close();
      return;
    }

    const rawResults = store.getResults(searchId);
    const query = String(search.query ?? '');

    // When --format is specified, use the unified format pipeline (write to file directly)
    if (opts.format) {
      const results = rawResults.map(r => ({
        title:      String(r.title ?? ''),
        url:        String(r.url ?? ''),
        source:     String(r.source ?? ''),
        snippet:    String(r.snippet ?? ''),
        resultType: (r.result_type === 'direct' || r.result_type === 'lead')
          ? r.result_type
          : undefined,
        timestamp:  r.timestamp ? String(r.timestamp) : undefined,
        metadata:   r.metadata ? JSON.parse(String(r.metadata)) as Record<string, unknown> : undefined,
        summary:    r.summary ? String(r.summary) : undefined,
      } as import('./models.js').SearchResult));

      const response: SearchResponse = {
        results,
        sources: [],
        query,
        totalResults: results.length,
        rounds: 1,
      };

      const ext = opts.format === 'json' ? 'json' : opts.format === 'markdown' ? 'md' : 'txt';
      const outPath = opts.output ?? `moleminer-${searchId}.${ext}`;
      const llm = createLlmFromConfig(config);
      // printOutput writes to stdout AND file
      await printOutput(response, opts.format, llm ?? undefined, false, outPath);
      store.close();
      return;
    }

    // Default: full-content export (preserves complete summary text)
    let md: string;
    if (opts.summary) {
      const llm = createLlmFromConfig(config);
      if (!llm) {
        console.error('LLM not configured. Run "moleminer setup" first.');
        process.exitCode = 1;
        store.close();
        return;
      }
      // Build SearchResponse from raw DB records for aiGenerateReport
      const results = rawResults.map(r => ({
        title:      String(r.title ?? ''),
        url:        String(r.url ?? ''),
        source:     String(r.source ?? ''),
        snippet:    String(r.snippet ?? ''),
        resultType: (r.result_type === 'direct' || r.result_type === 'lead')
          ? r.result_type
          : undefined,
        timestamp:  r.timestamp ? String(r.timestamp) : undefined,
        metadata:   r.metadata ? JSON.parse(String(r.metadata)) as Record<string, unknown> : undefined,
        summary:    r.summary ? String(r.summary) : undefined,
      } as import('./models.js').SearchResult));
      const resp: SearchResponse = { results, sources: [], query, totalResults: results.length, rounds: 1 };
      process.stderr.write('Generating AI summary for export...\n');
      const report = await aiGenerateReport(resp, llm);
      md = formatReport(report);
    } else {
      md = generateRawExport(query, rawResults, search);
    }

    const outPath = opts.output ?? `moleminer-${searchId}.md`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, md, 'utf-8');
    console.log(`Exported to ${outPath} (${rawResults.length} results, ${(md.length / 1024).toFixed(1)} KB)`);
    store.close();
  });

/** Raw export: full page content dump. */
function generateRawExport(
  query: string,
  rawResults: Record<string, unknown>[],
  search: Record<string, unknown>,
): string {
  const lines: string[] = [];
  lines.push(`# ${query}`);
  lines.push('');
  lines.push(`> 搜索时间: ${search.searched_at}  `);
  lines.push(`> 结果数: ${rawResults.length}  `);
  lines.push(`> 来源: ${search.sources_used}`);
  lines.push('');

  const directs = rawResults.filter(r => r.result_type === 'direct');
  const leads = rawResults.filter(r => r.result_type !== 'direct');

  for (const section of [
    { label: '直接来源', items: directs },
    { label: '线索', items: leads },
  ]) {
    if (section.items.length === 0) continue;
    lines.push(`## ${section.label} (${section.items.length})`);
    lines.push('');
    for (const r of section.items) {
      lines.push(`### ${r.title}`);
      lines.push('');
      lines.push(`- **URL**: ${r.url}`);
      lines.push(`- **来源**: ${r.source}`);
      if (r.timestamp) lines.push(`- **时间**: ${r.timestamp}`);
      lines.push('');
      const body = r.summary ? demoteHeadings(String(r.summary)) : String(r.snippet ?? '');
      if (body) lines.push(body);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Output helper ─────────────────────────────────────────────────────────

/**
 * Unified output: format → stdout and/or file.
 *
 * When exportPath is set AND format is not 'terminal', the same formatted
 * string is written to both stdout and the file.  When format is 'terminal'
 * and exportPath is set, the file gets markdown (terminal unicode is not
 * useful in a file) while stdout still gets the rich terminal output.
 */
async function printOutput(
  response: SearchResponse,
  format: string,
  llm?: ReturnType<typeof createLlmFromConfig>,
  verbose?: boolean,
  exportPath?: string,
): Promise<void> {
  // Enrich with importance scores for all formats
  const scored = computeImportanceScores(response.results);
  const enriched: SearchResponse = { ...response, results: scored };

  let output: string;

  if (format === 'json') {
    output = formatJson(enriched);
  } else if (format === 'markdown') {
    output = formatMarkdown(enriched.results);
  } else if (format === 'table') {
    const parts: string[] = [];
    if (enriched.sources.length > 0) {
      const sourceParts = enriched.sources.map(s =>
        s.status === 'ok' ? `${s.name}(${s.resultCount})` : `${s.name}(${s.status})`,
      );
      parts.push(`Sources: ${sourceParts.join(' ')}\n`);
    }
    parts.push(formatTable(enriched.results));
    output = parts.join('\n');
  } else if (format === 'report') {
    if (!llm) {
      console.error('--format report requires a configured LLM. Run "moleminer setup" first.');
      process.stderr.write('Falling back to terminal format...\n');
      output = formatTerminal(enriched, verbose);
      format = 'terminal';
    } else {
      process.stderr.write('\nGenerating AI report...\n');
      try {
        const report = await aiGenerateReport(enriched, llm);
        output = formatReport(report);
      } catch (err) {
        process.stderr.write(`Report generation failed: ${err instanceof Error ? err.message : String(err)}\n`);
        process.stderr.write('Falling back to terminal format...\n');
        output = formatTerminal(enriched, verbose);
        format = 'terminal';
      }
    }
  } else {
    // Default: rich terminal format
    output = formatTerminal(enriched, verbose);
  }

  // Write to stdout
  console.log(output);

  // Write to file if requested
  if (exportPath) {
    const { writeFileSync } = await import('node:fs');
    // Terminal format degrades to markdown in file (unicode borders are not useful in files)
    const fileContent = format === 'terminal' ? formatMarkdown(enriched.results) : output;
    writeFileSync(exportPath, fileContent, 'utf-8');
    process.stderr.write(`\nExported to ${exportPath} (${(fileContent.length / 1024).toFixed(1)} KB)\n`);
  }
}

// ─── Default command handling ──────────────────────────────────────────────

/** If the first arg is not a known command, prepend 'search' for convenience. */
function preprocessArgs(argv: string[]): string[] {
  const args = [...argv];
  if (args.length > 2) {
    const firstArg = args[2];
    if (!KNOWN_COMMANDS.includes(firstArg) && !firstArg.startsWith('-')) {
      args.splice(2, 0, 'search');
    }
  }
  return args;
}

/** Extract config entries for display (config list command). */
function configEntries(config: Config): [string, unknown][] {
  return [
    ['braveApiKey',          config.braveApiKey],
    ['githubToken',          config.githubToken],
    ['llmProvider',          config.llmProvider],
    ['llmModel',             config.llmModel],
    ['llmFastModel',         config.llmFastModel],
    ['llmApiKey',            config.llmApiKey],
    ['llmBaseUrl',           config.llmBaseUrl],
    ['llmProfile',           config.llmProfile],
    ['defaultSources',       config.defaultSources],
    ['defaultMaxRounds',     config.defaultMaxRounds],
    ['sourceTimeoutApi',     config.sourceTimeoutApi],
    ['sourceTimeoutBrowser', config.sourceTimeoutBrowser],
    ['browserConcurrency',   config.browserConcurrency],
    ['maxResultsPerSource',  config.maxResultsPerSource],
    ['dbPath',               config.dbPath],
  ];
}

// Export for testing
export { program, preprocessArgs, printOutput };

// Run CLI only when executed directly (not when imported by tests)
const isTest =
  typeof process !== 'undefined' &&
  (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test');

if (!isTest) {
  const processedArgs = preprocessArgs(process.argv);
  program.parseAsync(processedArgs);
}
