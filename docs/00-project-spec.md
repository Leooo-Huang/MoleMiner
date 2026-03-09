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
pip install moleminer            # 核心：Google/Bing scraping + HN（零配置）
pip install moleminer[tavily]    # + Tavily 搜索和提取（需 API key）
pip install moleminer[brave]     # + Brave Search（需 API key，免费 2000次/月）
pip install moleminer[social]    # + Reddit/X（需 ScrapeCreators API key）
pip install moleminer[cn]        # + 知乎/小红书/微博（Playwright + Cookie）
pip install moleminer[all]       # 全部
```

零配置可用的源：
- Google/Bing web scraping（无需 key）
- Hacker News（Algolia API，免费无需 key）
- Jina Reader（免费无需 key）

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
│       │   ├── google.py        # Google/Bing web scraping（零配置）
│       │   ├── hackernews.py    # HN Algolia API（零配置）
│       │   ├── jina.py          # Jina Reader 页面提取（零配置）
│       │   ├── tavily.py        # Tavily 搜索 + 提取（需 key）
│       │   ├── brave.py         # Brave Search API（需 key）
│       │   ├── reddit.py        # Reddit 搜索（需 key）
│       │   ├── x.py             # X 搜索（需 key）
│       │   ├── youtube.py       # YouTube 搜索
│       │   ├── zhihu.py         # 知乎搜索（Playwright + Cookie）
│       │   ├── xiaohongshu.py   # 小红书搜索（Playwright + Cookie）
│       │   ├── weibo.py         # 微博搜索（Playwright + Cookie）
│       │   └── wechat.py        # 搜狗微信搜索
│       ├── store.py             # SQLite 存储（query 元信息 + 聚合结果）
│       └── utils/
│           ├── http.py          # HTTP 请求封装
│           └── dedupe.py        # 去重逻辑
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
| google.py | 无 | 是 | 否 |
| hackernews.py | 无 | 是 | 否 |
| jina.py | 无 | 是 | 否 |
| brave.py | API key | 2000次/月 | 否 |
| tavily.py | API key | 有免费额度 | 否 |
| reddit.py | API key | 取决于 provider | 否 |
| x.py | API key | 取决于 provider | 否 |
| youtube.py | 待定 | 待定 | 否 |
| zhihu.py | Playwright | 是 | 是（Cookie） |
| xiaohongshu.py | Playwright | 是 | 是（Cookie） |
| weibo.py | Playwright | 是 | 是（Cookie） |
| wechat.py | 无 | 是 | 否 |

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

### Phase 1: MVP — 零配置可用

- [ ] 项目脚手架（pyproject.toml, src layout, CLI entry point）
- [ ] BaseSource ABC + SourceRegistry
- [ ] google.py（web scraping）
- [ ] hackernews.py（基于 last30days 代码）
- [ ] jina.py（页面提取）
- [ ] aggregate.py（基础去重 + 时效过滤）
- [ ] CLI: `moleminer search "query"` 输出 table/json
- [ ] 发布 PyPI

目标：`pip install moleminer && moleminer search "AI hackathon"` 能跑

### Phase 2: 搜索引擎扩展

- [ ] tavily.py
- [ ] brave.py（基于 last30days 代码）
- [ ] auth.py（API key 管理）
- [ ] config.py（配置文件）

### Phase 3: 国外社区

- [ ] reddit.py（基于 last30days 代码）
- [ ] x.py（基于 last30days bird_x 代码）
- [ ] youtube.py
- [ ] parallel_search（基于 last30days 代码）

### Phase 4: LLM 增强

- [ ] enhance.py（query enhancement）
- [ ] resolve.py（lead resolution）
- [ ] 支持 OpenAI / Anthropic / 本地模型

### Phase 5: 国内社区

- [ ] zhihu.py（Playwright, clean-room）
- [ ] xiaohongshu.py（Playwright, clean-room）
- [ ] weibo.py（Playwright, clean-room）
- [ ] wechat.py（搜狗微信）
- [ ] auth login 流程（扫码）

### Phase 6: 打磨

- [ ] README + demo GIF
- [ ] 完整测试
- [ ] GitHub Actions CI
- [ ] 文档站
