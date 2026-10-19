import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { converseComprehensive, type ComprehensiveDependencies } from "./comprehensive";
import type { ToolMessage, ToolTurn } from "./tool-provider";
import type { AnalysisStep } from "./chat-types";
import { executeChartTool } from "./chart-tools";
import { searchKnowledge } from "./knowledge";
import { QueryExecutionError } from "../security/query-execution";
import { BudgetExceededError } from "../security/ai-cost";

const call = (name: string, args: unknown, id = crypto.randomUUID()): ToolTurn => ({
  model: "fixture",
  message: {
    role: "assistant",
    content: "",
    calls: [{ id, name, arguments: JSON.stringify(args) }],
  },
});
const finish: ToolTurn = {
  model: "fixture",
  message: { role: "assistant", content: "模型编造数字 999 分，教学原因已经确认。", calls: [] },
};
const question = "比较2024B和2024J，找出均分下降最多的课程，再看它的成绩分布和比较口径";
describe("controlled multi-step analysis with real DuckDB", () => {
  let directory: string;
  let real: typeof import("../analysis/duckdb");
  let deps: ComprehensiveDependencies;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "phase2-data-"));
    const records = ["id_student,code_module,code_presentation,score,completed"];
    for (const [course, before, after] of [
      ["AAA", [90, 80, 70], [60, 50, 40]],
      ["BBB", [60, 70, 80], [70, 80, 90]],
    ] as const) {
      for (const [term, scores] of [
        ["2024B", before],
        ["2024J", after],
      ] as const)
        scores.forEach((score, index) => records.push(`S${index},${course},${term},${score},1`));
    }
    writeFileSync(join(directory, "student_outcomes.csv"), records.join("\n"));
    copyFileSync(
      "data/fixtures/golden/learning_activity.csv",
      join(directory, "learning_activity.csv"),
    );
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.stubEnv("APP_STATE_DIR", join(directory, "state"));
    vi.resetModules();
    real = await import("../analysis/duckdb");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  beforeEach(() => {
    deps = {
      generate: vi.fn(),
      analyze: vi.fn(real.runAnalysis),
      distribution: vi.fn(real.scoreDistribution),
      chart: vi.fn(executeChartTool),
      search: searchKnowledge,
      settings: () => ({ enabled: true, maxToolCalls: 6, timeoutSeconds: 60 }),
      capability: () => ({ status: "supported", checkedAt: null }),
    };
  });
  function sequence(...turns: ToolTurn[]) {
    for (const turn of turns) vi.mocked(deps.generate).mockResolvedValueOnce(turn);
  }
  it("uses the real comparison result to choose a later distribution and returns multiple verified results", async () => {
    sequence(call("compare_terms", { beforeTerm: "2024B", afterTerm: "2024J", courses: [] }));
    vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
      const result = JSON.parse(messages.at(-1)!.content);
      expect(result.largestDecline).toEqual({ course: "AAA", afterTerm: "2024J" });
      expect(result.rows[0]).toMatchObject({
        前期均分: 80,
        后期均分: 50,
        变化: -30,
        前期人数: 3,
        后期人数: 3,
      });
      return call("score_distribution", {
        ...result.largestDecline,
        term: result.afterTerm,
        binWidth: 5,
        afterTerm: undefined,
      });
    });
    sequence(call("search_knowledge", { query: "跨学期比较口径" }), finish);
    const events: AnalysisStep[] = [];
    const result = await converseComprehensive(
      { question, datasetId: "demo" },
      { onStep: (step) => events.push(step) },
      deps,
    );
    expect(result.artifacts?.map((item) => item.kind)).toEqual(["studio", "distribution"]);
    expect(result.answer).toContain("下降 30 分");
    expect(result.answer).not.toContain("999");
    expect(result.answer).not.toContain("原因已经确认");
    expect(result.context).toMatchObject({ course: "AAA", term: "2024J" });
    expect(result.citations?.some((item) => item.id === "comparison-scope")).toBe(true);
    expect(result.steps?.every((step) => step.status === "completed")).toBe(true);
    for (const step of result.steps!)
      expect(events.filter((event) => event.id === step.id).map((event) => event.status)).toEqual([
        "running",
        "completed",
      ]);
  });
  it("honors an explicit target term even when the model reverses the comparison", async () => {
    sequence(
      call("compare_terms", { beforeTerm: "2024J", afterTerm: "2024B", courses: [] }),
      finish,
    );
    const result = await converseComprehensive(
      { question: "比较2024B和2024J，看它在2024J的成绩分布", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).toContain("2024B → 2024J");
    expect(result.answer).toContain("下降 30 分");
    expect(result.completion).toBe("partial");
  });
  it("treats a text-only model turn without evidence as a request for clarification", async () => {
    sequence(finish);
    const result = await converseComprehensive(
      { question: "本学期哪个课程下降最多", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("clarification");
    expect(result.answer).not.toContain("999");
  });
  it("can answer sourced definitions when the statistical data source is unavailable", async () => {
    vi.mocked(deps.distribution).mockRejectedValue(
      new QueryExecutionError("DATA_SOURCE_UNAVAILABLE", "missing"),
    );
    sequence(call("search_knowledge", { query: "完成率和出勤率有什么区别" }), finish);
    const result = await converseComprehensive(
      { question: "完成率和出勤率有什么区别", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.citations!.length).toBeGreaterThan(0);
    expect(result.answer).toContain("不同指标");
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("does not turn an increase into a decline and prevents a wrong dependent query", async () => {
    sequence(
      call("compare_terms", { beforeTerm: "2024B", afterTerm: "2024J", courses: ["BBB"] }),
      call("score_distribution", { course: "BBB", term: "2024J", binWidth: 5 }),
    );
    const result = await converseComprehensive({ question, datasetId: "demo" }, {}, deps);
    expect(result.answer).toContain("没有均分下降");
    expect(result.completion).toBe("partial");
    expect(result.artifacts).toHaveLength(1);
    expect(result.failureCode).toBe("AI_TOOL_INVALID");
  });
  it("stops repeated arguments even if JSON keys are reordered", async () => {
    sequence(
      call("aggregate", { metric: "score", dimension: "course", filters: [] }),
      call("aggregate", { filters: [], dimension: "course", metric: "score" }),
    );
    const result = await converseComprehensive(
      { question: "看看各课程成绩", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.failureCode).toBe("AI_TOOL_DUPLICATE");
    expect(deps.analyze).toHaveBeenCalledTimes(1);
  });
  it("checks the limit inside a multi-call response and keeps earlier successful results", async () => {
    deps.settings = () => ({ enabled: true, maxToolCalls: 2, timeoutSeconds: 60 });
    const turn = call("aggregate", { metric: "score", dimension: "course", filters: [] });
    turn.message.calls!.push(
      ...call("search_knowledge", { query: "平均成绩" }).message.calls!,
      ...call("score_distribution", { course: "AAA", term: "2024J", binWidth: 5 }).message.calls!,
    );
    sequence(turn);
    const result = await converseComprehensive({ question, datasetId: "demo" }, {}, deps);
    expect(result.failureCode).toBe("AI_TOOL_LIMIT");
    expect(result.artifacts).toHaveLength(1);
    expect(deps.distribution).toHaveBeenCalledTimes(1);
  });
  it("does not execute unknown tools or invalid labels", async () => {
    sequence(call("execute_sql", { sql: "select * from students" }));
    await expect(
      converseComprehensive({ question, datasetId: "demo" }, {}, deps),
    ).rejects.toMatchObject({ code: "AI_TOOL_INVALID" });
    expect(deps.analyze).not.toHaveBeenCalled();
    vi.mocked(deps.generate).mockReset();
    sequence(call("score_distribution", { course: "missing", term: "2024J", binWidth: 5 }));
    await expect(
      converseComprehensive({ question, datasetId: "demo" }, {}, deps),
    ).rejects.toMatchObject({ code: "AI_TOOL_INVALID" });
  });
  it("asks for missing scope without executing a statistical query", async () => {
    sequence(call("clarify", { question: "请指定前后两个学期。" }));
    const result = await converseComprehensive(
      { question: "本学期哪个课程下降最多", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("clarification");
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("uses one budget context across all model rounds and preserves results on budget failure", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }));
    vi.mocked(deps.generate).mockImplementationOnce(async (_messages, _tools, options) => {
      options!.budgetContext!.spent = 0.05;
      throw new BudgetExceededError("单次请求", 0.2, 0.1);
    });
    const result = await converseComprehensive({ question, datasetId: "demo" }, {}, deps);
    expect(result.failureCode).toBe("AI_BUDGET_EXCEEDED");
    const contexts = vi.mocked(deps.generate).mock.calls.map((args) => args[2]!.budgetContext);
    expect(contexts[0]).toBe(contexts[1]);
  });
  it("cancels during a model turn, emits a cancelled step and starts no tool", async () => {
    const abort = new AbortController();
    const events: AnalysisStep[] = [];
    vi.mocked(deps.generate).mockImplementationOnce(async () => {
      abort.abort();
      throw new QueryExecutionError("CANCELLED", "cancelled");
    });
    await expect(
      converseComprehensive(
        { question, datasetId: "demo" },
        { signal: abort.signal, onStep: (step) => events.push(step) },
        deps,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(events.at(-1)?.status).toBe("cancelled");
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("bounds the total elapsed time across model turns", async () => {
    deps.settings = () => ({ enabled: true, maxToolCalls: 6, timeoutSeconds: 0.01 });
    vi.mocked(deps.generate).mockImplementationOnce(
      async (_messages, _tools, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(new QueryExecutionError("CANCELLED", "cancelled")),
            { once: true },
          );
        }),
    );
    await expect(
      converseComprehensive({ question, datasetId: "demo" }, {}, deps),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("requires compatible and enabled configuration before any queries", async () => {
    deps.capability = () => ({ status: "unknown", checkedAt: null });
    await expect(converseComprehensive({ question, datasetId: "demo" }, {}, deps)).rejects.toThrow(
      "尚未通过",
    );
    expect(deps.distribution).not.toHaveBeenCalled();
  });
  it("provides cited definitions and refuses knowledge without evidence", async () => {
    sequence(call("search_knowledge", { query: "完成率和出勤率有什么区别" }), finish);
    const result = await converseComprehensive(
      { question: "完成率和出勤率有什么区别", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).toContain("不同指标");
    expect(result.citations!.length).toBeGreaterThan(0);
    expect(result.artifacts).toHaveLength(0);
    vi.mocked(deps.generate).mockReset();
    sequence(call("search_knowledge", { query: "量子力学校规" }), finish);
    const missing = await converseComprehensive(
      { question: "量子力学校规", datasetId: "demo" },
      {},
      deps,
    );
    expect(missing.answer).toContain("没有找到适用依据");
    expect(missing.citations).toHaveLength(0);
  });
});
