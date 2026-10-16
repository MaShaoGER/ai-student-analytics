import { describe, expect, it } from "vitest";
import { buildChartOption, type ChartColors } from "./chart-options";
import { chartUnavailableReason, resolveChartView } from "./visualization";

const rows = [
  { dimension: "课程 A", value: 60, sampleSize: 100 },
  { dimension: "课程 B", value: 30, sampleSize: 25 },
  { dimension: "课程 C", value: 10, sampleSize: 4 },
];
const colors: ChartColors = {
  primary: "#d5e7aa",
  neutral: "#69755c",
  text: "#e5e9dd",
  muted: "#a0a19b",
  grid: "#333333",
  tooltip: "#222421",
  border: "#444444",
  surface: "#222421",
  palette: ["#d5e7aa", "#9ebdae"],
};
const option = (
  chartType: Parameters<typeof buildChartOption>[0]["chartType"],
  unit = "次",
  data = rows,
) =>
  buildChartOption({
    rows: data,
    chartType,
    unit,
    metricLabel: "测试指标",
    selectedDimension: data[0]?.dimension,
    colors,
    fontFamily: "sans-serif",
  });

describe("analysis visualization semantics", () => {
  it.each(["pie", "treemap"] as const)("limits %s to additive nonnegative activity", (view) => {
    expect(resolveChartView(view, "分", rows)).toBe("bar");
    expect(resolveChartView(view, "%", rows)).toBe("bar");
    expect(resolveChartView(view, "次", rows)).toBe(view);
    expect(chartUnavailableReason(view, "次", [{ ...rows[0], value: -1 }])).toBeTruthy();
    expect(chartUnavailableReason(view, "次", [{ ...rows[0], value: 0 }])).toBeTruthy();
    expect(resolveChartView(view, "次", [])).toBe("bar");
  });

  it("keeps raw values and zeros for share charts without mutating result rows", () => {
    const data = [...rows, { dimension: "零活动", value: 0, sampleSize: 3 }];
    for (const view of ["pie", "treemap"] as const) {
      const series = option(view, "次", data).series as {
        data: { name: string; value: number }[];
      }[];
      expect(series[0].data.map((item) => item.value)).toEqual([60, 30, 10, 0]);
    }
    expect(data).toEqual([...rows, { dimension: "零活动", value: 0, sampleSize: 3 }]);
  });

  it("uses a shared 0–100 radar scale and falls back for unreadable group counts", () => {
    expect(option("radar", "%").radar).toMatchObject({
      indicator: rows.map((row) => ({ name: row.dimension, min: 0, max: 100 })),
    });
    expect(resolveChartView("radar", "分", rows.slice(0, 2))).toBe("bar");
    expect(
      resolveChartView(
        "radar",
        "分",
        Array.from({ length: 13 }, () => rows[0]),
      ),
    ).toBe("bar");
    expect(
      (option("radar", "次").radar as { indicator: { max: number }[] }).indicator.every(
        (axis) => axis.max === 66,
      ),
    ).toBe(true);
  });

  it("places sample size on x and the metric on y, with bubble area proportional to sample size", () => {
    const series = option("scatter").series as {
      data: { value: number[]; symbolSize: number }[];
    }[];
    expect(series[0].data.map((item) => item.value)).toEqual([
      [100, 60],
      [25, 30],
      [4, 10],
    ]);
    expect((series[0].data[0].symbolSize / series[0].data[1].symbolSize) ** 2).toBeCloseTo(4);
  });

  it("escapes dataset text in tooltips and states the visible share denominator", () => {
    const data = [
      { dimension: '<img src=x onerror="alert(1)">', value: 50, sampleSize: 3 },
      rows[0],
    ];
    const tooltip = option("pie", "次", data).tooltip as { formatter: (params: unknown) => string };
    const html = tooltip.formatter({ name: data[0].dimension });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("占可见活动总量：45.45%");
    expect(tooltip.formatter({ name: "not a real group" })).toBe("");
  });

  it("pairs two metrics by group name rather than rank, and falls back when comparison is incomplete", () => {
    const options = {
      rows,
      chartType: "scatter" as const,
      unit: "分",
      metricLabel: "平均成绩",
      colors,
      fontFamily: "sans-serif",
    };
    const comparison = {
      rows: [rows[2], rows[0], rows[1]].map((row) => ({ ...row, value: row.value * 100 })),
      unit: "次",
      metricLabel: "活跃次数",
    };
    const paired = buildChartOption({ ...options, comparison }).series as {
      data: { value: number[] }[];
    }[];
    expect(paired[0].data.map((item) => item.value)).toEqual([
      [6000, 60],
      [3000, 30],
      [1000, 10],
    ]);
    const incomplete = buildChartOption({
      ...options,
      comparison: { ...comparison, rows: comparison.rows.slice(0, 1) },
    }).series as { data: { value: number[] }[] }[];
    expect(incomplete[0].data.map((item) => item.value[0])).toEqual([100, 25, 4]);
  });
});
