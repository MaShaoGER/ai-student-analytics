# 学析台 · AI 学生学习数据分析

面向教师的学习分析工作台，属于传智杯 AI Web 网页开发挑战赛的“AI 数据分析与可视化”方向。正式交付版本为 1.0.0，基于 Next.js + DuckDB；正式功能使用受权限控制的统计查询与账号历史，不以设计原型或固定演示回包代替业务。

## 当前能力

- **数据浏览（默认入口）**：单图阅读与点击后二级选择，课程 → 指标 → 关联图循环；按需统一指标表、同数据换画法、显式跨课程比较、前后页与双轴全览，以及 URL、前进后退和阅读位置恢复。
- **AI 对话（另一主入口）**：自然语言连续追问、受控统计工具、图表与数值表、账号隔离的服务端对话历史；数字由本地 DuckDB 计算。报告是对话结果的从属层，不再有独立指标分析、图表工坊或数据页面。
- **数据与权限**：模拟校园数据、本地 OULAD，以及管理员导入并授权的 Excel/CSV 成绩数据集；支持管理员、分析人员和只读人员。
- **结果交付**：聚合 CSV、HTML 报告预览与下载、打印另存 PDF；报告中心与对话历史的保存范围不同，详见使用指南。
- **系统管理**：账号、数据集授权、AI 配置与预算、用量和操作日志。

正式功能、数据真实性和部署验收是三件事：内置模拟校园数据明确标为合成数据，OULAD 与管理员导入的成绩按各自来源展示；正式版本号不代表数据自动成为真实教学记录，也不代表远程环境已更新。验证证据见[工作台指南](docs/workspace-guide.md#验证)，实际部署条件见[部署指南](docs/deployment.md)。

### 正式页面地址

| 页面 | 路径 |
| --- | --- |
| 数据浏览 | `/explore` |
| 课程、指标与关系 | `/explore/course`、`/explore/metric` |
| AI 对话、报告 | `/chat`、`/reports` |
| 我的账号、系统管理 | `/settings`、`/admin` |

地址只保留恢复阅读所需的范围参数，例如 `/explore?source=sample`。`sample` 表示内置合成校园数据，不代表真实教学记录；内部 API 与历史数据的稳定 ID 不变。已有收藏链接会在进入工作台后规范化，分享新地址不会再带内部 `demo` 标识。完整参数说明见[工作台指南](docs/workspace-guide.md#页面地址与分享)。

## 从这里开始

| 你想做什么 | 入口 |
| --- | --- |
| 启动项目 | 下方“本地运行” |
| 使用数据浏览、AI 和导出 | [工作台使用指南](docs/workspace-guide.md) |
| 管理账号、授权和成绩导入 | [后台管理](docs/admin-management.md) · [成绩导入](docs/grade-data-import.md) |
| 理解代码和数据边界 | [架构说明](docs/architecture.md) · [数据字典](docs/data-dictionary.md) |
| 部署、验收、备份或恢复 | [部署指南](docs/deployment.md) · [发布 smoke](docs/smoke-release.md) · [备份恢复](docs/recovery.md) |
| 查找设计稿、历史方案和实施记录 | [文档导航与文件分类](docs/README.md) |
| 判断当前唯一版本、整理结果及旧版本恢复位置 | [项目文件归属与保留清单](docs/project-files.md) |

### 项目文件分区

| 路径 | 职责与保留方式 |
| --- | --- |
| `app/`、`components/`、`lib/` | 正式页面、组件、服务端业务与测试 |
| `app/preview/`、`public/previews/` | 仅开发环境可访问的设计样例；生产请求返回 404，静态预览不进入发行资源 |
| `data/sample/`、`data/schema/`、`data/fixtures/` | 合成数据、数据口径和隔离测试资料；测试资料不进入发行物 |
| `scripts/`、`.github/` | 管理、验收、恢复工具与协作配置 |
| `docs/`、`licenses/` | 分类文档、设计资料和第三方许可 |
| `records/`、`.env.local` | 私有运行状态和配置，Git 忽略；不可作为缓存清理 |
| `oulad_raw/`、`oulad.zip` | 外部原始数据和压缩包，完整数据不提交 |
| `.next*`、`output/`、`.playwright-cli/` | 可再生成构建与本地验收证据；旧产物已整理，历史证据和版本恢复包在项目外保留，详见文件清单 |

`DEV_STATE.md`、`PROGRESS.md` 和根目录开发路线图保留旧路径供历史引用；它们不是当前待办入口。当前说明与历史资料的阅读顺序见[文档导航](docs/README.md)。

## 本地运行

环境要求：Node.js 22 LTS、pnpm 11+。

```bash
pnpm install
pnpm admin:init
pnpm dev
```

首次运行 `pnpm admin:init`，在终端设置管理员账号和至少 12 个字符的密码。浏览器打开 `http://localhost:3000`，登录后默认进入数据浏览，主导航仅有“数据浏览”和“AI 对话”；数据源与字段说明在工具中按需展开，账号、系统管理及导入作为从属工具按权限开放。项目默认包含 `data/sample/`，本地 OULAD 是否可用取决于 CSV 文件和账号授权；管理员还可发布并授权独立成绩数据集。

未配置 AI 时，可运行已验证的预设问题和本地统计工具，但不保证任意自然语言问题可用。要启用自由提问，复制 `.env.example` 为 `.env.local` 并设置 `APP_SETTINGS_KEY`（32 字节 base64），之后在管理员的“系统管理 → AI 配置”中选择 Responses 或兼容 Chat Completions 协议，保存 API 基础地址、模型、密钥、估算单价和调用预算。地址留空使用 OpenAI 官方 API；保存后立即生效。也兼容服务端 `OPENAI_API_KEY` / `OPENAI_MODEL` 初始化。模型通过受控工具请求分析，不能提供文件路径或执行任意 SQL。

### 本地运行正式版本

```bash
pnpm build
pnpm start:standalone
```

`pnpm build` 同时准备可独立运行的 standalone：包含页面静态资源、正式公开资源、第三方许可证和 DuckDB 原生库。默认入口为 `.next/standalone/server.js`；可通过 `PORT`、`HOSTNAME` 设置监听地址。账号、密钥与私有数据必须通过运行环境和持久化目录配置，不打进发行物；从独立目录启动时必须使用持久化目录的绝对路径。开发服务仍用 `pnpm dev`，仅开发环境开放设计预览。

当前已真实验证百炼 `qwen3.7-flash` 的连接与受限分析计划输出；在 AI 配置中使用 Chat Completions 协议，填写百炼地址、密钥、模型及换算成 USD 的估算单价。`qwen3.7-flash` 与 `qwen3.8-flash` 均适配 JSON 输出和关闭思考模式，步骤见 [百炼接入指南](docs/bailian-qwen.md)。

也可试用智谱 `glm-4.7-flash`：在 AI 配置中点击智谱预设，填写智谱密钥，输入与输出单价按官方当前免费定价填 `0`，保存并测试。适配 JSON 输出与关闭思考模式；免费服务仍受平台限流约束，步骤见 [智谱试用指南](docs/zhipu-glm.md)。

有导出权限的账号可下载聚合 CSV、预览或下载 HTML 报告、打印另存 PDF。报告中心只汇集本次页面会话的结果，刷新或退出后不保留列表；AI 对话有独立的服务端账号历史，不应混为一谈。服务器历史报告、报告分享、任意业务表导入和课程/班级级授权尚未开放。操作细节见[工作台使用指南](docs/workspace-guide.md)、[对话历史存储](docs/ai-conversation-storage.md)和[成绩导入边界](docs/grade-data-import.md)。

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

- **AI 与统计分工**：AI 理解问题、选择受控工具并解释结果，也可回答普通问题；数字、排序、样本数由本地 DuckDB / SQL 计算。统计工具不允许模型直接执行任意 SQL，也不向模型提供学生原始明细。
- **不给个体结论**：不返回学生姓名/学号/名单、不做个体排名或风险名单；少于 3 人的分组不展示，只输出群体聚合统计。内置数据为 OULAD 与虚构模拟数据；管理员导入的成绩表需自行确保合法授权，相关文件按私有运行状态保存。
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

模型负责理解问题、选择受控工具、生成结构化分析计划和解释结果；统计计算交给 DuckDB / SQL。所有模型输出都要经过字段、权限、查询和结果校验，不能让模型直接执行任意 SQL 或凭空生成数字。

## 第三方来源与许可

AI 状态提示改编自 [Rare UI](https://rareui.com) 的 [Inline AI Status](https://www.rareui.com/components/aistatus) 源码，使用 Motion 驱动阶段图标和状态过渡；分析依据卡片交互参考其 Web Search，执行记录结构参考 shadcn/ui Task。Rare UI 采用 MIT + Commons Clause + Attribution，已保留原作者版权和[许可证全文](licenses/rare-ui-LICENSE.txt)，正式历史栏保留来源链接。来源版本、改编范围和后续参赛材料要求见[第三方来源与许可说明](docs/third-party-notices.md)。开发环境可访问 `/preview/ai-motion` 查看共用正式组件的动效样例，生产环境不开放该路径。

## 正式 AI 对话体验与账号历史

「一句话分析」已接入账号隔离的服务端历史、最后消息更新后 10 天清理、可信图表／表格切换与可打断阅读跟随。使用方法见 [正式体验说明](docs/ai-conversation-experience.md)，持久化、停机／重启及清理方式见 [历史存储说明](docs/ai-conversation-storage.md)，验证边界见 [本地验收记录](docs/ai-conversation-experience-acceptance.md)。固定演示 `/preview/ai-experience` 只作为开发资料保留，不再从正式历史栏进入，也不在生产环境开放。

## 概念驱动的数据浏览

登录后从课程全景开始。点图中的“数据结构”，先打开二级选择，明确进入后以大标题、简短范围和一张主图阅读这门课；“画法”“去向”“数据”按需展开，完整指标表不再常驻。柱形／点位／雷达表达同一份数据；再点出勤率，可选择出勤—成绩、出勤—通过、出勤—教学周、出勤—学科等关联，或只更换当前画法。打开和取消选择不改图、不新增历史；明确选择跨学科关系才扩展课程范围，点另一课后重新建立课程中心，不自动层层取学生交集。

正式页面查询 `/api/concept-explorer`，复用账号与数据集权限、DuckDB 和导入版本，不读取设计样稿的静态 JSON。OULAD、模拟数据和导入成绩分别按真实字段显示能力；缺出勤、缺作业或缺教学目标定义时明确说明，数值 0 不当作缺失，小样本不回退全体，学生 ID 不进入 URL 或响应。课程目录最多展示100门，标明实际范围并保留直接选中的课。

主题过程与访问过的画法分别记录，全览前后回看主题、横向选择画法，首页始终可达，较早内容仅折叠。刷新、原生前进后退、AI／工具往返恢复范围、画法和阅读位置；切换画法不重新查询。舞台在数据到达后模糊聚焦，四角保持可操作；系统与应用关闭动效时即时更新。窄屏图表和指标表在局部横向滚动，不把整张图压成微小文字。

数据源、字段说明、账号和管理从右上工具进入，报告从 AI 主场及结果附件进入；从属页可返回原主场。右下切到 AI 只带可移除的浏览参考，不自动发问；真实生成仍需可用模型与权限。数据浏览固定浅色，不修改其它页面保存的主题。操作与验证边界见[工作台指南](docs/workspace-guide.md)；独立[讨论稿](docs/design/open-canvas-study/README.md)保留为设计资料，不作为正式数据源。
