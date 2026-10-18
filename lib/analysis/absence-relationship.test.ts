import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("absence/score relationship uses the attendance facts", () => {
  let directory: string;
  let query: typeof import("./duckdb").chartStudioData;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "absence-relation-"));
    const header =
      "id_student,code_module,code_presentation,score,completed,scheduled_sessions,attendance_rate,homework_completion_rate,absent_sessions,excused_sessions";
    const rows = [header];
    for (let i = 1; i <= 3; i++) rows.push(`S${i},数学,2025J,60,1,32,90,100,2,1`);
    rows.push("S1,数学,2025J,60,1,32,90,100,2,1");
    for (let i = 4; i <= 6; i++) rows.push(`S${i},数学,2025J,80,1,32,95,100,0,2`);
    for (let i = 7; i <= 8; i++) rows.push(`S${i},数学,2025J,95,1,32,100,100,0,0`);
    for (let i = 9; i <= 11; i++) rows.push(`S${i},数学,2025J,75,1,32,90,100,,0`);
    writeFileSync(join(directory, "student_outcomes.csv"), rows.join("\n"));
    writeFileSync(
      join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\nS1,数学,2025J,1,100\nS2,数学,2025J,1,200\nS3,数学,2025J,1,300\n",
    );
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.resetModules();
    query = (await import("./duckdb")).chartStudioData;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  it("counts approved leave and unexcused absence without substituting attendance rate or activity", async () => {
    const data = await query("demo", "2025J", "数学", {}, { densityMetric: "absence" });
    expect(data.tables.density?.columns).toEqual(["缺勤课时", "成绩区间中心", "频数"]);
    expect(data.tables.density?.rows).toEqual([
      { 缺勤课时: 2, 成绩区间中心: 82.5, 频数: "3" },
      { 缺勤课时: 3, 成绩区间中心: 62.5, 频数: "3" },
    ]);
    expect(data.tables.density?.description).toContain("包含请假缺席与旷课");
    expect(JSON.stringify(data.tables.density)).not.toContain("S1");
  });
  it("can isolate unexcused absence from approved leave", async () => {
    const data = await query("demo", "2025J", "数学", {}, { densityMetric: "unexcused" });
    expect(data.tables.density?.rows).toContainEqual({
      旷课课时: 0,
      成绩区间中心: 82.5,
      频数: "3",
    });
    expect(data.tables.density?.rows).toContainEqual({
      旷课课时: 2,
      成绩区间中心: 62.5,
      频数: "3",
    });
    expect(data.tables.density?.description).toContain("不含请假缺席");
  });
  it("suppresses two-person cells and does not replace missing absence records with zero", async () => {
    const data = await query("demo", "2025J", "数学", {}, { densityMetric: "absence" });
    expect(data.tables.density?.rows).toHaveLength(2);
    expect(
      data.tables.density?.rows.every(
        (r) => Number(r["频数"]) >= 3 && r["成绩区间中心"] !== 77.5 && r["成绩区间中心"] !== 97.5,
      ),
    ).toBe(true);
  });
});
