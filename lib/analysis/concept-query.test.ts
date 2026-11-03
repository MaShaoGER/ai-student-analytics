import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { conceptExplorerData } from "./concept-query";

describe("concept explorer real aggregates", () => {
  let directory: string;
  let query: typeof conceptExplorerData;
  const header = "id_student,code_module,code_presentation,score,completed,scheduled_sessions,present_sessions,late_sessions,early_leave_sessions,assignment_count,submitted_assignments,on_time_assignments,late_assignments,missing_assignments";
  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "concept-query-"));
    const grades = [10, 50, 60, 70, 90, 100], done = [1, 0, 0, 1, 0, 1];
    const scheduled = [2, 4, 10, 10, 10, 4], attended = [0, 2, 5, 8, 10, 4];
    const assigned = [2, 2, 2, 2, 10, 2], submitted = [0, 1, 1, 1, 8, 2], ontime = [0, 1, 0, 1, 6, 2];
    const rows = [header], weeks = ["id_student,code_module,code_presentation,week,scheduled_sessions,present_sessions,late_sessions,early_leave_sessions"];
    for (let i = 0; i < 6; i++) {
      rows.push(`p${i},主课,2025J,${grades[i]},${done[i]},${scheduled[i]},${attended[i]},0,0,${assigned[i]},${submitted[i]},${ontime[i]},${submitted[i]-ontime[i]},${assigned[i]-submitted[i]}`);
      const first = Math.floor(attended[i]/2);
      for (let week = 1; week <= 2; week++) weeks.push(`p${i},主课,2025J,${week},${scheduled[i]/2},${week===1?first:attended[i]-first},0,0`);
    }
    for (let i = 0; i < 2; i++) rows.push(`q${i},小样本,2025J,80,1,,,,,,,,,`);
    for (let i = 0; i < 3; i++) rows.push(`z${i},零成绩,2025J,0,,,,,,,,,,`);
    for (let i = 0; i < 3; i++) rows.push(`y${i},旧学期课,2024J,99,1,,,,,,,,,`);
    writeFileSync(path.join(directory, "student_outcomes.csv"), rows.join("\n")+"\n");
    writeFileSync(path.join(directory, "attendance_weekly.csv"), weeks.join("\n")+"\n");
    writeFileSync(path.join(directory, "learning_activity.csv"), "id_student,code_module,code_presentation,week,activity_count\np0,主课,2025J,1,0\n");
    vi.stubEnv("DEMO_DATA_DIR", directory); vi.resetModules();
    // The source module captures DEMO_DATA_DIR at load time; import after installing this test's isolated fixture.
    query = (await import("./concept-query")).conceptExplorerData;
  });
  afterAll(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

  it("weights attendance and assignments by their actual totals, while counting contributing students", async () => {
    const result = await query("demo", { course: "主课" });
    const metrics = result.courses.find(c => c.course === "主课")!.metrics;
    expect(result.term).toBe("2025J");
    expect(metrics.attendance).toEqual({ value: 72.5, count: 6 });
    expect(metrics.score).toEqual({ value: 63.33, count: 6 });
    expect(metrics.pass).toEqual({ value: 66.67, count: 6 });
    expect(metrics.completion).toEqual({ value: 50, count: 6 });
    expect(metrics.homework).toEqual({ value: 65, count: 6 });
    expect(metrics.ontime).toEqual({ value: 50, count: 6 });
    expect(result.detail?.weeklyAttendance?.map(w => w.value)).toEqual([70, 75]);
    expect(result.detail?.homework).toEqual({ scheduled: 20, onTime: 10, late: 3, missing: 7 });
  });

  it("distinguishes hidden small groups from empty groups, including the 100% endpoint", async () => {
    const result = await query("demo", { course: "主课" });
    const bands = result.detail!.attendanceBands!;
    expect(bands[0]).toMatchObject({ count: null, suppressed: true, meanScore: null, passRate: null });
    expect(bands[1]).toMatchObject({ count: 0, suppressed: false, meanScore: null });
    expect(bands[4]).toMatchObject({ count: 3, includeMax: true, meanScore: 86.67, passRate: 100, attendanceRate: 91.67 });
    expect(result.detail!.scoreBins[9]).toMatchObject({ count: null, suppressed: true, includeMax: true });
    const small = await query("demo", { course: "小样本" });
    expect(small.detail).toBeNull();
    expect(small.courses.find(c => c.course === "小样本")).toMatchObject({ count: null, suppressed: true, metrics: { score: { value: null, count: null } } });
  });

  it("preserves genuine zero values and does not turn absent completion or attendance into zero", async () => {
    const result = await query("demo", { course: "零成绩" });
    const metrics = result.courses.find(c => c.course === "零成绩")!.metrics;
    expect(metrics.score).toEqual({ value: 0, count: 3 });
    expect(metrics.pass).toEqual({ value: 0, count: 3 });
    expect(metrics.completion.value).toBeNull();
    expect(metrics.attendance.value).toBeNull();
    expect(result.detail?.completionCounts).toBeNull();
  });

  it("rejects a missing term or course instead of changing scope", async () => {
    await expect(query("demo", { term: "1900J" })).rejects.toMatchObject({ code: "INVALID_TERM" });
    await expect(query("demo", { course: "不存在' OR '1'='1" })).rejects.toMatchObject({ code: "COURSE_NOT_FOUND" });
    await expect(query("demo", { course: "旧学期课", term: "2025J" })).rejects.toMatchObject({ code: "COURSE_NOT_IN_TERM" });
  });

  it("keeps a directly selected course resolvable when the displayed catalog is bounded", async () => {
    const rows = [];
    for (let i = 0; i < 101; i++) for (let s = 0; s < 3; s++) rows.push(`c${i}p${s},A${String(i).padStart(3,"0")},2025J,75,1,,,,,,,,,`);
    appendFileSync(path.join(directory, "student_outcomes.csv"), rows.join("\n")+"\n");
    const result = await query("demo", { course: "主课" });
    expect(result.totalCourses).toBe(104);
    expect(result.courses).toHaveLength(100);
    expect(result.courses.find(c => c.course === "主课")?.count).toBe(6);
    expect(result.detail?.course).toBe("主课");
  });
});
