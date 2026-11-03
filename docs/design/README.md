# 设计与预览资料索引

整理日期：2026-11-02。这里区分设计讨论、静态快照与正式业务；具体方向与确认状态见对应文档，不将旧设计要求或候选建议自动变成当前任务。

## 先看什么

- **全站视觉改造的最新执行依据：** [2026-11-03 AI 实施说明](ai-implementation-brief-2026-11-03.md)。正式项目已落实共享直角视觉、单图阅读与二级选择；第11节记录本轮实施与真实验收边界，过程数据四图仍未接入。
- 正式数据浏览行为与真实数据边界：[工作台指南](../workspace-guide.md)。
- 原型、当前源码与本地证据的归属：[项目文件清单](../project-files.md)。
- 全部专题文档：[文档导航](../README.md)。

## 本目录保留的设计成果

| 资料 | 阅读用途 | 实现边界 |
| --- | --- | --- |
| [AI 实施说明：已确认风格与项目改造](ai-implementation-brief-2026-11-03.md) | 最新直角／单图阅读要求、视觉规则、代码落点及第11节实施记录 | 本轮正式视觉与阅读交互已改；新增过程数据与四种图表仍属后续独立接入 |
| [学习过程图表研究](learning-process-study/README.md) · [HTML](learning-process-study/index.html) · [实际截图](learning-process-study/preview.png) | 新增模拟过程数据驱动的成绩流河、知识点星图、日级活动地形、阶段轨迹 | 2025J聚合样例，可换18门课；未接入正式API与AI |
| [黑白、光感玻璃与边缘模糊 HTML 预览](ai-frontend-preview/index.html) · [说明](ai-frontend-preview/README.md) | 点选课程、详情、斜侧叠层全览，明暗与光感调节 | 独立样例、固定示意数据；正式应用未改动，待用户视觉评审 |
| [AI 前端设计与开发参考库](ai-frontend-reference.md) · [全站设计语言](ai-frontend-reference/design-language.md) | 用户素材与图文拆解；全站黑白、光感玻璃、色散、少量主题色与边缘模糊，以及总览视角 | 最新用户说明优先，堆叠移动是次要参考；区分设计要求与实现状态 |
| [开放画布与空间浏览：方向与正式接入](open-canvas-exploration.md) | 方向演进、首页与路线、课程—指标—关系循环、画法全览及模糊渐进 | 第17节是当前正式集成说明，第9–16节保留样稿阶段记录；不是通用平台重建 |
| [Opus 概念循环讨论稿](open-canvas-study/README.md) / [HTML](open-canvas-study/index.html) | 点课程看指标表、点指标看关联、同数据换画法的独立视觉对照 | 静态稿本身不接正式API；对应逻辑已在正式工作台接入真实查询，不能混淆两者 |
| [白色基底与像素方向](white-pixel-showcase.md) | 页面构图、字体、柔光与像素候选，包含历版稿件链接 | 不表示整份展示方案已实施，也不是下一轮默认任务 |
| [配套视觉资产](white-pixel-showcase/) | PNG、可编辑 SVG、字体对照、参考图和来源记录 | 示意数据不作为实际统计结果，参考素材不自动获得公开使用许可 |
| [连续图表叙事](connected-chart-story.md) | 连线构图、章节与指标切换的规划记录 | 六段故事不是当前功能清单 |
| [连续图表样例说明](connected-chart-demo/README.md) | 独立 HTML、PNG/SVG 与互动切片的区别 | 固定演示数据与阅读路径不代表统计推导 |
| [静态物理连接样例](connected-chart-demo/index.html) | 不依赖正式后端的构图演示 | 不证明真实群体、权限和 AI 已接通 |
| [玻璃设计阶段归档](glass-workspace/README.md) | 历版决定、参考图、截图、视频及独立静态页面 | 历史快照不跟随正式代码自动更新 |
| [玻璃归档预览索引](glass-workspace/index.html) | 查看归档时的视觉候选 | 画面上的账号、数值和输入操作可能是示意 |
| [玻璃层级方案](glass-hierarchy.md) | 对应阶段的层级调整说明 | 不覆盖当前页面或后续确认的需求 |

## 三种预览位置的职责

1. **`docs/design/`**：说明、原型及归档快照；保持资源相对位置，可独立回看。
2. **`public/previews/`**：静态预览工作文件。当前有 `motion-refine.html`、玻璃 V1–V4、两版布局及相邻 V3 脚本。保持名称和依赖关系，不移入文档目录冒充归档。
3. **`app/preview/`**：Next.js 预览路由，包括 `ai-home`、`ai-motion`、`ai-experience`、`ai-analysis`、`direction-a`、`glass-material`、`glass-backgrounds`、`connected-story`。是否复用正式组件、是否使用真实数据，按各自说明与代码判断；本轮不调整路由或业务。

## 保留与更新原则

- 工作文件与归档快照即使字节相同，也不自动去重；一个负责继续探索，一个负责保留当时状态。
- 本轮保留所有设计图、HTML、SVG、视频和应用预览源码；后续淘汰某套预览应单独检查入口、来源许可和资源引用。
- `output/` 和 `.playwright-cli/` 是本机忽略目录，分类见项目文件清单。它们不是新的设计源文件目录，也不应未经审查整包公开。
- 修改正式功能时更新专题指南；新增设计候选时写明日期、示意数据和待确认项，避免继续把“最新预览”误当作“正式现状”。
