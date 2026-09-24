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
    chart.setOption({
      animationDuration: 280,
      color: ["#1459d9"],
      grid: { top: 24, right: 24, bottom: 56, left: 62 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [params];
          const first = items[0] as { axisValue?: string; dataIndex?: number; value?: number } | undefined;
          const row = first?.dataIndex === undefined ? undefined : rows[first.dataIndex];
          if (!row) return "";
          return `${dimensionLabel}：${row.dimension}<br/>${metricLabel}：${row.value.toLocaleString("zh-CN")} ${unit}<br/>样本数：${row.sampleSize.toLocaleString("zh-CN")}`;
        },
      },
      xAxis: {
        type: "category",
        data: rows.map((row) => row.dimension),
        axisLabel: {
          color: "#6f7b88",
          interval: 0,
          hideOverlap: true,
          rotate: rows.length > 5 || rows.some((row) => row.dimension.length > 8) ? 28 : 0,
        },
        axisLine: { lineStyle: { color: "#dce2e8" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#6f7b88" },
        splitLine: { lineStyle: { color: "#edf0f3" } },
      },
      series: [
        {
          type: chartType === "line" ? "line" : "bar",
          data: rows.map((row) => row.value),
          smooth: false,
          symbol: chartType === "line" ? "circle" : undefined,
          symbolSize: 7,
          barMaxWidth: 46,
          itemStyle: { borderRadius: chartType === "bar" ? [4, 4, 0, 0] : 0 },
        },
      ],
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [chartType, rows, unit]);

  if (chartType === "table") return null;
  return (
    <div className="chart-frame">
      <div className="chart-context">{metricLabel} · 按{dimensionLabel} · 单位：{unit}</div>
      <div ref={rootRef} className="chart" aria-label={`${metricLabel}按${dimensionLabel}的分析结果图表`} />
    </div>
  );
}
