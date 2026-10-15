# 智谱 GLM-4.7-Flash 试用

当前试用选择为智谱国内平台的 `glm-4.7-flash`。2026-10-15 核对官方定价：输入、输出均免费；价格和账户可用性仍以控制台为准。`glm-4.7`、`glm-4.7-flashx` 是不同型号，不要误选。

## 本地配置

1. 登录 [智谱 API Key 管理页](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)，创建 API Key。使用国内通用 API 的密钥，不使用 Coding Plan 专用端点。
2. 本地服务端需要有效且持久保存的 `APP_SETTINGS_KEY`，用于加密保存模型密钥。已有值不要更换；初次配置参照 `.env.example`。首次管理员通过 `pnpm admin:init` 设置，密码至少 12 个字符；运行 `pnpm dev` 后打开 `http://localhost:3000` 登录。
3. 进入“系统管理 → AI 配置”，点击“使用智谱 GLM-4.7-Flash（免费）”。此按钮修改待保存表单，不会立即调用模型，也不替换已有保存的密钥。
4. 确认协议 `chat_completions`、基础地址 `https://open.bigmodel.cn/api/paas/v4`、模型 `glm-4.7-flash`。不要在基础地址后追加 `/chat/completions`。
5. 在密码框填写智谱 API Key，输入与输出估算单价均填写 `0`。这是官方当前免费的模型，不是依赖赠送额度的收费模型。切换收费模型后需重新核对单价；当前费用字段仍使用 USD。
6. 预算仍需填写正数，可先用单次 `0.01`、每小时 `0.10`、每天 `0.50`、每 30 天 `2`。零单价下预算不限制请求数量，平台限流和应用请求限流仍有效。
7. 开启“允许 AI 分析”，保存，再点击“测试连接”。连接测试同样记录调用次数与 token 用量，按配置的零单价估算费用。

API Key 只填管理页或服务端配置，不发到聊天，不提交到仓库。

## 请求适配

官方通用端点的 `glm-4.7-flash` Chat 请求使用顶层 `thinking: { type: "disabled" }` 关闭默认思考模式，并启用 `response_format: { type: "json_object" }`。提示词定义受限字段，返回内容继续经过 Zod 校验，再构造确定性的分析计划。

保留 500 输出 token 上限、20 秒超时、无自动重试与截断结果拒绝策略。其他模型、其他服务商和 Coding Plan 端点不会自动附加这组参数。免费服务仍受账号并发、请求频率及平台容量限制，不代表无限调用或可用性承诺。

## 真实调用验收

- 自由提问“请把各门课的均分列成表格”，确认成绩指标、课程维度和表格。
- 自由提问“按学期展示学习活动的变化趋势”，确认活动指标、学期维度和折线图。
- 提问“分析学生表现”和“给我每个学生的家庭收入”，确认要求澄清，不执行不支持的分析。
- 核对结果的 AI 来源、模型名、应用记录及智谱调用记录；不要只测试会直接命中固定问题的问法。
- 若出现鉴权、限流、超时或格式错误，记录错误提示。不得将模拟响应的回归测试记为真实服务通过。

## 免费模型拥堵与限流

智谱可能返回 HTTP 429：错误码 `1305` 表示平台服务过载（该模型当前访问量过大），`1302` 表示账号速率限制。应用分别显示 `AI_PROVIDER_OVERLOADED` 或 `AI_PROVIDER_RATE_LIMITED`，不会将这两种情况统称为连接失败，也不会自动重试或切换收费模型。响应的 `Retry-After: 30` 是应用建议的退避时间，不保证平台在 30 秒后恢复。

2026-10-15 本地已确认保存密钥可正常解密：最小真实请求返回成功，完整规划请求曾收到 `429 / 1305`，随后管理页的真实连接测试成功并返回有效计划。这确认配置可用；免费服务仍可能间歇拥堵。无需因此重复生成或替换密钥。

## 官方参考

- [模型与免费定价](https://docs.bigmodel.cn/cn/guide/start/pricing)
- [GLM-4.7-Flash](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash)
- [OpenAI 兼容接口](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)
- [思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)
- [结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)
- [速率限制](https://docs.bigmodel.cn/cn/api/rate-limit)
