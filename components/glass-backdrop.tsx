"use client";

import { useEffect, useRef, useState } from "react";
import type { GlassPattern } from "@/lib/ui/glass-patterns";
import { createGlassOptics } from "@/lib/ui/glass-optics";
import { useMotionPreferences } from "./ui/motion-preferences";
import { useTheme } from "./ui/theme-provider";
import styles from "./glass-backdrop.module.css";

/** V4 optical renderer behind the DOM. The CSS material survives GPU failures. */
export function GlassBackdrop({
  paused = false,
  pattern = "smoke",
}: {
  paused?: boolean;
  pattern?: GlassPattern;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createGlassOptics>>(null);
  const { enabled, reduced } = useMotionPreferences();
  const { theme } = useTheme();
  const [epoch, setEpoch] = useState(0);
  const preferences = useRef({
    animated: enabled && !reduced && !paused,
    interactive: enabled && !reduced,
    light: theme === "light",
    pattern,
  });
  preferences.current = {
    animated: enabled && !reduced && !paused,
    interactive: enabled && !reduced,
    light: theme === "light",
    pattern,
  };
  useEffect(() => {
    const element = canvas.current;
    const stage = element?.closest<HTMLElement>(".glass-workspace");
    if (!element || !stage) return;
    const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
    const initialize = () => {
      renderer.current?.dispose();
      renderer.current = null;
      if (transparency.matches) {
        stage.dataset.optics = "solid";
        return;
      }
      renderer.current = createGlassOptics(element, stage);
      if (renderer.current)
        renderer.current.update({
          ...preferences.current,
          light: document.documentElement.dataset.theme === "light",
        });
      else stage.dataset.optics = "fallback";
    };
    const lost = (event: Event) => {
      event.preventDefault();
      renderer.current?.dispose();
      renderer.current = null;
      stage.dataset.optics = "fallback";
    };
    const restored = () => setEpoch((value) => value + 1);
    element.addEventListener("webglcontextlost", lost);
    element.addEventListener("webglcontextrestored", restored);
    transparency.addEventListener("change", initialize);
    initialize();
    return () => {
      renderer.current?.dispose();
      renderer.current = null;
      element.removeEventListener("webglcontextlost", lost);
      element.removeEventListener("webglcontextrestored", restored);
      transparency.removeEventListener("change", initialize);
      delete stage.dataset.optics;
    };
  }, [epoch]);
  useEffect(() => {
    const stage = canvas.current?.closest<HTMLElement>(".glass-workspace");
    if (stage) stage.dataset.glassPattern = pattern;
    renderer.current?.update({
      ...preferences.current,
      light: document.documentElement.dataset.theme === "light",
    });
  }, [enabled, reduced, paused, theme, pattern]);
  return (
    <div className={styles.backdrop} data-pattern={pattern} aria-hidden="true">
      <div className={styles.halo} />
      <div className={styles.arc} />
      <div className={styles.prism} />
      <div className={styles.grain} />
      <canvas ref={canvas} className={styles.optics} />
    </div>
  );
}
