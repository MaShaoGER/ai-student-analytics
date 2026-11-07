# 文档导航与文件分类

更新日期：2026-11-07。本页负责“去哪里找”，功能操作以对应指南为准，不另维护一份重复的功能状态表。

## 阅读顺序

1. [项目首页](../README.md)：当前能力、目录职责、本地启动与常用命令。
2. [工作台指南](workspace-guide.md)：数据浏览 v3、权限、导出及有日期的本地验收记录。
3. 按任务阅读下面的专题指南；需要追溯设计决策或旧验证结果时，再查历史资料。

唯一开发主线、旧工作副本归并结果、外部恢复包及实际验证见[项目文件清单](project-files.md)的最新版本归并章节；其后的 2026-11-02 盘点仅用于历史追溯。

当前项目沿用原有 Next.js + DuckDB 系统。独立框架、白色像素展示和玻璃材质的早期方案不自动构成当前开发任务。文档与运行结果冲突时，应核实当前代码和实际环境，不把规划写成完成，也不把旧测试数量当作最新验收。

## 使用与管理

| 文档 | 用途 |
| --- | --- |
| [工作台指南](workspace-guide.md) | 数据浏览、同群体探索、图表、报告与账号入口 |
| [正式 AI 对话体验](ai-conversation-experience.md) | 连续追问、历史、阅读跟随、图表和数值表 |
| [对话历史存储](ai-conversation-storage.md) | 账号隔离、保留期限、重启和持久化边界 |
| [后台管理](admin-management.md) | 三角色、账号、数据集授权、系统总览和日志 |
| [教学成绩导入](grade-data-import.md) | Excel/CSV、字段映射、校验、发布与版本边界 |
| [演示问题](demo-questions.md) | 演示提问与数据语境；模型能力和数据可用性需现场核对 |

## 开发与数据契约

| 文档 | 用途 |
| --- | --- |
| [架构说明](architecture.md) | 当前主链路、模块职责和安全边界；末尾早期阶段记录单独标识 |
| [数据字典](data-dictionary.md) · [指标定义](metric-definitions.yml) | 字段与统计口径；具体图表还应查专题说明 |
| [AI 工具说明](ai-tools.md) · [图表能力](ai-chart-capabilities.md) | 受控工具、展示语义与已知边界 |
| [回答可靠性](ai-answer-reliability.md) · [评测用例](ai-eval-cases.md) | 数字依据、语义评测及历史结果的适用范围 |
| [管理统计契约](admin-stage4-api-contract.md) | 请求、用量、费用及操作日志统计口径 |
| [百炼接入](bailian-qwen.md) · [智谱接入](zhipu-glm.md) | 服务商配置步骤；模型可用性、价格和限流以服务商现状为准 |
| [动效系统](motion-system.md) | 动效约定和减少动态效果的处理 |
| [架构决策 ADR](adr/) | 具体决策的背景、日期与适用范围，不将旧决策标题当作最新能力表 |

## 部署、验收与交接

- [部署指南](deployment.md)：部署方式与带日期的线上记录；本地验收不代表线上已更新。
- [发布 smoke](smoke-release.md)、[备份恢复与回退](recovery.md)：运维工具、持久卷与演练边界。
- [演示预案](demo-runbook.md)、[AI 交接单](ai-handover.md)、[AI 反馈模板](../.github/ISSUE_TEMPLATE/ai-feedback.yml)。
- [后台验收](admin-management-acceptance.md)、[AI 对话验收](ai-conversation-experience-acceptance.md)、[数据浏览 v3 验证](workspace-guide.md#验证)。这些是相应日期的证据，不代表本轮重新运行。
- [第三方来源与许可](third-party-notices.md)、[许可证目录](../licenses/)：源码改编、交互参考和再分发限制。

## 设计与预览资料

设计资料保留原有路径及资源，统一入口见[设计与预览索引](design/README.md)；候选方案不是正式页面的功能承诺。

| 资料 | 定位 |
| --- | --- |
| [AI 实施说明与正式版边界](design/ai-implementation-brief-2026-11-03.md) | 顶部为最新正式版执行要求；旧视觉提案与分阶段记录按日期保留，实际实现及验证见工作台指南 |
| [AI 前端参考库](design/ai-frontend-reference.md) · [全站设计语言](design/ai-frontend-reference/design-language.md) | 用户素材与设想的持续记录：黑白、光感玻璃、色散、主题色、边缘模糊，以及视频关键帧和提示词 |
| [白色像素展示方案](design/white-pixel-showcase.md) · [配套资料](design/white-pixel-showcase/) | 设计候选与参考，不按整份方案认定已实施 |
| [连续图表叙事](design/connected-chart-story.md) · [静态样例](design/connected-chart-demo/index.html) | 连线构图探索；静态样例不证明真实业务接通 |
| [可视化参考](visualization-inspiration.md) | 图表、表格和空间表达研究 |
| [玻璃设计归档](design/glass-workspace/README.md) · [层级方案](design/glass-hierarchy.md) | 早期视觉决策、截图与静态快照 |
| [玻璃接入](glass-workspace-implementation.md) · [纹理落实](glass-texture-rollout.md) | 对应阶段的实现和验证记录 |
| [玻璃参考](liquid-glass-design-references.md) · [早期设计改进](design-improvements.md) | 历史方向与参考，不覆盖当前使用指南 |
| [AI 预览说明](ai-experience-preview.md) | 固定片段与真实数据、真实模型的差别 |

`app/preview/` 是开发用 Next.js 预览路由，`public/previews/` 是静态设计工作文件，`docs/design/` 保存设计说明及阶段快照。来源文件保留，不迁移、不去重或删除；前两类路径在生产环境返回 404，静态设计资料不作为发行资源，正式工作台不再提供固定演示入口。

## 历史路线与阶段记录

以下资料保留原有事实和当时的未完成项，只用于追溯，集中归档部分见[归档索引](archive/README.md)。若其中出现“当前”“下一步”“待实施”，应按原记录日期理解。

- **早期独立框架方案**：已移动到 [archive/project-framework-roadmap.md](archive/project-framework-roadmap.md)。其另建项目方向已被当前复用原系统的方向替代。
- **根目录历史入口**：[原开发路线图](../AI学生数据分析系统开发路线图.md)、[开发续接记录](../DEV_STATE.md)、[项目进度记录](../PROGRESS.md)。为避免破坏已有引用，保留路径并增加历史说明，不将整份旧记录重写成当前状态。
- **赛事阶段**：[改进路线](competition-improvement-roadmap.md)、[第一阶段](competition-phase1.md)、[第二阶段](competition-phase2.md)。
- **AI 演进**：[第一阶段](ai-phase1.md)、[统一流程路线](unified-ai-workflow-roadmap.md)、[步骤 1](unified-ai-step1.md)、[阶段 2](unified-ai-phase2.md)、[步骤 3](unified-ai-step3.md)、[步骤 4](unified-ai-step4.md)。
- **后台与对话路线**：[后台路线](admin-management-roadmap.md)、[对话体验路线](ai-conversation-experience-roadmap.md)。
- **反馈与修复**：[2026-10-21 对话反馈](ai-conversation-experience-feedback-2026-10-21.md)、[对应修复](ai-conversation-experience-fixes-2026-10-21.md)。
- **历史执行提示词**：已集中至 [archive/prompts/](archive/prompts/)，包括[后台](archive/prompts/admin-build-prompt.md)、[对话体验](archive/prompts/ai-conversation-experience-build-prompt.md)、[玻璃纹理](archive/prompts/glass-texture-build-prompt.md)、[协作任务](archive/prompts/partner-ai-task.md)。它们是当时任务的输入，不是新一轮自动执行授权。
- **案例研究**：[开源参考案例](reference-cases.md)。

## 文件维护与清理边界

| 类别 | 路径 | 处理原则 |
| --- | --- | --- |
| 源码、测试、配置 | `app/`、`components/`、`lib/`、`scripts/`、根目录配置 | 本轮未整理代码或改动运行配置；后续变更另行验证 |
| 当前说明 | 根 `README.md`、本导航、专题指南 | 功能变化更新所属指南；本导航维护入口，避免到处复制状态表 |
| 历史资料 | `docs/archive/`、有日期的实施记录、旧路线图 | 保留原日期和验证边界；移动时同步检查引用，不留下两份竞争正文 |
| 设计与证据 | `docs/design/`、`public/previews/`、`output/`、`.playwright-cli/` | 区分可复用素材和临时截图；先确认保留需求，不盲目删除 |
| 私有运行状态 | `records/`、`.env.local` | 不是缓存，不公开、不提交、不随整理删除；恢复需完整备份及密钥 |
| 外部原始数据 | `oulad_raw/`、`oulad.zip` | 保留来源与许可；大文件已忽略，不随目录整理移动或删除 |
| 可再生成产物 | `.next*`、`*.tsbuildinfo`、`node_modules/` | 已有忽略规则；本轮只清理由用户确认且检查无占用的隔离构建目录，具体范围和结果见项目文件清单 |

2026-11-05 已将本地工作副本与分支收敛到最新 `main`，更新类型配置并验证正式工作台；旧源码、私有状态和验收证据在项目外保留可恢复归档。上表及较早的“方案一”说明属于此前整理边界，当前结果以[项目文件清单](project-files.md)最新章节为准；本轮不推送或部署。
