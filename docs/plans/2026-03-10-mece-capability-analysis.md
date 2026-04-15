# MoleMiner MECE 能力分析

> 由 autodev 框架（第一性原理 + MECE 分解）生成
> 2026-03-19 重构：从线性管线 SDK → AI 递归搜索 CLI

## 第一性原理

**用户的本质任务：** 输入一个模糊意图，自动深挖到一手来源。

**核心价值链：**
```
模糊意图 → AI 生成查询 → 多源并行搜索 → AI 分类(direct/lead)
    ↑                                              ↓
    └── AI 从 lead 提取实体 → 生成新查询 ← 递归循环 ┘
                                                    ↓
                                            结构化结果输出
```

**关键失败模式：**
- F1: 查询-源不匹配（AI 生成的查询不适合目标平台）
- F2: 源退化（源失效时用户得不到结果）
- F3: 去重假阴性（同一内容在不同 URL 重复出现）
- F6: 过时结果（返回已过期的信息）
- F7: 静默降级（源失败但用户不知道）
- F9: 递归死循环（线索不收敛，无限追踪）
- F10: LLM 分类错误（direct 误判为 lead 或反之）

## MECE 能力清单

### 必需 (R)

| ID | 能力 | 状态 | 说明 |
|----|------|------|------|
| R1 | 查询接受 | ✅ | CLI 入口（含快捷方式 `moleminer "query"`） |
| R2 | AI 查询生成 | 🔄 | `ai.py` — AI 生成平台化查询（替代 enhance.py） |
| R3 | 源抽象 | ✅ | BaseSource ABC |
| R4 | 源发现与注册 | ✅ | Registry + guarded imports |
| R5 | 并行调度 | ✅ | asyncio.gather + per-source timeout |
| R6 | 结果规范化 | ✅ | SearchResult dataclass |
| R7 | 去重 | ✅ | URL 去重 + 标题 trigram 模糊匹配 |
| R8 | AI 结果分类 | 🔄 | `ai.py` — AI 分类 direct/lead（替代规则分类） |
| R9 | 时效过滤 | ✅ | aggregate 阶段 filter_by_freshness |
| R10 | AI 实体提取 | 🔄 | `ai.py` — 从 lead 提取实体名（替代 resolve.py） |
| R11 | 递归搜索循环 | 🔄 | `pipeline.py` — 实体 → 新查询 → 再搜 → 收敛 |
| R12 | 配置管理 | ✅ | TOML + env vars |
| R13 | 凭证管理 | ✅ | setup wizard + config + doctor |
| R14 | CLI 界面 | ✅ | search + sources + history + setup + config + doctor + login/logout |
| R15 | LLM 集成 | 🔄 | OpenAI + Anthropic adapter + JSON schema 约束 |
| R16 | 输出格式化 | ✅ | table/json/markdown |
| R17 | 持久存储 | ✅ | SQLite |

**状态说明：** ✅ 已完成 | 🔄 Phase 6 重构中 | ❌ 未开始

### 可选 (O)

| ID | 能力 | 状态 | 说明 |
|----|------|------|------|
| O1 | 搜索元数据报告 | ✅ | SearchResponse + SourceStatus |
| O2 | 结果排序 | ❌ | |
| O3 | 浏览器认证 | ✅ | Playwright QR 扫码登录 |
| O4 | 速率限制管理 | ❌ | |
| O5 | 重试逻辑 | ❌ | |
| O6 | 缓存/增量搜索 | ❌ | |
| O7 | 插件/自定义源 | ⚠️ | Registry 支持但无文档 |
| O8 | 进度报告 | ⚠️ | 有 source status 但无实时进度 |
| O9 | 历史查询 | ✅ | CLI history 命令 |

### 已删除的能力

| 原 ID | 能力 | 原因 |
|-------|------|------|
| R15(旧) | SDK 界面 | 改为纯 CLI，不再暴露 Python import |
| R11(旧) | 内容提取 | trafilatura/jina_reader 随 resolve.py 删除 |

## 信息源 MECE 矩阵（15 个）

| 功能 | 海外 | 中国 |
|------|------|------|
| 搜索引擎 | brave, google | — |
| 社区 | reddit, hackernews | — |
| 问答 | stackoverflow | 知乎 |
| 代码 | github | — |
| 视频 | youtube | — |
| 产品 | producthunt | — |
| 博客 | devto | 微信公众号 |
| 社交 | reddit | 微博, 小红书 |

**MECE 清理（2026-03-19）：**
- 删除 tavily — 与 brave/google 重叠
- 删除 exa — 与 brave/google 重叠
- 删除 lobsters — 与 hackernews 重叠

## 变更历史

### 2026-03-10: Phase 1-3

1. ~~R7 去重增强~~ ✅ 标题 trigram Jaccard
2. ~~R9 时效过滤~~ ✅ filter_by_freshness
3. ~~R14 CLI 补全~~ ✅ sources + history
4. ~~O1 搜索元数据~~ ✅ SearchResponse + SourceStatus
5. ~~F7 静默降级~~ ✅ source status line

### 2026-03-11: Phase 4

6. ~~R13 凭证管理~~ ✅ setup + config + doctor
7. ~~R2 查询增强~~ ✅ enhance.py
8. ~~R8 结果分类~~ ✅ classify_result()
9. ~~R10 线索解析~~ ✅ resolve.py
10. ~~R11 内容提取~~ ✅ trafilatura + jina_reader

### 2026-03-12: Phase 5

11. ~~O3 浏览器认证~~ ✅ Playwright QR 登录
12. ~~国内四平台~~ ✅ weibo, wechat, zhihu, xiaohongshu
13. ~~CLI login/logout~~ ✅

### 2026-03-19: Phase 6 架构重构（进行中）

14. 🔄 R2/R8/R10 → 合并为 `ai.py` 三个 AI 函数
15. 🔄 R11 递归搜索循环（pipeline.py 重写）
16. 🔄 R15 LLM Anthropic adapter + JSON schema 约束
17. 🔄 删除 SDK 接口、enhance.py、resolve.py、extract.py、jina_reader.py
18. 🔄 MECE 源清理：删除 tavily、exa、lobsters
