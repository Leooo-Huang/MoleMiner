# MoleMiner (矿鼹) — Project Context

## What is this

MoleMiner 是一个 LLM-powered 多源搜索聚合 CLI 工具 + Python SDK。
用户输入一个模糊意图，自动增强查询、并行搜索中外多平台、聚合去重、线索追踪，输出结构化结果。

## Key Decisions (from design session 2026-03-09)

### 名字
- 英文: **moleminer** (鼹鼠矿工，深挖信息)
- 中文: **矿鼹**
- PyPI: `moleminer`

### 定位
- Python CLI + SDK，不是全栈应用
- 目标 10k GitHub stars
- 填补市场空白：没有现成 Python SDK 做 "LLM query 增强 + 多源并行搜索 + 线索解析"
- 许可证: MIT

### 目标用户
1. 开发者 / AI Agent 构建者
2. 研究人员 / 分析师

### 产品形态
- CLI: `moleminer search "AI hackathon 2026"`
- SDK: `from moleminer import search`
- 可被 OpenClaw Skill 直接调用

### 核心架构: 5 阶段管线
1. **Query Enhancement** — LLM 生成平台化搜索词
2. **Parallel Dispatch** — 并行搜索所有启用的源
3. **Aggregate** — 去重、时效过滤、分类 direct vs lead
4. **Lead Resolution** — 社区线索 → 提取实体名 → 搜官方链接
5. **Output & Store** — 结构化输出 + 自动入库 SQLite（query 元信息 + 聚合结果全存，不做评分）

### 安装分层
```
pip install moleminer            # 零配置: Google scraping + HN + Jina
pip install moleminer[tavily]    # + Tavily（需 API key）
pip install moleminer[brave]     # + Brave Search（需 key, 免费 2000/月）
pip install moleminer[social]    # + Reddit/X（需 API key）
pip install moleminer[cn]        # + 知乎/小红书/微博（Playwright + Cookie）
pip install moleminer[all]       # 全部
```

### 代码来源
- 国外社区搜索: 基于 last30days-openclaw 代码改造（MIT 许可证，需 ATTRIBUTION）
- 国内社区搜索: clean-room 自写（参考 MediaCrawler 思路，不抄代码，因为它是非商业协议）
- LLM 增强 / 聚合 / 线索解析: 自写

### 技术选型
- 语言: Python
- CLI 框架: click
- HTTP: httpx (async)
- 终端输出: rich
- 浏览器自动化: playwright（仅 [cn] extra）
- LLM: 直接调 API，不用 LangChain
- 存储: SQLite（自动存储，query 元信息 + 聚合结果全部入库）

### 竞品
| 项目 | 差异 |
|------|------|
| SearXNG (~15k) | 无 LLM，无社区，无线索解析 |
| Perplexica (~20k) | TypeScript 全栈，不是 SDK |
| GPT Researcher (~17k) | 生成报告，不返回结构化结果 |

## Design Docs
- `docs/00-project-spec.md` — 完整项目规格
- `docs/01-architecture.md` — 5 阶段管线架构
- `docs/02-tools-research.md` — 工具调研和依赖规划

## Development Phases
1. **Phase 1 MVP**: 项目脚手架 + google + hackernews + jina + CLI
2. **Phase 2**: tavily + brave + auth/config
3. **Phase 3**: reddit + x + youtube + 并行搜索
4. **Phase 4**: LLM query 增强 + lead resolution
5. **Phase 5**: 知乎 + 小红书 + 微博 + 微信（Playwright）
6. **Phase 6**: README/demo GIF + 测试 + CI + 文档

## Origin
从 Radar 项目的搜索升级需求中独立出来。Radar 是 OpenClaw Skill（项目机会雷达），MoleMiner 是通用搜索工具，Radar 调用 MoleMiner 获取搜索结果后自己做评分和入库。
