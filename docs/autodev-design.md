# MoleMiner (矿鼹) — 产品规格（逆向生成）

> 来源：从现有代码库逆向生成 | 生成时间：2026-04-02

## 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 语言 | TypeScript (ESM, ES2022) | 从 Python 迁移完成 |
| 运行时 | Node.js ≥18 | 入口 `dist/index.js` |
| CLI 框架 | commander | 命令/选项/子命令 |
| 构建 | esbuild | bundle → 单文件，`--packages=external` |
| 测试 | vitest + msw | 单元测试 + HTTP mock |
| LLM | fetch 直调 | OpenAI/Anthropic/Ollama/Zhipu，JSON schema 约束 |
| 浏览器自动化 | playwright (optional) | QR 登录 + SPA 抓取 |
| HTML 解析 | cheerio + defuddle + readability + jsdom | 内容抽取管线 |
| 存储 | sql.js (SQLite WASM) | 零原生依赖 |
| 配置 | @iarna/toml | `~/.moleminer/config.toml` |
| 终端 UI | chalk + cli-table3 + ora + qrcode | 彩色输出 + 进度条 + QR |

## 架构概览

### 架构模式

CLI 单体应用 + 插件式搜索源。核心是 AI 递归搜索循环。

### 组件关系

```
CLI (index.ts / commander)
  │
  ▼
Pipeline (pipeline.ts) ─── 递归搜索编排器
  │
  ├─── AI 层 (ai.ts) ──── LLM 客户端 (llm.ts)
  │    ├ aiClassify         │
  │    ├ aiExtractEntities  ├ OpenAI (gpt-5.4 / gpt-4o-mini)
  │    ├ aiGenerateQueries  ├ Anthropic (claude-sonnet)
  │    └ aiGenerateReport   ├ Ollama (llama3)
  │                         └ Zhipu (glm-5)
  │
  ├─── 搜索源层 (sources/)
  │    ├ API 源: brave, reddit, github, devto
  │    ├ Scrape 源: hackernews, stackoverflow, youtube, wechat
  │    └ Browser 源: weibo, zhihu, xiaohongshu, x
  │
  ├─── 聚合层 (aggregate.ts)
  │    ├ URL 去重 (dedupe.ts)
  │    ├ zero-overlap filter
  │    └ freshness 过滤
  │
  ├─── 内容抽取层 (utils/)
  │    ├ fetch-page.ts — 3 级策略 (fetch → relaxed TLS → Playwright)
  │    ├ extract.ts — Defuddle + Readability 双引擎
  │    └ compress.ts — 9 规则压缩 + 中文噪音清理
  │
  ├─── 存储层 (store.ts) — SQLite 持久化
  ├─── 配置层 (config.ts) — TOML + env + multi-profile
  └─── 输出层 (output.ts) — 5 种格式，terminal 默认简洁 + --verbose 详细
```

### 数据流

```
用户: moleminer search "深圳AI创业补贴" [--deep]
  │
  ▼ Round 0
  aiGenerateQueries ─→ PART 1: anchor 决策 (zh/en/none)
  │                     PART 2: dimension 展开（仅 deep 模式）
  │                     PART 3: platform 选择 (skip/not)
  │                     → 生成 per-platform 查询
  ▼
  sources.search() ──→ 12 源并行 (Promise.all)
  │                     → 按 anchor 下发查询：
  │                       anchor='zh' → 中文源用 base，英文源 skip
  │                       anchor='en' → 英文源用 base，中文源 skip
  │                       anchor='none' → 双语分发
  │                     → per-source 动态上限 min(queryCount*10, 100)
  ▼
  aggregateResults ──→ 仅 URL 去重 + trigram 去重
  │                     （不再有 filterByRelevance 规则过滤层）
  ▼
  aiClassify ────────→ LLM 3 分类 (direct/lead/irrelevant)
  │                     → SPECIFICITY TEST（通用，不再只针对政策）
  │                     → irrelevant 丢弃（反漂移第一层，唯一相关性过滤）
  │                     → batch 30 条/批，snippet 截断 100 字符
  ▼
  aiExtractEntities ─→ 试金石测试 + 置信度 ≥0.7 + top 10
  │                     → seenEntities 跨轮去重
  ▼ Round 1+ (仅新实体)
  aiGenerateQueries ─→ 使用独立的 ENTITY_QUERIES_SYSTEM prompt
  │                     只用 brave，查询=实体+意图关键词（锚定原意）
  │                     → 无新实体 → 收敛停止
  ▼
  fetchPages ────────→ 3 级抓取策略 + Cookie 注入
  extractContent ────→ HTML → clean text
  compress ──────────→ 规则压缩 (9 rules, safety rollback)
  │
  ▼
  computeImportanceScores → authority+freshness+engagement+aiConfidence
  formatOutput ───────────→ terminal | table | json | markdown | report
  store.save() ───────────→ SQLite 持久化
```

## 组件设计

### Pipeline (`pipeline.ts`)

**职责**：递归搜索循环的编排器

- 接收：query, SearchOptions (sources, maxRounds, skipContentExtraction, onProgress)
- 输出：SearchResponse (results, sources, entities, dimensions, rounds)
- 收敛检测：无新实体 → 停止
- 进度回调：ProgressEvent 类型联合，11 种事件

### AI 层 (`ai.ts`)

**职责**：4 个 AI 函数，JSON schema 约束输出

| 函数 | 模型 | 输入 | 输出 |
|------|------|------|------|
| aiClassify | fast (gpt-4o-mini) | SearchResult[] | {index, type}[] |
| aiExtractEntities | fast | lead 结果 | {name, confidence, reason}[] |
| aiGenerateQueries | strong (gpt-5.4) | query + sourceNames + deep | QueryPlan (anchor + base_keywords + translated_base + dimensions + queries) |
| aiGenerateReport | strong | SearchResponse | SearchReport |

**反漂移 3 层防御**：
1. Classify 过滤 irrelevant（通用 SPECIFICITY TEST，不再只针对政策类）
2. Entity 试金石测试（80%+ 相关性）+ 置信度硬截断
3. Round 1+ 查询锚定原意（使用独立的 ENTITY_QUERIES_SYSTEM prompt）

### 跨语言锚定决策（aiGenerateQueries PART 1）

**核心原则**：翻译不是二元选择（翻 / 不翻），而是三元决策，由查询的**地理语言锚点**决定。

**决策表**：

| anchor 值 | 判断依据 | 翻译策略 | 例子 |
|----------|---------|---------|------|
| `zh` | 查询明确包含中文地名/中国相关实体 | 不生成英文版，跳过英文源 | "中国 agent 黑客松"、"深圳AI补贴"、"上海创业园" |
| `en` | 查询明确包含英文地名/西方实体 | 不生成中文版，跳过中文源 | "Silicon Valley hackathon"、"UK AI grants" |
| `none` | 全球性/无地理锚定的话题 | **双语都生成**，所有源都搜各自语言版本 | "AI hackathon 2026"、"LLM paper"、"React vs Vue" |

**代码分发逻辑**：
- `anchor='zh'`：中文源用 base，英文源 skip（或用 base 原样但预期 0 结果）
- `anchor='en'`：英文源用 base，中文源 skip
- `anchor='none'`：
  - 中文源用 `lang==='zh' ? base : translated_base`
  - 英文源用 `lang==='en' ? base : translated_base`
  - brave 同时发 `[base, translated_base]` 两个查询（支持多语言搜索）

**为什么不简单地"查询是中文就只搜中文源"**：用户搜 "global AI hackathon 2026" 虽然查询是英文，但话题是全球性的，中文源（如知乎、微博）也有相关内容（如中国主办的全球 hackathon），应该一并搜索。地理锚点比查询语言更本质。

### 查询维度展开体系（Deep 模式）

**MECE 6 维度正交框架**：

任何信息搜索都可以用 6 个正交维度刻画，互斥且穷尽：

| 维度 | 含义 | 展开时机 | 颗粒度规则 |
|------|------|---------|-----------|
| WHAT | 主题细分 | 查询含宽泛概念（AI、政策、hackathon） | 3-8 个子类 |
| WHERE | 地理空间 | 查询涉及地域相关内容 | local→区级5-10 / national→城市5-10 / global→大洲7-10 |
| WHEN | 时间范围 | 所有时效性内容（事件、政策、产品、趋势） | 近期→当前年+上年+"最新"3值 / 历史→逐年5值 |
| WHO | 主体 | 查询涉及组织/品牌/机构 | 3-8 个主体类型 |
| HOW | 载体形式 | 同一主题有多种媒介（视频/文章/论文/代码） | 3-6 个载体 |
| SOURCE | 权威性来源 | 需要区分官方/社区/新闻 | 3-5 类来源 |

**维度组合规则**：
- 最多选 **2 个维度组合**（避免查询爆炸）
- 两个维度同时展开 → 笛卡尔积值数量控制在 `3×3=9` 到 `5×4=20` 之间
- 优先选 WHEN 维度（时间维度适用性最广）

**Deep 模式强制约束**：
- 必须至少展开 1 个维度（防止 LLM 判"简单查询"退化为普通模式）
- 若 LLM 返回空维度 → 代码自动注入 WHEN 兜底维度：`[{base} {当前年}, {base} {上一年}, {base} 最新]`

**普通模式**：
- 不做维度展开
- 但保留时效性感知：AI 在 `base_keywords` 中自动注入年份（基于 CURRENT_DATE）
- 保留跨语言锚定决策

### SearchScope — 动态搜索粒度自适应（2026-04-15）

**核心问题**：搜索 "global AI startups" 和 "深圳创业补贴" 应该使用不同的粒度策略，但当前系统对两者一视同仁。

**解决方案**：LLM 在 `aiGenerateQueries` 时输出 `scope: 'local' | 'national' | 'global'`，pipeline 全链路联动。

**Scope 判断规则**（LLM 在 PART 0 执行）：
- `local`：查询指向具体城市/区域（"深圳AI补贴"、"NYC startup grants"）
- `national`：查询指向国家（"中国AI政策"、"US AI regulation"）
- `global`：无地理锚点或指向全球（"AI hackathon 2026"、"best LLM frameworks"）

**Scope 联动参数表**：

| 参数 | local | national | global | 作用 |
|------|-------|----------|--------|------|
| `resultsPerQuery` | 10 | 5 | 3 | Source 层：每条查询返回几条结果（均衡分布） |
| `perSourceCap` | 30 | 80 | 150 | Pipeline 层：每个源的总结果上限 |
| `maxContentPages` | 20 | 40 | 60 | 内容提取层：最多抓几个页面 |
| `fetchConcurrency` | 5 | 10 | 15 | 内容提取层：页面并发抓取数（scope 驱动） |
| WHERE max values | 8 | 6 | 5 | AI 层：维度展开值数上限 |
| 其他 dim max values | 3 | 5 | 4 | AI 层：其他维度展开值数上限 |

**设计原则**：
- **local 重精度**：查询少、结果少、每条都抓页面、低并发（政府网站友好）
- **global 重覆盖**：查询多、每条查询少拿几条（均匀覆盖各地区）、只抓 top 页面、高并发
- **national 居中**：当前默认行为的近似值

**Per-query 均衡机制**：`BaseSource.search()` 接收 `maxPerQuery` 参数，对每条 `searchOne()` 的返回结果截断，确保 30 条查询不会被前几条吃满 cap。

**Normal 模式受益**：scope 在 normal 模式也输出（零额外成本），pipeline 据此调整配额，不需要 --deep。

**Fallback**：LLM 未返回 scope 时默认 `national`（当前行为的近似值）。

### 过滤链设计原则

**原则：尽量多用 LLM，少用规则过滤。**

规则过滤（如 `filterByRelevance` 的关键词匹配）存在两个根本问题：
1. **误杀**：语义相关但用词不同的结果会被丢弃（如"Agent Hackathon in Beijing" 不含"中国"/"黑客松"字面词）
2. **CJK bigram 污染**：中文分词产生伪 token（"黑客松" → "黑客" + "客松"），阈值计算失真

**新过滤链**（规则最小化）：
```
dispatch 去重 → aiClassify (LLM 判 direct/lead/irrelevant) → 丢弃 irrelevant
```

不再有 `filterByRelevance` 预过滤层。相关性判断完全交给 LLM 分类器。代价是多消耗一些 LLM token，但 batch 30 条/批，成本可控。

### 搜索源框架 (`sources/base.ts`, `registry.ts`)

**职责**：抽象搜索接口 + 注册表模式

```typescript
abstract class BaseSource {
  name: string;
  sourceType: 'api' | 'scrape' | 'browser';
  requiresAuth: boolean;
  search(queries: string[]): Promise<SearchResult[]>;  // 并行多查询
  searchOne(query: string): Promise<SearchResult[]>;    // 单查询
  enabled(config: Config): boolean;
  configure(config: Config): void;
}
```

注册表 `SourceRegistry`：注册/按名获取/列出全部。

### LLM 客户端 (`llm.ts`)

**职责**：多提供商 LLM 调用

- 两种调用模式：`complete()` (纯文本) 和 `extractJson()` (JSON schema 约束)
- 提供商适配：OpenAI 兼容 (openai/ollama/zhipu) + Anthropic 原生
- 自动重试：429/5xx 指数退避 (3 次, 1s/2s/4s)
- 分模型：fast model (分类/提取) vs strong model (查询生成/报告)

### 内容抽取管线 (`utils/`)

**职责**：URL → 干净文本

1. `fetch-page.ts`：3 级策略
   - 需 JS 挑战的域 → Playwright + cookies
   - 普通 fetch + cookies + browser UA
   - SSL 错误 → relaxed TLS (`!ECDHE` ciphers，修复 gov.cn)
   - SPA 检测 → Playwright fallback
2. `extract.ts`：Defuddle (主) + Readability (备)
3. `compress.ts`：9 条规则，P0/P1/P2 优先级，safety rollback

### 配置系统 (`config.ts`)

**职责**：TOML 配置 + 环境变量覆盖 + 多 LLM profile

- 路径：`~/.moleminer/config.toml`
- 优先级：env var > TOML file > defaults
- Profile 系统：`profiles.{name}.{provider,model,api_key,base_url}`
- 源密钥映射：brave → braveApiKey, github → githubToken

## 技术决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| LLM 调用方式 | fetch 直调 | 不依赖 LangChain/litellm，减少依赖，控制 JSON schema |
| 分模型策略 | fast + strong | 分类/提取用便宜快速模型，查询生成用强模型，平衡成本和质量 |
| 存储 | sql.js (WASM) | 零原生依赖，跨平台，npm install 不需要编译 |
| 浏览器自动化 | playwright (optional) | 只有中国源 + X 需要，其他源不需要 |
| 配置格式 | TOML | 人类可读，支持嵌套（profile），比 JSON 友好 |
| 内容抽取双引擎 | Defuddle + Readability | Defuddle 更现代但覆盖面窄，Readability 作为 fallback |
| 维度展开 | AI 输出 base_keywords + dimensions，代码组合 | 确定性组合避免 AI 生成重复查询 |
| 反漂移设计 | 3 层防御 | 递归搜索天然容易漂移，每层独立过滤保证收敛 |

## 新增功能：Web 可视化界面 + 3D 数字地球

### 架构影响

**新增模块**：Web 可视化层（`ts/src/web/`），作为 CLI 的伴侣界面，不替代 CLI。

**现有模块修改**：
- `models.ts` — SearchResult 新增可选 `location` 字段
- `store.ts` — results 表新增 location 列 + 迁移
- `ai.ts` — CLASSIFY_SCHEMA 扩展 `location` 输出字段
- `index.ts` — 新增 `moleminer web` 子命令

**不修改**：pipeline.ts, aggregate.ts, sources/, llm.ts（保持核心搜索逻辑不变）

### 组件架构

```
CLI (index.ts)
  │
  ├─── moleminer web ──→ Web Server (web/server.ts)
  │                        ├─── HTTP API (REST)
  │                        │    ├ GET  /api/searches         → 历史列表
  │                        │    ├ GET  /api/searches/:id     → 搜索详情+结果
  │                        │    ├ POST /api/search           → 发起搜索
  │                        │    ├ GET  /api/search/stream    → SSE 进度推送
  │                        │    ├ GET  /api/sources          → 源列表+状态
  │                        │    ├ PATCH /api/sources/:name   → 启用/禁用源
  │                        │    ├ GET/PATCH /api/config      → 配置读写
  │                        │    ├ POST /api/login/:platform  → 启动 QR 登录
  │                        │    ├ GET  /api/login/stream     → SSE 登录进度
  │                        │    └ DELETE /api/login/:id      → 取消登录
  │                        │
  │                        └─── Static Files (web/ui/dist/)
  │                             └─── React SPA
  │                                  ├ SearchHistory  (历史列表页)
  │                                  ├ SearchResults  (结果详情页)
  │                                  │  ├ ListView    (列表视图)
  │                                  │  └ GlobeView   (3D 地球视图)
  │                                  ├ SourcesPage   (搜索源管理)
  │                                  ├ SettingsPage   (设置)
  │                                  ├ LoginModal     (QR 登录弹窗)
  │                                  ├ SearchInput    (搜索入口)
  │                                  └ ProgressBar    (SSE 进度)
  │
  ├─── Pipeline (不变)
  ├─── AI 层 (扩展 classify schema)
  └─── Store (扩展 location 列)
```

### 新增依赖

| 依赖 | 版本 | 用途 | 类型 |
|------|------|------|------|
| react | ^19 | 前端框架 | devDependency (构建时) |
| react-dom | ^19 | React DOM 渲染 | devDependency |
| react-globe.gl | ^2 | 3D 数字地球组件 | devDependency |
| three | ^0.170 | react-globe.gl 的 peer dep | devDependency |
| vite | ^6 | 前端构建 | devDependency |
| @vitejs/plugin-react | ^4 | Vite React 插件 | devDependency |
| tailwindcss | ^4 | CSS 样式 | devDependency |

注意：前端依赖全部是 devDependency，构建后产出静态文件嵌入 `dist/web/`，运行时零额外依赖。

### 数据模型扩展

```typescript
// models.ts — 新增
export interface GeoLocation {
  name: string;       // "深圳市南山区" / "San Francisco, CA"
  lat: number;        // 纬度 22.5431
  lng: number;        // 经度 113.9298
  level: 'country' | 'region' | 'city' | 'district';
}

// SearchResult — 扩展
export interface SearchResult {
  // ... 现有字段不变
  location?: GeoLocation;  // 可选，AI classify 时顺带提取
}
```

### AI classify 扩展

CLASSIFY_SCHEMA 的 results 数组 item 新增可选 `location` 字段：

```typescript
// CLASSIFY_SCHEMA.results.items.properties 新增：
location: {
  type: ['object', 'null'],
  properties: {
    name: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    level: { type: 'string', enum: ['country', 'region', 'city', 'district'] },
  },
  required: ['name', 'lat', 'lng', 'level'],
}
```

~~原方案：classify 时顺带提取 location（基于 snippet）~~
**修正（2026-04-04）**：改为内容抽取后独立提取。原因：snippet 仅 100 字符，大量结果无法提取到地理信息。

新增 `aiExtractLocations()` 函数：
- 在 `enrichWithContent` 之后调用，使用完整 summary（300 字符）
- Fast model (gpt-4o-mini)，batch 30 条/次
- 只处理 summary >= 100 字符的结果
- Best-effort：提取失败不阻塞管线

### Web 服务层设计

**服务端**：Node.js 原生 `http.createServer()`，不引入 Express。

- 路由分发：简单的 path match（11 个 API 端点 + 静态文件 fallback）
- SSE 进度：`POST /api/search` 返回 searchId，`GET /api/search/stream?id=X` 建立 SSE 连接
- 静态文件：`dist/web/` 目录，SPA fallback（所有非 API 路径返回 index.html）
- 端口：默认 3456，`--port` 可配置
- 启动时自动 `open` 浏览器

**前端**：React SPA + react-globe.gl

- 路由：hash router（`#/`, `#/search/:id`, `#/search/:id/globe`）
- 状态：React useState/useEffect，不引入状态管理库
- 样式：Tailwind CSS，深色主题（配合数字地球风格）
- 3D 地球：react-globe.gl，深色材质 + 发光国家边界 + 标记点

### 技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| HTTP 框架 | Node.js 原生 http | 只有 4 个端点，不需要 Express 的复杂性 |
| 前端框架 | React + Vite | globe.gl 有官方 React 封装，Vite 构建快 |
| 3D 地球 | react-globe.gl | 200KB 轻量，数字风格开箱即用，TS 类型好 |
| 实时通信 | SSE (Server-Sent Events) | 单向推送够用，比 WebSocket 简单 |
| CSS | Tailwind CSS v4 | 原子化 CSS，深色主题方便，无运行时 |
| 前端打包 | Vite build → dist/web/ | 静态文件嵌入，运行时无前端依赖 |
| 地理提取时机 | classify 时顺带 | 不增加 LLM 调用次数，复用已有 batch |
| 路由 | hash router | 静态 SPA 部署简单，不需要服务端路由 |

### 能力-组件映射更新

| 能力 | 主责组件 | 辅助组件 |
|------|---------|---------|
| Web 服务 | `web/server.ts` | `store.ts`, `pipeline.ts` |
| 搜索历史展示 | `web/ui/SearchHistory` | `web/server.ts` (API) |
| 结果列表展示 | `web/ui/SearchResults` | `web/server.ts` (API) |
| 3D 地球渲染 | `web/ui/GlobeView` | `react-globe.gl` |
| 地理信息提取 | `ai.ts` (aiExtractLocations) | `models.ts` (GeoLocation) |
| SSE 进度推送 | `web/server.ts` | `pipeline.ts` (onProgress) |
| 视图切换 | `web/ui/SearchResults` | `web/ui/GlobeView`, `web/ui/ListView` |
| 源管理 | `web/ui/SourcesPage` | `web/server.ts` (sources API) |
| 设置展示 | `web/ui/SettingsPage` | `web/server.ts` (config API) |
| Web QR 登录 | `web/ui/LoginModal` | `web/server.ts` (login API), `cookies.ts` (playwrightLogin) |
| Cookie 过期检测 | `cookies.ts` (isCookieValid) | `App.tsx` (loginQueue), `SourcesPage` (toggle 拦截) |
