"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/app-icons";
import { MotionPreferences } from "@/components/ui/motion-preferences";

type Theme = "light" | "dark";
type ThemeOrigin = { x: number; y: number };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};
const STORAGE_KEY = "student-analytics.appearance";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme, origin?: ThemeOrigin) => void;
}>({
  theme: "light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, updateTheme] = useState<Theme>("light");
  const applyTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    updateTheme(next);
  }, []);
  const setTheme = useCallback(
    (next: Theme, origin?: ThemeOrigin) => {
      const root = document.documentElement;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const transition = (document as ViewTransitionDocument).startViewTransition;
      // The circular reveal is shared by every page and respects the motion switch.
      if (!transition || reduce || root.dataset.motion !== "on") {
        applyTheme(next);
      } else {
        const x = origin?.x ?? innerWidth / 2;
        const y = origin?.y ?? innerHeight / 2;
        root.style.setProperty("--theme-switch-x", `${x}px`);
        root.style.setProperty("--theme-switch-y", `${y}px`);
        root.style.setProperty(
          "--theme-switch-radius",
          `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`,
        );
        root.dataset.themeSwitch = "on";
        try {
          const viewTransition = transition.call(document, () => applyTheme(next));
          viewTransition.finished
            .catch(() => {})
            .finally(() => {
              delete root.dataset.themeSwitch;
            });
        } catch {
          delete root.dataset.themeSwitch;
          applyTheme(next);
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* Appearance also works without storage. */
      }
    },
    [applyTheme],
  );

  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const preferred = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "light" || saved === "dark") return saved;
      } catch {
        /* Use the system appearance. */
      }
      return system.matches ? "dark" : "light";
    };
    applyTheme(preferred());
    const onSystem = () => applyTheme(preferred());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) applyTheme(preferred());
    };
    system.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      system.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, [applyTheme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return (
    <ThemeContext.Provider value={value}>
      <MotionPreferences>{children}</MotionPreferences>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

/** Prefer the click point; keyboard activation reveals from the control itself. */
function originFrom(event: React.MouseEvent<HTMLButtonElement>): ThemeOrigin {
  if (event.detail !== 0) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  if (compact) {
    const label = theme === "light" ? "切换到深色模式" : "切换到浅色模式";
    return (
      <button
        type="button"
        className="icon-button rail-theme-toggle"
        aria-label={label}
        title={label}
        onClick={(event) => setTheme(theme === "light" ? "dark" : "light", originFrom(event))}
      >
        <Icon name={theme === "light" ? "sun" : "moon"} size={18} />
      </button>
    );
  }
  return (
    <div className="theme-toggle" role="group" aria-label="外观模式">
      {(["light", "dark"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-label={value === "light" ? "浅色模式" : "深色模式"}
          aria-pressed={theme === value}
          onClick={(event) => setTheme(value, originFrom(event))}
        >
          <Icon name={value === "light" ? "sun" : "moon"} size={16} />
          <span>{value === "light" ? "浅色" : "深色"}</span>
        </button>
      ))}
    </div>
  );
}
