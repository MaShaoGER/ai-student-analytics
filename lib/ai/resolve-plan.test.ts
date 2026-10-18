import { describe, expect, it } from "vitest";
import { parseConversationDecision, resolvePlan, type ConversationDecision } from "./resolve-plan";

const base = {
  action: "analysis",
  tool: null,
  courses: null,
  terms: null,
  dimensions: null,
  threshold: null,
  message: "按问题选择真实统计。",
  metric: null,
  dimension: null,
  course: null,
  term: null,
  binWidth: null,
  view: null,
  sortBy: null,
  sortDirection: null,
  limit: null,
};

const decide = (overrides: Record<string, unknown> = {}): ConversationDecision =>
  parseConversationDecision({ ...base, ...overrides });

describe("resolvePlan keeps model decisions and only fills blanks", () => {
  it("regression: a lookup analysis survives a question ending in 是什么", () => {
    const decision = decide({
      goal: "lookup",
      action: "analysis",
      metric: "score",
      dimension: "course",
    });
    const resolved = resolvePlan(decision, "各门课程的平均成绩是什么？", null);
    expect(resolved.goal).toBe("lookup");
    expect(resolved.decision.action).toBe("analysis");
    expect(resolved.decision.metric).toBe("score");
    expect(resolved.decision.dimension).toBe("course");
  });

  it("regression: a distribution action survives a question asking 是什么样", () => {
    const decision = decide({
      goal: "distribution",
      action: "distribution",
      metric: "score",
    });
    const resolved = resolvePlan(decision, "成绩分布是什么样？", null);
    expect(resolved.goal).toBe("distribution");
    expect(resolved.decision.action).toBe("distribution");
  });

  it("regression: the compare regex does not hijack an explain reply into a query", () => {
    const decision = decide({ goal: "explain", action: "reply", metric: null });
    const resolved = resolvePlan(decision, "比较各门课，但先解释下指标含义", null);
    expect(resolved.goal).toBe("explain");
    expect(resolved.decision.action).toBe("reply");
    expect(resolved.decision.metric).toBeNull();
    expect(resolved.decision.dimension).toBeNull();
  });

  it("prefers the model goal and never overwrites its non-empty fields", () => {
    const decision = decide({
      goal: "compare",
      action: "analysis",
      metric: "score",
      dimension: "course",
      dimensions: ["course", "term"],
      sortBy: "value",
      sortDirection: "asc",
      view: "table",
    });
    const resolved = resolvePlan(decision, "看看平均成绩随学期的变化趋势", null);
    expect(resolved.goal).toBe("compare");
    expect(resolved.decision.action).toBe("analysis");
    expect(resolved.decision.dimension).toBe("course");
    expect(resolved.decision.dimensions).toEqual(["course", "term"]);
    expect(resolved.decision.sortBy).toBe("value");
    expect(resolved.decision.sortDirection).toBe("asc");
    expect(resolved.decision.view).toBe("table");
  });

  it("classifies the goal from keywords only when the model gave none", () => {
    expect(resolvePlan(decide(), "看看平均成绩随学期的变化趋势", null).goal).toBe("trend");
    expect(resolvePlan(decide({ goal: "auto" }), "看看各科成绩的分布", null).goal).toBe(
      "distribution",
    );
    expect(resolvePlan(decide(), "缺勤次数和成绩有关系吗？", null).goal).toBe("relationship");
    expect(resolvePlan(decide(), "帮我看看数据", null).goal).toBe("auto");
  });

  it("fills a missing course dimension for 各门课 comparisons", () => {
    const resolved = resolvePlan(decide({ goal: "compare" }), "比较各门课平均成绩", null);
    expect(resolved.decision.dimension).toBe("course");
    expect(resolved.decision.dimensions).toEqual(["course"]);
  });

  it("fills trend defaults without overriding explicit model values", () => {
    const plain = resolvePlan(decide({ goal: "trend" }), "看看平均成绩随学期的趋势", null);
    expect(plain.decision.dimension).toBe("term");
    expect(plain.decision.dimensions).toEqual(["term"]);
    expect(plain.decision.sortBy).toBe("dimension");
    expect(plain.decision.sortDirection).toBe("asc");

    const explicit = resolvePlan(
      decide({ goal: "trend", dimension: "course", sortBy: "value", sortDirection: "desc" }),
      "看看平均成绩随学期的趋势，倒序",
      null,
    );
    expect(explicit.decision.dimension).toBe("course");
    expect(explicit.decision.dimensions).toBeNull();
    expect(explicit.decision.sortBy).toBe("value");
    expect(explicit.decision.sortDirection).toBe("desc");
  });

  it("enforces a coherent trend shape when the model left the goal undecided", () => {
    // The model omitted `goal`, so the keyword fallback classified a trend. A
    // course dimension would no longer be a trend, so the fallback keeps the
    // single legacy-coherent shape. An explicit model goal is never overridden.
    const resolved = resolvePlan(
      decide({ dimension: "course", sortBy: "value", sortDirection: "desc" }),
      "看看数学平均成绩随学期的变化趋势",
      null,
    );
    expect(resolved.goal).toBe("trend");
    expect(resolved.decision.dimension).toBe("term");
    expect(resolved.decision.dimensions).toEqual(["term"]);
    expect(resolved.decision.sortBy).toBe("dimension");
    expect(resolved.decision.sortDirection).toBe("asc");
  });

  it("repairs a distribution goal left on the analysis action", () => {
    const chart = resolvePlan(decide({ goal: "distribution", metric: "score" }), "各科成绩分布", null);
    expect(chart.decision.action).toBe("distribution");
    expect(chart.decision.view).toBe("heatmap");

    const table = resolvePlan(
      decide({ goal: "distribution", metric: "score" }),
      "各科成绩分布，用表格展示",
      null,
    );
    expect(table.decision.action).toBe("distribution");
    expect(table.decision.view).toBe("table");
  });

  it("fills an explicit chart view without changing the model action", () => {
    const compared = resolvePlan(
      decide({ goal: "compare", action: "analysis", metric: "score" }),
      "用柱状图比较各门课平均成绩",
      null,
    );
    expect(compared.decision.action).toBe("analysis");
    expect(compared.decision.view).toBe("bar");
    expect(compared.decision.dimension).toBe("course");

    const distribution = resolvePlan(
      decide({ goal: "distribution", action: "distribution", metric: "score" }),
      "用柱状图看成绩分布",
      null,
    );
    expect(distribution.decision.action).toBe("distribution");
    // Distribution renders as table/heatmap, so an unusable bar view is repaired.
    expect(distribution.decision.view).toBe("heatmap");
  });

  it("selects the density tool when a relationship metric has no tool", () => {
    const decision = decide({
      goal: "relationship",
      action: "tool",
      tool: "density",
      relationMetric: "absence",
      metric: "score",
    });
    const resolved = resolvePlan(decision, "缺勤次数和成绩有关系吗？", null);
    expect(resolved.decision.action).toBe("tool");
    expect(resolved.decision.tool).toBe("density");

    // The resolver still repairs this contradictory state even if a future
    // normalization passes it through without a tool.
    const contradictory: ConversationDecision = {
      ...decide({ goal: "relationship", metric: "score" }),
      relationMetric: "absence",
    };
    const repaired = resolvePlan(contradictory, "缺勤和成绩的关系", null);
    expect(repaired.decision.action).toBe("tool");
    expect(repaired.decision.tool).toBe("density");
  });

  it("is pure: the input decision is not mutated", () => {
    const decision = decide({ goal: "compare", metric: "score" });
    const snapshot = structuredClone(decision);
    resolvePlan(decision, "比较各门课平均成绩", null);
    expect(decision).toEqual(snapshot);
  });

  it("bounds the decision message to the planning budget", () => {
    expect(() => decide({ message: "字".repeat(301) })).toThrow();
    expect(decide({ message: "字".repeat(300) }).message).toHaveLength(300);
  });
});
