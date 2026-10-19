/**
 * AI 评测基线（默认不运行，不产生任何真实模型费用）。
 *
 * 运行方式：
 *   AI_EVAL_MOCK=1 pnpm vitest run scripts/ai-eval.test.ts   只校验 cases.jsonl 结构，不发网络请求。
 *   AI_EVAL=1 pnpm vitest run scripts/ai-eval.test.ts        逐条调用 lib/ai/conversation 的 converse。
 *   pnpm eval:ai                                            等同 AI_EVAL=1（见 docs/ai-eval-cases.md）。
 *
 * 真实模式从进程环境变量读取配置；变量缺失时依次尝试 AI_EVAL_ENV_FILE、records/.env、.env.local。
 * 运行结果写入 output/ai-eval/<时间戳>.json（output/ 已在 .gitignore）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadEnvFile } from "./ai-eval/environment";

const CASES_FILE = resolve(process.cwd(), "scripts/ai-eval/cases.jsonl");
const OUTPUT_DIR = resolve(process.cwd(), "output/ai-eval");
const DATASET_ID = "demo";

const enabledFlag = (name: string): boolean => {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false";
};
const MOCK = enabledFlag("AI_EVAL_MOCK");
const LIVE = enabledFlag("AI_EVAL") && !MOCK;
const STRUCTURE = LIVE || MOCK;

const ACTIONS = ["analysis", "distribution", "tool", "reply", "clarify"] as const;
type Action = (typeof ACTIONS)[number];
const METRICS = ["score", "activity", "completion_rate"] as const;
type Metric = (typeof METRICS)[number];
const DIMENSIONS = ["course", "term"] as const;
type Dimension = (typeof DIMENSIONS)[number];
const KINDS = ["result", "answer", "clarification"] as const;
type Kind = (typeof KINDS)[number];
const CATEGORIES = ["fixed", "free", "boundary"] as const;
type Category = (typeof CATEGORIES)[number];

type EvalCase = {
  id: string;
  category: Category;
  question: string;
  expect: {
    action: Action;
    metric: Metric | null;
    dimension: Dimension | null;
    kind: Kind;
    clarify: boolean;
  };
};

const CASE_FIELDS = "category,expect,id,question";
const EXPECT_FIELDS = "action,clarify,dimension,kind,metric";

const isAction = (value: unknown): value is Action =>
  typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
const isMetric = (value: unknown): value is Metric =>
  typeof value === "string" && (METRICS as readonly string[]).includes(value);
const isDimension = (value: unknown): value is Dimension =>
  typeof value === "string" && (DIMENSIONS as readonly string[]).includes(value);
const isKind = (value: unknown): value is Kind =>
  typeof value === "string" && (KINDS as readonly string[]).includes(value);
const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);

/** 校验单条用例；返回人类可读的问题列表，空数组代表通过。 */
function caseProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["必须是 JSON 对象"];
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.trim().length === 0) problems.push("id 必须是非空字符串");
  if (!isCategory(row.category)) problems.push("category 必须是 fixed/free/boundary 之一");
  if (typeof row.question !== "string") problems.push("question 必须是字符串");
  else if (row.question.trim().length < 2 || row.question.length > 500)
    problems.push("question 长度必须在 2–500 字之间");
  if (Object.keys(row).sort().join(",") !== CASE_FIELDS)
    problems.push("顶层字段必须恰好为 id/category/question/expect");
  const rawExpect = row.expect;
  if (!rawExpect || typeof rawExpect !== "object" || Array.isArray(rawExpect)) {
    problems.push("expect 必须是对象");
    return problems;
  }
  const expect = rawExpect as Record<string, unknown>;
  if (Object.keys(expect).sort().join(",") !== EXPECT_FIELDS)
    problems.push("expect 字段必须恰好为 action/metric/dimension/kind/clarify");
  if (!isAction(expect.action)) problems.push("expect.action 不在允许枚举内");
  if (expect.metric !== null && !isMetric(expect.metric))
    problems.push("expect.metric 必须是 score/activity/completion_rate 或 null");
  if (expect.dimension !== null && !isDimension(expect.dimension))
    problems.push("expect.dimension 必须是 course/term 或 null");
  if (!isKind(expect.kind)) problems.push("expect.kind 必须是 result/answer/clarification");
  if (typeof expect.clarify !== "boolean") problems.push("expect.clarify 必须是布尔值");
  if (isAction(expect.action)) {
    const expectedKind: Kind =
      expect.action === "clarify" ? "clarification" : expect.action === "reply" ? "answer" : "result";
    if (expect.kind !== expectedKind)
      problems.push(`expect.kind 与 action 不一致：${String(expect.action)} 应为 ${expectedKind}`);
    if (expect.clarify !== (expect.action === "clarify"))
      problems.push("expect.clarify 必须与 action=clarify 一致");
    if (expect.action === "analysis" && (expect.metric === null || expect.dimension === null))
      problems.push("action=analysis 时 metric 与 dimension 不得为 null");
    if (expect.action !== "analysis" && (expect.metric !== null || expect.dimension !== null))
      problems.push("action 非 analysis 时 metric 与 dimension 必须为 null");
  }
  return problems;
}

/** 读取并严格校验 JSONL；任何一行不合法都会带上行号抛错。 */
function readCases(): EvalCase[] {
  const lines = readFileSync(CASES_FILE, "utf8").split(/\r?\n/);
  let lineNumber = 0;
  return lines.reduce<EvalCase[]>((cases, line) => {
    lineNumber += 1;
    if (line.trim().length === 0) return cases;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`scripts/ai-eval/cases.jsonl 第 ${lineNumber} 行不是合法 JSON`);
    }
    const problems = caseProblems(parsed);
    if (problems.length > 0)
      throw new Error(`scripts/ai-eval/cases.jsonl 第 ${lineNumber} 行不合约：${problems.join("；")}`);
    return cases.concat(parsed as EvalCase);
  }, []);
}

/** 与 lib/ai/conversation 的 converse 返回值保持同型，避免依赖具体实现细节。 */
type ConversationModule = typeof import("@/lib/ai/conversation");
type ConverseResponse = Awaited<ReturnType<ConversationModule["converse"]>>;

type Actual = {
  kind: Kind;
  action: Action;
  metric: Metric | null;
  dimension: Dimension | null;
  clarify: boolean;
  planning: { source: string; model: string | null };
  answer: string;
};

/** 把 ChatResponse 折算为参与比对的字段。 */
function describeActual(response: ConverseResponse): Actual {
  const context = response.context;
  const action: Action =
    response.kind === "clarification"
      ? "clarify"
      : response.kind === "answer"
        ? "reply"
        : (context?.kind ?? "analysis");
  const metric: Metric | null =
    context?.kind === "analysis" ? context.metric : context?.kind === "distribution" ? "score" : null;
  const dimension: Dimension | null = context?.kind === "analysis" ? context.dimension : null;
  return {
    kind: response.kind,
    action,
    metric,
    dimension,
    clarify: response.kind === "clarification",
    planning: { source: response.planning.source, model: response.planning.model },
    answer: response.answer.slice(0, 120),
  };
}

function mismatchesFor(evalCase: EvalCase, actual: Actual): string[] {
  const problems: string[] = [];
  const expected = evalCase.expect;
  if (actual.kind !== expected.kind) problems.push(`kind 期望 ${expected.kind}，实际 ${actual.kind}`);
  if (actual.action !== expected.action)
    problems.push(`action 期望 ${expected.action}，实际 ${actual.action}`);
  if (expected.metric !== null && actual.metric !== expected.metric)
    problems.push(`metric 期望 ${expected.metric}，实际 ${String(actual.metric)}`);
  if (expected.dimension !== null && actual.dimension !== expected.dimension)
    problems.push(`dimension 期望 ${expected.dimension}，实际 ${String(actual.dimension)}`);
  if (actual.clarify !== expected.clarify)
    problems.push(`clarify 期望 ${expected.clarify}，实际 ${actual.clarify}`);
  return problems;
}


const CASES = readCases();

type RunResult = {
  id: string;
  category: Category;
  question: string;
  passed: boolean;
  expected: EvalCase["expect"];
  actual: Actual | null;
  mismatches: string[];
  error: string | null;
};

describe.skipIf(!STRUCTURE)("AI 评测用例结构", () => {
  it("cases.jsonl 每行都能解析且字段符合 schema", () => {
    expect(CASES.length).toBeGreaterThan(0);
    for (const evalCase of CASES) {
      expect(caseProblems(evalCase)).toEqual([]);
      expect(evalCase.question.trim().length).toBeGreaterThanOrEqual(2);
    }
  });

  it("共 30 条，固定/自由/边界各 10 条，id 唯一", () => {
    expect(CASES).toHaveLength(30);
    const counts: Record<Category, number> = { fixed: 0, free: 0, boundary: 0 };
    for (const evalCase of CASES) counts[evalCase.category] += 1;
    expect(counts).toEqual({ fixed: 10, free: 10, boundary: 10 });
    expect(new Set(CASES.map((evalCase) => evalCase.id)).size).toBe(CASES.length);
  });

  it("固定用例覆盖 3 个指标与 2 个维度", () => {
    const fixed = CASES.filter((evalCase) => evalCase.category === "fixed");
    expect(new Set(fixed.map((evalCase) => evalCase.expect.metric))).toEqual(
      new Set(["score", "activity", "completion_rate"]),
    );
    expect(new Set(fixed.map((evalCase) => evalCase.expect.dimension))).toEqual(
      new Set(["course", "term"]),
    );
  });
});

describe.skipIf(!LIVE)("AI 评测（真实模型）", () => {
  const startedAt = new Date().toISOString();
  const results: RunResult[] = [];
  let converse: ConversationModule["converse"] | null = null;
  let promptVersion = "";
  let configModel = "";
  let observedModel: string | null = null;
  let envFile: string | null = null;
  let ready = false;

  beforeAll(async () => {
    envFile = loadEnvFile();
    const conversation = await import("@/lib/ai/conversation");
    const prompts = await import("@/lib/ai/prompts/version");
    const settings = await import("@/lib/settings/ai");
    converse = conversation.converse;
    promptVersion = prompts.PROMPT_VERSION;
    const config = settings.getAIConfig();
    const pricingReady =
      config.pricing.inputPerMillion !== null && config.pricing.outputPerMillion !== null;
    if (!config.model) throw new Error("AI 模型名为空：请在系统管理 → AI 配置中保存模型名。");
    if (!config.enabled)
      throw new Error("AI 未开启：请在系统管理 → AI 配置中勾选“允许 AI 分析”后重试评测。");
    if (!config.keyConfigured || !pricingReady)
      throw new Error(
        "AI 密钥或估算单价未配置：真实评测需要可用的 API 密钥与输入/输出单价（美元/百万 token）。",
      );
    try {
      const runtime = settings.getRuntimeAIConfig();
      if (!runtime.apiKey) throw new Error("运行时未取得 API 密钥");
    } catch (error) {
      throw new Error(
        `AI 密钥不可用（检查 APP_SETTINGS_KEY 是否与 records/system/ai-config.json 匹配）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    configModel = config.model;
    ready = true;
    console.log(
      `AI 评测配置：model=${configModel} promptVersion=${promptVersion} env=${
        envFile ?? "进程环境变量"
      }` + `；将逐条调用 ${CASES.length} 次，计入真实用量与预算。`,
    );
  });

  for (const evalCase of CASES) {
    it(
      `${evalCase.id} ${evalCase.question}`,
      async () => {
        if (!converse) throw new Error("AI 评测未初始化");
        let recorded = false;
        try {
          const response = await converse({ question: evalCase.question, datasetId: DATASET_ID });
          const actual = describeActual(response);
          if (actual.planning.model) observedModel ??= actual.planning.model;
          const mismatches = mismatchesFor(evalCase, actual);
          results.push({
            id: evalCase.id,
            category: evalCase.category,
            question: evalCase.question,
            passed: mismatches.length === 0,
            expected: evalCase.expect,
            actual,
            mismatches,
            error: null,
          });
          recorded = true;
          expect(mismatches, `${evalCase.id} 与预期不符`).toEqual([]);
        } catch (error) {
          if (!recorded)
            results.push({
              id: evalCase.id,
              category: evalCase.category,
              question: evalCase.question,
              passed: false,
              expected: evalCase.expect,
              actual: null,
              mismatches: [],
              error: error instanceof Error ? error.message : String(error),
            });
          throw error;
        }
      },
      120_000,
    );
  }

  afterAll(() => {
    if (!ready || results.length === 0) return;
    const finishedAt = new Date().toISOString();
    const passed = results.filter((result) => result.passed).length;
    const rate = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 1000) / 10);
    const byCategory = Object.fromEntries(
      CATEGORIES.map((category) => {
        const rows = results.filter((result) => result.category === category);
        const ok = rows.filter((result) => result.passed).length;
        return [category, { total: rows.length, passed: ok, passRate: rate(ok, rows.length) }];
      }),
    );
    const report = {
      startedAt,
      finishedAt,
      promptVersion,
      model: observedModel ?? configModel,
      configuredModel: configModel,
      dataset: DATASET_ID,
      demoDataDir: process.env.DEMO_DATA_DIR ?? null,
      mocked: false,
      total: results.length,
      passed,
      passRate: rate(passed, results.length),
      byCategory,
      envFile: envFile ?? "process.env",
      failures: results.filter((result) => !result.passed),
      cases: results,
    };
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const file = join(OUTPUT_DIR, `${startedAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `AI 评测完成：${passed}/${results.length}（${report.passRate}%），` +
        `promptVersion=${promptVersion}，model=${report.model}，报告：${file}`,
    );
  });
});
