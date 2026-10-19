import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assessResponse,
  phase1CaseSchema,
  simulatedDecision,
  stageResults,
} from "./ai-eval/phase1";
import { loadEnvFile } from "./ai-eval/environment";
import type { ChatIntent, ChatMessage, ChatResponse } from "../lib/ai/chat-types";

const flag = (name: string) =>
  !["", "0", "false"].includes((process.env[name] ?? "").trim().toLowerCase());
const mocked = flag("AI_EVAL_MOCK");
const live = flag("AI_EVAL") && !mocked;
const cases = readFileSync(resolve("scripts/ai-eval/phase1-cases.jsonl"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => phase1CaseSchema.parse(JSON.parse(line)));

describe("phase one evaluation contract (no model calls)", () => {
  it("covers followups, filter conflicts, charts and numerical checks with unique cases", () => {
    expect(cases).toHaveLength(12);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const category of ["followup", "conflict", "chart", "numeric"])
      expect(cases.filter((c) => c.category === category)).toHaveLength(3);
  });
  it("separates planning, query and presentation failures and blocks dependent stages", () => {
    expect(stageResults({ planning: ["scope"], query: [], presentation: [] })).toEqual({
      planning: "fail",
      query: "blocked",
      presentation: "blocked",
    });
    expect(stageResults({ planning: [], query: ["wrong value"], presentation: [] })).toEqual({
      planning: "pass",
      query: "fail",
      presentation: "blocked",
    });
    expect(stageResults({ planning: [], query: [], presentation: ["wrong chart"] })).toEqual({
      planning: "pass",
      query: "pass",
      presentation: "fail",
    });
  });
  it("detects mutated numbers and views independently", () => {
    const expected = cases[0].turns[0].expect;
    if (expected.context?.kind !== "analysis") throw new Error("Fixture must be analysis");
    const response: ChatResponse = {
      kind: "result",
      presentation: "chart",
      answer: "独立数值基准",
      facts: [],
      suggestions: [],
      planning: { source: "local", model: null, rationale: "测试夹具" },
      context: expected.context,
      artifact: {
        kind: "analysis",
        view: "bar",
        result: {
          rows: expected.rows ?? [],
          datasetId: "demo",
          dimension: "course",
          chartType: "bar",
          unit: "分",
          metricLabel: "平均成绩",
          period: "2024J",
          query: "SELECT aggregate_only",
          durationMs: 0,
          minSampleSize: 3,
          filteredOutGroupCount: 0,
        },
        plan: {
          version: 1,
          datasetId: "demo",
          aggregation: "avg",
          chartType: "bar",
          metric: expected.context.metric,
          filters: expected.context.filters,
          sort: expected.context.sort,
          limit: expected.context.limit,
          dimensions: [expected.context.dimension],
        },
      },
    };
    expect(stageResults(assessResponse(response, expected))).toEqual({
      planning: "pass",
      query: "pass",
      presentation: "pass",
    });
    const wrongValue = structuredClone(response);
    if (wrongValue.artifact?.kind === "analysis") wrongValue.artifact.result.rows[0].value = 999;
    expect(assessResponse(wrongValue, expected).query).not.toEqual([]);
    const wrongView = { ...response, presentation: "table" as const };
    expect(assessResponse(wrongView, expected).presentation).not.toEqual([]);
    const wrongPlan = structuredClone(response);
    if (wrongPlan.artifact?.kind === "analysis") wrongPlan.artifact.plan.filters = [];
    expect(assessResponse(wrongPlan, expected).query).not.toEqual([]);
  });
});

describe.skipIf(!mocked && !live)(
  `phase one evaluation (${mocked ? "simulated planner + real DuckDB" : "live model"})`,
  () => {
    const startedAt = new Date().toISOString();
    const results: Record<string, unknown>[] = [];
    let directory: string | undefined;
    let envFile: string | null = null;
    let model: string | null = null;
    let promptVersion = "";
    let converse: (typeof import("../lib/ai/conversation"))["converse"];
    let queries: typeof import("../lib/analysis/duckdb");
    let executing = false;

    beforeAll(async () => {
      if (mocked) {
        directory = mkdtempSync(join(tmpdir(), "ai-phase1-eval-"));
        vi.stubEnv("APP_STATE_DIR", directory);
        vi.stubEnv("OPENAI_API_KEY", "");
        vi.stubEnv("OPENAI_MODEL", "");
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
          throw new Error("Mock evaluation forbids network calls");
        });
      } else {
        envFile = loadEnvFile();
        const { getRuntimeAIConfig } = await import("../lib/settings/ai");
        const config = getRuntimeAIConfig();
        if (
          !config.enabled ||
          !config.model ||
          !config.apiKey ||
          config.pricing.inputPerMillion === null ||
          config.pricing.outputPerMillion === null
        )
          throw new Error("真实模型评测需要已开启的模型、可用密钥与输入/输出单价。");
        model = config.model;
      }
      // Values below are independent golden CSV calculations, not the generated campus dataset.
      if (resolve(process.env.DEMO_DATA_DIR || "data/sample") !== resolve("data/fixtures/golden"))
        throw new Error("第一阶段数值基准要求 DEMO_DATA_DIR=data/fixtures/golden。");
      ({ converse } = await import("../lib/ai/conversation"));
      queries = await import("../lib/analysis/duckdb");
      ({ PROMPT_VERSION: promptVersion } = await import("../lib/ai/prompts/version"));
    });

    for (const testCase of cases) {
      it(
        testCase.id,
        async () => {
          let context: ChatIntent | null = null;
          const history: ChatMessage[] = [];
          for (let index = 0; index < testCase.turns.length; index++) {
            const turn = testCase.turns[index];
            executing = false;
            try {
              const input = {
                question: turn.question,
                datasetId: "demo",
                context,
                history: [...history],
              };
              const response = await converse(
                input,
                {
                  onExecution: () => {
                    executing = true;
                  },
                },
                mocked
                  ? {
                      generate: async () => ({
                        fields: { ...simulatedDecision, ...turn.decision },
                        usedModel: "simulated-phase1-planner",
                      }),
                      analyze: queries.runAnalysis,
                      distribution: queries.scoreDistribution,
                    }
                  : undefined,
              );
              const checks = assessResponse(response, turn.expect);
              const stages = stageResults(checks);
              const passed = Object.values(stages).every((stage) => stage === "pass");
              results.push({
                id: testCase.id,
                turn: index + 1,
                category: testCase.category,
                question: turn.question,
                passed,
                stages,
                checks,
                planningSource: response.planning.source,
                actual: {
                  kind: response.kind,
                  context: response.context,
                  presentation: response.presentation,
                  rows:
                    response.artifact?.kind === "analysis" ? response.artifact.result.rows : null,
                },
                expected: turn.expect,
              });
              context = response.context;
              history.push(
                { role: "user", content: turn.question },
                { role: "assistant", content: response.answer },
              );
              expect(checks, `${testCase.id} turn ${index + 1}`).toEqual({
                planning: [],
                query: [],
                presentation: [],
              });
            } catch (error) {
              if (!results.some((r) => r.id === testCase.id && r.turn === index + 1)) {
                results.push({
                  id: testCase.id,
                  turn: index + 1,
                  category: testCase.category,
                  passed: false,
                  stages: executing
                    ? { planning: "pass", query: "fail", presentation: "blocked" }
                    : { planning: "fail", query: "blocked", presentation: "blocked" },
                  // Keep provider messages and potential secrets out of persisted evaluation reports.
                  error: error instanceof Error ? error.name : "UnknownError",
                });
              }
              throw error;
            }
          }
        },
        120_000,
      );
    }

    afterAll(() => {
      if (results.length) {
        const output = resolve("output/ai-eval");
        mkdirSync(output, { recursive: true });
        const report = {
          suite: "competition-phase1",
          startedAt,
          finishedAt: new Date().toISOString(),
          mocked,
          mode: mocked ? "simulated-planner-real-query" : "live-model",
          model,
          promptVersion,
          dataset: "demo",
          demoDataDir: "data/fixtures/golden",
          envFile,
          total: results.length,
          passed: results.filter((r) => r.passed).length,
          cases: results,
          failures: results.filter((r) => !r.passed),
        };
        writeFileSync(
          join(
            output,
            `phase1-${mocked ? "mock" : "live"}-${startedAt.replace(/[:.]/g, "-")}.json`,
          ),
          JSON.stringify(report, null, 2) + "\n",
        );
      }
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      if (directory) rmSync(directory, { recursive: true, force: true });
    });
  },
);
