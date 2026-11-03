import type { PointerEvent } from "react";
import type { CourseKey } from "./story-data";

/** One course can be previewed (hover/focus) or pinned (click/tap); preview wins while it lasts. */
export type Selection = {
  active: CourseKey | null;
  pinned: CourseKey | null;
  setPreview: (key: CourseKey | null) => void;
  toggle: (key: CourseKey) => void;
};

/** `idle` when nothing is selected, otherwise whether this course is the selected one. */
export const courseState = (active: CourseKey | null, key: CourseKey) =>
  active === null ? "idle" : active === key ? "on" : "off";

/**
 * Pointer handlers for any mark that stands for a course. Touch has no hover, so a tap
 * pins through `onClick` and enter/leave are ignored for it.
 */
export function courseHover(selection: Selection, key: CourseKey) {
  return {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "touch") selection.setPreview(key);
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType !== "touch") selection.setPreview(null);
    },
    onClick: () => selection.toggle(key),
  };
}

/**
 * Keyboard focus previews like hover. Pointer focus is skipped: a tap already pins through
 * `onClick`, and a lingering focus preview would keep the course lit after it is unpinned.
 */
export function courseFocus(selection: Selection, key: CourseKey) {
  return {
    onFocus: () => {
      if (document.documentElement.dataset.inputModality !== "pointer") selection.setPreview(key);
    },
    onBlur: () => selection.setPreview(null),
  };
}
