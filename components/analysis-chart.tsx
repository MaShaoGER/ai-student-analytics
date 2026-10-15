"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { AnalysisRow, ChartType } from "@/lib/analysis/types";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function AnalysisChart({
  rows,
  chartType,
  unit,
  metricLabel,
  dimensionLabel,
  selectedDimension,
  onSelectDimension,
}: {
  rows: AnalysisRow[];
  chartType: ChartType;
  unit: string;
  metricLabel: string;
  dimensionLabel: string;
  selectedDimension?: string;
  onSelectDimension?: (dimension: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isTable = chartType === "table";
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
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(root);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [isTable]);

  useEffect(() => {
    const root = rootRef.current;
    const chart = chartRef.current;
    if (!root || !chart || isTable) return;

    const styles = getComputedStyle(root);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    const colors = {
      primary: token("--chart-primary", "#9aacc8"),
      neutral: token("--chart-secondary", "#69717d"),
      text: token("--chart-text", "#d7dde6"),
      muted: token("--chart-muted", "#a4adba"),
      grid: token("--chart-grid", "#383e47"),
      tooltip: token("--chart-tooltip-bg", "#252b34"),
      border: token("--chart-tooltip-border", "#4b5564"),
    };
    const data = rows.map((row) => ({
      name: row.dimension,
      value: row.value,
      itemStyle: {
        color: row.dimension === selected?.dimension ? colors.primary : colors.neutral,
      },
    }));
    const series: echarts.SeriesOption =
      chartType === "line"
        ? {
            type: "line",
            data,
            smooth: false,
            symbol: "circle",
            symbolSize: (_value, params) =>
              rows[params.dataIndex]?.dimension === selected?.dimension ? 9 : 6,
            lineStyle: { width: 2, color: colors.primary },
            itemStyle: { borderWidth: 2, borderColor: colors.primary },
            emphasis: { disabled: true, scale: false },
          }
        : {
            type: "bar",
            data,
            barMaxWidth: 58,
            itemStyle: { borderRadius: [5, 5, 2, 2] },
            label: {
              show: rows.length <= 12,
              position: "top",
              color: colors.text,
              fontSize: 12,
              distance: 10,
              formatter: (params) => rows[params.dataIndex]?.value.toLocaleString("zh-CN") ?? "",
            },
            emphasis: { disabled: true },
          };

    chart.setOption(
      {
        // Keep values in place while people read and compare them. Motion belongs to
        // the surrounding controls; canvas geometry does not need a new entrance.
        animation: false,
        color: [colors.primary],
        textStyle: { fontFamily: styles.fontFamily },
        grid: { top: 38, right: 20, bottom: 20, left: 8, containLabel: true },
        tooltip: {
          trigger: "axis",
          confine: true,
          transitionDuration: 0,
          axisPointer: { type: "line", lineStyle: { color: colors.neutral, type: "dashed" } },
          backgroundColor: colors.tooltip,
          borderColor: colors.border,
          borderWidth: 1,
          padding: [12, 14],
          textStyle: { color: colors.text, fontSize: 13, lineHeight: 22 },
          extraCssText: "border-radius: 10px; box-shadow: none;",
          formatter: (params: unknown) => {
            const items = Array.isArray(params) ? params : [params];
            const first = items[0] as { dataIndex?: number } | undefined;
            const row = first?.dataIndex === undefined ? undefined : rows[first.dataIndex];
            if (!row) return "";
            return `<strong>${escapeHtml(row.dimension)}</strong><br/>${escapeHtml(metricLabel)}：${row.value.toLocaleString("zh-CN")} ${escapeHtml(unit)}<br/>参与统计：${row.sampleSize.toLocaleString("zh-CN")} 人`;
          },
        },
        xAxis: {
          type: "category",
          data: rows.map((row) => row.dimension),
          axisLabel: {
            color: colors.muted,
            fontSize: 12,
            margin: 14,
            interval: 0,
            hideOverlap: true,
            rotate: rows.length > 5 || rows.some((row) => row.dimension.length > 8) ? 28 : 0,
          },
          axisLine: { lineStyle: { color: colors.grid } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: colors.muted, fontSize: 12 },
          splitLine: { lineStyle: { color: colors.grid, type: "dashed" } },
          axisLine: { show: false },
        },
        series: [series],
      },
      { notMerge: true },
    );

    chart.off("click");
    if (onSelectDimension) {
      chart.on("click", (params) => {
        const row = rows[params.dataIndex];
        if (params.componentType === "series" && row) onSelectDimension(row.dimension);
      });
    }
    if (document.activeElement === root && selected) {
      chart.dispatchAction({
        type: "showTip",
        seriesIndex: 0,
        dataIndex: rows.indexOf(selected),
      });
    }
  }, [chartType, isTable, rows, unit, metricLabel, selected, onSelectDimension]);

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
      </div>
      <div
        ref={rootRef}
        className="chart"
        role={onSelectDimension ? "group" : "img"}
        aria-label={summary}
        tabIndex={onSelectDimension ? 0 : undefined}
        onFocus={() => {
          if (!selected) return;
          chartRef.current?.dispatchAction({
            type: "showTip",
            seriesIndex: 0,
            dataIndex: rows.indexOf(selected),
          });
        }}
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
    </div>
  );
}
