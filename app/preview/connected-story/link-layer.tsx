"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import { useId, useRef } from "react";
import type { Geometry, Link, SegmentId, SegmentKind } from "./geometry";
import { linkWindow } from "./reveal";
import { courseState } from "./selection";
import type { CourseKey } from "./story-data";
import styles from "./story.module.css";

const HEAD = 10;

function LinkPath({ link, index, kind, progress, active, size }: {
  link: Link;
  index: number;
  kind: SegmentKind;
  progress: MotionValue<number>;
  active: CourseKey | null;
  size: { width: number; height: number };
}) {
  const ref = useRef<SVGPathElement>(null);
  const maskId = useId();
  const drawn = useTransform(progress, linkWindow(index), [0, 1]);
  const headOpacity = useTransform(drawn, [0, 0.02, 0.97, 1], [0, 1, 1, 0]);
  const headX = useTransform(drawn, (v) => {
    const path = ref.current;
    return path ? path.getPointAtLength(v * path.getTotalLength()).x - HEAD / 2 : 0;
  });
  const headY = useTransform(drawn, (v) => {
    const path = ref.current;
    return path ? path.getPointAtLength(v * path.getTotalLength()).y - HEAD / 2 : 0;
  });
  return (
    <g className={styles.link} data-kind={kind} data-state={courseState(active, link.key)}>
      {kind === "solid" ? (
        <motion.path ref={ref} d={link.d} style={{ pathLength: drawn }} />
      ) : (
        <>
          {/* pathLength would replace the dashes, so a break line draws through a solid mask. */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={size.width} height={size.height}>
            <motion.path d={link.d} style={{ pathLength: drawn, stroke: "#fff", strokeWidth: 6 }} />
          </mask>
          <path ref={ref} d={link.d} mask={`url(#${maskId})`} />
        </>
      )}
      <motion.rect width={HEAD} height={HEAD} style={{ x: headX, y: headY, opacity: headOpacity }} />
    </g>
  );
}

/** One overlay over the whole story; each hand-off draws on its own chapter's scroll progress. */
export function LinkLayer({ geometry, progress, active }: {
  geometry: Geometry | null;
  progress: Record<SegmentId, MotionValue<number>>;
  active: CourseKey | null;
}) {
  if (!geometry) return null;
  return (
    <svg
      className={styles.links}
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      aria-hidden="true"
    >
      {geometry.segments.map((segment) => (
        <g key={segment.id} data-segment={segment.id}>
          {segment.links.map((link, index) => (
            <LinkPath
              key={link.key}
              link={link}
              index={index}
              size={geometry}
              kind={segment.kind}
              progress={progress[segment.id]}
              active={active}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
