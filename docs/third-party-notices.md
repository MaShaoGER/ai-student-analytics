# 第三方来源与许可说明

## 烟银玻璃视觉参考（2026-10-21）

用户选择了 [Raycast Wallpapers 的 Glaze 1](https://www.raycast.com/wallpapers) 作为背景材质方向：黑色留白、银灰曲面与柔和反射。项目在 `lib/ui/glass-optics.ts` 中自行编写曲面与环境反射程序，沿用本地磨砂采样；没有复制 Raycast 的壁纸文件、预览图片或源码，也没有从远端加载其图像。这里是视觉参考与本地实现，不将参考作品列为本项目原创素材；不据此声称取得原壁纸的复用或分发许可。既有 Rare UI 的源码改编声明和义务继续适用。

## 对话刻度导航交互参考（2026-10-21）

右侧轮次刻度参考 [VS Code Minimap](https://code.visualstudio.com/docs/editing/getting-started/userinterface#_minimap)
的侧边概览与定位思路；按钮、轮次映射和滚动复用为本地实现，未复制其源码、图像或文档段落，没有引入 VS Code 运行时组件。
位置语义查阅 [MDN aria-current](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current)。
动效复用项目已有令牌；这些参考不改变下述 RareUI 源码改编的许可和署名义务。

## Rare UI 源码改编与交互参考

学析台的 AI 状态提示和分析依据卡片参考 [Rare UI](https://rareui.com) 的
[Inline AI Status](https://www.rareui.com/components/aistatus) 与
[Web Search](https://www.rareui.com/components/websearch) 交互设计。
执行记录的结构同时参考 [shadcn/ui Task](https://ui.shadcn.com/docs/ai-elements/radix/task)。

### 实际使用范围（2026-10-20 更新）

- **源码改编**：`components/ui/ai-status.tsx` 的阶段图标、书写轨迹与状态切换结构，以及同名 CSS Module 的短标签流光，改编自 Rare UI `components/ui/ai-status.tsx`。此前仅参考交互的实现已被此版本替代。
- **固定来源版本**：[swamimalode07/rare-ui@9633fcfa81c212a0ba48507e9c56be4869d61928](https://github.com/swamimalode07/rare-ui/blob/9633fcfa81c212a0ba48507e9c56be4869d61928/components/ui/ai-status.tsx)。版权为 `Copyright (c) 2026 Swami Malode`，保留在改编文件头部；[许可证全文](../licenses/rare-ui-LICENSE.txt)按该提交原样保存。
- **本地适配**：项目 CSS Modules 与主题色代替 Tailwind；增加取消、部分完成终态；状态依真实执行事件映射；改用 200ms 透明度和位移过渡，不引入原版的文字宽度测量、全组件模糊、计时器或自动演示时间线。新增 `motion` 运行时依赖，没有安装名为 Rare UI 的运行时包，也没有引入 `react-use-measure`、Tailwind 或 shadcn。
- **交互参考、本地实现**：分析依据的来源图标展开和卡片依次呈现参考 Web Search；执行记录结构参考 shadcn/ui Task。没有复制这两个组件的源码，也没有启用 Web Search 的拟真搜索进度、正文逐字动画或远程 favicon 请求。
- **可发现署名**：README 和 `/preview/ai-motion` 提供 Rare UI 链接。后续复制、发行该适配代码时继续保留上述版权与许可文件；postbuild 会将许可证全文复制进 standalone 目录，Docker 镜像随该目录一并携带。

### Rare UI 的许可要求

2026-10-20 核对的 [官方 LICENSE](https://github.com/swamimalode07/rare-ui/blob/main/LICENSE)
标题为 `MIT + Commons Clause License Condition v1.0 + Attribution`，版权人为
`Copyright (c) 2026 Swami Malode`。

- 允许免费将软件用于应用、网站或产品，包括商业用途。
- 若复制或改编源码，应保留版权与许可声明。
- 发布包含其软件的项目时，须提供用户可以找到的 Rare UI 署名链接，例如 README、关于页或页脚。
- 不得把组件本身单独、打包或作为移植版本销售、转授权或再分发。

因此不能将其描述为“无版权”或“纯 MIT、没有附加条件”。当前源码改编已保存版本信息及许可证原文；后续更新须核对新版本条款。

### 后续文档要求

用户已确认：后续编写项目说明、参赛材料和第三方组件清单时，需保留 Rare UI 的来源与上述许可说明。应准确区分“交互设计参考、本地实现”和“第三方源码复用”，不把第三方参考写成完全原创；发布前核对实际使用的版本和许可。

## 本轮实现位置

- `components/ui/ai-status.tsx`、同名 CSS Module：改编的 Rare UI 状态动效。
- `components/conversation-evidence.tsx`、同名 CSS Module：真实执行状态映射、执行步骤、统计依据与教学引用卡片。
- `lib/ai/execution-status.ts`：根据实际步骤事件区分运行、完成、失败、取消、中断与部分完成。
- 状态与步骤只由真实响应驱动；不使用自动播放时间轴、不推算进度百分比、不增加正文逐字播放。
- 沿用项目的 `--ease-out`、动效开关、键盘即时切换与系统减少动态效果设置。

- `/preview/ai-motion`：共用正式组件的手动演示，不请求 AI、不自动推进状态，所有数据明确标为演示。
