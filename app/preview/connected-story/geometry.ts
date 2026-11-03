"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { COURSES, type CourseKey } from "./story-data";

type Point = [number, number];
export type Link = { key: CourseKey; d: string };

/** The five hand-offs between the six charts; each is named after the chapter it leads into. */
export type SegmentId = "spread" | "change" | "rhythm" | "relation" | "overview";
/** `solid`: same course, same value carried on. `break`: the metric or the counted unit changes. */
export type SegmentKind = "solid" | "break";
export type Segment = { id: SegmentId; kind: SegmentKind; links: Link[] };
export type Geometry = { width: number; height: number; segments: Segment[] };

/** Layout-only anchors the charts render; the link layer measures them, never the marks' styles. */
export const anchorId = {
  barEnd: (key: CourseKey) => `bar-${key}`,
  boxMean: (key: CourseKey) => `mean-${key}`,
  nowMark: (key: CourseKey) => `now-${key}`,
  changeExit: (key: CourseKey) => `change-exit-${key}`,
  heatEntry: (key: CourseKey) => `heat-${key}`,
  heatExit: (key: CourseKey) => `heat-exit-${key}`,
  mixMerge: "mix-merge",
  mixSplit: "mix-split",
  pairEntry: (key: CourseKey) => `pair-${key}`,
  track: "track-01",
  boxTrack: "track-02",
  junction: (id: SegmentId) => `junction-${id}`,
} as const;

type Spec = {
  id: SegmentId;
  kind: SegmentKind;
  from: (key: CourseKey) => string;
  to: (key: CourseKey) => string;
  /** `right`: leave sideways into a lane beside the chart. `down`: drop straight from the start. */
  exit: "right" | "down";
  /** `top`: land on the mark from above. `left`: come in level from a gate left of the row. */
  entry: "top" | "left";
  /** Lanes start past this anchor's right edge; without one, past the rightmost start. */
  track?: string;
};

const SPECS: readonly Spec[] = [
  // 01 and 02 share the 0–100 scale and the same column, so each bar end drops straight onto its mean ■.
  { id: "spread", kind: "solid", from: anchorId.barEnd, to: anchorId.boxMean, exit: "down", entry: "top" },
  { id: "change", kind: "solid", from: anchorId.boxMean, to: anchorId.nowMark, exit: "right", entry: "top", track: anchorId.boxTrack },
  { id: "rhythm", kind: "break", from: anchorId.changeExit, to: anchorId.heatEntry, exit: "right", entry: "left" },
  // 05 counts enrolments by activity tier, not by course: the four lines merge into one point…
  { id: "relation", kind: "break", from: anchorId.heatExit, to: () => anchorId.mixMerge, exit: "right", entry: "top" },
  // …and 06 restarts them from a single split point, so no line runs out of a 05 cell.
  { id: "overview", kind: "break", from: () => anchorId.mixSplit, to: anchorId.pairEntry, exit: "down", entry: "left" },
];

const round = (value: number) => Math.round(value * 10) / 10;

/** Polyline with every interior corner replaced by a quadratic curve of at most `radius`. */
function roundedPath(points: Point[], radius: number) {
  const [first] = points;
  let d = `M ${round(first[0])} ${round(first[1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const inLen = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const outLen = Math.hypot(n[0] - c[0], n[1] - c[1]);
    if (inLen === 0 || outLen === 0) continue;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a: Point = [c[0] - ((c[0] - p[0]) / inLen) * r, c[1] - ((c[1] - p[1]) / inLen) * r];
    const b: Point = [c[0] + ((n[0] - c[0]) / outLen) * r, c[1] + ((n[1] - c[1]) / outLen) * r];
    d += ` L ${round(a[0])} ${round(a[1])} Q ${round(c[0])} ${round(c[1])} ${round(b[0])} ${round(b[1])}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${round(last[0])} ${round(last[1])}`;
}

/**
 * Measures every anchor relative to `root` and routes one line per course per hand-off.
 * Lanes, turns and gates are ranked so that the four lines of a segment never cross:
 * when a segment runs leftward course A takes the lowest turn, rightward the highest.
 */
export function useLinkGeometry(root: RefObject<HTMLElement | null>) {
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const box = node.getBoundingClientRect();
      const rect = (id: string) => node.querySelector(`[data-anchor="${id}"]`)?.getBoundingClientRect();
      const center = (r: DOMRect): Point => [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
      const narrow = box.width < 720;
      const [laneBase, laneStep, turnBase, turnStep, gateBase, gateStep] = narrow
        ? [14, 8, 20, 12, 10, 8]
        : [24, 12, 36, 18, 16, 12];
      const radius = narrow ? 6 : 10;

      const segments: Segment[] = [];
      for (const spec of SPECS) {
        const starts = COURSES.map((course) => rect(spec.from(course.key)));
        const ends = COURSES.map((course) => rect(spec.to(course.key)));
        const junction = rect(anchorId.junction(spec.id));
        const track = spec.track ? rect(spec.track) : undefined;
        if (!junction || (spec.track && !track) || starts.some((r) => !r) || ends.some((r) => !r)) continue;
        const s = starts.map((r) => center(r!));
        const e = ends.map((r) => center(r!));
        const laneOrigin = track ? track.right - box.left : Math.max(...s.map((p) => p[0]));
        const exitX = (i: number) => (spec.exit === "right" ? laneOrigin + laneBase + laneStep * (3 - i) : s[i][0]);
        const entryX = (i: number) => (spec.entry === "left" ? e[i][0] - gateBase - gateStep * i : e[i][0]);
        const leftward = entryX(0) < exitX(0);
        const turnTop = junction.top - box.top;

        const links = COURSES.map((course, i): Link => {
          const turn = turnTop + turnBase + turnStep * (leftward ? 3 - i : i);
          const x = exitX(i);
          const gate = entryX(i);
          const points: Point[] = [s[i]];
          if (spec.exit === "right") points.push([x, s[i][1]]);
          points.push([x, turn]);
          if (spec.entry === "left") points.push([gate, turn], [gate, e[i][1]]);
          else points.push([gate, turn]);
          points.push(e[i]);
          return { key: course.key, d: roundedPath(points, radius) };
        });
        segments.push({ id: spec.id, kind: spec.kind, links });
      }
      setGeometry({ width: box.width, height: box.height, segments });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);

  return geometry;
}
