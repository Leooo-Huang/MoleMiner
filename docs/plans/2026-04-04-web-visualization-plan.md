# MoleMiner — Web 可视化界面实施计划

> 生成时间：2026-04-04 | 基于：autodev-design.md, autodev-ui.md, autodev-api.md

## 概览

为 MoleMiner CLI 添加 Web 可视化伴侣界面，包含搜索历史浏览、结果详情、Web 搜索入口和 3D 数字地球视图。

**修改现有文件**：models.ts, store.ts, ai.ts, index.ts, package.json
**新增目录**：ts/src/web/ (服务端), ts/src/web/ui/ (React 前端)

## 任务列表

### Phase 1: 后端基础（数据模型 + 存储 + API）

#### Task 1: 数据模型扩展 — GeoLocation + SearchResult.location

**文件**：`ts/src/models.ts`

1. 新增 `GeoLocation` interface（name, lat, lng, level）
2. `SearchResult` 新增可选 `location?: GeoLocation` 字段

acceptance_criteria:
  - `GeoLocation` 类型从 `models.ts` 具名导出
  - `SearchResult` interface 包含 `location?: GeoLocation`
  - `tsc --noEmit` 无类型错误
  - 现有测试全部通过（`npm test`）
status: pending

#### Task 2: Store 扩展 — location 列 + 统计查��

**文件**：`ts/src/store.ts`

1. Schema 迁移：`ALTER TABLE results ADD COLUMN location TEXT`
2. `saveSearch()` 写入 location（JSON.stringify）
3. `getResults()` 返回时 JSON.parse location
4. 新增 `getSearchStats(searchId)` → 返回 directCount, leadCount, locationCount, sourceBreakdown

acceptance_criteria:
  - 新数据库自动创建 location 列
  - 已有数据库通过 ALTER TABLE 迁移（不丢数据）
  - `saveSearch()` 正确序列化 GeoLocation 到 JSON string
  - `getResults()` 返回的 result 包含 parsed `location` 对象或 null
  - `getSearchStats()` 返回正确的统计数据
  - 现有测试全部通过
  - 新增 store location 相关测试
status: pending

#### Task 3: AI classify 扩展 — 顺带提取地理信息

**文件**：`ts/src/ai.ts`

1. `CLASSIFY_SCHEMA` items 新增可选 `location` 字段（type object|null, properties: name/lat/lng/level）
2. `CLASSIFY_SYSTEM` prompt 追加 LOCATION EXTRACTION 规则
3. `aiClassify()` 返回时将 location 写入 SearchResult

acceptance_criteria:
  - CLASSIFY_SCHEMA 包含 location 字段定义
  - CLASSIFY_SYSTEM prompt 包含地理提取指令
  - aiClassify 返回的 SearchResult 中 location 字段被正确设置（有地理信息时为 GeoLocation 对象，无则为 undefined）
  - 现有 classify 测试仍通过
  - 新增测试：含地理信息的结果返回正确的 GeoLocation
status: pending

#### Task 4: Web 服务端 — HTTP API + 静态文件

**文件**：`ts/src/web/server.ts`（新建）

1. Node.js 原生 `http.createServer()`
2. 路由：GET /api/searches, GET /api/searches/:id, POST /api/search, GET /api/search/stream
3. 静态文件 serve（dist/web/ 目录 + SPA fallback）
4. CORS 头（开发时 Vite devserver 跨域）
5. JSON body parser（POST 请求）

acceptance_criteria:
  - `GET /api/searches` 返回 200 + searches 数组
  - `GET /api/searches/1` 返回 200 + search + results + stats
  - `GET /api/searches/999` 返回 404 + error JSON
  - `POST /api/search` 返回 200 + searchId
  - `POST /api/search` body 缺少 query 返回 400
  - 非 /api/ 路径返回 dist/web/index.html（SPA fallback）
  - 静态文件正确设置 Content-Type
status: pending

#### Task 5: SSE 搜索进度推送

**文件**：`ts/src/web/server.ts`（扩展 Task 4���

1. `GET /api/search/stream?id={searchId}` 建立 SSE 连接
2. Pipeline onProgress → 映射为 SSE event（progress/complete/error���
3. 搜索完成时发送 complete 事件含 store searchId
4. 连接断开不中止搜索

acceptance_criteria:
  - SSE 连接返回 `Content-Type: text/event-stream`
  - Pipeline 每个 progress 事件正确映射为 SSE data
  - 搜索完成后发送 `event: complete` + searchId
  - 搜索失败发送 `event: error` + message
  - 无效 searchId 返回 404 text/plain（非 SSE）
status: pending

#### Task 6: CLI `web` 子命令

**文件**：`ts/src/index.ts`

1. 新增 `moleminer web` 命令，`--port`（默认 3456）和 `--no-open` 选项
2. 启动 Web 服务
3. 默认打开浏览器
4. Ctrl+C 优雅关闭（关闭 HTTP server + store）

acceptance_criteria:
  - `moleminer web` 启动 HTTP 服务并输出 URL
  - `moleminer web --port 8080` 在 8080 端口启动
  - `moleminer web --no-open` 不打开浏览器
  - Ctrl+C 正确关闭服务（无 orphan process）
  - CLI help 中显示 web 命令说明
status: pending

### Phase 2: 前端（React SPA + 3D 地球）

#### Task 7: 前端项目初始化

**目录**：`ts/src/web/ui/`（新建）

1. Vite + React + TypeScript 项目结构
2. 依赖：react@^19, react-dom@^19, react-globe.gl@^2, three@^0.170, tailwindcss@^4
3. Vite 配置：build output → `../../dist/web/`
4. Tailwind 配置：深色主题色彩系统
5. 入口 HTML + 全局样式

acceptance_criteria:
  - `cd ts/src/web/ui && npm run dev` 启动 Vite dev server
  - `cd ts/src/web/ui && npm run build` 输出到 `ts/dist/web/`
  - 构建产物包含 index.html + JS bundle + CSS
  - Tailwind 深色主题色彩变量可用
  - TypeScript 严格模式，`tsc --noEmit` 无错误
status: pending

#### Task 8: SearchHistory 页面（首页）

**文件**：`ts/src/web/ui/src/pages/SearchHistory.tsx`（新建）

1. 搜索输入框（SearchBar 组件）
2. 历史搜索卡片列表（HistoryCard 组件）
3. fetch GET /api/searches 获取数据
4. 点击卡片导航到 #/search/:id
5. 状态：加载骨架屏、空状态提示、正常列表

acceptance_criteria:
  - 页面加载时 fetch /api/searches 并显示列表
  - 每张卡片显示：query, searchedAt, resultCount, directCount, leadCount, locationCount
  - 点击卡片跳转到 #/search/:id
  - 无搜索记录时显示空状态引导文案
  - 加载中显示骨架屏（3 张卡片形状）
status: pending

#### Task 9: SearchResults 页面 — 列表视图

**文件**：`ts/src/web/ui/src/pages/SearchResults.tsx`（新建）

1. 搜索元信息区（query, time, rounds, sources 统计）
2. 视图切换按钮组（列表/地球）
3. 筛选栏（source 多选 + type 筛选）
4. ResultCard 组件（标题/URL/source/location/摘要）
5. fetch GET /api/searches/:id 获取数据

acceptance_criteria:
  - 页面加载时 fetch /api/searches/:id 并显示结果列表
  - 筛选 source 正确过滤结果
  - 筛选 type (direct/lead) 正确过滤结果
  - 结果卡片中 direct 显示绿色标记，lead 显示橙色标记
  - 有 location 的结果显示位置名称
  - 点击结果标题在新标签打开原始 URL
  - 无结果时显示空状态
status: pending

#### Task 10: GlobeView — 3D 数字地球

**文件**��`ts/src/web/ui/src/components/GlobeView.tsx`（新建）

1. react-globe.gl 渲染数字风格地球（深色海洋 + 深色陆地 + 发光边界线）
2. 有 location 的结果显示为发光标记点
3. 同城市多结果聚合为大标记（显示数量）
4. 鼠标拖拽旋转、滚轮缩放
5. 点击标记 → 触发 onMarkerClick，传递位置和结果列表
6. 缓慢自转动效（用户拖拽时停止）

acceptance_criteria:
  - 地球以数字风格渲染（深色 + 发光边界，非卫星图）
  - 每个有 location 的结果显示为标记点
  - 标记点带脉冲发光动效
  - 同坐标（lat/lng 四舍五入到小数点 1 位）结果聚合为一个大标记
  - 聚合标记显示结���数量
  - 拖拽旋转流畅（无明显卡顿）
  - 点击标记触发回调，传递该位置的结果数组
  - 地球默认缓慢自转，用户交互时停止
status: pending

#### Task 11: LocationPanel — 地球视图侧面板

**文件**：`ts/src/web/ui/src/components/LocationPanel.tsx`（新建）

1. 显示选中位置名称 + 结果数量
2. 结果卡片列表（复用 ResultCard）
3. 未选中时显示提示："点击地球上的标记查看详情"

acceptance_criteria:
  - 选中标记后显示位置名称和结果列表
  - 切换标记时面板内容更新
  - 未选中状态显示引导文案
  - 面板在 ≥1024px 右侧 40% 宽度，<1024px 下方全宽
status: pending

#### Task 12: 视图切换 + 优雅降级

**文件**：`ts/src/web/ui/src/pages/SearchResults.tsx`（扩展 Task 9）

1. 列表视图 ↔ 地球视图切换（crossfade 动效 300ms）
2. 无 location 结果时地球按钮置灰 + tooltip
3. 部分有 location 时按钮显示 "(N 条有位置)"
4. 地球视图只渲染有 location 的结果

acceptance_criteria:
  - 切换按钮正确切换视图
  - 切换有 crossfade 过渡效果
  - locationCount === 0 时地球按钮 disabled + tooltip "该搜索结果无地理信息"
  - 0 < locationCount < totalCount 时按钮显示 "(N 条有位置信息)"
  - 地球视图只显示有 location 的标记点
  - <640px 宽度时隐藏地球视图按钮
status: pending

#### Task 13: Web 搜索 + SSE 进度

**文件**：`ts/src/web/ui/src/components/SearchProgress.tsx`（新建）

1. 搜索框提交 → POST /api/search → 获取 searchId
2. 建立 SSE 连接 GET /api/search/stream?id={searchId}
3. 进度覆盖层：进度条 + 源状态列表 + 分类统计
4. complete 事件 → ��转到 #/search/:id
5. error 事件 → 显示错误信息 + 重试按钮

acceptance_criteria:
  - 搜索框提交后显示进度覆盖层
  - SSE 事件实时更新源状态（✓完成/⟳进行中/✗失败）
  - 进度条跟随 round 进度
  - 搜索完成后自动跳转到结果页
  - 搜索失败显示错误信息
  - 可以从进度覆盖层取消（关闭覆盖层，搜索后台继续）
status: pending

### Phase 3: 集成 + 构建

#### Task 14: 构建管线集���

**文件**：`ts/package.json`, `ts/src/web/ui/package.json`

1. 前端 build 命令：`npm run build:web`（在 ts/ 下触发前���构建）
2. 主 build 命令更新：先 build:web → 再 esbuild 主程序
3. dist/web/ 在 .gitignore 中

acceptance_criteria:
  - `cd ts && npm run build:web` 构建前端到 `dist/web/`
  - `cd ts && npm run build` 先构建前端再构建主程序
  - `dist/web/` 在 .gitignore 中
  - 构建产物可被 server.ts 正确 serve
status: pending

#### Task 15: 测试

**文件**：`ts/tests/web/server.test.ts`（新建）

1. API 端点测试（GET/POST + 正常/异常路径）
2. 静态文件 serve 测试
3. SSE 连接测试
4. 现有测试回归验证

acceptance_criteria:
  - 所有 API 端点有正常 + 异常路径测试
  - SSE 事件流测试
  - 现有 38 个测试全部通过
  - 新增测试全部通过
  - `npm test` 总体通过
status: pending

## 实施顺序

```
Task 1 (models) ──→ Task 2 (store) ──→ Task 3 (ai.ts) ──→ Task 4+5 (server)
                                                            ↓
Task 7 (前端初始化) ──→ Task 8 (历史页) ──→ Task 9 (列表视图) ──→ Task 10+11 (地球)
                                                                    ↓
Task 6 (CLI web) ──→ Task 12 (视图切换) ──→ Task 13 (搜索进度) ──→ Task 14 (构建) ��─→ Task 15 (测试)
```

## 风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| classify schema 扩展导致 LLM 输出不稳定 | location 字段可能随机缺失 | location 是可选字段，缺失不影响核心流程 |
| react-globe.gl 与 Vite/React 19 兼容性 | 构建或运行时报错 | Task 7 阶段验证，不兼容则降级到 globe.gl vanilla |
| 前端 bundle 过大 | 首次加载慢 | Vite 自动 tree-shake + code split |
| SSE 在某些代理/防火墙下被切断 | 进度无法实时更新 | complete 后用轮询 fallback 获取最终结果 |
