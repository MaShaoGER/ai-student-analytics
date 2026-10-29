import { describe, expect, it } from "vitest";
import type { ChatArtifact, ChatDisplayView } from "@/lib/ai/chat-types";
import type { StoredArtifactPresentationPolicy } from "@/lib/analysis/presentation-policy";
import { policyForArtifact } from "@/lib/analysis/presentation-policy";
import {
  compatibleArtifactView,
  mergeStoredPolicy,
  withArtifactView,
} from "./conversation-artifact";

const analysis: Extract<ChatArtifact, { kind: "analysis" }> = {
  kind: "analysis",
  view: "line",
  plan: {
    version: 1,
    datasetId: "demo",
    metric: "score",
    aggregation: "avg",
    dimensions: ["course"],
    filters: [],
    sort: { by: "dimension", direction: "asc" },
    limit: 20,
    chartType: "line",
  },
  result: {
    datasetId: "demo",
    dimension: "course",
    chartType: "line",
    rows: [
      { dimension: "A", value: 80, sampleSize: 10 },
      { dimension: "B", value: 70, sampleSize: 8 },
    ],
    unit: "分",
    metricLabel: "平均成绩",
    period: "fixture",
    query: "fixture",
    durationMs: 1,
    minSampleSize: 3,
    filteredOutGroupCount: 0,
  },
};

describe("conversation artifact adapter", () => {
  it("changes the artifact view rather than only changing button state", () => {
    expect(compatibleArtifactView(analysis, "bar")).toBe(true);
    expect(withArtifactView(analysis, "bar").kind).toBe("analysis");
    expect(withArtifactView(analysis, "bar")).toMatchObject({ view: "bar" });
    expect(withArtifactView(analysis, "chart")).toBe(analysis);
  });

  it("rejects forms that the current result type cannot render", () => {
    expect(compatibleArtifactView(analysis, "heatmap")).toBe(false);
    expect(compatibleArtifactView(analysis, "chart")).toBe(false);
    const distribution: ChatArtifact = {
      kind: "distribution",
      data: { datasetId: "demo", groups: [], minSampleSize: 3 },
      course: "",
      term: "",
      binWidth: 5,
      view: "heatmap",
    };
    expect(compatibleArtifactView(distribution, "heatmap")).toBe(true);
    expect(compatibleArtifactView(distribution, "pie")).toBe(false);
  });

  it("does not let a stale stored policy revive a rejected category line", () => {
    const policy = policyForArtifact(analysis);
    const stale: StoredArtifactPresentationPolicy = {
      ...policy,
      effectiveView: "line",
      requestedView: "line",
      allowedViews: ["bar", "line", "table"] as ChatDisplayView[],
      fallbackReason: null,
      orientation: "vertical",
    };
    const merged = mergeStoredPolicy(analysis, policy, stale);
    expect(merged.effectiveView).toBe("bar");
    expect(merged.fallbackReason).toBeTruthy();
  });

  it("keeps fact identity while changing only presentation", () => {
    const first = policyForArtifact(analysis);
    const second = policyForArtifact(analysis, { requestedView: "table" });
    expect(second.effectiveView).toBe("table");
    expect(second.allowedViews).toContain("table");
    expect(first.factIds).toEqual(second.factIds);
  });
});
