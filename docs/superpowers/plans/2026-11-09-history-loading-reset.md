# 会话历史加载状态修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 防止历史请求被 generation 作废后，历史抽屉仍显示“正在读取历史”。

**Architecture:** 在 `components/workspace.tsx` 内集中失效历史请求并清理其 loading/selection 状态；所有递增 `historyGeneration` 的会话失效入口共用此操作。打开历史对话后仍可开启其独立的选择中状态。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest，现有真实浏览器验证工具。

**Spec:** `docs/superpowers/specs/2026-11-09-history-loading-reset-design.md`

## Global Constraints

- 不改 API、URL、会话存储、权限或数据口径。
- 不拆组件或修改其他已知问题。
- 保留 generation 守卫与现有请求取消行为。
- 不提交、推送或部署。

## Review Focus

- 历史请求执行中切换数据源时，加载提示必须结束，迟到响应不得覆盖新状态。
- 历史请求执行中触发 fresh ask 时，加载提示必须结束，新的对话发送状态正常。
- 选择历史对话必须在取消旧列表加载后进入选择中状态，并在选择完成后结束。
- 登录范围变化与退出必须清空旧历史状态，不得继承旧账号加载标记。
- 普通刷新及分页成功/失败仍由当前 generation 的 finally 清除 loading。

---

### Task 1: 统一失效处理并验证

**Files:**
- Modify: `components/workspace.tsx`

**Interfaces:**
- Internal helper in `Workspace`: `invalidateConversationHistory(): void`; increments `historyGeneration`, clears `historySelectionPending`, `historySelecting`, and `historyLoading`.

- [ ] **Step 1: Capture a failing browser reproduction**

Use a fully mocked synthetic browser session. Before the fix, delay `GET /api/conversations`, refresh, then change data source; confirm the drawer remains at “正在读取历史…”.

- [ ] **Step 2: Implement the shared invalidation helper**

Replace every direct `historyGeneration.current++` in `components/workspace.tsx` with the helper. Where an entry deliberately starts selecting a conversation, set `historySelectionPending`/`historySelecting` after invalidation as it does today.

- [ ] **Step 3: Verify the browser paths**

Repeat delayed refresh + data source change; confirm loading text disappears immediately and the late list response is ignored. Fresh ask was not verified because the browser mock failed to intercept its stream request; do not use a logged-in session as test data.

- [ ] **Step 4: Run focused static verification**

Run the repository TypeScript check using its pinned Node runtime. No existing automated test covers this Workspace orchestration; do not add a test framework dependency.
