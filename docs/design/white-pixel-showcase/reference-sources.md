# 网格、像素与柔光：补充参考

调研日期：2026-10-30。以下为设计参考与取舍建议，尚未安装或接入组件。

## 视频线索与核实范围

来源：[北岛Travis《Vibe Coding 必收藏！6 个提升网页质感的网站》](https://www.bilibili.com/video/BV12SHQ6jEqA/)。页面显示发布于 2026-10-08，时长 1 分 49 秒。已读取标题、简介，并在前段画面确认 MotionSites（约 00:19）。未登录页面在试看 30 秒后要求登录，因此未确认其余五个网站，不将后续补充网站标为视频清单。

视频前段展示的是 [MotionSites](https://motionsites.ai/)，该站收集可配合 AI 使用的网页设计案例和提示词。适合研究整体构图、首页章节和视觉描述；具体案例是否适合本项目需要逐项筛选。

## 最相关的效果参考

下表“项目应用”是本次设计判断，原站效果与项目拟采用的强度、配色和操作方式可能不同。

| 优先级 | 原站示例 | 原站内容 | 项目应用建议 |
| --- | --- | --- | --- |
| 高 | [Paper / Static Mesh Gradient](https://shaders.paper.design/static-mesh-gradient) | 多色点混合的静态网格渐变，可调混合、形变和颗粒 | 制作白底首屏的局部柔光，使用浅紫、浅桃、嫩绿，保留清晰的静态版本 |
| 高 | [Aceternity / Grid and Dot Backgrounds](https://ui.aceternity.com/components/grid-and-dot-backgrounds) | 网格与点阵背景 | 用作细线网格的基础参考，大标题跨格，正文区收淡装饰线 |
| 高 | [React Bits / Pixel Blast](https://reactbits.dev/backgrounds/pixel-blast) | 漂移、闪烁的像素云，带指针响应和波纹 | 提取颗粒聚散及亮度变化，用于主视觉局部；控制运动幅度和触发频率 |
| 中 | [React Bits / Ripple Grid](https://reactbits.dev/backgrounds/ripple-grid) | 网格像水波一样起伏并亮起 | 参考光经过网格的变化，优先保留平面结构和少量交点微光 |
| 中 | [React Bits / Line Waves](https://reactbits.dev/backgrounds/line-waves) | 光带经过流动的细线 | 用于章节过渡或首屏一侧，缩减线条密度，避免干扰图表 |
| 中 | [Aceternity / Tracing Beam](https://ui.aceternity.com/components/tracing-beam) | 随滚动沿 SVG 路径移动的光束 | 给“提问 → 分析 → 结果”流程提供轻量阅读进度提示 |
| 中 | [Paper / Dithering](https://shaders.paper.design/dithering) | 抖动着色器效果 | 探索柔光到像素颗粒的过渡；静态稿先看颗粒密度与文字对比 |
| 低 | [Aceternity / Moving Border](https://ui.aceternity.com/components/moving-border) | 沿边界移动的光效 | 仅用于一个主要体验入口或分析完成提示，避免每个控件都持续发光 |

## 继续找案例的入口

- [MotionSites](https://motionsites.ai/)：整体案例和提示词。先筛白底、开放式排版和有内容展示的页面。
- [Minimal Gallery](https://minimal.gallery/)：真实网站的排版与留白参考，可查看 AI、Portfolio、SaaS 等分类。
- [Uiverse](https://uiverse.io/)：按钮、输入等小控件的表现参考；挑选与全站一致的细节。
- [Hover.dev](https://www.hover.dev/)：标签切换、展开、按钮反馈等轻量交互参考。

## 本轮建议的组合

以静态细线网格建立构图；用局部柔光填入主视觉；用少量像素表达聚合与发现；用一条路径流光连接分析步骤。静态构图成立后，再决定哪些细节需要动起来。

本轮没有冻结依赖选择。视觉参考并不意味着需要同时引入这些组件库。
