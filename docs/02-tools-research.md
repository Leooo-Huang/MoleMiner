# MoleMiner — Tools & Dependencies Research

## 调研日期：2026-03-09（更新：2026-03-10）

---

## 搜索源全景（2026-03-10 调研更新）

### Web 搜索引擎层

| 源 | 方式 | 免费额度 | API Key | 状态 |
|----|------|---------|---------|------|
| **Google scraping** | HTML 抓取 | 无限 | 不需要 | ⚠️ 不可靠（JS 渲染页面） |
| **Brave Search** | REST API | $5/月 | 需要 | ✅ 独立索引，schema 增强 |
| **Tavily** | REST API | 1000 次/月 | 需要 | ✅ AI-native，含内容提取 |
| **Exa** | REST API | 1000 次/月 | 需要 | ✅ 语义搜索 + findSimilar |

**已排除的 Web 搜索方案：**

| 方案 | 排除原因 |
|------|---------|
| Serper | 和 Google scraping 重复（都是 Google 结果） |
| SerpAPI | 和 Serper 重复，更贵（$25/1K vs $0.30/1K） |
| DuckDuckGo (ddgs) | 社区维护、ToS 风险、和 Google scraping 重复 |
| Google Custom Search API | 只能搜特定站点，不是通用搜索 |
| Bing API | 2026-08 退役 |
| Perplexity Sonar | 返回 LLM 综合答案而非原始结果，不适合聚合 |
| You.com API | 文档不透明，长期稳定性存疑 |

### 社区/平台层

**Tier 1 — 免费，易接入：**

| 源 | 方式 | Auth | Python 包 |
|----|------|------|-----------|
| **Hacker News** | Algolia API | 不需要 | httpx 直调 |
| **GitHub** | REST API | 可选（token 提升限额） | httpx 直调 |
| **Stack Overflow** | Stack Exchange API v2.3 | 推荐免费 key（300→10000/天） | httpx 直调 |
| **Dev.to** | Forem API v1 | 不需要 | httpx 直调 |
| **Lobsters** | JSON 端点 | 不需要 | httpx 直调 |

**Tier 2 — 需要认证：**

| 源 | 方式 | Auth | Python 包 |
|----|------|------|-----------|
| **YouTube** | yt-dlp (`ytsearch10:query`) | 不需要 | yt-dlp |
| **Reddit** | App-only OAuth via httpx | client_id + secret（免费注册） | httpx 直调 |
| **Product Hunt** | GraphQL API | OAuth token（免费注册） | httpx 直调 |

**Tier 3 — 中国平台（Playwright）：**

| 源 | 方式 | Auth |
|----|------|------|
| **知乎** | Playwright + Cookie | 需登录 |
| **小红书** | Playwright + Cookie | 部分需要 |
| **微博** | Playwright / 受限 API | 需登录 |
| **Bilibili** | 逆向 API | 不需要 |
| **微信公众号** | 待定（wechatsogou 已废弃） | 待定 |

**已排除/延后的社区源：**

| 源 | 原因 |
|----|------|
| X/Twitter | 官方 API $200/月起，搜索仅 7 天，性价比极差 |
| Medium | 官方 API 已废弃，非官方不可靠 |
| Discord | 无全局搜索 API |
| Mastodon | 无全局搜索，需逐实例查询，认证才能搜帖子 |
| Telegram | 需个人账号+手机认证，搜索范围有限 |
| wechatsogou | 2019 年最后更新，搜狗微信索引已失效 |

### 内容提取层（Lead Resolution）

| 工具 | 方式 | 速率 | 用途 |
|------|------|------|------|
| **Trafilatura** | 本地 Python 库 | 无限 | **首选** — F1=0.909，纯本地 |
| **Jina Reader** | `r.jina.ai/{url}` API | 20 RPM(无key)/200 RPM(免费key) | 远程 URL 抓取+清洗 |
| **Tavily Extract** | `POST /extract` API | 包含在 Tavily 额度内 | 批量提取 20 URL/次 |

**提取优先级链：** Trafilatura（本地）→ Jina Reader（需远程抓取时）→ Tavily Extract（已配置时）

**已排除的提取方案：**

| 方案 | 原因 |
|------|------|
| Firecrawl | 贵（$19/月起） |
| Crawl4AI | 太重（需要浏览器） |
| newspaper4k | 精度不如 Trafilatura |
| Jina Search (s.jina.ai) | 已改为付费（401），搜索功能用 Brave/Tavily 替代 |

---

## 可复用代码：last30days-openclaw (MIT)

来源：https://github.com/mvanhorn/last30days-skill
许可证：**MIT**（可直接复用，需注明归属）

### 可复用模块

| 文件 | 功能 | 用于 moleminer 的 |
|------|------|-------------------|
| `hackernews.py` | HN Algolia API 搜索（免费无 key） | hackernews.py source |
| `dedupe.py` | URL/标题去重 | aggregate.py |
| `normalize.py` | 结果归一化 | aggregate.py |
| `parallel_search.py` | 并行搜索编排 | pipeline.py |
| `entity_extract.py` | 实体提取 | resolve.py |
| `http.py` | HTTP 请求封装 | utils/http.py |
| `models.py` / `schema.py` | 数据模型 | models.py 参考 |

注：`brave_search.py`、`reddit.py`、`bird_x.py` 参考了思路，但实际实现使用各平台官方 API，不直接复用 last30days 代码。

### 需要剥离的 OpenClaw 依赖

- `env.py` — OpenClaw 路径和密钥管理 → 替换为 moleminer config.py
- `store.py` — OpenClaw 存储 → 替换为 moleminer store.py（SQLite）
- `render.py` / `ui.py` — OpenClaw 输出格式 → 替换为 moleminer CLI 输出

---

## 参考但不引入：MediaCrawler

- **GitHub**: https://github.com/NanmiCoder/MediaCrawler (~45k stars)
- **许可证**: 非商业学习协议 1.1 — **不可作为依赖或复制代码**
- **参考价值**: 知乎/小红书/微博的搜索流程、反爬策略、页面结构
- **moleminer 做法**: clean-room 实现，参考思路但代码完全自写

---

## 竞品架构参考

### SearXNG 引擎模式

- 引擎是 Python 模块，实现 `request()` + `response()` 两个函数
- 模块级变量定义元数据（categories, paging 等）
- YAML 驱动注册，同一引擎可配多个实例
- **借鉴**: 简洁的引擎接口设计

### Perplexica ActionRegistry

- TypeScript `ActionRegistry` 单例，手动注册 action
- 每个 action 有 `enabled()` 方法动态启停
- Reciprocal Rank Fusion 合并结果
- **借鉴**: `enabled()` 模式、结果重排

### Scrapy Pipeline

- 优先级排序的中间件链
- `from_crawler()` 依赖注入
- **借鉴**: pipeline 阶段链式处理概念

---

## 依赖规划

### 核心依赖（必装）

```
httpx          # async HTTP 客户端
click          # CLI 框架
rich           # 终端输出格式化
trafilatura    # 内容提取（Lead Resolution）
```

### 可选依赖

```
# [tavily] — Tavily Python SDK（高级功能）
tavily-python

# [social] — YouTube 搜索
yt-dlp

# [cn] — 中国平台浏览器自动化
playwright

# [llm] — LLM Query Enhancement
openai         # 或 anthropic
```

注：Brave、Exa、Reddit、GitHub、SO、Dev.to、Lobsters、Product Hunt 均使用 httpx 直调，**不需要额外 Python 包**，只需配置 API key。

---

## 不采用的方案及原因

| 方案 | 原因 |
|------|------|
| 封装 MediaCrawler 为依赖 | 非商业许可证，不是 library，不可控 |
| 封装 last30days 为依赖 | 是 OpenClaw skill 不是 pip 包，但代码可复用（MIT） |
| 用 LangChain 做编排 | 太重，Perplexica 已移除 LangChain 的前车之鉴 |
| SearXNG 作为后端 | 需要部署独立服务，增加用户门槛 |
| TikHub 商业 API | 付费，限制用户群 |
| RSSHub | RSS 模式不适合主动搜索 |
| PRAW (Reddit) | 重型 OAuth 库，httpx 直调 app-only OAuth 更轻量 |
| YouTube Data API v3 | 100 次/天上限，yt-dlp 零配置无限制 |
| ScrapeCreators API | 付费第三方，Reddit 官方 OAuth 免费 |
