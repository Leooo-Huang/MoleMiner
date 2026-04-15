/**
 * Interactive setup wizard for MoleMiner.
 *
 * Four steps:
 *   1. AI Engine     — choose provider, enter API key (required)
 *   2. Brave Search  — optional API key for web search
 *   3. GitHub Token  — optional token for higher rate limits
 *   4. Platform Logins — QR/browser login for CN + X sources
 */

import { Config } from './config.js';
import { playwrightLogin } from './utils/cookies.js';
import { hasCookies } from './utils/cookies.js';
import { ask, askSecret, askYesNo, askChoice } from './utils/prompt.js';
import type { LlmProfile } from './config.js';

const PROVIDERS = [
  {
    name: 'openai',
    label: 'OpenAI (GPT-5.4 + GPT-4o-mini)',
    keyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
    fastModel: 'gpt-4o-mini',
  },
  {
    name: 'gemini',
    label: 'Google Gemini (gemini-3.1-pro + gemini-2.5-flash)',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-3.1-pro-preview',
    fastModel: 'gemini-2.5-flash',
  },
  {
    name: 'anthropic',
    label: 'Anthropic (claude-sonnet-4-6 + claude-haiku-4-5)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6-20250514',
    fastModel: 'claude-haiku-4-5-20251001',
  },
  {
    name: 'ollama',
    label: 'Ollama (local — no API key needed)',
    keyUrl: '',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    fastModel: 'llama3',
  },
] as const;

/** Platforms that require browser login. */
const LOGIN_PLATFORMS = [
  { name: 'zhihu',        label: '知乎 (Zhihu)',          description: 'Chinese Q&A platform — terminal QR code' },
  { name: 'xiaohongshu',  label: '小红书 (Xiaohongshu)',  description: 'Chinese lifestyle platform — terminal QR code' },
  { name: 'weibo',        label: '微博 (Weibo)',           description: 'Chinese social media — terminal QR code' },
  { name: 'x',            label: 'X / Twitter',            description: 'Visible browser window — log in with any method' },
] as const;

function hr() {
  console.log('\n' + '─'.repeat(60));
}

function step(n: number, total: number, title: string) {
  console.log(`\nStep ${n}/${total}: ${title}`);
}

/**
 * Run the interactive setup wizard.
 * Returns the number of setup steps completed.
 */
export async function runSetup(): Promise<void> {
  console.log('\nWelcome to MoleMiner Setup');
  console.log('This wizard configures your AI engine, search API keys,');
  console.log('and platform logins. Press Ctrl+C at any time to exit.\n');

  const config = Config.load();
  let anyChange = false;

  // ─────────────────────────────────────────────────────────────
  // Step 1: AI Engine
  // ─────────────────────────────────────────────────────────────
  hr();
  step(1, 4, 'AI Engine (required)');
  console.log('MoleMiner uses an LLM to generate queries, classify results,');
  console.log('and extract entities. You need at least one provider.\n');

  const existingProfile = config.llmProfile && config.profiles[config.llmProfile]
    ? config.profiles[config.llmProfile]
    : null;

  if (existingProfile) {
    console.log(`  Current: ${existingProfile.provider} / ${existingProfile.model}`);
    const keep = await askYesNo('Keep existing AI engine?', true);
    if (keep) {
      console.log('  AI engine unchanged.');
    } else {
      await configureProvider(config);
      anyChange = true;
    }
  } else {
    await configureProvider(config);
    anyChange = true;
  }

  // ─────────────────────────────────────────────────────────────
  // Step 2: Brave Search API key (optional)
  // ─────────────────────────────────────────────────────────────
  hr();
  step(2, 4, 'Brave Search API key (optional)');
  console.log('Brave is the primary web search engine for non-CN queries.');
  console.log('Free tier: 2,000 queries/month');
  console.log('Get your key: https://brave.com/search/api/\n');

  if (config.braveApiKey) {
    console.log(`  Current key: ${config.braveApiKey.slice(0, 4)}****`);
    const replace = await askYesNo('Replace existing Brave key?', false);
    if (replace) {
      const key = await askSecret('  Brave Search API key (Enter to skip)');
      if (key) {
        config.braveApiKey = key;
        anyChange = true;
      }
    }
  } else {
    const key = await askSecret('  Brave Search API key (Enter to skip)');
    if (key) {
      config.braveApiKey = key;
      anyChange = true;
    } else {
      console.log('  Skipped — brave source will be disabled.');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 3: GitHub Token (optional)
  // ─────────────────────────────────────────────────────────────
  hr();
  step(3, 4, 'GitHub Token (optional)');
  console.log('A GitHub token increases rate limits for the GitHub source.');
  console.log('Generate one at: https://github.com/settings/tokens');
  console.log('No special scopes needed (public access only).\n');

  if (config.githubToken) {
    console.log(`  Current token: ${config.githubToken.slice(0, 7)}****`);
    const replace = await askYesNo('Replace existing GitHub token?', false);
    if (replace) {
      const token = await askSecret('  GitHub token (Enter to skip)');
      if (token) {
        config.githubToken = token;
        anyChange = true;
      }
    }
  } else {
    const token = await askSecret('  GitHub token (Enter to skip)');
    if (token) {
      config.githubToken = token;
      anyChange = true;
    } else {
      console.log('  Skipped — GitHub source works without a token (lower rate limits).');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 4: Platform logins
  // ─────────────────────────────────────────────────────────────
  hr();
  step(4, 4, 'Platform Logins (optional)');
  console.log('Log in to access Chinese platforms and X/Twitter.');
  console.log('Credentials are stored locally in ~/.moleminer/cookies/.\n');

  let hasPlaywright = false;
  try {
    await import('playwright');
    hasPlaywright = true;
  } catch {
    // not installed
  }

  if (!hasPlaywright) {
    console.log('  Playwright is not installed — login requires it.');
    console.log('  To install: npm install playwright && npx playwright install chromium');
    console.log('  Skipping platform logins for now.\n');
  }

  for (const platform of LOGIN_PLATFORMS) {
    if (!hasPlaywright) break;

    const alreadyLoggedIn = hasCookies(platform.name);
    const statusText = alreadyLoggedIn ? '(already logged in)' : '(not logged in)';
    console.log(`\n  ${platform.label} ${statusText}`);
    console.log(`  ${platform.description}`);

    let prompt: string;
    if (alreadyLoggedIn) {
      prompt = `  Re-login to ${platform.label}?`;
    } else {
      prompt = `  Login to ${platform.label}?`;
    }

    const doLogin = await askYesNo(prompt, !alreadyLoggedIn);
    if (!doLogin) {
      console.log('  Skipped.');
      continue;
    }

    console.log(`\n  Starting login for ${platform.label}...`);
    try {
      const result = await playwrightLogin(platform.name, {
        onStatus: (msg: string) => console.log(`  ${msg}`),
      });
      console.log(`  Login successful for ${platform.label}. (${result.cookieCount} cookies saved)`);
    } catch {
      console.log(`  Login failed or timed out for ${platform.label}.`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Save and summarise
  // ─────────────────────────────────────────────────────────────
  hr();
  console.log('\nSetup complete!\n');

  if (anyChange) {
    const path = config.save();
    console.log(`  Configuration saved to ${path}`);
  }

  // Summary
  const finalConfig = Config.load();
  const { createDefaultRegistry } = await import('./sources/index.js');
  const registry = createDefaultRegistry();
  const sources = registry.listSources().sort();
  const enabled = sources.filter(n => registry.getSource(n).enabled(finalConfig));

  console.log(`\n  ${enabled.length}/${sources.length} sources enabled: ${enabled.join(', ')}`);
  console.log(`\n  Config file: ~/.moleminer/config.toml`);
  console.log('\n  Try it now:');
  console.log('    moleminer search "AI startup funding 2026"');
  console.log('    moleminer doctor          # full status report');
  console.log('');
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function configureProvider(config: Config): Promise<void> {
  const idx = await askChoice(
    'Choose an AI provider:',
    PROVIDERS.map(p => p.label),
  );
  const provider = PROVIDERS[idx];

  let apiKey = '';
  if (provider.name !== 'ollama') {
    console.log(`\n  Get your key at: ${provider.keyUrl}`);
    apiKey = await askSecret(`  ${provider.label.split(' ')[0]} API key`);
    if (!apiKey) {
      console.log('  No key entered — AI engine configuration skipped.');
      return;
    }
  }

  const profile: LlmProfile = {
    provider: provider.name,
    model: provider.model,
    fastModel: provider.fastModel,
    apiKey,
    baseUrl: provider.baseUrl,
  };

  config.saveProfile('default', profile);
  config.llmProfile = 'default';
  console.log(`\n  AI engine set to ${provider.label}.`);
}
