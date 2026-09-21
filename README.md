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
