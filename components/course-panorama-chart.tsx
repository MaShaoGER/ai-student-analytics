"use client";

import { useEffect, useId, useRef, useState } from "react";
import { relationKey } from "@/lib/analysis/course-relations";
import type { CoursePanoramaData } from "@/lib/analysis/course-panorama";
import styles from "./course-panorama.module.css";

const number = (value: number) => value.toLocaleString("zh-CN");
const MAX_RIBBONS = 12;

function courseLines(name: string, characters: number) {
  const letters = Array.from(name);
  const lines: string[] = [];
  for (let start = 0; start < Math.min(letters.length, characters * 3); start += characters)
    lines.push(letters.slice(start, start + characters).join(""));
  if (letters.length > characters * 3) lines[2] = `${lines[2].slice(0, -1)}…`;
  return lines;
}

export function CoursePanoramaChart({
  data,
  disabled,
  onSelect,
}: {
  data: CoursePanoramaData;
  disabled: boolean;
  onSelect: (key: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [hovered, setHovered] = useState("");
  const gradient = `panorama-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setAvailableWidth(Math.floor(element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { columns, selection } = data;
  const selectedKey = selection ? JSON.stringify([selection.source, selection.target]) : "";
  const activeKey = data.relations.some((item) => relationKey(item) === hovered)
    ? hovered
    : selectedKey;
  const left = 44,
    right = 12;
  const width = Math.max(availableWidth, left + right + columns.length * 66);
  const columnWidth = (width - left - right) / Math.max(1, columns.length);
  const x = (index: number) => left + columnWidth * (index + 0.5);
  const courseIndex = new Map(columns.map((column, index) => [column.course, index]));
  const maxCount = Math.max(1, ...data.relations.map((item) => item.belowCount));
  const maxBin = Math.max(1, ...columns.flatMap((column) => column.baseline.bins));
  const shown = data.relations.slice(0, MAX_RIBBONS);
  const active = data.relations.find((item) => relationKey(item) === activeKey);
  if (active && !shown.some((item) => relationKey(item) === activeKey)) shown.push(active);
  shown.sort((a, b) => Number(relationKey(a) === activeKey) - Number(relationKey(b) === activeKey));
  const chartTop = 292,
    chartBottom = 492;
  const y = (score: number) => chartBottom - (score * (chartBottom - chartTop)) / 100;
  const ticks = [0, 20, 40, 60, 80, 100];
  const hoverRelation = data.relations.find((item) => relationKey(item) === hovered);

  return (
    <figure className={styles.figure}>
      <div ref={viewport} className={styles.chartViewport} aria-label="可横向滚动的学科全景图">
        <svg
          className={styles.chart}
          width={width}
          height={670}
          viewBox={`0 0 ${width} 670`}
          role="img"
          aria-label={`${data.term}学科关联全景。当前${selection ? `${selection.source}与${selection.target}共同未达标的${number(selection.count)}名学生` : "全体学生"}。各科按相同顺序展示成绩分布、均分、及格率与有效人数。可用右侧关联选择器和按钮查看相同数据。`}
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--score)" />
              <stop offset="100%" stopColor="var(--score-bar)" />
            </linearGradient>
          </defs>
          <text x={0} y={24} className={styles.plotHeading}>
            共同薄弱关联
          </text>
          <text x={width - right} y={24} textAnchor="end" className={styles.axis}>
            {data.relations.length > MAX_RIBBONS
              ? `展示前 ${MAX_RIBBONS} 组及当前关联 · 带宽＝人数`
              : "带宽＝共同未达标人数"}
          </text>
          {shown.map((item) => {
            const key = relationKey(item);
            const a = courseIndex.get(item.source)!,
              b = courseIndex.get(item.target)!;
            const curve = 155 - (Math.abs(b - a) / Math.max(1, columns.length - 1)) * 160;
            const path = `M ${x(a)} 168 C ${x(a)} ${curve} ${x(b)} ${curve} ${x(b)} 168`;
            const ribbonWidth = (item.belowCount / maxCount) * 22;
            return (
              <g key={key}>
                <path
                  d={path}
                  fill="none"
                  stroke={`url(#${gradient})`}
                  strokeWidth={ribbonWidth}
                  opacity={activeKey ? (key === activeKey ? 0.85 : 0.1) : 0.3}
                  className={styles.ribbon}
                />
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(6, ribbonWidth)}
                  className={styles.ribbonTarget}
                  style={{ pointerEvents: disabled ? "none" : "stroke" }}
                  onPointerEnter={() => setHovered(key)}
                  onPointerLeave={() => setHovered("")}
                  onClick={() => {
                    setHovered("");
                    onSelect(key === selectedKey ? "" : key);
                  }}
                >
                  <title>{`${item.source} × ${item.target}：${number(item.belowCount)} 人共同低于 ${data.threshold} 分；两科均有成绩 ${number(item.commonCount)} 人，占 ${item.rate}%。点击联动。`}</title>
                </path>
              </g>
            );
          })}
          {!data.relations.length && (
            <text x={left} y={104} className={styles.axis}>
              当前分数线下暂无满足样本要求的关联
            </text>
          )}
          {columns.map((column, index) => {
            const involved =
              !activeKey || (active && [active.source, active.target].includes(column.course));
            const lines = courseLines(
              column.course,
              Math.max(2, Math.min(6, Math.floor(columnWidth / 13))),
            );
            return (
              <g key={column.course}>
                <line x1={x(index)} x2={x(index)} y1={232} y2={655} className={styles.guide} />
                <rect
                  x={x(index) - Math.min(25, columnWidth * 0.34)}
                  y={168}
                  width={Math.min(50, columnWidth * 0.68)}
                  height={6}
                  rx={2}
                  fill="var(--score)"
                  opacity={involved ? 1 : 0.3}
                />
                <text x={x(index)} y={197} textAnchor="middle" className={styles.courseLabel}>
                  <title>{column.course}</title>
                  {lines.map((line, i) => (
                    <tspan key={i} x={x(index)} dy={i ? 15 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
          <text x={0} y={262} className={styles.plotHeading}>
            成绩分布
          </text>
          <text x={width - right} y={262} textAnchor="end" className={styles.axis}>
            每格 5 分 · 虚线为 {data.threshold} 分未达标线
          </text>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left - 6}
                x2={width - right}
                y1={y(tick)}
                y2={y(tick)}
                className={styles.guide}
              />
              <text x={left - 12} y={y(tick) + 4} textAnchor="end" className={styles.axis}>
                {tick}
              </text>
            </g>
          ))}
          <line
            x1={left - 6}
            x2={width - right}
            y1={y(data.threshold)}
            y2={y(data.threshold)}
            stroke="var(--warning)"
            strokeWidth={1}
            strokeDasharray="3 4"
            opacity={0.7}
          />
          <text x={left - 12} y={chartTop - 10} textAnchor="end" className={styles.axis}>
            分
          </text>
          {columns.map((column, index) => {
            const current = column.cohort;
            const barWidth = Math.min(36, columnWidth * 0.44);
            const passWidth = Math.min(54, columnWidth * 0.72);
            return (
              <g key={column.course}>
                {selection &&
                  column.baseline.bins.map((count, bin) => (
                    <rect
                      key={`all-${bin}`}
                      x={x(index) - barWidth / 2 - 8}
                      y={y((bin + 1) * 5) + 0.6}
                      width={5}
                      height={8.8}
                      rx={1}
                      fill="var(--muted)"
                      opacity={count ? 0.15 + (0.6 * count) / maxBin : 0.05}
                    >
                      <title>{`${column.course}全体：${bin * 5}至${(bin + 1) * 5}分，${number(count)}人${bin < 19 ? "（不含区间上界）" : "（含100分）"}`}</title>
                    </rect>
                  ))}
                {current?.bins.map((count, bin) => (
                  <rect
                    key={`selected-${bin}`}
                    x={x(index) - barWidth / 2 + (selection ? 2 : 0)}
                    y={y((bin + 1) * 5) + 0.6}
                    width={barWidth}
                    height={8.8}
                    rx={1.5}
                    fill="var(--score)"
                    opacity={count ? 0.2 + (0.8 * count) / maxBin : 0.045}
                  >
                    <title>{`${column.course}${selection ? "选中人群" : "全体"}：${bin * 5}至${(bin + 1) * 5}分，${number(count)}人${bin < 19 ? "（不含区间上界）" : "（含100分）"}`}</title>
                  </rect>
                ))}
                {current ? (
                  <line
                    x1={x(index) - barWidth / 2 - 2}
                    x2={x(index) + barWidth / 2 + 4}
                    y1={y(current.mean)}
                    y2={y(current.mean)}
                    stroke="var(--ink)"
                    strokeWidth={2}
                  >
                    <title>{`${column.course}均分：${current.mean}分`}</title>
                  </line>
                ) : (
                  <text x={x(index)} y={408} textAnchor="middle" className={styles.axis}>
                    样本不足
                  </text>
                )}
                <text x={x(index)} y={543} textAnchor="middle" className={styles.mean}>
                  {current ? current.mean.toFixed(1) : "—"}
                </text>
                {selection && (
                  <text x={x(index)} y={563} textAnchor="middle" className={styles.axis}>
                    全体 {column.baseline.mean.toFixed(1)}
                  </text>
                )}
                <text x={x(index)} y={603} textAnchor="middle" className={styles.passRate}>
                  {current ? `${current.passRate.toFixed(1)}%` : "—"}
                </text>
                <rect
                  x={x(index) - passWidth / 2}
                  y={616}
                  width={passWidth}
                  height={4}
                  rx={2}
                  fill="var(--line)"
                />
                {current && (
                  <rect
                    x={x(index) - passWidth / 2}
                    y={616}
                    width={(passWidth * current.passRate) / 100}
                    height={4}
                    rx={2}
                    fill="var(--score)"
                  />
                )}
                {selection && (
                  <line
                    x1={x(index) - passWidth / 2 + (passWidth * column.baseline.passRate) / 100}
                    x2={x(index) - passWidth / 2 + (passWidth * column.baseline.passRate) / 100}
                    y1={613}
                    y2={623}
                    stroke="var(--muted)"
                    strokeWidth={2}
                    opacity={0.65}
                  />
                )}
                <text x={x(index)} y={651} textAnchor="middle" className={styles.axis}>
                  {current ? `${number(current.count)} 人` : "样本不足"}
                </text>
              </g>
            );
          })}
          <text x={0} y={523} className={styles.axis}>
            均分
          </text>
          <text x={0} y={583} className={styles.axis}>
            及格率
          </text>
          <text x={0} y={636} className={styles.axis}>
            样本数
          </text>
        </svg>
      </div>
      <figcaption className={styles.legend}>
        <span>
          <i />
          {selection ? "选中人群" : "全体学生"}
        </span>
        {selection && (
          <span>
            <i className={styles.referenceSwatch} />
            全体参照
          </span>
        )}
        <span>黑线＝均分 · 及格率按 60 分计算</span>
      </figcaption>
      <p className={styles.chartHint}>
        {hoverRelation
          ? `${hoverRelation.source} × ${hoverRelation.target}：${number(hoverRelation.belowCount)} / ${number(hoverRelation.commonCount)} 人共同未达标（${hoverRelation.rate}%）`
          : "点选连接带查看同一人群；学科较多时可左右滚动，各层始终对齐。"}
      </p>
    </figure>
  );
}
