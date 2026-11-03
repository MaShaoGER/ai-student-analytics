"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import { anchorId } from "./geometry";
import { linkWindow } from "./reveal";
import { courseFocus, courseHover, courseState, type Selection } from "./selection";
import { COURSES, SCORE_TICKS, SPREAD, type Course } from "./story-data";
import styles from "./story.module.css";

function BoxRow({ course, index, selection, progress }: {
  course: Course;
  index: number;
  selection: Selection;
  progress: MotionValue<number>;
}) {
  const landed = linkWindow(index)[1];
  // The mean ■ lands where the 01 bar ended; only then does the spread open around it.
  const meanOpacity = useTransform(progress, [landed - 0.001, landed], [0, 1]);
  const open = useTransform(progress, [landed, landed + 0.1], [0, 1]);
  const { min, q1, median, q3, max } = SPREAD[course.key];
  return (
    <button
      type="button"
      className={styles.row}
      data-state={courseState(selection.active, course.key)}
      data-lead={course.key === "D" || undefined}
      aria-pressed={selection.pinned === course.key}
      aria-label={`${course.name}，最低 ${min}，下四分位 ${q1}，中位数 ${median}，上四分位 ${q3}，最高 ${max}，均分 ${course.now} 分`}
      {...courseHover(selection, course.key)}
      {...courseFocus(selection, course.key)}
    >
      <span className={styles.rowLabel}>{course.name}</span>
      <span className={styles.track}>
        <motion.span
          className={styles.whisker}
          style={{ left: `${min}%`, width: `${max - min}%`, scaleX: open, originX: (course.now - min) / (max - min) }}
        />
        <motion.span
          className={styles.box}
          style={{ left: `${q1}%`, width: `${q3 - q1}%`, scaleX: open, originX: (course.now - q1) / (q3 - q1) }}
        />
        <motion.span className={styles.median} style={{ left: `${median}%`, opacity: open }} />
        <motion.span
          className={styles.meanMark}
          style={{ left: `${course.now}%`, opacity: meanOpacity }}
          data-anchor={anchorId.boxMean(course.key)}
        />
      </span>
    </button>
  );
}

/** Ten-by-four dot grid: each dot is "2.5% of a course", never one student. */
function QuartileKey() {
  return (
    <div className={styles.quartileKey}>
      <svg viewBox="0 0 76 28" width="76" height="28" aria-hidden="true">
        {Array.from({ length: 40 }, (_, i) => {
          const col = i % 10;
          const row = Math.floor(i / 10);
          return (
            <rect
              key={i}
              x={col * 8}
              y={row * 7}
              width={4}
              height={4}
              className={col >= 2.5 && col < 7.5 ? styles.quartileIn : styles.quartileOut}
            />
          );
        })}
      </svg>
      <p>
        框内是中间 50% 的成绩，竖线是中位数，须线到最高和最低。<span>示意，非学生个体</span>
      </p>
    </div>
  );
}

/** 02: the same 0–100 scale as 01; the bar's end becomes the mean ■ inside each course's spread. */
export function BoxChart({ selection, progress }: { selection: Selection; progress: MotionValue<number> }) {
  return (
    <figure className={`${styles.figure} ${styles.figureBox}`}>
      <div className={styles.plot}>
        <div className={styles.gridLines} data-anchor={anchorId.boxTrack} aria-hidden="true">
          {SCORE_TICKS.map((tick) => (
            <span key={tick} style={{ left: `${tick}%` }} />
          ))}
        </div>
        {COURSES.map((course, index) => (
          <BoxRow key={course.key} course={course} index={index} selection={selection} progress={progress} />
        ))}
        <div className={styles.axis} aria-hidden="true">
          {SCORE_TICKS.map((tick) => (
            <span key={tick} style={{ left: `${tick}%` }}>
              {tick}
            </span>
          ))}
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.keyNow} aria-hidden="true" /> 均分 · 与 01 同一数值 · 刻度 0–100 分
      </figcaption>
      <QuartileKey />
    </figure>
  );
}
