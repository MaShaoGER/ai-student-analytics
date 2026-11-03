"use client";

import { useMotionValue, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
import { BoxChart } from "./box-chart";
import { ChangeChart } from "./change-chart";
import { ChordChart } from "./chord-chart";
import { CompareChart } from "./compare-chart";
import { anchorId, useLinkGeometry, type SegmentId, type SegmentKind } from "./geometry";
import { HeatChart } from "./heat-chart";
import { HeroPixels } from "./hero-pixels";
import { LinkLayer } from "./link-layer";
import { ScatterChart } from "./scatter-chart";
import type { Selection } from "./selection";
import {
  activitySummary,
  COHORT,
  BELOW_70,
  COURSES,
  MIX,
  PAIRS,
  SCORE_BANDS,
  signed,
  SPREAD,
  TIER_RANGES,
  TIERS,
  type CourseKey,
} from "./story-data";
import styles from "./story.module.css";

type StageOffset = NonNullable<Parameters<typeof useScroll>[0]>["offset"];
const MID: StageOffset = ["start 0.9", "end 0.6"];
/** The page bottom is too short to lift the last stage higher, so it ends at "end end". */
const LAST: StageOffset = ["start 0.9", "end end"];

/**
 * Scroll progress of `target` that follows the scroll both ways and stops when scrolling stops.
 * With motion off (local switch or OS setting) it pins to 1, so every chart is complete and linked.
 */
function useStageProgress(target: RefObject<HTMLElement | null>, still: boolean, offset: StageOffset) {
  const { scrollYProgress } = useScroll({ target, offset });
  const progress = useMotionValue(1);
  useMotionValueEvent(scrollYProgress, "change", (value) => {
    if (!still) progress.set(value);
  });
  useEffect(() => {
    progress.set(still ? 1 : scrollYProgress.get());
  }, [still, progress, scrollYProgress]);
  return progress;
}

const NAV = [
  { id: "compare", label: "看差异" },
  { id: "spread", label: "看分布" },
  { id: "change", label: "看变化" },
  { id: "rhythm", label: "看节奏" },
  { id: "relation", label: "看关系" },
  { id: "overview", label: "看全貌" },
] as const;

/** Marks the chapter crossing the middle band of the viewport. */
function useCurrentChapter() {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setCurrent(entry.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const { id } of NAV) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);
  return current;
}

function Hero({ still }: { still: boolean }) {
  const area = useRef<HTMLElement>(null);
  return (
    <header className={styles.hero} ref={area}>
      <div className={styles.heroGrid} aria-hidden="true" />
      <div className={styles.heroText}>
        <p className={styles.mono}>Connected Story · 预览 01—06</p>
        <h1>
          让发现，
          <br />
          连成一幅画。
        </h1>
        <p className={styles.serif}>One canvas. Many perspectives.</p>
        <p className={styles.lede}>
          从四门课的均分出发，沿同一刻度看分布和变化，再换到学习节奏、活动量与成绩、共同低分。每换一次口径，线就断开，并写明换了什么。
        </p>
      </div>
      <HeroPixels area={area} still={still} />
      <dl className={styles.legend}>
        <dt className={styles.mono}>How to read</dt>
        <dd>
          <svg width="40" height="10" aria-hidden="true">
            <path d="M0 5H30" style={{ stroke: "var(--ink)", strokeWidth: 1.5 }} />
            <rect x="30" y="0" width="10" height="10" style={{ fill: "var(--ink)" }} />
          </svg>
          实线：同一门课、同一个数值，直接延续
        </dd>
        <dd>
          <svg width="40" height="10" aria-hidden="true">
            <path d="M0 5H14" style={{ stroke: "var(--ink)", strokeWidth: 1.5 }} />
            <rect x="19" y="3" width="4" height="4" style={{ fill: "var(--mid)" }} />
            <rect x="27" y="3" width="4" height="4" style={{ fill: "var(--mid)" }} />
            <rect x="35" y="3" width="4" height="4" style={{ fill: "var(--mid)" }} />
          </svg>
          像素断开：换了指标或统计对象
        </dd>
        <dd className={styles.note}>固定演示数据 · 连线表示阅读路径，不表示统计推导</dd>
      </dl>
    </header>
  );
}

type Chapter = "01" | "02" | "03" | "04" | "05" | "06";
const PROMPT = "悬停、轻触或用 Tab 选中一门课，每张按课程统计的图会同时标出它。";

function courseLine(chapter: Exclude<Chapter, "05">, key: CourseKey): ReactNode {
  const course = COURSES.find((item) => item.key === key)!;
  switch (chapter) {
    case "01":
      return (
        <>
          <b>{course.name}</b> 本学期均分 <strong>{course.now}</strong> 分
        </>
      );
    case "02": {
      const { min, q1, median, q3, max } = SPREAD[key];
      return (
        <>
          <b>{course.name}</b> 均分 <strong>{course.now}</strong> · 中位数 {median} · 四分位 {q1}–{q3} · 范围 {min}–{max}
        </>
      );
    }
    case "03":
      return (
        <>
          <b>{course.name}</b> {course.prev} → <strong>{course.now}</strong> 分，变化 {signed(course.now - course.prev)}
        </>
      );
    case "04": {
      const { total, peak, peakWeek } = activitySummary(key);
      return (
        <>
          <b>{course.name}</b> 12 周共 <strong>{total}</strong> 小时 · 峰值第 {peakWeek} 周 {peak} 小时
        </>
      );
    }
    case "06": {
      const shared = PAIRS.filter((item) => item.a === key || item.b === key);
      return (
        <>
          <b>{course.name}</b> <strong>{BELOW_70[key]}</strong> 人低于 70 分 · 同时低于 70：
          {shared.map((item) => `${item.a === key ? item.b : item.a} ${item.count}`).join(" · ")}
          {" 人"}
        </>
      );
    }
  }
}

/** Values in each chapter's own terms; space is reserved so nothing shifts. */
function Readout({ chapter, active, tier, pair }: {
  chapter: Chapter;
  active: CourseKey | null;
  tier?: number | null;
  pair?: string | null;
}) {
  let body: ReactNode;
  if (chapter === "05") {
    const shown = tier ?? null;
    body =
      shown === null ? (
        <>
          <b>低活动量 × 低于 70 分</b> <strong>{MIX[0][0]}</strong> 人次 · 点一个活动档查看四个成绩区间
        </>
      ) : (
        <>
          <b>{TIERS[shown]}活动量</b>（{TIER_RANGES[shown]}）{SCORE_BANDS.map((band, b) => `${band} ${MIX[shown][b]}`).join(" · ")} 人次
        </>
      );
  } else if (chapter === "06" && pair) {
    const item = PAIRS.find((entry) => entry.id === pair)!;
    body = (
      <>
        <b>
          课程 {item.a} 与课程 {item.b}
        </b>{" "}
        <strong>{item.count}</strong> 人两门都低于 70 分（非因果）
      </>
    );
  } else if (active) {
    body = courseLine(chapter, active);
  } else {
    body = <span>{chapter === "06" ? "点击一条弦，或选中一门课，查看共同低于 70 分的人数。" : PROMPT}</span>;
  }
  return (
    <p className={styles.readout} aria-live="polite">
      {body}
    </p>
  );
}

/** The hand-off between two chapters; `break` adds the pixel gap and states what changed. */
function Junction({ id, kind, label, children }: { id: SegmentId; kind: SegmentKind; label: string; children: ReactNode }) {
  return (
    <div className={styles.junction} data-kind={kind}>
      <p className={styles.mono}>{label}</p>
      <p>{children}</p>
      <div className={styles.route} data-anchor={anchorId.junction(id)} aria-hidden="true">
        {kind === "break" ? (
          <span className={styles.breakMark}>
            <i />
            <i />
            <i />
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function StoryClient() {
  const { enabled, reduced } = useMotionPreferences();
  const still = !enabled || reduced;
  const [pinned, setPinned] = useState<CourseKey | null>(null);
  const [preview, setPreview] = useState<CourseKey | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  const [pair, setPair] = useState<string | null>(null);
  const active = preview ?? pinned;
  const selection: Selection = {
    active,
    pinned,
    setPreview,
    toggle: (key) => {
      setPair(null);
      setPinned((current) => (current === key ? null : key));
    },
  };
  const story = useRef<HTMLDivElement>(null);
  const stageCompare = useRef<HTMLElement>(null);
  const stageSpread = useRef<HTMLDivElement>(null);
  const stageChange = useRef<HTMLDivElement>(null);
  const stageRhythm = useRef<HTMLDivElement>(null);
  const stageRelation = useRef<HTMLDivElement>(null);
  const stageOverview = useRef<HTMLDivElement>(null);
  const compare = useStageProgress(stageCompare, still, MID);
  const spread = useStageProgress(stageSpread, still, MID);
  const change = useStageProgress(stageChange, still, MID);
  const rhythm = useStageProgress(stageRhythm, still, MID);
  const relation = useStageProgress(stageRelation, still, MID);
  const overview = useStageProgress(stageOverview, still, LAST);
  const geometry = useLinkGeometry(story);
  const current = useCurrentChapter();
  return (
    <div className={styles.page} data-still={still || undefined}>
      <nav className={styles.nav} aria-label="章节">
        <a className={styles.brand} href="#top">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M0 0h6v6H0zM12 0h6v6h-6zM0 6h18v6H0zM6 12h6v6H6z" style={{ fill: "var(--ink)" }} />
          </svg>
          知序<span className={styles.mono}>Zhixu</span>
        </a>
        <div className={styles.navLinks}>
          {NAV.map((item) => (
            <a key={item.id} href={`#${item.id}`} aria-current={current === item.id ? "true" : undefined}>
              {item.label}
            </a>
          ))}
        </div>
        <a className={styles.demo} href="/">
          <i aria-hidden="true" />
          体验演示
        </a>
      </nav>
      <main id="top">
        <Hero still={still} />
        <div className={styles.story} ref={story}>
          <section id="compare" className={`${styles.chapter} ${styles.chapter01}`} ref={stageCompare} aria-labelledby="compare-title">
            <div className={styles.text}>
              <p className={styles.mono}>01 / Compare · 本学期均分</p>
              <h2 id="compare-title">从差异开始。</h2>
              <p className={styles.sub}>同一学期，四门课程的平均成绩。</p>
              <p className={styles.figure12}>
                <strong>12</strong>
                <span>分 · 最高与最低均分之差</span>
              </p>
              <p className={styles.hint}>每根柱子的末端，落进 02 的分布。</p>
              <Readout chapter="01" active={active} />
            </div>
            <CompareChart selection={selection} progress={compare} />
          </section>
          <div ref={stageSpread}>
            <Junction id="spread" kind="solid" label="Same scale · 0–100">
              同一刻度：柱子的末端落成分布里的均分 ■。
            </Junction>
            <section id="spread" className={`${styles.chapter} ${styles.chapter02}`} aria-labelledby="spread-title">
              <div className={styles.text}>
                <p className={styles.mono}>02 / Spread · 本学期成绩分布</p>
                <h2 id="spread-title">同样的均分，不同的分散。</h2>
                <p className={styles.sub}>每门课 {COHORT} 名学生；均分背后，是一整段成绩分布。</p>
                <p className={styles.finding}>D 的四分位跨度 22 分，是 A 的近两倍；最低分只有 38。</p>
                <Readout chapter="02" active={active} />
              </div>
              <BoxChart selection={selection} progress={spread} />
            </section>
          </div>
          <div ref={stageChange}>
            <Junction id="change" kind="solid" label="Same metric · 均分 / 分">
              指标不变，刻度放大：0–100 → 70–90
            </Junction>
            <section id="change" className={`${styles.chapter} ${styles.chapter03}`} aria-labelledby="change-title">
              <ChangeChart selection={selection} progress={change} />
              <div className={styles.text}>
                <p className={styles.mono}>03 / Change · 上学期 → 本学期</p>
                <h2 id="change-title">差异，沿时间展开。</h2>
                <p className={styles.sub}>每条线带着本学期均分落下，再回看上学期。</p>
                <p className={styles.finding}>A、C 各上升 3 分；B、D 有所回落。</p>
                <Readout chapter="03" active={active} />
              </div>
            </section>
          </div>
          <div ref={stageRhythm}>
            <Junction id="rhythm" kind="break" label="New metric · 每周学习活动">
              换了指标：从成绩换成每周学习活动（小时）。线接到同一门课那一行。
            </Junction>
            <section id="rhythm" className={`${styles.chapter} ${styles.chapter04}`} aria-labelledby="rhythm-title">
              <div className={styles.text}>
                <p className={styles.mono}>04 / Rhythm · 第 1–12 周</p>
                <h2 id="rhythm-title">变化之下，是学习的节奏。</h2>
                <p className={styles.sub}>每门课每周的人均学习活动，颜色越深，小时越多。</p>
                <p className={styles.finding}>C 从每周 3 小时一路升到 11 小时；D 从 7 小时降到 3 小时。</p>
                <Readout chapter="04" active={active} />
              </div>
              <HeatChart selection={selection} progress={rhythm} />
            </section>
          </div>
          <div ref={stageRelation}>
            <Junction id="relation" kind="break" label="New unit · 活动量 × 成绩">
              换了统计对象：不再按课程，按活动量分档统计选课人次。四条线在此汇合。
            </Junction>
            <section id="relation" className={`${styles.chapter} ${styles.chapter05}`} aria-labelledby="relation-title">
              <ScatterChart progress={relation} tier={tier} onTier={setTier} />
              <div className={styles.text}>
                <p className={styles.mono}>05 / Relation · 活动档 × 成绩区间</p>
                <h2 id="relation-title">活动量和成绩，一起看。</h2>
                <p className={styles.sub}>四门课的全部选课人次，按每周学习活动分三档，再按成绩分四段。</p>
                <p className={styles.finding}>低活动档里，低于 70 分的有 52 人次，是这一档最大的一组。</p>
                <Readout chapter="05" active={active} tier={tier} />
              </div>
            </section>
          </div>
          <div ref={stageOverview}>
            <Junction id="overview" kind="break" label="New metric · 共同低于 70 分">
              换了指标：两门课都低于 70 分的人数。
            </Junction>
            <section id="overview" className={`${styles.chapter} ${styles.chapter06}`} aria-labelledby="overview-title">
              <div className={styles.text}>
                <p className={styles.mono}>06 / Overview · 课程两两之间</p>
                <h2 id="overview-title">回到全貌：谁在一起掉队。</h2>
                <p className={styles.sub}>弦越粗，两门课都低于 70 分的同一批学生越多。</p>
                <p className={styles.finding}>C 与 D 共有 18 人两门都低于 70 分，是六组里最多的。</p>
                <Readout chapter="06" active={active} pair={pair} />
              </div>
              <ChordChart
                selection={selection}
                progress={overview}
                pair={pair}
                onPair={(id) => {
                  setPair(id);
                  if (id) setPinned(null);
                }}
              />
            </section>
          </div>
          <LinkLayer geometry={geometry} progress={{ spread, change, rhythm, relation, overview }} active={active} />
        </div>
        <section className={styles.cta} aria-labelledby="cta-title">
          <h2 id="cta-title">这些发现，可以从你的一句话开始。</h2>
          <a className={styles.ctaButton} href="/">
            开始探索你的问题
          </a>
        </section>
        <footer className={styles.footer}>
          <p className={styles.mono}>Preview · 01—06</p>
          <p>固定演示数据。连线表示阅读路径，不表示统计推导。</p>
        </footer>
      </main>
    </div>
  );
}
