# AI 学生数据分析系统

面向高校教学管理的 AI 学生学习数据分析助手，属于传智杯 AI Web 网页开发挑战赛的“AI 数据分析与可视化”方向。

系统计划支持：

- 上传或选择学生学习数据；
- 使用自然语言提问；
- 自动生成并校验分析计划；
- 由 DuckDB / SQL 完成确定性统计；
- 生成 ECharts 图表和可追溯分析报告；
- 展示数据来源、指标口径、统计周期和只读查询。

## 当前目录

- [AI学生数据分析系统开发路线图.md](AI学生数据分析系统开发路线图.md)：产品、架构、开发计划和验收标准。
- `oulad_raw/OULAD.names`：OULAD 数据字段说明。
- `app/`、`components/`、`lib/`：Next.js 页面、图表和受控 DuckDB 分析链路。
- `data/sample/`、`data/schema/`：虚构演示数据、数据字典和冻结的指标口径。
- `docs/`：架构、工具契约、演示问题和验收基准。
- `docs/reference-cases.md`：开源教育分析和 GenBI 案例的学习结论。

## 本地运行

环境要求：Node.js 20.9+、pnpm 11+。

```bash
pnpm install
pnpm admin:init
pnpm dev
```

首次运行 `pnpm admin:init`，在终端设置管理员账号和至少 12 个字符的密码。浏览器打开 `http://localhost:3000`，登录后即可使用数据概览、数据浏览与智能分析。管理员还可创建普通账号、停用账号和管理 AI 设置。项目会优先读取 `data/sample/`；如果 `oulad_raw/` 中存在本地 OULAD CSV，也会在数据集选择器中显示。

页面内置 10 个经过回归验证的固定问题，不需要模型密钥即可运行。要启用自由提问，复制 `.env.example` 为 `.env.local` 并设置 `APP_SETTINGS_KEY`（32 字节 base64），之后在管理员的“系统管理 → AI 配置”中保存模型、密钥、估算单价和调用预算。保存后立即生效；也兼容服务端 `OPENAI_API_KEY` / `OPENAI_MODEL` 初始化。模型只生成受限的 `AnalysisPlan`，不能提供文件路径或执行任意 SQL。

导入、异常提醒、报告导出、多服务商接入和更细的数据权限已预留可见面板，明确标为“即将支持”，不会模拟已经实现。使用和部署细节见 [工作台使用指南](docs/workspace-guide.md)。

验证命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

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

## 计划技术栈

- Next.js 14+、TypeScript、Tailwind CSS、shadcn/ui；
- Supabase PostgreSQL 和 Storage；
- DuckDB 数据分析引擎；
- Vercel AI SDK 或 OpenAI SDK；
- Zod 结构校验；
- ECharts 图表；
- pnpm 和 Docker Compose。

## 开发原则

模型负责理解问题、生成结构化分析计划和解释结果；统计计算交给 DuckDB / SQL。所有模型输出都要经过字段、权限、查询和结果校验，不能让模型直接执行任意 SQL 或凭空生成数字。
