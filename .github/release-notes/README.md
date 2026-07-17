# Release Notes Workflow

每次创建版本标签前，必须完成对应的 Release Notes 文件。

1. 复制 `TEMPLATE.md`，命名为 `<tag>.md`，例如 `v2026.07.17-2.md`。
2. 完整填写新增、改进、修复、移除、安全与部署说明；没有内容的章节填写 `- 无`。
3. 将 Release Notes 与代码一起提交并推送。
4. 在包含该文件的提交上创建并推送 Tag。
5. Release Action 校验说明文件，构建各平台产物并发布 GitHub Release。
6. Action 自动追加提交数、代码增删行、完整文件变更清单和版本对比链接。

缺少对应文件、缺少必填章节或仍包含模板占位内容时，发布步骤会失败。
