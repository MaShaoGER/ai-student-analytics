import { expect, it } from "vitest";
import { buildStudioChart } from "./studio-chart-options";
import { defaultStudioFields, type StudioTable } from "./chart-studio";

it("keeps a largest-decline comparison in the requested order in both chart and table", () => {
  const table: StudioTable = {
    sortChange: "asc",
    description: "comparison",
    columns: ["课程", "前期均分", "后期均分"],
    rows: [
      { 课程: "下降", 前期均分: 80, 后期均分: 50 },
      { 课程: "上涨", 前期均分: 70, 后期均分: 80 },
    ],
  };
  const colors = {
    text: "#111",
    muted: "#666",
    grid: "#ccc",
    surface: "#fff",
    palette: ["red", "green", "blue"],
  };
  const fields = defaultStudioFields("dumbbell", table);
  expect(
    buildStudioChart("dumbbell", table, fields, colors).details.map((item) => item.label),
  ).toEqual(["下降", "上涨"]);
  expect(
    buildStudioChart("dumbbell", { ...table, sortChange: undefined }, fields, colors).details.map(
      (item) => item.label,
    ),
  ).toEqual(["上涨", "下降"]);
});
