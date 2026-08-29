# Release Notes Workflow

每次创建版本标签前，必须完成对应的 Release Notes 文件。

1. 复制 `TEMPLATE.md`，命名为 `<tag>.md`，例如 `v2026.07.17-2.md`。
2. 仅填写版本概览、新增功能、功能改进、问题修复、移除与调整五个章节；没有内容的章节填写 `- 无`。
3. 将 Release Notes 与代码一起提交并推送。
4. 在包含该文件的提交上创建并推送 Tag。
5. Release Action 先执行 Mandatory Release Preflight；前端、Go、relaykit、Docker 任一预检失败时，后续平台构建和 GitHub Release 都不会执行。
6. 预检通过后构建各平台产物，汇总阶段还会硬性检查四个服务器产物均存在且非空，之后才发布 GitHub Release。
7. Docker 架构镜像必须全部构建成功并通过 manifest 检查后，才会创建版本和 `latest` 多架构清单。
8. Action 只能使用经过校验的同名版本说明，不允许根据提交记录回退生成，也不追加发布产物、代码统计、文件清单或完整变更链接。

缺少对应文件、章节为空、章节不完整或顺序错误、包含额外二级章节、仍包含模板占位内容，或者出现安全与兼容性、部署说明、发布产物、代码统计、完整文件列表、完整变更对比及 GitHub compare 链接时，发布步骤会硬性失败。任一构建校验失败时同样不会生成最终 Release。
