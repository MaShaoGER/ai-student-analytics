import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { converseUnified, type UnifiedDependencies } from "./unified";
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
const directAnswer: ToolTurn = {
  model: "fixture",
  message: {
    role: "assistant",
    content: "完成率是完成课程的学生数占符合统计条件学生数的比例，需要先确定统计口径。",
    calls: [],
  },
};
const question = "比较2024B和2024J，找出均分下降最多的课程，再看它的成绩分布和比较口径";
describe("controlled multi-step analysis with real DuckDB", () => {
  let directory: string;
  let real: typeof import("../analysis/duckdb");
  let deps: UnifiedDependencies;
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
      absence: vi.fn(real.absenceStats),
      chart: vi.fn(executeChartTool),
      search: searchKnowledge,
      // The corrective compose turn is scripted separately; empty text means
      // "no better answer", so the template fallback stays observable.
      compose: vi.fn(async () => ({
        model: "fixture",
        message: { role: "assistant" as const, content: "", calls: [] },
      })),
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
      // The rich comparison sentence is exposed to the model as a citable fact,
      // so it can use `{{factId}}` instead of writing the numbers itself.
      const comparisonFact = (result.facts as { factId: string; text: string }[]).find((fact) =>
        fact.text.includes("AAA均分下降最多"),
      );
      expect(comparisonFact?.factId).toMatch(/^f-[0-9a-f]{16}$/);
      return call("score_distribution", {
        ...result.largestDecline,
        term: result.afterTerm,
        binWidth: 5,
        afterTerm: undefined,
      });
    });
    sequence(call("search_knowledge", { query: "跨学期比较口径" }), finish);
    const events: AnalysisStep[] = [];
    const result = await converseUnified(
      { question, datasetId: "demo" },
      { onStep: (step) => events.push(step) },
      deps,
    );
    expect(result.artifacts?.map((item) => item.kind)).toEqual(["studio", "distribution"]);
    expect(result.planning.rationale).toContain("服务端工具结果");
    // The rich comparison sentence shown to the user is itself a verifiable fact:
    // the UI can show its factId and the natural-answer number check trusts its
    // numbers (30/80/50/3/3 in the fixture).
    const comparisonFact = result.factRefs?.find((fact) => fact.text.includes("AAA均分下降最多"));
    expect(comparisonFact).toBeTruthy();
    expect(comparisonFact!.numeric).toBeNull();
    expect(comparisonFact!.resultId).toBe(result.resultRefs![0].resultId);
    // The displayed comparison sentence is now exactly the fact text, which is
    // what the UI needs to render its factId.
    expect(result.facts).toContain(comparisonFact!.text);
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
    const result = await converseUnified(
      { question: "比较2024B和2024J，看它在2024J的成绩分布", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).toContain("2024B → 2024J");
    expect(result.answer).toContain("下降 30 分");
    // Completion is no longer inferred from the word "分布" in the question; the
    // model decided it had enough evidence and stopped.
    expect(result.completion).toBe("complete");
    expect(result.failureCode).toBeUndefined();
  });
  it("does not mark a question as incomplete just because it mentions 分布", async () => {
    sequence(directAnswer);
    const result = await converseUnified(
      { question: "各科成绩分布如何？", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("answer");
    expect(result.completion).toBe("complete");
    expect(result.failureCode).toBeUndefined();
  });
  it("returns a direct answer when the model calls no tool", async () => {
    // A turn without tool calls is the normal direct-answer path after the
    // merge; it must not be reported as "please specify the metric".
    sequence(directAnswer);
    const result = await converseUnified(
      { question: "完成率是什么意思", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("answer");
    expect(result.answer).toContain("完成率是完成课程");
    expect(result.answer).not.toContain("请明确要分析的指标");
    expect(result.artifacts).toHaveLength(0);
    expect(result.factRefs ?? []).toHaveLength(0);
    // The planning note shown in the UI must not claim tools were called.
    expect(result.planning.rationale).toContain("未经统计核验");
    expect(result.planning.rationale).not.toContain("服务端工具结果");
  });
  it("keeps the explicit clarify tool as the only way to request scope details", async () => {
    sequence(call("clarify", { question: "请说明想比较哪两个学期。" }), finish);
    const result = await converseUnified(
      { question: "本学期哪个课程下降最多", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("clarification");
    expect(result.answer).toBe("请说明想比较哪两个学期。");
  });
  it("can answer sourced definitions when the statistical data source is unavailable", async () => {
    vi.mocked(deps.distribution).mockRejectedValue(
      new QueryExecutionError("DATA_SOURCE_UNAVAILABLE", "missing"),
    );
    sequence(call("search_knowledge", { query: "完成率和出勤率有什么区别" }), finish);
    const result = await converseUnified(
      { question: "完成率和出勤率有什么区别", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.citations!.length).toBeGreaterThan(0);
    expect(result.answer).toContain("不同指标");
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("does not turn an increase into a decline, and no longer forces the compare→distribution order", async () => {
    sequence(
      call("compare_terms", { beforeTerm: "2024B", afterTerm: "2024J", courses: ["BBB"] }),
      call("score_distribution", { course: "BBB", term: "2024J", binWidth: 5 }),
      finish,
    );
    const result = await converseUnified({ question, datasetId: "demo" }, {}, deps);
    // The comparison result states honestly that nothing declined …
    expect(result.answer).toContain("没有均分下降");
    // … while the next tool call is not rejected by a hard-coded workflow rule:
    // the roadmap removes the fixed "largest decline → distribution" order, so
    // dependent-tool consistency is the model's responsibility, not a keyword check.
    expect(result.artifacts?.map((artifact) => artifact.kind)).toEqual(["studio", "distribution"]);
    expect(result.completion).toBe("complete");
    expect(result.failureCode).toBeUndefined();
  });
  it("stops repeated arguments even if JSON keys are reordered", async () => {
    sequence(
      call("aggregate", { metric: "score", dimension: "course", filters: [] }),
      call("aggregate", { filters: [], dimension: "course", metric: "score" }),
    );
    const result = await converseUnified(
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
    const result = await converseUnified({ question, datasetId: "demo" }, {}, deps);
    expect(result.failureCode).toBe("AI_TOOL_LIMIT");
    expect(result.artifacts).toHaveLength(1);
    expect(deps.distribution).toHaveBeenCalledTimes(1);
  });
  it("does not execute unknown tools or invalid labels", async () => {
    sequence(call("execute_sql", { sql: "select * from students" }));
    await expect(converseUnified({ question, datasetId: "demo" }, {}, deps)).rejects.toMatchObject({
      code: "AI_TOOL_INVALID",
    });
    expect(deps.analyze).not.toHaveBeenCalled();
    vi.mocked(deps.generate).mockReset();
    sequence(call("score_distribution", { course: "missing", term: "2024J", binWidth: 5 }));
    await expect(converseUnified({ question, datasetId: "demo" }, {}, deps)).rejects.toMatchObject({
      code: "AI_TOOL_INVALID",
    });
  });
  it("asks for missing scope without executing a statistical query", async () => {
    sequence(call("clarify", { question: "请指定前后两个学期。" }));
    const result = await converseUnified(
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
    const result = await converseUnified({ question, datasetId: "demo" }, {}, deps);
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
      converseUnified(
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
    await expect(converseUnified({ question, datasetId: "demo" }, {}, deps)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
  it("requires compatible and enabled configuration before any queries", async () => {
    deps.capability = () => ({ status: "unknown", checkedAt: null });
    await expect(converseUnified({ question, datasetId: "demo" }, {}, deps)).rejects.toThrow(
      "尚未通过",
    );
    expect(deps.distribution).not.toHaveBeenCalled();
  });
  it("answers absence questions in the unit that was asked, without substituting activity", async () => {
    // The fixture has no absence columns, so an implementation that substituted
    // activity or returned zero would silently look plausible. Expect refusal.
    sequence(call("absence_stats", { metric: "absence", unit: "sessions" }), finish);
    const result = await converseUnified(
      { question: "缺勤课时和成绩有关系吗？", datasetId: "demo" },
      {},
      deps,
    );
    expect(deps.absence).toHaveBeenCalledWith(
      { datasetId: "demo", metric: "absence", unit: "sessions" },
      expect.anything(),
    );
    // Either real numbers from the fixture or an explicit "no eligible group";
    // never a substituted activity metric and never a fabricated zero.
    const text = result.facts.join(" ");
    expect(text).toMatch(/缺勤|没有达到最小样本要求/);
    expect(text).not.toContain("活跃次数");
  });

  it("renders a pure absence answer as a result with identifiable facts, not a clarification", async () => {
    vi.mocked(deps.absence).mockResolvedValueOnce({
      datasetId: "demo",
      term: "2024J",
      terms: ["2024J"],
      course: null,
      metric: "absence",
      unit: "sessions",
      supported: true,
      unsupportedReason: null,
      rows: [{ course: "AAA", sessions: 40, students: 4 }],
      totals: {
        sessions: 40,
        studentCourseCount: 4,
        distinctStudents: 4,
        approvedLeaveDays: 7,
      },
      minutesPerPeriod: 45,
      minSampleSize: 3,
    });
    sequence(call("absence_stats", { metric: "absence", unit: "sessions", term: "2024J" }), finish);
    const result = await converseUnified(
      { question: "2024J 缺勤课时是多少？", datasetId: "demo" },
      {},
      deps,
    );
    // A real answer, not "please specify the metric/course/term".
    expect(result.kind).toBe("result");
    expect(result.answer).not.toContain("请明确要分析的指标");
    expect(result.facts.join(" ")).toContain("40");
    // The numbers are identified and bound, so the UI can show evidence.
    expect(result.resultRefs).toHaveLength(1);
    expect(result.resultRefs![0].kind).toBe("absence");
    expect(result.factRefs!.length).toBeGreaterThan(0);
    for (const fact of result.factRefs!) expect(fact.resultId).toBe(result.resultRefs![0].resultId);
    expect(result.artifacts).toHaveLength(0);
  });

  it("binds every displayed absence fact to a factId (no text drift)", async () => {
    vi.mocked(deps.absence).mockResolvedValueOnce({
      datasetId: "demo",
      term: "2024J",
      terms: ["2024J"],
      course: null,
      metric: "absence",
      unit: "sessions",
      supported: true,
      unsupportedReason: null,
      rows: [
        { course: "AAA", sessions: 40, students: 4 },
        { course: "BBB", sessions: 25, students: 3 },
      ],
      totals: { sessions: 65, studentCourseCount: 7, distinctStudents: 6, approvedLeaveDays: 9 },
      minutesPerPeriod: 45,
      minSampleSize: 3,
    });
    sequence(call("absence_stats", { metric: "absence", unit: "sessions", term: "2024J" }), finish);
    const result = await converseUnified(
      { question: "2024J 缺勤课时是多少？", datasetId: "demo" },
      {},
      deps,
    );
    const texts = new Set(result.factRefs!.map((fact) => fact.text));
    // Facts carrying a computed number; the closing limitation sentences have no
    // factId by design and are excluded on purpose.
    const numericFacts = result.facts.filter((fact) =>
      /AAA：|BBB：|全部课程合计|跨课程去重后/.test(fact),
    );
    expect(numericFacts.length).toBeGreaterThan(0);
    // Every number-bearing sentence shown to the user must resolve to a factId.
    for (const fact of numericFacts) expect(texts.has(fact)).toBe(true);
  });

  it("does not answer absence questions with activity data on OULAD", async () => {
    vi.mocked(deps.absence).mockResolvedValueOnce({
      datasetId: "oulad",
      term: null,
      terms: [],
      course: null,
      metric: "absence",
      unit: "sessions",
      supported: false,
      unsupportedReason: "OULAD 没有校园出勤字段。",
      rows: [],
      totals: { sessions: 0, studentCourseCount: 0, distinctStudents: 0, approvedLeaveDays: 0 },
      minutesPerPeriod: 45,
      minSampleSize: 3,
    });
    sequence(call("absence_stats", { metric: "absence", unit: "sessions" }), finish);
    const result = await converseUnified(
      { question: "缺勤课时和成绩有关系吗？", datasetId: "oulad" },
      {},
      deps,
    );
    expect(result.facts.join(" ")).toContain("OULAD 没有校园出勤字段");
    expect(result.facts.join(" ")).not.toContain("活跃");
    // Refusing with a reason is an explained answer, not a request to clarify,
    // and definitely not a "result": nothing was computed.
    expect(result.kind).toBe("answer");
    expect(result.answer).not.toContain("请明确要分析的指标");
    expect(result.answer).toContain("OULAD 没有校园出勤字段");
    expect(result.resultRefs ?? []).toHaveLength(0);
    expect(result.factRefs ?? []).toHaveLength(0);
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it("rejects absence labels outside the catalog before querying", async () => {
    sequence(call("absence_stats", { metric: "absence", unit: "sessions", course: "不存在的课" }));
    await expect(
      converseUnified({ question: "缺勤课时和成绩有关系吗？", datasetId: "demo" }, {}, deps),
    ).rejects.toMatchObject({ code: "AI_TOOL_INVALID" });
    expect(deps.absence).not.toHaveBeenCalled();
  });

  it("pushes the requested distribution scope into the query instead of filtering afterwards", async () => {
    sequence(call("score_distribution", { course: "AAA", term: "2024J", binWidth: 5 }), finish);
    const result = await converseUnified({ question, datasetId: "demo" }, {}, deps);
    // The third argument is the scope. Without it the whole dataset is read and
    // filtered in memory, which the roadmap explicitly forbids.
    expect(deps.distribution).toHaveBeenLastCalledWith("demo", expect.anything(), {
      course: "AAA",
      term: "2024J",
    });
    const artifact = result.artifacts?.find((item) => item.kind === "distribution");
    expect(artifact).toMatchObject({ kind: "distribution", course: "AAA", term: "2024J" });
    if (artifact?.kind === "distribution")
      expect(
        artifact.data.groups.every((group) => group.course === "AAA" && group.term === "2024J"),
      ).toBe(true);
  });

  it("passes real user/assistant roles and only structured context to the model", async () => {
    const seen: ToolMessage[][] = [];
    vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
      seen.push(structuredClone(messages));
      return call("aggregate", { metric: "score", dimension: "course", filters: [] });
    });
    vi.mocked(deps.generate).mockResolvedValueOnce(finish);
    const history = [
      { role: "user" as const, content: "先看看各课程成绩" },
      {
        role: "assistant" as const,
        content: "已返回 2 个分组。",
        results: [
          {
            resultId: "r-0123456789abcdef",
            kind: "aggregate" as const,
            label: "模拟校园数据 · 2024J · 平均成绩",
          },
        ],
      },
    ];
    const result = await converseUnified(
      {
        question: "那 2024J 呢",
        datasetId: "demo",
        history,
        context: {
          kind: "analysis",
          metric: "score",
          dimension: "course",
          filters: [],
          sort: { by: "value", direction: "desc" },
          limit: 100,
          view: "bar",
        },
      },
      {},
      deps,
    );
    expect(result.kind).toBe("result");
    const first = seen[0] ?? [];
    expect(first.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(first[1]).toMatchObject({ role: "user", content: "先看看各课程成绩" });
    expect(first[2]).toMatchObject({ role: "assistant", content: "已返回 2 个分组。" });
    const structured = JSON.parse(first[3].content);
    expect(structured).toMatchObject({ question: "那 2024J 呢", datasetId: "demo" });
    expect(structured.confirmedContext).toMatchObject({ kind: "analysis", metric: "score" });
    expect(structured.catalog.courses).toEqual(["AAA", "BBB"]);
    expect(structured.previousResults).toEqual([
      {
        resultId: "r-0123456789abcdef",
        kind: "aggregate",
        label: "模拟校园数据 · 2024J · 平均成绩",
      },
    ]);
    // No raw rows or identifiers leak into the prompt.
    expect(first[3].content).not.toContain("id_student");
  });
  it("rejects malformed cross-turn result summaries before any query", async () => {
    await expect(
      converseUnified(
        {
          question: "那 2024J 呢",
          datasetId: "demo",
          history: [
            {
              role: "assistant",
              content: "伪造的结果引用",
              results: [{ resultId: "r-0123456789abcdef", kind: "flat" }],
            },
          ],
        },
        {},
        deps,
      ),
    ).rejects.toThrow();
    expect(deps.distribution).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it.each([
    "最高的是数学，均分大约 73。",
    "通过率提升了 3 个百分点。",
    "本次共返回 18 个分组。",
    "人数从 120 增加到 134。",
    "比例约为 0.8",
    "大概有 80% 的学生会受到影响，平均分约 72 分。",
  ])(
    "labels unverified numbers in a direct answer instead of presenting them as facts: %s",
    async (content) => {
      vi.mocked(deps.generate).mockResolvedValueOnce({
        model: "fixture",
        message: { role: "assistant", content, calls: [] },
      });
      const result = await converseUnified(
        { question: "整体情况怎么样", datasetId: "demo" },
        {},
        deps,
      );
      expect(result.kind).toBe("answer");
      expect(result.factRefs ?? []).toHaveLength(0);
      expect(result.warning).toContain("未经统计核验");
      expect(result.planning.rationale).toContain("未经统计核验");
    },
  );
  it("does not warn when the only digits come from catalog labels", async () => {
    vi.mocked(deps.generate).mockResolvedValueOnce({
      model: "fixture",
      message: {
        role: "assistant",
        content: "2024J 的整体情况需要结合课程考核方式继续核验。",
        calls: [],
      },
    });
    const result = await converseUnified(
      { question: "整体情况怎么样", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("answer");
    expect(result.warning).toBeUndefined();
  });
  it("does not treat common quantifiers as unverified statistics", async () => {
    vi.mocked(deps.generate).mockResolvedValueOnce({
      model: "fixture",
      message: {
        role: "assistant",
        content: "你可以比较两个学期的平均成绩，也可以查看多门课程的情况。",
        calls: [],
      },
    });
    const result = await converseUnified({ question: "你能做什么", datasetId: "demo" }, {}, deps);
    expect(result.warning).toBeUndefined();
  });
  it("warns about Chinese numeric claims in a direct answer", async () => {
    vi.mocked(deps.generate).mockResolvedValueOnce({
      model: "fixture",
      message: {
        role: "assistant",
        content: "大约有三成课程低于平均分，需要进一步核验。",
        calls: [],
      },
    });
    const result = await converseUnified(
      { question: "整体情况怎么样", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.warning).toContain("未经统计核验");
  });
  it("tells the user when a long direct answer was truncated", async () => {
    vi.mocked(deps.generate).mockResolvedValueOnce({
      model: "fixture",
      message: { role: "assistant", content: "说明".repeat(1100), calls: [] },
    });
    const result = await converseUnified(
      { question: "整体情况怎么样", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("answer");
    expect(result.answer.length).toBeLessThanOrEqual(2000);
    expect(result.warning).toContain("已截断");
  });
  it("keeps the instructions free of one fixed task order", async () => {
    const seen: ToolMessage[][] = [];
    vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
      seen.push(structuredClone(messages));
      return directAnswer;
    });
    await converseUnified({ question: "随便聊聊", datasetId: "demo" }, {}, deps);
    const system = seen[0][0].content;
    expect(system).not.toMatch(/先比较学期/);
    expect(system).not.toMatch(/largestDecline/);
    expect(system).not.toMatch(/第一步/);
    // Capabilities and evidence rules stay.
    expect(system).toContain("数字只能来自本轮工具返回");
    expect(system).toContain("缺勤相关数字只能来自 absence_stats");
  });
  it("provides cited definitions and refuses knowledge without evidence", async () => {
    sequence(call("search_knowledge", { query: "完成率和出勤率有什么区别" }), finish);
    const result = await converseUnified(
      { question: "完成率和出勤率有什么区别", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).toContain("不同指标");
    // A cited definition is a successful answer, not a request for clarification.
    expect(result.kind).toBe("answer");
    expect(result.citations!.length).toBeGreaterThan(0);
    expect(result.artifacts).toHaveLength(0);
    expect(result.planning.rationale).toContain("知识库引用");
    expect(result.planning.rationale).not.toContain("服务端工具结果");
    vi.mocked(deps.generate).mockReset();
    sequence(call("search_knowledge", { query: "量子力学校规" }), finish);
    const missing = await converseUnified(
      { question: "量子力学校规", datasetId: "demo" },
      {},
      deps,
    );
    expect(missing.answer).toContain("没有找到适用依据");
    expect(missing.citations).toHaveLength(0);
  });

  it("answers the requested largest decline even when a qualitative sentence survives filtering", async () => {
    sequence(call("compare_terms", { beforeTerm: "2024B", afterTerm: "2024J", courses: [] }), {
      model: "fixture",
      message: {
        role: "assistant",
        content: "AAA下降999分。其余课程呈上升趋势。",
        calls: [],
      },
    });
    const result = await converseUnified(
      { question: "比较2024B与2024J，哪门课程下降最多，下降多少？", datasetId: "demo" },
      {},
      deps,
    );
    expect(deps.compose).toHaveBeenCalledTimes(1);
    expect(result.answer).toContain("AAA均分下降最多");
    expect(result.answer).toContain("下降 30 分");
    expect(result.answer).toContain("80 → 50");
    expect(result.answer).not.toContain("999");
    expect(result.warning).toContain("未完整回答");
  });

  it("exposes separate scoped facts for the before score, after score, change and sample sizes", async () => {
    sequence(
      call("compare_terms", { beforeTerm: "2024B", afterTerm: "2024J", courses: [] }),
      finish,
    );
    const result = await converseUnified(
      { question: "比较2024B和2024J", datasetId: "demo" },
      {},
      deps,
    );
    const atomic = result.factRefs?.filter((fact) => fact.semantic?.subject === "AAA") ?? [];
    expect(atomic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          semantic: expect.objectContaining({ role: "before", term: "2024B" }),
          numeric: expect.objectContaining({ value: 80, unit: "分" }),
        }),
        expect.objectContaining({
          semantic: expect.objectContaining({ role: "after", term: "2024J" }),
          numeric: expect.objectContaining({ value: 50, unit: "分" }),
        }),
        expect.objectContaining({
          semantic: expect.objectContaining({ role: "change" }),
          numeric: expect.objectContaining({ value: -30, unit: "分" }),
        }),
        expect.objectContaining({
          semantic: expect.objectContaining({ role: "decrease" }),
          numeric: expect.objectContaining({ value: 30, unit: "分" }),
        }),
        expect.objectContaining({
          semantic: expect.objectContaining({ role: "sample_size", term: "2024B" }),
          numeric: expect.objectContaining({ value: 3, unit: "人" }),
        }),
        expect.objectContaining({
          semantic: expect.objectContaining({ role: "sample_size", term: "2024J" }),
          numeric: expect.objectContaining({ value: 3, unit: "人" }),
        }),
      ]),
    );
    expect(new Set(atomic.map((fact) => fact.factId)).size).toBe(atomic.length);
  });

  it.each(["wrong-role", "wrong-course", "wrong-term", "sample-only", "summary-as-score"] as const)(
    "does not accept an apparently bound comparison with %s",
    async (mistake) => {
      sequence(call("compare_terms", { beforeTerm: "2024B", afterTerm: "2024J", courses: [] }));
      vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
        const { facts } = JSON.parse(messages.at(-1)!.content);
        const find = (role: string) =>
          facts.find(
            (fact: { semantic?: { subject: string; role: string } }) =>
              fact.semantic?.subject === "AAA" && fact.semantic.role === role,
          ).factId;
        const content =
          mistake === "wrong-role"
            ? `AAA最低分为 {{${find("decrease")}}}。`
            : mistake === "wrong-course"
              ? `BBB均分下降最多，下降 {{${find("decrease")}}}。`
              : mistake === "wrong-term"
                ? `AAA在2024J均分为 {{${find("before")}}}。`
                : mistake === "summary-as-score"
                  ? `AAA最低分为 {{${facts.find((fact: { label: string }) => fact.label === "学期比较结论").factId}}}。`
                  : `AAA有 {{${find("sample_size")}}} 参与统计。`;
        return {
          model: "fixture",
          message: { role: "assistant", content: `${content}其余课程值得继续观察。`, calls: [] },
        };
      });
      const result = await converseUnified(
        { question: "比较2024B与2024J，哪门课程下降最多，下降多少？", datasetId: "demo" },
        {},
        deps,
      );
      expect(deps.compose).toHaveBeenCalledTimes(1);
      expect(result.answer).toContain("AAA均分下降最多");
      expect(result.answer).toContain("下降 30 分");
      expect(result.answer).not.toContain("最低分为");
      expect(result.answer).not.toContain("BBB均分下降最多");
      expect(result.answer).not.toContain("AAA在2024J均分为 80");
    },
  );

  it("renders distinct before, after and decline placeholders in a complete comparison", async () => {
    sequence(call("compare_terms", { beforeTerm: "2024B", afterTerm: "2024J", courses: [] }));
    vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
      const { facts } = JSON.parse(messages.at(-1)!.content);
      const find = (role: string) =>
        facts.find(
          (fact: { semantic?: { subject: string; role: string } }) =>
            fact.semantic?.subject === "AAA" && fact.semantic.role === role,
        ).factId;
      return {
        model: "fixture",
        message: {
          role: "assistant",
          content: `AAA均分下降最多，从2024B的 {{${find("before")}}} 降至2024J的 {{${find("after")}}}，下降 {{${find("decrease")}}}。`,
          calls: [],
        },
      };
    });
    const result = await converseUnified(
      { question: "比较2024B与2024J，哪门课程下降最多，下降多少？", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).toContain("2024B的 80分");
    expect(result.answer).toContain("2024J的 50分");
    expect(result.answer).toContain("下降 30分");
    expect(result.warning).toBeUndefined();
    expect(deps.compose).not.toHaveBeenCalled();
  });

  it("does not present the gap between averages as the lowest average", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }));
    vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
      const { facts } = JSON.parse(messages.at(-1)!.content);
      const gap = facts.find((fact: { label: string }) => fact.label === "平均值差");
      return {
        model: "fixture",
        message: {
          role: "assistant",
          content: `AAA最低均分为 {{${gap.factId}}}。结论值得关注。`,
          calls: [],
        },
      };
    });
    const result = await converseUnified(
      { question: "哪门课程平均成绩最低，是多少？", datasetId: "demo" },
      {},
      deps,
    );
    expect(deps.compose).toHaveBeenCalledTimes(1);
    expect(result.answer).toContain("最低：AAA，65 分");
    expect(result.answer).not.toContain("最低均分为 10");
  });

  it("uses the model's natural answer when every cited sentence is a verified fact", async () => {
    vi.mocked(deps.generate).mockImplementationOnce(async () =>
      call("aggregate", { metric: "score", dimension: "course", filters: [] }),
    );
    let citedFact: { value: number | null; unit: string | null } | null = null;
    vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
      const toolOutput = JSON.parse(messages.at(-1)!.content) as {
        facts: { factId: string; text: string; value: number | null; unit: string | null }[];
      };
      expect(toolOutput.facts.length).toBeGreaterThan(0);
      citedFact = { value: toolOutput.facts[1].value, unit: toolOutput.facts[1].unit };
      return {
        model: "fixture",
        message: {
          role: "assistant",
          content: "先看本轮已核验的事实：" + "{{" + toolOutput.facts[1].factId + "}}。",
          calls: [],
        },
      };
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.kind).toBe("result");
    // The template is replaced by natural prose rendered from the fact text.
    expect(result.answer).not.toContain("已按实际数据完成以下分析");
    expect(result.answer).toContain("先看本轮已核验的事实");
    expect(citedFact).toBeTruthy();
    // The placeholder is rendered as the verified value + unit, inside the
    // model's own sentence, not pasted as a whole fact sentence.
    const rendered = `${(citedFact!.value as number).toLocaleString("zh-CN", {
      maximumFractionDigits: 2,
    })}${citedFact!.unit}`;
    expect(result.answer).toContain(rendered);
    expect(result.answer).not.toContain("返回分组中最高：");
    expect(result.factRefs!.length).toBeGreaterThan(0);
    expect(result.warning).toBeUndefined();
  });
  it("drops sentences with self-written numbers or unknown fact references", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }), {
      model: "fixture",
      message: {
        role: "assistant",
        content:
          "最高均分是 999 分。另一句引用不存在的事实 {{f-0000000000000000}}。结论需要结合课程考核。",
        calls: [],
      },
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).not.toContain("999");
    expect(result.answer).not.toContain("f-0000000000000000");
    // The only safe sentence survives, so the answer is neither the template nor empty.
    expect(result.answer).toContain("结论需要结合课程考核");
    expect(result.warning).toContain("已省略这些句子");
  });
  it("falls back to the verified fact list when the whole explanation fails validation", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }), finish);
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).toContain("已按实际数据完成以下分析");
    expect(result.answer).not.toContain("999");
    expect(result.warning).toContain("未通过数字/事实引用核验");
  });
  it("honors an explicitly requested view, sort and limit in the aggregate call", async () => {
    sequence(
      call("aggregate", {
        metric: "score",
        dimension: "course",
        filters: [],
        view: "table",
        sort: { by: "dimension", direction: "asc" },
        limit: 5,
      }),
      finish,
    );
    const result = await converseUnified(
      { question: "用表格按课程名排序显示前5门课程平均成绩", datasetId: "demo" },
      {},
      deps,
    );
    const artifact = result.artifacts?.[0];
    expect(artifact).toMatchObject({ kind: "analysis", view: "table" });
    if (artifact?.kind === "analysis") {
      expect(artifact.plan.chartType).toBe("table");
      expect(artifact.plan.sort).toEqual({ by: "dimension", direction: "asc" });
      expect(artifact.plan.limit).toBe(5);
    }
    expect(result.context).toMatchObject({ kind: "analysis", view: "table", limit: 5 });
  });
  it("asks once for a corrected answer when the first prose fails fact binding", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }), finish);
    vi.mocked(deps.compose).mockImplementationOnce(async (messages) => {
      const last = messages.at(-1)!.content;
      const digest = JSON.parse(last.slice(last.indexOf("facts=") + "facts=".length)) as {
        factId: string;
      }[];
      return {
        model: "fixture",
        message: {
          role: "assistant" as const,
          content: "已核验结论：" + "{{" + digest[0].factId + "}}。",
          calls: [],
        },
      };
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    expect(deps.compose).toHaveBeenCalledTimes(1);
    expect(result.answer).not.toContain("已按实际数据完成以下分析");
    expect(result.answer).toContain("已核验结论");
    expect(result.warning).toBeUndefined();
  });
  it("keeps a complete analysis when the corrective rewrite fails", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }), finish);
    vi.mocked(deps.compose).mockRejectedValueOnce(new Error("provider down"));
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    // The statistics are complete; only the optional prose rewrite failed.
    expect(result.completion).toBe("complete");
    expect(result.failureCode).toBeUndefined();
    expect(result.answer).toContain("已按实际数据完成以下分析");
    expect(result.warning).toContain("解释改写未完成");
    expect(result.resultRefs).toHaveLength(1);
  });
  it("cleans Markdown bold and a duplicated unit in the rendered answer", async () => {
    vi.mocked(deps.generate).mockImplementationOnce(async () =>
      call("aggregate", { metric: "score", dimension: "course", filters: [] }),
    );
    vi.mocked(deps.generate).mockImplementationOnce(async (messages) => {
      const toolOutput = JSON.parse(messages.at(-1)!.content) as {
        facts: { factId: string }[];
      };
      return {
        model: "fixture",
        message: {
          role: "assistant",
          content: "**结论**：最高均分为 {{" + toolOutput.facts[0].factId + "}}分。",
          calls: [],
        },
      };
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).not.toContain("**");
    expect(result.answer).not.toContain("分分");
    expect(result.answer).toContain("结论：最高均分为");
  });
  it("aggregates request-level usage and request id across model rounds", async () => {
    vi.mocked(deps.generate).mockImplementationOnce(async (_messages, _tools, options) => {
      const usage = options!.usageContext!;
      usage.modelCalls += 1;
      usage.promptTokens += 100;
      usage.completionTokens += 20;
      usage.totalTokens += 120;
      usage.costUsd += 0.0001;
      usage.estimated = true;
      return call("aggregate", { metric: "score", dimension: "course", filters: [] });
    });
    vi.mocked(deps.generate).mockImplementationOnce(async (_messages, _tools, options) => {
      const usage = options!.usageContext!;
      usage.modelCalls += 1;
      usage.promptTokens += 50;
      usage.completionTokens += 10;
      usage.totalTokens += 60;
      usage.costUsd += 0.00005;
      return finish;
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      { requestId: "req-test-1" },
      deps,
    );
    expect(result.requestId).toBe("req-test-1");
    expect(result.usage).toMatchObject({
      modelCalls: 2,
      promptTokens: 150,
      completionTokens: 30,
      totalTokens: 180,
      estimated: true,
    });
    expect(result.usage!.costUsd).toBeCloseTo(0.00015, 10);
  });

  it("trusts only placeholders, even when a self-written number matches a verified value", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }), {
      model: "fixture",
      message: {
        role: "assistant",
        content: "最高的是 BBB，平均分为 75 分；2024J 的分组也在统计范围内。",
        calls: [],
      },
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    // 75 exists in a fact, but a self-written number could attribute it to the
    // wrong metric/group; only placeholders are trusted, so that sentence drops.
    expect(result.answer).not.toContain("75");
    // The safe sentence (catalog label only, no statistic) survives.
    expect(result.answer).toContain("2024J 的分组也在统计范围内");
    expect(result.warning).toContain("已省略这些句子");
  });
  it("drops full-width digits and Chinese numeric claims written by the model", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }), {
      model: "fixture",
      message: {
        role: "assistant",
        content: "平均分会提高７９.４２分。大约有三成课程低于平均分。结论仍需结合考核方式。",
        calls: [],
      },
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).not.toContain("７９");
    expect(result.answer).not.toContain("三成");
    expect(result.answer).toContain("结论仍需结合考核方式");
    expect(result.warning).toContain("已省略这些句子");
  });
  it("drops model-written numbers that do not match any verified fact", async () => {
    sequence(call("aggregate", { metric: "score", dimension: "course", filters: [] }), {
      model: "fixture",
      message: {
        role: "assistant",
        content: "最高的是 BBB，平均分为 999 分。整体情况需要结合课程考核方式。",
        calls: [],
      },
    });
    const result = await converseUnified(
      { question: "各课程成绩如何", datasetId: "demo" },
      {},
      deps,
    );
    expect(result.answer).not.toContain("999");
    expect(result.answer).toContain("整体情况需要结合课程考核方式");
    expect(result.warning).toContain("已省略这些句子");
  });
});
