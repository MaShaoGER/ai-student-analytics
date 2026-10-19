# AI 统一对话第四步：回归、用量与本地验收（实施记录）

实施日期：2026-10-19。分支：`codex/competition-phase2`。本轮实施[统一对话路线图](unified-ai-workflow-roadmap.md)的**第 4 步「回归、用量与本地验收」**，并与同轮的[第 3 步](unified-ai-step3.md)一起验收。改动只在本地，未推送、未部署。

## 本轮做了什么

### 1. 请求级 token / 费用关联

- `lib/security/ai-cost.ts` 新增 `RequestUsage = { modelCalls, promptTokens, completionTokens, totalTokens, costUsd, estimated }`；`CostRecord` 增加可选 `requestId`；`settleBudget()` 增加可选 `meta: { requestId }`，把每次真实模型调用写入费用历史时关联到请求。
- `lib/ai/tool-provider.ts`：`generateToolTurn` 在每次真实模型调用（成功与失败）的 `finally` 中累计同一个 `usageContext`，并带 `requestId` 结算；预算预留/结算逻辑不变。
- `lib/ai/unified.ts`：一次 `converseUnified` 创建唯一的 `usage` 累计器，贯穿所有工具轮，并透传路由生成的 `requestId`；`ChatResponse` 增加 `usage` / `requestId`（部分完成路径同样返回已产生用量）。
- `app/api/chat/route.ts`：每个 POST 生成一个 `crypto.randomUUID()` 请求 id，写入成本记录、审计记录和响应；SSE 帧自带的 `requestId` 不变（帧级 id 与请求级 id 各司其职）。
- `lib/records/index.ts` + `lib/analysis/types.ts`：分析审计新增 `requestId` 与 `usage` 的持久化，**写入前做形状与范围校验**（非法形状直接丢弃、不抛异常）；仍不保存问答正文、模型正文或原始行。
- 已知缺口：请求在产生 `ChatResponse` 之前就抛错的路径（如参数错误、目录不可用）审计里有 `requestId`，但拿不到 `usage`；要补齐需要把路由创建的 usage 容器下沉到 `converse`，留作后续改进。

### 2. 重建统一对话评测

第一阶段"模拟规划器"夹具已随第 1 步退役。本步新增：

- `scripts/ai-eval-unified.test.ts`（默认跳过，离线无网络）：
  - `AI_EVAL_UNIFIED_MOCK=1`：脚本化工具轮 + 真实 DuckDB（`data/sample`），验证工具接线、`resultRefs`/`factRefs` 契约、自然回答绑定、缺勤口径、usage/requestId 聚合；7 项协议/接线检查。
  - `AI_EVAL_UNIFIED=1`：真实配置模型 + 真实 DuckDB，**7 个场景**（直接回答、聚合+自然回答、连续追问继承、**学期比较+自然回答**、明确图表、缺勤、知识引用），报告写 `output/ai-eval/unified-live-<ts>.json`，每场景含 kind/artifacts/resultRef 数/usage/cost/耗时/失败检查项。
- `scripts/ai-eval/unified-scenarios.ts`：报告结构、事实绑定检查、编造数字检查（先剔除列表编号/引用编号/目录标签；**全角数字与中文数字也算未核验**）、自然回答 vs 模板检查、usage 一致性检查。检查规则在审查后收紧：数字必须**整 token 精确匹配**事实/知识文本（不再用子串包含），语料不再包含 artifact 原始行，移除了"答案点名真实课程即算接地"的放宽。
- `package.json` 新增 `eval:ai:unified`、`eval:ai:unified:mock`；`docs/ai-eval-cases.md` 增加统一对话评测说明。
- 报告是本地 `output/ai-eval/`（gitignored），不是 CI 门禁；真实模式产生费用并受现有预算限制。

### 3. 回归与真实模型验收

- 受控门禁：`pnpm typecheck` 通过；`pnpm test` **580 通过 / 61 跳过**（含第 3 步统一入口测试、上下文标签与审计字段测试）；`pnpm test:api` **25 项通过**；隔离生产构建通过（见下"验证证据"）。
- 统一对话真实评测（qwen3.7-flash）：最新一次 **7/7 场景通过**（报告 `output/ai-eval/unified-live-2026-10-19T07-41-50-246Z.json`）：报告内 14 次模型调用、$0.0489；该次运行 cost-history 实际 **16 次 / $0.0558**（多出的 2 次为 follow-up 场景前置请求，报告未收录）。过程真实暴露并修复了 5 类问题：缺勤逐门调用/混入活动量、定义问题不检索知识库、评价性结论不引用事实、图表事实文本与 `factRefs` 不一致、模型自写数字导致整段回退（改为"仅占位符 + 一次修正重试"）。期间有一次 6/7（比较场景只剩定性句），强化提示后恢复；**单次通过率存在波动，不是稳定结论**。
- 第二阶段工具循环真实回归：**3/3 通过**（`output/ai-eval/phase2-2026-10-19T06-37-12.060Z.json`，报告 6 次调用、$0.0204；另有工具探针 2 次约 $0.0007 不在报告内，整轮约 8 次 / $0.0211）。
- 既有 30/48 题真实评测（`pnpm eval:ai`，走旧 `/api/ask`）：**21/30 通过、9 项未通过**（`free-04/07/10`、`boundary-01/02/03/04/08/10`，多为"期望澄清、实际直接回答"）。该路径本轮未改动，差异只能归因于当前模型行为或既有夹具期望；**不能宣称该套件通过**，也不能把它的失败归因于本轮代码。统一入口的验收以 `eval:ai:unified` 为准。

### 4. 浏览器验收（系统 Chrome + DevTools Protocol，不新增 Playwright 依赖）

- **Phase A（AI 关闭、`data/fixtures/golden`、隔离账号与状态）：15/15 通过**——无模式控件、golden 问题返回 79.67 与事实编号、"改成表格"本地切换、输入区收起/展开草稿与焦点、loading 时禁用收起、390px/320px 无横向溢出、0 控制台错误、0 模型调用。
- **Phase B（真实 qwen3.7-flash、`data/sample`、隔离拷贝真实配置）：主链路通过**——真实 SSE（10 个 step 帧 + result）、执行步骤逐条完成、哑铃图渲染、追问继承范围、390px 无溢出、0 控制台错误；首轮 17 项中 14 项通过、2 项为 chart/studio 的 `factId` 已知限制（无阻塞失败）。
- **根因修复后聚焦复验：7/7 通过**——比较类问题的自然回答保留数字（72.72/69.65/3.07，`warning=null`），"数字从哪来"显示 `f-819eaae5381f6c35` 精确绑定比较句；追问「只看2025J」不再回退模板并显示 `f-6780784f4fb3233f`。修复内容：`artifact-results.ts` 的 studio 计数事实文本与 `toolFacts()` 对齐；`unified.ts` 为学期比较结论生成与展示文本一致的 `FactRef`。
- 注意：该聚焦复验早于审查后的"只接受占位符"最终收紧；之后未再重跑浏览器，但真实评测已新增同一条比较路径的服务端场景并 7/7 通过。浏览器证据证明的是 UI/SSE/交互与事实编号显示，不替代最终语义正确性验收（见第 3 步已知限制 1）。
- 复验费用：两次请求、4 次模型调用、$0.013868（`usageEstimated=false`，requestId/usage 均落盘）。
- 报告与截图在本地 `output/browser-verify/`（gitignored），复现命令见报告"启动方式"节。残余：无数字的限制说明仍不显示编号（按设计）。浏览器验收观察到的"追问 chip 显示 Web前端开发 等 18 项、像用户条件"已在收尾中改为"共 18 门课程（含 Web前端开发）"这类数据范围表述，未再重跑浏览器。

## 验证证据

### 通过

- `pnpm typecheck`：通过。
- `pnpm test`：**580 通过 / 61 跳过**（第 1 步收尾为 561/61；本轮新增自然回答/占位符绑定/修正重试、展示参数、usage 聚合与事实绑定、上下文标签与审计字段测试）。
- `pnpm test:api`：25 项通过（隔离账号与配置，AI 调用关闭）。
- 隔离生产构建：通过；`next-env.d.ts` / `tsconfig.json` 生成改动已还原。
- `AI_EVAL_UNIFIED_MOCK=1 pnpm exec vitest run scripts/ai-eval-unified.test.ts`：7 项通过、7 项跳过。
- `pnpm eval:ai:unified`：最新一次 7/7 场景通过；报告 14 次模型调用、$0.0489（整轮实际 16 次 / $0.0558，含未入报告的 follow-up 前置请求）。
- `pnpm eval:ai:phase2`：3/3 场景通过；报告 6 次调用、$0.0204；整轮含探针约 8 次 / $0.0211。
- 浏览器验收：见下节。

### 真实模型成本（单次运行，按实际 usage 结算）

| 套件 | 模型调用次数 | 费用（USD） | 报告 |
| --- | --- | --- | --- |
| 统一对话 live（7 场景，报告内） | 14 | 0.0489 | `output/ai-eval/unified-live-2026-10-19T07-41-50-246Z.json` |
| 统一对话 live（整轮实际，含 follow-up 前置） | 16 | 0.0558 | 由 `records/system/cost-history.json` 按时间窗汇总 |
| 第二阶段 live（报告内 3 场景） | 6 | 0.0204 | `output/ai-eval/phase2-2026-10-19T06-37-12.060Z.json` |
| 第二阶段 live（整轮含工具探针） | 8 | ≈0.0211 | 探针 2 次约 $0.0007 不在报告内 |
| 既有 30 题 live（/api/ask） | 30 次对话 | 见 cost-history | 未逐题记录费用 |

说明：评测迭代过程中还运行过多次真实评测（用于暴露与修复问题），这些调用同样计入 `records/system/cost-history.json`；上表只列最终一次验收。费用为按配置单价与 usage 的估算，不反映服务商折扣或最终账单。

## 与路线图第 4 步完成标准的关系

| 完成标准 | 本轮状态 |
| --- | --- |
| 有可追溯的成功与失败记录 | 有：`output/ai-eval/unified-*.json`（逐场景 checks）、`phase2-*.json`、浏览器报告；经 `/api/chat` 路由发起的模型调用在 cost-history 带 `requestId`，审计记录带校验后的 `requestId` + `usage`（由 `app/api/chat/route.test.ts` 与 `lib/records/records.test.ts` 覆盖；评测/探针直连调用可能没有 requestId） |
| 数值核对 | 受控测试对固定数据集逐值断言；真实评测用真实 DuckDB 结果与 `factId` 绑定检查，不硬编码模型输出数值 |
| 实际调用成本 | 统一 live 报告 14 次/$0.0489（整轮 16 次/$0.0558）、phase2 报告 6 次/$0.0204（整轮含探针 8 次/≈$0.0211）、浏览器聚焦复验 4 次/$0.013868，均来自实际 usage 结算 |
| 真实模型、多轮浏览器验证 | 真实模型：统一最新一次 7/7（期间有一次 6/7 波动）、phase2 3/3（小样本，非准确率结论）；浏览器：Phase A 15/15、Phase B 主链路通过 + 聚焦复验 7/7（聚焦复验早于最终"仅占位符"收紧，未重跑浏览器） |
| 更新实施状态 | 本文与 [第 3 步](unified-ai-step3.md)、[路线图](unified-ai-workflow-roadmap.md)、`DEV_STATE.md` 已同步 |

## 已知限制

1. **硬失败路径无请求级 usage**：`ChatResponse` 生成前的异常只有 `requestId`，没有 `usage`；共享 usage 需要从路由下沉到执行入口。
2. **真实评测是小样本且会波动**：单模型（qwen3.7-flash）、单数据源（`data/sample`）、7 场景；提示词与评测检查项都依据这些真实失败样本迭代/收紧过，最终代码下仍出现过一次 6/7，不能当成泛化准确率或"一次通过"。报告不收录 follow-up 场景的前置请求用量，成本需结合 cost-history 时间窗核对。
3. **既有 30 题真实评测未通过项未消除**：9 项失败如实记录（含隐私/边界类），本轮没有修改断言或伪造字段使其通过；需要后续单独定位是模型行为漂移还是夹具期望需要更新。
4. **浏览器验收使用系统 Chrome + CDP 脚本**，不是项目依赖内的 Playwright，因此不能在 CI 复跑；截图与报告在本地 `output/browser-verify/`（gitignored），不随仓库分发。聚焦复验跑在最终"仅占位符 + 修正重试"收紧之前，浏览器端最终语义未重新验收。
5. **成本关联的粒度是请求**：成本历史仍按每次模型调用一条记录，用 `requestId` 聚合；没有单独的"请求级汇总表"。
6. **评测不是 CI 门禁**：`eval:ai:unified` 默认跳过，需要显式开启；真实模式产生费用。
