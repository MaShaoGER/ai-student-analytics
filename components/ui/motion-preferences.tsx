"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "student-analytics.motion";
const MotionContext = createContext({
  enabled: true,
  reduced: false,
  setEnabled: (_value: boolean) => {},
});

/** One shared preference and input subscription for CSS and chart transitions. */
export function MotionPreferences({ children }: { children?: ReactNode }) {
  const [enabled, updateEnabled] = useState(true);
  const [reduced, setReduced] = useState(false);
  const setEnabled = (value: boolean) => {
    document.documentElement.dataset.motion = value && !reduced ? "on" : "off";
    updateEnabled(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
    } catch {
      /* The preference works without storage. */
    }
  };

  useEffect(() => {
    const root = document.documentElement;
    const previousModality = root.dataset.inputModality;
    const previousMotion = root.dataset.motion;
    const system = matchMedia("(prefers-reduced-motion: reduce)");
    root.dataset.inputModality = "keyboard";
    function readPreference() {
      let value = true;
      try {
        value = localStorage.getItem(STORAGE_KEY) !== "off";
      } catch {
        /* Keep motion available. */
      }
      updateEnabled(value);
      setReduced(system.matches);
      root.dataset.motion = value && !system.matches ? "on" : "off";
    }
    function markPointer() {
      root.dataset.inputModality = "pointer";
    }
    function markKeyboard(event: KeyboardEvent) {
      if (!["Alt", "Control", "Meta", "Shift"].includes(event.key))
        root.dataset.inputModality = "keyboard";
    }
    function onStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY || event.key === null) readPreference();
    }
    readPreference();
    document.addEventListener("pointerdown", markPointer, true);
    document.addEventListener("pointermove", markPointer, { passive: true });
    document.addEventListener("keydown", markKeyboard, true);
    system.addEventListener("change", readPreference);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("pointerdown", markPointer, true);
      document.removeEventListener("pointermove", markPointer);
      document.removeEventListener("keydown", markKeyboard, true);
      system.removeEventListener("change", readPreference);
      window.removeEventListener("storage", onStorage);
      if (previousModality === undefined) delete root.dataset.inputModality;
      else root.dataset.inputModality = previousModality;
      if (previousMotion === undefined) delete root.dataset.motion;
      else root.dataset.motion = previousMotion;
    };
  }, []);

  return (
    <MotionContext.Provider value={{ enabled, reduced, setEnabled }}>
      {children}
    </MotionContext.Provider>
  );
}

export const useMotionPreferences = () => useContext(MotionContext);

export function MotionToggle() {
  const { enabled, reduced, setEnabled } = useMotionPreferences();
  return (
    <div>
      <button
        className="secondary-button motion-toggle"
        type="button"
        aria-pressed={enabled}
        onClick={() => setEnabled(!enabled)}
      >
        <span>交互动效</span>
        <strong>{enabled ? "开启" : "关闭"}</strong>
      </button>
      <p>{reduced ? "已跟随系统减少动态效果。" : "导航与图表随操作短暂过渡；键盘操作即时响应。"}</p>
    </div>
  );
}
