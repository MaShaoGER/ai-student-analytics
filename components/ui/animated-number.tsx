"use client";

import { useLayoutEffect, useState } from "react";
import { useMotionPreferences } from "@/components/ui/motion-preferences";

export const COUNT_UP_MS = 900;

/** Page-load data motion follows the local motion switch and OS setting only. */
export const countUpAllowed = () =>
  document.documentElement.dataset.motion === "on" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Counts from zero to a freshly mounted value with a strong ease-out. Used for
 * real metrics only; re-mount (page return, data source change) replays it.
 */
export function useCountUp(value: number | undefined, duration = COUNT_UP_MS) {
  const { enabled, reduced } = useMotionPreferences();
  const [display, setDisplay] = useState<number | undefined>(value);
  useLayoutEffect(() => {
    if (value === undefined) {
      setDisplay(undefined);
      return;
    }
    if (!enabled || reduced || !countUpAllowed()) {
      setDisplay(value);
      return;
    }
    setDisplay(0);
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      setDisplay(value * (1 - Math.pow(1 - progress, 5)));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, enabled, reduced, duration]);
  return display;
}

const format = (value: number, decimals: number) =>
  decimals === 0
    ? Math.round(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 })
    : value.toLocaleString("zh-CN", { maximumFractionDigits: decimals });

/**
 * Renders only the formatted number so page typography stays with the caller.
 * While loading (or before data), renders the provided fallback.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  loading = false,
  fallback = null,
}: {
  value?: number;
  decimals?: number;
  loading?: boolean;
  fallback?: React.ReactNode;
}) {
  const display = useCountUp(loading ? undefined : value);
  if (loading) return <>{fallback}</>;
  if (value === undefined) return <>{fallback}</>;
  return <>{format(display ?? value, decimals)}</>;
}
