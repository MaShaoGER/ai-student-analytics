"use client";

import { useLayoutEffect, useRef } from "react";

/** Retarget a single line without re-rendering the navigation on each frame. */
export function NavigationIndicator({ activeKey }: { activeKey: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const indicator = ref.current;
    const nav = indicator?.parentElement;
    if (!indicator || !nav) return;
    const update = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active || !nav.clientWidth) {
        indicator.hidden = true;
        return;
      }
      const rect = active.getBoundingClientRect();
      const parent = nav.getBoundingClientRect();
      indicator.hidden = false;
      indicator.style.transform = `translate(${rect.left - parent.left + 8}px, ${rect.bottom - parent.top - 3}px) scaleX(${Math.max(12, rect.width - 16)})`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeKey]);
  return <span className="navigation-indicator" ref={ref} aria-hidden="true" />;
}
