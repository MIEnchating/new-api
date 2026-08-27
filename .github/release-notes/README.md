# Release Notes Workflow

每次创建版本标签前，必须完成对应的 Release Notes 文件。

1. 复制 `TEMPLATE.md`，命名为 `<tag>.md`，例如 `v2026.07.17-2.md`。
2. 完整填写新增、改进、修复、移除、安全与部署说明；没有内容的章节填写 `- 无`。
3. 将 Release Notes 与代码一起提交并推送。
4. 在包含该文件的提交上创建并推送 Tag。
5. Release Action 先执行 Mandatory Release Preflight；前端、Go、relaykit、Docker 任一预检失败时，后续平台构建和 GitHub Release 都不会执行。
6. 预检通过后构建各平台产物，汇总阶段还会硬性检查四个服务器产物均存在且非空，之后才发布 GitHub Release。
7. Docker 架构镜像必须全部构建成功并通过 manifest 检查后，才会创建版本和 `latest` 多架构清单。
8. Action 自动追加提交数、代码增删行、完整文件变更清单和版本对比链接。

缺少对应文件、缺少必填章节、仍包含模板占位内容或任一硬性构建校验失败时，发布步骤会失败且不会生成不完整的最终 Release。
