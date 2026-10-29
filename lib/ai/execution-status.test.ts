import { describe, expect, it } from "vitest";
import type { AnalysisStep } from "./chat-types";
import { executionStatus } from "./execution-status";

const step = (status: AnalysisStep["status"], label = "查询统计"): AnalysisStep => ({
  id: label,
  label,
  status,
  durationMs: 100,
});

describe("execution status reflects observed work", () => {
  it("stays running before the first event and between completed tools", () => {
    expect(executionStatus([], true).state).toBe("running");
    expect(executionStatus([step("completed")], true)).toMatchObject({
      state: "running",
      completed: 1,
    });
  });

  it("uses the latest actual running label without changing the event list", () => {
    const steps = [step("completed", "读取课程"), step("running", "检索指标定义")];
    expect(executionStatus(steps, true)).toEqual({
      state: "running",
      label: "检索指标定义",
      completed: 1,
    });
    expect(steps[0].label).toBe("读取课程");
  });

  it.each(["failed", "cancelled"] as const)("never turns %s into success", (status) => {
    expect(executionStatus([step("completed"), step(status, "后续步骤")], false).state).toBe(
      status,
    );
  });

  it("distinguishes an interrupted stream and a partial answer from completion", () => {
    expect(executionStatus([step("running")], false).state).toBe("interrupted");
    expect(executionStatus([step("completed")], false, "partial").state).toBe("partial");
    expect(executionStatus([step("completed")], false, "complete").state).toBe("completed");
  });
});
