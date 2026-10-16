"use client";

import { useEffect } from "react";

/** A single subscription lets CSS keep keyboard interactions immediate. */
export function MotionPreferences() {
  useEffect(() => {
    const root = document.documentElement;
    const previousModality = root.dataset.inputModality;
    root.dataset.inputModality = "keyboard";

    function markPointer() {
      if (root.dataset.inputModality !== "pointer") root.dataset.inputModality = "pointer";
    }

    function markKeyboard(event: KeyboardEvent) {
      if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return;
      root.dataset.inputModality = "keyboard";
    }

    document.addEventListener("pointerdown", markPointer, true);
    document.addEventListener("pointermove", markPointer, { passive: true });
    document.addEventListener("keydown", markKeyboard, true);

    return () => {
      document.removeEventListener("pointerdown", markPointer, true);
      document.removeEventListener("pointermove", markPointer);
      document.removeEventListener("keydown", markKeyboard, true);
      if (previousModality === undefined) delete root.dataset.inputModality;
      else root.dataset.inputModality = previousModality;
    };
  }, []);

  return null;
}
