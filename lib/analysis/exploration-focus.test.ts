import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExplorationFocus, FocusStep } from "../exploration/selection";

import type { chartStudioData, courseRelations, coursePanorama } from "./duckdb";
const grade = vi.hoisted(() => ({
  path: "",
  hasCompletion: false,
  version: "focus-fixture",
  name: "受控成绩",
}));
vi.mock("../datasets/grade-store", () => ({
  getGradeSnapshot: () => grade,
  getGradeDataset: () => grade,
  withGradeSnapshot: (_id: string, run: () => unknown) => run(),
}));

/** Real CSV parsing, joins and aggregation; neither DuckDB nor its executor is mocked. */
describe("exploration focus uses one private cohort across all eight destinations", () => {
  let directory: string;
  let studio: typeof chartStudioData;
  let relations: typeof courseRelations;
  let panorama: typeof coursePanorama;
  const focus = (...steps: FocusStep[]): ExplorationFocus => ({ steps });
  const week: FocusStep = { kind: "week", term: "T2", course: "A", week: 1 };
  const low: FocusStep = { kind: "score", term: "T2", course: "A", min: 0, max: 60 };
  const selected = (selection: ExplorationFocus, term = "T2", course = "") =>
    studio("demo", term, course, {}, { focus: selection });

  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "exploration-focus-"));
    const outcomes = [
      "id_student,code_module,code_presentation,score,completed,scheduled_sessions,attendance_rate,homework_completion_rate,absent_sessions,excused_sessions",
    ];
    const activity = ["id_student,code_module,code_presentation,week,activity_count"];
    const add = (
      id: string,
      score: string | number,
      attendance: number,
      homework: number,
      completed: string | number,
      b: number,
      week: number,
      visits: number,
    ) => {
      outcomes.push(`${id},A,T2,${score},${completed},32,${attendance},${homework},0,0`);
      outcomes.push(`${id},B,T2,${b},1,32,100,100,0,0`);
      activity.push(`${id},A,T2,${week},${visits}`);
    };
    for (let i = 1; i <= 3; i++) {
      add(`private-L${i}`, 55, 70, 50, 0, 40, 1, (i - 1) * 10);
      outcomes.push(`private-L${i},C,T2,${[95, 99, 100][i - 1]},1,32,100,100,0,0`);
      outcomes.push(`private-L${i},A,T1,20,0,32,70,50,0,0`);
      outcomes.push(`private-L${i},Q'course,T'0,20,0,32,70,50,0,0`);
      add(`private-H${i}`, i === 1 ? 95 : 100, 100, 100, 1, 80, 2, 100);
      outcomes.push(`private-H${i},A,T1,80,1,32,100,100,0,0`);
      add(`private-V${i}`, 65, 85, 75, 1, 80, 3, 100);
      // Completion/activity records with no valid score must not become score members.
      add(`private-M${i}`, "", 100, 100, 1, 80, 9, 0);
    }
    for (let i = 1; i <= 2; i++) {
      // Each full path has only two records; their combined node/edge must remain hidden.
      add(`private-Q${i}`, 55, 70, 75, 0, 80, 4, 200);
      add(`private-R${i}`, 55, 70, 95, "", 80, 5, 300);
      add(`private-U${i}`, 75, 90, 100, 1, 80, 6, 100);
    }
    activity.push("private-L1,A,T2,1,5");
    writeFileSync(path.join(directory, "student_outcomes.csv"), outcomes.join("\n"));
    writeFileSync(path.join(directory, "learning_activity.csv"), activity.join("\n"));
    grade.path = path.join(directory, "grades.csv");
    writeFileSync(
      grade.path,
      "id_student,code_module,code_presentation,score,completed\n001,G,T2,95,\n01,G,T2,100,\n1,G,T2,100,\n",
    );
    const oulad = path.join(directory, "oulad_raw");
    mkdirSync(oulad);
    writeFileSync(
      path.join(oulad, "assessments.csv"),
      "id_assessment,code_module,code_presentation\n1,A,T2\n2,A,T1\n",
    );
    writeFileSync(path.join(oulad, "courses.csv"), "code_module,code_presentation\nA,T2\nA,T1\n");
    const assessments = ["id_assessment,id_student,score"];
    const info = ["id_student,code_module,code_presentation,final_result"];
    const vle = ["id_student,code_module,code_presentation,date,sum_click"];
    for (let i = 1; i <= 3; i++) {
      assessments.push(
        `1,private-OL${i},50`,
        `2,private-OL${i},40`,
        `1,private-OH${i},90`,
        `2,private-OH${i},80`,
      );
      info.push(`private-OL${i},A,T2,Pass`, `private-OH${i},A,T2,Fail`);
      vle.push(
        `private-OL${i},A,T2,0,0`,
        `private-OL${i},A,T2,7,100`,
        `private-OH${i},A,T2,14,200`,
      );
    }
    writeFileSync(path.join(oulad, "studentAssessment.csv"), assessments.join("\n"));
    writeFileSync(path.join(oulad, "studentInfo.csv"), info.join("\n"));
    writeFileSync(path.join(oulad, "studentVle.csv"), vle.join("\n"));
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.resetModules();
    // Import-time source paths are the boundary under test; a static import would bind live paths.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
    try {
      const queries = await import("./duckdb");
      studio = queries.chartStudioData;
      relations = queries.courseRelations;
      panorama = queries.coursePanorama;
    } finally {
      cwd.mockRestore();
    }
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps explicit zero activity and aggregates duplicate student-week rows before measuring rhythm", async () => {
    const data = await selected(focus(week));
    expect(data.focusSummary).toMatchObject({ count: 3, suppressed: false });
    expect(data.tables.heatmap?.rows).toEqual([
      { 周次: 1, 课程: "A", 人均访问次数: 11.67, 当周有记录人数: "3" },
    ]);
    expect(data.focusedResults?.activity?.rows).toEqual([
      { dimension: "A", value: 35, sampleSize: 3 },
    ]);
    expect(data.focusedResults?.score?.rows).toContainEqual({
      dimension: "A",
      value: 55,
      sampleSize: 3,
    });
    expect(data.focusedResults?.completion_rate?.rows).toContainEqual({
      dimension: "A",
      value: 0,
      sampleSize: 3,
    });
    expect(data.tables.dumbbell?.rows).toEqual([
      { 课程: "A", 前期均分: 20, 后期均分: 55, 前期样本: "3", 后期样本: "3" },
    ]);
    expect(data.tables.dumbbell?.meta).toMatchObject({
      project: true,
      beforeTerm: "T1",
      afterTerm: "T2",
    });
    expect(data.coverage?.map((item) => [item.scene, item.available])).toEqual([
      ["aggregate", true],
      ["sankey", true],
      ["boxplot", true],
      ["heatmap", true],
      ["density", true],
      ["dumbbell", true],
      ["relations", true],
      ["panorama", true],
    ]);
    expect(JSON.stringify(data)).not.toContain("private-");
  });

  it("intersects each step in its own source scope and keeps membership across view term/course changes", async () => {
    const selection = focus(low, { kind: "term", term: "T1" });
    const data = await selected(selection, "T2", "B");
    expect(data.focusSummary?.count).toBe(3);
    expect(data.focusedResults?.score?.rows).toEqual([
      { dimension: "B", value: 40, sampleSize: 3 },
    ]);
    expect(data.courses).toEqual(["A", "B", "C"]);
    expect(data.terms).toEqual(["T2", "T1", "T'0"]);
    const previous = await selected(focus(week), "T1", "A");
    expect(previous.tables.boxplot?.rows[0]).toMatchObject({ 中位数: 20, 样本数: "3" });
    const quoted = await selected(
      focus({ kind: "course", term: "T'0", course: "Q'course" }),
      "T2",
      "A",
    );
    expect(quoted.focusSummary?.count).toBe(3);
    const injection = await selected(focus({ kind: "course", term: "T2", course: "A' OR 1=1 --" }));
    expect(injection.focusSummary).toMatchObject({ count: null, suppressed: true });
  });

  it("distinguishes valid scores, recorded activity and known completion flags", async () => {
    const score = await selected(
      focus({ kind: "course", term: "T2", course: "A", population: "score" }),
    );
    const activity = await selected(
      focus({ kind: "course", term: "T2", course: "A", population: "activity" }),
    );
    const completion = await selected(
      focus({ kind: "course", term: "T2", course: "A", population: "completion_rate" }),
    );
    expect([
      score.focusSummary?.count,
      activity.focusSummary?.count,
      completion.focusSummary?.count,
    ]).toEqual([15, 18, 16]);
    const missingScores = await selected(
      focus({ kind: "week", term: "T2", course: "A", week: 9 }),
      "T2",
      "A",
    );
    expect(missingScores.focusSummary?.count).toBe(3);
    expect(missingScores.focusedResults?.score?.rows).toEqual([]);
    expect(missingScores.focusedResults?.activity?.rows).toEqual([
      { dimension: "A", value: 0, sampleSize: 3 },
    ]);
    expect(missingScores.focusedResults?.completion_rate?.rows).toEqual([
      { dimension: "A", value: 100, sampleSize: 3 },
    ]);
    expect(missingScores.coverage?.find((item) => item.scene === "heatmap")?.available).toBe(true);
    expect(missingScores.coverage?.find((item) => item.scene === "density")?.available).toBe(false);
  });

  it("selects original density bins, including the capped attendance and 100-point score bin", async () => {
    const attendance = await selected(
      focus({ kind: "density", term: "T2", course: "A", metric: "attendance", x: 75, y: 57.5 }),
    );
    expect(attendance.focusSummary?.count).toBe(7);
    expect(attendance.tables.density?.rows).toContainEqual({
      出勤率区间中心: 75,
      成绩区间中心: 57.5,
      频数: "7",
    });
    expect(attendance.tables.density?.meta?.density).toEqual({
      metric: "attendance",
      xWidth: 10,
      yWidth: 5,
    });
    const activity = await studio(
      "demo",
      "T2",
      "A",
      {},
      {
        densityMetric: "activity",
        focus: focus({
          kind: "density",
          term: "T2",
          course: "A",
          metric: "activity",
          x: 50,
          y: 57.5,
        }),
      },
    );
    expect(activity.focusSummary?.count).toBe(3);
    expect(activity.tables.density?.rows).toEqual([
      { 活动量区间中心: 50, 成绩区间中心: 57.5, 频数: "3" },
    ]);
    expect(activity.tables.density?.meta?.density).toEqual({
      metric: "activity",
      xWidth: 100,
      yWidth: 5,
    });
    const last = await selected(
      focus({ kind: "density", term: "T2", course: "A", metric: "attendance", x: 95, y: 97.5 }),
    );
    expect(last.focusSummary?.count).toBe(3);
    const hidden = await selected(
      focus({ kind: "density", term: "T2", course: "A", metric: "activity", x: 250, y: 57.5 }),
    );
    expect(hidden.focusSummary).toMatchObject({ count: null, suppressed: true });
  });

  it("picks only visible complete paths, never a union of suppressed partial paths", async () => {
    const data = await selected(focus({ kind: "path", term: "T2", course: "A", attendance: 0 }));
    expect(data.focusSummary?.count).toBe(3);
    expect(data.focusedResults?.activity?.rows).toEqual([
      { dimension: "A", value: 35, sampleSize: 3 },
    ]);
    const hidden = await selected(
      focus({ kind: "path", term: "T2", course: "A", attendance: 0, homework: 1 }),
    );
    expect(hidden.focusSummary).toMatchObject({ count: null, suppressed: true });
    const edge = await selected(
      focus({ kind: "path", term: "T2", course: "A", homework: 0, score: 0 }),
    );
    expect(edge.focusSummary?.count).toBe(3);
    const preceding: FocusStep = { kind: "score", term: "T2", course: "B", min: 80, max: 85 };
    const hiddenAfterIntersection = await selected(
      focus(preceding, { kind: "path", term: "T2", course: "A", attendance: 0 }),
    );
    expect(hiddenAfterIntersection.focusSummary).toMatchObject({ count: null, suppressed: true });
    const visibleBinAfterIntersection = await selected(
      focus(preceding, {
        kind: "density",
        term: "T2",
        course: "A",
        metric: "attendance",
        x: 75,
        y: 57.5,
      }),
    );
    expect(visibleBinAfterIntersection.focusSummary?.count).toBe(4);
  });

  it("keeps score intervals right-open except an explicitly inclusive final bin", async () => {
    const last = await selected(
      focus({ kind: "score", term: "T2", course: "A", min: 95, max: 100, includeMax: true }),
    );
    expect(last.focusSummary?.count).toBe(3);
    expect(last.tables.boxplot?.rows.find((row) => row.课程 === "A")).toMatchObject({
      最小值: 95,
      最大值: 100,
      样本数: "3",
    });
    const open = await selected(
      focus({ kind: "score", term: "T2", course: "A", min: 95, max: 100 }),
    );
    expect(open.focusSummary).toMatchObject({ count: null, suppressed: true });
    const rightOpen = await selected(
      focus({ kind: "score", term: "T2", course: "A", min: 55, max: 65 }),
    );
    expect(rightOpen.focusSummary?.count).toBe(7);
  });

  it("uses the focused denominator for relations and refines panorama pairs inside the existing cohort", async () => {
    const selection = focus(low);
    const graph = await relations({ datasetId: "demo", term: "T2", focus: selection });
    expect(graph.relations).toEqual([
      { source: "A", target: "B", commonCount: 7, belowCount: 3, rate: 42.86 },
    ]);
    const data = await panorama({
      datasetId: "demo",
      term: "T2",
      focus: selection,
      source: "A",
      target: "B",
    });
    expect(data.totalStudents).toBe(7);
    expect(data.focusSummary?.count).toBe(7);
    expect(data.selection).toMatchObject({ count: 3, commonCount: 7 });
    expect(data.columns.find((column) => column.course === "A")).toMatchObject({
      baseline: { count: 7, mean: 55 },
      cohort: { count: 3, mean: 55 },
    });
    const paired = await selected(focus({ kind: "pair", term: "T2", source: "A", target: "B" }));
    expect(paired.focusSummary?.count).toBe(3);
    expect(paired.focusedResults?.score?.rows).toContainEqual({
      dimension: "B",
      value: 40,
      sampleSize: 3,
    });
    expect(JSON.stringify([graph, data])).not.toContain("private-");
  });

  it("suppresses the entire payload below three, without returning the exact count or falling back to all students", async () => {
    const selection = focus({ kind: "score", term: "T2", course: "A", min: 95, max: 100 });
    const data = await selected(selection);
    expect(data.focusSummary).toMatchObject({ count: null, suppressed: true });
    expect(data.tables).toEqual({});
    expect(data.coverage?.map((item) => item.available)).toEqual(Array(8).fill(false));
    expect(
      Object.values(data.focusedResults ?? {}).map((result) => [
        result.rows,
        result.filteredOutGroupCount,
      ]),
    ).toEqual([
      [[], null],
      [[], null],
      [[], null],
    ]);
    expect((await relations({ datasetId: "demo", focus: selection })).relations).toEqual([]);
    expect(
      (await panorama({ datasetId: "demo", focus: selection, source: "A", target: "B" })).columns,
    ).toEqual([]);
  });

  it("keeps the no-focus contract and only exposes actually supported imported-grade metrics", async () => {
    const full = await studio("demo", "T2", "A");
    expect(full.focusSummary).toBeUndefined();
    expect(full.focusedResults).toBeUndefined();
    expect(full.tables.boxplot?.rows[0]).toMatchObject({ 样本数: "15" });
    expect((await relations({ datasetId: "demo", term: "T2" })).relations).toContainEqual({
      source: "A",
      target: "B",
      commonCount: 15,
      belowCount: 3,
      rate: 20,
    });
    const id = "grades_00000000-0000-4000-8000-000000000001";
    const imported = await studio(
      id,
      "T2",
      "G",
      {},
      { focus: focus({ kind: "course", term: "T2", course: "G" }) },
    );
    expect(imported.focusSummary?.count).toBe(3);
    expect(imported.focusedResults?.score?.rows).toEqual([
      { dimension: "G", value: 98.33, sampleSize: 3 },
    ]);
    expect(imported.focusedResults?.activity).toBeUndefined();
    expect(imported.focusedResults?.completion_rate).toBeUndefined();
    expect(imported.focusedResults?.score?.query).not.toContain(grade.path);
    expect(imported.coverage?.filter((item) => item.available).map((item) => item.scene)).toEqual([
      "aggregate",
      "boxplot",
      "panorama",
    ]);
  });

  it("uses real OULAD week, activity, assessment and completion sources without inventing attendance", async () => {
    const selection = focus({ kind: "week", term: "T2", course: "A", week: 1 });
    const data = await studio("oulad", "T2", "A", {}, { focus: selection });
    expect(data.focusSummary?.count).toBe(3);
    expect(data.focusedResults?.score?.rows).toEqual([
      { dimension: "A", value: 50, sampleSize: 3 },
    ]);
    expect(data.focusedResults?.activity?.rows).toEqual([
      { dimension: "A", value: 300, sampleSize: 3 },
    ]);
    expect(data.focusedResults?.completion_rate?.rows).toEqual([
      { dimension: "A", value: 100, sampleSize: 3 },
    ]);
    expect(data.tables.heatmap?.rows).toEqual([
      { 周次: 1, 课程: "A", 人均访问次数: 0, 当周有记录人数: "3" },
      { 周次: 2, 课程: "A", 人均访问次数: 100, 当周有记录人数: "3" },
    ]);
    expect(data.tables.density?.rows).toEqual([
      { 活动量区间中心: 150, 成绩区间中心: 52.5, 频数: "3" },
    ]);
    expect(data.tables.dumbbell?.rows).toEqual([
      { 课程: "A", 前期均分: 40, 后期均分: 50, 前期样本: "3", 后期样本: "3" },
    ]);
    expect(data.coverage?.find((item) => item.scene === "sankey")?.available).toBe(false);
    expect(data.coverage?.find((item) => item.scene === "relations")?.available).toBe(false);
    expect(data.coverage?.find((item) => item.scene === "panorama")?.available).toBe(true);
    const cell = await studio(
      "oulad",
      "T2",
      "A",
      {},
      {
        focus: focus({
          kind: "density",
          term: "T2",
          course: "A",
          metric: "activity",
          x: 150,
          y: 52.5,
        }),
      },
    );
    expect(cell.focusSummary?.count).toBe(3);
    const unsupported = await studio(
      "oulad",
      "T2",
      "A",
      {},
      {
        focus: focus({
          kind: "density",
          term: "T2",
          course: "A",
          metric: "attendance",
          x: 75,
          y: 52.5,
        }),
      },
    );
    expect(unsupported.focusSummary).toMatchObject({ count: null, suppressed: true });
    expect(JSON.stringify(data)).not.toContain("private-");
  });

  it("rejects client IDs, excessive steps and non-original bins at the backend boundary", async () => {
    for (const invalid of [
      { steps: [week], ids: ["private-L1"] },
      { steps: Array(9).fill(week) },
      { steps: [{ kind: "density", term: "T2", metric: "attendance", x: 74, y: 57.5 }] },
      { steps: [{ kind: "score", term: "T2", course: "A", min: 50, max: 60, includeMax: true }] },
    ]) {
      await expect(relations({ datasetId: "demo", focus: invalid })).rejects.toMatchObject({
        name: "ZodError",
      });
      await expect(panorama({ datasetId: "demo", focus: invalid })).rejects.toMatchObject({
        name: "ZodError",
      });
    }
  });

  it("honors cancellation on focused requests", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      studio("demo", "T2", "", { signal: controller.signal }, { focus: focus(week) }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
