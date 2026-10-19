/** Explicit opt-in only: real model + real DuckDB, billed to the existing application budgets. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "./ai-eval/environment";
import { probeToolCalling, generateToolTurn } from "../lib/ai/tool-provider";
import { converseUnified, type UnifiedDependencies } from "../lib/ai/unified";
import { absenceStats, runAnalysis, scoreDistribution } from "../lib/analysis/duckdb";
import { executeChartTool } from "../lib/ai/chart-tools";
import { searchKnowledge } from "../lib/ai/knowledge";
import { getAnalysisSettings } from "../lib/settings/analysis";
import { getAIConfig } from "../lib/settings/ai";

const enabled = process.env.AI_EVAL_PHASE2 === "1";
const reports: unknown[] = [];
let probePassed = false;
let terms: string[] = [];
const deps: UnifiedDependencies = {
  generate: generateToolTurn,
  analyze: runAnalysis,
  distribution: scoreDistribution,
  absence: absenceStats,
  chart: executeChartTool,
  search: searchKnowledge,
  settings: getAnalysisSettings,
  capability: () => ({ status: probePassed ? "supported" : "unknown", checkedAt: null }),
};
describe.skipIf(!enabled).sequential("phase 2 real endpoint acceptance", () => {
  beforeAll(async () => {
    loadEnvFile();
    // Vitest's default fixture is intentionally cross-term-incomparable. Load the campus dataset explicitly.
    vi.stubEnv("DEMO_DATA_DIR", process.env.AI_EVAL_PHASE2_DATA_DIR || "data/sample");
    vi.resetModules();
    const real = await import("../lib/analysis/duckdb");
    deps.analyze = real.runAnalysis;
    deps.distribution = real.scoreDistribution;
    deps.absence = real.absenceStats;
    const config = getAIConfig();
    if (!config.enabled || !config.keyConfigured)
      throw new Error("A configured model and decryption key are required.");
    terms = [
      ...new Set((await real.scoreDistribution("demo")).groups.map((group) => group.term)),
    ].sort();
  });
  afterAll(() => {
    if (!reports.length) return;
    const directory = join("output", "ai-eval");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `phase2-${new Date().toISOString().replaceAll(":", "-")}.json`),
      JSON.stringify({ mode: "real", model: getAIConfig().model, reports }, null, 2),
    );
  });
  it("verifies an actual function call and tool-output roundtrip", async () => {
    const result = await probeToolCalling();
    probePassed = true;
    reports.push({ case: "tool-compatibility", passed: true, model: result.model });
  }, 60_000);
  it("dynamically selects the largest declining course and queries its distribution", async () => {
    expect(probePassed).toBe(true);
    const beforeTerm = terms.at(-2)!;
    const afterTerm = terms.at(-1)!;
    const question = `比较${beforeTerm}和${afterTerm}，找出均分下降最多的课程，再看它在${afterTerm}的成绩分布，并解释比较口径。`;
    const result = await converseUnified({ question, datasetId: "demo" }, {}, deps);
    reports.push({ case: "dependent-analysis", question, result });
    expect(result.completion).toBe("complete");
    const comparison = result.artifacts?.find(
      (artifact) => artifact.kind === "studio" && artifact.tool === "dumbbell",
    );
    expect(comparison?.kind).toBe("studio");
    if (comparison?.kind === "studio") {
      const declined = comparison.table.rows
        .filter((row) => Number(row.变化) < 0)
        .sort((a, b) => Number(a.变化) - Number(b.变化));
      if (declined.length) {
        const distribution = result.artifacts?.find((artifact) => artifact.kind === "distribution");
        expect(distribution).toMatchObject({ course: declined[0].课程, term: afterTerm });
      } else expect(result.answer).toContain("没有均分下降");
    }
    expect(result.citations?.some((citation) => citation.id === "comparison-scope")).toBe(true);
  }, 125_000);
  it("answers with versioned sources and clarifies an ambiguous comparison", async () => {
    const definition = await converseUnified(
      { question: "完成率和出勤率有什么区别", datasetId: "demo" },
      {},
      deps,
    );
    reports.push({ case: "cited-definition", result: definition });
    expect(definition.citations?.length).toBeGreaterThan(0);
    expect(definition.answer).toContain("不同指标");
    const clarification = await converseUnified(
      { question: "本学期哪个课程下降最多", datasetId: "demo" },
      {},
      deps,
    );
    reports.push({ case: "ambiguous-comparison", result: clarification });
    expect(clarification.kind).toBe("clarification");
    expect(clarification.artifacts).toHaveLength(0);
  }, 125_000);
});
