# MoleMiner (矿鼹) — 开发者地图

> 来源：从现有代码库逆向生成 | 生成时间：2026-04-02

## 一句话

AI 驱动的多源递归搜索 CLI 工具，为 AI Agent 和开发者提供跨平台深度搜索能力。

## 知识地图

| 需要了解 | 去哪看 |
|---------|-------|
| 功能清单和 P/W/V 编号 | → `autodev-ideation.md` §MVP 功能清单 |
| 架构、组件关系、数据流 | → `autodev-design.md` §架构概览 |
| Web 可视化层架构 | → `autodev-design.md` §新增功能：Web 可视化界面 |
| Web UI 页面设计 | → `autodev-ui.md` |
| Web QR 登录弹窗 | → `autodev-ui.md` §新增组件：LoginModal |
| Web API 端点设计（11 个） | → `autodev-api.md` |
| 4 个 AI 函数的接口和行为 | → `autodev-design.md` §AI 层 |
| 搜索源列表和类型（12 个） | → `autodev-ideation.md` §搜索源 |
| Cookie 过期检测 + QR 登录 | → `autodev-ideation.md` §P7, §V11 |
| 反漂移 3 层防御 | → `autodev-design.md` §AI 层 |
| 编码约束和红线 | → `autodev-rules.md`（全文） |
| 原始项目规格 | → `00-project-spec.md` |
| 原始架构设计 | → `01-architecture.md` |
| 实施计划 | → `plans/2026-04-04-web-visualization-plan.md` |
| 已知问题 | → `autodev-ideation.md` §已知问题 |

## 技术栈

TypeScript (ESM) | commander (CLI) | vitest + msw (测试) | esbuild (构建) | npm (包管理)
React 19 + Vite 6 (Web UI) | react-globe.gl (3D 地球) | Tailwind CSS 4 (样式)

## 目录结构

| 目录 | 用途 |
|------|------|
| `ts/src/` | 主要源代码 (13 模块) |
| `ts/src/sources/` | 12 个搜索源实现 |
| `ts/src/utils/` | 工具函数 (抽取、压缩、抓取、Cookie、评分) |
| `ts/src/web/` | Web 服务端 (HTTP API + 静态文件) |
| `ts/src/web/ui/` | React 前端 SPA (3D 地球可视化) |
| `ts/tests/` | 测试文件 (*.test.ts) |
| `ts/dist/` | 构建产物 |
| `ts/dist/web/` | 前端构建产物 (Vite build) |
| `docs/` | 设计文档 + AutoDev 文档 |

## 构建和测试

```bash
cd ts
npm install              # 安装依赖
npm run build            # esbuild → dist/index.js
npm test                 # vitest run
npm run dev              # vitest watch 模式
```

## 核心约束（完整定义见 `autodev-rules.md`）

1. LLM 是必须依赖，不考虑无 LLM 降级路径
2. 搜索源通过 BaseSource 抽象类 + SourceRegistry 注册，新增源只需实现接口
3. 所有 AI 输出用 JSON schema 约束，不做 fuzzy parse
4. 反漂移 3 层防御必须完整，不能跳过任何一层
