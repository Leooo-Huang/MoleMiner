# MoleMiner (矿鼹) — 功能发现（逆向生成）

> 来源：从现有代码库逆向生成 | 生成时间：2026-04-02

## 产品定位

AI 驱动的多源递归搜索 CLI 工具。用户输入模糊意图，AI 自动生成查询、并行搜索 12 个中外平台、AI 分类追踪线索，输出结构化结果。目标：填补"AI 递归搜索 + 多源并行 + 线索追踪"CLI 工具的市场空白。

## 用户画像

1. **AI Agent 构建者** — Agent 调用 `moleminer search --format json` 获取搜索结果
2. **开发者 / 研究人员** — CLI 直接搜索多平台，深挖一手信息

## MVP 功能清单

### 平台层 [P]

- [P1] LLM 客户端 — fetch 直调 OpenAI/Anthropic/Ollama/Zhipu，JSON schema 约束输出 ✅
  - 代码：`ts/src/llm.ts`
- [P2] 搜索源框架 — 抽象基类 + 注册表，支持 API/scrape/browser 三种类型 ✅
  - 代码：`ts/src/sources/base.ts`, `ts/src/registry.ts`
- [P3] SQLite 存储 — sql.js (WASM)，结果持久化 + 历史查询 + 跨会话 diff ✅
  - 代码：`ts/src/store.ts`
- [P4] TOML 配置 — 多 LLM profile，env var 覆盖，源 API key 管理 ✅
  - 代码：`ts/src/config.ts`
- [P5] 去重与聚合 — URL 去重 + zero-overlap filter + freshness 过滤 ✅
  - 代码：`ts/src/aggregate.ts`, `ts/src/utils/dedupe.ts`
- [P6] 内容抽取管线 — 页面抓取(fetch+Playwright) → HTML→text(Defuddle+Readability) → 规则压缩 ✅
  - 代码：`ts/src/utils/fetch-page.ts`, `ts/src/utils/extract.ts`, `ts/src/utils/compress.ts`
- [P7] Cookie 持久化 + QR 登录 — Playwright 浏览器自动化，终端 QR 渲染 ✅
  - 代码：`ts/src/utils/cookies.ts`
  - Cookie 过期检查：`isCookieValid()` 检测 `expires` 字段，`hasCookies()` 只认有效 cookie
  - `cancelToken` 取消机制：Web 端取消登录时实际终止 Playwright 浏览器进程
- [P8] 重要性评分 — authority + freshness + engagement + aiConfidence 综合打分 ✅
  - 代码：`ts/src/utils/scoring.ts`

### 场景层 [W]

- [W1] AI 递归搜索 (依赖 P1, P2, P5, P6) — 核心循环：查询生成 → 并行搜索 → 分类 → 实体提取 → 递归 ✅
  - 代码：`ts/src/pipeline.ts`
- [W2] AI 3 分类 (依赖 P1) — direct/lead/irrelevant，含反漂移第一层过滤 ✅
  - 代码：`ts/src/ai.ts:aiClassify`
- [W3] AI 实体提取 (依赖 P1) — 试金石测试 + 置信度评分，top 10 + ≥0.7 硬截断 ✅
  - 代码：`ts/src/ai.ts:aiExtractEntities`
- [W4] AI 查询生成 (依赖 P1, P2) — 维度展开 (base_keywords + dimensions)，Round 0 多源/Round 1+ 只 brave ✅
  - 代码：`ts/src/ai.ts:aiGenerateQueries`
- [W5] AI 报告生成 (依赖 P1) — top-50 结果 → 结构化报告 (summary/findings/gaps) ✅
  - 代码：`ts/src/ai.ts:aiGenerateReport`
- [W6] 多格式输出 (依赖 W1) — terminal/table/json/markdown/report 五种格式，terminal 默认简洁模式（1行/条），--verbose 切换详细模式 ✅
  - 代码：`ts/src/output.ts`
- [W7] 结果导出 (依赖 W1, W6) — `--export <path>` + `--summary` Markdown 导出 ✅
  - 代码：`ts/src/index.ts`
- [W8] 跨会话 diff (依赖 P3) — 标记 isNew 结果，仅在有历史时显示 ✅
  - 代码：`ts/src/store.ts`

### 搜索源 [S]（12 个，MECE 矩阵）

| # | 源 | 类型 | 区域 | 认证 | 状态 |
|---|---|------|------|------|------|
| S1 | brave | API | 海外 | API key | ✅ |
| S2 | hackernews | scrape | 海外 | 无 | ✅ |
| S3 | reddit | API | 海外 | 无 | ✅ |
| S4 | github | API | 海外 | token(可选) | ✅ |
| S5 | stackoverflow | scrape | 海外 | 无 | ✅ |
| S6 | devto | API | 海外 | 无 | ✅ |
| S7 | youtube | scrape | 海外 | 无 | ✅ |
| S8 | wechat | scrape | 中国 | 无 | ✅ |
| S9 | weibo | browser | 中国 | QR 登录 | ✅ |
| S10 | zhihu | browser | 中国 | QR 登录 | ✅ |
| S11 | xiaohongshu | browser | 中国 | QR 登录 | ✅ |
| S12 | x | browser | 海外 | cookies | ✅ |

### 基础设施 [I]

| # | 功能 | CLI 命令 | 状态 |
|---|------|---------|------|
| I1 | LLM 多 profile | `profile add/list/use` | ✅ |
| I2 | TOML 配置 | `config list/set/path` | ✅ |
| I3 | 初始化向导 | `setup` | ✅ |
| I4 | 环境检查 | `doctor` | ✅ |
| I5 | QR 登录 | `login <platform>` | ✅ |
| I6 | Cookie 清理 | `logout <platform>` | ✅ |
| I7 | 搜索历史 | `history` / `history show <id>` | ✅ |
| I8 | 源状态检查 | `sources` / `sources test <name>` | ✅ |

## 未完成功能（发现桩代码/TODO）

无。所有已实现功能均完整。

## 已知问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | Gemini JSON schema 400 — OpenAI-compatible 不支持 strict mode | Gemini 作为 LLM 后端时报错 |
| 2 | 多源搜索不稳定 — 维度展开查询过多导致源超时 | wechat/zhihu/xiaohongshu/youtube 返回 0 |
| 3 | Brave API 间歇性失败 | 多源搜索中随机出现 ✗brave |
| 4 | ts/ 子目录未迁移到根目录 | npm publish 需要额外处理 |

### 可视化层 [V]（新增）

- [V1] Web 服务层 (依赖 P3) — HTTP API 暴露搜索数据 + 静态文件 serve，`moleminer web` 启动 ✅
  - 代码：`ts/src/web/server.ts`
- [V2] 搜索历史页 (依赖 V1, P3) — 列表展示历史搜索（时间/查询/结果数/源） ✅
  - 代码：`ts/src/web/ui/src/pages/SearchHistory.tsx`
- [V3] 结果详情页 (依赖 V1, P3) — 搜索结果列表 + 按 source/type 筛选 + 排序 ✅
  - 代码：`ts/src/web/ui/src/pages/SearchResults.tsx`
- [V4] Web 搜索入口 (依赖 V1, W1) — 输入框发起搜索 + SSE 实时进度推送 ✅
  - 代码：`ts/src/web/ui/src/components/SearchBar.tsx`, `ts/src/web/ui/src/components/SearchProgress.tsx`
- [V5] 地理信息提取 (依赖 P1, P6) — 内容抽取后独立 aiExtractLocations，基于完整 summary ✅
  - 代码：`ts/src/ai.ts` (aiExtractLocations), `ts/src/pipeline.ts` (调用点)
- [V6] 3D 地球视图 (依赖 V3, V5) — react-globe.gl 数字风格地球 + 标记点 + 交互 ✅
  - 代码：`ts/src/web/ui/src/components/GlobeView.tsx`
- [V7] 数据模型扩展 (依赖无) — SearchResult 增加可选 location 字段 + store schema 迁移 ✅
  - 代码：`ts/src/models.ts`, `ts/src/store.ts`
- [V8] 视图切换 (依赖 V3, V6) — 列表视图 ↔ 地球视图 无缝切换 ✅
  - 代码：`ts/src/web/ui/src/pages/SearchResults.tsx`
- [V9] SSE 搜索进度 (依赖 V1, W1) — Pipeline onProgress → SSE 推送到前端 ✅
  - 代码：`ts/src/web/server.ts`
- [V10] 优雅降级 (依赖 V6) — 无地理信息时 fallback 到纯列表，不显示空地球 ✅
  - 代码：`ts/src/web/ui/src/pages/SearchResults.tsx`
- [V11] Web QR 登录 (依赖 V1, P7) — 搜索前自动检测过期 cookie，弹出 QR 登录 modal，支持逐个扫码/跳过 ✅
  - 代码：`ts/src/web/ui/src/components/LoginModal.tsx`, `ts/src/web/ui/src/App.tsx` (loginQueue), `ts/src/web/server.ts` (login API)
  - 复用 CLI `playwrightLogin()` + `onQrReady` 回调，服务端转 QR data URL + SSE 推送
  - Sources 页 toggle 拦截：启用 auth 源时无 credentials 自动弹 QR modal
  - QR 过期自动刷新按钮（60s 倒计时）
- [V12] 源管理页 (依赖 V1) — 搜索源列表 + 启用/禁用 toggle + 状态指示 + 登录提示 ✅
  - 代码：`ts/src/web/ui/src/pages/SourcesPage.tsx`
- [V13] 设置页 (依赖 V1) — AI 引擎配置 + 搜索默认值展示 ✅
  - 代码：`ts/src/web/ui/src/pages/SettingsPage.tsx`

### 搜索策略 [T]（新增）

- [T1] SearchScope 动态粒度 (依赖 W4, P1) — LLM 输出 scope(local/national/global)，pipeline 全链路联动配额 ✅
  - 代码：`ts/src/ai.ts` (schema+prompt), `ts/src/pipeline.ts` (getScopeConfig), `ts/src/models.ts` (QueryPlan+scope)
  - Per-query 均衡：`BaseSource.search()` 接收 maxPerQuery 参数

## 建议的后续功能

| # | 功能 | 描述 | 依赖 |
|---|------|------|------|
| 1 | 按维度分组报告 | 结构化政策速查报告，LLM 提取关键信息 | W5 |
| 2 | 流式进度输出 | 搜索进度实时推送到 stderr，支持 pipe | W1 |
| 3 | 并发限制调优 | 按源设置并发上限，避免超时 | P2 |
| 4 | ts/ → 根目录迁移 | npm publish 标准化 | 基础设施 |
| 5 | 地球热力图模式 | 密度可视化（结果密集区域高亮） | V6 |
| 6 | 时间线动画 | 按时间维度播放结果出现顺序 | V6 |
| 7 | 结果导出图片/PDF | 地球视图截图 + 结果列表导出 | V6 |
| 8 | 多次搜索对比视图 | 地球上叠加多次搜索结果对比 | V6 |
