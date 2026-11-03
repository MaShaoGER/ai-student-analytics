# 历史资料归档

归档整理日期：2026-11-02。这里保存已被后续方向替代的方案或已执行任务的原输入，不是当前待办列表，也不提供新的执行授权。

| 资料 | 归档原因 | 当前入口 |
| --- | --- | --- |
| [独立框架路线](project-framework-roadmap.md) | 原定另建项目；主项目后续选择复用原 Next.js + DuckDB 系统 | [项目首页](../../README.md)、[工作台指南](../workspace-guide.md) |
| [后台开工提示词](prompts/admin-build-prompt.md) | 早期后台阶段 0–5 的任务输入，不能重复执行 | [后台使用](../admin-management.md)、[验收](../admin-management-acceptance.md) |
| [正式对话接入提示词](prompts/ai-conversation-experience-build-prompt.md) | 对话体验已接入，保留当时要求供追溯 | [正式对话](../ai-conversation-experience.md)、[历史存储](../ai-conversation-storage.md) |
| [玻璃纹理提示词](prompts/glass-texture-build-prompt.md) | 已有落实记录；原文件行号和修改清单不再作为当前基线 | [纹理规格与实施](../glass-texture-rollout.md) |
| [早期 P0 协作任务](prompts/partner-ai-task.md) | 旧接口示例与视觉范围不能覆盖后续产品能力 | [架构](../architecture.md)、[文档导航](../README.md) |

## 为什么没有把所有旧文件都搬进来

- 根目录 `DEV_STATE.md`、`PROGRESS.md` 和原开发路线图有大量既有引用，保留路径并明确历史日期，比搬动后留下重定向正文更简单。
- 含规格、接口约束和实际验收的阶段文档仍可能用于维护，因此保留专题路径，通过[文档导航](../README.md)区分使用指南与历史记录。
- 设计稿与配套 HTML、SVG、截图、视频保持相邻路径，详见[设计索引](../design/README.md)，不以“历史”之名拆散素材。
- `prompts/` 中代码围栏和旧任务正文保留原语境。里面的文件名、行号、分支、端口、用户授权只属于当时任务，使用前必须重新核实，不可直接复制为当前执行命令。
