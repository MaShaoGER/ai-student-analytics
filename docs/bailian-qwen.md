# 百炼 Qwen Flash 接入

当前试用模型：阿里云百炼 `qwen3.7-flash`，中国内地华北 2（北京）；也支持 `qwen3.8-flash`。接口、模型及免费额度规则已于 2026-10-15 核对，实际可用模型与额度以账号控制台为准。

## 配置

1. 服务端持久保存现有 `APP_SETTINGS_KEY` 和 records 卷；首次本地配置按 `.env.example` 生成密钥。不要更换已有加密密钥。
2. 登录管理员，进入“系统管理 → AI 配置”，可先点击现有“使用百炼 Qwen3.8 Flash（北京）”预设，再把模型名称改为 `qwen3.7-flash`。预设只修改表单，清空待输入密钥和单价；仍需填写后保存。
3. 协议为 `chat_completions`，模型填写 `qwen3.7-flash` 或 `qwen3.8-flash`。预设基础地址为 `https://dashscope.aliyuncs.com/compatible-mode/v1`；官方确认该原域名仍可使用。推荐按控制台改为 `https://业务空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，替换为真实业务空间 ID。不要追加 `/chat/completions`，不要使用 Coding Plan 的专用地址。
4. 在密码输入框填写北京地域的百炼 API Key。密钥由服务端加密保存，不进入客户端返回值；不用发到聊天或写入仓库。
5. 填写估算单价和预算，再开启 AI 并保存。当前费用统计与预算统一为 USD：若控制台给出人民币 / 百万 token，使用 `人民币单价 ÷ 每美元对应的人民币金额` 换算后填写；记录所用汇率并在价格变化后更新。不要将人民币金额直接填入 USD 字段，也不要因有免费额度而填 0。预设不写入价格或汇率。

## 请求与用量

百炼官方域名上的 `qwen3.7-flash` 和 `qwen3.8-flash` Chat 请求发送顶层 `enable_thinking: false`，并启用 `response_format: { type: "json_object" }`。其他服务商和其他模型沿用原有配置。

系统消息要求 JSON 字段，服务端继续校验允许的指标、维度、图表和理由，再构造受限 `AnalysisPlan`。超出能力的问题需澄清，模型不能执行 SQL。输出达到长度上限时拒绝使用该计划。

请求最多输出 500 token，20 秒超时，无自动重试；调用前按实际请求内容预留估算预算。有返回用量时记录 `prompt_tokens` / `completion_tokens` / `total_tokens`；失败且没有用量时保留保守估算。连接测试同样计入用量。该估算没有精确反映缓存折扣、免费额度或服务商最终账单。

## 真实调用验收

- 保存后点击“测试连接”：必须收到有效的分析计划，连通或 HTTP 200 本身不足以确认通过。
- 自由提问“请把各门课的均分列成表格”，检查成绩、课程维度、表格和确定性查询结果；自由提问“按学期展示学习活动的变化趋势”，检查活动指标、学期维度和折线图。这两类问法应走模型规划，不能只测命中固定问题的路径：结果卡会显示分析方式（“已验证的常用问题”“本地规则”或“AI 生成分析计划”）与模型名（仅命中 AI 时显示），`records/analysis.jsonl` 会记录同一请求的 `promptVersion` 与 `model`。固定问题命中 `golden_case` 时模型参与度为 0，验收时不要把它的结果当作 AI 通过证据。
- 提问“分析学生表现”，确认澄清；提问“给我每个学生的家庭收入”，确认不执行超出能力的查询。
- 核对应用用量与百炼调用记录、免费额度及账单。根据账号需要在百炼控制台开启“免费额度用完即停”，应用预算不能代替服务商扣费限制。

没有实际 API Key 和成功调用证据时，只能确认本地适配与回归测试通过，不能记为真实 AI 验收完成。

## 2026-10-15 真实连接结果

使用用户已保存的百炼密钥，通过项目实际规划器调用 `qwen3.7-flash`，HTTP 200，耗时约 2.1 秒；JSON / 非思考模式均生效，模型返回的分析计划通过校验。实际输入 250、输出 93、合计 343 token。

成功后仅将本地保存模型从 3.8 改为 3.7，原加密密钥、预算与单价保留，切换前的加密配置保存在私有运行目录的 `config-backups` 中。当前用户填写的输入/输出估算单价均为 `1 USD / 百万 token`，本次应用估算费用为 `0.000343 USD`，不等于百炼实际账单；单价需按账号实际价格和所选汇率另行核对。完整真实问法和持续稳定性仍待验收。

## 官方参考

- [Chat Completions 接口与地域地址](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)
- [结构化 JSON 输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)
- [文本生成模型](https://help.aliyun.com/zh/model-studio/text-generation-model)
- [免费额度与用完即停规则](https://help.aliyun.com/zh/model-studio/new-free-quota)
