# 新对话提示词：落实玻璃表面纹理（点阵微透镜）

将下面整段复制到项目的新对话中即可。

```text
请在 /Users/mashao/Documents/chuanzhi_project 把「点阵微透镜玻璃纹理」落实到整个项目，直接实施并验证，不只输出方案。

先读取并遵循：
1. 项目 AGENTS.md 及其引用的规则文件。
2. docs/glass-texture-rollout.md：本轮已确认的决策、参数表、现状盘点、着色器改动点、实施批次与验收标准。这是本轮的规格，不要重新设计。
3. DEV_STATE.md 顶部交接；需要背景时读 docs/glass-workspace-implementation.md 和 .interface-design/system.md。

视觉基准：public/previews/motion-refine.html 第 06 节「界面仿真」视图。该页是纯静态 HTML，不依赖 Next。若开发服务没在运行，用 `cd public && python3 -m http.server 8123` 起静态服务后访问 http://127.0.0.1:8123/previews/motion-refine.html#s6 。用它对照调参，但不要修改预览页既有结构，除非为了实现新的降级形态。

开始前核对并简要汇报实际分支、工作树、未提交改动和运行中的开发服务。工作树里已有与本轮无关的未提交改动（.dockerignore / Dockerfile / app/globals.css / app/theme.css / docs/deployment.md / next-env.d.ts / package.json / scripts/** / tsconfig.json 及若干未跟踪文件），必须保留，不能 reset、clean 或覆盖。

本轮用户已确认的方向：
- 采用「点阵微透镜」作为统一的表面纹理语言；不使用棱镜条纹（该模式已在预览页实现，保留为可选项，本轮不启用）。
- 点阵只出现在强调层。图表、表格、长回答正文永久禁止点阵。
- 深色主题的点阵强度低于浅色：L3 深色 0.40、浅色 0.55；通透度提到 0.85 作补偿。
- 点阵间距 8–10px、角度 45°。

按以下四批推进，每批做完自行验证再进入下一批：

批次 1（只改属性，零风险，先做并汇报效果）
- 删除 9 处错位的 data-glass-texture：learning-overview.tsx:286 的 .overview-chart-panel（现为全站最高的 0.7，压在图表底下，最优先）、:400 的 .overview-ranking、:556 的 .overview-source-card、login-screen.tsx:88 的 .login-story、grade-import.tsx:994/1087/1266/1403 的 .stepPanel 四处；learning-overview.tsx:477 的 .overview-ask-card 降到 0.20。
- 保留并按参数表调整 5 处：learning-overview.tsx:211 的 .overview-metric → 0.40、analysis-result.tsx:327 的 .result-focus 保持 0.4、admin-management.tsx:814/911 的 .metricCard → 0.45、login-screen.tsx:214 的 .login-form-card → 0.35。

批次 2：在 app/glass-controls.css 建立四档令牌 --glass-blur-0/1/2/3、--glass-alpha-*、--glass-refract-*、--glass-dot-* 与 --glass-dot-pitch / --glass-dot-angle / --glass-dot-vibrancy，把裸数值属性改成语义属性 data-glass-tier="0|1|2|3"，由 CSS 变量映射。后续调值只改变量，不再散落数值。

批次 3：参数化着色器（lib/ui/glass-optics.ts）。把 :230-233 的固定 5.5px 网格、写死的 9.5 位移与 14.0 透镜形状改为 uniform 驱动；关键是把点阵从「只扰动法线」升级为「真实位移采样」，让点内出现背后颜色的错位，而不是叠一层网点；色散在点阵位移大的位置增强；textureStrength 为 0 时整段跳过。不要重写已有的两趟渲染、pane 注册和边缘 Snell 折射。

批次 4：收敛 CSS 点阵。app/glass-workspace.css:59 与 :934 的 --glass-relief 退化为 WebGL 不可用时的降级材质，间距与透明度与 WebGL 点阵对齐；prefers-reduced-transparency: reduce 下关闭点阵并给实底；data-optics="fallback" / "solid" 时用 CSS 网点补位 L3。

硬约束：
- 不改业务逻辑、接口、文案、aria 结构与统计口径；不新增依赖；不引入第三方玻璃库。
- 不做嵌套玻璃。Apple 明确说明玻璃不能采样玻璃；内层只加纹理，不再叠 backdrop-filter。
- 深色下点阵强度上限 0.40，超过会读成网格噪点。
- 点阵不用于表达禁用、加载中或错误状态。
- 保留 data-motion 开关、系统减少动态、减少透明、隐藏/离屏停止与 GPU 不可用降级。

验证至少覆盖：pnpm typecheck；相关单元与路由回归（至少图表语义与导出范围两组）；隔离生产构建；真实浏览器核对浅/深主题、1512×982 与 390×844、切换指标与数据源、暂停流光；放大 4 倍确认图表与表格区域没有任何点阵、点阵内部背景确有位移；WebGL 上下文丢失后降级不白屏；prefers-reduced-transparency 下实底可读（正文对比 ≥ 4.5:1）；着色器无编译错误、WebGL 错误码 0。使用隔离账号与状态目录，保护正在运行的开发服务和已有配置；不要调用收费模型。

若遇掉帧，优先降 --glass-refract-3 而不是关点阵（折射比点阵更贵）。移动端真机与跨浏览器验收列为遗留项，不要声称已通过。

完成后更新 DEV_STATE.md 顶部交接，并在 docs/glass-texture-rollout.md 末尾追加「实施记录」：实际改了哪些文件、最终数值、验证结果、偏差与遗留项。默认不提交、推送、合并或部署，交付本地可运行、可审查的完整改动。
```