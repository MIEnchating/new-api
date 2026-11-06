## 审查范围

发布累计基准 v2026.11.06 解引用后为 c46cad6e5defebe74240cb1011f22155dea24847，与 origin/main 相同。本次候选纳入 upstream/main 的 6fa80abc7、a5a465926、e03439033 三个提交及下述兼容修复；没有此前已合并但尚未发布的额外累计差异。预约文件日期为 2026-10-30，不视为本轮发布授权。此说明仅记录工作树整合结果，不表示已提交、发布或完成外层验证。

## 功能变化

- AWS InvokeModel 移除未使用的 API Key 直连 Converse 分支及 ClientMode 状态，API Key 和 AK/SK 均由 AWS SDK 根据区域构造请求、认证及处理流式或非流式响应。保留 Mantle Messages 独立通道、Nova 处理、区域模型映射、代理配置、请求取消及错误状态处理，客户端接口及密钥配置格式不变。
- Vertex 服务账号令牌缓存改为按 Google 返回的 expires_in 计算期限，提前五分钟刷新；相同渠道、密钥槽和凭据的并发请求共享一次换取。短有效期令牌不缓存，失败后允许重试，服务账号或密钥更换不复用旧令牌。缺少 expires_in 时保留上游一小时默认值。
- 会话亲和性缓存区分“刷新统计”与“清空缓存”，规则行直接提供清理按钮，并明确提示清理后重新选路。共享缓存、未保存规则或无统计时禁止逐规则清理；确认框等待期间阻止重复提交，失败保留重试入口，成功刷新统计。保存规则后同步使统计查询失效，清理操作不会提交规则草稿。
- 七语言各增加九个缓存管理文案，保留本项目缓存请求数、分组缓存趋势及全部既有键值。

## 合并适配与原有功能

- 七语言冲突为相邻位置的独立新增键，按键合并双方内容，经 add-missing-keys.mjs 写入并执行 bun run i18n:sync；未删除原有翻译。
- 修正 Vertex 新有效期逻辑将显式零值、负数及非法 expires_in 当作一小时的问题，同时拒绝溢出、空令牌和非成功 HTTP 响应；错误不包含完整令牌响应。使用 common.DecodeJson，缓存身份加入私钥摘要，防止缺少或未更换 private_key_id 时沿用旧凭据；期限从换取开始时计算，不将网络等待计入可用时间。
- 修正规则 JSON 草稿缺少名称时 rule.name.trim() 导致页面崩溃的问题，保持可视化和 JSON 编辑往返，禁用无名规则的缓存清理。
- 缓存 UI 继续复用 ConfirmDialog、StaticDataTable、Tooltip、Button 和共享数字格式化；没有新增通用交互组件。沿用本项目 stickyChannelStore、按规则清理、分组隔离、粘性路由及故障切换；后端缓存管理接口仍受 RootAuth 保护。
- Vertex 自定义地址与 v1/v1beta1 版本替换逻辑保留；AcquireAccessToken 公共签名保持，插件调用方无需调整。AWS SDK 用量解析、请求数量边界、预扣、结算与退款路径未改动。
- stream_status 保留上游字段结构、原始内容及用户可见性；渠道信息、上游请求 ID、中间重试日志、执行轨迹和其他管理字段继续受既有服务端权限控制。
- 未修改登录会话、PAT、Casbin、数据库结构、ORM/驱动、依赖版本、relaykit/tokenkit、部署配置及发布工作流；既有发布标签校验和镜像构建流程保留。

## 验证交接

- 已执行 gofmt、git diff --check HEAD、冲突标记扫描、七语言 JSON 重复键及原有键值保留检查、上游九个新增键及占位符检查、变更组件静态翻译调用检查；四个变更 TypeScript 文件完成 Bun.Transpiler 语法检查。这些检查不替代测试或类型检查。
- 保留上游 AWS 流式/非流式 SDK Bearer 请求用例及缓存操作交互用例。Vertex 用例新增无 key ID 的私钥更换、短期限不缓存、实际有效期解析、无效期限、空令牌及错误响应不泄露内容；并发用例改用通道同步，移除固定等待。前端增加无名规则草稿往返编辑回归。
- 尝试 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOCACHE=/tmp/new-api-sync-go-cache go test ./relay/channel/vertex ./relay/channel/aws -run 'TestGetAccessToken|TestAWSApiKeyTypeInvokesThroughSDKWithBearerToken' -count=1，因本地 Go 1.26.2 低于根模块要求 1.26.10 未启动。尝试定向 Vitest，因无 node_modules 未启动；bun run typecheck 与定向 lint 分别报告缺少 check 脚本和 oxlint。未联网安装，未声称测试通过。
- 外层须执行完整 Go/Bun、上述回归用例以及真实 SQLite/MySQL/PostgreSQL 的迁移与后端验证，并记录具体数据库版本、命令和结果。本轮未增加数据库变更。
- 认证审查参考 OWASP Authentication Cheat Sheet、Session Management Cheat Sheet 的凭据隔离、有效期、失败关闭和敏感响应保护方向；按禁止联网要求未重新获取在线规范，不作最新 ASVS 全面合规声明。

## 持续保留的已知限制

- DeepSeek 固定工作日峰谷价格不识别中国法定节假日，管理员可按实际价格政策配置覆盖。
- 大型日志表建立联合索引可能产生耗时、资源消耗与锁竞争，升级时需安排合适的迁移窗口。
- 缓存用量仅从升级后开始记录，历史数据不回填；跨升级时间范围的缓存统计不代表完整历史用量，界面保留相应提示。
- 旧面板令牌在首次迁移后的三十天窗口结束后失效，这是上游迁移设计；需迁移至 PAT，重启不会重置退役期限。
- Responses custom tool 经 Chat function 转换后，grammar 保留为描述提示，不能保证原协议的语法强约束。
- Sobek 切换到 moejs 后，第三方插件仍可能需要适配；本轮未改变该运行时迁移影响。
- Gemini Omni 仅支持直连 Vertex AI 的 global Interactions 接口，不支持经 type-60 New API 网关转发；Veo 的网关转发能力保留。
