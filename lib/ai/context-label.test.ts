import { describe, expect, it } from "vitest";
import { describeChatContext, planningMethodLabel } from "./context-label";
import type { ChatIntent } from "./chat-types";

const toolIntent = (courses: string[]): ChatIntent => ({
  kind: "tool",
  tool: "density",
  courses,
  term: "2025J",
  comparisonTerm: null,
  threshold: 60,
  view: "chart",
});

describe("chat context label", () => {
  it("shows a short course list by name", () => {
    expect(describeChatContext(toolIntent(["数学", "英语"]))).toBe(
      "限定：2025J · 数学、英语 · 散点密度图",
    );
  });
  it("phrases a long course list as a data scope, not a user filter", () => {
    const courses = Array.from({ length: 18 }, (_, index) => `课程${index + 1}`);
    expect(describeChatContext(toolIntent(courses))).toBe(
      `限定：2025J · 共 18 门课程（含 ${courses[0]}） · 散点密度图`,
    );
  });
  it("keeps all-course and all-term scopes readable", () => {
    expect(describeChatContext(toolIntent([]))).toBe("限定：2025J · 全部课程 · 散点密度图");
    expect(
      describeChatContext({
        kind: "analysis",
        metric: "score",
        dimension: "course",
        filters: [],
        sort: { by: "value", direction: "desc" },
        limit: 100,
        view: "bar",
      }),
    ).toBe("限定：全部学期 · 全部课程 · 平均成绩");
  });
  it("labels the unified planning source honestly", () => {
    expect(planningMethodLabel({ source: "external", rationale: "", model: "qwen3.7-flash" })).toBe(
      "AI 对话分析（qwen3.7-flash）",
    );
  });
});
