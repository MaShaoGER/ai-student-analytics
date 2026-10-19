# AI 统一对话第一步：统一入口和上下文（实施记录）

实施日期：2026-10-19。分支：`codex/competition-phase2`。本轮只实施[统一对话路线图](unified-ai-workflow-roadmap.md)的**第 1 步「统一入口和上下文」**；第 2 步此前已完成（见[第二阶段实施记录](unified-ai-phase2.md)），第 3、4 步未实施。改动只在本地，未推送、未部署；真实模型与浏览器验收未执行。

## 本轮做了什么

### 1. 单一执行入口（真正的模式合并）

- `app/api/chat/route.ts` 删除 `input.mode === "comprehensive"` 分派，只有一条执行路径：`converse(input, …)`。是否流式只由请求头 `Accept` 决定（SSE 或 JSON），不是两种工作模式。
- `lib/ai/chat-types.ts` 删除 `chatInputSchema.mode`（原 `quick` / `comprehensive`）。旧客户端即使继续发送 `mode` 也会被忽略，不会报错。
- 删除旧的 JSON 规划器分支：`converse` 不再调用 `generateStructured`、`resolvePlan`、`CHAT_PLANNING_PROMPT` / `CHAT_EXPLANATION_PROMPT`，也不再做"规划一次、执行一次、解读一次"的两次模型调用。相应文件 `lib/ai/resolve-plan.ts`、`lib/ai/prompts/conversation.ts` 已删除；`response-presentation.ts` 中只服务旧规划器的 `chooseAnalysisView`、`sanitizeExplanation` 一并删除。
- `lib/ai/comprehensive.ts` 收敛为 [`lib/ai/unified.ts`](../lib/ai/unified.ts)：`converseUnified`、`UnifiedDependencies`、`UnifiedConversationError`。统一入口内部按顺序执行：
  1. 纯展示型追问（"改成表格""按10分一档""改成柱状图"）基于已确认上下文本地重算展示，不调用模型；
  2. 其余问题走统一工具循环，由 AI 决定直接回答、查询统计、检索资料或生成图表；
  3. 模型完全不可用时，回退到确定性本地能力（见第 4 点）。
- 前端：`components/workspace.tsx` 删除 `analysisMode` state，`/api/chat` 固定请求 SSE、请求体不再含 `mode`；`components/ai-conversation.tsx` 删除"普通问答 / 综合分析"分段控件与提示文案；`components/ai-conversation.module.css` 删除对应样式。管理页把"综合分析"设置文案改为"AI 对话分析"，如实说明它现在约束整个统一对话。

### 2. 按真实角色传历史 + 结构化上下文

`converseUnified` 现在发送的是：

```text
[ system INSTRUCTIONS,
  ...history 逐条按真实 user / assistant 角色原样传递,
  user = JSON { question, datasetId, confirmedContext?, catalog, requestedComparison?, previousResults? } ]
```

- 不再把 `{...input, catalog, requestedComparison}` 连同历史整体 `JSON.stringify` 成一条 user 消息。
- 客户端 assistant 历史消息最多附 4 条受控结果摘要 `{ resultId, kind, label }`；`chatInputSchema` 校验 `resultId` 形状、`kind` 枚举（`RESULT_KINDS`）、label 长度、每条消息上限、总历史 12 条，并禁止 user 消息携带结果引用。
- `previousResults` 只说明"上一轮结果的身份与范围"，提示词明确要求数字必须重新调用工具核验，不能当作结论证据。
- 提示词中不出现原始结果行、学生标识或名单；历史与工具返回都按数据处理。

### 3. 提示词与完成判定

- `INSTRUCTIONS` 重写为"能力 + 证据规则"：不再包含"先比较学期，再根据真实返回的 largestDecline 选择后续课程与 afterTerm"这类固定业务流程；`compare_terms` / `score_distribution` 的工具描述也删除了强制后续调用的说明。示例只说明能力，不规定执行顺序。
- 删除 `needsDistribution = /分布/.test(input.question)` 的关键词完成判定与 `AI_TASK_INCOMPLETE` 失败码；不再用问题里的词判断任务是否完成。
- 删除"比较后若问题含'下降最多'则分布课程必须等于 largestDecline"的强制校验——它把固定流程写进了执行层；依赖工具之间的一致性交给 AI，由工具参数校验和真实评测兜底。
- 保留并继续生效：`explicitComparison`（用户明确写出两个学期时的方向纠正）、目录标签校验、重复工具调用检测、工具次数上限、缺勤单位/口径提示、金额预算与取消语义。
- **文本轮 = 直接回答**：模型没有调用任何工具的普通文本回复现在返回 `kind: "answer"`（正文上限 2000 字），不再一律落到"请明确要分析的指标"；只有 `clarify` 工具（或完全空的轮次）才是 `clarification`。
- 直接回答如果包含统计样数字（百分比、分数、人数等），会附加"本轮为直接回答，未调用统计工具，其中的数字未经统计核验"的 warning，而不是把模型口述当已验证事实。

### 4. 结果契约与降级路径

- 统一工具循环与本地路径都继续输出 `resultRefs` / `factRefs`；悬空事实仍会被剔除并给出 warning；缺勤 `unsupported` 结果仍不产出 `ResultRef`，只作为可解释的回答文本。
- 模型不可用（AI 关闭、未配置、未通过工具调用检测）时，`converse` 回退到既有确定性能力：精确 golden 预设（只在新一轮、无历史且无上下文时）与明确图表/关系问题的本地工具。`planning.source` 如实为 `golden_case` / `local`、`model: null`，不伪装成 AI 回答。
- 降级路径中图表工具抛出的 `ChartClarification`（如 OULAD 无出勤字段、未知学期 2099J）会转成正常的 `clarification` 回答；曾一度退化为 502，已在测试迁移过程中发现并修复。
- 取消/超时不会被本地兜底吞掉，仍按 `CANCELLED` / `TIMEOUT` 分类。

### 5. 独立审查后的修复

独立只读审查（未发现 Blocker）指出的问题已在本轮修复并补测试：

- **回答来源说明如实化**：`planning.rationale` 原来无条件写"通过标准工具调用执行受控多步分析，数字与引用由服务端核验"，即使本轮只是直接回答或知识检索。现在按实际路径生成：工具结果 / 知识库引用 / 知识不足 / 直接回答（明确"数字未经统计核验"）/ 无结果，UI 下的"分析方式"说明不再谎称调用了工具。
- **未核验数字识别加强**：原先只匹配"80% / 72 分"等少数写法，"均分大约 73。""提升了 3 个百分点。""共返回 18 个分组。""人数从 120 增加到 134。""比例约为 0.8" 都能绕过。现在先剔除真实目录标签（如 `2024J`），剩余文本只要出现阿拉伯/全角数字就附加"未经统计核验"warning，并用 6 种真实表述补了回归测试。
- **长回答截断提示**：直接回答超过 2000 字会截断，现在同时给出"回答较长，已截断"提示。
- **history 长度保护**：服务端 schema 限制单条历史 3000 字；客户端发送前把超过 2900 字的回答截断并注明，避免一轮多结果长回答导致下一轮 400。
- **无模型时推荐问题**：没有模型时"推荐问题"只在空对话中提供（中途隐藏），首页"试着问问"入口改为以新对话发起，避免在有上下文时点击预设得到 503。
- **数据源错误不被误报**：本地回退只把"目录不可用"当作无本地图表能力；`DATA_SOURCE_UNAVAILABLE` / `CANCELLED` / `TIMEOUT` 等真实查询错误保持原分类，不再统一误报为 `AI_NOT_CONFIGURED`。
- 其他：user 消息携带空 `results: []` 不再被拒；`AI 生成分析计划` 标签改为 `AI 对话分析`；隐私说明与测试文案同步。

### 6. 关联改动

- cost-history 的 endpoint 标签由 `comprehensive` 改为 `chat`（历史记录保留旧标签）。
- 提示词版本 `2026-10-19.1` → `2026-10-19.2`。
- **退役第一阶段的"模拟规划器"评测夹具**：`scripts/ai-eval-phase1.ts`、`scripts/ai-eval/phase1-cases.jsonl`、`scripts/ai-eval-phase1.test.ts`。它评测的 JSON 规划器已被删除，保留等于继续维护第二套规划器；原 30/48 题真实评测套件 `scripts/ai-eval.test.ts`（`/api/ask`）不受影响。`eval:ai` / `eval:ai:mock` 现在只跑该套件。统一对话的模拟/真实评测需在第 4 步重建。
- `lib/ai/suggested-questions.ts` 注释与 `docs/architecture.md` 同步：固定问题只在模型不可用时作为降级路径。

## 验证证据

### 通过

- `pnpm typecheck`：通过。
- `pnpm test`：**561 通过 / 61 跳过**。上一轮基线为 591 通过 / 73 跳过；净变化来自：删除被统一入口取代的旧规划器与旧"综合分析"测试、裁剪 `response-presentation` 中被删除的函数测试、退役第一阶段模拟规划评测夹具（含 12 项默认跳过），新增 33 项统一入口测试（历史角色/结构化上下文/直接回答/关键词判定移除/契约/配置门禁）。
- `pnpm test:api`：**25 项通过**（隔离账号与配置，AI 调用关闭）。覆盖：无 AI 时 golden 预设与"改成表格 / 按10分一档"本地路径仍返回 200、未配置模型时 SSE 终止事件为 `AI_NOT_CONFIGURED`、管理设置接口权限、审计不含对话正文。
- 隔离生产构建（`NEXT_DIST_DIR=.next/unified-stage1-verify pnpm build --webpack`）：通过；`next-env.d.ts` / `tsconfig.json` 的生成改动已还原。
- 新增/改写的关键测试：
  - `lib/ai/unified.test.ts`（33）：真实 DuckDB 多步分析、历史按角色与结构化上下文（含 previousResults 归一）、非法结果摘要被拒、文本轮=直接回答、clarify 工具仍追问、关键词完成判定已移除、显式学期方向纠正、重复/未知工具、工具上限、预算、取消、超时、缺勤口百分比、分布下推参数、结果事实与 `factId` 绑定。
  - `lib/ai/conversation.test.ts`（8）：单入口 + 降级路径（golden 预设、展示型追问、显式图表/关系问题、OULAD/未知学期的 clarification、模型不可用且无本地能力时抛出配置错误）。
  - `lib/ai/chart-capabilities.test.ts`（13）、`lib/ai/artifact-results.test.ts`（13）：本地图表能力、同一 `resultId`、typed 追问零模型调用。
  - `lib/settings/settings.test.ts`：用真实 `generateToolTurn` + 真实 DuckDB 验证 Responses / Chat Completions 两种协议的工具轮、用量结算与 cost-history `["chat","chat"]`。

### 未执行（不得声称已完成）

- **真实模型验收未执行**：统一入口的提示词与"文本轮=直接回答"逻辑只经过受控测试；未调用真实模型确认直接回答、工具选择与连续追问质量。
- **浏览器验收未执行**：Playwright 不在项目依赖内；本轮只做到隔离生产构建，未在真实浏览器点击验证模式控件移除后的布局、SSE 步骤展示与展示型追问。
- `pnpm eval:ai`（真实 30/48 题）与 `pnpm eval:ai:phase2`（真实统一工具循环）未运行。
- 第 3、4 步未实施：AI 最终解释与事实绑定、"数字从哪来"之外的界面精简、输入区收起与草稿保留、请求级 token/费用关联。

## 与路线图第 1 步完成标准的关系

| 路线图要求 | 本轮状态 |
| --- | --- |
| 收敛 API 执行入口 | 已实现：`/api/chat` 只有 `converse` 一个入口，无 mode 分派 |
| 按真实角色传历史 | 已实现：user/assistant 原样按角色传递，旧 JSON 打包删除 |
| 保留相关结果与条件 | 已实现：`confirmedContext` + `previousResults`（受控摘要），数字仍需工具重查 |
| 移除特定比较流程提示 | 已实现：INSTRUCTIONS 与工具描述无固定步骤；关键词完成判定与强制工具顺序已删除 |
| 同一入口可直接回答、查询数据和连续追问 | 已实现（受控测试 + 本地 HTTP 测试）；真实模型质量未验收 |
| 不再依赖模式选择或关键词派发 | 模式选择已删除；正常模式下由 AI 决定工具。关键词推断只保留在"模型不可用"的降级路径 |

## 已知限制

1. 统一工具循环的 `aggregate` 工具没有 `view` / `sort` / `limit` 参数，因此一句"用表格显示各课程平均成绩"仍先返回图表，需要下一句"改成表格"（本地展示追问）切换。第 3 步处理自然回答与展示时一并补齐。
2. 直接回答中的数字只加 warning、不做数值核验；`factId` 绑定只覆盖工具结果生成的文本。第 3 步的"AI 最终解释 + 事实引用"会把结论数字绑定到 `factId`。
3. 降级路径仍使用关键词推断（如"缺勤…关系"→本地密度图），但仅在 AI 不可用时生效；AI 可用时由模型选择工具。
4. 未实现请求级 token/费用关联：每轮模型调用分别记账，同一次提问的多轮调用只能按时间窗口和 endpoint 汇总（第 4 步）。
5. 数据集版本仍是静态声明版本（第 2 步已知限制未变）。
6. 无模型时知识检索与自由问答不可用；可用的是精确预设、明确图表/关系问题和已有结果的展示切换。
7. 历史结果摘要只带身份与范围，不带数值；模型需要重新查询才能给出数字，这是有意的证据边界。
8. 第一阶段"模拟规划器"评测夹具退役后，统一对话暂无专用模拟评测；第 4 步应重建为工具调用模拟/真实评测，不能以本轮测试替代真实模型验收。

## 主要文件

- 入口与契约：`app/api/chat/route.ts`、`lib/ai/chat-types.ts`、`lib/ai/conversation.ts`、`lib/ai/unified.ts`、`lib/ai/result-facts.ts`、`lib/ai/result-contract.ts`
- 提示词与工具说明：`lib/ai/unified.ts`（`INSTRUCTIONS` / `descriptions`）、`lib/ai/prompts/version.ts`
- 界面：`components/workspace.tsx`、`components/ai-conversation.tsx`、`components/ai-conversation.module.css`、`components/analysis-controls.tsx`
- 测试：`lib/ai/unified.test.ts`、`lib/ai/conversation.test.ts`、`lib/ai/chart-capabilities.test.ts`、`lib/ai/artifact-results.test.ts`、`app/api/chat/route.test.ts`、`lib/api/api-integration.test.ts`、`lib/settings/settings.test.ts`、`scripts/ai-eval-phase2.test.ts`
- 删除：`lib/ai/comprehensive.ts`、`lib/ai/resolve-plan.ts`、`lib/ai/prompts/conversation.ts`、`scripts/ai-eval/phase1.ts`、`scripts/ai-eval/phase1-cases.jsonl`、`scripts/ai-eval-phase1.test.ts`