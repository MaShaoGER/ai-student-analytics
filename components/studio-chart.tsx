"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as echarts from "echarts";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
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
  // ECharts' heatmap view paints cells without an enter animation, so that series
  // gets a canvas-level reveal; the handle lets a new entrance replace the old one.
  const canvasReveal = useRef<Animation | null>(null);
  // Remember what the previous draw showed so only a real data/type/view change
  // replays the entrance; resizes and theme swaps redraw in place.
  const previousDraw = useRef<
    | {
        type: StudioChartType;
        table: StudioTable;
        fields: StudioFields;
        densityMode: "density" | "scatter";
        aggregate: "sum" | "mean";
      }
    | undefined
  >(undefined);
  const [status, setStatus] = useState<{
    summary: string;
    error: string;
    details: StudioDetail[];
    omitted: number;
  }>({ summary: "正在绘图…", error: "", details: [], omitted: 0 });
  const [selected, setSelected] = useState("");
  const { theme } = useTheme();
  const { enabled: motionEnabled, reduced: reducedMotion } = useMotionPreferences();

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
      canvasReveal.current?.cancel();
      canvasReveal.current = null;
      // A remount (view switch, StrictMode replay) is a fresh first draw.
      previousDraw.current = undefined;
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
    // Data landing and a new chart type/view are entrances: rebuild the whole series
    // and let it draw in with the shared stagger instead of morphing unrelated shapes.
    const previous = previousDraw.current;
    const entrance =
      motionEnabled &&
      !reducedMotion &&
      (previous === undefined ||
        previous.type !== type ||
        previous.table !== table ||
        previous.fields !== fields ||
        previous.densityMode !== densityMode ||
        previous.aggregate !== aggregate);
    // Pasted datasets above this size skip the item stagger; the canvas still eases
    // in, but thousands of delayed symbols would blow the frame budget.
    const heavy = table.rows.length > 1500;
    const draw = (animate: boolean) => {
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
        if (built.details.length) {
          chart.setOption(
            {
              ...built.option,
              textStyle: { fontFamily: css.fontFamily, color: colors.text },
              // Shared ECharts entrance: cubic ease-out, 760ms growth, 32ms per-item
              // stagger capped at 420ms. Canvas box is untouched, so layout never jumps.
              animation: animate,
              animationDuration: animate ? (heavy ? 420 : 760) : 0,
              animationDurationUpdate: animate ? 560 : 0,
              animationEasing: "cubicOut",
              animationEasingUpdate: "cubicOut",
              animationDelay:
                animate && !heavy ? (dataIndex: number) => Math.min(dataIndex * 32, 420) : 0,
              animationDelayUpdate: 0,
            },
            { notMerge: true },
          );
          // The heatmap view has no enter animation of its own; fade its canvas in
          // with the same timing so density/heatmap data arrives with the same beat.
          const series = built.option.series;
          const seriesList = Array.isArray(series) ? series : series ? [series] : [];
          const heatmapOnly =
            seriesList.length > 0 &&
            seriesList.every((item) => (item as { type?: string }).type === "heatmap");
          if (animate && heatmapOnly) {
            const surface = element.querySelector("canvas");
            canvasReveal.current?.cancel();
            canvasReveal.current =
              surface?.animate(
                [
                  { opacity: 0, transform: "scale(0.985)" },
                  { opacity: 1, transform: "scale(1)" },
                ],
                {
                  duration: heavy ? 420 : 760,
                  easing: "cubic-bezier(0.33, 1, 0.68, 1)",
                  fill: "both",
                },
              ) ?? null;
          }
        } else chart.clear();
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
    draw(entrance);
    previousDraw.current = { type, table, fields, densityMode, aggregate };
    let width = element.clientWidth,
      height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth && height === element.clientHeight) return;
      width = element.clientWidth;
      height = element.clientHeight;
      chart.resize();
      draw(false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [type, table, fields, densityMode, aggregate, theme, motionEnabled, reducedMotion]);

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
          <div className={styles.chartError} role="status" data-enter="fade">
            {status.error}
          </div>
        )}
      </div>
      {status.details.length > 0 && (
        <div
          className={styles.selection}
          data-enter="rise-sm"
          style={{ "--enter-delay": "560ms" } as CSSProperties}
        >
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
