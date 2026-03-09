# MoleMiner — Tools & Dependencies Research

## 调研日期：2026-03-09

---

## 可复用代码：last30days-openclaw (MIT)

来源：https://github.com/mvanhorn/last30days-skill
许可证：**MIT**（可直接复用，需注明归属）

### 可复用模块

| 文件 | 功能 | 用于 moleminer 的 |
|------|------|-------------------|
| `hackernews.py` | HN Algolia API 搜索（免费无 key） | hackernews.py source |
| `brave_search.py` | Brave Search API | brave.py source |
| `reddit.py` | Reddit 搜索（ScrapeCreators API） | reddit.py source |
| `bird_x.py` + vendor/ | X 搜索 | x.py source |
| `dedupe.py` | URL/标题去重 | aggregate.py |
| `score.py` | 结果评分 | utils/score.py |
| `normalize.py` | 结果归一化 | aggregate.py |
| `parallel_search.py` | 并行搜索编排 | pipeline.py |
| `entity_extract.py` | 实体提取 | resolve.py |
| `http.py` | HTTP 请求封装 | utils/http.py |
| `models.py` / `schema.py` | 数据模型 | models.py 参考 |

### 需要剥离的 OpenClaw 依赖

- `env.py` — OpenClaw 路径和密钥管理 → 替换为 moleminer 自己的 config.py
- `store.py` — OpenClaw 存储 → 替换为 moleminer 自己的 store.py（SQLite）
- `render.py` / `ui.py` — OpenClaw 输出格式 → 替换为 moleminer CLI 输出

---

## 参考但不引入：MediaCrawler

- **GitHub**: https://github.com/NanmiCoder/MediaCrawler (~45k stars)
- **许可证**: 非商业学习协议 1.1 — **不可作为依赖或复制代码**
- **参考价值**: 知乎/小红书/微博的搜索流程、反爬策略、页面结构
- **moleminer 做法**: clean-room 实现，参考思路但代码完全自写

---

## 直接集成的外部服务

### Tavily API

- 语义搜索 + URL 内容提取
- Python SDK: `tavily-python`
- 有免费额度
- 用于：tavily.py source + Stage 4 线索解析

### Brave Search API

- Web 搜索
- 免费 2000 次/月
- 用于：brave.py source

### Algolia HN API

- Hacker News 搜索
- 完全免费，无需 key
- 用于：hackernews.py source

### Jina Reader

- URL → 干净文本
- 免费，无需 key
- `https://r.jina.ai/{url}`
- 用于：jina.py source + Stage 4 备选提取

### ScrapeCreators API

- Reddit/TikTok/Instagram 搜索
- 用于：reddit.py source

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
```

### 可选依赖

```
# [tavily]
tavily-python

# [brave]
# 无额外依赖，用 httpx 直接调

# [social]
# 无额外依赖，用 httpx 直接调

# [cn]
playwright

# [llm]
openai         # 或 anthropic，用于 query enhancement
```

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
