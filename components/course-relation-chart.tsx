"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { useTheme } from "@/components/ui/theme-provider";
import { relationKey, type CourseRelationData } from "@/lib/analysis/course-relations";
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
    return () => {
      instance.dispose();
      chart.current = null;
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
    const palette = Array.from({ length: 10 }, (_, index) =>
      color(`--chart-multi-category-${index + 1}`),
    );
    const connected = new Set(data.relations.flatMap((item) => [item.source, item.target]));
    const draw = () => {
      const compact = element.clientWidth < 420;
      const nodes = data.courses.filter((item) => connected.has(item.name));
      instance.setOption(
        {
          animation: false,
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
              itemStyle: { borderWidth: 0, borderRadius: 1 },
              lineStyle: { color: "gradient", opacity: 0.28 },
              emphasis: { focus: "adjacency", lineStyle: { opacity: 0.8 } },
              data: nodes.map((item) => ({
                name: item.name,
                itemStyle: {
                  color:
                    palette[
                      data.courses.findIndex((course) => course.name === item.name) % palette.length
                    ],
                  opacity: !course || course === item.name ? 1 : 0.45,
                },
              })),
              links: data.relations.map((item) => {
                const active = !course || item.source === course || item.target === course;
                return {
                  source: item.source,
                  target: item.target,
                  value: item.belowCount,
                  relationId: relationKey(item),
                  lineStyle: {
                    opacity: relationKey(item) === selectedKey ? 0.8 : active ? 0.32 : 0.035,
                  },
                };
              }),
            },
          ],
        },
        { notMerge: true },
      );
    };
    draw();
    const observer = new ResizeObserver(() => {
      instance.resize();
      draw();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [data, course, selectedKey, theme]);

  return (
    <div
      ref={root}
      className={styles.chart}
      role="img"
      aria-label={`${data.term}学科学习薄弱关联弦图，连带宽度表示两科都低于${data.threshold}分的人数。共${data.relations.length}组关系。可通过下方课程按钮和关联列表查看相同数据。`}
    />
  );
}
