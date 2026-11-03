"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import { anchorId } from "./geometry";
import { barWindow } from "./reveal";
import { courseFocus, courseHover, courseState, type Selection } from "./selection";
import { COURSES, SCORE_TICKS, type Course } from "./story-data";
import styles from "./story.module.css";

function CompareRow({ course, index, selection, progress }: {
  course: Course;
  index: number;
  selection: Selection;
  progress: MotionValue<number>;
}) {
  const grow = useTransform(progress, barWindow(index), [0, 1]);
  const valueOpacity = useTransform(grow, [0.75, 1], [0, 1]);
  return (
    <button
      type="button"
      className={styles.row}
      data-state={courseState(selection.active, course.key)}
      data-lead={course.key === "A" || undefined}
      aria-pressed={selection.pinned === course.key}
      aria-label={`${course.name}，本学期均分 ${course.now} 分`}
      {...courseHover(selection, course.key)}
      {...courseFocus(selection, course.key)}
    >
      <span className={styles.rowLabel}>{course.name}</span>
      <span className={styles.track}>
        <motion.span className={styles.bar} style={{ width: `${course.now}%`, scaleX: grow }} />
        <motion.span className={styles.barValue} style={{ right: `${100 - course.now}%`, opacity: valueOpacity }}>
          {course.now}
        </motion.span>
        {/* Layout-only anchor: the bar scales, the anchor never moves, so links measure the final end. */}
        <span className={styles.anchor} style={{ left: `${course.now}%` }} data-anchor={anchorId.barEnd(course.key)} />
      </span>
    </button>
  );
}

/** 01: this term's mean per course on the full 0–100 scale. Course A leads in violet. */
export function CompareChart({ selection, progress }: { selection: Selection; progress: MotionValue<number> }) {
  return (
    <figure className={`${styles.figure} ${styles.figure01}`}>
      <div className={styles.plot}>
        <div className={styles.gridLines} data-anchor={anchorId.track} aria-hidden="true">
          {SCORE_TICKS.map((tick) => (
            <span key={tick} style={{ left: `${tick}%` }} />
          ))}
        </div>
        {COURSES.map((course, index) => (
          <CompareRow key={course.key} course={course} index={index} selection={selection} progress={progress} />
        ))}
        <div className={styles.axis} aria-hidden="true">
          {SCORE_TICKS.map((tick) => (
            <span key={tick} style={{ left: `${tick}%` }}>
              {tick}
            </span>
          ))}
        </div>
      </div>
      <figcaption className={styles.caption}>均分 / 分 · 每门课约 120 人 · 满分 100</figcaption>
    </figure>
  );
}
