"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import { useState } from "react";
import { anchorId } from "./geometry";
import { linkWindow } from "./reveal";
import { courseFocus, courseHover, courseState, type Selection } from "./selection";
import { ACTIVITY, COURSES, HEAT_BANDS, WEEKS, heatBand, type Course } from "./story-data";
import styles from "./story.module.css";

const WEEK_LIST = Array.from({ length: WEEKS }, (_, i) => i + 1);

function HeatRow({ course, index, selection, progress, week, onWeek }: {
  course: Course;
  index: number;
  selection: Selection;
  progress: MotionValue<number>;
  week: number | null;
  onWeek: (week: number | null) => void;
}) {
  const landed = linkWindow(index)[1];
  // The row fills week by week, left to right, once its line has arrived at the row's gate.
  const clip = useTransform(progress, [landed, landed + 0.1], ["inset(0 100% 0 0)", "inset(0 0% 0 0)"]);
  const hours = ACTIVITY[course.key];
  return (
    <div className={styles.heatRow} data-state={courseState(selection.active, course.key)} data-lead={course.key === "C" || undefined}>
      <span className={styles.edgeAnchor} style={{ left: 0 }} data-anchor={anchorId.heatEntry(course.key)} />
      <button
        type="button"
        className={styles.heatLabel}
        aria-pressed={selection.pinned === course.key}
        aria-label={`${course.name}，每周学习活动 ${hours.join("、")} 小时`}
        {...courseHover(selection, course.key)}
        {...courseFocus(selection, course.key)}
      >
        {course.name}
      </button>
      <motion.span className={styles.heatCells} style={{ clipPath: clip }} onPointerLeave={() => onWeek(null)}>
        {hours.map((value, i) => (
          <span
            key={i}
            className={styles.heatCell}
            data-band={heatBand(value)}
            data-week={week === i + 1 || undefined}
            onPointerEnter={(event) => event.pointerType !== "touch" && onWeek(i + 1)}
          />
        ))}
      </motion.span>
      <span className={styles.edgeAnchor} style={{ right: 0 }} data-anchor={anchorId.heatExit(course.key)} />
    </div>
  );
}

/** 04: a new metric, hours of study activity per week; one row per course, one column per week. */
export function HeatChart({ selection, progress }: { selection: Selection; progress: MotionValue<number> }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const week = hovered ?? pinned;
  return (
    <figure className={`${styles.figure} ${styles.figureHeat}`}>
      <div className={styles.heatWeeks} role="group" aria-label="按周查看">
        {WEEK_LIST.map((w) => (
          <button
            key={w}
            type="button"
            className={styles.weekKey}
            data-week={week === w || undefined}
            aria-pressed={pinned === w}
            aria-label={`第 ${w} 周`}
            onClick={() => setPinned((current) => (current === w ? null : w))}
            onPointerEnter={(event) => event.pointerType !== "touch" && setHovered(w)}
            onPointerLeave={() => setHovered(null)}
          >
            {w}
          </button>
        ))}
      </div>
      {COURSES.map((course, index) => (
        <HeatRow
          key={course.key}
          course={course}
          index={index}
          selection={selection}
          progress={progress}
          week={week}
          onWeek={setHovered}
        />
      ))}
      <p className={styles.weekReadout} aria-live="polite">
        {week === null ? (
          <span>悬停或点击周次，查看这一周四门课的读数。</span>
        ) : (
          <>
            <b>第 {week} 周</b>
            {COURSES.map((course) => (
              <span key={course.key} data-state={courseState(selection.active, course.key)}>
                {course.key} <strong>{ACTIVITY[course.key][week - 1]}</strong>
              </span>
            ))}
            <span>小时</span>
          </>
        )}
      </p>
      <figcaption className={styles.caption}>
        <span className={styles.heatLegend} aria-hidden="true">
          {HEAT_BANDS.map((band, i) => (
            <span key={band.label}>
              <i data-band={i} />
              {band.label}
            </span>
          ))}
        </span>
        人均学习活动 · 小时 / 周 · 第 1–12 周
      </figcaption>
    </figure>
  );
}
