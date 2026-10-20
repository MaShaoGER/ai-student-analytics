# 学析台 · 统一动效系统（2026-10-18，已落地）

主页「激进但受控」的动画语言已推广到全站（6 个代理分工实施）。核心实现位于 `app/motion.css`，本文件是所有页面/组件的实现契约。新增动效前先读本文件与 `components/learning-overview.tsx` 的参考实现。

## 设计原则

- 动效表达层级与因果，不做装饰循环：页面/视图切换入场、数据到达计数、图表生长、控件反馈。
- 统一节奏：入场 480 / 620 / 760ms，控件按压 150ms、状态 200ms；缓动只用 `var(--enter-ease)`（0.16,1,0.3,1）、`var(--ease-out)`、`var(--ease-drawer)`。
- 数字只在真实数据到达时计数一次；图表切换重播整组而不是在无关数据间变形。
- 错峰 60ms 一档，最多 8 档；不要整页同时播放。
- 只动画 `transform`/`opacity`/`clip-path`；不要动画 width/height/margin/padding。
- 不给 fixed 元素（对话输入区、浮层）的祖先加 transform，避免破坏 fixed 定位；页面级淡入用 `.view-surface`。
- 必须尊重本机「交互动效」开关（`html[data-motion]`）与系统 `prefers-reduced-motion`；键盘操作保持即时反馈。

## 可用令牌（`app/motion.css` :root）

| 令牌                                             | 值                         | 用途                            |
| ------------------------------------------------ | -------------------------- | ------------------------------- |
| `--enter-ease`                                   | cubic-bezier(0.16,1,0.3,1) | 入场缓动                        |
| `--ease-out` / `--ease-in-out` / `--ease-drawer` | 既有令牌                   | 控件/位移/抽屉                  |
| `--motion-enter-fast`                            | 480ms                      | 小元素、辅助内容                |
| `--motion-enter`                                 | 620ms                      | 默认入场                        |
| `--motion-enter-slow`                            | 760ms                      | 主视觉/图表区                   |
| `--enter-dur` / `--enter-delay`                  | 自定义属性                 | 单元素覆盖时长/延迟（内联样式） |

## 声明式 API

### 1. 单元素入场

```tsx
<span data-enter="wipe" style={{ "--enter-delay": "0ms" } as CSSProperties}>标题</span>
<div data-enter="rise" style={{ "--enter-delay": "80ms" } as CSSProperties}>面板</div>
```

可用值：`rise`（26px 上浮）、`rise-sm`（12px）、`panel`（18px 面板）、`fade`、`wipe`（左→右裁切）、`slide-left`、`slide-right`、`scale`（0.982 缩放）。
元素重新挂载（页面切换、key 变化）时自动重播；`prefers-reduced-motion` / 动效关闭时立即呈现最终状态。

### 2. 分组错峰

```tsx
<div
  className="dataset-scope"
  data-enter-group="rise"
  style={{ "--enter-group-delay": "120ms" } as CSSProperties}
>
  <span>…</span>
  <span>…</span>
  <span>…</span>
</div>
```

子元素按 60ms 阶梯进入，支持 1–8+ 项；用于卡片网格、标签页、表格行、推荐问题等。

### 3. 生长条

```tsx
<i data-grow style={{ "--fill": 0.72, "--enter-delay": "260ms" } as CSSProperties} />
```

元素需由页面 CSS 设定高度/背景（宽度由系统设为 100%，用 `scaleX` 生长）。

### 4. 骨架屏

`<span className="motion-skeleton" aria-hidden="true" />`，宽度/高度由页面 CSS 决定；加载占位统一用它替代大号破折号。

### 5. 数字计数

```tsx
import { AnimatedNumber } from "@/components/ui/animated-number";

<AnimatedNumber value={result.rows.length} decimals={0} fallback="—" />;
```

只渲染数字文本，字体样式留在调用方；数据首次到达、重新挂载时从 0 计数 900ms。需要自定义格式时使用 `useCountUp(value)`。

### 6. 图表入场

`AnalysisChart` 已有 `entrance` 属性：传入后分组逐柱生长（760ms、32ms 阶梯），指标/数据切换整组重播。自定义 ECharts 组件遵循同样参数（参考 `components/analysis-chart.tsx`）：

```ts
const animate = motionEnabled && !reducedMotion; // 首次绘制可直接放开
chart.setOption({
  animation: animate,
  animationDuration: entrance ? 760 : 0,
  animationDurationUpdate: entrance ? 560 : 240,
  animationEasing: "cubicOut",
  animationDelay: entrance ? (i: number) => Math.min(i * 32, 420) : 0,
});
```

SVG 图表用 `data-enter` / 模块内 keyframes（stroke-dashoffset、clip）实现描线/展开，禁止长循环。

## 页面清单与统一稿

| 区域          | 入口动画                                                                                |
| ------------- | --------------------------------------------------------------------------------------- |
| 登录页        | 品牌/标题错峰上浮、概念信号图描线、表单卡右滑入场、表单字段错峰                         |
| 工作台 chrome | 页面标题眉题擦入、标题上浮、副标题淡入；视图切换 `.view-surface` 淡入 + 内容 data-enter |
| 学习全景      | 已实现（参考）                                                                          |
| 指标分析      | 控件区、结果卡、焦点数字计数、图表入场、表格行错峰                                      |
| 一句话分析    | 页面入场、消息逐条入场、图表附件展开、输入区入场                                        |
| 数据          | 标题/统计条/表结构/字段错峰                                                             |
| 分析报告      | 控件区、报告预览框入场                                                                  |
| 系统管理      | 标签页、统计数字计数、表单分区、账号列表错峰                                            |
| 个人设置      | 账号卡与密码卡错峰                                                                      |
| 主题切换      | 全站以点击位置为圆心的 700ms 圆形揭示（View Transition API，自动降级）                  |
| 导航抽屉      | 全站 460ms 滑入 + 导航项 80–280ms 错峰                                                  |

## AI 状态与依据补充（2026-10-20）

`components/conversation-evidence.tsx` 与同名 CSS Module 已接入正式对话组件：

- AI 状态条现改编 Rare UI Inline AI Status 源码：星光思考、搜索扫描、统计柱变化和书写轨迹分别表示实际执行阶段，运行标签带短文本流光。图标及文字以 200ms ease-out 切换；终态停止循环，完成、失败、取消、中断与部分完成保持不同图标/文案。
- 动画运行在 Motion/CSS 层，不用 React 每帧更新；连续流光仅作用于短状态标签。保留原版小尺寸 SVG 路径动画，不对正文、图表或整卡添加流光/模糊，不测量/动画化状态文字宽度。
- 执行步骤保留真实顺序和耗时，不预设总步数、不显示推算百分比；失败、取消、中断、部分完成不呈现为成功。
- AI 状态与执行记录共用一个原生折叠区：状态动效、当前阶段、已完成步数和箭头组成唯一摘要行，展开后查看步骤。运行时默认展开，结束后默认收起；尚未收到步骤时仍显示真实等待状态。正式对话与预览页共用这一结构，完成/部分完成语义传递到摘要。
- 统计依据与教学引用分别标注，保留完整事实、事实标识、引用片段和来源链接；统计结果卡保留范围、实际样本数和限制，不合计重叠分组人数。
- 原生 `details/summary` 保留键盘与触屏操作；支持 `::details-content` 的浏览器以透明度和 4px 位移做 200ms 展开/收起，不支持时直接切换。仅精细指针悬停时来源图标展开；真实依据卡片以 240ms、45ms 间隔依次呈现（延迟上限 180ms）。
- 上述动画仅在项目动效开启、指针操作且系统未要求减少动态效果时播放；固定输入区的祖先不做 transform。本次新增 `motion`，不做正文逐字播放。

交互参考来源和后续文档署名要求见[第三方来源与许可说明](third-party-notices.md)。

源码改编版验证（2026-10-20）：类型检查、17 项状态/流式/对话回归、15 项恢复回归和独立目录生产构建通过。浏览器检查浅深色、390px/320px、8 种手动状态、运行动效关闭、键盘与系统减少动态效果；4 个运行图标逐帧采样确认在播放。隔离账号通过真实 `/api/chat` 本地预设统计查询核对分析依据展开及图表；本轮没有重新验收外部模型语义效果。生产模式检查流光与窄屏布局。构建仍有 `lib/datasets/grade-store.ts:361` 的动态文件追踪警告，本次未改动该逻辑。截图和图标采样记录位于 `output/rareui-motion/`。

注意：Motion 14 中图标所在 `AnimatePresence` 不使用 `initial={false}`，避免抑制内部 SVG 循环；历史/终态图标保持静态。许可证全文由 postbuild 脚本复制进 standalone 发布目录。

此前简化实现的验证：类型检查与 74 项相关回归通过；浏览器核对真实查询、知识引用、取消请求、键盘展开、390px 窄屏与原生折叠。动效开关关闭及系统减少动态效果时，内容过渡均为 `0s`；开发服务器编译与运行错误检查为空。旧版浏览器的即时折叠为代码降级路径，未逐版本实测。

## 首次推广时的分工边界（2026-10-18）

- 不改登录/AI/统计的业务逻辑、接口与文案；只加动效与必要的 class/data 属性/key。
- 不新增依赖；不使用动画库；不改 `package.json`。
- 不改动共享文件：`app/motion.css`、`app/layout.tsx`、`app/theme.css`、`app/globals.css`、`app/workbench.css`、`components/workspace.tsx`、`components/analysis-chart.tsx`、`components/ui/*`、`components/learning-overview.tsx`。
- 组件内新增样式优先写入自己的 CSS Module，或任务指定的 `app/motion-*.css`（已在 layout 引入）。
- 验证：`npx tsc --noEmit`、`npx prettier --check <改动文件>`；可选浏览器核对共享预览 `http://localhost:3102`（账号 `preview` / `preview-pass-2026`，其他代理可能同时在改文件，仅确认自己区域安定后的表现）。

## 落地记录（2026-10-18）

- 共享层：`app/motion.css`、`components/ui/animated-number.tsx`、`app/layout.tsx` 引入顺序、`components/ui/theme-provider.tsx` 圆形揭示全站化。
- 页面层：`components/learning-overview.tsx`（声明式 API 参考实现）、`components/workspace.tsx`（页面标题/视图切换/数据/报告/账号/chrome）、`components/analysis-result.tsx` + `app/motion-analysis.css`、`components/ai-conversation.tsx` / `conversation-tool-result.tsx` / `app/motion-conversation.css`、`course-panorama*` / `course-relations*`、`score-distribution.tsx` / `chart-studio.tsx` / `studio-chart.tsx`、`login-screen.tsx` / `admin-panel.tsx` / `app/motion-auth.css`。
- 交互开关补充：`MotionPreferences` 在重新开启动效时写入 `data-motion-replay-guard`，避免已渲染页面重播入场；`workspace.navigate/changeMode` 清除该标记，下一次视图切换恢复正常。
