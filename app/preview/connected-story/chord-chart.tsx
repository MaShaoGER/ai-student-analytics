"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import type { KeyboardEvent } from "react";
import { anchorId } from "./geometry";
import { courseFocus, courseHover, courseState, type Selection } from "./selection";
import { BELOW_70, COURSES, PAIRS, type CourseKey, type Pair } from "./story-data";
import styles from "./story.module.css";

const CENTER = 120;
const RADIUS = 92;
const ANGLE: Record<CourseKey, number> = { A: -90, B: 0, C: 90, D: 180 };
const node = (key: CourseKey) => {
  const rad = (ANGLE[key] * Math.PI) / 180;
  return { x: CENTER + RADIUS * Math.cos(rad), y: CENTER + RADIUS * Math.sin(rad) };
};
/** Bends each chord through a point near the centre so opposite and adjacent pairs read alike. */
const chordPath = ({ a, b }: Pair) => {
  const p = node(a);
  const q = node(b);
  const cx = CENTER + ((p.x + q.x) / 2 - CENTER) * 0.2;
  const cy = CENTER + ((p.y + q.y) / 2 - CENTER) * 0.2;
  return `M${p.x} ${p.y}Q${cx} ${cy} ${q.x} ${q.y}`;
};
const LEAD = "CD";
const pairLabel = ({ a, b, count }: Pair) => `课程 ${a} 与课程 ${b}：${count} 人两门都低于 70 分`;

function pairState(pair: Pair, selectedPair: string | null, active: CourseKey | null) {
  if (selectedPair) return pair.id === selectedPair ? "on" : "off";
  if (active) return pair.a === active || pair.b === active ? "on" : "off";
  return "idle";
}

function Chord({ pair, progress, state, pressed, onPair }: {
  pair: Pair;
  progress: MotionValue<number>;
  state: string;
  pressed: boolean;
  onPair: (id: string) => void;
}) {
  const lead = pair.id === LEAD;
  // The C–D chord lands first; the other pairs follow as context.
  const drawn = useTransform(progress, lead ? [0.6, 0.75] : [0.75, 0.9], [0, 1]);
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPair(pair.id);
  };
  return (
    <g
      className={styles.chord}
      data-state={state}
      data-lead={lead || undefined}
      role="button"
      tabIndex={0}
      aria-pressed={pressed}
      aria-label={pairLabel(pair)}
      onClick={() => onPair(pair.id)}
      onKeyDown={onKeyDown}
    >
      {/* Wide transparent stroke keeps thin chords easy to hit. */}
      <path className={styles.chordHit} d={chordPath(pair)} />
      <motion.path
        className={styles.chordLine}
        d={chordPath(pair)}
        style={{ pathLength: drawn, strokeWidth: 1 + pair.count / 3 }}
      />
    </g>
  );
}

/** 06: how many of the same students fall below 70 in both courses of each pair. */
export function ChordChart({ selection, progress, pair, onPair }: {
  selection: Selection;
  progress: MotionValue<number>;
  pair: string | null;
  onPair: (id: string | null) => void;
}) {
  const nodesShown = useTransform(progress, [0.5, 0.6], [0, 1]);
  const toggle = (id: string) => onPair(pair === id ? null : id);
  return (
    <figure className={`${styles.figure} ${styles.figureChord}`}>
      <div className={styles.chordBody}>
        <div className={styles.chordNodes}>
          {COURSES.map((course) => (
            <button
              key={course.key}
              type="button"
              className={styles.chordNode}
              data-state={courseState(selection.active, course.key)}
              aria-pressed={selection.pinned === course.key}
              aria-label={`${course.name}：${BELOW_70[course.key]} 人低于 70 分`}
              {...courseHover(selection, course.key)}
              {...courseFocus(selection, course.key)}
            >
              <span className={styles.edgeAnchor} style={{ left: 0 }} data-anchor={anchorId.pairEntry(course.key)} />
              <span className={styles.chordNodeName}>{course.name}</span>
              <span className={styles.chordNodeValue}>
                <strong>{BELOW_70[course.key]}</strong> 人 &lt;70
              </span>
            </button>
          ))}
        </div>
        <svg className={styles.chordSvg} viewBox="0 0 240 240" role="group" aria-label="课程两两之间共同低于 70 分的人数">
          <circle className={styles.chordRing} cx={CENTER} cy={CENTER} r={RADIUS} />
          {PAIRS.map((item) => (
            <Chord
              key={item.id}
              pair={item}
              progress={progress}
              state={pairState(item, pair, selection.active)}
              pressed={pair === item.id}
              onPair={toggle}
            />
          ))}
          <motion.g style={{ opacity: nodesShown }} aria-hidden="true">
            {COURSES.map((course) => {
              const { x, y } = node(course.key);
              return (
                <g key={course.key} className={styles.chordPoint} data-state={courseState(selection.active, course.key)}>
                  <rect x={x - 7} y={y - 7} width={14} height={14} />
                  <text x={x} y={y + 4}>
                    {course.key}
                  </text>
                </g>
              );
            })}
          </motion.g>
        </svg>
      </div>
      <figcaption className={styles.caption}>
        弦的粗细 = 两门课都低于 70 分的同一批学生人数 · 非因果 · 点击弦线查看
      </figcaption>
    </figure>
  );
}
