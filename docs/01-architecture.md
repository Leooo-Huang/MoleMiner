# MoleMiner — AI 递归搜索架构

## 架构总览

```
用户输入: "AI hackathon 2026"  (普通 or --deep 模式)
        │
   ┌────▼─────────────────────────────────────────┐
   │ Round 0                                       │
   │                                               │
   │  ③ aiGenerateQueries                          │
   │     PART 1: anchor 决策 (zh/en/none)           │
   │     PART 2: dimension 展开 (仅 deep)           │
   │     PART 3: platform 分配                      │
   │         │                                     │
   │  ┌──────▼──────┐                              │
   │  │  Dispatch   │  12 源并行，按 anchor 下发查询  │
   │  └──────┬──────┘                              │
   │         │                                     │
   │  ┌──────▼──────┐                              │
   │  │  Aggregate  │  仅 URL 去重 + trigram 去重    │
   │  │             │  (不再有规则过滤层)             │
   │  └──────┬──────┘                              │
   │         │                                     │
   │  ① aiClassify（LLM 判 direct/lead/irrelevant）│
   │     irrelevant 丢弃（唯一相关性过滤，全 LLM）    │
   │         │                                     │
   │  ② aiExtractEntities（实体名 + 置信度 0-1）   │
   │         │                                     │
   │  direct → 加入结果集                           │
   │  entities → 进入下一轮                         │
   └─────────┬───────────────────────────────────┘
             │ top-10 高置信度实体
   ┌─────────▼───────────────────────────────────┐
   │ Round 1+                                     │
   │                                              │
   │  ③ aiGenerateQueries（只用 brave，锚定原意）  │
   │         │                                    │
   │  Dispatch → Aggregate → ① → ②               │
   │         │                                    │
   │  无新实体 → 停止                              │
   └─────────┬──────────────────────────────────┘
             │
   ┌─────────▼──────────┐
   │ 输出 + 存储         │
   │ SearchResponse      │
   │ + SQLite 入库       │
   └────────────────────┘
```

## 三个 AI 函数（`ts/src/ai.ts`）

LLM 是必须依赖。所有 AI 调用使用 JSON schema 约束输出，保证 100% 格式合规。

### ① aiClassify — 三类分类

**输入**: 搜索结果列表（title, url, snippet, source, metadata）
**输出**: 每条结果标记为 `direct`（一手来源）、`lead`（提及/讨论）、`irrelevant`（过滤）

```json
{
  "results": [
    {"index": 0, "type": "direct"},
    {"index": 1, "type": "lead"},
    {"index": 2, "type": "irrelevant"}
  ]
}
```

- `irrelevant` 在实体提取前直接丢弃（反漂移第一层）
- 批处理：每批 30 条，snippet 截断至 100 字符
- 模型：fast model（gpt-4o-mini / gemini-2.5-flash）
- **SPECIFICITY TEST（通用规则）**：结果必须包含具体信息（金额/日期/地点/步骤等），不只是主题提及
- `summary` 字段已从 schema 移除（之前会生成但被丢弃，浪费 token），页面内容由后续 `enrichWithContent` 阶段抽取

### ② aiExtractEntities — 实体提取 + 置信度

**输入**: lead 类型的结果列表
**输出**: 实体名 + 置信度（0-1），最多 top 10

```json
{
  "entities": [
    {"name": "Gemini Hackathon 2026", "confidence": 0.95},
    {"name": "Google AI Studio", "confidence": 0.7}
  ]
}
```

**试金石测试**（反漂移第二层）：置信度基于"单独搜索这个名词，结果大部分和原始意图相关"的可能性。通用词（深圳、AI、百度）置信度 < 0.5，会被过滤。

- 模型：fast model
- 跨轮去重：seenEntities set，已搜实体不再搜

### ③ aiGenerateQueries — 智能查询生成

**输入**:
- Round 0: 用户原始意图 → AI 选择相关源 + 生成平台化查询
- Round 1+: 实体列表 + 原始意图关键词 → 只用 brave（锚定，不发散）

**三段式输出结构**（Round 0）:

```json
{
  "anchor": "none",                          // PART 1: 跨语言锚定决策
  "base_keywords": "AI hackathon 2026",      // 原始语言
  "translated_base": "AI 黑客松 2026",        // 另一语言（按 anchor 决定是否为空）
  "dimensions": [                            // PART 2: 维度展开（仅 deep 模式）
    {
      "label": "WHEN",
      "priority": "primary",
      "values": ["AI hackathon 2026", "AI hackathon 2025", "AI hackathon latest"]
    }
  ],
  "platforms": [                             // PART 3: 平台选择
    {"platform": "brave", "skip": false},
    {"platform": "hackernews", "skip": false},
    ...
  ]
}
```

**PART 1 — 跨语言锚定决策（三元）**：

| anchor | 触发条件 | 翻译策略 | 例子 |
|--------|---------|---------|------|
| `zh` | 查询含中文地名/中国相关实体 | 不翻译，跳过英文源 | "中国 agent 黑客松" |
| `en` | 查询含英文地名/西方实体 | 不翻译，跳过中文源 | "Silicon Valley hackathon" |
| `none` | 全球性/无地理锚定话题 | **双语都生成**，所有源各用其语言 | "AI hackathon 2026"、"React vs Vue" |

**PART 2 — 维度展开（仅 deep 模式）**：MECE 6 维度（WHAT/WHERE/WHEN/WHO/HOW/SOURCE），详见 `autodev-design.md`。普通模式强制 `dimensions: []`，但 `base_keywords` 保留时效性感知（AI 基于 CURRENT_DATE 自动注入年份）。

**PART 3 — 平台选择**：AI 根据 anchor + 源的语言适配决定 skip 或搜索。代码层的分发逻辑按 anchor 进一步处理跨语言查询的下发。

- Round 0 模型：strong model（gpt-5.4 / gemini-2.5-flash）
- Round 1+ 模型：strong model，查询 = 实体名 + 原始意图关键词（反漂移第三层，使用独立的 `ENTITY_QUERIES_SYSTEM` prompt）

---

## 递归循环

### 循环状态

```typescript
seenUrls: Set<string>          // 跨轮 URL 去重
seenEntities: Set<string>      // 跨轮实体去重
allDirects: SearchResult[]     // 累积的直接结果
roundNum: number               // 当前轮次
```

### 收敛条件（任一满足即停）

1. `roundNum >= maxRounds`（默认 3）
2. 本轮 AI 提取的高置信度实体全部在 seenEntities 中
3. 本轮搜索结果去重后为空

### 反漂移防御

| 层 | 机制 | 效果 |
|----|------|------|
| 1 | irrelevant 分类 | 过滤主题无关结果 |
| 2 | 实体置信度阈值 | 屏蔽通用词（深圳、AI、百度） |
| 3 | Round 1+ 查询锚定 | 防止搜索发散，始终回归原始意图 |

测试验证："深圳对AI创业补贴" → 71 个结果，100% 相关（反漂移前：2104 个结果）

---

## 信息源矩阵（11 个）

按 **功能 × 地区** 分类：

| 功能 | 海外 | 中国 |
|------|------|------|
| 搜索引擎 | brave | — |
| 社区 | reddit, hackernews | — |
| 问答 | stackoverflow | 知乎 |
| 代码 | github | — |
| 视频 | youtube | — |
| 博客 | devto | 微信公众号 |
| 社交 | reddit | 微博, 小红书 |

**已删除（MECE 清理）**: google（与brave重叠）, producthunt（与reddit重叠）, tavily/exa（与brave重叠）, lobsters（与HN重叠）

**可选扩展**: X/Twitter（需 twitter-cli）

### 统一接口（`ts/src/sources/base.ts`）

```typescript
abstract class BaseSource {
  abstract name: string
  abstract sourceType: 'api' | 'scrape' | 'browser'
  abstract requiresAuth: boolean
  installExtra?: string     // 'cn' | undefined

  abstract enabled(config: Config): boolean
  abstract search(queries: string[]): Promise<SearchResult[]>
}
```

所有源注册到 `SourceRegistry`，pipeline 根据配置和可用性自动选择。

---

## 数据模型（`ts/src/models.ts`）

### SearchResult

```typescript
interface SearchResult {
  title: string
  url: string
  source: string           // "brave" | "reddit" | "zhihu" | ...
  snippet: string
  resultType: 'direct' | 'lead'   // 由 AI 分类后设置
  language?: 'zh' | 'en'
  timestamp?: string
  metadata: Record<string, unknown>  // 互动数据：score/likes/comments/views
}
```

### SearchResponse

```typescript
interface SearchResponse {
  results: SearchResult[]
  sources: SourceStatus[]
  query: string
  totalResults: number
  rounds: number
}
```

---

## LLM 集成（`ts/src/llm.ts`）

### 支持的 Provider

| Provider | API 格式 | 说明 |
|----------|---------|------|
| OpenAI (GPT-5.4) | `/chat/completions` + `response_format` | JSON schema 约束 |
| Anthropic (Claude 4.6) | `/v1/messages` + tool_use | JSON schema 约束 |
| Gemini | OpenAI 兼容层 | JSON schema（strict mode 不支持，需绕过） |
| Ollama | OpenAI 兼容 | 依赖模型能力 |

### 多 Profile 配置

```toml
[[profiles]]
name = "gemini"
provider = "gemini"
api_key = "..."
fast_model = "gemini-2.5-flash"
strong_model = "gemini-2.5-flash"

[[profiles]]
name = "openai"
provider = "openai"
api_key = "sk-..."
fast_model = "gpt-4o-mini"
strong_model = "gpt-5.4"
```

- `moleminer profile use <name>` 切换
- 自动重试：429/5xx 指数退避（3 次，1s/2s/4s）

---

## 中国平台登录（`ts/src/utils/cookies.ts`）

### 登录机制

| 平台 | 机制 | 说明 |
|------|------|------|
| 知乎 | headless 终端 QR | 拦截 `/api/v3/account/api/login/qrcode` 响应 |
| 微博 | headless 终端 QR | 拦截 `qr.weibo.cn/inf/gen` 请求 |
| 小红书 | headless 终端 QR | 拦截 `/api/sns/web/v1/login/qrcode/create` 响应 |

三个平台均：**无浏览器弹窗，直接在终端打印 QR 码**。

### XHS 关键细节

- 需反检测 flag：`--disable-blink-features=AutomationControlled` + 删 `navigator.webdriver`
- 成功检测：`web_session` 值变化（XHS 在页面加载时就设置匿名 web_session，必须检测值变化而非仅检测存在）
- XHS 签名：纯 TypeScript 实现（`ts/src/utils/xhs-sign.ts`），移植自 xhshow (MIT)
- 搜索 payload 必须包含：`ext_flags: []`, `geo: ''`, `image_formats: ['jpg','webp','avif']`

---

## 项目结构（`ts/src/`）

```
ts/src/
├── index.ts             # CLI 入口（commander）
├── pipeline.ts          # 递归搜索编排器
├── ai.ts                # 三个 AI 函数（classify/extract/generate）+ 反漂移 prompt
├── llm.ts               # LLM 客户端（multi-provider + multi-profile + retry）
├── config.ts            # TOML + env var 配置
├── models.ts            # SearchResult, SearchResponse, SourceStatus
├── aggregate.ts         # URL去重 + trigram标题去重 + 时效过滤 + zero-overlap
├── store.ts             # SQLite 持久存储（sql.js WASM）
├── sources/
│   ├── base.ts          # BaseSource 抽象类
│   ├── index.ts         # SourceRegistry + 所有源注册
│   ├── brave.ts         # Brave Search API
│   ├── hackernews.ts    # HN Algolia API
│   ├── reddit.ts        # Reddit JSON API
│   ├── stackoverflow.ts # SO API
│   ├── github.ts        # GitHub Search API
│   ├── devto.ts         # dev.to API
│   ├── youtube.ts       # YouTube scrape
│   ├── wechat.ts        # 微信公众号（sogou）
│   ├── weibo.ts         # 微博 m.weibo.cn API（需 Cookie）
│   ├── zhihu.ts         # 知乎 API（需 Cookie）
│   ├── xiaohongshu.ts   # 小红书 edith API（需 Cookie + xhs-sign）
│   └── x.ts             # X/Twitter（可选，需 twitter-cli）
└── utils/
    ├── cookies.ts        # Cookie 持久化 + headless 终端 QR 登录
    ├── xhs-sign.ts       # XHS API 签名（纯 TS，移植自 xhshow MIT）
    ├── subprocess.ts     # execFileSync 封装（X/Twitter subprocess 调用）
    ├── dedupe.ts         # URL 规范化 + 标题 trigram Jaccard
    └── http.ts           # fetch 封装 + 重试
```

---

## 存储

SQLite (`~/.moleminer/moleminer.db`)，每次搜索自动入库。

- **searches 表**: query, sources_used, result_count, searched_at
- **results 表**: title, url, source, snippet, result_type（关联 search_id）

只存最终结果，不存中间轮次。
