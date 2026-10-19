import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlan } from "./plan";
import { analysisCsv, analysisReportHtml } from "../exports/analysis";

describe("measured analysis scope on synthetic privacy fixtures", () => {
  let directory: string;
  let runAnalysis: (typeof import("./duckdb"))["runAnalysis"];
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "analysis-scope-"));
    const rows = [
      "s1,large,2024J,80,1",
      "s2,large,2024J,60,0",
      "s3,large,2024J,100,1",
      "s1,small,2024J,70,1",
      "s2,small,2024J,50,0",
      "s1,small,2024B,90,1",
      "s2,small,2024B,30,0",
      "s4,other,2024B,40,0",
      "s5,other,2024B,60,1",
      "s6,other,2024B,80,1",
    ];
    writeFileSync(
      join(directory, "student_outcomes.csv"),
      "id_student,code_module,code_presentation,score,completed\n" + rows.join("\n") + "\n",
    );
    writeFileSync(
      join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\n" +
        rows.map((row) => row.replace(/,[0-9]+,[01]$/, ",1,10")).join("\n") +
        "\n",
    );
    const oulad = join(directory, "oulad_raw");
    mkdirSync(oulad);
    writeFileSync(join(oulad, "courses.csv"), "code_module,code_presentation\nlarge,2024J\n");
    writeFileSync(
      join(oulad, "assessments.csv"),
      "id_assessment,code_module,code_presentation\n1,large,2024J\n2,small,2024J\n3,small,2024B\n4,other,2024B\n",
    );
    writeFileSync(
      join(oulad, "studentAssessment.csv"),
      "id_assessment,id_student,score\n" +
        rows
          .map((row) => {
            const [id, course, term, score] = row.split(",");
            return `${course === "large" ? 1 : course === "other" ? 4 : term === "2024J" ? 2 : 3},${id},${score}`;
          })
          .join("\n") +
        "\n",
    );
    writeFileSync(
      join(oulad, "studentInfo.csv"),
      "id_student,code_module,code_presentation,final_result\n" +
        rows
          .map((row) =>
            row.replace(/,[0-9]+,([01])$/, (_match, done) => `,${done === "1" ? "Pass" : "Fail"}`),
          )
          .join("\n") +
        "\n",
    );
    writeFileSync(
      join(oulad, "studentVle.csv"),
      "id_student,code_module,code_presentation,date,sum_click\n" +
        rows.map((row) => row.replace(/,[0-9]+,[01]$/, ",1,10")).join("\n") +
        "\n",
    );
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.spyOn(process, "cwd").mockReturnValue(directory);
    vi.resetModules();
    ({ runAnalysis } = await import("./duckdb"));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(["score", "activity", "completion_rate"] as const)(
    "counts %s suppressed groups before the display limit",
    async (metric) => {
      const plan = createPlan({
        datasetId: "demo",
        metric,
        dimension: "course",
        chartType: "table",
      });
      const { result } = await runAnalysis({ ...plan, limit: 1 });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].sampleSize).toBe(3);
      expect(result.filteredOutGroupCount).toBe(1); // Two people across both terms, not four.
      expect(result.period).toContain("学期：2024B、2024J");
      const dual = await runAnalysis({ ...plan, dimensions: ["course", "term"], limit: 1 });
      expect(dual.result.filteredOutGroupCount).toBe(2);
    },
  );

  it.each(["score", "activity", "completion_rate"] as const)(
    "measures OULAD %s scope using its own source and aggregation",
    async (metric) => {
      const plan = createPlan({
        datasetId: "oulad",
        metric,
        dimension: "course",
        chartType: "table",
      });
      const { result } = await runAnalysis({ ...plan, limit: 1 });
      expect(result.rows).toHaveLength(1);
      expect(result.filteredOutGroupCount).toBe(1);
      expect(result.period).toContain("学期：2024B、2024J");
      const single = await runAnalysis({
        ...plan,
        filters: [{ field: "term", op: "eq", value: "2024J" }],
      });
      expect(single.result.period).toContain("学期：2024J");
      expect(single.result.period).not.toContain("2024B");
      expect(single.result.filteredOutGroupCount).toBe(1);
      expect(single.result.rows[0].value).toBe(
        metric === "score" ? 80 : metric === "activity" ? 30 : 66.67,
      );
    },
  );

  it("distinguishes fully suppressed results from no matching records, consistently in exports", async () => {
    const plan = createPlan({
      datasetId: "demo",
      metric: "score",
      dimension: "course",
      chartType: "table",
    });
    const { result } = await runAnalysis({
      ...plan,
      filters: [
        { field: "course", op: "eq", value: "small" },
        { field: "term", op: "eq", value: "2024J" },
      ],
    });
    expect(result.rows).toEqual([]);
    expect(result.filteredOutGroupCount).toBe(1);
    expect(result.period).toContain("学期：2024J");
    expect(result.period).not.toContain("无匹配记录");
    for (const exported of [analysisCsv(result), analysisReportHtml(result)]) {
      expect(exported).toContain(result.period);
      expect(exported).toContain("过滤 1 个分组");
      expect(exported).not.toContain("s1");
    }
  });
});
