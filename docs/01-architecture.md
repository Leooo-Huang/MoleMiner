# MoleMiner — 5 阶段搜索管线架构

## 管线总览

```
用户输入: "AI hackathon 2026"
        │
   ┌────▼────┐
   │ Stage 1 │  Query Enhancement（LLM 查询增强）
   │  LLM    │  生成平台化、多语言搜索词
   └────┬────┘
        │
   ┌────▼────┐
   │ Stage 2 │  Parallel Dispatch（并行分发）
   │ 多源搜索 │  google / hn / tavily / reddit / zhihu / ...
   └────┬────┘
        │
   ┌────▼────┐
   │ Stage 3 │  Aggregate（聚合）
   │ 归一化   │  去重、时效过滤、分类 direct vs lead
   └────┬────┘
        │
   ┌────▼────┐           ┌──────────┐
   │ Stage 4 │──线索──▶  │ 二次搜索  │ 提取实体名 → 搜官方链接
   │ 深挖     │◀─结果──  │ Tavily   │
   └────┬────┘           └──────────┘
        │
   ┌────▼────┐
   │ Stage 5 │  Output & Store（输出 + 入库）
   │ 输出入库 │  table / json / markdown / SearchResult[] + SQLite
   └─────────┘
```

**moleminer 是通用搜索工具，负责搜索、返回结构化结果并自动入库 SQLite。**
评分、推送等业务逻辑由上层应用（如 Radar skill）负责。

---

## Stage 1: Query Enhancement

### 输入
```
原始 query: "AI 数字孪生 能源"
```

### LLM 处理
根据各平台用户表达习惯，生成平台化搜索词：

```json
{
  "search_engine": ["AI digital twin energy hackathon 2026", "数字孪生 能源 黑客松 2026"],
  "zhihu": ["数字孪生 比赛 推荐", "2026 值得参加的 AI 比赛"],
  "xiaohongshu": ["AI比赛推荐", "黑客松经验分享"],
  "reddit": ["AI hackathon 2026 energy", "digital twin competition"],
  "wechat": ["数字孪生 大赛", "AI 能源 创新挑战赛"]
}
```

### 实现
- 调用 LLM API（OpenAI / Anthropic / 本地模型，用户可配置）
- `--no-enhance` 标志跳过增强，直接用原始 query 搜所有源
- 不引入 LangChain 等框架，直接调 API

---

## Stage 2: Parallel Dispatch

### 信息源分层

**零配置（pip install moleminer 即用）：**

| 源 | 方式 | 覆盖 |
|----|------|------|
| google.py | Web scraping | 全网 |
| hackernews.py | Algolia API（免费） | HN 社区 |
| jina.py | r.jina.ai（免费） | URL 内容提取 |

**需要 API key：**

| 源 | 方式 | 覆盖 |
|----|------|------|
| tavily.py | Tavily API | 全网语义搜索 + 内容提取 |
| brave.py | Brave Search API | 全网（2000次/月免费） |
| reddit.py | ScrapeCreators API | Reddit |
| x.py | Bird Search | X |

**需要浏览器登录：**

| 源 | 方式 | 覆盖 |
|----|------|------|
| zhihu.py | Playwright + Cookie | 知乎 |
| xiaohongshu.py | Playwright + Cookie | 小红书 |
| weibo.py | Playwright + Cookie | 微博 |
| wechat.py | Web scraping | 搜狗微信（无需登录） |

### 统一返回格式

```python
@dataclass
class SearchResult:
    title: str
    url: str
    source: str           # "google" | "reddit" | "zhihu" | ...
    snippet: str           # 摘要
    result_type: str       # "direct" | "lead"
    timestamp: str | None  # 发布/发现时间
    mentions: list[str]    # lead 中提到的实体名称（direct 为空）
    metadata: dict         # 源特有的额外字段
```

### result_type 定义

- `direct` — URL 直接指向目标内容（官网、申请页）
- `lead` — URL 是社区讨论帖，内容中提到了目标但不是官方来源

搜索引擎返回的通常是 direct，社区返回的通常是 lead。

---

## Stage 3: Aggregate

```
所有原始结果
    │
    ├── URL 精确去重
    ├── 标题模糊去重（编辑距离 / n-gram）
    ├── 时效过滤
    │     ├── 标题/摘要含过期年份 → 丢弃
    │     ├── timestamp 超过阈值 → 丢弃
    │     └── 无法判断 → 保留
    │
    ├── direct → 直接输出
    └── lead → 进 Stage 4
```

### 去重逻辑

基于 last30days 的 dedupe.py 改造：
1. URL 规范化（去除 query params、统一协议）
2. 标题相似度（避免同一内容不同源重复）
3. 合并时保留最丰富的元数据

---

## Stage 4: Lead Resolution

社区帖子说"推荐 IEEE IES Challenge"→ 提取实体名 → 搜官方链接。

```
Lead: "推荐 IEEE IES Challenge，今年主题是能源AI"
  │
  ├── 提取: entity = "IEEE IES Challenge 2026"
  │
  ├── Tavily/Google 搜索: "IEEE IES Challenge 2026 official"
  │
  ├── 找到: https://ai.ieee-ies.org/
  │
  └── Jina/Tavily extract: 提取页面内容 → 新的 direct SearchResult
```

### 失败处理
- 搜不到 → 丢弃
- 一条 lead 提到多个实体 → 每个独立处理

### 实体提取方式
- 有 LLM 时：LLM 提取
- 无 LLM 时：基于规则的简单提取（大写词组、引号内容等）

---

## Stage 5: Output & Store

搜索结果格式化输出，同时自动入库 SQLite。不做评分。

### CLI 输出格式

```bash
moleminer search "AI hackathon" --format table   # 默认，终端友好
moleminer search "AI hackathon" --format json    # 程序可解析
moleminer search "AI hackathon" --format markdown # 文档友好
```

### SDK 返回

```python
results: list[SearchResult]  # 结构化对象列表
```

### SQLite 存储

每次搜索自动写入 `~/.moleminer/moleminer.db`：

- **searches 表**：query 原文、增强后的 queries、使用的源列表、搜索时间、结果数量
- **results 表**：聚合后的每条 SearchResult（关联 search_id）

上层应用（如 Radar）可直接读取 SQLite 文件，或通过 SDK 查询历史。

---

## 插件架构

### BaseSource

```python
from abc import ABC, abstractmethod

class BaseSource(ABC):
    name: str
    source_type: str       # "api" | "scrape" | "browser"
    requires_auth: bool
    install_extra: str     # 对应的 pip extra 名称

    @abstractmethod
    async def search(self, queries: list[str]) -> list[SearchResult]:
        """执行搜索，返回结果列表"""
        ...

    def enabled(self, config: Config) -> bool:
        """检查依赖和凭证是否满足"""
        ...

    def auth_instructions(self) -> str:
        """返回认证指引文本"""
        ...
```

### SourceRegistry

```python
class SourceRegistry:
    _sources: dict[str, type[BaseSource]]

    def register(self, source_cls: type[BaseSource]):
        ...

    def get_enabled_sources(self, config: Config) -> list[BaseSource]:
        """返回当前环境下可用的所有源"""
        ...

    def get_source(self, name: str) -> BaseSource:
        ...
```

### 注册方式

```python
# sources/__init__.py
from .google import GoogleSource
from .hackernews import HackerNewsSource
# ...

registry = SourceRegistry()
registry.register(GoogleSource)
registry.register(HackerNewsSource)
# ...
```

用户自定义源：

```python
from moleminer.sources.base import BaseSource, SearchResult

class MySource(BaseSource):
    name = "my_source"
    source_type = "api"
    requires_auth = True

    async def search(self, queries):
        # 自定义搜索逻辑
        return [SearchResult(...)]

# 注册
from moleminer import registry
registry.register(MySource)
```
