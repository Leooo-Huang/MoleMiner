# MoleMiner (矿鼹) — Project Context

## What is this

MoleMiner 是一个 AI 驱动的多源递归搜索 CLI 工具。
用户输入一个模糊意图，AI 自动生成查询、并行搜索 12 个中外平台、AI 分类和追踪线索，输出结构化结果。

## Key Decisions

### 定位
- **CLI 工具** + **Web 可视化伴侣**
- 可被 OpenClaw Skill 通过命令行调用：`moleminer search "query" --format json`
- `moleminer web` 启动本地 Web UI（sidebar 导航 + 3D 数字地球 + 搜索历史 + 在线搜索 + 源管理 + 设置）
- LLM 是必须依赖（不考虑无 LLM 场景）
- 许可证: MIT
- **语言: TypeScript**（从 Python 迁移完成）

### 架构: AI 递归搜索循环

```
Round 0:  ③AI生成查询(含智能源选择) → 并行搜索 → 去重 → ①AI分类 → ②AI提取实体(含置信度)
Round 1:  ③AI生成查询(从高置信度实体) → 并行搜索 → 去重 → ①AI分类 → ②AI提取实体
Round N:  ... → 无新实体 → 停止 → 输出结构化结果
```

三个 AI 函数（JSON schema 约束输出）：
1. `aiClassify` — 结果分类（direct / lead / irrelevant），通用 SPECIFICITY TEST，使用 fast model
2. `aiExtractEntities` — 从 lead 提取实体名 + 置信度(0-1)，使用 fast model
3. `aiGenerateQueries` — 智能源选择 + 跨语言查询 + 平台化查询生成，使用 strong model

关键特性：
- **跨语言锚定决策（三元）**: AI 识别查询的地理语言锚点，输出 anchor ∈ {zh, en, none}。`zh`/`en` 只搜对应语言源，`none`（全球话题）双语都搜。详见 docs/01-architecture.md PART 1。
- **智能源选择**: 基于 anchor 决定跳过不相关平台
- **双模式搜索**: 普通搜索（默认，无维度展开，保留时效性感知）+ 深度搜索（`--deep`，MECE 6 维度展开）
- **MECE 6 维度框架**: WHAT/WHERE/WHEN/WHO/HOW/SOURCE 正交，deep 模式至少展开 1 维（若 LLM 返回空则代码兜底注入 WHEN 维度）
- **过滤全 LLM 化**: 不再有规则预过滤层，相关性判断完全由 aiClassify 的 SPECIFICITY TEST 负责
- **实体置信度**: 基于互动数据/来源数量/内容具体程度评分(0-1)
- **跨轮去重**: 已搜过的实体不会重复搜索
- **元数据传递**: 各平台的互动数据(score/likes/comments/verified)原样传给 AI 判断质量
- **CLI 进度输出**: 实时显示每轮搜索进度到 stderr

### 信息源（12 个，MECE 矩阵）

| 功能 | 海外 | 中国 |
|------|------|------|
| 搜索引擎 | brave | — |
| 社区 | reddit, hackernews | — |
| 问答 | stackoverflow | 知乎 |
| 代码 | github | — |
| 视频 | youtube | — |
| 博客 | devto | 微信公众号 |
| 社交 | reddit, x | 微博, 小红书 |

### 技术选型
- 语言: TypeScript (Node.js)
- CLI 框架: commander
- HTTP: Node.js fetch (undici)
- LLM: fetch 直调 API（OpenAI + Anthropic + Ollama），不用 LangChain/litellm
- 分模型: 分类/提取用 gpt-4o-mini（快），查询生成用 gpt-5.4（强）
- 浏览器自动化: playwright（知乎/小红书/微博 QR 登录）
- QR 终端渲染: qrcode（知乎/微博支持 headless 终端 QR，小红书需弹浏览器）
- 存储: sql.js (SQLite in WASM)
- 测试: vitest + msw

## Design Docs
- `docs/00-project-spec.md` — 项目规格
- `docs/01-architecture.md` — AI 递归搜索架构
- `docs/02-tools-research.md` — 工具调研
- `docs/autodev-ideation.md` — 功能清单（AutoDev 格式）
- `docs/autodev-design.md` — 产品规格（AutoDev 格式）
- `docs/autodev-index.md` — 开发者地图
- `docs/autodev-rules.md` — 编码规则

## Origin
从 Radar 项目的搜索升级需求中独立出来。Radar 是 OpenClaw Skill（项目机会雷达），通过 CLI 调用 MoleMiner 获取搜索结果。
