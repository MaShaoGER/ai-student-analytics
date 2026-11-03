"use client";

import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { ConceptCourse, ConceptMetric } from "@/lib/analysis/concept-explorer";
import { CONCEPT_METRICS } from "@/lib/analysis/concept-explorer";
import { CONCEPT_LABELS } from "@/lib/exploration/concepts";
import type { ChartPickOrigin } from "./concept-chart";
import { useMotionPreferences } from "./ui/motion-preferences";
import styles from "./home-showcase.module.css";

type Pick = (course: string, origin: ChartPickOrigin) => void;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function pickHandlers(course: string, onPick: Pick) {
  return {
    tabIndex: 0,
    role: "button" as const,
    "aria-haspopup": "dialog" as const,
    onClick: (event: MouseEvent<SVGGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      onPick(course, event.detail === 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: event.clientX, y: event.clientY });
    },
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onPick(course, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    },
  };
}

/**
 * Home narrative: real aggregates only. A hero with headline numbers, an
 * attendance × score constellation of every course, and six metric strips.
 * Every course mark opens the same radial selection as the main chart.
 */
export function HomeShowcase({ courses, term, totalCourses, onPick }: {
  courses: ConceptCourse[];
  term: string;
  totalCourses: number;
  onPick: Pick;
}) {
  const { enabled, reduced } = useMotionPreferences();
  const open = courses.filter((course) => !course.suppressed);
  const students = open.reduce((sum, course) => sum + (course.count ?? 0), 0);
  const scores = open.flatMap((course) => course.metrics.score.value === null ? [] : [{ course, value: course.metrics.score.value }]);
  const best = scores.length ? scores.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const worst = scores.length ? scores.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const hidden = courses.length - open.length;

  // Constellation: attendance on x, score on y; radius by student count.
  const paired = open.flatMap((course) => {
    const x = course.metrics.attendance.value, y = course.metrics.score.value;
    return x === null || y === null ? [] : [{ course, x, y, n: course.count ?? 0 }];
  });
  const W = 820, H = 460, L = 64, R = W - 30, T = 30, B = H - 56;
  const xs = paired.map((p) => p.x), ys = paired.map((p) => p.y);
  const x0 = paired.length ? Math.max(0, Math.floor(Math.min(...xs) / 5) * 5 - 5) : 0, x1 = paired.length ? Math.min(100, Math.ceil(Math.max(...xs) / 5) * 5 + 5) : 100;
  const y0 = paired.length ? Math.max(0, Math.floor(Math.min(...ys) / 5) * 5 - 5) : 0, y1 = paired.length ? Math.min(100, Math.ceil(Math.max(...ys) / 5) * 5 + 5) : 100;
  const sx = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (R - L);
  const sy = (v: number) => B - ((v - y0) / (y1 - y0 || 1)) * (B - T);
  const nMax = Math.max(1, ...paired.map((p) => p.n));
  const avgX = paired.length ? mean(xs) : null, avgY = paired.length ? mean(ys) : null;

  return (
    <section className={styles.showcase} aria-label="课程全景导读" data-motion={enabled && !reduced ? "on" : "off"}>
      <div className={styles.lead}>
      <div className={styles.hero}>
        <p className={styles.kicker}><span aria-hidden />{term} · 学习数据全景</p>
        <h1 className={styles.headline} tabIndex={-1} data-scene-heading>
          {totalCourses} 门课，<span>一张会回答问题的图。</span>
        </h1>
        <p className={styles.lede}>从每门课的均分出发，点一颗星，就能走进它的出勤、作业与成绩分布。下面每一个数字都来自当前数据源的真实聚合。</p>
        <dl className={styles.figures}>
          <div><dt>课程</dt><dd>{totalCourses}</dd></div>
          <div><dt>选课人次</dt><dd>{students.toLocaleString("zh-CN")}</dd></div>
          {best && <div><dt>均分最高 · {best.course.course}</dt><dd>{best.value.toFixed(2)}<small>分</small></dd></div>}
          {worst && <div><dt>均分最低 · {worst.course.course}</dt><dd>{worst.value.toFixed(2)}<small>分</small></dd></div>}
        </dl>
        {hidden > 0 && <p className={styles.note}>{hidden} 门课样本少于 3 人，已隐藏数值。</p>}
      </div>

      {paired.length > 1 && (
        <figure className={styles.constellation}>
          <figcaption className={styles.figHead}>
            <span className={styles.index}>01</span>
            <strong>出勤 × 均分星图</strong>
            <span>每颗星是一门课；越靠右上，出勤越高、均分越高。大小表示选课人数。</span>
          </figcaption>
          <svg viewBox={`0 0 ${W} ${H}`} className={styles.sky} role="group" aria-label="各课程出勤率与均分的散点星图">
            <defs>
              <radialGradient id="star-glow"><stop offset="0" stopColor="rgba(118,102,204,0.45)" /><stop offset="1" stopColor="rgba(118,102,204,0)" /></radialGradient>
              <radialGradient id="star-core"><stop offset="0" stopColor="#fff" /><stop offset="0.65" stopColor="#ebe7f7" /><stop offset="1" stopColor="#c9c0e6" /></radialGradient>
            </defs>
            {[0, 1, 2, 3, 4].map((k) => {
              const vy = y0 + ((y1 - y0) * k) / 4, vx = x0 + ((x1 - x0) * k) / 4;
              return (
                <g key={k}>
                  <line className={styles.grid} x1={L} x2={R} y1={sy(vy)} y2={sy(vy)} />
                  <text className={styles.tick} x={L - 10} y={sy(vy) + 4} textAnchor="end">{Math.round(vy)}</text>
                  <line className={styles.grid} x1={sx(vx)} x2={sx(vx)} y1={T} y2={B} />
                  <text className={styles.tick} x={sx(vx)} y={B + 20} textAnchor="middle">{Math.round(vx)}%</text>
                </g>
              );
            })}
            {avgX !== null && avgY !== null && (
              <g className={styles.mean}>
                <line x1={sx(avgX)} x2={sx(avgX)} y1={T} y2={B} />
                <line x1={L} x2={R} y1={sy(avgY)} y2={sy(avgY)} />
                <text x={sx(avgX) + 6} y={T + 12}>课程平均出勤 {avgX.toFixed(1)}%</text>
                <text x={R} y={sy(avgY) - 8} textAnchor="end">课程平均均分 {avgY.toFixed(1)}</text>
              </g>
            )}
            <text className={styles.axis} x={(L + R) / 2} y={H - 8} textAnchor="middle">出勤率 / %</text>
            <text className={styles.axis} x={16} y={(T + B) / 2} transform={`rotate(-90 16 ${(T + B) / 2})`} textAnchor="middle">均分 / 分</text>
            {paired.map((p, i) => {
              const r = 7 + Math.sqrt(p.n / nMax) * 15;
              const cx = sx(p.x), cy = sy(p.y);
              return (
                <g key={p.course.course} className={styles.star} style={{ "--i": i } as CSSProperties}
                  aria-label={`${p.course.course}：出勤 ${p.x.toFixed(2)}%，均分 ${p.y.toFixed(2)} 分，${p.n} 人；选择去向`}
                  {...pickHandlers(p.course.course, onPick)}>
                  <title>{`${p.course.course} · 出勤 ${p.x.toFixed(2)}% · 均分 ${p.y.toFixed(2)} 分 · ${p.n} 人`}</title>
                  <circle className={styles.touchTarget} cx={cx} cy={cy} r={Math.max(r, 17)} />
                  <circle className={styles.halo} cx={cx} cy={cy} r={r * 2.2} fill="url(#star-glow)" />
                  <circle className={styles.core} cx={cx} cy={cy} r={r} fill="url(#star-core)" />
                </g>
              );
            })}
          </svg>
        </figure>
      )}
      </div>

      <section className={styles.strips} aria-label="六项指标在各课程间的分布">
        <header className={styles.figHead}>
          <span className={styles.index}>02</span>
          <strong>六把尺子</strong>
          <span>同一组课程放到六项统一指标上，每个点是一门课，竖线是课程平均。</span>
        </header>
        {CONCEPT_METRICS.map((metric: ConceptMetric, row) => {
          const marks = open.flatMap((course) => course.metrics[metric].value === null ? [] : [{ course: course.course, value: course.metrics[metric].value as number }]);
          const label = CONCEPT_LABELS[metric];
          return (
            <div key={metric} className={styles.strip} style={{ "--row": row } as CSSProperties}>
              <p className={styles.stripLabel}>{label.name}<small>{marks.length ? `${mean(marks.map((m) => m.value)).toFixed(1)}${metric === "score" ? " 分" : "%"} 平均` : "当前数据源无记录"}</small></p>
              <svg viewBox="0 0 600 40" className={styles.stripSvg} preserveAspectRatio="none" role="group" aria-label={`${label.name}在各课程间的分布`}>
                <line className={styles.rail} x1={0} x2={600} y1={20} y2={20} />
                {[0, 25, 50, 75, 100].map((v) => <line key={v} className={styles.notch} x1={v * 6} x2={v * 6} y1={14} y2={26} />)}
                {marks.length > 0 && <line className={styles.avg} x1={mean(marks.map((m) => m.value)) * 6} x2={mean(marks.map((m) => m.value)) * 6} y1={4} y2={36} />}
                {marks.map((m) => (
                  <g key={m.course} className={styles.bead} {...pickHandlers(m.course, onPick)} aria-label={`${m.course} ${label.name} ${m.value.toFixed(2)}${metric === "score" ? " 分" : "%"}；选择去向`}>
                    <title>{`${m.course} · ${label.name} ${m.value.toFixed(2)}${metric === "score" ? " 分" : "%"}`}</title>
                    <rect x={m.value * 6 - 3} y={10} width={6} height={20} />
                  </g>
                ))}
              </svg>
              <p className={styles.scale} aria-hidden><span>0</span><span>100</span></p>
            </div>
          );
        })}
      </section>
    </section>
  );
}
