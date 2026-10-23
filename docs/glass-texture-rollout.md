# 玻璃表面纹理落实规格：点阵微透镜

## 2026-10-23 · 指标卡点阵与按压反馈修订

用户反馈点阵像白色贴点、间距偏大，浅色更明显，点击缺少反馈。本次以以下修订覆盖下文旧的 8–10px / 9px 间距记录，其他分层与数据保护边界继续适用：

- 微透镜间距为 **6.5 CSS px**，角度仍为 45°；深浅主题强度上限不变。
- 去掉固定亮点、圆顶增白与暗网格遮罩；将透镜偏移从格点坐标转回屏幕坐标，在宽域磨砂之后叠加「偏折采样与原背景采样之差」。均匀背景保持平静，只有背景光线穿过时才显出透镜变化。浅色的表面明暗进一步降低。
- GPU 不可用时的 CSS 纹理同步细化并减淡，尤其降低浅色高光；这只是静态降级，不声称具备真实折射。
- 指标卡指针按下时触发 **280ms**、局限于卡片背景的折射反馈；按压使用独立 `scale` 和现有 `--ease-out`，160ms，避免被入场动画持有的 `transform` 覆盖。反复点击当前指标也有反馈。
- 背景流光暂停与交互反馈独立；关闭交互动效、系统减少动态、减少透明与 GPU 降级仍优先。暂停时仅按压期间短暂请求帧；隐藏/离屏停止，卸载移除监听和资源。不以 React state 驱动逐帧变化。
- 图表、表格、长正文仍不参与点阵或像素折射；统计、权限、AI 行为不变。

按用户此前要求，**本次未运行测试、生产构建或浏览器效果验证**；以上记录的是代码实现，未声称浅/深主题、设备性能或点击观感已验收。

---

2026-10-22。用户确认以「点阵微透镜（halftone microlens）」作为全站表面纹理语言，并要求在后续对话中落实到整个项目。本文是可执行的规格；配套的[新对话提示词](glass-texture-build-prompt.md)用于启动实施。

视觉基准是 `public/previews/motion-refine.html` 第 06 节「界面仿真」视图（可交互调参）。实现完成后该预览页可作为验收对照。

---

## 1. 决策与边界

用户已确认：

- **采用点阵微透镜**作为统一的表面纹理语言，替换现在"强度随意、位置错位"的 `data-glass-texture`。
- **不采用棱镜条纹（fluted）作为主语言**。该模式已在预览页实现，保留为后续可选项，本轮不启用。
- 点阵只在**强调层**出现；图表、表格、长文本**永久禁止**。

不在本轮范围：

- 不改业务逻辑、接口、文案、aria 结构与统计口径。
- 不新增依赖；不引入第三方玻璃库。
- 不改动登录/权限/AI 调用行为。
- 不做移动端真机验收（列在遗留项）。

---

## 2. 设计依据（本轮调研结论）

来自 WWDC25「Meet Liquid Glass」与四个开源实现（rdev/liquid-glass-react、shuding/liquid-glass、liquidglass.dev、websiteglass.com）的公开资料：

- **Lensing（折射）是材质的定义性特征**，不是模糊；Apple 用"实时地弯曲、塑形、汇聚光"描述它，进入/退出也是靠"逐渐调节折射"而不是改透明度。
- **折射集中在边缘**：HIG 配图说明为"方块边缘的微妙弯曲暗示了材质覆盖在内容之上"。
- **尺寸越大越厚**：大面板应比小控件有更强的折射与更深的投影。
- **玻璃不能采样玻璃**：Apple 明确说明玻璃容器是为了共享采样区；实现上不要做嵌套玻璃层。
- **触摸时从指尖发光并向内扩散**。

开源实现全部使用 SVG `feDisplacementMap`；唯一给出物理曲线的是 liquidglass.dev：超椭圆穹顶 `h(s) = (1-(1-s)^k)^(1/k)` 加 Snell 折射 `bend = tan(θ − asin(sinθ/ior))`，`k=4`、`ior=1.5`、`refraction=18px`、`chroma=0.12`，衰减远陡于线性（`s=0.1` 时降到 0.395，`s=0.5` 时只剩 0.039）。

项目现有实现（`lib/ui/glass-optics.ts`）已具备两趟渲染、pane 注册、边缘法线折射与 RGB 逐通道色散，本轮是在其上收敛纹理，不需要重写光学管线。

---

## 3. 参数表（最终建议值）

点阵间距 8–10px，角度 45°。深色主题的点阵强度整体低于浅色——暗底上的点阵容易读成"网格噪点"。

| 层级 | 组件（真实 class） | blur | 底色 alpha | 折射位移 | 点阵 | 边缘高光 | 投影 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **L0 结构层** | `.workbench-main` `.glass-data-sidebar` `.historyRail` | 16px | 0.10 | 6–8px | **0** | 0.6 | 柔和 8/28 |
| **L1 控件层** | `.glass-mode-switch` `.control` `.icon-button` `select` | 10px | 0.18–0.26 | 3–4px | **0** | 1.0 | 轻 3/12 |
| **L2 浮层** | `.workbench-drawer` `.logout-confirmation` `.composer` | 28px | 0.13 | 14px | **0** | 1.2 | 深 26/60 |
| **L3 强调层** | `.overview-metric.is-selected` `.ai-status` `.chartToggle` | 14px | 0.14 | 18–20px | **0.40（深）/ 0.55（浅）** | 1.4 | 中 14/34 |
| **数据保护** | `.chart` `.result-table` 长回答正文 | 0 | 实底 | 0 | **禁止** | — | — |

L3 的通透度（vibrancy）提到 **0.85**，用以补偿点阵带来的"密集感"；AI 状态条可用 0.60 强度 + 0.9 通透度。

核心判断，实施时不要随意推翻：

1. **控件层比结构层更"实"**（alpha 更高）。小控件需要明确的可点击边界，过于透明会"按不准"；大面板必须让位给数据。alpha 的顺序是反直觉的。
2. **点阵只标"正在看哪个指标"**。它替代边框和换色，是选中态的语言，不是装饰。
3. **图表区的点阵必须清零**。当前 `learning-overview.tsx` 的图表面板带着全站最高值 0.7，是本轮最需要修的一处。

---

## 4. 现状盘点

### 4.1 `data-glass-texture` 的 14 处

| 文件:行 | 组件 | 现值 | 处置 |
| --- | --- | --- | --- |
| `components/learning-overview.tsx:286` | `.panel.overview-chart-panel` | 0.7 | **删除**（图表区，最优先） |
| `components/learning-overview.tsx:400` | `.panel.overview-ranking` | 0.55 | **删除**（表格密集） |
| `components/learning-overview.tsx:477` | `.overview-ask-card` | 0.55 | 降到 0.20 或删除 |
| `components/learning-overview.tsx:556` | `.panel.overview-source-card` | 0.65 | **删除** |
| `components/login-screen.tsx:88` | `.login-story` | 0.5 | **删除**（大结构面板） |
| `components/login-screen.tsx:214` | `.login-form-card` | 0.6 | 保留，降到 0.35 |
| `components/grade-import.tsx:994/1087/1266/1403` | `.stepPanel` ×4 | 0.55 | **全部删除**（校验列表要求极致清晰） |
| `components/learning-overview.tsx:211` | `.overview-metric` | 0.6 | 保留 → **0.40** |
| `components/analysis-result.tsx:327` | `.result-focus` | 0.4 | 保留 |
| `components/admin-management.tsx:814/911` | `.metricCard` ×2 | 0.6 | 保留 → **0.45** |

净效果：**9 处删除、5 处保留**。删除同时是性能收益——着色器少算 9 个大面积像素。

### 4.2 两套点阵需要合并

项目里现在有两套独立的点阵：

| 系统 | 位置 | 现状 |
| --- | --- | --- |
| **CSS 点阵** | `app/glass-workspace.css:59` 与 `:934` 的 `--glass-relief`，径向渐变圆点在 8px 网格；用于选中态背景（`:227 :276 :332 :443 :514 :787`） | 在浅色主题下表现为可见的"网点噪点"，与 WebGL 点阵**叠加**，视觉上过重 |
| **WebGL 点阵** | `lib/ui/glass-optics.ts:216-237`，由 `data-glass-texture` 控制 `textureStrength`，用 `microlens` 微扰法线 | 折射弱、不可参数化（间距固定 5.5px、角度固定 45°） |

处置：

- **以 WebGL 点阵为唯一真实来源**，CSS `--glass-relief` 退化为 WebGL 不可用时的降级材质，并把间距/透明度对齐到 8–10px / 更低透明度。
- 选中态不再依赖 CSS 网点表示"被选中"，改由点阵 + 边缘高光共同表达。

### 4.3 着色器里需要参数化的固定值

`lib/ui/glass-optics.ts`：

- `:231` `microlens = exp(-dot(cell, cell) * 14.0)` —— 透镜形状。
- `:232` `slope = -cell * microlens * 9.5` —— 位移强度写死。
- `:230` `fract(diagonal / 5.5)` —— 间距写死 5.5px。
- `:237` `textureNormal += facetNormal * textureStrength * 5.2` —— 法线扰动幅度。
- `:244` `spectralWidth = (2.8 + edge * 10.0 + textureStrength * 1.6) * …` —— 色散宽度。
- `:219-223` `u_reliefRects/u_reliefMaterials` —— 已经支持"在已有 pane 上叠加局部压纹"，可复用于嵌套强调。

---

## 5. 技术方案

### 5.1 统一令牌（新增到 `app/glass-controls.css`）

```css
.glass-workspace {
  /* 四档玻璃：blur / alpha / refract / dot */
  --glass-blur-0: 16px;  --glass-alpha-0: 0.10;  --glass-refract-0: 7px;   --glass-dot-0: 0;
  --glass-blur-1: 10px;  --glass-alpha-1: 0.22;  --glass-refract-1: 3.5px; --glass-dot-1: 0;
  --glass-blur-2: 28px;  --glass-alpha-2: 0.13;  --glass-refract-2: 14px;  --glass-dot-2: 0;
  --glass-blur-3: 14px;  --glass-alpha-3: 0.14;  --glass-refract-3: 19px;  --glass-dot-3: 0.40;

  /* 点阵几何 */
  --glass-dot-pitch: 9px;
  --glass-dot-angle: 45deg;
  --glass-dot-vibrancy: 0.85;
}
:root[data-theme="light"] .glass-workspace {
  --glass-dot-3: 0.55;
}
```

后续调值只改这一处，不动规则。

### 5.2 着色器改动（`lib/ui/glass-optics.ts`）

1. 新增 uniform：`u_dotPitch`、`u_dotAngle`、`u_dotStrength`（来自 `data-glass-dot` 或类名映射）。
2. 把 `:230-233` 的固定网格改为使用 `u_dotPitch` / `u_dotAngle`。
3. 在 `microlens` 位置增加**真实折射采样**：点阵造成的位移要参与 `refracted` 的计算（参考预览页实现），而不是只扰动法线；这是"点阵在折射背后的颜色"与"贴一层网点"的区别。
4. 色散在点阵位移大的位置增强（`spectralWidth` 加一项 `dotSlope`）。
5. 保留 `textureStrength = 0` 时完全跳过该段分支，避免无纹理 pane 的性能损耗。

### 5.3 组件侧改动

- 把 `data-glass-texture="0.7"` 这类**无层级含义的裸数值**改为语义属性：`data-glass-tier="0|1|2|3"`，由 CSS 变量映射到 blur/alpha/refract/dot。
- 删除 4.1 表中标"删除"的 9 处属性。
- 降级：`data-optics="fallback"` / `solid` 时，L3 用 CSS `--glass-relief` 静态网点补位。

---

## 6. 实施批次

| 批次 | 内容 | 风险 | 可独立验收 |
| --- | --- | --- | --- |
| **1** | 删掉 9 处错位纹理；5 处保留值按表调整 | 极低（只改属性） | 是 |
| **2** | 引入四档令牌 `--glass-*`，把语义 `data-glass-tier` 接上 | 低 | 是 |
| **3** | 着色器参数化点阵（pitch/angle/strength + 真实折射采样） | 中 | 是 |
| **4** | CSS 点阵降级收敛、`prefers-reduced-transparency` 下关闭点阵 | 低 | 是 |

批次 1 单独就能明显改善，建议先做并验收手感，再推进 2–4。

---

## 7. 验收标准

**视觉**

- 图表面板、表格、长文本区域**看不到任何点阵**（截图放大 4 倍确认）。
- 选中的指标卡有点阵，未选中的没有；切换指标时点阵跟随移动。
- 点阵里的背景颜色有**位移**（放大查看点内与点外的背景错位），而不是均匀噪点。
- 浅色主题下点阵不糊成灰色一片，小字仍可读。

**技术**

- `pnpm typecheck` 通过。
- 相关单元/路由测试通过（至少图表语义、导出范围两组）。
- 隔离生产构建通过。
- WebGL 上下文丢失时降级正常（`data-optics="fallback"`），页面不白屏。
- `prefers-reduced-transparency: reduce` → 实底、无点阵、文字对比 ≥ 4.5:1。
- 着色器无编译错误；WebGL 错误码 0。
- 帧率：桌面 1512×982 下滚动与切页不低于现有基线（着色器像素量是减少的，理论上应更快）。

**浏览器**

- 浅/深主题、1512×982 与 390×844、暂停流光、切换数据源、切换指标。
- 键盘 focus 环在点阵背景上仍清晰可辨。

---

## 8. 风险与不做的事

- **不要做嵌套玻璃**。现有 `.overview-metric` 位于 `.workbench-main` 内，理论上已是叠加；本轮的处置是"内层只加纹理不加 blur"，不要再叠一层 backdrop。
- **不要把点阵用在文字背后**。长回答正文、表格单元格、图表刻度一律为实底。
- **不要用点阵表达"禁用"或"加载中"**——语义冲突。
- 深色主题的点阵强度上限按 0.40 控制；超过会在暗底上读成噪点。
- 移动端与低端 GPU 未验收，列遗留项；如遇掉帧，优先降 `--glass-refract-3` 而不是关点阵（折射比点阵更贵）。

---

## 9. 遗留与后续

- 棱镜条纹（fluted）模式已在预览页实现但未启用；若后续想用于侧栏/输入框，规格见预览页 06 节的参数与本文第 2 节的圆柱透镜模型。
- AI 思考状态条的点阵波纹（Apple 的"从指尖发光扩散"）尚未实现，属于动效范畴，另开一轮。
- 登录页首屏的"品牌时刻"（大透镜 + 色散）尚未实现。
- 移动端真机性能与跨浏览器验收待补。

---

## 10. 参考

- 预览与调参：`public/previews/motion-refine.html`
- 现有光学实现：`lib/ui/glass-optics.ts`
- 现有材质说明：[玻璃工作台实现](glass-workspace-implementation.md)
- 材质与层级历史决策：`.interface-design/system.md`
- Apple WWDC25「Meet Liquid Glass」：<https://developer.apple.com/videos/play/wwdc2025/219/>
- liquidglass.dev 物理曲线（超椭圆 + Snell）：<https://liquidglass.dev>

---

## 11. 实施记录（2026-10-22）

按批次 1–4 全部落地，本地可运行、未提交。实际分支 `codex/glass-interface-design`，工作树保留用户原有部署与开发配置改动。

### 11.1 实际改动文件

- `app/glass-controls.css`：新增四档令牌 `--glass-blur/alpha/refract/dot-0..3`、`--glass-dot-pitch: 9px`、`--glass-dot-angle: 45deg`、`--glass-dot-vibrancy: 0.85`；`data-glass-tier="0|1|2|3"` 映射到 `--glass-*-current`；未选中指标卡点阵归零，ask-card 与登录卡用局部令牌覆盖；未分级表面 `--glass-refract-current: 32px`（保持既有边缘折射基线）。
- `lib/ui/glass-optics.ts`：新增 `u_surface[12]`（点阵强度/间距/角度/折射）、`u_pixelScale`、`u_dotVibrancy`；删除固定 5.5px 网格、9.5 位移与 14.0 透镜；点阵位移进入 `refracted` 真实采样，`dotChroma` 并入 `spectralWidth`；`dotStrength≤0.001` 整段跳过；嵌套强调通过 relief 在父 pane 上压纹并做主题化上限；默认纹理改为 0；observer 改为监听 `data-glass-tier`；主题/图案变化强制重读计算样式。
- `components/learning-overview.tsx`：删除图表/明细/数据概况三处纹理；指标卡 `data-glass-tier="3"`，选中时 `data-glass-relief="1"`；ask-card 保留并降到 0.20（浅色 0.28）。
- `components/login-screen.tsx`：登录故事面板删除纹理；登录卡 `data-glass-tier="3"`（0.35 / 浅色 0.48）。
- `components/grade-import.tsx`：四个 `.stepPanel` 纹理全部删除。
- `components/admin-management.tsx`：两处 `.metricCard` 改 `data-glass-tier="3"` + `data-glass-relief="1"`。
- `components/analysis-result.tsx`：`.result-focus` 改 `data-glass-tier="3"` + `data-glass-relief="1"`。
- `app/preview/glass-material/page.tsx`、`app/preview/glass-backgrounds/page.tsx`：样例面板改 tier 3；材质预览中的装饰柱状图移除纹理（图表禁点阵）。
- `app/glass-workspace.css`：`--glass-relief` 降级材质改为 9px 圆点、透明度降低；非 WebGL 时 L3 用 CSS 网点补位；WebGL 激活时 `--glass-relief: none`，CSS 网点不再是叠加层；`prefers-reduced-transparency: reduce` 关闭点阵并实底；文件末尾补浅色 reduce 重断言。

净属性变化：8 处裸数值删除（chart/ranking/source/login-story/stepPanel×4），5 处按参数表保留为 tier 3；ask-card 按用户要求保留 0.20。演练仓库内已无 `data-glass-texture`。

### 11.2 最终数值

| 表面 | 深色 | 浅色 |
| --- | --- | --- |
| L3 指标卡 / 管理卡 / 分析聚焦卡 | 0.40 | 0.55 |
| AI ask-card | 0.20 | 0.28 |
| 登录表单卡 | 0.35 | 0.48 |
| 选中导航 / 历史行（relief 0.85） | 0.34 | 0.47 |
| 点阵几何 | pitch 9px / 45° / vibrancy 0.85 | 同左 |
| 边缘折射 | tier 3 = 19px；未分级 = 32px（旧基线） | 同左 |
| CSS 降级网点 | 白 0.10 / 黑 0.16 | 白 0.34 / 黑 0.10 |

### 11.3 验证结果

- 类型检查：`pnpm typecheck` 通过。
- 单元/路由回归：`pnpm test` **749 通过 / 73 跳过 / 0 失败**；定向图表语义与导出范围 **28 通过**（visualization 7、exports/analysis 20、studio-chart-options 1）。
- 隔离生产构建：`NEXT_DIST_DIR=.next/glass-texture-build pnpm build` 退出码 0，39 个静态页；仅有既有的 `grade-store.ts` 动态文件访问 warning，与纹理无关。
- 真实浏览器（系统 Chrome / agent-browser，隔离账号 `glassadmin` + `output/glass-texture-verify/state`，隔离 dev 3102 已在验收后停止；未触碰既有 8123 静态预览与 GUI）：
  - 1512×982 深/浅主题：选中指标卡点阵 0.40/0.55，未选中 0，图表/表格 `--glass-dot-current = 0`；4 倍放大图表柱区、表头与表行均无网点。
  - 390×844：无横向溢出（scrollWidth-clientWidth = 0），选中卡有点阵、其余无。
  - 切换指标 score→activity：`data-glass-relief` 与点阵跟随移动，无残留。
  - 数据源 demo→OULAD：真实结果与表格更新，点阵/折射保持，图表仍 0。
  - 暂停流光：2 秒内 canvas `toDataURL()` 完全一致；WebGL 错误码 0；页面无 runtime error。
  - 上下文丢失（`WEBGL_lose_context`）：`data-optics="fallback"`、canvas 隐藏、正文可读、L3 切到 CSS 降级网点，不白屏。
  - `prefers-reduced-transparency: reduce`（CDP 模拟）：`data-optics="solid"`、`--glass-relief: none`、无网点/无 backdrop；正文对比浅色 10.09:1、深色 14.51:1（≥4.5:1）。
  - 键盘焦点：点阵卡上 2px 实心 outline 清晰可辨。
  - 真实位移：着色器把 `dotBend` 加进 `refracted` 后再采样；用 pitch 28px / 强度 1 放大诊断可见点内色带采样错位。生产值（9px、0.40–0.55）位移约 1.5–2.1 CSS px，平滑烟银背景上需 4 倍放大观察，符合“点内背景错位而非均匀噪点”的实现方式。
  - 证据截图：`output/glass-texture-verify/shots/`（gitignored）。
- 未验证：移动端真机、Safari/Firefox、逐像素光流或帧率基线、`.result-focus` 单独截图（与已通过的嵌套 relief 同路径）。

### 11.4 偏差与判断

1. **管理指标卡取 0.40 而非 0.45**：深色点阵硬上限为 0.40，0.45 会在暗底读成网格噪点；以硬约束优先。
2. **ask-card 保留 0.20**：按批次 1 指令保留而非删除，因此实际为 8 删 6 留（含 ask-card），与规格“9 删 5 留”的计数表述不同。
3. **嵌套强调走 relief**：`overview-metric`、管理卡、`result-focus` 位于父 pane 内，既有 pane 注册会排除嵌套元素；改用仓库既有 `data-glass-relief` 在父 pane 上局部压纹，避免嵌套玻璃与滚动裁剪错位。
4. **CSS 降级用 9px 方阵**：CSS 无法表达 45° 微透镜；45° 与真实位移只在 WebGL 路径。降级态 tier 3 统一强度，不按 0.20/0.35 等比例缩放。
5. **登录卡浅色 0.48** 是按 L3 深浅比例从 0.35 推导，规格只明示深色 0.35。
6. **WebGL 激活时 CSS `--glass-relief` 归零**：既有 primary button/选中导航的 CSS 网点不再与 WebGL 叠加，选中态改由填充/渐变表达；这是“WebGL 唯一真实来源”的实施取舍。
7. **未分级表面折射保持 32px**：避免未授权削减既有边缘光学；四档表格值只作用于已迁移的 tier 3 表面。后续若要全面应用 L0–L2 折射，需要另做一轮表面分级。

### 11.5 遗留

- 移动端真机与跨浏览器（Safari/Firefox）验收未做，不能声称通过。
- 未做严格帧率基线/GPU 计时；若后续掉帧，优先降 `--glass-refract-3` 而不是关点阵。
- 棱镜条纹（fluted）仍保留为预览页可选项、未启用；AI 状态条波纹与登录首屏品牌时刻仍属后续。
- 未提交、未推送、未合并、未部署；未调用付费模型。验证账号、状态目录与截图都在 gitignored 的 `output/glass-texture-verify/`。
