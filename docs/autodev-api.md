# MoleMiner — Web API 设计

> 新增功能 | 生成时间：2026-04-04

## API 约定

- **基础路径**：`http://localhost:{port}/api/`（默认端口 3456）
- **响应格式**：JSON，统一 envelope
- **错误格式**：`{ error: string, status: number }`
- **无认证**：本地 HTTP 服务，不暴露到外网
- **无分页**：搜索历史和结果数量有限，不需要分页

## 数据模型变更

### SearchResult 扩展

```typescript
// models.ts 新增
export interface GeoLocation {
  name: string;    // "深圳市南山区"
  lat: number;     // 22.5431
  lng: number;     // 113.9298
  level: 'country' | 'region' | 'city' | 'district';
}

// SearchResult 新增可选字段
interface SearchResult {
  // ... 现有字段不变
  location?: GeoLocation;
}
```

### SQLite Schema 迁移

```sql
-- results 表新增列（可选，JSON 存储）
ALTER TABLE results ADD COLUMN location TEXT;
-- 存储格式：JSON string of GeoLocation | null
```

### 对现有功能的影响

- `store.saveSearch()` — 新增 location 列写入
- `store.getResults()` — 返回数据自动包含 location（JSON parse）
- CLI 输出 — `formatJson` 自动包含 location（SearchResult 类型扩展）
- **不影响**：pipeline.ts, aggregate.ts, 所有 source 实现

## 端点设计

### GET /api/searches

**用途**：获取搜索历史列表

**响应**：
```typescript
{
  searches: Array<{  // completed searches
    id: number;
    query: string;
    sourcesUsed: string[];
    resultCount: number;
    searchedAt: string;       // ISO 8601
    locationCount: number;    // 有 location 的结果数
    directCount: number;      // direct 类型数量
    leadCount: number;        // lead 类型数量
  }>;
  active: Array<{  // in-progress searches (updated 2026-04-04)
    tempId: string;
    query: string;
    searchedAt: string;
    status: 'searching';
  }>;
}
```

**实现**：调用 `store.listSearches()` + 对每个 search 统计 location/type 计数 + 遍历 `activeSearches` Map。

### GET /api/searches/:id

**用途**：获取某次搜索的详情和所有结果

**响应**：
```typescript
{
  search: {
    id: number;
    query: string;
    sourcesUsed: string[];
    resultCount: number;
    searchedAt: string;
  };
  results: Array<{
    id: number;
    title: string;
    url: string;
    source: string;
    snippet: string;
    resultType: 'direct' | 'lead';
    language?: string;
    timestamp?: string;
    summary?: string;
    location?: GeoLocation;
    metadata?: Record<string, unknown>;
  }>;
  stats: {
    directCount: number;
    leadCount: number;
    locationCount: number;
    sourceBreakdown: Record<string, number>;  // { brave: 45, reddit: 23 }
  };
}
```

**错误**：
- `404 { error: "Search not found", status: 404 }`

### POST /api/search

**用途**：发起新搜索

**请求体**：
```typescript
{
  query: string;                   // 必填
  sources?: string[];              // 可选，未传时回退到 config.defaultSources，再无配置则全源
  maxRounds?: number;              // 可选，默认 config.defaultMaxRounds
  deep?: boolean;                  // 可选，深度搜索模式（维度展开 + 跨语言查询），默认 false
}
```

**响应**（搜索开始后立即返回）：
```typescript
{
  searchId: string;                // 用于 SSE 订阅的临时 ID
  message: "Search started"
}
```

**业务规则**：
- 搜索异步执行，进度通过 SSE 推送
- 搜索完成后保存到 store，SSE 推送 `complete` 事件含持久化 searchId
- `sources` 未传时使用 `config.defaultSources`，与 CLI 行为一致
- `deep: true` 启用维度展开 + 跨语言查询 + 三层查询分发，覆盖更广但耗时更长

**错误**：
- `400 { error: "query is required", status: 400 }`

### GET /api/search/stream?id={searchId}

**用途**：SSE 订阅搜索进度

**协议**：Server-Sent Events（`Content-Type: text/event-stream`）

**事件类型**：
```
event: progress
data: {"type": "source_start", "source": "brave"}

event: progress
data: {"type": "source_done", "source": "brave", "count": 45, "elapsed": 1.2}

event: progress
data: {"type": "source_error", "source": "youtube", "error": "timeout"}

event: progress
data: {"type": "classify_done", "direct": 42, "lead": 26, "irrelevant": 3}

event: progress
data: {"type": "round_done", "round": 1, "totalResults": 71}

event: complete
data: {"searchId": 15, "totalResults": 71}

event: error
data: {"message": "Search failed: ..."}
```

**规则**：
- Pipeline 的 `onProgress` 回调 → 映射为 SSE 事件
- 连接断开时不中止搜索（搜索继续在后台执行）
- 搜索完成后发送 `complete` 事件，客户端用返回的 `searchId`（store ID）重新获取结果

### GET /api/sources

**用途**：列出所有搜索源及其实时健康状态

**响应**：
```typescript
{
  sources: Array<{
    name: string;                       // "brave", "zhihu", ...
    type: 'api' | 'scrape' | 'browser';
    requiresAuth: boolean;              // 是否需要 cookies / 登录
    enabled: boolean;                   // 源配置是否完整（API key / cookies 存在）
    hasCredentials: boolean;            // 凭据是否已配置（仅 requiresAuth 为 true 时有意义）
    isInDefaultSources: boolean;        // 是否在当前 defaultSources 配置中启用
    lastStatus: {
      status: 'ok' | 'error' | 'timeout' | 'disabled' | 'skipped';
      resultCount: number;              // 上一次搜索本源返回的结果数
      error?: string;                   // 错误消息（仅 error/timeout 时出现）
      elapsedSeconds?: number;          // 搜索耗时
      createdAt: string;                // ISO 8601
    } | null;                           // null 表示该源从未参与过任何搜索
  }>;
}
```

**业务规则**：
- `lastStatus` 来自 `source_statuses` 表（每次搜索后由 pipeline 写入）
- 对每个 source_name，只返回最新的一条状态（按 id DESC）
- 前端用 `lastStatus.status` + `resultCount` 决定 UI 颜色：
  - `ok` 且 `resultCount > 0` → 绿色（正常）
  - `ok` 且 `resultCount === 0` → 黄色（0 结果）
  - `skipped` → 灰色（跳过）
  - `error` / `timeout` → 红色（悬停显示 error 消息）
  - `lastStatus === null` → 灰色（从未搜索）

### PATCH /api/sources/:name

**用途**：启用/禁用单个源（写入 `config.defaultSources`）

**请求体**：
```typescript
{ enabled: boolean }
```

**响应**：`{ ok: true, defaultSources: string[] }`

### GET /api/config

**用途**：获取当前配置快照（masked 敏感字段）

### PATCH /api/config

**用途**：更新单个配置字段

**请求体**：
```typescript
{ key: string, value: string | number }
```

**业务规则**：
- 拒绝 profile-managed keys（llmProvider, llmModel, llmFastModel, llmApiKey, llmBaseUrl）
- 调用 `config.setValue()` + `config.save()` 写入 `~/.moleminer/config.toml`

### POST /api/login/:platform

**用途**：启动 Playwright QR 登录流程（Web UI 专用）

**请求**：URL 中 `:platform` 为平台名（zhihu / weibo / xiaohongshu）

**响应**：
```typescript
{ loginId: string; platform: string }
```

**业务规则**：
- 后台异步启动 `playwrightLogin(platform, { cancelToken, onQrReady })`
- QR 码生成后通过 SSE 推送 `qr_ready` 事件（含 PNG data URL）
- 登录成功推送 `success`，失败推送 `error`
- 支持 `cancelToken` 取消：用户跳过/页面卸载时终止 Playwright 浏览器进程
- 登录会话 60s 后自动清理

### GET /api/login/stream?id={loginId}

**用途**：SSE 订阅登录进度

**事件类型**：
```
event: qr_ready
data: {"loginId": "login-1", "platform": "zhihu", "qrDataUrl": "data:image/png;base64,..."}

event: success
data: {"loginId": "login-1", "platform": "zhihu"}

event: error
data: {"loginId": "login-1", "message": "Login timed out"}

event: cancelled
data: {"loginId": "login-1"}
```

**规则**：
- 晚连接自动 replay 已缓冲事件（bufferedEvents）
- 登录会话结束后立即关闭连接

### DELETE /api/login/:loginId

**用途**：取消登录（用户跳过/页面关闭）

**响应**：`{ ok: true }`

**业务规则**：
- 设置 `cancelToken.cancelled = true`，Playwright 轮询循环检测后 throw → browser.close()
- 向所有 SSE 监听者广播 `cancelled` 事件
- 立即从 activeLogins Map 中删除会话

## 静态文件

所有非 `/api/` 路径 → serve `dist/web/` 静态文件
- 直接文件匹配 → 返回文件（JS/CSS/图片）
- 其他 → 返回 `index.html`（SPA fallback）
- `Content-Type` 根据文件扩展名设置

## CLI 集成

```
moleminer web [--port 3456] [--no-open]
```

- 启动 HTTP 服务
- 默认打开浏览器（`--no-open` 跳过）
- Ctrl+C 优雅关闭
- 输出：`Server running at http://localhost:3456`
