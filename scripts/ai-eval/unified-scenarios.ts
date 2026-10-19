/**
 * Shared helpers for the rebuilt unified-conversation evaluation
 * (`scripts/ai-eval-unified.test.ts`).
 *
 * This module only contains pure formatting/assertion helpers: no network, no
 * filesystem. The test file owns the mode setup (mock vs real model) so that
 * this file stays importable in both.
 */
import type { ChatResponse } from "../../lib/ai/chat-types";
import type { RequestUsage } from "../../lib/security/ai-cost";

export type EvalMode = "mock" | "live";

export type Check = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type ScenarioReport = {
  id: string;
  label: string;
  passed: boolean;
  kind: ChatResponse["kind"] | null;
  completion: ChatResponse["completion"] | null;
  artifacts: string[];
  resultRefCount: number;
  factRefCount: number;
  durationMs: number;
  usage: RequestUsage | null;
  costUsd: number | null;
  model: string | null;
  requestId: string | null;
  answerPreview: string;
  /** Numeric tokens the answer shows (catalog labels stripped), for review. */
  answerNumbers: string[];
  /** Any number no verified fact supports; always expected to be empty. */
  inventedNumbers: string[];
  warning: string | null;
  checks: Check[];
  error?: string;
};

export type EvalReport = {
  mode: EvalMode;
  mocked: boolean;
  startedAt: string;
  finishedAt: string;
  dataset: string;
  dataDir: string;
  model: string | null;
  envFile: string | null;
  total: number;
  passed: number;
  passRate: number;
  scenarios: ScenarioReport[];
};

const TEMPLATE_MARKERS = [
  "已按实际数据完成以下分析：",
  "本轮仅完成部分分析，以下结果可核对：",
  "指标口径与限制见下方引用。",
  "请明确要分析的指标、课程和学期；学期比较需要指定前后两个学期。",
  "当前知识库没有找到适用依据，暂不能回答这项规则或定义。",
  "找到的资料存在版本冲突，暂不能给出可靠结论，请核对来源。",
];

export function artifactKinds(response: ChatResponse): string[] {
  return (response.artifacts ?? []).map((artifact) => artifact.kind);
}

/** Every displayed fact must point at a result that is actually in this response. */
export function factBinding(response: ChatResponse): { ok: boolean; dangling: string[] } {
  const resultIds = new Set((response.resultRefs ?? []).map((result) => result.resultId));
  const dangling = (response.factRefs ?? [])
    .filter((fact) => !resultIds.has(fact.resultId))
    .map((fact) => fact.factId);
  return { ok: dangling.length === 0, dangling };
}

/**
 * All program-verified prose available to ground answer numbers. Raw artifact
 * rows are deliberately excluded: a number that merely appears in a returned
 * table row has not been bound to a fact and must not make an answer look
 * verified.
 */
export function verifiedText(response: ChatResponse): string {
  return [
    ...(response.factRefs ?? []).map((fact) => fact.text),
    ...(response.facts ?? []),
    // Versioned knowledge excerpts are evidence too: a number shown in a cited
    // definition (e.g. "* 100" in a rate formula) is not an invented statistic.
    ...(response.citations ?? []).map((citation) => `${citation.title} ${citation.excerpt}`),
  ].join("\n");
}

const NUMERIC_TOKEN = /[0-9][0-9,]*(?:\.[0-9]+)?/g;
/** Full-width digits and Chinese numeric claims are statistics too. */
const FULL_WIDTH_DIGIT = /[０-９]/;
const CHINESE_NUMERIC_CLAIM =
  // Bare "分" is an adverb ("十分明显") and "个" is a common quantifier
  // ("两个学期"), so neither counts as a statistic on its own.
  /[零〇一二三四五六七八九十百千万亿两半]\s*(?:%|％|人|门|次|课时|天|成|倍)/u;

function toAsciiDigits(text: string): string {
  return text.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
}

function digitSignature(token: string): string {
  return toAsciiDigits(token).replaceAll(",", "");
}

/**
 * List/citation numbering is formatting, not a statistic: strip ordered-list
 * markers ("1." / "2、") and citation markers ("[1]" / "［1］") before judging
 * whether an answer invented a number.
 */
function stripFormattingNumbers(text: string): string {
  return text.replace(/[［\[]\s*\d{1,3}\s*[］\]]/g, " ").replace(/^\s*\d{1,2}[.、)]\s*/gm, " ");
}

/** Numbers shown in the answer after removing catalog labels (scope, not stats). */
export function answerNumbers(answer: string, catalogLabels: string[]): string[] {
  let rest = toAsciiDigits(stripFormattingNumbers(answer));
  for (const label of catalogLabels) if (label) rest = rest.split(label).join(" ");
  return [...new Set(rest.match(NUMERIC_TOKEN) ?? [])];
}

/**
 * True when the answer shows at least one number the verified corpus supports.
 * Needed because placeholders now render as value + unit inside the model's own
 * sentence instead of pasting the whole fact sentence.
 */
export function answerHasVerifiedNumber(
  answer: string,
  catalogLabels: string[],
  corpus: string,
): boolean {
  const numbers = answerNumbers(answer, catalogLabels);
  if (!numbers.length) return false;
  const verified = new Set(toAsciiDigits(corpus).match(NUMERIC_TOKEN)?.map(digitSignature) ?? []);
  return numbers.map(digitSignature).some((token) => verified.has(token));
}

/**
 * Numbers in the answer that no verified fact supports. Catalog labels
 * (course/term names such as "2025J") are stripped first because their digits
 * identify a scope, not a statistic. This is intentionally strict: the live
 * evaluation must not treat an invented number as a pass.
 */
export function inventedNumbers(answer: string, catalogLabels: string[], corpus: string): string[] {
  let rest = toAsciiDigits(stripFormattingNumbers(answer));
  for (const label of catalogLabels) if (label) rest = rest.split(label).join(" ");
  const verified = new Set(toAsciiDigits(corpus).match(NUMERIC_TOKEN)?.map(digitSignature) ?? []);
  const invented = [...new Set(rest.match(NUMERIC_TOKEN) ?? [])]
    .map(digitSignature)
    // Exact token match only: "2" is not verified just because "120" exists.
    .filter((token) => !verified.has(token));
  if (CHINESE_NUMERIC_CLAIM.test(rest) || FULL_WIDTH_DIGIT.test(answer))
    invented.push("中文/全角数字");
  return invented;
}

/**
 * Count Chinese prose characters that are left after removing the deterministic
 * template, its verified fact sentences and the scored catalog labels. A
 * template-only answer (facts pasted under a header) scores ~0; Lead's bound
 * natural answer uses `{{factId}}` placeholders where the sentence rest survives,
 * so the surrounding prose is what this measures.
 */
export function naturalProseChars(
  answer: string,
  response: ChatResponse,
  catalogLabels: string[],
): number {
  let rest = answer;
  for (const fact of response.factRefs ?? []) if (fact.text) rest = rest.split(fact.text).join(" ");
  for (const marker of TEMPLATE_MARKERS) rest = rest.split(marker).join(" ");
  for (const label of catalogLabels) if (label) rest = rest.split(label).join(" ");
  return (rest.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

/** Usage must be internally consistent when present. Returns problems, empty = sane. */
export function usageProblems(usage: RequestUsage | undefined): string[] {
  if (!usage) return ["usage missing"];
  const problems: string[] = [];
  const numbers: Array<[string, number]> = [
    ["modelCalls", usage.modelCalls],
    ["promptTokens", usage.promptTokens],
    ["completionTokens", usage.completionTokens],
    ["totalTokens", usage.totalTokens],
    ["costUsd", usage.costUsd],
  ];
  for (const [name, value] of numbers)
    if (!Number.isFinite(value) || value < 0)
      problems.push(`${name} is not a finite non-negative number`);
  if (!Number.isInteger(usage.modelCalls)) problems.push("modelCalls is not an integer");
  if (usage.modelCalls < 1) problems.push("modelCalls is 0 after a model turn");
  if (usage.totalTokens !== usage.promptTokens + usage.completionTokens)
    problems.push("totalTokens != promptTokens + completionTokens");
  if (typeof usage.estimated !== "boolean") problems.push("estimated is not boolean");
  return problems;
}

/** Build one report row; `checks` is the source of truth for passed/failed. */
export function summarizeScenario(input: {
  id: string;
  label: string;
  response?: ChatResponse;
  durationMs: number;
  checks: Check[];
  error?: unknown;
  model?: string | null;
  /** Catalog labels stripped when recording answer numbers. */
  catalogLabels?: string[];
}): ScenarioReport {
  const { response, checks } = input;
  const error =
    input.error === undefined
      ? undefined
      : input.error instanceof Error
        ? input.error.message
        : String(input.error);
  const labels = input.catalogLabels ?? [];
  const answer = response?.answer ?? "";
  return {
    id: input.id,
    label: input.label,
    passed: !error && checks.length > 0 && checks.every((check) => check.passed),
    kind: response?.kind ?? null,
    completion: response?.completion ?? null,
    artifacts: response ? artifactKinds(response) : [],
    resultRefCount: response?.resultRefs?.length ?? 0,
    factRefCount: response?.factRefs?.length ?? 0,
    durationMs: input.durationMs,
    usage: response?.usage ?? null,
    costUsd: response?.usage?.costUsd ?? null,
    model: response?.planning.model ?? input.model ?? null,
    requestId: response?.requestId ?? null,
    answerPreview: answer.slice(0, 200),
    answerNumbers: response ? answerNumbers(answer, labels) : [],
    inventedNumbers: response ? inventedNumbers(answer, labels, verifiedText(response)) : [],
    warning: response?.warning ?? null,
    checks,
    ...(error ? { error } : {}),
  };
}

export function buildReport(input: {
  mode: EvalMode;
  startedAt: string;
  dataset: string;
  dataDir: string;
  model: string | null;
  envFile: string | null;
  scenarios: ScenarioReport[];
}): EvalReport {
  const passed = input.scenarios.filter((scenario) => scenario.passed).length;
  const total = input.scenarios.length;
  return {
    ...input,
    mocked: input.mode === "mock",
    finishedAt: new Date().toISOString(),
    total,
    passed,
    passRate: total ? Math.round((passed / total) * 1000) / 10 : 0,
  };
}

/** Stable report file name, e.g. `unified-mock-2026-10-19T06-00-00-000Z.json`. */
export function reportFileName(mode: EvalMode, timestamp: string): string {
  const safe = timestamp.replaceAll(":", "-").replaceAll(".", "-");
  return `unified-${mode}-${safe}.json`;
}
