<p align="center">
  <img src="docs/assets/banner.png" alt="MoleMiner" width="600" />
</p>

<h3 align="center">AI-powered deep research from your terminal.<br/>One query. 12 platforms. Recursive discovery.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/moleminer"><img src="https://img.shields.io/npm/v/moleminer.svg?style=flat-square&color=4fc3f7" alt="npm version" /></a>
  <a href="https://github.com/Leo-Cyberautonomy/MoleMiner/actions"><img src="https://img.shields.io/github/actions/workflow/status/Leo-Cyberautonomy/MoleMiner/ci.yml?style=flat-square&label=tests" alt="CI" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="Node.js" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#sources">Sources</a> &middot;
  <a href="#web-ui">Web UI</a> &middot;
  <a href="#commands">Commands</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

<!-- TODO: Replace with actual demo GIF once recorded -->
<!-- <p align="center"><img src="docs/assets/demo.gif" alt="MoleMiner Demo" width="700" /></p> -->

## Highlights

- **12 sources in parallel** -- Brave, Reddit, HN, GitHub, Stack Overflow, YouTube, Dev.to, Zhihu, Xiaohongshu, Weibo, WeChat, X
- **AI recursive loop** -- LLM classifies results as direct/lead/irrelevant, extracts entities, generates new queries, follows leads automatically
- **Smart scope detection** -- AI infers geographic scope (local/national/global) and auto-adjusts search granularity, result quotas, and content extraction depth
- **Deep search mode** -- `--deep` enables MECE 6-dimension expansion (WHAT/WHERE/WHEN/WHO/HOW/SOURCE) for comprehensive coverage
- **Terminal-native** -- JSON output for AI agents, Markdown export, fully pipe-friendly
- **Web visualization** -- 3D globe view, search history, source management, QR login for Chinese platforms via `moleminer web`
- **Multi-LLM** -- OpenAI, Gemini, Anthropic, Ollama (local). Switch with `moleminer profile use`

## Quick Start

```bash
npm install -g moleminer
moleminer setup                            # interactive wizard (~2 min)
moleminer search "AI startup funding 2026"
```

That's it. The setup wizard configures your LLM provider and API key.

## How It Works

```
Round 0:  AI generates queries (smart source selection)
            |
            v
          12 sources searched in parallel
            |
            v
          AI classifies: direct / lead / irrelevant
            |
            v
          AI extracts entities with confidence scores
            |
Round 1:  AI generates new queries from high-confidence entities
            |
            v
          Search again -> classify -> extract -> ...
            |
Round N:  No new entities found -> stop -> output results
```

MoleMiner doesn't just search -- it **researches**. Each round discovers new entities (companies, policies, people, technologies) and searches for them, building a comprehensive picture that no single search engine provides.

### SearchScope -- Adaptive Granularity

The AI automatically detects the geographic scope of your query and adapts its strategy:

| Scope | Example query | Strategy |
|-------|--------------|----------|
| **Local** | "深圳AI创业补贴" | Few queries, deep results per district, low concurrency for gov sites |
| **National** | "中国AI政策" | Balanced depth and breadth across cities |
| **Global** | "AI hackathon 2026" | Many queries spread across regions, few results per query for even coverage |

No configuration needed -- the LLM decides the scope and the pipeline adapts automatically.

## Sources

| Category | Global | China |
|----------|--------|-------|
| Search engine | Brave | -- |
| Community | Reddit, Hacker News | -- |
| Q&A | Stack Overflow | Zhihu |
| Code | GitHub | -- |
| Video | YouTube | -- |
| Blog | Dev.to | WeChat |
| Social | X / Twitter | Weibo, Xiaohongshu |

AI automatically selects which sources to query based on your search language and topic. Chinese queries search Chinese platforms. English queries search global platforms.

## Web UI

```bash
moleminer web    # opens browser at localhost:3456
```

A full dashboard with sidebar navigation, search history, source management (enable/disable toggle), settings, and a 3D digital globe visualization of geo-located results.

- **3D Globe** -- Cyber-style dark globe with glowing markers. Click markers to see results at that location.
- **Source Management** -- Toggle sources on/off. Auth sources (Zhihu, Weibo, XHS) show QR login modal when enabled without credentials.
- **QR Login** -- Scan QR codes directly in the browser for Chinese platforms. No need to switch to CLI.
- **Live Search** -- Search from the web UI with real-time SSE progress updates.

## Examples

```bash
# Deep research with dimension expansion (MECE 6-dimension framework)
moleminer search "AI hackathon 2026" --deep

# Local scope -- AI auto-detects city-level and searches by district
moleminer search "深圳 AI 创业补贴政策" --deep

# Normal search (no dimension expansion, still uses smart scope)
moleminer search "best practices for RAG pipelines"

# JSON output for AI agent integration
moleminer search "LLM inference optimization" --format json

# Export results with AI summary
moleminer search "startup accelerators" --export report.md --summary

# Search specific sources only
moleminer search "python async" --sources github,stackoverflow
```

## Commands

| Command | Description |
|---------|-------------|
| `moleminer search <query>` | AI-powered recursive search |
| `moleminer setup` | Interactive configuration wizard |
| `moleminer doctor` | Check environment and diagnose issues |
| `moleminer web` | Start web visualization UI |
| `moleminer sources` | List all sources and their status |
| `moleminer login <platform>` | QR/browser login for platforms |
| `moleminer profile use <name>` | Switch LLM provider profile |
| `moleminer history` | Browse past searches |

### Search Options

```
-s, --sources <list>     Comma-separated source names
-f, --format <type>      terminal | table | json | markdown | report
-r, --max-rounds <n>     Max recursive rounds (default: 3)
-d, --deep               Deep search: MECE dimension expansion + adaptive scope
-v, --verbose            Show full URLs, sources, and summaries
-e, --export <path>      Export results to file (respects --format)
    --summary            Generate AI summary (with --export)
```

## Configuration

```bash
moleminer config list    # show all settings
moleminer config path    # show config file location (~/.moleminer/config.toml)
```

All settings can be overridden via `MOLEMINER_*` environment variables. Use **profiles** to switch between LLM providers:

```bash
moleminer profile add work -p openai -k sk-...
moleminer profile add local -p ollama
moleminer profile use work
```

## Prerequisites

- **Node.js 18+**
- **An LLM API key** (OpenAI / Gemini / Anthropic / Ollama local)
- **Cost**: ~$0.01-0.10 per search (LLM API calls). Search sources are free.
- **Optional**: Playwright for Chinese platform login (`npm install playwright`)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Adding a new search source is straightforward -- implement the `BaseSource` interface and register it. See [the sources directory](ts/src/sources/) for examples.

## License

[MIT](LICENSE)
