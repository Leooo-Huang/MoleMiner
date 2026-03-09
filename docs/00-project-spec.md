# MoleMiner (矿鼹) — Project Specification

## 项目定位

**LLM-powered multi-source search aggregation CLI tool.**

一个 Python CLI 工具，输入一个模糊意图，自动增强查询、并行搜索中外多平台、聚合去重、线索追踪，输出结构化结果。

一句话：`pip install moleminer && moleminer search "AI hackathon 2026"`

## 名字

- 英文：**moleminer**
- 中文：**矿鼹**（鼹鼠矿工，深挖信息）
- PyPI 包名：`moleminer`
- GitHub 仓库名：`moleminer`

## 目标

- GitHub 10k stars
- 填补市场空白：没有现成的 Python SDK 做 "LLM query 增强 + 多源并行搜索 + 线索解析"

## 竞品分析

| 项目 | Stars | 差异 |
|------|-------|------|
| SearXNG | ~15k | 无 LLM 增强，无社区搜索，无线索解析 |
| Perplexica | ~20k | TypeScript 全栈应用，不是 SDK/CLI |
| GPT Researcher | ~17k | 生成报告，不返回结构化搜索结果 |
| Tavily | 商业 | 闭源，不含社区路径 |
| MediaCrawler | ~45k | 爬虫，不做 query 增强和聚合；非商业协议 |

## 目标用户

1. **开发者 / AI Agent 构建者** — 需要多源搜索工具集成到 Agent
2. **研究人员 / 分析师** — 跨平台收集话题信息

## 产品形态

- **Python CLI** — `moleminer search "query"` 直接使用
- **Python SDK** — `from moleminer import search` 编程调用
- **可被 OpenClaw Skill 调用** — SKILL.md 中 `moleminer search "query"` 即可

## 许可证

MIT

---

## 技术决策

### 语言：Python

- MediaCrawler 思路参考（Playwright）
- last30days 代码复用（MIT 许可证）
- AI/数据处理生态
- 目标用户群体

### 代码来源

| 部分 | 来源 | 许可证 |
|------|------|--------|
| 国外社区搜索（Reddit/X/YouTube/HN） | 基于 last30days-openclaw 代码改造 | MIT（需 ATTRIBUTION） |
| 搜索引擎（Brave） | 基于 last30days brave_search.py 改造 | MIT |
| 去重/并行搜索 | 基于 last30days dedupe/parallel_search 改造 | MIT |
| 国内社区搜索（知乎/小红书/微博） | clean-room 自写（参考 MediaCrawler 思路，不抄代码） | 原创 |
| LLM query 增强 | 自写 | 原创 |
| 聚合/线索解析 | 自写 | 原创 |
| Tavily/Jina 集成 | 自写 | 原创 |

### 安装分层

```bash
pip install moleminer            # 核心：HN + GitHub + SO + Dev.to + Lobsters + Trafilatura
pip install moleminer[tavily]    # + Tavily Python SDK（高级功能）
pip install moleminer[social]    # + YouTube（yt-dlp）
pip install moleminer[cn]        # + 知乎/小红书/微博/Bilibili（Playwright + Cookie）
pip install moleminer[llm]       # + LLM Query Enhancement（openai）
pip install moleminer[all]       # 全部
```

零配置可用的源（无需任何 API key）：
- Hacker News（Algolia API，免费无限）
- GitHub（REST API，可选 token 提升限额）
- Stack Overflow（Stack Exchange API，推荐免费 key）
- Dev.to（Forem API，无需认证）
- Lobsters（JSON 端点，无需认证）

需要 API key 但不需要额外 Python 包（通过 config 配置）：
- Brave Search（$5/月免费额度）
- Tavily（1000 次/月免费）
- Exa（1000 次/月免费，语义搜索）
- Reddit（免费注册 OAuth app）
- Product Hunt（免费注册 token）

### 插件架构

参考 SearXNG engine 模式 + Perplexica registry 模式：

```python
class BaseSource(ABC):
    name: str
    source_type: str  # "api" | "scrape" | "browser"
    requires_auth: bool

    @abstractmethod
    async def search(self, queries: list[str]) -> list[SearchResult]:
        ...

    def enabled(self, config: Config) -> bool:
        """根据配置和凭证可用性决定是否启用"""
        ...
```

所有源注册到 SourceRegistry，pipeline 根据配置和可用性自动选择。

---

## 项目结构

```
moleminer/
├── pyproject.toml
├── README.md
├── LICENSE                      # MIT
├── ATTRIBUTION.md               # last30days 归属声明
├── src/
│   └── moleminer/
│       ├── __init__.py          # 对外 API: search()
│       ├── cli.py               # CLI 入口: moleminer search "query"
│       ├── config.py            # 配置管理（~/.moleminer/config.toml）
│       ├── pipeline.py          # 5 阶段管线编排
│       ├── enhance.py           # Stage 1: LLM query enhancement
│       ├── aggregate.py         # Stage 3: 去重、时效过滤、分类
│       ├── resolve.py           # Stage 4: 线索 → 机会
│       ├── models.py            # SearchResult, Lead, Config 等数据模型
│       ├── registry.py          # SourceRegistry: 源注册与发现
│       ├── auth.py              # 凭证管理（API key、Cookie）
│       ├── sources/             # Stage 2: 各信息源适配器
│       │   ├── base.py          # BaseSource ABC
│       │   ├── google.py        # Google web scraping（零配置，不可靠）
│       │   ├── hackernews.py    # HN Algolia API（零配置）
│       │   ├── brave.py         # Brave Search API（需 key）
│       │   ├── tavily.py        # Tavily 搜索（需 key）
│       │   ├── exa.py           # Exa 语义搜索（需 key）
│       │   ├── github.py        # GitHub REST API（可选 token）
│       │   ├── stackoverflow.py # Stack Exchange API（推荐 key）
│       │   ├── devto.py         # Dev.to / Forem API（无需 key）
│       │   ├── lobsters.py      # Lobsters JSON（无需 key）
│       │   ├── youtube.py       # YouTube via yt-dlp（无需 key）
│       │   ├── reddit.py        # Reddit App-only OAuth（需 key）
│       │   ├── producthunt.py   # Product Hunt GraphQL（需 token）
│       │   ├── zhihu.py         # 知乎搜索（Playwright + Cookie）
│       │   ├── xiaohongshu.py   # 小红书搜索（Playwright + Cookie）
│       │   ├── weibo.py         # 微博搜索（Playwright + Cookie）
│       │   └── bilibili.py      # Bilibili 搜索（逆向 API）
│       ├── store.py             # SQLite 存储（query 元信息 + 聚合结果）
│       └── utils/
│           ├── http.py          # HTTP 请求封装
│           ├── dedupe.py        # 去重逻辑
│           ├── extract.py       # 内容提取（Trafilatura）
│           └── jina_reader.py   # Jina Reader URL 内容提取
├── tests/
└── docs/
```

---

## CLI 接口设计

### 基本搜索

```bash
# 搜索，使用所有可用源
moleminer search "AI hackathon 2026"

# 指定源
moleminer search "AI hackathon" --sources google,reddit,zhihu

# 指定输出格式
moleminer search "AI hackathon" --format json
moleminer search "AI hackathon" --format table
moleminer search "AI hackathon" --format markdown
```

### 认证管理

```bash
# 设置 API key
moleminer auth set tavily <key>
moleminer auth set brave <key>

# 国内平台扫码登录
moleminer auth login zhihu        # 弹出浏览器，扫码
moleminer auth login xiaohongshu

# 查看认证状态
moleminer auth status
```

### 配置

```bash
# 查看/修改配置
moleminer config show
moleminer config set default_sources google,hackernews,tavily
moleminer config set llm_provider openai
moleminer config set llm_model gpt-4o-mini
```

### 其他

```bash
# 查看可用源
moleminer sources list

# 版本
moleminer --version
```

---

## SDK 接口设计

```python
from moleminer import search, search_async

# 同步搜索
results = search("AI hackathon 2026")

# 异步搜索
results = await search_async("AI hackathon 2026")

# 带参数
results = search(
    "AI hackathon",
    sources=["google", "reddit", "zhihu"],
    enhance_query=True,          # 启用 LLM query 增强
    resolve_leads=True,          # 启用线索解析
    max_results=50,
    output_format="dict",        # dict | SearchResult objects
)

# 结果结构
for r in results:
    print(r.title)        # 标题
    print(r.url)          # 链接
    print(r.source)       # 来源平台
    print(r.snippet)      # 摘要
    print(r.result_type)  # "direct" | "lead"
    print(r.timestamp)    # 发布时间
    print(r.metadata)     # 额外信息
```

---

## 5 阶段管线（更新版）

### Stage 1: Query Enhancement

LLM 将用户输入扩展为平台化搜索词。

- 实现方式：调用 LLM API（支持 OpenAI / Anthropic / 本地模型）
- 可选：`--no-enhance` 跳过增强，直接用原始 query
- 每个平台生成 2-3 个变体 query

### Stage 2: Parallel Dispatch

并行调用所有启用的源。

| 源 | 依赖 | 免费 | 需登录 |
|----|------|------|--------|
| google.py | 无 | 是（不可靠） | 否 |
| hackernews.py | 无 | 是 | 否 |
| github.py | 无 | 是（可选 token） | 否 |
| stackoverflow.py | 无 | 是（推荐 key） | 否 |
| devto.py | 无 | 是 | 否 |
| lobsters.py | 无 | 是 | 否 |
| brave.py | API key | $5/月 | 否 |
| tavily.py | API key | 1000次/月 | 否 |
| exa.py | API key | 1000次/月 | 否 |
| reddit.py | OAuth app | 是（免费注册） | 否 |
| youtube.py | yt-dlp | 是 | 否 |
| producthunt.py | OAuth token | 是（免费注册） | 否 |
| zhihu.py | Playwright | 是 | 是（Cookie） |
| xiaohongshu.py | Playwright | 是 | 是（Cookie） |
| weibo.py | Playwright | 是 | 是（Cookie） |
| bilibili.py | Playwright | 是 | 否 |

### Stage 3: Aggregate

- URL 精确去重
- 标题模糊去重（基于 last30days 的 dedupe 逻辑）
- 时效过滤
- 分类：direct vs lead

### Stage 4: Lead Resolution

- 从 lead 中提取提到的实体名称
- 用 Tavily / Google 搜索官方链接
- 用 Jina / Tavily extract 提取页面内容
- 失败则丢弃

### Stage 5: Output & Store

- CLI: 格式化输出（table / json / markdown）
- SDK: 返回 SearchResult 列表
- 自动入库 SQLite：存储 query 元信息（搜索词、时间、使用的源）+ 聚合结果
- 不做评分（评分是上层应用如 Radar 的职责）

---

## 配置文件

`~/.moleminer/config.toml`

```toml
[general]
default_sources = ["google", "hackernews"]
max_results = 50
timeout = 30

[llm]
provider = "openai"      # openai | anthropic | local
model = "gpt-4o-mini"
api_key_env = "OPENAI_API_KEY"

[auth]
# API keys（也可通过环境变量或 moleminer auth set 设置）
tavily_key_env = "TAVILY_API_KEY"
brave_key_env = "BRAVE_API_KEY"

[browser]
headless = true
cookie_dir = "~/.moleminer/cookies/"
```

---

## 开发计划

### Phase 1: MVP — 基础框架 ✅ 已完成

- [x] 项目脚手架（pyproject.toml, src layout, CLI entry point）
- [x] BaseSource ABC + SourceRegistry
- [x] google.py（web scraping — 不可靠，Phase 2 补充替代方案）
- [x] hackernews.py（Algolia API）
- [x] jina.py（搜索功能已失效，Phase 2 转为内容提取工具）
- [x] aggregate.py（基础去重 + 分类）
- [x] store.py（SQLite 自动存储）
- [x] CLI: `moleminer search "query"` 输出 table/json/markdown

### Phase 2: 架构重构 + 源扩展（12 个源）

- [ ] config.py（Config 系统：TOML + 环境变量）
- [ ] BaseSource.enabled(config) 改签名
- [ ] Registry 修复（双实例化 bug + config 传递 + 懒加载）
- [ ] Pipeline 升级（Config、超时、错误日志）
- [ ] SearchResult 加 language 字段
- [ ] Trafilatura 内容提取（utils/extract.py）
- [ ] Jina 从搜索源转为内容提取工具（utils/jina_reader.py）
- [ ] brave.py（Brave Search API）
- [ ] tavily.py（Tavily API，httpx 直调）
- [ ] exa.py（Exa 语义搜索）
- [ ] github.py（GitHub REST API）
- [ ] stackoverflow.py（Stack Exchange API）
- [ ] devto.py（Forem API）
- [ ] lobsters.py（JSON 端点）
- [ ] youtube.py（yt-dlp，零配置）
- [ ] reddit.py（App-only OAuth via httpx）
- [ ] producthunt.py（GraphQL API）

### Phase 3: LLM 增强

- [ ] enhance.py（Query Enhancement — 生成平台化搜索词）
- [ ] 支持 OpenAI / Anthropic

### Phase 4: Lead Resolution

- [ ] resolve.py（从 lead 提取实体 → 搜官方链接）
- [ ] 内容提取链：Trafilatura → Jina Reader → Tavily Extract
- [ ] Exa findSimilar 集成

### Phase 5: 中国平台

- [ ] zhihu.py（Playwright, clean-room）
- [ ] xiaohongshu.py（Playwright, clean-room）
- [ ] weibo.py（Playwright, clean-room）
- [ ] bilibili.py（逆向 API）
- [ ] auth login 流程（扫码）

### Phase 6: 打磨

- [ ] README + demo GIF
- [ ] 完整测试
- [ ] GitHub Actions CI
- [ ] 文档站
- [ ] PyPI 发布
