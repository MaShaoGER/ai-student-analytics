"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import { anchorId } from "./geometry";
import { linkWindow } from "./reveal";
import { courseFocus, courseHover, courseState, type Selection } from "./selection";
import { CHANGE_TICKS, COURSES, changePct, signed, type Course } from "./story-data";
import styles from "./story.module.css";

function ChangeRow({ course, index, selection, progress }: {
  course: Course;
  index: number;
  selection: Selection;
  progress: MotionValue<number>;
}) {
  const landed = linkWindow(index)[1];
  // ■ appears the moment its link lands, then the segment opens back toward last term's ○.
  const nowOpacity = useTransform(progress, [landed - 0.001, landed], [0, 1]);
  const open = useTransform(progress, [landed, landed + 0.1], [0, 1]);
  const now = changePct(course.now);
  const prev = changePct(course.prev);
  const delta = course.now - course.prev;
  return (
    <button
      type="button"
      className={styles.row}
      data-state={courseState(selection.active, course.key)}
      data-lead={course.key === "D" || undefined}
      aria-pressed={selection.pinned === course.key}
      aria-label={`${course.name}，上学期 ${course.prev} 分，本学期 ${course.now} 分，变化 ${signed(delta)} 分`}
      {...courseHover(selection, course.key)}
      {...courseFocus(selection, course.key)}
    >
      <span className={styles.rowLabel}>{course.name}</span>
      <span className={styles.track}>
        <motion.span
          className={styles.segment}
          style={{
            left: `${Math.min(now, prev)}%`,
            width: `${Math.abs(now - prev)}%`,
            originX: prev < now ? 1 : 0,
            scaleX: open,
          }}
        />
        <motion.span className={styles.prevMark} style={{ left: `${prev}%`, opacity: open }} />
        <motion.span
          className={styles.nowMark}
          style={{ left: `${now}%`, opacity: nowOpacity }}
          data-anchor={anchorId.nowMark(course.key)}
        />
      </span>
      <motion.span className={styles.delta} style={{ opacity: open }}>
        {signed(delta)}
      </motion.span>
      <span className={styles.edgeAnchor} style={{ right: 0 }} data-anchor={anchorId.changeExit(course.key)} />
    </button>
  );
}

/** 03: last term ○ to this term ■ on a 70–90 band; ■ is the same mean the 02 ■ carries down. */
export function ChangeChart({ selection, progress }: { selection: Selection; progress: MotionValue<number> }) {
  return (
    <figure className={`${styles.figure} ${styles.figure02}`}>
      <div className={styles.plot}>
        <div className={styles.gridLines} aria-hidden="true">
          {CHANGE_TICKS.map((tick) => (
            <span key={tick} style={{ left: `${changePct(tick)}%` }} />
          ))}
        </div>
        <span className={styles.deltaHead} aria-hidden="true">
          Δ 分
        </span>
        {COURSES.map((course, index) => (
          <ChangeRow key={course.key} course={course} index={index} selection={selection} progress={progress} />
        ))}
        <div className={styles.axis} aria-hidden="true">
          {CHANGE_TICKS.map((tick) => (
            <span key={tick} style={{ left: `${changePct(tick)}%` }}>
              {tick}
            </span>
          ))}
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.keyPrev} aria-hidden="true" /> 上学期
        <span className={styles.keyNow} aria-hidden="true" /> 本学期 · 与 01、02 同一数值 · 刻度 70–90 分
      </figcaption>
    </figure>
  );
}
