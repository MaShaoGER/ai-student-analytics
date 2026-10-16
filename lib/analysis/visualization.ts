import type { AnalysisRow, ChartType } from "./types";

// Presentation choices stay separate from the validated server/AI analysis plan.
export type ChartViewType = ChartType | "pie" | "treemap" | "radar" | "scatter";
export type ChartComparison = { rows: AnalysisRow[]; metricLabel: string; unit: string };

export const CHART_VIEWS: { value: ChartViewType; label: string; description: string }[] = [
  { value: "bar", label: "柱状图", description: "比较各分组的指标高低，点击图形查看详情。" },
  {
    value: "line",
    label: "折线图",
    description: "按当前分组顺序连接数值；查看时间变化时，请按学期及名称顺序排列。",
  },
  { value: "pie", label: "环形图", description: "扇区表示各分组占当前可见活动总量的比例。" },
  {
    value: "treemap",
    label: "矩形树图",
    description: "矩形面积表示活动量，直观看出主要贡献分组。",
  },
  {
    value: "radar",
    label: "雷达图",
    description: "每条轴代表一个分组，统一刻度比较同一指标；不表示综合能力评分。",
  },
  {
    value: "scatter",
    label: "气泡图",
    description: "每个气泡代表一个分组。横轴为组内去重人数，纵轴为当前指标；气泡面积与人数成正比。",
  },
  { value: "table", label: "表格", description: "查看每个分组的指标原值与参与统计人数。" },
];

export function chartUnavailableReason(view: ChartViewType, unit: string, rows: AnalysisRow[]) {
  if (view === "pie" || view === "treemap") {
    if (unit !== "次") return "占比视图适用于可相加的活跃次数，均分和完成率不作占比。";
    if (rows.some((row) => row.value < 0) || !rows.some((row) => row.value > 0))
      return "占比视图需要非负数值，且活动总量大于 0。";
  }
  if (view === "radar" && (rows.length < 3 || rows.length > 12))
    return "雷达图适合比较 3–12 个分组，可先搜索缩小范围。";
  return undefined;
}

export function resolveChartView(
  view: ChartViewType,
  unit: string,
  rows: AnalysisRow[],
): ChartViewType {
  return chartUnavailableReason(view, unit, rows) ? "bar" : view;
}

export const formatChartNumber = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function chartColorIndex(dimension: string, count: number) {
  let hash = 0;
  for (const character of dimension) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash % count;
}
