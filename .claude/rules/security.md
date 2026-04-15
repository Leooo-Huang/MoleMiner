# 安全规则

- 禁止在代码中硬编码 API key、密码、token 等敏感信息
- 敏感信息必须通过环境变量或 secret manager 获取
- `.env` 和 `.env.local` 文件必须在 `.gitignore` 中
- 禁止在日志、console.log、print 中输出敏感信息
- 禁止 `git push --force` 到 main/master 分支
- 禁止提交包含凭证的文件（credentials.json、*.pem、*.key）
