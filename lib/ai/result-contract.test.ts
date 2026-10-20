import { describe, expect, it } from "vitest";
import dictionary from "../../data/schema/data-dictionary.json";
import metricDefinitions from "../../data/schema/metric-definitions.json";
import {
  buildFactRef,
  buildResultRef,
  canonicalJson,
  danglingFactRefs,
  makeFactId,
  makeResultId,
  normalizeScope,
  stableHash,
  type ResultRef,
  type ResultScope,
} from "./result-contract";
import { DATASET_VERSIONS, METRIC_VERSION } from "./result-contract";

const scope: ResultScope = {
  version: 1,
  datasetId: "demo",
  datasetVersion: DATASET_VERSIONS.demo,
  metricVersion: METRIC_VERSION,
  kind: "distribution",
  metric: "score",
  granularity: "course_term",
  courses: ["Web前端开发"],
  terms: ["2025J"],
  filters: [{ field: "term", op: "eq", value: "2025J" }],
  extra: { binWidth: 5 },
};

const ref = (overrides: Partial<Parameters<typeof buildResultRef>[0]> = {}): ResultRef =>
  buildResultRef({
    datasetId: "demo",
    kind: "aggregate",
    metric: "score",
    granularity: "course",
    courses: [],
    terms: ["2025J"],
    filters: [{ field: "term", op: "eq", value: "2025J" }],
    extra: {},
    unit: "分",
    minSampleSize: 3,
    sampleSize: null,
    scopeLabel: "模拟校园数据 · 学期：2025J",
    limitations: [],
    ...overrides,
  });

describe("unified result contract", () => {
  it("derives a stable, content-addressed resultId", () => {
    expect(makeResultId(scope)).toBe(makeResultId({ ...scope }));
    expect(makeResultId(scope)).toMatch(/^r-[0-9a-f]{16}$/);
    // A different scope must not collide with the same id.
    expect(makeResultId({ ...scope, terms: ["2025B"] })).not.toBe(makeResultId(scope));
    expect(makeResultId({ ...scope, extra: { binWidth: 10 } })).not.toBe(makeResultId(scope));
  });

  it("does not depend on key order, label order or filter order", () => {
    const reordered = normalizeScope({
      ...scope,
      courses: ["B", "A"],
      terms: ["2025J", "2025B"],
      filters: [
        { field: "course", op: "in", value: ["B", "A"] },
        { field: "term", op: "eq", value: "2025J" },
      ],
    });
    const canonical = normalizeScope({
      ...scope,
      courses: ["A", "B"],
      terms: ["2025B", "2025J"],
      filters: [
        { field: "term", op: "eq", value: "2025J" },
        { field: "course", op: "in", value: ["A", "B"] },
      ],
    });
    expect(canonicalJson(reordered)).toBe(canonicalJson(canonical));
    expect(makeResultId({ ...scope, ...reordered })).toBe(makeResultId({ ...scope, ...canonical }));
  });

  it("keeps the id when only presentation changes", () => {
    const chart = ref();
    // `view` is deliberately not part of the identity: chart and table share it.
    expect(chart.resultId).toBe(ref({ scopeLabel: "改名也不影响身份" }).resultId);
  });

  it("scopes factId to its result so two results cannot share a fact", () => {
    const a = ref();
    const b = ref({ metric: "activity", unit: "次" });
    expect(makeFactId(a.resultId, "最高分组")).toBe(makeFactId(a.resultId, "最高分组"));
    expect(makeFactId(a.resultId, "最高分组")).not.toBe(makeFactId(b.resultId, "最高分组"));
  });

  it("treats a fact whose result is absent as dangling", () => {
    const result = ref();
    const fact = buildFactRef(result, {
      label: "参与人数",
      text: "参与统计 3 人。",
      numeric: { value: 3, unit: "人", sampleSize: 3 },
      limitations: [],
    });
    expect(fact.resultId).toBe(result.resultId);
    expect(danglingFactRefs([result], [fact])).toEqual([]);
    const orphan = { ...fact, resultId: "r-does-not-exist" };
    expect(danglingFactRefs([result], [orphan])).toEqual([orphan]);
  });

  it("is a deterministic fingerprint, not a security primitive", () => {
    expect(stableHash({ a: 1 })).toBe(stableHash({ a: 1 }));
    expect(stableHash({ a: 1 })).toHaveLength(16);
  });

  it("pins declared versions to the frozen definition files and says so", () => {
    // These constants must track the authoritative schema files, not invent a version.
    expect(DATASET_VERSIONS.demo).toBe(`data-dictionary-v${dictionary.version}`);
    expect(METRIC_VERSION).toBe(`metric-definitions-v${metricDefinitions.version}`);
    // OULAD has no machine-readable version; the label pins the public release.
    expect(DATASET_VERSIONS.oulad).toBe("oulad-public-2015");
  });
});

describe("filter ordering cannot change the identity", () => {
  it("treats reordered same-field filters as the same scope", () => {
    const base = {
      ...scope,
      filters: [
        { field: "course" as const, op: "eq" as const, value: "数学" },
        { field: "course" as const, op: "eq" as const, value: "英语" },
      ],
    };
    const reordered = { ...base, filters: [...base.filters].reverse() };
    expect(makeResultId(base)).toBe(makeResultId(reordered));
  });

  it("still distinguishes genuinely different filter sets", () => {
    const a = {
      ...scope,
      filters: [{ field: "term" as const, op: "eq" as const, value: "2025J" }],
    };
    const b = {
      ...scope,
      filters: [{ field: "term" as const, op: "eq" as const, value: "2025B" }],
    };
    expect(makeResultId(a)).not.toBe(makeResultId(b));
  });
});

describe("imported dataset version identity", () => {
  it("uses the immutable version for result and fact identities even when values match", () => {
    const datasetId = "grades_00000000-0000-4000-8000-000000000001" as const;
    const old = ref({ datasetId, datasetVersion: "v1-content" });
    const current = ref({ datasetId, datasetVersion: "v2-content" });
    expect(old.datasetVersion).toBe("v1-content");
    expect(current.datasetVersion).toBe("v2-content");
    expect(old.resultId).not.toBe(current.resultId);
    expect(makeFactId(old.resultId, "课程均分")).not.toBe(makeFactId(current.resultId, "课程均分"));
    expect(ref({ datasetId, datasetVersion: "v1-content" }).resultId).toBe(old.resultId);
  });
});
