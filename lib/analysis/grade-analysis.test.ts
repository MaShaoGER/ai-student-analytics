import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const state = vi.hoisted(() => ({
  path: "",
  hasCompletion: false,
  version: "v1-test",
  name: "导入成绩验证",
}));
vi.mock("../datasets/grade-store", () => ({
  getGradeSnapshot: () => state,
  getGradeDataset: () => state,
  withGradeSnapshot: (_id: string, run: () => unknown) => run(),
}));
import {
  absenceStats,
  chartStudioData,
  coursePanorama,
  courseRelations,
  profileDatasets,
  runAnalysis,
  scoreDistribution,
} from "./duckdb";
import { createPlan } from "./plan";
const id = "grades_00000000-0000-4000-8000-000000000001" as const;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grade-query-"));
  state.path = join(dir, "grades.csv");
  state.hasCompletion = false;
  state.version = "v1-test";
  writeFileSync(
    state.path,
    "id_student,code_module,code_presentation,score,completed\n001,课程甲,2026A,0,\n01,课程甲,2026A,60,\n1,课程甲,2026A,90,\n002,课程甲,2026A,,\n003,课程乙,2026A,80,\n004,课程乙,2026A,90,\n",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe("imported grade analysis uses typed immutable inputs", () => {
  it("keeps leading-zero identifiers distinct and excludes absent scores from values and privacy counts", async () => {
    const { result } = await runAnalysis(
      createPlan({ datasetId: id, metric: "score", dimension: "course", chartType: "bar" }),
    );
    expect(result).toMatchObject({
      datasetVersion: "v1-test",
      datasetName: state.name,
      rows: [{ dimension: "课程甲", value: 50, sampleSize: 3 }],
      filteredOutGroupCount: 1,
    });
    const distribution = await scoreDistribution(id);
    expect(distribution.groups).toHaveLength(1);
    expect(distribution.groups[0]).toMatchObject({ course: "课程甲", count: 3 });
    expect(distribution.groups[0].bins.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(distribution.groups[0].bins[0]).toBe(1);
    expect(JSON.stringify(distribution)).not.toContain('"id_student"');
    const [profile] = await profileDatasets({}, [id]);
    expect(profile).toMatchObject({ metrics: ["score"], datasetVersion: "v1-test" });
    expect(profile.tables[0].fields?.find((field) => field.name === "score")?.missing).toBe(1);
  });
  it("refuses unavailable metrics, while missing attendance is unsupported rather than zero", async () => {
    for (const metric of ["activity", "completion_rate"] as const)
      await expect(
        runAnalysis(createPlan({ datasetId: id, metric, dimension: "course", chartType: "bar" })),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_METRIC", status: 422 });
    expect(
      await absenceStats({ datasetId: id, metric: "unexcused", unit: "sessions" }),
    ).toMatchObject({ supported: false, rows: [] });
    const studio = await chartStudioData(id);
    expect(Object.keys(studio.tables).sort()).toEqual(["boxplot", "dumbbell"]);
    expect(studio.datasetVersion).toBe("v1-test");
    const relation = await courseRelations({ datasetId: id });
    expect(relation.courses).toEqual([{ name: "课程甲", count: 3 }]);
    expect(relation.datasetVersion).toBe("v1-test");
    const panorama = await coursePanorama({ datasetId: id });
    expect(panorama.columns[0].baseline).toMatchObject({ count: 3, mean: 50, passRate: 66.67 });
  });
  it("uses explicit completion instead of inferring it from pass scores", async () => {
    state.hasCompletion = true;
    writeFileSync(
      state.path,
      "id_student,code_module,code_presentation,score,completed\n001,课程甲,2026A,100,0\n01,课程甲,2026A,40,1\n1,课程甲,2026A,90,0\n",
    );
    const { result } = await runAnalysis(
      createPlan({
        datasetId: id,
        metric: "completion_rate",
        dimension: "course",
        chartType: "bar",
      }),
    );
    expect(result.rows).toEqual([{ dimension: "课程甲", value: 33.33, sampleSize: 3 }]);
  });
});

it("runs imported grades through the standard AI tool loop with versioned aggregate results", async () => {
  const { converseUnified, unifiedDefaults } = await import("../ai/unified");
  const generate = vi
    .fn()
    .mockImplementationOnce(async (messages) => {
      const catalog = JSON.parse(messages.at(-1).content).catalog;
      expect(catalog.metrics).toEqual(["score"]);
      expect(catalog.datasetVersion).toBe("v1-test");
      expect(JSON.stringify(messages)).not.toContain('"id_student"');
      return {
        model: "fixture",
        message: {
          role: "assistant",
          content: "",
          calls: [
            {
              id: "grade-aggregate",
              name: "aggregate",
              arguments: JSON.stringify({ metric: "score", dimension: "course", filters: [] }),
            },
          ],
        },
      };
    })
    .mockResolvedValueOnce({
      model: "fixture",
      message: { role: "assistant", content: "", calls: [] },
    });
  const response = await converseUnified(
    { datasetId: id, question: "比较各课程平均成绩。" },
    {},
    {
      ...unifiedDefaults,
      generate,
      compose: async () => ({
        model: "fixture",
        message: { role: "assistant", content: "", calls: [] },
      }),
      settings: () => ({ enabled: true, maxToolCalls: 4, timeoutSeconds: 30 }),
      capability: () => ({ status: "supported", checkedAt: null }),
    },
  );
  expect(response.artifact?.kind).toBe("analysis");
  if (response.artifact?.kind === "analysis")
    expect(response.artifact.result.rows).toEqual([
      { dimension: "课程甲", value: 50, sampleSize: 3 },
    ]);
  expect(response.resultRefs?.[0].datasetVersion).toBe("v1-test");
  expect(
    response.factRefs?.every((fact) =>
      response.resultRefs?.some((ref) => ref.resultId === fact.resultId),
    ),
  ).toBe(true);
});
