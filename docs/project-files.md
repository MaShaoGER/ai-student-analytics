# 项目文件归属与保留清单

盘点日期：2026-11-02。本文记录方案一的文件归属与清理边界，不改变代码结构、Git 分支或应用行为。功能说明见[工作台指南](workspace-guide.md)，资料入口见[文档导航](README.md)。

## 1. 工作区与功能提交

盘点时主目录的 `HEAD` 为 `main` 的 `d187c89`，数据浏览 v3 的本地归档分支为 `feat/data-explorer-v3`，提交为 `3504b24`。主目录不是该分支的独占工作树，因此“仍有未提交修改”不等于功能提交丢失。

对该提交的 33 个文件变更逐项核对：

- 31 个非 Markdown 变更全部一致：现存文件逐字节匹配提交对象，旧 `components/learning-overview.tsx` 的删除状态也一致。
- 两个文档 `README.md`、`docs/workspace-guide.md` 在提交后继续进行了说明整理，与提交正文不同；不能用提交中的旧说明覆盖它们。
- `components/data-explorer*`、`components/exploration-*`、`lib/exploration/` 和 `lib/analysis/exploration-focus.test.ts` 在当前 `main` 工作区显示为未跟踪，但属于已归档 v3 的正式成果，不是临时文件。
- `app/preview/connected-story/`、白色像素及连线设计资料、可视化研究属于额外保留的设计/预览成果；不擅自并入 v3 提交，也不删除。
- `.claude/launch.json` 是本地工具配置，`参考.af` 是已有参考文件。本轮保持原位置和内容，不自动移动、忽略或提交。

这些结论只对应盘点时快照。后续版本归并需在明确授权后进行；本轮不切分支、不暂存、不提交、不推送，不用 `reset` / `clean` 制造“干净工作区”。

## 2. 文件分区

| 分类 | 路径 | 本轮处理 |
| --- | --- | --- |
| 正式工程 | `app/`、`components/`、`lib/`、`scripts/`、`data/`、根配置与锁文件 | 不移动、不改内容 |
| 当前说明 | 根 `README.md`、`docs/README.md` 与专题指南 | 统一入口并修正历史引用 |
| 历史任务输入 | `docs/archive/prompts/` | 集中四份旧开工/协作提示词，保留正文及旧路径语境，注明不构成新授权 |
| 旧独立框架路线 | `docs/archive/project-framework-roadmap.md` | 前一轮已归档，本轮纳入统一归档入口 |
| 根目录历史记录 | `DEV_STATE.md`、`PROGRESS.md`、原开发路线图 | 保留路径，避免破坏大量历史引用；不再当作当前待办 |
| 设计与静态快照 | `docs/design/` | 新增[设计资料索引](design/README.md)，素材不移动、不删除 |
| 应用/静态预览 | `app/preview/`、`public/previews/` | 保持代码、路由及相邻资源关系，不纳入本轮重构 |
| 私有运行数据 | `records/`、`.env.local`、`oulad_raw/`、`oulad.zip` | 原样保留；不显示密钥、账号状态或原始学生内容 |
| 验收证据 | `output/`、`.playwright-cli/` | 分类登记并原样保留；含临时状态的目录不可整体公开 |
| 生成产物 | `.next*`、`*.tsbuildinfo`、`node_modules/` | 仅对确认无占用、用户确认的构建目录清理；依赖、类型配置及默认开发缓存保留 |

## 3. 设计、快照与重复文件

设计工作文件和阶段快照有不同职责。对 `docs/design/`、`public/previews/`、`output/`、`.playwright-cli/` 的 1,258 个基线文件进行内容指纹分组，共发现 74 组完全相同的文件，其中 58 组跨区域。相同字节不代表用途相同，未据此批量删除。

例如 `public/previews/glass-workspace-v4.html` 与 `docs/design/glass-workspace/previews/glass-workspace-v4.html` 相同：前者是静态预览工作文件，后者是设计归档快照。保持两处，可使历史说明、相邻资源和独立预览继续有效。截图、主题配置副本和测试状态也可能同内容，不按文件名或哈希自动合并。

## 4. 本地验收证据分类

以下为本机现有目录，不是仓库随附资源，不将“文件存在”表述为本轮重新通过验收。路径保留为代码文本，避免把本机忽略目录当成公开文档必需链接。

| 类别 | `output/` 下的目录 | 保留原因 |
| --- | --- | --- |
| 业务与权限验收 | `admin-management/`、`grade-import-qa/`、`competition-phase1/`、`competition-phase2/` | 账号、导入和阶段性验收证据 |
| AI 与对话 | `ai-conversation/`、`ai-eval/`、`ai-review/`、`browser-verify/`、`rareui-motion/` | 区分模拟/真实模型、浏览器过程与组件效果 |
| 工程审查与回归 | `audit/`、`impl/`、`ui-audit/`、`ui-refactor/`、`component-system/`、`small-screen/` | 审查报告、窄屏与多主题证据 |
| 玻璃与材质探索 | `glass-workspace/`、`glass-texture-verify/`、`design-review/`、`blue-glass/`、`glass-rollback/`、`glass-fixes-20261027/`、`liquid-refresh/`、`hierarchy-refinement/`、`mode-switch/` | 历史视觉方案、修正前后对照与降级验证 |
| 设计研究与候选实现 | `visualization-inspiration/`、`minimal-implementation/`、`project-minimal/`、`project-capsule/`、`capsule-concept/`、`industrial-concept/` | 已探索方案与实验输出，不作为正式代码入口 |
| 综合截图与参考 | `playwright/` | 多轮截图、动画与参考素材，按原路径追溯 |

共 31 个顶层证据目录，另有 `.playwright-cli/` 的历史浏览器截图、页面快照与控制台日志。初始磁盘占用分别约 316 MiB 和 48 MiB，本轮不删除。

部分证据目录包含 `state/`、`records/`、浏览器用户目录、临时账号或加密配置辅助文件。它们已被忽略，但“被 Git 忽略”不等于可公开。分享时仅提取审查过的报告和截图，不把整个 `output/` 打包上传；本轮不读取或复述其中的凭据内容。

## 5. 构建产物检查与清理范围

盘点时未发现项目的 Next 开发/生产服务进程或对应监听；对下列六个目录执行递归打开文件检查，无占用记录。目录用途结合隔离命名、验收记录和原有忽略规则确认，不能仅以“旧目录”认定可删。

| 路径 | 初始占用（KiB） | 用途 |
| --- | ---: | --- |
| `.next-api-test/` | 95,524 | 隔离 HTTP 集成开发产物 |
| `.next-v3-browser/` | 302,320 | v3 浏览器验收开发产物 |
| `.next-v3-production/` | 1,296,724 | v3 隔离生产构建，可由源码重建，不是数据备份 |
| `.next-ui-fixes/` | 268,832 | 旧 UI 修正验收产物 |
| `.next-product-acceptance/` | 683,724 | 旧产品验收生产产物 |
| `.next/api-test/` | 16,608 | 旧嵌套 API 产物；当前脚本已使用同级 `.next-api-test/` |

用户已明确选择删除上述六个目录，执行前再次确认它们是真实目录、没有符号链接替换且没有打开文件占用。已删除初始合计 2,663,732 KiB（约 2.54 GiB）的生成产物；这是原目录磁盘占用之和，不等于文件系统可用空间的精确增量。默认 `.next/` 其余内容、`node_modules/`、`tsconfig.tsbuildinfo` 与所有账号/数据/证据保留。清理构建不代表重跑或通过构建，后续相应命令需重新生成产物。

## 6. 整理记录

- 已完成：工作区归属核实、四份历史任务输入归档、设计和证据分类、引用更新。
- 已按用户确认删除六个生成目录，逐项检查路径已不存在；默认 `.next/` 其余 956 个文件/链接的指纹一致。
- 源码、配置、运行数据、原始数据、预览素材和本地证据纳入保护基线，检查 1,582 个非 Markdown 文件内容未变。历史开工提示词的原始任务正文保留；归档后全项目非本机证据 Markdown 的 374 个相对文件链接可达。
- 本轮不包含业务代码、样式、依赖或运行配置修改，不包含新一轮功能验收、真实模型调用、提交和部署。
