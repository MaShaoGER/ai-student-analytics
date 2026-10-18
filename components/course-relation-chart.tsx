"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
import { useTheme } from "@/components/ui/theme-provider";
import { relationKey, type CourseRelationData } from "@/lib/analysis/course-relations";
import { courseColorTokens } from "@/lib/analysis/course-colors";
import styles from "./course-relations.module.css";

export function CourseRelationChart({
  data,
  course,
  selectedKey,
  onCourse,
  onRelation,
}: {
  data: CourseRelationData;
  course: string;
  selectedKey?: string;
  onCourse: (course: string) => void;
  onRelation: (key: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { theme } = useTheme();
  const { enabled: motionEnabled, reduced: reducedMotion } = useMotionPreferences();
  const colors = useRef(new Map<string, string>());
  // The first paint grows the chord as one group; later filter/focus/hover updates
  // keep the previous behavior and are carried by the CSS path transitions.
  const drawn = useRef(false);
  const skipFocusAnimation = useRef(true);
  const [hovered, setHovered] = useState({ key: "", course: "" });
  const callbacks = useRef({ onCourse, onRelation });
  useEffect(() => {
    callbacks.current = { onCourse, onRelation };
  });

  useEffect(() => {
    if (!root.current) return;
    const instance = echarts.init(root.current, undefined, { renderer: "svg" });
    chart.current = instance;
    instance.on("click", (params) => {
      if (params.dataType === "edge") {
        const item = params.data as { relationId: string };
        callbacks.current.onRelation(item.relationId);
      } else if (params.name) callbacks.current.onCourse(params.name);
    });
    instance.on("mouseover", (params) => {
      if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      const edge = params.data as { relationId?: string };
      setHovered({
        key: params.dataType === "edge" ? (edge.relationId ?? "") : "",
        course: params.dataType === "edge" ? "" : (params.name ?? ""),
      });
    });
    instance.on("mouseout", () => setHovered({ key: "", course: "" }));
    return () => {
      instance.dispose();
      chart.current = null;
      // A re-created ECharts instance paints a fresh series, so its first draw is
      // an entrance again (React StrictMode in dev recreates effects once).
      drawn.current = false;
      skipFocusAnimation.current = true;
    };
  }, []);

  useEffect(() => {
    const element = root.current;
    const instance = chart.current;
    if (!element || !instance) return;
    const css = getComputedStyle(element);
    // Resolve CSS Color 4 tokens before passing them to ECharts' SVG renderer.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const color = (token: string) => {
      const value = css.getPropertyValue(token).trim();
      if (!context) return value;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return `rgba(${r},${g},${b},${a / 255})`;
    };
    const tokens = courseColorTokens(data.courses.map((item) => item.name));
    const palette = new Map([...tokens].map(([name, token]) => [name, color(token)]));
    colors.current = palette;
    const connected = new Set(data.relations.flatMap((item) => [item.source, item.target]));
    const motion = motionEnabled && !reducedMotion;
    const firstDraw = !drawn.current;
    drawn.current = true;
    // The first draw is page presentation, so it animates regardless of input
    // modality; later redraws are interaction feedback and need a pointer.
    const entrance =
      motion && (firstDraw || document.documentElement.dataset.inputModality === "pointer");
    if (entrance) skipFocusAnimation.current = true;
    const draw = () => {
      const compact = element.clientWidth < 420;
      const nodes = data.courses.filter((item) => connected.has(item.name));
      instance.setOption(
        {
          animation: entrance,
          animationDuration: entrance ? 760 : 0,
          animationDurationUpdate: 0,
          animationEasing: "cubicOut",
          animationEasingUpdate: "cubicOut",
          animationDelay: entrance
            ? (dataIndex: number) =>
                Number.isFinite(dataIndex) ? Math.min(dataIndex * 32, 420) : 0
            : 0,
          animationDelayUpdate: 0,
          textStyle: { fontFamily: css.fontFamily },
          tooltip: {
            trigger: "item",
            confine: true,
            renderMode: "richText",
            backgroundColor: color("--chart-tooltip-bg"),
            borderColor: color("--line"),
            textStyle: { color: color("--ink"), fontSize: 12 },
            formatter: (params: unknown) => {
              const item = params as {
                dataType?: string;
                data: { relationId?: string };
                name: string;
              };
              const relation = data.relations.find((r) => relationKey(r) === item.data.relationId);
              if (relation)
                return `${relation.source} ↔ ${relation.target}\n共同低于 ${data.threshold} 分：${relation.belowCount} 人\n两科均有成绩：${relation.commonCount} 人\n共同未达标比例：${relation.rate}%`;
              return `${item.name}\n外环长度为可见关联人数之和\n同一学生可在多条关联中重复计入`;
            },
          },
          series: [
            {
              id: "course-relations",
              type: "chord",
              radius: compact
                ? element.clientWidth < 290
                  ? ["49%", "55%"]
                  : ["56%", "62%"]
                : ["70%", "76%"],
              padAngle: 5,
              minAngle: 3,
              label: {
                color: color("--ink"),
                fontSize: 12,
                distance: compact ? 5 : 9,
                formatter: (params: { name: string }) =>
                  compact
                    ? (params.name.match(/.{1,4}/gu) ?? [params.name]).join("\n")
                    : params.name,
              },
              itemStyle: { borderWidth: 0, borderRadius: 0 },
              lineStyle: { color: "gradient", opacity: 0.28 },
              // Selection and hover share the controlled focus below; native emphasis
              // would add an independent brightening/blur state on top of it.
              emphasis: { disabled: true },
              data: nodes.map((item) => ({
                name: item.name,
                itemStyle: {
                  color: palette.get(item.name),
                  opacity: 1,
                },
              })),
              links: data.relations.map((item) => ({
                id: relationKey(item),
                source: item.source,
                target: item.target,
                value: item.belowCount,
                relationId: relationKey(item),
              })),
            },
          ],
        },
        { notMerge: false },
      );
    };
    draw();
    const observer = new ResizeObserver(() => {
      instance.resize();
      const compact = element.clientWidth < 420;
      instance.setOption({
        series: [
          {
            id: "course-relations",
            radius: compact
              ? element.clientWidth < 290
                ? ["49%", "55%"]
                : ["56%", "62%"]
              : ["70%", "76%"],
            label: {
              distance: compact ? 5 : 9,
              formatter: (params: { name: string }) =>
                compact ? (params.name.match(/.{1,4}/gu) ?? [params.name]).join("\n") : params.name,
            },
          },
        ],
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [data, theme, motionEnabled, reducedMotion]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    // The focus sync that immediately follows an entrance must not cancel it.
    const firstSync = skipFocusAnimation.current;
    skipFocusAnimation.current = false;
    const key = selectedKey || hovered.key;
    const pair = data.relations.find((item) => relationKey(item) === key);
    const subject = course || hovered.course;
    const involved = (name: string) =>
      pair ? pair.source === name || pair.target === name : !subject || subject === name;
    const connected = new Set(data.relations.flatMap((item) => [item.source, item.target]));
    instance.setOption({
      ...(firstSync ? {} : { animation: false }),
      series: [
        {
          id: "course-relations",
          data: data.courses
            .filter((item) => connected.has(item.name))
            .map((item) => ({
              name: item.name,
              itemStyle: {
                color: colors.current.get(item.name),
                opacity: involved(item.name) ? 1 : 0.28,
              },
            })),
          links: data.relations.map((item) => ({
            id: relationKey(item),
            source: item.source,
            target: item.target,
            value: item.belowCount,
            relationId: relationKey(item),
            lineStyle: {
              opacity: pair
                ? relationKey(item) === key
                  ? 0.82
                  : 0.035
                : subject
                  ? item.source === subject || item.target === subject
                    ? 0.52
                    : 0.035
                  : 0.32,
            },
          })),
        },
      ],
    });
  }, [data, course, selectedKey, hovered, theme]);

  return (
    <div
      ref={root}
      className={styles.chart}
      data-enter="fade"
      role="img"
      aria-label={`${data.term}学科学习薄弱关联弦图，连带宽度表示两科都低于${data.threshold}分的人数。共${data.relations.length}组关系。可通过下方课程按钮和关联列表查看相同数据。`}
    />
  );
}
