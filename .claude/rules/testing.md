# 测试约定

- 框架: vitest + msw (mock HTTP)
- 测试文件: `ts/tests/*.test.ts`，源文件子目录测试在 `ts/tests/sources/`、`ts/tests/utils/`
- 命名: `{module}.test.ts`，与 `ts/src/{module}.ts` 一一对应
- 运行测试: `cd ts && npm test`（即 `vitest run`）
- 开发模式: `cd ts && npm run dev`（即 `vitest` watch 模式）
- 新功能必须有对应测试；修 bug 先写复现测试再修
- HTTP 调用用 msw 拦截，不发真实请求
