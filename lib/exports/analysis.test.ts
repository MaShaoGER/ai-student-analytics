import { describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "@/lib/analysis/types";
import {
  analysisCsv,
  analysisDimensionLabel,
  analysisExportFilename,
  analysisMetricDescription,
  analysisReportHtml,
  csvCell,
  downloadAnalysisFile,
  escapeHtml,
} from "./analysis";

const result: AnalysisResult = {
  datasetId: "demo",
  dimension: "course",
  chartType: "bar",
  rows: [{ dimension: "课程 A", value: 82.5, sampleSize: 7 }],
  unit: "分",
  metricLabel: "平均成绩",
  period: "模拟数据全部开课期记录",
  query: "SELECT AVG(score) FROM student_outcomes",
  durationMs: 4,
  minSampleSize: 3,
  filteredOutGroupCount: 0,
};

describe("analysis exports", () => {
  it("explicitly labels unknown counts in legacy results", () => {
    const legacy = { ...result, filteredOutGroupCount: null };
    expect(analysisReportHtml(legacy)).toContain("未记录小样本过滤分组数，无法确定");
    expect(analysisCsv(legacy)).toContain("未记录小样本过滤分组数，无法确定");
  });
  it("escapes commas, double quotes and multiline CSV labels without losing content", () => {
    expect(csvCell('课程,\"A\"\n第二行')).toBe('"课程,""A""\n第二行"');
    const csv = analysisCsv({
      ...result,
      rows: [{ ...result.rows[0], dimension: '课程,\"A\"\n第二行' }],
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"课程,""A""\n第二行",82.5,7');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain('"统计周期","最小样本人数"');
  });

  it.each([
    "=1+1",
    "+SUM(A1)",
    "-1+2",
    "@SUM(A1)",
    "  =cmd()",
    "\t=1",
    "\r=1",
    "\n=1",
    "\u00a0+1",
    "\uFEFF=1",
  ])("neutralizes spreadsheet formula-like text %j", (value) => {
    expect(csvCell(value)).toBe(`"'${value}"`);
  });

  it("protects metadata cells too while preserving numeric values", () => {
    const csv = analysisCsv({
      ...result,
      period: "=IMPORTXML()",
      metricLabel: "@formula",
      unit: "+formula",
    });
    expect(csv).toContain('"\'@formula","\'+formula","\'=IMPORTXML()"');
    expect(csvCell(-2.5)).toBe("-2.5");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("escapes all report text, including query, row names and title", () => {
    expect(escapeHtml("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&#39;");
    const payload = '<script>alert("unsafe")</script><img src=x onerror=alert(1)>';
    const html = analysisReportHtml({
      ...result,
      metricLabel: payload,
      period: payload,
      unit: payload,
      query: payload,
      rows: [{ ...result.rows[0], dimension: payload }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;");
    expect(html).toContain("default-src 'none'");
  });

  it("reports scope, individual group samples and privacy limits without inventing total students", () => {
    const html = analysisReportHtml(result);
    expect(html).toContain("模拟校园数据");
    expect(html).toContain(result.period);
    expect(html).toContain("每组至少 3 名学生");
    expect(html).toContain("<td>7</td>");
    expect(html).toContain("不能将各组人数相加作为独立学生总人数");
    expect(html).not.toContain("过滤 0 个分组");
    expect(analysisReportHtml({ ...result, filteredOutGroupCount: 2 })).toContain("过滤 2 个分组");
    expect(html).toContain("另存为 PDF");
  });

  it("uses the actual OULAD metric definitions", () => {
    expect(analysisMetricDescription({ ...result, datasetId: "oulad" })).toContain(
      "先计算每名学生",
    );
    expect(
      analysisMetricDescription({ ...result, datasetId: "oulad", metricLabel: "完成率" }),
    ).toContain("Pass 或 Distinction");
    expect(
      analysisMetricDescription({ ...result, datasetId: "oulad", metricLabel: "活跃次数" }),
    ).toContain("sum_click");
    expect(analysisMetricDescription({ ...result, metricLabel: "完成率" })).toContain(
      "学生-课程-开课期记录",
    );
  });

  it("labels both dimensions without guessing from row contents", () => {
    const combined = { ...result, dimensions: ["course", "term"] as AnalysisResult["dimensions"] };
    expect(analysisDimensionLabel(combined)).toBe("课程 / 学期");
    expect(analysisCsv(combined)).toContain('"课程 / 学期","指标值"');
    expect(analysisReportHtml(combined)).toContain("平均成绩按课程 / 学期比较");
    expect(
      analysisDimensionLabel({ ...result, rows: [{ ...result.rows[0], dimension: "A / B" }] }),
    ).toBe("课程");
  });

  it("downloads through a temporary Blob URL and releases it after the click", () => {
    let cleanup: (() => void) | undefined;
    const click = vi.fn();
    const remove = vi.fn();
    const link = { href: "", download: "", click, remove };
    const appendChild = vi.fn();
    vi.stubGlobal("document", { createElement: () => link, body: { appendChild } });
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void, delay: number) => {
        expect(delay).toBe(1000);
        cleanup = callback;
      },
    });
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:analysis-export");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      downloadAnalysisFile(result, "csv");
      expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
      expect(link.download).toBe("demo-平均成绩-课程.csv");
      expect(click).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      expect(revokeUrl).not.toHaveBeenCalled();
      cleanup?.();
      expect(revokeUrl).toHaveBeenCalledWith("blob:analysis-export");
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("creates safe bounded export filenames", () => {
    const filename = analysisExportFilename(
      { ...result, metricLabel: "../A:<B>\\C|\u0000?" },
      "html",
    );
    expect(filename).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
    expect(filename).toMatch(/\.html$/);
    expect(
      analysisExportFilename({ ...result, metricLabel: "x".repeat(200) }, "csv").length,
    ).toBeLessThan(100);
  });
});
