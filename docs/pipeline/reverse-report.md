# 逆向文档生成报告 — MoleMiner (2026-04-02)

## 项目概况

- **技术栈**：TypeScript (ESM) | commander | vitest + msw | esbuild | sql.js
- **规模**：66 文件 (36 src + 30 tests)，~12,660 行代码
- **架构**：CLI 单体应用 + 插件式搜索源 + AI 递归搜索循环

## 已生成文档

| 文件 | 内容 |
|------|------|
| `docs/autodev-ideation.md` | 功能发现：8P + 8W + 12S + 8I |
| `docs/autodev-design.md` | 产品规格：架构 + 6 个核心组件 + 8 个技术决策 |
| `docs/autodev-index.md` | 开发者地图 |
| `docs/autodev-rules.md` | 编码规则 |

## 覆盖率

| 维度 | 已覆盖 / 总数 |
|------|--------------|
| CLI 命令 | 10 / 10 |
| 搜索源 | 12 / 12 |
| 数据模型 | 6 / 6 |
| AI 函数 | 4 / 4 |
| 工具模块 | 8 / 8 |

## 需要人工审阅

- 0 处 `[推断]` 标注（项目有完整设计文档，未需推测）
- 0 处 `[待确认]` 标注

## 与原有文档的关系

| 原有文档 | AutoDev 对应 | 建议 |
|---------|-------------|------|
| `docs/00-project-spec.md` | `autodev-ideation.md` | 保留原文档作为历史参考 |
| `docs/01-architecture.md` | `autodev-design.md` | 保留，AutoDev 版本更结构化 |
| `docs/02-tools-research.md` | 无对应 | 保留，工具调研独立于 AutoDev |
| `CLAUDE.md` | `autodev-index.md` | CLAUDE.md 保留，可指向 AutoDev 文档 |

## 后续建议

1. 运行 `/autodev-sync` 验证文档和代码的一致性
2. 如需继续开发新功能，从 `/autodev-add` 接入流水线
3. 如需迭代现有功能，从 `/autodev-iterate` 接入
4. 考虑更新 CLAUDE.md 的 Design Docs 部分，加入 AutoDev 文档指针
