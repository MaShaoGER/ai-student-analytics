"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/app-icons";
import { MotionPreferences } from "@/components/ui/motion-preferences";

type Theme = "light" | "dark";
const STORAGE_KEY = "student-analytics.appearance";
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
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
    (next: Theme) => {
      applyTheme(next);
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
      <MotionPreferences />
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="外观模式">
      {(["light", "dark"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-label={value === "light" ? "浅色模式" : "深色模式"}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon name={value === "light" ? "sun" : "moon"} size={16} />
          <span>{value === "light" ? "浅色" : "深色"}</span>
        </button>
      ))}
    </div>
  );
}
