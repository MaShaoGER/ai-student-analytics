"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useTheme } from "@/components/ui/theme-provider";
import {
  buildStudioChart,
  type StudioColors,
  type StudioDetail,
} from "@/lib/analysis/studio-chart-options";
import type { StudioChartType, StudioFields, StudioTable } from "@/lib/analysis/chart-studio";
import styles from "./chart-studio.module.css";

export function StudioChart({
  type,
  table,
  fields,
  densityMode,
  aggregate,
}: {
  type: StudioChartType;
  table: StudioTable;
  fields: StudioFields;
  densityMode: "density" | "scatter";
  aggregate: "sum" | "mean";
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const [status, setStatus] = useState<{
    summary: string;
    error: string;
    details: StudioDetail[];
    omitted: number;
  }>({ summary: "正在绘图…", error: "", details: [], omitted: 0 });
  const [selected, setSelected] = useState("");
  const { theme } = useTheme();

  useEffect(() => {
    if (!root.current) return;
    const chart = echarts.init(root.current);
    instance.current = chart;
    chart.on("click", (params) => {
      const data = params.data as { detail?: string } | undefined;
      if (data?.detail) setSelected(data.detail);
    });
    return () => {
      chart.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const element = root.current,
      chart = instance.current;
    if (!element || !chart) return;
    const css = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const resolve = (token: string) => {
      const value = css.getPropertyValue(token).trim();
      if (!context) return value;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return `rgba(${r},${g},${b},${a / 255})`;
    };
    const colors: StudioColors = {
      text: resolve("--ink"),
      muted: resolve("--muted"),
      grid: resolve("--line"),
      surface: resolve("--paper"),
      palette: Array.from({ length: 10 }, (_, i) => resolve(`--chart-multi-category-${i + 1}`)),
    };
    const draw = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      try {
        const built = buildStudioChart(type, table, fields, colors, {
          compact: element.clientWidth < 500,
          densityMode,
          aggregate,
        });
        setStatus({
          summary: built.summary,
          details: built.details,
          omitted: built.omitted,
          error: built.details.length ? "" : "没有可绘制的有效数据，请检查所选字段或更换数据。",
        });
        if (built.details.length)
          chart.setOption(
            { ...built.option, textStyle: { fontFamily: css.fontFamily, color: colors.text } },
            { notMerge: true },
          );
        else chart.clear();
      } catch (error) {
        chart.clear();
        setStatus({
          summary: "",
          details: [],
          omitted: 0,
          error: error instanceof Error ? error.message : "数据暂时无法绘制。",
        });
      }
    };
    setSelected("");
    draw();
    let width = element.clientWidth,
      height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth && height === element.clientHeight) return;
      width = element.clientWidth;
      height = element.clientHeight;
      chart.resize();
      draw();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [type, table, fields, densityMode, aggregate, theme]);

  const active = selected || status.details[0]?.detail || "";
  const selectedIndex = status.details.findIndex((item) => item.detail === active);
  return (
    <div className={styles.rendered}>
      <div className={styles.chartSummary} role="status">
        {status.summary}
        {status.omitted > 0 && ` · 已忽略 ${status.omitted} 行缺失或无效输入`}
      </div>
      <div className={styles.chartWrap}>
        <div
          ref={root}
          className={styles.chart}
          role="img"
          aria-label={`${status.summary}。悬停或点选图形查看详情，也可使用下方数据选择器。`}
        />
        {status.error && (
          <div className={styles.chartError} role="status">
            {status.error}
          </div>
        )}
      </div>
      {status.details.length > 0 && (
        <div className={styles.selection}>
          <label className="control-field">
            <span>查看图中数据</span>
            <select
              aria-label="图表数据详情"
              value={selectedIndex}
              onChange={(event) =>
                setSelected(status.details[Number(event.target.value)]?.detail ?? "")
              }
            >
              {selectedIndex < 0 && <option value={-1}>图中选择</option>}
              {status.details.slice(0, 300).map((item, i) => (
                <option key={i} value={i}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <output aria-live="polite">{active}</output>
        </div>
      )}
    </div>
  );
}
