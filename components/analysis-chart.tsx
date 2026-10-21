"use client";

import { useEffect, useRef } from "react";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
import { useTheme } from "@/components/ui/theme-provider";
import * as echarts from "echarts";
import type { AnalysisRow } from "@/lib/analysis/types";
import { buildChartOption, type ChartColors } from "@/lib/analysis/chart-options";
import {
  chartColorIndex,
  formatChartNumber,
  resolveChartView,
  type ChartViewType,
  type ChartComparison,
} from "@/lib/analysis/visualization";

export function AnalysisChart({
  rows,
  chartType,
  unit,
  metricLabel,
  dimensionLabel,
  selectedDimension,
  onSelectDimension,
  comparison,
  entrance = false,
  barOrientation = "vertical",
}: {
  rows: AnalysisRow[];
  chartType: ChartViewType;
  unit: string;
  metricLabel: string;
  dimensionLabel: string;
  selectedDimension?: string;
  onSelectDimension?: (dimension: string) => void;
  comparison?: ChartComparison;
  entrance?: boolean;
  barOrientation?: "horizontal" | "vertical";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const lastView = useRef<ChartViewType | undefined>(undefined);
  const lastDataKey = useRef<string | undefined>(undefined);
  const { theme } = useTheme();
  const { enabled: motionEnabled, reduced: reducedMotion } = useMotionPreferences();
  const view = resolveChartView(chartType, unit, rows);
  const isTable = view === "table";
  const showKey = ["pie", "treemap", "radar", "scatter"].includes(view);
  const multicolor =
    (["pie", "treemap"].includes(view) && rows.length > 6) ||
    (view === "scatter" && Boolean(comparison));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const highest = rows.reduce<AnalysisRow | undefined>(
    (best, row) => (!best || row.value > best.value ? row : best),
    undefined,
  );
  const selected = rows.find((row) => row.dimension === selectedDimension) ?? highest;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || isTable) return;

    const chart = echarts.init(root);
    chartRef.current = chart;
    return () => {
      chart.dispose();
      chartRef.current = null;
      lastView.current = undefined;
      lastDataKey.current = undefined;
    };
  }, [isTable]);

  useEffect(() => {
    const root = rootRef.current;
    const chart = chartRef.current;
    if (!root || !chart || isTable) return;

    const styles = getComputedStyle(root);
    // ECharts' color parser does not understand CSS color-mix / Color 4 values.
    // Resolve the shared CSS palette once per update before passing it to canvas.
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
    const token = (name: string, fallback: string) => {
      const value = styles.getPropertyValue(name).trim() || fallback;
      if (echarts.color.parse(value) || !colorContext || !CSS.supports("color", value))
        return value;
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
      return `rgba(${r},${g},${b},${a / 255})`;
    };
    const colors: ChartColors = {
      primary: token("--chart-primary", "#9aacc8"),
      neutral: token("--chart-secondary", "#69717d"),
      text: token("--chart-text", "#d7dde6"),
      muted: token("--chart-muted", "#a4adba"),
      grid: token("--chart-grid", "#383e47"),
      tooltip: token("--chart-tooltip-bg", "#252b34"),
      border: token("--chart-tooltip-border", "#4b5564"),
      surface: token("--paper", "#222421"),
      palette: Array.from({ length: 10 }, (_, index) =>
        token(`--chart-${multicolor ? "multi-" : ""}category-${index + 1}`, "#88baff"),
      ),
    };
    const draw = () => {
      const option = buildChartOption({
        rows,
        chartType: view,
        unit,
        metricLabel,
        selectedDimension: selected?.dimension,
        colors,
        fontFamily: styles.fontFamily,
        compact: root.clientWidth < 460,
        comparison,
        barOrientation,
      });
      const dataKey = `${view}|${unit}|${metricLabel}|${rows
        .map((row) => `${row.dimension}:${row.value}:${row.sampleSize}`)
        .join("|")}`;
      const dataChanged = lastDataKey.current !== undefined && lastDataKey.current !== dataKey;
      // The first draw is page presentation and animates regardless of input
      // modality; later updates are interaction feedback and need a pointer.
      const initialDraw = lastView.current === undefined;
      const animated =
        motionEnabled &&
        !reducedMotion &&
        (initialDraw || document.documentElement.dataset.inputModality === "pointer");
      // The homepage opts into an aggressive entrance: bars grow in sequence and
      // metric/view switches animate the whole series instead of snapping.
      chart.setOption(
        {
          ...option,
          animation: animated,
          animationDuration: entrance && animated ? 760 : 0,
          animationDurationUpdate: animated ? (entrance && dataChanged ? 560 : 240) : 0,
          animationEasing: "cubicOut",
          animationEasingUpdate: "cubicOut",
          animationDelay:
            entrance && animated ? (dataIndex: number) => Math.min(dataIndex * 32, 420) : 0,
          animationDelayUpdate: 0,
        },
        // On the homepage a different data set re-enters from scratch instead of
        // morphing between unrelated courses, so the staggered draw reads clearly.
        { notMerge: lastView.current !== view || (entrance && dataChanged) },
      );
      lastView.current = view;
      lastDataKey.current = dataKey;
    };
    draw();
    // Recalculate label density when the panel crosses a responsive breakpoint.
    let width = root.clientWidth;
    let height = root.clientHeight;
    const layoutObserver = new ResizeObserver(() => {
      if (root.clientWidth === width && root.clientHeight === height) return;
      width = root.clientWidth;
      height = root.clientHeight;
      chart.resize();
      draw();
    });
    layoutObserver.observe(root);

    chart.off("click");
    if (onSelectDimension) {
      chart.on("click", (params) => {
        // Treemap indices include an implicit root; radar uses one polygon for all
        // groups. Resolve names instead of treating every dataIndex as a row.
        if (view === "radar" && params.componentType === "series") return;
        const row = rows.find((row) => row.dimension === params.name);
        if (row) onSelectDimension(row.dimension);
      });
    }
    return () => layoutObserver.disconnect();
  }, [
    view,
    isTable,
    rows,
    unit,
    metricLabel,
    selected,
    onSelectDimension,
    comparison,
    theme,
    multicolor,
    motionEnabled,
    reducedMotion,
    barOrientation,
  ]);

  const showSelectedTip = () => {
    if (!selected) return;
    chartRef.current?.dispatchAction({
      type: "showTip",
      seriesIndex: 0,
      dataIndex:
        view === "radar"
          ? 0
          : view === "treemap"
            ? rows.indexOf(selected) + 1
            : rows.indexOf(selected),
    });
  };
  useEffect(() => {
    if (document.activeElement === rootRef.current) showSelectedTip();
  });

  if (isTable) return null;

  const summary = `${metricLabel}按${dimensionLabel}比较，共 ${rows.length} 个分组。${
    highest
      ? `最高为 ${highest.dimension}，${highest.value.toLocaleString("zh-CN")} ${unit}。`
      : "暂无数据。"
  }${
    onSelectDimension && selected
      ? `当前选中 ${selected.dimension}，${selected.value.toLocaleString("zh-CN")} ${unit}，${selected.sampleSize.toLocaleString("zh-CN")} 人。使用方向键切换分组，Home 和 End 跳至首尾，也可切换为表格查看。`
      : "可切换为表格查看具体数据。"
  }`;

  return (
    <div className="chart-frame">
      <div className="chart-context">
        {metricLabel} · 按{dimensionLabel} · 单位：{unit}
        {(view === "pie" || view === "treemap") &&
          ` · 可见合计 ${formatChartNumber(total)} ${unit}`}
        {view === "radar" && (unit === "%" || unit === "分") && " · 各轴刻度 0–100"}
      </div>
      <div
        ref={rootRef}
        className="chart"
        role={onSelectDimension ? "group" : "img"}
        aria-label={summary}
        tabIndex={onSelectDimension ? 0 : undefined}
        onFocus={showSelectedTip}
        onBlur={() => chartRef.current?.dispatchAction({ type: "hideTip" })}
        onKeyDown={(event) => {
          if (!onSelectDimension || rows.length === 0) return;
          const index = selected ? rows.indexOf(selected) : 0;
          let next: number;
          switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
              next = (index + 1) % rows.length;
              break;
            case "ArrowLeft":
            case "ArrowUp":
              next = (index - 1 + rows.length) % rows.length;
              break;
            case "Home":
              next = 0;
              break;
            case "End":
              next = rows.length - 1;
              break;
            default:
              return;
          }
          event.preventDefault();
          onSelectDimension(rows[next].dimension);
        }}
      />
      {showKey && (
        <div className="chart-key" role="group" aria-label="图例与分组选择">
          {rows.map((row) => (
            <button
              type="button"
              key={row.dimension}
              disabled={!onSelectDimension}
              aria-pressed={row.dimension === selected?.dimension}
              onClick={() => onSelectDimension?.(row.dimension)}
            >
              <i
                aria-hidden="true"
                style={{
                  background:
                    view === "pie" || view === "treemap"
                      ? `var(--chart-${multicolor ? "multi-" : ""}category-${chartColorIndex(row.dimension, 10) + 1})`
                      : row.dimension === selected?.dimension
                        ? "var(--chart-primary)"
                        : "var(--chart-secondary)",
                }}
              />
              <span title={row.dimension}>{row.dimension}</span>
              <strong>
                {view === "pie" || view === "treemap"
                  ? `${formatChartNumber(total ? (row.value / total) * 100 : 0)}%`
                  : `${formatChartNumber(row.value)} ${unit}`}
              </strong>
            </button>
          ))}
        </div>
      )}
      {showKey && selected && (
        <p className="chart-selection" role="status">
          <strong>{selected.dimension}</strong> · {formatChartNumber(selected.value)} {unit} ·{" "}
          {formatChartNumber(selected.sampleSize)} 人参与
        </p>
      )}
    </div>
  );
}
