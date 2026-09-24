# 同伴 AI 编码任务说明：P0 分析结果页

> 任务角色：前端实现与验收
>
> 目标：在不改变后端分析契约的前提下，完善分析页面的结果展示、图表可读性、状态反馈和窄屏体验。
>
> 当前基线：从当前 `main` 分支创建个人分支，不直接提交 `main`。

## 0. 给 AI 编码助手的执行指令

你是本项目的前端协作者。请先阅读以下文件，再开始修改：

1. `AGENTS.md`
2. `docs/architecture.md`
3. `docs/ai-tools.md`
4. `docs/demo-questions.md`
5. `lib/analysis/types.ts`
6. `app/page.tsx`
7. `components/analysis-chart.tsx`
8. `app/globals.css`

本任务只实现 P0 前端质量，不扩展产品范围。每次修改后运行类型检查和测试；完成前必须运行完整验收命令。

如果发现后端返回字段不足，请先适配现有字段，或向主开发者提出接口建议；不要擅自修改 `AnalysisPlan`、DuckDB 查询或 API 返回结构来迁就页面。

## 1. 产品目标

本页面用于展示“受控指标 → 确定性统计 → 图表/表格 → 可追溯查询”的结果。

用户必须能看懂以下信息：

- 当前分析的指标和分组维度；
- 每个分组的数值、单位和样本数；
- 数据集、统计周期、查询耗时；
- 空结果、请求失败、数据集缺失和加载中的状态；
- 指标口径和只读 SQL；
- 图表之外的表格核对出口。

视觉应保持当前项目的克制、专业、浅色管理台风格。优先保证读数准确和状态清晰，不添加营销式 Hero、装饰性渐变、复杂动画或新的 UI 框架。

## 2. 严格的修改范围

### 允许修改

- `app/page.tsx`
- `components/analysis-chart.tsx`
- `app/globals.css`
- 必要时新增 `components/analysis-result-table.tsx` 或同级的纯前端展示组件
- 与前端行为直接相关的测试文件（如果确实需要）

### 默认禁止修改

- `lib/analysis/types.ts`
- `lib/analysis/plan.ts`
- `lib/analysis/metrics.ts`
- `lib/analysis/duckdb.ts`
- `lib/analysis/golden-cases.ts`
- `lib/ai/`
- `app/api/`
- `package.json` 和锁文件
- `next.config.ts`
- 数据文件、指标定义和 Docker 配置

只有主开发者明确同意，才可以修改默认禁止的文件。不要引入新的状态管理、图表库、CSS 框架、图标库或网络服务。

## 3. 已冻结的后端契约

### `POST /api/analysis`

请求是 `AnalysisPlan v1`，页面当前可使用的字段如下：

```ts
{
  version: 1,
  datasetId: "demo" | "oulad",
  metric: "score" | "activity" | "completion_rate",
  aggregation: "avg" | "sum" | "rate",
  dimensions: ("course" | "term")[],
  filters: [],
  sort: { by: "value" | "dimension", direction: "asc" | "desc" },
  limit: number,
  chartType: "line" | "bar" | "table"
}
```

成功响应包含：

```ts
{
  plan: AnalysisPlan,
  result: {
    datasetId: "demo" | "oulad",
    dimension: "course" | "term",
    chartType: "line" | "bar" | "table",
    rows: Array<{
      dimension: string,
      value: number,
      sampleSize: number
    }>,
    unit: string,
    metricLabel: string,
    period: string,
    query: string,
    durationMs: number
  }
}
```

失败响应当前是 `{ error: string }`，HTTP 状态码不是 2xx。页面不得假设错误响应有固定的额外字段。

### `POST /api/ask`

固定问题不需要模型即可运行。成功响应在上述结果之外包含：

```ts
planning: {
  source: "golden_case" | "openai",
  rationale: string,
  matchedCaseId: string | null,
  model: string | null
}
```

页面应继续支持以下错误码的现有行为：`AI_NOT_CONFIGURED`、`CLARIFICATION_REQUIRED`、`INVALID_QUESTION` 和通用错误。不要在前端伪造 AI 结果或自行计算指标。

## 4. 必须完成的功能

### 4.1 结果标题和摘要

- 标题同时包含指标名称和分组维度，例如“平均成绩 · 按课程”。
- 数值显示单位，例如 `79.67 分`、`186 次`、`83.33 %`。
- 结果摘要显示分组数、查询耗时和统计周期。
- 不把第一行结果误称为“最高”或“最佳”，除非页面明确展示了排序方向；默认只称为结果摘要。
- 当结果为空时，不显示伪造的 headline 数值。

### 4.2 图表

只支持现有三种展示方式：

- `bar`：比较课程或学期的单项指标；
- `line`：展示有序分组变化；
- `table`：展示可核对的原始聚合结果。

图表要求：

- 标题或上下文必须说明指标、维度和单位；
- Tooltip 显示分组、数值、单位和样本数；
- 坐标轴标签在窄屏和长文本下不能互相覆盖；
- 图表容器有稳定高度，不能因加载、空数据或切换图表而跳动；
- 组件卸载时必须移除 resize 监听并释放 ECharts 实例；
- `rows.length === 0` 时不初始化空图表；
- 不用平滑曲线掩盖数据波动，不增加 3D、饼图、热力图、面积图等未冻结类型。

### 4.3 表格替代视图

- `table` 模式必须显示完整分组、样本数、数值和单位；
- 表头使用真实的 `<th>`，表格包含 `<caption>` 或等价的可访问名称；
- 图表模式也应提供“查看数据表”入口，或至少保证页面可以切换到 `table` 模式核对数据；
- 不展示原始学生记录，只展示后端返回的聚合行。

### 4.4 状态处理

至少覆盖：

- 初次加载数据集画像；
- 正在生成分析计划；
- 正在执行查询；
- 数据集不可用；
- 请求失败；
- 没有满足最小样本阈值的结果；
- AI 未配置但固定问题可用；
- AI 需要澄清时显示后端返回的人话提示（如果当前页面还不能继续提问，至少不能吞掉错误信息）。

按钮在请求期间必须禁用，避免重复提交。失败后应恢复可操作状态，不能永久停留在 loading。

### 4.5 响应式和可访问性

- 支持至少 320px 宽度；页面不出现横向滚动；
- 桌面端保持当前双栏结构，窄屏端自然堆叠；
- 所有输入、选择框和按钮有可关联的 label 或可访问名称；
- 键盘可以完成输入、提交、选择固定问题和查看结果；
- `focus-visible` 状态清晰；
- 颜色不能是唯一的信息来源，错误和状态应有文字；
- 动画应简短，尊重 `prefers-reduced-motion`。

## 5. 推荐实施顺序

按下面顺序逐步修改，避免一次性重写页面：

1. 先修正结果组件的数据展示和错误/空状态；
2. 再修正 `AnalysisChart` 的标题、tooltip、样本数和稳定尺寸；
3. 再补齐表格语义和图表到表格的核对入口；
4. 最后调整响应式 CSS、焦点样式和 reduced motion；
5. 对固定问题至少手动验证平均成绩、活跃次数、完成率各一条，课程和学期各一条；
6. 运行完整验收命令并检查 `git diff`，确认没有越界修改。

不要先重做整个视觉系统，也不要在本任务中实现上传、导出、KPI 卡、异常检测或自由 SQL。

## 6. 可接受的实现方向

优先复用当前代码结构：

- 继续使用 `useState`、`useEffect` 和现有 fetch 流程；
- 继续使用 ECharts，不封装与当前需求无关的通用框架；
- 可以把表格拆为小组件，但保持 props 以 `AnalysisResult`/`AnalysisRow` 为主；
- 可以增加小型的显示辅助函数，例如格式化数值、指标标题和错误文案；
- 页面层负责交互状态，分析层负责真实计算，组件层不重复计算指标；
- 所有数值都来自 API 响应，前端只负责格式化和展示。

## 7. 验收标准

### 自动检查

在仓库根目录执行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

三个命令必须成功。不得通过关闭 TypeScript 检查、跳过测试或扩大 `any` 类型来绕过问题。

### 手动检查

启动开发服务：

```bash
pnpm dev
```

在浏览器检查：

1. 选择模拟校园数据；
2. 运行“哪门课程平均成绩最高？”；
3. 运行“各学期学习活跃次数如何？”；
4. 切换柱状图、折线图和表格；
5. 检查单位、样本数、周期、查询耗时和 SQL 溯源；
6. 在窄屏宽度下检查无横向溢出；
7. 临时输入无效问题，检查失败提示和按钮恢复；
8. 确认 AI 未配置时固定问题仍可完整运行。

### Git 检查

提交前执行：

```bash
git status --short
git diff --check
git diff --stat
```

提交应只包含前端任务相关文件。建议提交信息：

```text
feat: 完善分析结果页与图表验收
```

提交说明必须包含：改动摘要、自动检查结果、手动验证的问题、是否有未解决风险。

## 8. 明确不做的事情

- 不改指标公式、SQL、最小样本阈值或 golden case 基准；
- 不让模型直接生成 SQL 或数字；
- 不加入真实学生数据、API 密钥或上传服务；
- 不新增数据库、状态管理库、UI 框架或图表库；
- 不实现个体排名、个体风险名单或高影响教学决策；
- 不为了视觉效果改变 API 字段含义；
- 不把“看起来更漂亮”作为牺牲读数准确、可访问性或测试通过的理由。

## 9. 完成回报模板

完成后向主开发者回报：

```text
已完成前端 P0 结果页任务。

改动文件：
- ...

实现内容：
- ...

验证结果：
- pnpm typecheck: PASS/FAIL
- pnpm test: PASS/FAIL
- pnpm build: PASS/FAIL
- 手动验证问题：...

未解决问题或风险：
- 无 / ...
```
