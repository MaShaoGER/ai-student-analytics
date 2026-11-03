"use client";

import { useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useRef, type RefObject } from "react";
import { anchorId } from "./geometry";
import styles from "./story.module.css";

const PALETTE = { violet: "#7962BC", lime: "#CBEF8B", ink: "#20231F", mist: "#F8FAF5" } as const;
const PITCH = 12;
const SIDE = 9;
/** Decorative data blocks: a dense core that thins out to the right. Not a chart; no unit. */
const PIXELS = Array.from({ length: 84 }, (_, i) => {
  const col = i % 14;
  const row = Math.floor(i / 14);
  const keep = (i * 37 + row * 11) % 17 > col + 2;
  const tone = (i * 7) % 11;
  const fill = tone < 2 ? PALETTE.violet : tone < 6 ? PALETTE.lime : tone < 7 ? PALETTE.ink : PALETTE.mist;
  return { col, row, keep, fill };
}).filter((pixel) => pixel.keep);
/** Twelve coloured blocks drift into a column at the start of 01's bars; the rest stay put. */
const FLOW = PIXELS.map((pixel, index) => ({ ...pixel, index }))
  .filter((pixel) => pixel.fill === PALETTE.violet || pixel.fill === PALETTE.lime)
  .slice(0, 12)
  .sort((a, b) => a.row - b.row || a.col - b.col);
const FLOW_ORDER = new Map(FLOW.map((pixel, order) => [pixel.index, order]));

const REACH = 80;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Hero decoration, aria-hidden. Three reactions, none on a loop:
 * pointer proximity lights nearby blocks, a tap sends a ripple, and scrolling past the hero
 * walks twelve blocks to 01's track start. `still` binds nothing and renders the static field.
 */
export function HeroPixels({ area, still }: { area: RefObject<HTMLElement | null>; still: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const flowRefs = useRef<(SVGGElement | null)[]>([]);
  const rectRefs = useRef<(SVGRectElement | null)[]>([]);
  const { scrollYProgress } = useScroll({ target: area, offset: ["start start", "end start"] });

  const paintFlow = (progress: number) => {
    const svg = svgRef.current;
    const track = document.querySelector<HTMLElement>(`[data-anchor="${anchorId.track}"]`);
    if (!svg || !track) return;
    const box = svg.getBoundingClientRect();
    const target = track.getBoundingClientRect();
    const scale = box.width / (14 * PITCH);
    const slot = target.height / FLOW.length;
    // Both rects are viewport-relative, so their difference holds at any scroll position.
    FLOW.forEach((pixel, order) => {
      const g = flowRefs.current[pixel.index];
      if (!g) return;
      const t = ease(clamp01((progress - order * 0.025) / 0.6));
      const fromX = box.left + (pixel.col * PITCH + SIDE / 2) * scale;
      const fromY = box.top + (pixel.row * PITCH + SIDE / 2) * scale;
      const dx = (target.left - fromX) / scale;
      const dy = (target.top + (order + 0.5) * slot - fromY) / scale;
      const shrink = 1 - t * (1 - Math.min(1, (slot * 0.6) / (SIDE * scale)));
      g.style.transform = t === 0 ? "" : `translate(${dx * t}px, ${dy * t}px) scale(${shrink})`;
      g.style.opacity = String(1 - clamp01((progress - 0.82) / 0.18));
    });
  };

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    if (!still) paintFlow(value);
  });

  useEffect(() => {
    const host = area.current;
    const svg = svgRef.current;
    const glow = glowRef.current;
    const resetAll = () => {
      for (const g of flowRefs.current) if (g) g.style.cssText = "";
      for (const rect of rectRefs.current) if (rect) rect.style.transform = "";
      if (glow) glow.style.transform = "";
    };
    if (still || !host || !svg) {
      resetAll();
      return;
    }
    paintFlow(scrollYProgress.get());

    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const paintPointer = () => {
      frame = 0;
      const box = svg.getBoundingClientRect();
      const scale = box.width / (14 * PITCH);
      PIXELS.forEach((pixel, index) => {
        const rect = rectRefs.current[index];
        if (!rect) return;
        if (!pointer) {
          rect.style.transform = "";
          rect.style.opacity = "";
          return;
        }
        const cx = box.left + (pixel.col * PITCH + SIDE / 2) * scale;
        const cy = box.top + (pixel.row * PITCH + SIDE / 2) * scale;
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        const distance = Math.hypot(dx, dy);
        const near = clamp01(1 - distance / REACH);
        if (near === 0) {
          rect.style.transform = "";
          rect.style.opacity = "";
          return;
        }
        // Lean 1–2 CSS px toward the pointer; the CSS transition springs it back on leave.
        const lean = (1 + near) / scale / Math.max(distance, 1);
        rect.style.transform = `translate(${dx * lean}px, ${dy * lean}px) scale(${1 + near * 0.18})`;
        rect.style.opacity = String(0.72 + near * 0.28);
      });
      if (glow) {
        const hostBox = host.getBoundingClientRect();
        const gx = pointer ? (pointer.x - hostBox.left - hostBox.width * 0.7) * 0.04 : 0;
        const gy = pointer ? (pointer.y - hostBox.top - hostBox.height * 0.4) * 0.04 : 0;
        const limit = (value: number) => Math.max(-20, Math.min(20, value));
        glow.style.transform = pointer ? `translate(${limit(gx)}px, ${limit(gy)}px)` : "";
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paintPointer);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };
    const onDown = (event: PointerEvent) => {
      const box = svg.getBoundingClientRect();
      if (event.clientX < box.left - REACH || event.clientX > box.right + REACH) return;
      if (event.clientY < box.top - REACH || event.clientY > box.bottom + REACH) return;
      const scale = box.width / (14 * PITCH);
      PIXELS.forEach((pixel, index) => {
        const rect = rectRefs.current[index];
        if (!rect) return;
        const cx = box.left + (pixel.col * PITCH + SIDE / 2) * scale;
        const cy = box.top + (pixel.row * PITCH + SIDE / 2) * scale;
        const delay = Math.hypot(event.clientX - cx, event.clientY - cy) * 1.4;
        rect.animate(
          [{ fill: pixel.fill }, { fill: PALETTE.violet }, { fill: PALETTE.lime }, { fill: "#FFFFFF" }, { fill: pixel.fill }],
          { duration: 600, delay, easing: "ease-out" },
        );
      });
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointerdown", onDown);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
      cancelAnimationFrame(frame);
      resetAll();
    };
    // paintFlow only reads refs and the DOM; rebinding on `still` is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, area, scrollYProgress]);

  return (
    <>
      <div ref={glowRef} className={styles.heroGlow} aria-hidden="true" />
      <svg ref={svgRef} className={styles.pixels} viewBox="0 0 168 72" aria-hidden="true" focusable="false">
        {PIXELS.map((pixel, index) => (
          <g
            key={`${pixel.col}-${pixel.row}`}
            ref={(node) => {
              flowRefs.current[index] = node;
            }}
            className={FLOW_ORDER.has(index) ? styles.pixelFlow : undefined}
          >
            <rect
              ref={(node) => {
                rectRefs.current[index] = node;
              }}
              className={styles.pixel}
              x={pixel.col * PITCH}
              y={pixel.row * PITCH}
              width={SIDE}
              height={SIDE}
              style={{ fill: pixel.fill }}
            />
          </g>
        ))}
      </svg>
    </>
  );
}
