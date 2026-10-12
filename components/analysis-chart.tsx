"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { AnalysisRow, ChartType } from "@/lib/analysis/types";

export function AnalysisChart({
  rows,
  chartType,
  unit,
  metricLabel,
  dimensionLabel,
}: {
  rows: AnalysisRow[];
  chartType: ChartType;
  unit: string;
  metricLabel: string;
  dimensionLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current || chartType === "table" || rows.length === 0) return;
    const chart = echarts.init(rootRef.current);
    const escape = (value: string) =>
      value.replace(
        /[&<>"']/g,
        (character) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
      );
    chart.setOption({
      animationDuration: 280,
      color: ["#319b8b"],
      textStyle: { fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif' },
      grid: { top: 32, right: 22, bottom: 48, left: 50, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#ffffff",
        borderColor: "#e6ebf1",
        padding: [12, 16],
        textStyle: { color: "#526981", fontSize: 12 },
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [params];
          const first = items[0] as
            { axisValue?: string; dataIndex?: number; value?: number } | undefined;
          const row = first?.dataIndex === undefined ? undefined : rows[first.dataIndex];
          if (!row) return "";
          return `${escape(dimensionLabel)}：${escape(row.dimension)}<br/>${escape(metricLabel)}：${row.value.toLocaleString("zh-CN")} ${escape(unit)}<br/>参与统计：${row.sampleSize.toLocaleString("zh-CN")} 人`;
        },
      },
      xAxis: {
        type: "category",
        data: rows.map((row) => row.dimension),
        axisLabel: {
          color: "#8d9bad",
          fontSize: 11,
          margin: 12,
          interval: 0,
          hideOverlap: true,
          rotate: rows.length > 5 || rows.some((row) => row.dimension.length > 8) ? 28 : 0,
        },
        axisLine: { lineStyle: { color: "#e7edf2" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#98a6b6", fontSize: 10 },
        splitLine: { lineStyle: { color: "#eef2f6", type: "dashed" } },
      },
      series: [
        {
          type: chartType === "line" ? "line" : "bar",
          data: rows.map((row) => row.value),
          smooth: false,
          symbol: chartType === "line" ? "circle" : undefined,
          symbolSize: 7,
          barMaxWidth: 46,
          itemStyle: { borderRadius: chartType === "bar" ? [6, 6, 0, 0] : 0 },
          lineStyle: { width: 3 },
          emphasis: { itemStyle: { color: "#168b7c" } },
        },
      ],
    });
    const resize = () => chart.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(rootRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [chartType, rows, unit, metricLabel, dimensionLabel]);

  if (chartType === "table") return null;
  return (
    <div className="chart-frame">
      <div className="chart-context">
        {metricLabel} · 按{dimensionLabel} · 单位：{unit}
      </div>
      <div
        ref={rootRef}
        className="chart"
        aria-label={`${metricLabel}按${dimensionLabel}的分析结果图表`}
      />
    </div>
  );
}
