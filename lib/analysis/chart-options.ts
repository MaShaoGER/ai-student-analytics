import type { EChartsOption, SeriesOption } from "echarts";
import type { AnalysisRow } from "./types";
import {
  chartColorIndex,
  formatChartNumber as number,
  resolveChartView,
  type ChartViewType,
  type ChartComparison,
} from "./visualization";

export type ChartColors = {
  primary: string;
  neutral: string;
  text: string;
  muted: string;
  grid: string;
  tooltip: string;
  border: string;
  surface: string;
  palette: string[];
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

export function buildChartOption({
  rows,
  chartType,
  unit,
  metricLabel,
  selectedDimension,
  colors,
  fontFamily,
  compact = false,
  comparison,
}: {
  rows: AnalysisRow[];
  chartType: ChartViewType;
  unit: string;
  metricLabel: string;
  selectedDimension?: string;
  colors: ChartColors;
  fontFamily: string;
  compact?: boolean;
  comparison?: ChartComparison;
}): EChartsOption {
  const view = resolveChartView(chartType, unit, rows);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const comparisonMap = new Map(comparison?.rows.map((row) => [row.dimension, row.value]));
  const xComparison =
    comparison && rows.every((row) => comparisonMap.has(row.dimension)) ? comparison : undefined;
  const selected = (row: AnalysisRow) => row.dimension === selectedDimension;
  const categoryColor = (row: AnalysisRow) =>
    colors.palette[chartColorIndex(row.dimension, colors.palette.length)];
  const rowTooltip = (row: AnalysisRow) =>
    `<strong>${escapeHtml(row.dimension)}</strong><br/>${escapeHtml(metricLabel)}：${number(row.value)} ${escapeHtml(unit)}<br/>参与统计：${number(row.sampleSize)} 人`;
  const option: EChartsOption = {
    animation: false,
    textStyle: { fontFamily },
    tooltip: {
      trigger: view === "line" || view === "bar" ? "axis" : "item",
      axisPointer: { type: "line", lineStyle: { color: colors.neutral, type: "dashed" } },
      confine: true,
      transitionDuration: 0,
      backgroundColor: colors.tooltip,
      borderColor: colors.border,
      padding: [12, 14],
      textStyle: { color: colors.text, fontSize: 12, lineHeight: 22 },
      extraCssText: "border-radius: 0; box-shadow: none; max-width: 100%; white-space: normal;",
      formatter: (params: unknown) => {
        if (view === "radar")
          return `<strong>${escapeHtml(metricLabel)}</strong><br/>${rows.map((row) => `${escapeHtml(row.dimension)}：${number(row.value)} ${escapeHtml(unit)}`).join("<br/>")}`;
        const item = (Array.isArray(params) ? params[0] : params) as { name?: string };
        const row = rows.find((row) => row.dimension === item?.name);
        if (!row) return "";
        return (
          rowTooltip(row) +
          (view === "scatter" && xComparison
            ? `<br/>${escapeHtml(xComparison.metricLabel)}：${number(comparisonMap.get(row.dimension)!)} ${escapeHtml(xComparison.unit)}`
            : "") +
          ((view === "pie" || view === "treemap") && total > 0
            ? `<br/>占可见活动总量：${number((row.value / total) * 100)}%`
            : "")
        );
      },
    },
  };

  if (view === "pie" || view === "treemap") {
    const data = rows.map((row) => ({
      name: row.dimension,
      value: row.value,
      itemStyle: { color: categoryColor(row), opacity: selected(row) ? 1 : 0.78 },
    }));
    if (view === "pie") {
      option.series = [
        {
          type: "pie",
          radius: ["49%", "72%"],
          center: ["50%", "50%"],
          padAngle: 2,
          minAngle: 0,
          stillShowZeroSum: false,
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderRadius: 0, borderWidth: 2, borderColor: colors.surface },
          emphasis: { scale: false, itemStyle: { opacity: 1 } },
          data,
        },
      ];
      option.graphic = [
        {
          type: "group",
          left: "center",
          top: "center",
          silent: true,
          children: [
            {
              type: "text",
              left: "center",
              top: -28,
              style: {
                text: "可见活动总量",
                fill: colors.muted,
                font: `12px ${fontFamily}`,
                align: "center",
              },
            },
            {
              type: "text",
              left: "center",
              top: -3,
              style: {
                text: new Intl.NumberFormat("zh-CN", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(total),
                fill: colors.text,
                font: `500 ${compact ? 24 : 30}px ${fontFamily}`,
                align: "center",
              },
            },
            {
              type: "text",
              left: "center",
              top: 36,
              style: {
                text: `${rows.length} 个分组 · 次`,
                fill: colors.muted,
                font: `11px ${fontFamily}`,
                align: "center",
              },
            },
          ],
        },
      ];
    } else {
      option.series = [
        {
          type: "treemap",
          data,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          left: 0,
          right: 0,
          top: 16,
          bottom: 16,
          itemStyle: { borderWidth: 3, gapWidth: 4, borderColor: colors.surface, borderRadius: 0 },
          label: {
            show: true,
            color: colors.surface,
            fontSize: compact ? 10 : 12,
            overflow: "truncate",
            formatter: (params) =>
              `${params.name}\n${number((Number(params.value) / total) * 100)}%`,
          },
          emphasis: { itemStyle: { opacity: 1, borderColor: colors.primary } },
        },
      ];
    }
    return option;
  }

  if (view === "radar") {
    const maximum =
      unit === "%" || unit === "分" ? 100 : Math.max(1, ...rows.map((row) => row.value)) * 1.1;
    option.radar = {
      center: ["50%", "50%"],
      radius: compact ? "53%" : "62%",
      splitNumber: 4,
      indicator: rows.map((row) => ({
        name: row.dimension,
        max: maximum,
        min: 0,
        color: selected(row) ? colors.primary : colors.muted,
      })),
      triggerEvent: true,
      axisName: {
        fontSize: compact ? 10 : 11,
        formatter: (name = "") =>
          name.length > (compact ? 5 : 8) ? `${name.slice(0, compact ? 5 : 8)}…` : name,
      },
      axisNameGap: compact ? 10 : 14,
      axisLine: { lineStyle: { color: colors.grid } },
      splitLine: { lineStyle: { color: colors.grid } },
      splitArea: { show: false },
      axisLabel: { show: false },
    };
    option.series = [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: colors.primary, width: 2 },
        itemStyle: { color: colors.primary, borderColor: colors.surface, borderWidth: 2 },
        areaStyle: { color: colors.primary, opacity: 0.12 },
        emphasis: { disabled: true },
        data: [{ name: metricLabel, value: rows.map((row) => row.value) }],
      },
    ];
    return option;
  }

  option.grid = {
    top: view === "scatter" ? 42 : 38,
    right: 20,
    bottom: view === "scatter" ? 42 : 20,
    left: 8,
    containLabel: true,
  };
  const axisStyle = {
    axisLabel: { color: colors.muted, fontSize: 11 },
    axisLine: { lineStyle: { color: colors.grid } },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: colors.grid, type: "dashed" as const } },
  };
  option.yAxis = { type: "value", ...axisStyle, max: unit === "%" ? 100 : undefined };
  if (view === "scatter") {
    const largestSample = Math.max(1, ...rows.map((row) => row.sampleSize));
    option.xAxis = {
      type: "value",
      ...axisStyle,
      scale: true,
      minInterval: xComparison ? undefined : 1,
      name: xComparison
        ? `${xComparison.metricLabel}（${xComparison.unit}）`
        : "组内去重人数（人）",
      axisLabel: {
        ...axisStyle.axisLabel,
        formatter: (value: number) =>
          new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(
            value,
          ),
      },
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: colors.muted, fontSize: 11 },
    };
    option.yAxis = {
      ...option.yAxis,
      name: `${metricLabel}（${unit}）`,
      nameTextStyle: { color: colors.muted, fontSize: 11 },
      nameGap: 20,
    };
    option.series = [
      {
        type: "scatter",
        data: rows.map((row) => ({
          name: row.dimension,
          value: [xComparison ? comparisonMap.get(row.dimension)! : row.sampleSize, row.value],
          symbolSize: Math.sqrt(row.sampleSize / largestSample) * (compact ? 30 : 44),
          itemStyle: {
            color: selected(row) ? colors.primary : colors.neutral,
            opacity: selected(row) ? 1 : 0.65,
            borderColor: colors.primary,
            borderWidth: selected(row) ? 2 : 0,
          },
          label: {
            show: selected(row),
            formatter: row.dimension,
            position: "top",
            color: colors.text,
            fontSize: 11,
          },
        })),
        emphasis: { scale: false },
      },
    ];
    return option;
  }

  const data = rows.map((row) => ({
    name: row.dimension,
    value: row.value,
    itemStyle: { color: selected(row) ? colors.primary : colors.neutral },
  }));
  option.xAxis = {
    type: "category",
    ...axisStyle,
    data: rows.map((row) => row.dimension),
    splitLine: { show: false },
    axisLabel: {
      color: colors.muted,
      fontSize: compact ? 10 : 11,
      margin: 12,
      // Long course lists get every second/third label at full size instead of
      // cramped rotated or truncated names; hideOverlap guards the tight cases.
      // Narrow charts tilt the reduced label set so more groups stay identifiable.
      interval: compact
        ? rows.length > 8
          ? 2
          : "auto"
        : Math.max(0, Math.ceil(rows.length / 12) - 1),
      hideOverlap: true,
      rotate: compact
        ? rows.length > 8
          ? 32
          : 0
        : rows.length > 12
          ? 0
          : rows.length > 5
            ? 28
            : 0,
    },
  };
  const series: SeriesOption =
    view === "line"
      ? {
          type: "line",
          data,
          smooth: false,
          symbol: "circle",
          symbolSize: (_value, params) => (selected(rows[params.dataIndex]) ? 9 : 6),
          lineStyle: { width: 2, color: colors.primary },
          itemStyle: { borderWidth: 2, borderColor: colors.primary },
          emphasis: { disabled: true, scale: false },
        }
      : {
          type: "bar",
          data,
          barMaxWidth: 58,
          itemStyle: { borderRadius: 0 },
          label: {
            show: rows.length <= (compact ? 5 : 12),
            position: "top",
            color: colors.text,
            fontSize: 12,
            distance: 10,
            formatter: (params) => number(rows[params.dataIndex]?.value ?? 0),
          },
          emphasis: { disabled: true },
        };
  option.series = [series];
  return option;
}
