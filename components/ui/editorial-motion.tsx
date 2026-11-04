"use client";

/**
 * Editorial entrance primitives shared by the explorer poster and the home
 * narrative. Every primitive renders its final, readable value on the server
 * and for assistive technology; motion only decorates the visible copy and
 * is skipped when the app switch or the system asks for reduced motion.
 */
import { animate, useInView } from "motion/react";
import { useLayoutEffect, useRef, type ElementType, type ReactNode } from "react";
import { useMotionPreferences } from "./motion-preferences";
import styles from "./editorial-motion.module.css";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Counts once per value after it enters view. The final value remains available
 * to assistive technology and print; motion preferences never defer the data.
 */
export function CountUp({ value, format, duration = 0.8, whenVisible = false, className }: {
  value: number;
  format: (value: number) => string;
  duration?: number;
  whenVisible?: boolean;
  className?: string;
}) {
  const { enabled, reduced } = useMotionPreferences();
  const active = enabled && !reduced;
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const formatRef = useRef(format);
  formatRef.current = format;
  const ready = !whenVisible || seen;
  const completed = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const show = (current: number) => { node.textContent = formatRef.current(current); };
    if (!active || completed.current === value) {
      completed.current = value;
      show(value);
      return;
    }
    // Off-screen content stays truthful; only start counting when it is visible.
    if (!ready) { show(value); return; }
    const counter = animate(0, value, {
      duration,
      ease: EASE,
      onUpdate: show,
      onComplete: () => { completed.current = value; show(value); },
    });
    const sink = node.animate(
      [{ opacity: 0.4 }, { opacity: 1 }],
      { duration: duration * 1000, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => { counter.stop(); sink.cancel(); show(value); };
  }, [value, duration, active, ready]);

  return (
    <span className={className}>
      <span ref={ref} className={styles.count} aria-hidden>{format(value)}</span>
      <span className={`${styles.srOnly} ${styles.finalValue}`}>{format(value)}</span>
    </span>
  );
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter("zh-CN", { granularity: "word" })
  : null;

/**
 * Copy that settles word by word: each word appears in the accent colour and
 * sinks to the element's own ink. Replays whenever the element remounts.
 */
export function InkText({ text, as: Tag = "span", className, step = 28, delay = 0 }: {
  text: string;
  as?: ElementType;
  className?: string;
  step?: number;
  delay?: number;
}) {
  const words = segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : text.split(/(\s+)/);
  return (
    <Tag className={[styles.ink, className].filter(Boolean).join(" ")} data-navigation-motion>
      <span aria-hidden>
        {words.map((word, index) => (
          <span key={index} style={{ animationDelay: `${delay + Math.min(index, 24) * step}ms` }}>{word}</span>
        ))}
      </span>
      <span className={styles.srOnly}>{text}</span>
    </Tag>
  );
}

/** A block that rises out of its own mask, like a line of type being set. */
export function MaskRise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <span className={[styles.mask, className].filter(Boolean).join(" ")} data-navigation-motion>
      <span style={{ animationDelay: `${delay}ms` }}>{children}</span>
    </span>
  );
}
