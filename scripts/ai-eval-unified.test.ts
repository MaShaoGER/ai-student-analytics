/**
 * Unified-conversation evaluation (rebuilt for the single `/api/chat` entry).
 *
 * The phase-1 simulated-planner harness was retired together with the JSON
 * planner it stubbed; this file evaluates the *tool loop* instead.
 *
 * Commands (always skipped by default, so `pnpm test` stays offline):
 *   AI_EVAL_UNIFIED_MOCK=1 pnpm exec vitest run scripts/ai-eval-unified.test.ts
 *     Scripted model turns + real DuckDB on `data/sample`, network forbidden.
 *     Proves wiring/contracts/usage aggregation, never model ability.
 *   AI_EVAL_UNIFIED=1 pnpm exec vitest run scripts/ai-eval-unified.test.ts
 *     Real configured model + real DuckDB. Costs money and is not a broad
 *     accuracy claim.
 *
 * Reports: `output/ai-eval/unified-<mock|live>-<timestamp>.json`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "./ai-eval/environment";
import { comparisonAnswerChecks, comparisonFromCsv } from "./ai-eval/answer-semantics";
import {
  answerHasVerifiedNumber,
  buildReport,
  factBinding,
  inventedNumbers,
  naturalProseChars,
  reportFileName,
  summarizeScenario,
  usageProblems,
  verifiedText,
  type Check,
  type EvalMode,
  type ScenarioReport,
} from "./ai-eval/unified-scenarios";
import type { ChatResponse } from "../lib/ai/chat-types";
import type { UnifiedDependencies } from "../lib/ai/unified";
import type { ToolMessage, ToolModelOptions, ToolTurn } from "../lib/ai/tool-provider";
import type { RequestUsage } from "../lib/security/ai-cost";
import type { FactRef } from "../lib/ai/result-contract";

// Mock the SDK only in mock mode; live mode receives the real `openai` module so
// `AI_EVAL_UNIFIED=1` exercises the production provider path.
const fakeOpenAI = vi.hoisted(() => ({
  mode: "success" as "success" | "fail",
  calls: 0,
}));
vi.mock("openai", async (importOriginal) => {
  const live = process.env.AI_EVAL_UNIFIED === "1" && process.env.AI_EVAL_UNIFIED_MOCK !== "1";
  if (live) return importOriginal();
  class FakeOpenAI {
    responses = {
      create: async () => {
        fakeOpenAI.calls += 1;
        if (fakeOpenAI.mode === "fail") throw new Error("mock provider failure");
        return {
          usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
          status: "completed",
          incomplete_details: null,
          output: [],
          output_text: "",
        };
      },
    };
    chat = {
      completions: {
        create: async () => {
          fakeOpenAI.calls += 1;
          return {
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
            choices: [
              { finish_reason: "stop", message: { content: "", refusal: null, tool_calls: [] } },
            ],
          };
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

const MOCK = process.env.AI_EVAL_UNIFIED_MOCK === "1";
const LIVE = process.env.AI_EVAL_UNIFIED === "1" && !MOCK;
const ENABLED = MOCK || LIVE;
const DATASET = "demo";
const DATA_DIR = "data/sample";
const OUTPUT_DIR = join("output", "ai-eval");
const SIMULATED_PRICING = { inputPerMillion: 1, outputPerMillion: 1 };

type UnifiedModule = typeof import("../lib/ai/unified");
type DuckdbModule = typeof import("../lib/analysis/duckdb");
type ChartToolsModule = typeof import("../lib/ai/chart-tools");
type KnowledgeModule = typeof import("../lib/ai/knowledge");
type AnalysisSettingsModule = typeof import("../lib/settings/analysis");
type AISettingsModule = typeof import("../lib/settings/ai");
type ToolProviderModule = typeof import("../lib/ai/tool-provider");
type AICostModule = typeof import("../lib/security/ai-cost");

let unified: UnifiedModule;
let duckdb: DuckdbModule;
let chartTools: ChartToolsModule;
let knowledge: KnowledgeModule;
let analysisSettings: AnalysisSettingsModule;
let aiSettings: AISettingsModule;
let toolProvider: ToolProviderModule;
let aiCost: AICostModule;

let catalogCourses: string[] = [];
let catalogTerms: string[] = [];
let catalogLabels: string[] = [];
let latestTerm = "";
let previousTerm = "";
let liveDeps: UnifiedDependencies;
let liveModel: string | null = null;

let stateDirectory: string | null = null;
let fetchSpy: { mockRestore: () => void } | null = null;
const reports: ScenarioReport[] = [];
let startedAt = new Date().toISOString();
let envFile: string | null = null;

interface CapturedCall {
  messages: ToolMessage[];
  options?: ToolModelOptions;
}

const toolTurn = (name: string, args: unknown): ToolTurn => ({
  model: "scripted-mock",
  message: {
    role: "assistant",
    content: "",
    calls: [{ id: `call-${crypto.randomUUID()}`, name, arguments: JSON.stringify(args) }],
  },
});

const answerTurn = (content: string): ToolTurn => ({
  model: "scripted-mock",
  message: { role: "assistant", content, calls: [] },
});

function lastToolPayload(messages: ToolMessage[]): Record<string, unknown> | null {
  const last = messages.at(-1);
  if (!last || last.role !== "tool") return null;
  try {
    const parsed = JSON.parse(last.content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type DigestFact = Pick<FactRef, "factId" | "text" | "semantic">;

/** The tool result carries the fact digest the model may cite via `{{factId}}`. */
function digestFacts(messages: ToolMessage[]): DigestFact[] {
  const facts = lastToolPayload(messages)?.facts;
  if (!Array.isArray(facts)) return [];
  return facts.filter(
    (fact): fact is DigestFact =>
      Boolean(fact) &&
      typeof fact === "object" &&
      typeof (fact as DigestFact).factId === "string" &&
      typeof (fact as DigestFact).text === "string",
  );
}

const cite = (fact: DigestFact) => `{{${fact.factId}}}`;

/** Structured `user` payload the unified engine sends to the model. */
function structuredInput(messages: ToolMessage[]): Record<string, unknown> | null {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return null;
  try {
    const parsed = JSON.parse(last.content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function requestLevelChecks(
  response: ChatResponse,
  calls: CapturedCall[],
  requestId: string,
): Check[] {
  const usageIssue = usageProblems(response.usage);
  const contexts = calls.map((call) => call.options?.usageContext);
  const sharedContext = contexts.length > 0 && contexts.every((context) => context === contexts[0]);
  return [
    {
      name: "usage is present and internally sane",
      passed: usageIssue.length === 0,
      detail: usageIssue.join("; "),
    },
    {
      name: "response echoes the server requestId",
      passed: response.requestId === requestId,
      detail: `response=${response.requestId ?? "missing"} request=${requestId}`,
    },
    {
      name: "every model turn shares one request-level usage accumulator",
      passed: sharedContext,
    },
    {
      name: "every model turn receives the requestId for cost history",
      passed: calls.length > 0 && calls.every((call) => call.options?.requestId === requestId),
    },
    {
      name: "usage.modelCalls counts every model turn",
      passed: response.usage?.modelCalls === calls.length,
      detail: `usage=${response.usage?.modelCalls ?? "missing"} turns=${calls.length}`,
    },
  ];
}

function liveRequestLevelChecks(response: ChatResponse, requestId: string): Check[] {
  const usageIssue = usageProblems(response.usage);
  return [
    {
      name: "usage is present and internally sane",
      passed: usageIssue.length === 0,
      detail: usageIssue.join("; "),
    },
    {
      name: "response echoes the server requestId",
      passed: response.requestId === requestId,
      detail: `response=${response.requestId ?? "missing"} request=${requestId}`,
    },
    {
      name: "at least one real model call was billed",
      passed: (response.usage?.modelCalls ?? 0) >= 1,
    },
  ];
}

async function runMockScenario(options: {
  id: string;
  label: string;
  input: Record<string, unknown>;
  handler: (
    messages: ToolMessage[],
    modelOptions?: ToolModelOptions,
  ) => ToolTurn | Promise<ToolTurn>;
  check: (response: ChatResponse, calls: CapturedCall[]) => Check[];
}): Promise<ScenarioReport> {
  const calls: CapturedCall[] = [];
  let simulatedCalls = 0;
  const deps: UnifiedDependencies = {
    generate: async (messages, _tools, modelOptions) => {
      calls.push({ messages: structuredClone(messages), options: modelOptions });
      const turn = await options.handler(messages, modelOptions);
      simulatedCalls += 1;
      const usage = { promptTokens: 120, completionTokens: 40, totalTokens: 160 };
      const cost = aiCost.calculateCost("gpt-4o-mini", usage, SIMULATED_PRICING);
      if (modelOptions?.usageContext)
        aiCost.accumulateRequestUsage(modelOptions.usageContext, usage, cost.totalCost, false);
      return turn;
    },
    // The corrective compose turn is scripted as an empty answer: mock scenarios
    // already use placeholders, so a retry should not change their outcome.
    compose: async (_messages, _tools, modelOptions) => {
      // Even the optional rewrite would be a billed call: keep the accumulator
      // consistent so a future retry cannot skew request-level assertions.
      const usage = { promptTokens: 100, completionTokens: 30, totalTokens: 130 };
      const cost = aiCost.calculateCost("gpt-4o-mini", usage, SIMULATED_PRICING);
      if (modelOptions?.usageContext)
        aiCost.accumulateRequestUsage(modelOptions.usageContext, usage, cost.totalCost, false);
      return {
        model: "simulated-compose",
        message: { role: "assistant" as const, content: "", calls: [] },
      };
    },
    analyze: duckdb.runAnalysis,
    distribution: duckdb.scoreDistribution,
    absence: duckdb.absenceStats,
    chart: chartTools.executeChartTool,
    search: knowledge.searchKnowledge,
    settings: () => ({ enabled: true, maxToolCalls: 6, timeoutSeconds: 60 }),
    capability: () => ({ status: "supported" as const, checkedAt: null }),
  };
  const requestId = crypto.randomUUID();
  const started = performance.now();
  try {
    const response = await unified.converseUnified(options.input, { requestId }, deps);
    const durationMs = Math.round(performance.now() - started);
    const checks = [
      ...options.check(response, calls),
      ...requestLevelChecks(response, calls, requestId),
    ];
    if (response.usage && response.usage.modelCalls !== simulatedCalls)
      checks.push({
        name: "usage.modelCalls matches simulated model turns",
        passed: false,
        detail: `usage=${response.usage.modelCalls} simulated=${simulatedCalls}`,
      });
    return summarizeScenario({
      id: options.id,
      label: options.label,
      response,
      durationMs,
      checks,
      model: "scripted-mock",
      catalogLabels,
    });
  } catch (error) {
    return summarizeScenario({
      id: options.id,
      label: options.label,
      durationMs: Math.round(performance.now() - started),
      checks: [],
      error,
      model: "scripted-mock",
    });
  }
}

async function runLiveScenario(options: {
  id: string;
  label: string;
  input: Record<string, unknown> | (() => Promise<Record<string, unknown>>);
  check: (response: ChatResponse) => Check[];
}): Promise<ScenarioReport> {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  try {
    const input = typeof options.input === "function" ? await options.input() : options.input;
    const response = await unified.converseUnified(input, { requestId }, liveDeps);
    const durationMs = Math.round(performance.now() - started);
    return summarizeScenario({
      id: options.id,
      label: options.label,
      response,
      durationMs,
      checks: [...options.check(response), ...liveRequestLevelChecks(response, requestId)],
      model: liveModel,
      catalogLabels,
    });
  } catch (error) {
    return summarizeScenario({
      id: options.id,
      label: options.label,
      durationMs: Math.round(performance.now() - started),
      checks: [],
      error,
      model: liveModel,
    });
  }
}

function sortedCatalog(distribution: Awaited<ReturnType<DuckdbModule["scoreDistribution"]>>) {
  return {
    courses: [...new Set(distribution.groups.map((group) => group.course))].sort(),
    terms: [...new Set(distribution.groups.map((group) => group.term))].sort(),
  };
}

describe.skipIf(!ENABLED).sequential("unified conversation evaluation", () => {
  beforeAll(async () => {
    startedAt = new Date().toISOString();
    vi.stubEnv("DEMO_DATA_DIR", DATA_DIR);
    if (MOCK) {
      stateDirectory = mkdtempSync(join(tmpdir(), "analytics-unified-eval-"));
      vi.stubEnv("APP_STATE_DIR", stateDirectory);
      // Mock mode must be fully offline: any unexpected fetch is a test failure.
      fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        throw new Error("network access is forbidden in AI_EVAL_UNIFIED_MOCK mode");
      });
    } else {
      envFile = loadEnvFile();
    }
    vi.resetModules();
    [unified, duckdb, chartTools, knowledge, analysisSettings, aiSettings, toolProvider, aiCost] =
      await Promise.all([
        import("../lib/ai/unified"),
        import("../lib/analysis/duckdb"),
        import("../lib/ai/chart-tools"),
        import("../lib/ai/knowledge"),
        import("../lib/settings/analysis"),
        import("../lib/settings/ai"),
        import("../lib/ai/tool-provider"),
        import("../lib/security/ai-cost"),
      ]);
    const catalog = sortedCatalog(await duckdb.scoreDistribution(DATASET));
    catalogCourses = catalog.courses;
    catalogTerms = catalog.terms;
    catalogLabels = [...catalog.courses, ...catalog.terms];
    latestTerm = catalog.terms.at(-1)!;
    previousTerm = catalog.terms.at(-2)!;
    if (LIVE) {
      const config = aiSettings.getAIConfig();
      const settings = analysisSettings.getAnalysisSettings();
      if (!config.enabled || !config.keyConfigured || !config.model)
        throw new Error(
          "真实评测需要已开启、已保存密钥且模型名非空的 AI 配置（可写 .env.local）。",
        );
      if (config.pricing.inputPerMillion === null || config.pricing.outputPerMillion === null)
        throw new Error("真实评测需要配置输入/输出 token 单价，才能记录费用。");
      if (!settings.enabled) throw new Error("AI 对话分析已停用，请先在设置中开启。");
      liveModel = config.model;
      let capabilityStatus = analysisSettings.getAnalysisCapability().status;
      if (capabilityStatus !== "supported") {
        // Verify tool calling once when the stored capability is unknown/failed.
        await toolProvider.probeToolCalling();
        capabilityStatus = "supported";
      }
      liveDeps = {
        generate: toolProvider.generateToolTurn,
        compose: toolProvider.generateToolTurn,
        analyze: duckdb.runAnalysis,
        distribution: duckdb.scoreDistribution,
        absence: duckdb.absenceStats,
        chart: chartTools.executeChartTool,
        search: knowledge.searchKnowledge,
        settings: analysisSettings.getAnalysisSettings,
        capability: () => ({ status: capabilityStatus as "supported", checkedAt: null }),
      };
    }
  }, 180_000);

  afterAll(() => {
    fetchSpy?.mockRestore();
    if (stateDirectory) {
      rmSync(stateDirectory, { recursive: true, force: true });
      stateDirectory = null;
    }
    vi.unstubAllEnvs();
    if (!ENABLED || !reports.length) return;
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const report = buildReport({
      mode: (MOCK ? "mock" : "live") as EvalMode,
      startedAt,
      dataset: DATASET,
      dataDir: DATA_DIR,
      model: MOCK ? "scripted-mock" : liveModel,
      envFile,
      scenarios: reports,
    });
    writeFileSync(
      join(OUTPUT_DIR, reportFileName(MOCK ? "mock" : "live", startedAt)),
      JSON.stringify(report, null, 2),
    );
  });

  describe.skipIf(!MOCK).sequential("mock mode: scripted tool turns + real DuckDB", () => {
    it("binds an aggregate result to a natural answer and drops invented numbers", async () => {
      const report = await runMockScenario({
        id: "aggregate-natural-answer",
        label: "聚合结果 + 自然回答绑定",
        input: { question: `${latestTerm} 各门课程的平均成绩怎么样？`, datasetId: DATASET },
        handler: (messages) => {
          if (!lastToolPayload(messages))
            return toolTurn("aggregate", { metric: "score", dimension: "course", filters: [] });
          const fact = digestFacts(messages)[0];
          return answerTurn(
            fact
              ? `按本轮实际统计，${cite(fact)}。另外平均分大约是 987654 分。`
              : "本轮没有得到可引用的统计事实。",
          );
        },
        check: (response) => {
          const binding = factBinding(response);
          const analysis = (response.artifacts ?? []).find(
            (artifact) => artifact.kind === "analysis",
          );
          const fact = response.factRefs?.[0];
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            { name: "kind is result", passed: response.kind === "result" },
            { name: "analysis artifact present", passed: Boolean(analysis) },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "answer carries a program-verified number",
              passed: answerHasVerifiedNumber(
                response.answer,
                catalogLabels,
                verifiedText(response),
              ),
              detail: fact?.numeric ? `${fact.numeric.value}${fact.numeric.unit}` : "",
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
            {
              name: "dropped unverified sentence is disclosed",
              passed: (response.warning ?? "").includes("未核验"),
            },
            { name: "two scripted model turns billed", passed: response.usage?.modelCalls === 2 },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 120_000);

    it("follows compare_terms output into a dependent distribution query", async () => {
      let expectedCourse = "";
      let expectedTerm = "";
      const report = await runMockScenario({
        id: "compare-dependent-distribution",
        label: "比较 → 依赖上一轮结果的成绩分布",
        input: {
          question: `比较${previousTerm}和${latestTerm}，找出均分下降最多的课程，再看它在${latestTerm}的成绩分布。`,
          datasetId: DATASET,
        },
        handler: (messages) => {
          const payload = lastToolPayload(messages);
          if (!payload)
            return toolTurn("compare_terms", {
              beforeTerm: previousTerm,
              afterTerm: latestTerm,
              courses: [],
            });
          if ("largestDecline" in payload) {
            const decline = payload.largestDecline as {
              course?: string;
              afterTerm?: string;
            } | null;
            const rows = Array.isArray(payload.rows)
              ? (payload.rows as Record<string, unknown>[])
              : [];
            expectedCourse = decline?.course ?? String(rows[0]?.课程 ?? "");
            expectedTerm = decline?.afterTerm ?? latestTerm;
            return toolTurn("score_distribution", {
              course: expectedCourse,
              term: expectedTerm,
              binWidth: 5,
            });
          }
          const fact = digestFacts(messages).find((item) => item.semantic?.largestDecline);
          return answerTurn(
            fact
              ? `${previousTerm}到${latestTerm}，${fact.semantic!.subject}均分下降最多，下降${cite(fact)}。`
              : "对比完成，但没有可引用事实。",
          );
        },
        check: (response) => {
          const kinds = (response.artifacts ?? []).map((artifact) => artifact.kind);
          const studio = (response.artifacts ?? []).find(
            (artifact) => artifact.kind === "studio" && artifact.tool === "dumbbell",
          );
          const distribution = (response.artifacts ?? []).find(
            (artifact) => artifact.kind === "distribution",
          );
          const binding = factBinding(response);
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            {
              name: "comparison tool produced a measurable decline",
              passed: Boolean(expectedCourse),
              detail: `course=${expectedCourse} term=${expectedTerm}`,
            },
            {
              name: "artifacts are comparison then distribution",
              passed: kinds.join(",") === "studio,distribution",
              detail: kinds.join(","),
            },
            { name: "comparison is a dumbbell studio chart", passed: Boolean(studio) },
            {
              name: "distribution reused the real decline scope",
              passed:
                distribution?.kind === "distribution" &&
                distribution.course === expectedCourse &&
                distribution.term === expectedTerm,
              detail:
                distribution?.kind === "distribution"
                  ? `${distribution.course}/${distribution.term}`
                  : "missing",
            },
            { name: "two resultRefs returned", passed: (response.resultRefs?.length ?? 0) === 2 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
            { name: "three scripted model turns billed", passed: response.usage?.modelCalls === 3 },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 120_000);

    it("executes an explicitly requested chart tool", async () => {
      const report = await runMockScenario({
        id: "explicit-chart",
        label: "明确图表请求 → 受控图表工具",
        input: { question: `请用箱线图展示${latestTerm}各课程的成绩分布。`, datasetId: DATASET },
        handler: (messages) => {
          if (!lastToolPayload(messages))
            return toolTurn("advanced_chart", {
              tool: "boxplot",
              courses: [],
              term: latestTerm,
              comparisonTerm: null,
              threshold: 60,
              view: "chart",
            });
          const fact = digestFacts(messages)[0];
          return answerTurn(fact ? `图表说明：${cite(fact)}。` : "图表已生成。");
        },
        check: (response) => {
          const studio = (response.artifacts ?? []).find((artifact) => artifact.kind === "studio");
          const binding = factBinding(response);
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            {
              name: "studio chart artifact present",
              passed: studio?.kind === "studio" && studio.tool === "boxplot",
              detail: studio?.kind === "studio" ? studio.tool : "missing",
            },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
            { name: "two scripted model turns billed", passed: response.usage?.modelCalls === 2 },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 120_000);

    it("answers an absence question with measured results, not a substituted metric", async () => {
      const report = await runMockScenario({
        id: "absence",
        label: "缺勤统计（真实单位，不替换活动量）",
        input: { question: `${latestTerm} 缺勤课时是多少？`, datasetId: DATASET },
        handler: (messages) => {
          if (!lastToolPayload(messages))
            return toolTurn("absence_stats", {
              metric: "absence",
              unit: "sessions",
              term: latestTerm,
            });
          const fact = digestFacts(messages)[0];
          return answerTurn(fact ? `${cite(fact)}` : "当前数据没有可用的缺勤字段。");
        },
        check: (response) => {
          const binding = factBinding(response);
          const absence = (response.resultRefs ?? []).find((result) => result.kind === "absence");
          const corpus = `${response.facts.join(" ")} ${verifiedText(response)}`;
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            { name: "absence resultRef present", passed: Boolean(absence) },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            { name: "answer discusses absence", passed: /缺勤/.test(corpus) },
            { name: "no activity substitution", passed: !/活跃/.test(corpus) },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
            { name: "two scripted model turns billed", passed: response.usage?.modelCalls === 2 },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 120_000);

    it("refuses unsupported knowledge instead of inventing a rule", async () => {
      const report = await runMockScenario({
        id: "knowledge-refusal",
        label: "知识库无依据时如实拒绝",
        input: { question: "量子力学实验的教学管理规范是什么？", datasetId: DATASET },
        handler: (messages) =>
          lastToolPayload(messages)
            ? answerTurn("当前知识库没有找到适用依据。")
            : toolTurn("search_knowledge", { query: "量子力学实验教学管理规范" }),
        check: (response) => {
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          const searchStep = (response.steps ?? []).find(
            (step) => step.label === "检索指标与教学依据" && step.status === "completed",
          );
          return [
            {
              name: "knowledge search ran before answering",
              passed: Boolean(searchStep),
              detail: (response.steps ?? []).map((step) => step.label).join(","),
            },
            {
              name: "no citations were fabricated",
              passed: (response.citations?.length ?? 0) === 0,
            },
            {
              name: "no statistical result was returned",
              passed: (response.resultRefs?.length ?? 0) === 0,
            },
            {
              name: "answer states the missing evidence",
              passed: response.answer.includes("没有找到适用依据"),
              detail: response.answer.slice(0, 120),
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
            { name: "two scripted model turns billed", passed: response.usage?.modelCalls === 2 },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 120_000);

    it("inherits confirmed context and history into a multi-turn follow-up", async () => {
      let inheritedPayload: Record<string, unknown> | null = null;
      let sawPreviousResults = false;
      const report = await runMockScenario({
        id: "followup-context-inheritance",
        label: "连续追问继承已确认条件（并覆盖学期）",
        input: {
          question: `再按课程看一下 ${previousTerm} 的平均成绩。`,
          datasetId: DATASET,
          history: [
            { role: "user", content: `先看 ${latestTerm} 各课程平均成绩。` },
            {
              role: "assistant",
              content: "已返回按课程汇总的平均成绩。",
              results: [
                {
                  resultId: "r-0123456789abcdef",
                  kind: "aggregate",
                  label: "模拟校园数据 · 平均成绩",
                },
              ],
            },
          ],
          context: {
            kind: "analysis",
            metric: "score",
            dimension: "course",
            filters: [{ field: "term", op: "eq", value: latestTerm }],
            sort: { by: "value", direction: "desc" },
            limit: 100,
            view: "bar",
          },
        },
        handler: (messages) => {
          if (!lastToolPayload(messages)) {
            inheritedPayload = structuredInput(messages);
            sawPreviousResults = Array.isArray(inheritedPayload?.previousResults);
            return toolTurn("aggregate", {
              metric: "score",
              dimension: "course",
              filters: [{ field: "term", op: "eq", value: previousTerm }],
            });
          }
          const fact = digestFacts(messages)[0];
          return answerTurn(fact ? `沿用上一轮的指标和维度：${cite(fact)}。` : "已返回结果。");
        },
        check: (response) => {
          const binding = factBinding(response);
          const context = response.context;
          const analysis = (response.artifacts ?? []).find(
            (artifact) => artifact.kind === "analysis",
          );
          const scopeText = JSON.stringify([response.artifacts, response.facts, response.context]);
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            {
              name: "engine sent confirmedContext to the model",
              passed:
                Boolean(inheritedPayload?.confirmedContext) &&
                JSON.stringify(inheritedPayload?.confirmedContext).includes("score"),
            },
            { name: "engine sent previousResults to the model", passed: sawPreviousResults },
            {
              name: "answer keeps the inherited metric/dimension",
              passed:
                context?.kind === "analysis" &&
                context.metric === "score" &&
                context.dimension === "course",
              detail: JSON.stringify(context),
            },
            {
              name: "follow-up overrides only the term",
              passed: scopeText.includes(previousTerm),
            },
            { name: "analysis artifact present", passed: Boolean(analysis) },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
            { name: "two scripted model turns billed", passed: response.usage?.modelCalls === 2 },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 120_000);

    it("records a requestId in cost history and aggregates usage once per model call", async () => {
      vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-secret");
      vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
      vi.stubEnv("OPENAI_BASE_URL", "");
      const call = async (requestId: string) => {
        const usageContext: RequestUsage = {
          modelCalls: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          estimated: false,
        };
        let failure: unknown;
        try {
          await toolProvider.generateToolTurn(
            [{ role: "user", content: "请直接回答，不要调用工具。" }],
            [],
            { usageContext, requestId, maxTokens: 32 },
          );
        } catch (error) {
          failure = error;
        }
        return { usageContext, failure };
      };

      fakeOpenAI.calls = 0;
      fakeOpenAI.mode = "success";
      const successRequestId = crypto.randomUUID();
      const success = await call(successRequestId);
      expect(success.failure).toBeUndefined();
      expect(success.usageContext).toMatchObject({
        modelCalls: 1,
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
        estimated: false,
      });
      expect(success.usageContext.costUsd).toBeCloseTo(
        aiCost.calculateCost(
          "gpt-4o-mini",
          { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
          { inputPerMillion: 0.15, outputPerMillion: 0.6 },
        ).totalCost,
        12,
      );

      fakeOpenAI.mode = "fail";
      const failedRequestId = crypto.randomUUID();
      const failed = await call(failedRequestId);
      expect(failed.failure).toBeInstanceOf(Error);
      expect(failed.usageContext).toMatchObject({ modelCalls: 1, estimated: true });
      expect(fakeOpenAI.calls).toBe(2);

      const history = JSON.parse(
        readFileSync(join(stateDirectory!, "cost-history.json"), "utf8"),
      ) as {
        records: Array<{
          requestId?: string;
          endpoint: string;
          usageEstimated?: boolean;
          usage: { promptTokens: number; completionTokens: number; totalTokens: number };
        }>;
      };
      const successRecord = history.records.find((record) => record.requestId === successRequestId);
      const failedRecord = history.records.find((record) => record.requestId === failedRequestId);
      expect(successRecord).toMatchObject({
        endpoint: "chat",
        usageEstimated: false,
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      });
      expect(failedRecord).toMatchObject({ endpoint: "chat", usageEstimated: true });
    }, 120_000);
  });

  describe.skipIf(!LIVE).sequential("live mode: real model + real DuckDB", () => {
    it("answers a question that needs no tool", async () => {
      const report = await runLiveScenario({
        id: "direct-answer",
        label: "无需工具的直接回答",
        input: {
          question: "用两三句话说明你能帮我做什么，不需要查询任何数据。",
          datasetId: DATASET,
        },
        check: (response) => {
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            { name: "no statistical artifact", passed: (response.artifacts?.length ?? 0) === 0 },
            { name: "no resultRefs", passed: (response.resultRefs?.length ?? 0) === 0 },
            { name: "answer is prose", passed: response.answer.trim().length >= 10 },
            {
              name: "unverified digits are disclosed instead of asserted",
              passed: invented.length === 0 || (response.warning ?? "").includes("未核验"),
              detail: invented.join(","),
            },
            {
              name: "planning note does not claim tool evidence",
              passed: !response.planning.rationale.includes("服务端工具结果"),
              detail: response.planning.rationale,
            },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 180_000);

    it("answers an aggregate question with a grounded natural answer", async () => {
      const report = await runLiveScenario({
        id: "aggregate-natural-answer",
        label: "聚合 + 自然回答",
        input: {
          question: `${latestTerm} 各门课程的平均成绩怎么样？请用自然语言总结，不要罗列所有课程。`,
          datasetId: DATASET,
        },
        check: (response) => {
          const binding = factBinding(response);
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          // Placeholders now render as value + unit inside the model's sentence,
          // so "communicates a verified fact" means at least one number in the
          // answer is supported by the verified corpus.
          // Only a number bound to a verified fact counts. A merely qualitative
          // summary (or a template fallback) must not pass this check; naming a
          // real group alone is not evidence that a statistic was reported.
          const citesFact = answerHasVerifiedNumber(
            response.answer,
            catalogLabels,
            verifiedText(response),
          );
          const natural =
            !response.answer.startsWith("已按实际数据完成以下分析：") &&
            !response.answer.startsWith("本轮仅完成部分分析") &&
            naturalProseChars(response.answer, response, catalogLabels) >= 6;
          return [
            { name: "kind is result", passed: response.kind === "result", detail: response.kind },
            { name: "completion is complete", passed: response.completion === "complete" },
            {
              name: "analysis artifact present",
              passed: (response.artifacts ?? []).some((a) => a.kind === "analysis"),
            },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "answer is natural prose, not the template",
              passed: natural,
              detail: response.answer.slice(0, 160),
            },
            { name: "answer cites a verified number", passed: citesFact },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 180_000);

    it("inherits confirmed scope into a follow-up and overrides the term", async () => {
      const report = await runLiveScenario({
        id: "followup-context-inheritance",
        label: "连续追问继承课程/学期条件",
        input: async () => {
          const first = await unified.converseUnified(
            {
              question: `${latestTerm} 各门课程的平均成绩怎么样？`,
              datasetId: DATASET,
            },
            { requestId: crypto.randomUUID() },
            liveDeps,
          );
          const history = [
            { role: "user" as const, content: `${latestTerm} 各门课程的平均成绩怎么样？` },
            {
              role: "assistant" as const,
              content: first.answer.slice(0, 2800),
              results: (first.resultRefs ?? []).slice(0, 4).map((result) => ({
                resultId: result.resultId,
                kind: result.kind,
                label: result.scopeLabel.slice(0, 200),
              })),
            },
          ];
          const context = first.context;
          if (!context)
            throw new Error("第一轮没有返回可继承的 confirmed context，无法评测连续追问。");
          return {
            question: `那换成 ${previousTerm} 呢？还是按课程看平均成绩。`,
            datasetId: DATASET,
            history,
            context,
          };
        },
        check: (response) => {
          const binding = factBinding(response);
          const context = response.context;
          const scopeText = JSON.stringify([response.artifacts, response.facts, response.context]);
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            { name: "kind is result", passed: response.kind === "result", detail: response.kind },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "inherits the previous metric and dimension",
              passed:
                context?.kind === "analysis" &&
                context.metric === "score" &&
                context.dimension === "course",
              detail: JSON.stringify(context),
            },
            {
              name: "applies the overridden term",
              passed: scopeText.includes(previousTerm),
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 240_000);

    it("explains a term comparison with a bound decline number", async () => {
      const independent = comparisonFromCsv(
        readFileSync(join(DATA_DIR, "student_outcomes.csv"), "utf8"),
        previousTerm,
        latestTerm,
      );
      expect(independent, "sample CSV must contain a comparable decline").not.toBeNull();
      const report = await runLiveScenario({
        id: "compare-natural-answer",
        label: "学期比较 + 自然回答",
        input: {
          question: `比较${previousTerm}和${latestTerm}，找出均分下降最多的课程，并说明下降幅度。`,
          datasetId: DATASET,
        },
        check: (response) => {
          const binding = factBinding(response);
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          const hasComparison = (response.artifacts ?? []).some(
            (artifact) => artifact.kind === "studio" && artifact.tool === "dumbbell",
          );
          const natural =
            !response.answer.startsWith("已按实际数据完成以下分析：") &&
            !response.answer.startsWith("本轮仅完成部分分析") &&
            naturalProseChars(response.answer, response, catalogLabels) >= 6;
          return [
            ...comparisonAnswerChecks(response.answer, independent!),
            { name: "comparison artifact present", passed: hasComparison },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "answer covers both terms",
              passed:
                response.answer.includes(previousTerm) && response.answer.includes(latestTerm),
            },
            {
              name: "answer is natural prose, not the template",
              passed: natural,
              detail: response.answer.slice(0, 160),
            },
            {
              name: "answer cites a verified number",
              passed: answerHasVerifiedNumber(
                response.answer,
                catalogLabels,
                verifiedText(response),
              ),
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 180_000);

    it("generates an explicitly requested chart", async () => {
      const report = await runLiveScenario({
        id: "explicit-chart",
        label: "明确图表请求",
        input: {
          question: `请用箱线图展示${latestTerm}各课程的成绩分布。`,
          datasetId: DATASET,
        },
        check: (response) => {
          const binding = factBinding(response);
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          const hasChart = (response.artifacts ?? []).some(
            (artifact) =>
              artifact.kind === "studio" ||
              (artifact.kind === "analysis" && artifact.view !== "table"),
          );
          return [
            {
              name: "chart artifact present",
              passed: hasChart,
              detail: (response.artifacts ?? []).map((a) => a.kind).join(","),
            },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 180_000);

    it("answers an absence question from measured absence data", async () => {
      const report = await runLiveScenario({
        id: "absence",
        label: "缺勤问题",
        input: {
          question: `${latestTerm} 缺勤课时最多的是哪些课程？`,
          datasetId: DATASET,
        },
        check: (response) => {
          const binding = factBinding(response);
          const absence = (response.resultRefs ?? []).some((result) => result.kind === "absence");
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          const corpus = `${response.facts.join(" ")} ${response.answer}`;
          return [
            { name: "absence resultRef present", passed: absence },
            { name: "resultRefs present", passed: (response.resultRefs?.length ?? 0) >= 1 },
            {
              name: "factRefs bind to returned results",
              passed: binding.ok,
              detail: binding.dangling.join(","),
            },
            { name: "answer discusses absence", passed: /缺勤/.test(corpus) },
            { name: "does not substitute activity", passed: !/活跃次数/.test(corpus) },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 180_000);

    it("cites versioned knowledge for a definition question", async () => {
      const report = await runLiveScenario({
        id: "knowledge-citations",
        label: "知识依据问题（必须有引用）",
        input: { question: "完成率和出勤率有什么区别？", datasetId: DATASET },
        check: (response) => {
          const invented = inventedNumbers(response.answer, catalogLabels, verifiedText(response));
          return [
            { name: "citations present", passed: (response.citations?.length ?? 0) > 0 },
            { name: "answer has content", passed: response.answer.trim().length >= 10 },
            {
              name: "no invented number in the answer",
              passed: invented.length === 0,
              detail: invented.join(","),
            },
          ];
        },
      });
      reports.push(report);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
    }, 180_000);
  });
});
