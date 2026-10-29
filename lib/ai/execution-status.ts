import type { AnalysisStep, ChatResponse } from "./chat-types";

export type ExecutionState = AnalysisStep["status"] | "interrupted" | "partial";

/** Status follows observed events; a quiet gap between tools is not completion. */
export function executionStatus(
  steps: AnalysisStep[],
  live: boolean,
  completion?: ChatResponse["completion"],
) {
  const completed = steps.filter((step) => step.status === "completed").length;
  const running = [...steps].reverse().find((step) => step.status === "running");
  const stopped = [...steps]
    .reverse()
    .find((step) => step.status === "failed" || step.status === "cancelled");
  const state: ExecutionState = stopped
    ? stopped.status
    : live
      ? "running"
      : running
        ? "interrupted"
        : completion === "partial"
          ? "partial"
          : "completed";
  const label =
    state === "failed"
      ? "分析未完成"
      : state === "cancelled"
        ? "分析已停止"
        : state === "interrupted"
          ? "分析已中断"
          : state === "partial"
            ? "分析部分完成"
            : state === "running"
              ? (running?.label ?? "正在处理分析请求…")
              : "分析完成";
  return { state, label, completed };
}
