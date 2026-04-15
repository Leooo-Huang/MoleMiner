# 禁止占位符代码

以下模式在范围内的功能中禁止出现：

- `TODO`、`FIXME`、`HACK`、`XXX`、`stub` 注释
- `pass`（Python）或空函数体（JS/TS）作为唯一语句
- `NotImplementedError`、`throw new Error('not implemented')`
- 硬编码的空集合（`= []`、`= {}`、`= null`）作为核心数据源
- 变量名含 `mock`、`dummy`、`fake`、`placeholder`、`sample`

如果功能在当前范围内，就必须完整实现。
如果功能不在范围内，不要写空壳——直接不写。
