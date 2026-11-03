"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ConceptChart, type ChartData } from "./concept-chart";
import { DRAWING_LABELS, type ConceptDrawing } from "@/lib/exploration/concepts";
import styles from "./spatial-overview.module.css";

export type OverviewPlane = {
  id: string;
  title: string;
  centre: string;
  views: ConceptDrawing[];
  /** Real chart of the visited scene; a string explains why it cannot be drawn yet. */
  plot: ChartData | string;
  current: boolean;
  currentDrawing?: ConceptDrawing;
};

const DEPTH = 340;
const SPAN = 640;
const DRIFT = -90;

/** CSS fades for 240ms; the dialog is removed one frame later so the last frame is never cut. */
const EXIT_MS = 264;
/** One deliberate wheel gesture, not one event, moves the camera one plane. */
const WHEEL_THRESHOLD = 44;
/** After a step, ignore the rest of the same flick (inertia tail). */
const WHEEL_COOLDOWN = 280;
/** A slow drift that stops before crossing the threshold is forgotten. */
const WHEEL_QUIET = 180;

/** Keep the drawing the reader was looking at when it exists on the next topic. */
function resolveDrawing(plane: OverviewPlane, current: ConceptDrawing | null): ConceptDrawing | null {
  if (!plane.views.length) return null;
  if (current && plane.views.includes(current)) return current;
  if (plane.currentDrawing && plane.views.includes(plane.currentDrawing)) return plane.currentDrawing;
  return plane.views[0];
}

/**
 * Exploration overview as one shared perspective space: every visited topic is a large
 * translucent coordinate plane; topics recede in depth, drawings run sideways.
 * The camera dollies to the focused plane; a second activation enters that page.
 *
 * Arrows, the wheel and clicks all move the same single focus, so the dock, the raised
 * plane and the camera can never disagree. Closing and entering share one 240ms exit.
 */
export function SpatialOverview({ planes, earlierCount, showEarlier, onToggleEarlier, motion, onEnter, onClose }: {
  planes: OverviewPlane[];
  earlierCount: number;
  showEarlier: boolean;
  onToggleEarlier: () => void;
  motion: boolean;
  onEnter: (id: string, drawing: ConceptDrawing) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const space = useRef<HTMLDivElement>(null);
  const [focusDrawing, setFocusDrawing] = useState<ConceptDrawing | null>(() => {
    const current = planes.find((plane) => plane.current) ?? planes[planes.length - 1];
    return current?.currentDrawing ?? current?.views[0] ?? null;
  });
  const [focusId, setFocusId] = useState(() => (planes.find((plane) => plane.current) ?? planes[planes.length - 1])?.id ?? "");
  const [arrived, setArrived] = useState(!motion);
  const [phase, setPhase] = useState<"open" | "closing">("open");

  // One exit at a time: the pending action runs once, after the fade, or immediately.
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
    // Closing and entering both leave no dialog behind. If neither happened (a vanished
    // trail entry), restore an interactive overview rather than an invisible dead layer.
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
    setPhase("closing");
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      flushExit();
    }, EXIT_MS);
  };

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const timer = window.setTimeout(() => setArrived(true), motion ? 60 : 0);
    return () => { window.clearTimeout(timer); if (element?.open) element.close(); };
  }, [motion]);

  // Timers never outlive the dialog, and a mid-exit motion change settles at once.
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

  // Focus stays with the same semantic topic if older history is revealed.
  const found = planes.findIndex((plane) => plane.id === focusId);
  const t = found >= 0 ? found : planes.length - 1;
  const focus = planes[t];
  const focusViews = focus?.views ?? [];
  const d = Math.max(0, focusViews.indexOf(focusDrawing ?? focus?.currentDrawing ?? focusViews[0]));
  useEffect(() => {
    if (closing.current) return;
    dialog.current?.querySelector<HTMLButtonElement>(`[data-plane="${t}:${d}"]`)?.focus({ preventScroll: true });
  }, [t, d]);
  const back = (ti: number) => planes.length - 1 - ti;
  // Each topic's drawings sit side by side, centred on the topic's own depth axis.
  const offset = (di: number, count: number) => (di - (count - 1) / 2) * SPAN;
  const camX = offset(d, focusViews.length) + back(t) * DRIFT;
  const camZ = -back(t) * DEPTH;

  /** Entrance order is small and fixed per plane: near planes first, distant ones later. */
  const orders = useRef(new Map<string, number>());
  const orderOf = (key: string, ti: number) => {
    const cached = orders.current.get(key);
    if (cached !== undefined) return cached;
    const value = Math.min(Math.max(back(ti), 0), 8);
    orders.current.set(key, value);
    return value;
  };

  // A single focus: every input path funnels through these two moves.
  const focusTopic = (index: number) => {
    if (closing.current) return;
    const plane = planes[Math.min(Math.max(index, 0), planes.length - 1)];
    if (!plane) return;
    setFocusId(plane.id);
    setFocusDrawing((current) => resolveDrawing(plane, current));
  };
  const shiftDrawing = (step: number) => {
    if (closing.current) return;
    if (!focusViews.length) return;
    setFocusDrawing(focusViews[Math.min(Math.max(d + step, 0), focusViews.length - 1)]);
  };
  const focusPlane = (ti: number, di: number) => {
    const plane = planes[ti];
    if (!plane) return;
    setFocusId(plane.id);
    setFocusDrawing(plane.views[di] ?? resolveDrawing(plane, null));
  };

  // The wheel handler is registered once and reads the latest focus through a ref, so a
  // step never resets the cooldown that is holding the rest of the flick back.
  const moves = useRef({ topic: (_step: number) => {}, drawing: (_step: number) => {}, closed: (): boolean => false });
  moves.current = {
    topic: (step) => focusTopic(t + step),
    drawing: (step) => shiftDrawing(step),
    closed: () => closing.current,
  };

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    let axis: "topic" | "drawing" | null = null;
    let accumulated = 0;
    let lockedUntil = 0;
    let quiet = 0;
    const onWheel = (event: WheelEvent) => {
      // Ctrl/⌘ + wheel is browser zoom and stays untouched.
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (moves.current.closed()) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      const dx = event.deltaX * scale;
      const dy = event.deltaY * scale;
      const sideways = Math.abs(dx) > Math.abs(dy) || event.shiftKey;
      const amount = sideways ? dx || dy : dy;
      if (!amount) return;
      const nextAxis = sideways ? "drawing" : "topic";
      if (nextAxis !== axis) {
        axis = nextAxis;
        accumulated = 0;
      }
      const now = performance.now();
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => { accumulated = 0; }, WHEEL_QUIET);
      // Down/right goes forward through the trail; up/left goes back.
      if (now < lockedUntil) {
        lockedUntil = Math.max(lockedUntil, now + WHEEL_QUIET);
        accumulated = 0;
        return;
      }
      accumulated += amount;
      if (Math.abs(accumulated) < WHEEL_THRESHOLD) return;
      const step = Math.sign(accumulated);
      accumulated = 0;
      lockedUntil = now + WHEEL_COOLDOWN;
      if (axis === "topic") moves.current.topic(step);
      else moves.current.drawing(step);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      window.clearTimeout(quiet);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const topicStep = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const drawingStep = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!topicStep && !drawingStep) return;
    event.preventDefault();
    if (closing.current) return;
    if (topicStep) focusTopic(t + topicStep);
    else shiftDrawing(drawingStep);
  };

  return (
    <dialog ref={dialog} className={styles.overview} aria-labelledby="overview-title" data-navigation-motion data-phase={phase} data-motion={motion ? "on" : "off"}
      onCancel={(event) => { event.preventDefault(); leave(onClose); }}
      onPointerMove={(event) => {
        if (!motion || event.pointerType !== "mouse" || !space.current) return;
        space.current.style.setProperty("--tilt-x", `${((event.clientY / window.innerHeight - 0.5) * -3).toFixed(2)}deg`);
        space.current.style.setProperty("--tilt-y", `${((event.clientX / window.innerWidth - 0.5) * 4).toFixed(2)}deg`);
      }}>
      <div className={styles.fog} aria-hidden />
      <header className={styles.head}>
        <p className={styles.eyebrow}>探索全览 · {planes.length} 个主题</p>
        <h2 id="overview-title" className={styles.title}>走过的路径，<span>在此交汇。</span></h2>
        <p className={styles.lede}>前后是你探索过的主题，左右是同一主题看过的画法。每一层都是当时真实的图表。</p>
        {earlierCount > 0 && (
          <button type="button" className={styles.link} onClick={() => { if (!closing.current) onToggleEarlier(); }} aria-expanded={showEarlier}>
            {showEarlier ? "收起更早的主题" : `展开更早的 ${earlierCount} 个主题`}
          </button>
        )}
      </header>
      <button type="button" className={styles.close} onClick={() => leave(onClose)}>关闭 · Esc</button>

      <div className={styles.stage} onKeyDown={onKeyDown}>
        <div ref={space} className={styles.space} data-arrived={arrived || undefined}
          style={{ "--cam-x": `${-camX}px`, "--cam-z": `${-camZ}px` } as CSSProperties}>
          <div className={styles.world} role="list" aria-label="前后为主题，左右为画法">
            {planes.map((plane, ti) => plane.views.map((drawing, di) => {
              const focused = ti === t && di === d;
              const distance = Math.abs(ti - t) + Math.abs(di - d) * 0.6;
              const reachable = focused || ti === t && Math.abs(di - d) <= 1;
              return (
                <div key={`${plane.id}:${drawing}`} role="listitem" className={styles.plane}
                  data-focused={focused || undefined} data-ahead={ti > t || undefined} data-current={plane.current && drawing === plane.currentDrawing || undefined}
                  style={{
                    "--x": `${offset(di, plane.views.length) + back(ti) * DRIFT}px`,
                    "--z": `${-back(ti) * DEPTH}px`,
                    "--dist": distance.toFixed(2),
                    "--k": ti === t && di === d ? 1000 : 20 + planes.length - ti,
                    "--order": orderOf(`${plane.id}:${drawing}`, ti),
                  } as CSSProperties}>
                  <button type="button" className={styles.face} data-plane={`${ti}:${di}`} tabIndex={focused ? 0 : -1} disabled={!reachable}
                    aria-label={`${plane.title} · ${DRAWING_LABELS[drawing]}${plane.current && drawing === plane.currentDrawing ? "（当前页）" : ""}；${focused ? "再按一次进入" : "聚焦这一层"}`}
                    onMouseDown={(event) => { if (!focused) event.preventDefault(); }}
                    onClick={() => {
                      if (closing.current) return;
                      if (focused) leave(() => onEnter(plane.id, drawing));
                      else focusPlane(ti, di);
                    }}>
                    <span className={styles.meta}>
                      <span>{String(ti + 1).padStart(2, "0")} / {String(planes.length).padStart(2, "0")}</span>
                      <span>{DRAWING_LABELS[drawing]}</span>
                    </span>
                    <span className={styles.planeTitle}>{plane.title}</span>
                    <span className={styles.planeCentre}>{plane.centre}</span>
                    <span className={styles.chart} aria-hidden>
                      {typeof plane.plot === "string"
                        ? <span className={styles.wait}>{plane.plot}</span>
                        : <ConceptChart data={plane.plot} drawing={drawing} label={plane.title} compact />}
                    </span>
                    {plane.current && drawing === plane.currentDrawing && <span className={styles.here}>当前页</span>}
                  </button>
                </div>
              );
            }))}

          </div>
        </div>
      </div>
      <nav className={styles.dock} aria-label="全览导航">
        <button type="button" disabled={t === 0} onClick={() => focusTopic(t - 1)}>← 更早</button>
        <p aria-live="polite">
          <strong>{focus?.title}</strong>
          <span>{focusViews[d] && DRAWING_LABELS[focusViews[d]]} · {String(t + 1).padStart(2, "0")} / {String(planes.length).padStart(2, "0")}</span>
        </p>
        <button type="button" disabled={t >= planes.length - 1} onClick={() => focusTopic(t + 1)}>更近 →</button>
        <button type="button" className={styles.enter} onClick={() => {
          if (closing.current || !focus || !focusViews[d]) return;
          leave(() => onEnter(focus.id, focusViews[d]));
        }}>进入这一页</button>
      </nav>
      <p className={styles.keys} aria-hidden>↑↓ 或滚轮切换主题 · ←→ 或 Shift+滚轮切换画法 · 点一层聚焦，再点一次进入</p>
    </dialog>
  );
}