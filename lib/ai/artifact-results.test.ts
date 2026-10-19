import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeArtifact, describeArtifacts, describeResponseArtifacts } from "./artifact-results";
import { buildFactRef, danglingFactRefs } from "./result-contract";
import { artifactWithView, type ChatArtifact } from "./chat-types";

/**
 * Roadmap §4.2/§7: the table and the chart of one analysis must be the same
 * result, and switching the view must never re-query or re-bill. These tests
 * exercise the derivation directly (no model, no database) and assert that the
 * identity ignores presentation.
 */
const analysisArtifact = (view: "bar" | "table"): ChatArtifact => ({
  kind: "analysis",
  view,
  plan: {
    version: 1,
    datasetId: "demo",
    metric: "score",
    aggregation: "avg",
    dimensions: ["course"],
    filters: [{ field: "term", op: "eq", value: "2025J" }],
    sort: { by: "value", direction: "desc" },
    limit: 100,
    chartType: view === "table" ? "table" : "bar",
  },
  result: {
    datasetId: "demo",
    dimension: "course",
    dimensions: ["course"],
    chartType: view === "table" ? "table" : "bar",
    rows: [
      { dimension: "Web前端开发", value: 69.65, sampleSize: 200 },
      { dimension: "操作系统", value: 74.1, sampleSize: 180 },
    ],
    unit: "分",
    metricLabel: "平均成绩",
    period: "模拟校园数据 · 学期：2025J",
    query: "SELECT aggregate",
    durationMs: 12,
    minSampleSize: 3,
    filteredOutGroupCount: 2,
  },
});

const distributionArtifact = (view: "heatmap" | "table"): ChatArtifact => ({
  kind: "distribution",
  course: "Web前端开发",
  term: "2025J",
  binWidth: 5,
  view,
  data: {
    datasetId: "demo",
    minSampleSize: 3,
    groups: [
      {
        course: "Web前端开发",
        term: "2025J",
        count: 200,
        bins: Array(100)
          .fill(0)
          .map((_, index) => (index < 60 ? 1 : 0)),
      },
      // A group outside the requested scope must be ignored when deriving facts.
      { course: "操作系统", term: "2025J", count: 180, bins: Array(100).fill(0) },
    ],
  },
});

describe("chart and table share one result identity", () => {
  it("derives the same resultId regardless of the rendered view", () => {
    for (const [a, b] of [
      [analysisArtifact("bar"), analysisArtifact("table")],
      [distributionArtifact("heatmap"), distributionArtifact("table")],
    ] as const) {
      const first = describeArtifact(a, "demo")!;
      const second = describeArtifact(b, "demo")!;
      expect(first.result.resultId).toBe(second.result.resultId);
      expect(first.facts.map((fact) => fact.factId)).toEqual(
        second.facts.map((fact) => fact.factId),
      );
    }
  });

  it("does not derive facts from out-of-scope groups", () => {
    const described = describeArtifact(distributionArtifact("heatmap"), "demo")!;
    expect(described.result.terms).toEqual(["2025J"]);
    expect(described.result.courses).toEqual(["Web前端开发"]);
    expect(described.facts).toHaveLength(1);
    expect(described.facts[0].text).toContain("200 人");
  });

  it("binds every derived fact to a result present in the same response", () => {
    const artifacts = [analysisArtifact("bar"), distributionArtifact("heatmap")];
    const { resultRefs, factRefs } = describeArtifacts(artifacts, "demo");
    expect(resultRefs).toHaveLength(2);
    expect(factRefs.length).toBeGreaterThan(0);
    expect(danglingFactRefs(resultRefs, factRefs)).toEqual([]);
    // Two genuinely different results must not collapse into one id.
    expect(resultRefs[0].resultId).not.toBe(resultRefs[1].resultId);
  });

  it("reports context limitations instead of hiding them", () => {
    const { result } = describeArtifact(analysisArtifact("bar"), "demo")!;
    expect(result.limitations.join(" ")).toContain("样本可能重叠");
    expect(result.limitations.join(" ")).toContain("隐藏不表示为零");
    expect(result.minSampleSize).toBe(3);
    // Grouped rows may share students, so no single "sample size" is claimed.
    expect(result.sampleSize).toBeNull();
  });

  it("keeps identical facts across repeated derivations", () => {
    const once = describeArtifact(analysisArtifact("bar"), "demo")!;
    const twice = describeArtifact(analysisArtifact("bar"), "demo")!;
    expect(once.result).toEqual(twice.result);
    expect(once.facts).toEqual(twice.facts);
  });

  it("fails a dangling reference instead of presenting the number", () => {
    const { resultRefs, factRefs } = describeArtifacts([analysisArtifact("bar")], "demo");
    const forged = buildFactRef(resultRefs[0], {
      label: "编造值",
      text: "不存在的结果",
      numeric: { value: 999, unit: "分", sampleSize: 3 },
      limitations: [],
    });
    const misplaced = { ...forged, resultId: "r-forged" };
    expect(danglingFactRefs(resultRefs, [misplaced])).toEqual([misplaced]);
    expect(danglingFactRefs(resultRefs, factRefs)).toEqual([]);
  });
});

describe("the output boundary rejects dangling facts", () => {
  it("keeps only facts bound to results in the response and reports the rest", () => {
    const artifacts = [analysisArtifact("bar")];
    const { resultRefs, factRefs } = describeArtifacts(artifacts, "demo");
    const described = describeResponseArtifacts(artifacts, "demo");
    expect(described.resultRefs).toEqual(resultRefs);
    expect(described.factRefs).toEqual(factRefs);
    expect(described.warning).toBeNull();
    expect(danglingFactRefs(described.resultRefs, described.factRefs)).toEqual([]);
  });

  it("would flag an unverifiable fact rather than present it as verified", () => {
    // Derivation currently always binds correctly; this pins the guard used by
    // `describeResponseArtifacts` so a future change that emits orphan refs fails.
    const { resultRefs, factRefs } = describeArtifacts([analysisArtifact("bar")], "demo");
    expect(factRefs.length).toBeGreaterThan(0);
    for (const fact of factRefs)
      expect(resultRefs.some((result) => result.resultId === fact.resultId)).toBe(true);
  });
});

describe("switching presentation does not change the result", () => {
  let directory: string;
  let converse: typeof import("./conversation").converse;
  let runAnalysis: typeof import("../analysis/duckdb").runAnalysis;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "view-switch-"));
    const rows = ["id_student,code_module,code_presentation,score,completed"];
    for (let i = 1; i <= 4; i++) rows.push(`S${i},数学,2025J,${60 + i},1`);
    writeFileSync(join(directory, "student_outcomes.csv"), rows.join("\n"));
    writeFileSync(
      join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\nS1,数学,2025J,1,10\n",
    );
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.stubEnv("APP_STATE_DIR", join(directory, "state"));
    vi.resetModules();
    const duckdb = await import("../analysis/duckdb");
    runAnalysis = duckdb.runAnalysis;
    converse = (await import("./conversation")).converse;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * The unified tool loop cannot run in these tests, so the deterministic
   * golden/presentation paths are exercised instead; a spy proves no model turn
   * is ever attempted (the capability check rejects before `generate`).
   */
  const deps = () => {
    const generate = vi.fn();
    return {
      analyze: vi.fn(runAnalysis) as never,
      distribution: vi.fn(async () => ({
        datasetId: "demo" as const,
        minSampleSize: 3,
        groups: [],
      })) as never,
      unified: {
        capability: () => ({ status: "unknown" as const, checkedAt: null }),
        settings: () => ({ enabled: true, maxToolCalls: 6, timeoutSeconds: 60 }),
        generate: generate as never,
      },
      modelCalls: generate,
    };
  };

  /**
   * The in-place chart⇄table toggle is the case the roadmap calls out: it must
   * reuse the already-returned result. `artifactWithView` only rewrites `view`,
   * so the identity and every fact stay valid without touching the network.
   */
  it("reuses the same resultId when the UI toggles the view in place", async () => {
    const dependencies = deps();
    const first = await converse(
      { question: "比较各课程平均成绩。", datasetId: "demo" },
      {},
      dependencies,
    );
    expect(first.artifact?.kind).toBe("analysis");
    const base = describeArtifact(first.artifact!, "demo")!;
    const toggled = artifactWithView(first.artifact!, "table");
    expect(describeArtifact(toggled, "demo")!.result.resultId).toBe(base.result.resultId);
    expect(describeArtifact(toggled, "demo")!.facts).toEqual(base.facts);
    // A presentation change never needs another query or another model call.
    expect(dependencies.analyze).toHaveBeenCalledTimes(1);
    expect(dependencies.modelCalls).not.toHaveBeenCalled();
  });

  /**
   * A *typed* "改成表格" is still a new server request, so it re-runs the
   * deterministic query (no model call). The contract that matters here is that
   * the re-derived identity and facts are identical, so the client can safely
   * treat it as the same result instead of a second analysis.
   */
  it("re-derives an identical result for a typed view followup, with no model call", async () => {
    const dependencies = deps();
    const first = await converse(
      { question: "比较各课程平均成绩。", datasetId: "demo" },
      {},
      dependencies,
    );
    const base = describeArtifact(first.artifact!, "demo")!;
    const followupDeps = deps();
    const typed = await converse(
      { question: "改成表格", datasetId: "demo", context: first.context },
      {},
      { ...followupDeps, analyze: dependencies.analyze },
    );
    expect(followupDeps.modelCalls).not.toHaveBeenCalled();
    expect(typed.artifact?.view).toBe("table");
    const switched = describeArtifact(typed.artifact!, "demo")!;
    expect(switched.result.resultId).toBe(base.result.resultId);
    expect(switched.facts).toEqual(base.facts);
  });
});

describe("scope labels do not duplicate the dataset prefix", () => {
  it("reuses the measured period string as-is", () => {
    const { result } = describeArtifact(analysisArtifact("bar"), "demo")!;
    // `result.period` already names the dataset; a second prefix would read wrong.
    expect(result.scopeLabel).toBe("模拟校园数据 · 学期：2025J");
    expect(result.scopeLabel.match(/模拟校园数据/g)).toHaveLength(1);
  });
});

describe("studio result identity includes the course scope", () => {
  const studio = (courses: string[]): ChatArtifact => ({
    kind: "studio",
    tool: "density",
    term: "2025J",
    view: "chart",
    courses,
    table: {
      columns: ["出勤率区间中心", "成绩区间中心", "频数"],
      rows: [{ 出勤率区间中心: 85, 成绩区间中心: 62.5, 频数: 10 }],
      description: "2025J · 出勤率与成绩分档频数。",
    },
  });

  it("does not collapse two different course scopes into one id", () => {
    const a = describeArtifact(studio(["数学"]), "demo")!;
    const b = describeArtifact(studio(["英语"]), "demo")!;
    expect(a.result.resultId).not.toBe(b.result.resultId);
    expect(a.result.scopeLabel).toContain("数学");
    expect(b.result.scopeLabel).toContain("英语");
  });

  it("keeps the same id for the same course scope", () => {
    expect(describeArtifact(studio(["数学"]), "demo")!.result.resultId).toBe(
      describeArtifact(studio(["数学"]), "demo")!.result.resultId,
    );
  });
});
