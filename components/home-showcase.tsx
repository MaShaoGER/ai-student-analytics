"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useInView } from "motion/react";
import type { ConceptCourse, ConceptMetric } from "@/lib/analysis/concept-explorer";
import { CONCEPT_METRICS } from "@/lib/analysis/concept-explorer";
import { CONCEPT_LABELS } from "@/lib/exploration/concepts";
import type { ChartPickOrigin } from "./concept-chart";
import { CountUp, MaskRise } from "./ui/editorial-motion";
import { useMotionPreferences } from "./ui/motion-preferences";
import styles from "./home-showcase.module.css";

type Pick = (course: string, origin: ChartPickOrigin) => void;

/** One hero figure of the statistics chapter: number, unit and its own scope. */
type Figure = {
  key: string;
  label: string;
  value: number;
  unit: string;
  format: (value: number) => string;
  note: string;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const tally = (value: number) => Math.round(value).toLocaleString("zh-CN");

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
 * Tracks which statistics segment currently sits closest to the centre of the
 * viewport, so the narrative has one visible focus at a time. Scroll work is
 * rAF-gated and only reads the four segment boxes; nothing is hidden by it.
 */
function useCentreSegment(count: number) {
  const nodes = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (count === 0) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const middle = window.innerHeight / 2;
      let best = -1;
      let distance = Number.POSITIVE_INFINITY;
      nodes.current.forEach((node, position) => {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const next = Math.abs((rect.top + rect.bottom) / 2 - middle);
        if (next < distance) {
          distance = next;
          best = position;
        }
      });
      setActive((current) => (current === best ? current : best));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [count]);
  const register = useCallback((position: number, node: HTMLElement | null) => {
    nodes.current[position] = node;
  }, []);
  return { active, register };
}

/**
 * One segment of the statistics chapter. It rises in when it approaches the
 * viewport and counts its own figure; the number itself is never dimmed, only
 * the mono index and the scope sentence follow the current focus.
 */
function StatFigure({ figure, position, total, active, register }: {
  figure: Figure;
  position: number;
  total: number;
  active: boolean;
  register: (position: number, node: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  const seen = useInView(ref, { once: true, amount: "some", margin: "0px 0px -12% 0px" });
  return (
    <li
      ref={(node) => {
        ref.current = node;
        register(position, node);
      }}
      className={styles.stat}
      data-visible={seen ? "true" : "false"}
      data-active={active ? "true" : "false"}
    >
      <p className={styles.statHead}>
        <span className={styles.statIndex}>{String(position + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        <span className={styles.statLabel}>{figure.label}</span>
      </p>
      <p className={styles.statValue}>
        <CountUp value={figure.value} format={figure.format} duration={0.9} whenVisible />
        <small>{figure.unit}</small>
      </p>
      <p className={styles.statNote}>{figure.note}</p>
    </li>
  );
}

/** One ruler: a metric rail with a bead per displayed course. */
function StripRow({ metric, courses, onPick }: {
  metric: ConceptMetric;
  courses: ConceptCourse[];
  onPick: Pick;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useInView(ref, { once: true, amount: "some", margin: "0px 0px -10% 0px" });
  const label = CONCEPT_LABELS[metric];
  const unit = metric === "score" ? " 分" : "%";
  const marks = courses.flatMap((course) => course.metrics[metric].value === null ? [] : [{ course: course.course, value: course.metrics[metric].value as number }]);
  const average = marks.length ? mean(marks.map((mark) => mark.value)) : null;
  return (
    <div ref={ref} className={styles.strip} data-visible={seen ? "true" : "false"}>
      <p className={styles.stripLabel}>
        {label.name}
        <small>{average === null ? "当前数据源无记录" : `${average.toFixed(1)}${unit} 平均`}</small>
      </p>
      <svg viewBox="0 0 600 40" className={styles.stripSvg} preserveAspectRatio="none" role="group" aria-label={`${label.name}在已展示课程间的分布`}>
        <line className={styles.rail} x1={0} x2={600} y1={20} y2={20} />
        {[0, 25, 50, 75, 100].map((value) => <line key={value} className={styles.notch} x1={value * 6} x2={value * 6} y1={14} y2={26} />)}
        {average !== null && <line className={styles.avg} x1={average * 6} x2={average * 6} y1={4} y2={36} />}
        {marks.map((mark) => (
          <g key={mark.course} className={styles.bead} {...pickHandlers(mark.course, onPick)} aria-label={`${mark.course} ${label.name} ${mark.value.toFixed(2)}${unit}；选择去向`}>
            <title>{`${mark.course} · ${label.name} ${mark.value.toFixed(2)}${unit}`}</title>
            <rect x={mark.value * 6 - 3} y={10} width={6} height={20} />
          </g>
        ))}
      </svg>
      <p className={styles.scale} aria-hidden><span>0</span><span>100</span></p>
    </div>
  );
}

/**
 * Home narrative: real aggregates only. A sticky masthead asks the question;
 * the scrolling column answers it in order — four counted figures with their
 * own scope, an attendance × score constellation of every displayed course,
 * then six metric rulers. Every course mark opens the same radial selection
 * as the main chart. Each section arms itself as it reaches the viewport, so
 * scrolling drives the story instead of one static grid.
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
  const scopeAll = courses.length >= totalCourses;
  const rank = scopeAll ? "数据源内" : "已展示课程中";

  // Four figures, each carrying the scope sentence its number needs: the
  // list may be a courseLimit slice, a student may be enrolled twice, and a
  // course without a record is absent rather than zero.
  const figures: Figure[] = [
    {
      key: "courses",
      label: "课程总数",
      value: totalCourses,
      unit: "门",
      format: (value) => tally(value),
      note: scopeAll
        ? `当前数据源共 ${totalCourses} 门课程；下方图表只展示样本足够且有对应记录的课程。`
        : `当前数据源共 ${totalCourses} 门课程；本页展示 ${courses.length} 门，下方星图与尺子只覆盖已展示的有效记录。`,
    },
    {
      key: "students",
      label: "选课人次",
      value: students,
      unit: "人次",
      format: (value) => tally(value),
      note: hidden > 0
        ? `已展示 ${courses.length} 门课中，${open.length} 门未隐藏课程合计 ${tally(students)} 人次；同一学生在多门课里各计一次，不是独立人数。`
        : `已展示 ${courses.length} 门课合计 ${tally(students)} 人次；同一学生在多门课里各计一次，不是独立学生人数。`,
    },
  ];
  if (best) {
    figures.push({
      key: "best",
      label: `均分最高 · ${best.course.course}`,
      value: best.value,
      unit: "分",
      format: (value) => value.toFixed(2),
      note: `${rank}有有效成绩的 ${scores.length} 门课里最高；缺成绩记录的课程不补零，不参与比较。`,
    });
  }
  if (worst) {
    figures.push({
      key: "worst",
      label: `均分最低 · ${worst.course.course}`,
      value: worst.value,
      unit: "分",
      format: (value) => value.toFixed(2),
      note: `${rank}有有效成绩的 ${scores.length} 门课里最低；缺成绩记录的课程不补零，不参与比较。`,
    });
  }

  const { active, register } = useCentreSegment(figures.length);

  // Constellation: attendance on x, score on y; radius by student count.
  const paired = open.flatMap((course) => {
    const x = course.metrics.attendance.value, y = course.metrics.score.value;
    return x === null || y === null ? [] : [{ course, x, y, n: course.count ?? 0 }];
  });
  const W = 820, H = 460, L = 64, R = W - 30, T = 30, B = H - 56;
  const xs = paired.map((p) => p.x), ys = paired.map((p) => p.y);
  const x0 = paired.length ? Math.max(0, Math.floor(Math.min(...xs) / 5) * 5 - 5) : 0, x1 = paired.length ? Math.min(100, Math.ceil(Math.max(...xs) / 5) * 5 + 5) : 100;
  const y0 = paired.length ? Math.max(0, Math.floor(Math.min(...ys) / 5) * 5 - 5) : 0, y1 = paired.length ? Math.min(100, Math.ceil(Math.max(...ys) / 5) * 5 + 5) : 100;
  const sx = (value: number) => L + ((value - x0) / (x1 - x0 || 1)) * (R - L);
  const sy = (value: number) => B - ((value - y0) / (y1 - y0 || 1)) * (B - T);
  const nMax = Math.max(1, ...paired.map((p) => p.n));
  const avgX = paired.length ? mean(xs) : null, avgY = paired.length ? mean(ys) : null;

  // Section heads and charts arm on their own trigger. Long figures use a
  // margin-based trigger instead of an area ratio, so a block taller than the
  // viewport still enters; the six rulers arm one row at a time.
  const constellationRef = useRef<HTMLElement | null>(null);
  const stripsHeadRef = useRef<HTMLElement | null>(null);
  const constellationSeen = useInView(constellationRef, { once: true, amount: "some", margin: "-10% 0px -12% 0px" });
  const stripsHeadSeen = useInView(stripsHeadRef, { once: true, amount: "some", margin: "0px 0px -10% 0px" });

  return (
    <section className={styles.showcase} aria-label="课程全景导读" data-navigation-motion data-motion={enabled && !reduced ? "on" : "off"}>
      <div className={styles.lead}>
        <div className={styles.hero}>
          <p className={styles.kicker}><span aria-hidden />{term} · 学习数据全景</p>
          <h1 className={styles.headline} tabIndex={-1} data-scene-heading>
            <MaskRise className={styles.headlineLine}>{`${totalCourses} 门课`}</MaskRise>
            <MaskRise className={styles.headlineLine} delay={80}>从数据</MaskRise>
            <MaskRise className={styles.headlineLine} delay={160}>看见关联。</MaskRise>
          </h1>
          <p className={styles.lede}>从每门课的均分出发，点一颗星就能走进它的出勤、作业与成绩。星图与六把尺子都可以直接点击，去向和主图完全一致。</p>
          <p className={styles.cue}><span className={styles.cueLine} aria-hidden />向下滚动：四个数字，一张星图，六把尺子</p>
        </div>

        <div className={styles.narrative}>
          <section className={styles.statsSection} aria-label="数据规模">
            <header className={styles.figHead}>
              <span className={styles.index}>01</span>
              <strong>这组数字的来历</strong>
              <span>四个数字随滚动依次进入画面，每个都写明统计范围：列表可能只是数据源的一段，人数也不是独立学生数。</span>
            </header>
            <ol className={styles.stats} role="list">
              {figures.map((figure, position) => (
                <StatFigure key={figure.key} figure={figure} position={position} total={figures.length}
                  active={active === position} register={register} />
              ))}
            </ol>
            {hidden > 0 && (
              <p className={styles.note}>{hidden} 门课样本少于 3 人，已从合计与下方分布中隐藏，避免反推个体。</p>
            )}
          </section>

          {paired.length > 1 && (
            <figure className={styles.constellation} ref={constellationRef} data-visible={constellationSeen ? "true" : "false"}>
              <figcaption className={styles.figHead}>
                <span className={styles.index}>02</span>
                <strong>出勤 × 均分星图</strong>
                <span>
                  已展示 {open.length} 门课中 {paired.length} 门同时有出勤与均分记录。每颗星是一门课，越靠右上出勤越高、均分越高，大小表示选课人数；点任意一颗星选择去向。
                </span>
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

          <section className={styles.strips} aria-label="六项指标在已展示课程间的分布">
            <header ref={stripsHeadRef} className={styles.figHead} data-visible={stripsHeadSeen ? "true" : "false"}>
              <span className={styles.index}>03</span>
              <strong>六把尺子</strong>
              <span>已展示的 {open.length} 门课放到六项统一指标上：每个点是一门课，竖线是这些课程的平均。六行随滚动逐条进入，点任意一点选择去向。</span>
            </header>
            {CONCEPT_METRICS.map((metric) => (
              <StripRow key={metric} metric={metric} courses={open} onPick={onPick} />
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}