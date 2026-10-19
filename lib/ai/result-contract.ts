/**
 * Unified statistical result contract (unified-AI roadmap, stage 2).
 *
 * One place decides how a statistical result is identified and how a number is
 * bound to that result. Both the table and the chart of the same analysis must
 * carry the same `resultId`; a number shown in prose must be a `FactRef` that
 * points at an existing `ResultRef` in the same response.
 *
 * This module is imported by client components, so it must stay free of Node
 * built-ins (no `node:crypto`, no `fs`). The hash below is a deterministic
 * non-cryptographic fingerprint for identity only, never for security.
 */
import type { DataSource, Dimension } from "../analysis/types";

export const RESULT_CONTRACT_VERSION = 1;

/**
 * Declared versions of the frozen definitions. `data/schema/data-dictionary.json`
 * and `data/schema/metric-definitions.json` hold the authoritative `version`
 * fields; `result-contract.test.ts` fails when these constants drift from them.
 * OULAD ships no machine-readable version (its `.names` file only states the
 * 2015 release), so its label pins the public release rather than a file digest.
 * Dynamic file-content versioning is still unimplemented (roadmap P2) and must
 * not be claimed by these strings.
 */
export const DATASET_VERSIONS: Record<DataSource, string> = {
  demo: "data-dictionary-v2",
  oulad: "oulad-public-2015",
};
export const METRIC_VERSION = "metric-definitions-v1";

/**
 * Every result kind in one runtime list. The chat request schema validates the
 * cross-turn result summaries against it, so adding a kind can never silently
 * leave the transport behind.
 */
export const RESULT_KINDS = [
  "aggregate",
  "compare_terms",
  "distribution",
  "advanced_chart",
  "relations",
  "panorama",
  "absence",
] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

/** What a result is about, independent of any single value. */
export type ResultScope = {
  version: typeof RESULT_CONTRACT_VERSION;
  datasetId: DataSource;
  datasetVersion: string;
  metricVersion: string;
  kind: ResultKind;
  /** Metric id (`score`/`activity`/`completion_rate`) or tool id (`density`/`dumbbell`/…). */
  metric: string;
  granularity: "course" | "term" | "course_term" | "student_course_term" | "group";
  courses: string[];
  terms: string[];
  filters: { field: Dimension; op: "eq" | "in"; value: string | string[] }[];
  /** Kind-specific identity parts (bin width, threshold, comparison term, …). */
  extra: Record<string, string | number | null>;
};

/** Identity + scope + measured limits of one statistical result. */
export type ResultRef = ResultScope & {
  /** Deterministic for the same scope: equal scope → equal id. */
  resultId: string;
  unit: string;
  minSampleSize: number;
  /** Distinct participants when they cannot overlap; null when groups may share students. */
  sampleSize: number | null;
  /** Human-readable scope, e.g. `模拟校园数据 · 学期：2025J · 课程筛选：…`. */
  scopeLabel: string;
  limitations: string[];
};

/** One verifiable fact bound to a result. Numbers are computed, never model-written. */
export type FactRef = {
  factId: string;
  resultId: string;
  /** Short name of what was measured. */
  label: string;
  /** Human sentence rendered by the program from the computed value. */
  text: string;
  /** Structured value for programmatic checks; null for non-numeric facts. */
  numeric: {
    value: number;
    unit: string;
    sampleSize: number | null;
    numerator?: number;
    denominator?: number;
  } | null;
  /** Meaning of an atomic value; never infer a score from a change or a headcount. */
  semantic?: {
    subject: string;
    metric: string;
    role:
      "before" | "after" | "change" | "decrease" | "sample_size" | "maximum" | "minimum" | "range";
    term?: string;
    comparisonTerm?: string;
    largestDecline?: boolean;
  };
  limitations: string[];
};

/** Stable JSON: object keys sorted, arrays preserved. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function fnv(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 16 hex chars. Identity only: collisions cannot grant access to anything. */
export function stableHash(value: unknown): string {
  const text = canonicalJson(value);
  return fnv(text, 0x811c9dc5) + fnv(text, 0x7f4a7c15);
}

/** Sort + dedupe scope labels so the same scope always hashes identically. */
export function normalizeScope(scope: ResultScope): ResultScope {
  const sort = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  return {
    ...scope,
    courses: sort(scope.courses),
    terms: sort(scope.terms),
    filters: [...scope.filters]
      .map((filter) => ({
        ...filter,
        value: Array.isArray(filter.value) ? sort(filter.value) : filter.value,
      }))
      // Sort on the full canonical filter, not just field+op: two `eq` filters on
      // the same field would otherwise keep an order-dependent identity.
      .sort((a, b) => {
        const left = canonicalJson(a);
        const right = canonicalJson(b);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
  };
}

export function makeResultId(scope: ResultScope): string {
  return `r-${stableHash(normalizeScope(scope))}`;
}

export function makeFactId(resultId: string, label: string): string {
  return `f-${stableHash({ resultId, label })}`;
}

export type ResultRefInput = Omit<
  ResultRef,
  "version" | "resultId" | "datasetId" | "datasetVersion" | "metricVersion"
> & {
  datasetId: DataSource;
};

/** Build a complete ref; the id is always derived, so callers cannot invent one. */
export function buildResultRef(input: ResultRefInput): ResultRef {
  const scope: ResultScope = {
    version: RESULT_CONTRACT_VERSION,
    datasetId: input.datasetId,
    datasetVersion: DATASET_VERSIONS[input.datasetId],
    metricVersion: METRIC_VERSION,
    kind: input.kind,
    metric: input.metric,
    granularity: input.granularity,
    courses: input.courses,
    terms: input.terms,
    filters: input.filters,
    extra: input.extra,
  };
  return {
    ...normalizeScope(scope),
    resultId: makeResultId(scope),
    unit: input.unit,
    minSampleSize: input.minSampleSize,
    sampleSize: input.sampleSize,
    scopeLabel: input.scopeLabel,
    limitations: input.limitations,
  };
}

/** Attach a fact to a result, deriving `factId` from the result and the label. */
export function buildFactRef(
  result: ResultRef,
  fact: Omit<FactRef, "factId" | "resultId">,
): FactRef {
  return { ...fact, factId: makeFactId(result.resultId, fact.label), resultId: result.resultId };
}

/**
 * A response may only cite its own results. A fact whose `resultId` is absent is
 * dangling: callers must show the valid facts and mark the explanation as
 * incomplete rather than presenting an unverifiable number.
 */
export function danglingFactRefs(artifacts: ResultRef[], facts: FactRef[]): FactRef[] {
  const known = new Set(artifacts.map((artifact) => artifact.resultId));
  return facts.filter((fact) => !known.has(fact.resultId));
}
