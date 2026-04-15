# 代码风格

- 命名: camelCase（变量/函数），PascalCase（类型/接口）
- 模块系统: ESM (`import/export`)，文件扩展名 `.ts`，导入路径带 `.js` 后缀
- 严格模式: tsconfig `strict: true`，不用 `any`，不用 `@ts-ignore`
- 文件组织: 每个模块一个文件，source 实现放 `ts/src/sources/`，工具函数放 `ts/src/utils/`
- 导出: 具名导出（`export function`），不用 default export
- 异步: async/await，不用 callback
- 错误处理: 只在系统边界（用户输入、外部 API）做校验，内部代码信任类型系统
