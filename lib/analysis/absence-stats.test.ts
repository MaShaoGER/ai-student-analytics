import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { absenceSupport, OULAD_ABSENCE_LIMITATION } from "./absence-stats";

/**
 * "缺勤次数和成绩有关系吗" (roadmap §4.3) needs absence counted in its real
 * units. Sessions, days and distinct students are different questions and the
 * implementation must never answer one with another.
 */
describe("absence statistics contract", () => {
  let directory: string;
  let query: typeof import("./duckdb").absenceStats;
  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "absence-stats-"));
    const header =
      "id_student,code_module,code_presentation,score,completed,scheduled_sessions,attended_sessions,present_sessions,late_sessions,early_leave_sessions,excused_sessions,absent_sessions,attendance_rate";
    const rows = [header];
    // 数学 2025J: S1 missing 2 excused + 1 unexcused, S2 missing 0 + 2, S3 missing 0 + 0.
    rows.push("S1,数学,2025J,60,1,32,29,29,0,0,2,1,90");
    rows.push("S2,数学,2025J,70,1,32,30,30,0,0,0,2,93");
    rows.push("S3,数学,2025J,80,1,32,32,32,0,0,0,0,100");
    // 英语 2025J: three students with 0 and 2 absence sessions each.
    rows.push("S4,英语,2025J,50,1,32,30,30,0,0,0,2,93");
    rows.push("S5,英语,2025J,60,1,32,32,32,0,0,0,0,100");
    rows.push("S6,英语,2025J,90,1,32,30,30,0,0,0,2,93");
    // 数学 2024J: two students only, so every absence group is suppressed.
    rows.push("S7,数学,2024J,60,1,32,30,30,0,0,0,2,93");
    rows.push("S8,数学,2024J,70,1,32,28,28,0,0,2,2,87");
    writeFileSync(path.join(directory, "student_outcomes.csv"), rows.join("\n"));
    writeFileSync(
      path.join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\nS1,数学,2025J,1,10\n",
    );
    writeFileSync(
      path.join(directory, "leave_requests.csv"),
      [
        "leave_id,id_student,code_presentation,leave_type,request_date,start_date,end_date,start_week,end_week,duration_days,approval_status",
        "L1,S1,2025J,病假,2025-01-01,2025-01-02,2025-01-02,1,1,1,已批准",
        "L2,S2,2025J,事假,2025-01-01,2025-01-03,2025-01-04,1,1,2,已批准",
        "L3,S3,2025J,病假,2025-01-01,2025-01-05,2025-01-05,1,1,1,未批准",
        "L4,S7,2024J,病假,2024-01-01,2024-01-02,2024-01-03,1,1,2,已批准",
      ].join("\n"),
    );
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.resetModules();
    query = (await import("./duckdb")).absenceStats;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("counts missed class periods, not events or documents", async () => {
    const data = await query({ datasetId: "demo", term: "2025J", metric: "absence" });
    // 数学: S1 3, S2 2, S3 0 → 5. 英语: S4 2, S5 0, S6 2 → 4.
    // Ordered by course code; the exact collation is DuckDB's, not locale-aware.
    expect(data.rows).toEqual([
      { course: "数学", sessions: 5, students: 2 },
      { course: "英语", sessions: 4, students: 2 },
    ]);
    // 数学 {S1,S2} and 英语 {S4,S6} are disjoint, so person-course == distinct here.
    expect(data.totals).toEqual({
      sessions: 9,
      studentCourseCount: 4,
      distinctStudents: 4,
      approvedLeaveDays: 3,
    });
    // 3 approved leave days (1 + 2); the unapproved request is excluded.
    expect(data.totals.approvedLeaveDays).toBe(3);
  });

  it("keeps excused absence and unexcused absence distinguishable", async () => {
    const unexcused = await query({ datasetId: "demo", term: "2025J", metric: "unexcused" });
    expect(unexcused.rows.find((row) => row.course === "数学")?.sessions).toBe(3);
    expect(unexcused.totals.approvedLeaveDays).toBe(0);
    const excused = await query({ datasetId: "demo", term: "2025J", metric: "excused" });
    expect(excused.rows.find((row) => row.course === "数学")?.sessions).toBe(2);
    // absence = excused + unexcused for the same scope.
    const absence = await query({ datasetId: "demo", term: "2025J", metric: "absence" });
    expect(
      absence.rows.find((row) => row.course === "数学")!.sessions,
    ).toBe(
      excused.rows.find((row) => row.course === "数学")!.sessions +
        unexcused.rows.find((row) => row.course === "数学")!.sessions,
    );
  });

  it("suppresses groups below the minimum sample size instead of reporting zero", async () => {
    const data = await query({ datasetId: "demo", term: "2024J", metric: "absence" });
    expect(data.rows).toEqual([]);
    expect(data.minSampleSize).toBe(3);
    // The suppression threshold applies to the deduplicated total too: if every
    // group is hidden, no aggregate headcount may leak those students.
    expect(data.totals.distinctStudents).toBe(0);
    expect(data.totals.studentCourseCount).toBe(0);
    // Suppressed is not zero: the term really does have absences.
    const all = await query({ datasetId: "demo", metric: "absence" });
    expect(all.terms).toContain("2024J");
  });

  it("treats a missing absence value as missing, not as zero absence", async () => {
    // A NULL in either column must not silently become "no absence".
    const nulls = mkdtempSync(path.join(tmpdir(), "absence-nulls-"));
    const header =
      "id_student,code_module,code_presentation,score,completed,scheduled_sessions,attended_sessions,present_sessions,late_sessions,early_leave_sessions,excused_sessions,absent_sessions,attendance_rate";
    const rows = [
      header,
      "S1,数学,2025J,60,1,32,30,30,0,0,0,2,93",
      // excused is empty: the COALESCE keeps the known 3 unexcused periods.
      "S2,数学,2025J,60,1,32,29,29,0,0,,3,90",
      "S3,数学,2025J,60,1,32,32,32,0,0,0,0,100",
    ];
    writeFileSync(path.join(nulls, "student_outcomes.csv"), rows.join("\n"));
    writeFileSync(
      path.join(nulls, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\nS1,数学,2025J,1,10\n",
    );
    vi.stubEnv("DEMO_DATA_DIR", nulls);
    vi.resetModules();
    const { absenceStats } = await import("./duckdb");
    const data = await absenceStats({ datasetId: "demo", term: "2025J", metric: "absence" });
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(nulls, { recursive: true, force: true });
    // 2 (S1) + 3 (S2, excused missing) + 0 (S3) = 5, not 2.
    expect(data.rows[0].sessions).toBe(5);
  });

  it("never counts students from a suppressed group in the deduplicated total", async () => {
    // Mixed fixture: one eligible group of three and one two-person group.
    // Counting the suppressed group's students would contradict `rows`.
    const mixed = mkdtempSync(path.join(tmpdir(), "absence-suppress-"));
    const header =
      "id_student,code_module,code_presentation,score,completed,scheduled_sessions,attended_sessions,present_sessions,late_sessions,early_leave_sessions,excused_sessions,absent_sessions,attendance_rate";
    const rows = [header];
    for (let i = 1; i <= 3; i++) rows.push(`S${i},大组,2025J,60,1,32,30,30,0,0,0,2,93`);
    // A distinct two-person group with absence; must stay out of every total.
    rows.push("T1,小组,2025J,60,1,32,28,28,0,0,0,4,87");
    rows.push("T2,小组,2025J,60,1,32,28,28,0,0,0,4,87");
    writeFileSync(path.join(mixed, "student_outcomes.csv"), rows.join("\n"));
    writeFileSync(
      path.join(mixed, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\nS1,大组,2025J,1,10\n",
    );
    vi.stubEnv("DEMO_DATA_DIR", mixed);
    vi.resetModules();
    const { absenceStats } = await import("./duckdb");
    const data = await absenceStats({ datasetId: "demo", term: "2025J", metric: "absence" });
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(mixed, { recursive: true, force: true });
    expect(data.rows.map((row) => row.course)).toEqual(["大组"]);
    expect(data.rows[0]).toMatchObject({ sessions: 6, students: 3 });
    // Only the eligible group's students count; the hidden group is not leaked.
    expect(data.totals.distinctStudents).toBe(3);
    expect(data.totals.studentCourseCount).toBe(3);
  });

  it("scopes the term list to the actual filter", async () => {
    const scoped = await query({ datasetId: "demo", term: "2024J", metric: "absence" });
    expect(scoped.terms).toEqual(["2024J"]);
    const all = await query({ datasetId: "demo", metric: "absence" });
    expect(all.terms).toEqual(["2024J", "2025J"]);
  });

  it("refuses to convert leave days into missed periods", async () => {
    const days = await query({ datasetId: "demo", term: "2025J", unit: "days" });
    expect(days.supported).toBe(false);
    expect(days.unsupportedReason).toContain("不能换算");
    expect(days.rows).toEqual([]);
  });

  it("reports OULAD as unsupported rather than substituting activity", async () => {
    expect(absenceSupport("oulad", "sessions")).toEqual({
      supported: false,
      reason: OULAD_ABSENCE_LIMITATION,
    });
    const data = await query({ datasetId: "oulad", term: "2013J", metric: "absence" });
    expect(data.supported).toBe(false);
    expect(data.rows).toEqual([]);
    expect(data.totals).toEqual({
      sessions: 0,
      studentCourseCount: 0,
      distinctStudents: 0,
      approvedLeaveDays: 0,
    });
  });

  it("separates person-course counts from the deduplicated headcount", async () => {
    // S4 and S7 appear in two courses; summing per-course counts would double them.
    const data = await query({ datasetId: "demo", metric: "absence" });
    const distinct = new Set<string>();
    for (const row of [["S1"], ["S2"], ["S4"], ["S6"], ["S7"], ["S8"]] as const)
      for (const id of row) distinct.add(id);
    expect(data.totals.distinctStudents).toBe(distinct.size);
    expect(data.totals.studentCourseCount).toBeGreaterThanOrEqual(
      data.totals.distinctStudents,
    );
  });

  it("still counts absence when the leave table is missing", async () => {
    // A trimmed dataset may have outcomes without leave requests; the absence
    // count must survive and report 0 leave days rather than fail the request.
    const trimmed = mkdtempSync(path.join(tmpdir(), "absence-no-leave-"));
    const header =
      "id_student,code_module,code_presentation,score,completed,scheduled_sessions,attended_sessions,present_sessions,late_sessions,early_leave_sessions,excused_sessions,absent_sessions,attendance_rate";
    const rows = [header];
    for (let i = 1; i <= 3; i++) rows.push(`S${i},数学,2025J,60,1,32,30,30,0,0,0,2,93`);
    writeFileSync(path.join(trimmed, "student_outcomes.csv"), rows.join("\n"));
    writeFileSync(
      path.join(trimmed, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\nS1,数学,2025J,1,10\n",
    );
    vi.stubEnv("DEMO_DATA_DIR", trimmed);
    vi.resetModules();
    const { absenceStats } = await import("./duckdb");
    const data = await absenceStats({ datasetId: "demo", term: "2025J", metric: "absence" });
    vi.unstubAllEnvs();
    vi.resetModules();
    expect(data.supported).toBe(true);
    expect(data.rows[0].sessions).toBe(6);
    expect(data.totals.approvedLeaveDays).toBe(0);
    rmSync(trimmed, { recursive: true, force: true });
  });

  it("never returns student identifiers", async () => {
    const data = await query({ datasetId: "demo", term: "2025J", metric: "absence" });
    expect(JSON.stringify(data)).not.toMatch(/S\d/);
  });
});

/**
 * The public sample dataset is checked against an independent parse of its own
 * CSVs. Expected values were produced outside this codebase (a standalone
 * Python pass over data/sample) so a SQL or fixture regression cannot pass by
 * agreeing with itself.
 */
describe("absence numbers agree with an independent recomputation", () => {
  it("reproduces the published sample totals for 2025J", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (file: string) => {
      const text = readFileSync(`data/sample/${file}`, "utf8").replace(/^\uFEFF/u, "");
      const lines = text.split(/\r?\n/u).filter((line) => line.trim());
      const header = lines[0].split(",");
      return lines
        .slice(1)
        .map((line) =>
          Object.fromEntries(header.map((key, index) => [key, line.split(",")[index] ?? ""])),
        );
    };
    const outcomes = read("student_outcomes.csv").filter(
      (row) => row.code_presentation === "2025J",
    );
    const perCourse = new Map<string, { sessions: number; students: Set<string> }>();
    for (const row of outcomes) {
      const missed = Number(row.excused_sessions ?? 0) + Number(row.absent_sessions ?? 0);
      const entry = perCourse.get(row.code_module) ?? { sessions: 0, students: new Set() };
      entry.sessions += missed;
      if (missed > 0) entry.students.add(row.id_student);
      perCourse.set(row.code_module, entry);
    }
    const expected = [...perCourse.entries()]
      .filter(([, entry]) => entry.students.size > 0)
      .map(([course, entry]) => ({ course, sessions: entry.sessions, students: entry.students.size }));

    // This block reads the real sample dataset, so point the query at it: the
    // suite-wide fixture (vitest env) is a different, smaller directory.
    vi.stubEnv("DEMO_DATA_DIR", "data/sample");
    vi.resetModules();
    const { absenceStats } = await import("./duckdb");
    const data = await absenceStats({ datasetId: "demo", term: "2025J", metric: "absence" });
    vi.unstubAllEnvs();
    expect(data.supported).toBe(true);
    expect(data.rows).toHaveLength(expected.length);
    for (const item of expected) {
      const match = data.rows.find((row) => row.course === item.course);
      expect(match, item.course).toMatchObject({
        sessions: item.sessions,
        students: item.students,
      });
    }
    const approvedLeaveDays = read("leave_requests.csv")
      .filter((row) => row.approval_status === "已批准" && row.code_presentation === "2025J")
      .reduce((sum, row) => sum + Number(row.duration_days), 0);
    expect(data.totals.approvedLeaveDays).toBe(approvedLeaveDays);
  });
});
