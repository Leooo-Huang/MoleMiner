# MoleMiner (矿鼹) — Project Specification

## 项目定位

**AI 驱动的多源递归搜索 CLI 工具。**

输入一个模糊意图，AI 自动生成平台化查询、并行搜索 11 个中外平台、AI 分类结果（直接来源 vs 线索）、从线索中提取实体递归追踪，直到找到一手来源。

一句话：`npx moleminer "AI hackathon 2026"`

## 名字

- 英文：**moleminer**
- 中文：**矿鼹**（鼹鼠矿工，深挖信息）
- npm 包名：`moleminer`

## 目标

- GitHub 10k stars
- 填补市场空白：没有现成 CLI 工具做 "AI 递归搜索 + 多源并行 + 线索追踪"

## 竞品分析

| 项目 | Stars | 差异 |
|------|-------|------|
| SearXNG | ~15k | 无 AI，无递归追踪，无社区源 |
| Perplexica | ~20k | TypeScript 全栈应用，不是 CLI |
| GPT Researcher | ~17k | 生成报告，不返回结构化结果；递归树模式（token 二次增长） |
| Tavily | 商业 | 闭源，不含社区路径，不支持中国平台 |

**MoleMiner 的差异化：**
1. **递归线索追踪** — 不只搜一次，追到一手来源为止
2. **11 个中外平台** — 包括知乎/小红书/微博/微信
3. **CLI 工具** — 可被 AI Agent（如 OpenClaw）直接调用
4. **结构化输出** — 返回 JSON，不是报告

## 目标用户

1. **AI Agent 构建者** — Agent 调用 `moleminer search --format json` 获取搜索结果
2. **开发者 / 研究人员** — CLI 直接搜索多平台

## 产品形态

- **CLI 工具** — `moleminer "AI hackathon 2026"` 直接使用
- **可被 OpenClaw Skill 调用** — `moleminer search "query" --format json`

## 许可证

MIT

---

## 技术决策

### 语言：TypeScript (Node.js)

项目从 Python 完整迁移到 TypeScript。

### 核心依赖

| 库 | 用途 |
|-----|------|
| commander | CLI 框架 |
| Node.js fetch (undici) | HTTP 请求 |
| sql.js | SQLite (WASM) 存储 |
| playwright | 浏览器自动化（中国平台 QR 登录） |
| qrcode | 终端 QR 渲染 |
| vitest + msw | 测试 |

### LLM（必须依赖）

- 直接用 fetch 调 API，不用 LangChain，不用 litellm
- 支持 OpenAI（GPT-5.4）+ Anthropic（Claude 4.6）+ Gemini（OpenAI 兼容层）+ Ollama
- 使用 JSON schema 约束输出，100% 格式合规
- 多 profile 支持：`moleminer profile add/use/list`
- 自动重试：429/5xx 指数退避（3 次，1s/2s/4s）

### 安装

```bash
npm install -g moleminer        # 核心 11 源 + LLM

# 可选：X/Twitter 源
uv tool install twitter-cli     # 或 pipx install twitter-cli
```

### 代码来源

| 部分 | 来源 | 许可证 |
|------|------|--------|
| 国外社区搜索 | 基于 last30days-openclaw 改造 | MIT（需 ATTRIBUTION） |
| XHS 签名算法 | 移植自 xhshow (Python MIT) | MIT |
| 国内平台搜索 | clean-room 自写（参考 MediaCrawler 思路） | 原创 |
| AI 递归搜索 / 聚合 | 自写 | 原创 |

---

## 信息源（11 个，MECE 矩阵）

### 功能 × 地区矩阵

| 功能 | 海外 | 中国 |
|------|------|------|
| 搜索引擎 | brave | — |
| 社区 | reddit, hackernews | — |
| 问答 | stackoverflow | 知乎 |
| 代码 | github | — |
| 视频 | youtube | — |
| 博客 | devto | 微信公众号 |
| 社交 | reddit | 微博, 小红书 |

**已删除（MECE 清理）:** google, producthunt, tavily, exa, lobsters（与 brave/reddit 重叠）

**可选扩展（12 个）:** X/Twitter（需安装 twitter-cli）

### 分层

**零配置（8 个）:** hackernews, github, stackoverflow, devto, reddit, youtube, weibo, wechat

**需 API key（1 个）:** brave

**需 QR 登录（2 个）:** 知乎（headless 终端 QR）, 小红书（headless 终端 QR）

**可选（1 个）:** X/Twitter（需 twitter-cli）

---

## AI 递归搜索架构

### 核心循环

```
Round 0:  ③AI生成查询(智能源选择) → 并行搜索 → 去重 → ①AI分类(direct/lead/irrelevant) → ②AI提取实体(置信度0-1)
Round 1+: ③AI生成查询(只用brave,锚定原始意图) → 搜索 → 去重 → ①分类 → ②提取 → 收敛检查
Round N:  无新实体 → 停止 → 输出结构化结果
```

### 三个 AI 函数（`ts/src/ai.ts`）

1. **aiClassify** — 结果 → direct / lead / irrelevant（irrelevant 直接丢弃）
2. **aiExtractEntities** — lead → 实体名 + 置信度(0-1)，top 10
3. **aiGenerateQueries** — 意图/实体 → 平台化查询（Round 0 AI 选源；Round 1+ 只用 brave）

### 反漂移三层防御

1. **三类分类** — irrelevant 在提取前过滤
2. **实体试金石测试** — 屏蔽通用词（深圳、AI、百度）
3. **Round 1+ 查询锚定** — 实体名+原始意图关键词，不单搜实体名

### 收敛条件

1. 达到 max_rounds（默认 3）
2. 本轮无新实体
3. 本轮搜索去重后无新结果

详见 `docs/01-architecture.md`。

---

## CLI 接口

```bash
# 搜索
moleminer "AI hackathon 2026"
moleminer search "AI hackathon" --max-rounds 3 --format json

# 源管理
moleminer sources              # 查看可用源（11/12）
moleminer login zhihu          # headless 终端 QR 扫码登录
moleminer login xiaohongshu    # headless 终端 QR 扫码登录
moleminer login weibo          # headless 终端 QR 扫码登录
moleminer logout zhihu         # 清除 Cookie

# 配置
moleminer profile add          # 添加 LLM profile
moleminer profile use <name>   # 切换 profile
moleminer config list          # 查看配置
moleminer config set KEY VAL   # 设置配置
moleminer doctor               # 环境检查
moleminer history              # 搜索历史
```

---

## 配置

`~/.moleminer/config.toml`

```toml
[moleminer]
max_rounds = 3
default_format = "table"

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

环境变量覆盖：`MOLEMINER_LLM_PROVIDER`, `MOLEMINER_LLM_API_KEY` 等。

### API Keys

| 源 | Key | 获取 |
|----|-----|------|
| brave | `BRAVE_API_KEY` / config | https://api.search.brave.com |
| LLM | profile.api_key | OpenAI / Google / Anthropic |

---

## 存储

SQLite (`~/.moleminer/moleminer.db`)，自动入库最终结果。

---

## 开发状态

### 已完成 ✅

- 11 个信息源（全部可用）
- AI 递归搜索循环（含反漂移防御）
- 三个 AI 函数（JSON schema 约束输出）
- LLM 多 provider + 多 profile + 自动重试
- XHS 签名算法纯 TypeScript 实现（xhs-sign.ts）
- 国内三平台 headless 终端 QR 登录（知乎/微博/小红书）
- CLI 全命令（search/sources/login/logout/profile/config/doctor/history）
- SQLite 持久存储
- 261 测试通过

### 可选待做

- [ ] X/Twitter 源（需 twitter-cli，可选依赖）
- [ ] npm 发布配置（package.json bin/files）
- [ ] README.md（GIF demo + 架构图 + Quick Start）
- [ ] GitHub Actions CI
- [ ] 结果排序（按相关度/时间）
- [ ] 速率限制管理
