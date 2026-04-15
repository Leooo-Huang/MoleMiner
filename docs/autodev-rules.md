# MoleMiner — 编码规则（逆向生成）

> 来源：从现有代码库逆向生成 | 生成时间：2026-04-02

## 技术栈约束

- TypeScript strict mode (`strict: true`)，ESM (`"type": "module"`)
- Node.js ≥18，target ES2022
- 导入路径带 `.js` 后缀（ESM 规范）
- esbuild bundle，`--packages=external`（依赖不打包）
- playwright 是 optionalDependency，不强制安装
- Web 前端：React 19 + Vite 6 + Tailwind CSS 4 + react-globe.gl 2
- 前端依赖全部是 devDependency，构建后嵌入 dist/web/

## 编码约定

### 命名

- 变量/函数：camelCase
- 类型/接口：PascalCase
- 源名称：全小写（`brave`, `hackernews`, `xiaohongshu`）
- 文件名：kebab-case（`fetch-page.ts`）

### 模块组织

- 每模块一个文件，职责清晰
- 搜索源：`ts/src/sources/{name}.ts`，继承 `BaseSource`
- 工具函数：`ts/src/utils/{name}.ts`
- Web 服务端：`ts/src/web/server.ts`
- Web 前端：`ts/src/web/ui/src/`，React 组件用 PascalCase 文件名
- 具名导出，不用 default export
- async/await，不用 callback

### 搜索源接口

新增搜索源必须：
1. 继承 `BaseSource`
2. 实现 `name`, `sourceType`, `requiresAuth`, `searchOne()`, `enabled()`
3. 在 `sources/index.ts` 的 `ALL_SOURCES` 数组中注册
4. 返回 `SearchResult` 格式（title, url, source, snippet + 可选 metadata）

### AI 函数约定

- 所有 AI 输出用 JSON schema 约束（`llm.extractJson()` + schema 对象）
- 分模型：fast model 用于 classify/extract，strong model 用于 query generation/report
- batch 处理大量结果（30 条/批），snippet 截断防止 token 溢出

## 质量红线

1. **禁止占位**：无 TODO/pass/空函数体/NotImplementedError
2. **禁止 Mock 数据**：无 mock/dummy/fake/hardcoded 数据冒充真实调用
3. **禁止降阶**：按设计文档方案实现，不能"先用简单方案以后再换"
4. **版本正确**：package.json 中的依赖版本与实际使用一致

## 禁止模式

- 不用 LangChain / litellm / 任何 LLM 框架 — fetch 直调
- 不用 `any` 类型 — 用具体类型或 `unknown`
- 不用 `@ts-ignore` — 修复类型错误
- 不在 AI 函数中硬编码模型名 — 通过 config 传入
- 不跳过反漂移的任何一层 — classify 过滤 irrelevant、entity 试金石测试、Round 1+ 锚定原意
- Web 服务端不引入 Express/Fastify — Node.js 原生 http
- 前端不引入状态管理库 — React useState/useEffect 足够
- 前端不用 Next.js — 纯 SPA，Vite 构建

## 测试约定

- 框架：vitest + msw
- 测试文件：`ts/tests/{module}.test.ts`
- HTTP 调用用 msw 拦截，不发真实请求
- 新功能必须有对应测试
- 修 bug 先写复现测试再修
- 运行：`cd ts && npm test`
