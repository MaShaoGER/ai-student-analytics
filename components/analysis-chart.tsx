"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { AnalysisRow, ChartType } from "@/lib/analysis/types";

export function AnalysisChart({
  rows,
  chartType,
  unit,
}: {
  rows: AnalysisRow[];
  chartType: ChartType;
  unit: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current || chartType === "table") return;
    const chart = echarts.init(rootRef.current);
    chart.setOption({
      animationDuration: 280,
      color: ["#1459d9"],
      grid: { top: 24, right: 24, bottom: 56, left: 62 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: number) => `${value.toLocaleString("zh-CN")} ${unit}`,
      },
      xAxis: {
        type: "category",
        data: rows.map((row) => row.dimension),
        axisLabel: { color: "#6f7b88", interval: 0, rotate: rows.length > 5 ? 28 : 0 },
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
          smooth: chartType === "line",
          symbol: chartType === "line" ? "circle" : undefined,
          symbolSize: 7,
          barMaxWidth: 46,
          itemStyle: { borderRadius: chartType === "bar" ? [4, 4, 0, 0] : 0 },
          areaStyle: chartType === "line" ? { color: "rgb(20 89 217 / 8%)" } : undefined,
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
  return <div ref={rootRef} className="chart" aria-label="分析结果图表" />;
}
