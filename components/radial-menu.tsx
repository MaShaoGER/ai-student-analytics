"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { ChartPickOrigin } from "./concept-chart";
import styles from "./radial-menu.module.css";

export type RadialOption = {
  key: string;
  label: string;
  note?: string;
  /** topic = go to another exploration centre; drawing = same data, another drawing. */
  kind: "topic" | "drawing";
  disabled?: boolean;
  current?: boolean;
  onSelect: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Petals fold back into the picked point (CSS 168ms) before the dialog goes away. */
const EXIT_MS = 180;

/**
 * A circular secondary selection that blooms from the exact point the reader picked.
 * Opening, browsing and cancelling never navigate; only a petal's onSelect commits.
 */
export function RadialMenu({ origin, eyebrow, title, reading, options, motion, onClose }: {
  origin: ChartPickOrigin;
  eyebrow: string;
  title: string;
  reading?: ReactNode;
  options: RadialOption[];
  motion: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState({ w: 0, h: 0, x: 0, y: 0 });
  const [sizes, setSizes] = useState({ hubWidth: 280, hubHeight: 180, petalHeight: 100, legendHeight: 48 });
  const [phase, setPhase] = useState<"open" | "closing">("open");

  // One exit at a time: choosing or cancelling commits once, after the petals fold in.
  const closing = useRef(false);
  const exitTimer = useRef<number | null>(null);
  const exitAction = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const heal = useRef<number | null>(null);

  const flushExit = () => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    const run = exitAction.current;
    exitAction.current = null;
    run?.();
    // Every action here is expected to unmount the menu (close or commit). If one did not,
    // fall back to an interactive menu instead of an invisible overlay that eats clicks.
    heal.current = window.requestAnimationFrame(() => {
      heal.current = null;
      if (!alive.current) return;
      closing.current = false;
      setPhase("open");
    });
  };

  const leave = (action: () => void) => {
    if (closing.current) return;
    closing.current = true;
    exitAction.current = action;
    if (!motion) {
      flushExit();
      return;
    }
    // Entry animations use fill-mode. Replacing them with transitions would snap
    // to the hidden end state; capture the visible frame for an interruptible exit.
    const animated = ["veil", "legend", "tether", "originDot", "halo", "ringFaint", "ring", "spoke", "hub", "petal"];
    dialog.current?.querySelectorAll<HTMLElement | SVGElement>(animated.map((name) => `.${styles[name]}`).join(",")).forEach((element) => {
      const current = getComputedStyle(element);
      element.style.setProperty("--exit-opacity", current.opacity);
      element.style.setProperty("--exit-transform", current.transform);
      element.style.setProperty("--exit-dash", current.strokeDashoffset);
    });
    setPhase("closing");
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      flushExit();
    }, EXIT_MS);
  };

  useLayoutEffect(() => {
    const measure = () => {
      const viewport = window.visualViewport;
      setView({
        w: viewport?.width ?? window.innerWidth,
        h: viewport?.height ?? window.innerHeight,
        x: viewport?.offsetLeft ?? 0,
        y: viewport?.offsetTop ?? 0,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !view.w || element.open) return;
    element.showModal();
    element.querySelector<HTMLButtonElement>("[data-petal]:not(:disabled)")?.focus({ preventScroll: true });
  }, [view.w]);
  useEffect(() => () => { if (dialog.current?.open) dialog.current.close(); }, []);
  // No timer or frame outlives the menu; turning motion off settles a running exit at once.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      if (heal.current !== null) window.cancelAnimationFrame(heal.current);
      exitTimer.current = null;
      heal.current = null;
    };
  }, []);
  useEffect(() => {
    if (!motion && closing.current) flushExit();
  }, [motion]);

  const { w, h } = view;
  const R = 232;
  const petalWidth = 208;
  const points = options.map((option, index) => {
    const angle = -Math.PI / 2 + ((index + 0.5) * 2 * Math.PI) / Math.max(options.length, 1);
    return { option, index, dx: Math.cos(angle) * R, dy: Math.sin(angle) * R };
  });
  // Fit the entire menu, not just its centre. Reserve room for the legend and
  // focus outlines; content that cannot fit a ring uses a scrollable sheet.
  const left = Math.min(-sizes.hubWidth / 2, ...points.map(({ dx }) => dx - petalWidth / 2));
  const right = Math.max(sizes.hubWidth / 2, ...points.map(({ dx }) => dx + petalWidth / 2));
  const top = Math.min(-sizes.hubHeight / 2, ...points.map(({ dy }) => dy - sizes.petalHeight / 2));
  const bottom = Math.max(sizes.hubHeight / 2, ...points.map(({ dy }) => dy + sizes.petalHeight / 2));
  const compact = w <= 640 || options.length > 6
    || right - left > w - 32 || bottom - top > h - sizes.legendHeight - 64;
  const cx = compact ? w / 2 : clamp(origin.x - view.x, 16 - left, w - 16 - right);
  const cy = compact ? h / 2 : clamp(origin.y - view.y, 16 - top, h - sizes.legendHeight - 48 - bottom);
  const petals = points.map(({ option, index, dx, dy }) => ({
    option, index, x: cx + dx, y: cy + dy, right: dx >= 0,
  }));
  const moved = Math.hypot(origin.x - view.x - cx, origin.y - view.y - cy) > 6;

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element || !w || compact) return;
    const hub = element.querySelector<HTMLElement>(`.${styles.hub}`);
    const legend = element.querySelector<HTMLElement>(`.${styles.legend}`);
    const items = [...element.querySelectorAll<HTMLElement>(`.${styles.petal}`)];
    if (!hub || !legend) return;
    const measure = () => {
      const next = {
        hubWidth: hub.offsetWidth,
        hubHeight: hub.offsetHeight,
        petalHeight: Math.max(0, ...items.map((item) => item.offsetHeight)),
        legendHeight: legend.offsetHeight,
      };
      setSizes((previous) => Object.keys(next).every((key) => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    [hub, legend, ...items].forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [w, h, compact, options]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-petal]:not(:disabled)")];
    if (!buttons.length) return;
    event.preventDefault();
    if (closing.current) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + step + buttons.length) % buttons.length].focus({ preventScroll: !compact });
  };

  return (
    <dialog ref={dialog} className={styles.radial} aria-labelledby="radial-title" data-navigation-motion data-phase={phase} data-motion={motion ? "on" : "off"}
      data-layout={compact ? "compact" : "radial"} style={{ left: view.x, top: view.y, width: w || undefined, height: h || undefined }}
      onCancel={(event) => { event.preventDefault(); leave(onClose); }}
      onClick={(event) => { if (event.target === event.currentTarget) leave(onClose); }}
      onKeyDown={onKeyDown}>
      {w > 0 && (
        <>
          <div className={styles.veil} style={{ "--ox": `${cx}px`, "--oy": `${cy}px` } as CSSProperties} aria-hidden />
          {!compact && <svg className={styles.spokes} width={w} height={h} aria-hidden>
            <defs>
              <radialGradient id="radial-halo">
                <stop offset="0" stopColor="rgba(118,102,204,0.22)" />
                <stop offset="1" stopColor="rgba(118,102,204,0)" />
              </radialGradient>
            </defs>
            <circle className={styles.halo} cx={cx} cy={cy} r={R * 1.5} fill="url(#radial-halo)" />
            <circle className={styles.ring} cx={cx} cy={cy} r={R} pathLength={1} />
            <circle className={styles.ringFaint} cx={cx} cy={cy} r={R * 0.62} />
            {moved && (
              <>
                <line className={styles.tether} x1={origin.x - view.x} y1={origin.y - view.y} x2={cx} y2={cy} />
                <circle className={styles.originDot} cx={origin.x - view.x} cy={origin.y - view.y} r={5} />
              </>
            )}
            {petals.map(({ option, index, x, y }) => (
              <line key={option.key} className={styles.spoke} data-kind={option.kind} x1={cx} y1={cy} x2={x} y2={y} pathLength={1}
                style={{ "--k": index } as CSSProperties} />
            ))}
          </svg>}
          <div className={styles.layout}>
          <div className={styles.hub} style={compact ? undefined : { left: cx, top: cy }}>
            <p className={styles.hubEyebrow}>{eyebrow}</p>
            <h2 id="radial-title" className={styles.hubTitle}>{title}</h2>
            {reading && <p className={styles.hubReading}>{reading}</p>}
            <button type="button" className={styles.close} onClick={() => leave(onClose)}>取消 · Esc</button>
          </div>
          <ul className={styles.petals} aria-label="可选去向与画法">
            {petals.map(({ option, index, x, y, right }) => (
              <li key={option.key} className={styles.petal} data-side={right ? "right" : "left"} data-kind={option.kind}
                style={{ ...(compact ? {} : { left: x, top: y, width: petalWidth }), "--dx": `${cx - x}px`, "--dy": `${cy - y}px`, "--k": index } as CSSProperties}>
                <button type="button" data-petal disabled={option.disabled} aria-current={option.current || undefined}
                  onClick={() => leave(option.current ? onClose : option.onSelect)}>
                  <span className={styles.node} aria-hidden />
                  <span className={styles.text}>
                    <span className={styles.tag}>{option.kind === "topic" ? "新主题" : "同数据 · 画法"}{option.current ? " · 当前" : ""}</span>
                    <span className={styles.label}>{option.label}</span>
                    {option.note && <span className={styles.note}>{option.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.legend} aria-hidden>
            <span><i data-kind="topic" />去新主题</span><span><i data-kind="drawing" />同数据换画法</span><span>方向键切换 · Esc 取消</span>
          </p>
          </div>
        </>
      )}
    </dialog>
  );
}
