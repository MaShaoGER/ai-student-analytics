import { expect, it } from "vitest";
import { buildStudioChart } from "./studio-chart-options";
import { defaultStudioFields, type StudioTable } from "./chart-studio";

const colors = {
  text: "#111",
  muted: "#666",
  grid: "#ccc",
  surface: "#fff",
  palette: ["red", "green", "blue"],
};

it("attaches both comparison endpoints as the same pick used by keyboard details", () => {
  const table: StudioTable = {
    description: "comparison",
    columns: ["课程", "前期均分", "后期均分"],
    rows: [{ 课程: "AAA", 前期均分: 60, 后期均分: 70 }],
    meta: { project: true, beforeTerm: "2020J", afterTerm: "2021J" },
  };
  const built = buildStudioChart("dumbbell", table, defaultStudioFields("dumbbell", table), colors);
  const series = built.option.series as unknown as { data: { pick?: unknown }[] }[];
  expect(series[1].data[0].pick).toEqual({ kind: "comparison", course: "AAA", side: "before" });
  expect(series[2].data[0].pick).toEqual({ kind: "comparison", course: "AAA", side: "after" });
  expect(built.details.map((item) => item.pick)).toEqual([
    { kind: "comparison", course: "AAA", side: "before" },
    { kind: "comparison", course: "AAA", side: "after" },
  ]);
});

it("only gives project semantics to project tables", () => {
  const custom: StudioTable = {
    description: "custom",
    columns: ["课程", "前期均分", "后期均分"],
    rows: [{ 课程: "AAA", 前期均分: 60, 后期均分: 70 }],
  };
  const built = buildStudioChart(
    "dumbbell",
    custom,
    defaultStudioFields("dumbbell", custom),
    colors,
  );
  expect(built.details.every((item) => item.pick === undefined)).toBe(true);
});

it("turns the standard boxplot course groups into course picks", () => {
  const table: StudioTable = {
    description: "box",
    columns: ["课程", "最小值", "下四分位数", "中位数", "上四分位数", "最大值", "样本数"],
    rows: [
      {
        课程: "AAA",
        最小值: 20,
        下四分位数: 50,
        中位数: 60,
        上四分位数: 70,
        最大值: 90,
        样本数: 12,
      },
    ],
    meta: { project: true },
  };
  const built = buildStudioChart("boxplot", table, defaultStudioFields("boxplot", table), colors);
  expect(built.details[0].pick).toEqual({ kind: "course", course: "AAA" });
  expect(
    (built.option.series as unknown as { data: { itemStyle?: { borderWidth?: number } }[] }[])[0]
      .data[0].itemStyle,
  ).toBeUndefined();
});

it("marks the selected box without moving the pick payload", () => {
  const table: StudioTable = {
    description: "box",
    columns: ["课程", "最小值", "下四分位数", "中位数", "上四分位数", "最大值", "样本数"],
    rows: [
      {
        课程: "AAA",
        最小值: 20,
        下四分位数: 50,
        中位数: 60,
        上四分位数: 70,
        最大值: 90,
        样本数: 12,
      },
      {
        课程: "BBB",
        最小值: 30,
        下四分位数: 55,
        中位数: 65,
        上四分位数: 75,
        最大值: 95,
        样本数: 9,
      },
    ],
    meta: { project: true },
  };
  const built = buildStudioChart("boxplot", table, defaultStudioFields("boxplot", table), colors, {
    selectedPick: { kind: "course", course: "BBB" },
  });
  const data = (
    built.option.series as unknown as { data: { itemStyle?: { borderWidth?: number } }[] }[]
  )[0].data;
  expect(data[0].itemStyle).toBeUndefined();
  expect(data[1].itemStyle).toEqual({ borderColor: "#111", borderWidth: 2 });
});

it("turns standard week/course heatmap cells into week picks", () => {
  const table: StudioTable = {
    description: "rhythm",
    columns: ["周次", "课程", "人均访问次数", "当周有记录人数"],
    rows: [{ 周次: 3, 课程: "AAA", 人均访问次数: 12.5, 当周有记录人数: 20 }],
    meta: { project: true },
  };
  const built = buildStudioChart("heatmap", table, defaultStudioFields("heatmap", table), colors);
  expect(built.details[0].pick).toEqual({ kind: "week", course: "AAA", week: 3 });
});

it("draws pre-aggregated project density cells on their original bins", () => {
  const table: StudioTable = {
    description: "density",
    columns: ["出勤率区间中心", "成绩区间中心", "频数"],
    rows: [
      { 出勤率区间中心: 15, 成绩区间中心: 62.5, 频数: 4 },
      { 出勤率区间中心: 25, 成绩区间中心: 62.5, 频数: 5 },
    ],
    meta: { project: true, density: { metric: "attendance", xWidth: 10, yWidth: 5 } },
  };
  const fields = defaultStudioFields("density", table);
  const built = buildStudioChart("density", table, fields, colors);
  const axisX = built.option.xAxis as { data: string[] };
  expect(axisX.data).toEqual(["15", "25"]);
  const data = (built.option.series as unknown as { data: unknown[] }[])[0].data as {
    pick?: unknown;
    itemStyle?: unknown;
  }[];
  expect(data).toHaveLength(2);
  expect(data[0].pick).toEqual({ kind: "density", metric: "attendance", x: 15, y: 62.5 });
  const scatter = buildStudioChart("density", table, fields, colors, { densityMode: "scatter" });
  expect(
    (scatter.option.series as unknown as { data: { pick?: unknown }[] }[])[0].data[1].pick,
  ).toEqual({ kind: "density", metric: "attendance", x: 25, y: 62.5 });
});

it("keeps the legacy re-binning for custom density data without project metadata", () => {
  const table: StudioTable = {
    description: "custom",
    columns: ["出勤率区间中心", "成绩区间中心", "频数"],
    rows: [
      { 出勤率区间中心: 15, 成绩区间中心: 62.5, 频数: 4 },
      { 出勤率区间中心: 25, 成绩区间中心: 62.5, 频数: 5 },
    ],
  };
  const fields = defaultStudioFields("density", table);
  const built = buildStudioChart("density", table, fields, colors);
  const axisX = built.option.xAxis as { data: string[] };
  expect(axisX.data).toHaveLength(16);
  expect(
    (built.option.series as unknown as { data: { pick?: unknown }[] }[])[0].data.every(
      (item) => item.pick === undefined,
    ),
  ).toBe(true);
});

it("maps standard sankey nodes and links to path band picks", () => {
  const table: StudioTable = {
    description: "paths",
    columns: ["出勤档位", "作业档位", "成绩档位", "数量"],
    rows: [
      { 出勤档位: "出勤低于80%", 作业档位: "作业完成低于60%", 成绩档位: "成绩低于60分", 数量: 5 },
      { 出勤档位: "出勤至少95%", 作业档位: "作业完成至少90%", 成绩档位: "成绩至少80分", 数量: 8 },
    ],
    meta: { project: true },
  };
  const built = buildStudioChart("sankey", table, defaultStudioFields("sankey", table), colors);
  const picks = built.details.map((item) => item.pick);
  expect(picks).toContainEqual({ kind: "path", attendance: 0, homework: 0 });
  expect(picks).toContainEqual({ kind: "path", homework: 0, score: 0 });
  expect(picks).toContainEqual({ kind: "path", attendance: 2, homework: 2 });
  expect(picks).toContainEqual({ kind: "path", homework: 2, score: 2 });
});

it("leaves custom three-stage sankey charts without path semantics", () => {
  const table: StudioTable = {
    description: "custom",
    columns: ["阶段A", "阶段B", "阶段C", "数量"],
    rows: [{ 阶段A: "甲", 阶段B: "乙", 阶段C: "丙", 数量: 3 }],
  };
  const built = buildStudioChart("sankey", table, defaultStudioFields("sankey", table), colors);
  expect(built.details.every((item) => item.pick === undefined)).toBe(true);
});
