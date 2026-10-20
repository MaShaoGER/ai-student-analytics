# AI 学生数据分析系统

面向高校教学管理的 AI 学生学习数据分析助手，属于传智杯 AI Web 网页开发挑战赛的“AI 数据分析与可视化”方向。

系统目前支持：

- 选择预置模拟校园数据或配置只读本地 OULAD 数据；
- 使用自然语言提问；
- 自动生成并校验分析计划；
- 由 DuckDB / SQL 完成确定性统计；
- 生成 ECharts 图表和可追溯分析报告；
- 展示数据来源、指标口径、统计周期和只读查询。
- 下载当前聚合分析的 CSV，以及预览、下载和打印分析报告（可另存为 PDF）。

管理员现可通过[教学成绩导入](docs/grade-data-import.md)上传 Excel/CSV，完成字段映射、质量校验后发布独立数据集或完整新版本，并在账号管理中授权使用。测试环境已于 2026-10-13 发布查询保护、失败审计和报告导出增量，并完成独立记录卷恢复及版本回退演练；仍使用模拟数据和自签名测试证书。

## 当前目录

- [后台管理首期](docs/admin-management.md)：阶段 0–5 已本地实施，包含角色与数据授权、账号、目录、系统总览和操作日志；[验收记录](docs/admin-management-acceptance.md)、[实施路线](docs/admin-management-roadmap.md)。另见[教学成绩导入](docs/grade-data-import.md)。
- [AI学生数据分析系统开发路线图.md](AI学生数据分析系统开发路线图.md)：产品、架构、开发计划和验收标准。
- [赛事改进路线](docs/competition-improvement-roadmap.md)：2026-10-18 确认的优先顺序、实施范围和验收标准；第一阶段已本地实施，见[实施记录](docs/competition-phase1.md)；第二阶段首版见[实施与验收](docs/competition-phase2.md)。
- [AI 统一对话与统计分析改进路线图](docs/unified-ai-workflow-roadmap.md)：第 1–4 步已本地实施，统一问答入口、上下文、统计结果与请求用量；后续[回答可靠性修正](docs/ai-answer-reliability.md)补充完整性检查、数字含义绑定与独立语义评测，旧评测未通过项仍如实保留。
- `oulad_raw/OULAD.names`：OULAD 数据字段说明。
- `app/`、`components/`、`lib/`：Next.js 页面、图表和受控 DuckDB 分析链路。
- `data/sample/`、`data/schema/`：虚构演示数据、数据字典和冻结的指标口径。
- `docs/`：架构、工具契约、演示问题和验收基准。
- `docs/reference-cases.md`：开源教育分析和 GenBI 案例的学习结论。
- [发布 smoke 验收](docs/smoke-release.md)、[备份恢复与版本回退](docs/recovery.md)：可复用运维工具和执行边界。

## 本地运行

环境要求：Node.js 22 LTS、pnpm 11+。

```bash
pnpm install
pnpm admin:init
pnpm dev
```

首次运行 `pnpm admin:init`，在终端设置管理员账号和至少 12 个字符的密码。浏览器打开 `http://localhost:3000`，登录后即可使用数据概览、数据浏览与智能分析。管理员还可创建普通账号、停用账号和管理 AI 设置。项目会优先读取 `data/sample/`；如果 `oulad_raw/` 中存在本地 OULAD CSV，也会在数据集选择器中显示。

页面内置 10 个经过回归验证的固定问题，不需要模型密钥即可运行。要启用自由提问，复制 `.env.example` 为 `.env.local` 并设置 `APP_SETTINGS_KEY`（32 字节 base64），之后在管理员的“系统管理 → AI 配置”中选择 Responses 或兼容 Chat Completions 协议，保存 API 基础地址、模型、密钥、估算单价和调用预算。地址留空使用 OpenAI 官方 API；保存后立即生效。也兼容服务端 `OPENAI_API_KEY` / `OPENAI_MODEL` 初始化。模型只生成受限的 `AnalysisPlan`，不能提供文件路径或执行任意 SQL。

当前已真实验证百炼 `qwen3.7-flash` 的连接与受限分析计划输出；在 AI 配置中使用 Chat Completions 协议，填写百炼地址、密钥、模型及换算成 USD 的估算单价。`qwen3.7-flash` 与 `qwen3.8-flash` 均适配 JSON 输出和关闭思考模式，步骤见 [百炼接入指南](docs/bailian-qwen.md)。

也可试用智谱 `glm-4.7-flash`：在 AI 配置中点击智谱预设，填写智谱密钥，输入与输出单价按官方当前免费定价填 `0`，保存并测试。适配 JSON 输出与关闭思考模式；免费服务仍受平台限流约束，步骤见 [智谱试用指南](docs/zhipu-glm.md)。

数据浏览和智能分析的当前结果可下载 CSV，并在报告中心预览、下载 HTML 报告或打印另存为 PDF。报告来源是本次会话中已有的真实分析结果，刷新或退出后不保留报告列表。导入、异常提醒、连续追问、报告分享、专有服务商接口适配和更细的数据权限仍标为“即将支持”。使用和部署细节见 [工作台使用指南](docs/workspace-guide.md)。

验证命令：

```bash
pnpm typecheck
pnpm test
node --test scripts/recovery.test.mjs
pnpm build
pnpm test:api
```

`pnpm test:api` 会启动隔离的本地服务并执行 HTTP 集成回归，需要 bash 与空闲的 3100 端口。

首次部署时必须使用带有 DuckDB 原生依赖的 Node.js 服务端运行时，不能把分析模块打包到浏览器端。

有 Docker 环境时可以直接启动可复现的服务端：

```bash
docker compose up --build
```

`oulad_raw/` 会以只读卷挂载；没有 OULAD 文件时，模拟校园数据仍可完整运行。详见 [部署指南](docs/deployment.md)。

## 数据说明

仓库默认不提交 OULAD 的完整 CSV 和压缩包。原因是 `studentVle.csv` 文件较大，公开仓库也应单独保留数据来源和许可说明。

本地开发时，将 OULAD CSV 文件放入 `oulad_raw/`。这些文件已被 `.gitignore` 排除，不会提交到公开仓库。

正式开发时优先使用 OULAD 子集和自建模拟数据，公开仓库不要放入真实学生个人信息、API 密钥或未经授权的数据。

## 隐私与 AI 边界

- **AI 只做两件事**：把问题翻译成受限的分析计划，把已算好的结果解释成人话。数字、排序、样本数由本地 DuckDB / SQL 计算，模型拿不到 SQL、拿不到学生明细，也不能编造数字。
- **不给个体结论**：不返回学生姓名/学号/名单、不做个体排名或风险名单；少于 3 人的分组不展示，只输出群体聚合统计。系统不接触真实个人信息，只使用 OULAD 与虚构模拟数据。
- **审计记录什么**：登录用户、数据源、有效分析计划、阶段、耗时、结果条数、安全错误码、prompt 版本与模型名。
- **审计不记录什么**：问题原文、对话正文、模型回复正文、结果明细。因此审计可以贴给开发者排障，但无法从审计里还原“谁问了什么”。
- **模型能看到什么**：提问本身、最近对话、可用的课程/学期标签，以及查询后的聚合结果（不含学生标识与原始记录）；密钥永不进入提示词与客户端返回值。
- **密钥与配置**：API 密钥只在服务端以 AES-256-GCM 加密保存，加密主密钥 `APP_SETTINGS_KEY` 保存在部署环境的私有配置中，不在仓库内；管理员可在“系统管理 → AI 配置”查看/更换，普通账号不可见。
- **反馈与排障**：AI 回答有问题时用 [AI 反馈模板](.github/ISSUE_TEMPLATE/ai-feedback.yml)；现场故障按 [演示预案](docs/demo-runbook.md) 处理；配置交接见 [AI 交接单](docs/ai-handover.md)。

## 实际技术栈

- Next.js 16（App Router）、React 19、TypeScript、自定义 CSS；
- DuckDB 数据分析引擎（`@duckdb/node-api` 原生依赖）；
- OpenAI SDK（Responses 与兼容 Chat Completions 协议）；
- Zod 结构校验；
- ECharts 6 图表；
- pnpm 11 和 Docker Compose。

## 开发原则

模型负责理解问题、生成结构化分析计划和解释结果；统计计算交给 DuckDB / SQL。所有模型输出都要经过字段、权限、查询和结果校验，不能让模型直接执行任意 SQL 或凭空生成数字。
