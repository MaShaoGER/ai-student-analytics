"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotionPreferences } from "../ui/motion-preferences";

/** One cancellable animation per transcript. New targets replace, never queue. */
export function useConversationScroll(key: string, count: number, loading: boolean) {
  const transcript = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLElement>(null);
  const pending = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const frame = useRef(0);
  const target = useRef(0);
  const destination = useRef<(() => number) | null>(null);
  const readingAnchor = useRef<{ element: Element; offset: number } | null>(null);
  const capture = useCallback(() => {
    const region = transcript.current;
    if (!region) return;
    const bounds = region.getBoundingClientRect();
    const element = Array.from(region.querySelectorAll("article > *")).find((node) => {
      const box = node.getBoundingClientRect();
      return box.bottom > bounds.top + 1 && box.top < bounds.bottom;
    });
    readingAnchor.current = element
      ? { element, offset: element.getBoundingClientRect().top - bounds.top }
      : null;
  }, []);
  const [hasNew, setHasNew] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const updateActive = useCallback(() => {
    const region = transcript.current;
    if (!region) return;
    const top = region.getBoundingClientRect().top + 40;
    const rounds = Array.from(region.querySelectorAll<HTMLElement>('article[data-role="user"]'));
    const current = rounds.filter((node) => node.getBoundingClientRect().top <= top).at(-1);
    setActiveId(current?.dataset.messageId ?? null);
  }, []);
  const { enabled, reduced } = useMotionPreferences();
  const cancel = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);
  const move = useCallback(
    (top: number | (() => number), instant = false) => {
      const element = transcript.current;
      if (!element) return;
      destination.current = typeof top === "function" ? top : () => top;
      const resolve = () =>
        Math.max(
          0,
          Math.min(
            destination.current?.() ?? element.scrollTop,
            element.scrollHeight - element.clientHeight,
          ),
        );
      target.current = resolve();
      if (instant || !enabled || reduced) {
        cancel();
        element.scrollTop = target.current;
        return;
      }
      if (frame.current) return;
      let previous = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(64, now - previous);
        previous = now;
        target.current = resolve();
        const distance = target.current - element.scrollTop;
        if (Math.abs(distance) < 1) {
          element.scrollTop = target.current;
          frame.current = 0;
          return;
        }
        element.scrollTop += distance * (1 - Math.exp(-dt / 55));
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [cancel, enabled, reduced],
  );
  const interrupt = useCallback(() => {
    following.current = false;
    cancel();
    destination.current = null;
    capture();
  }, [cancel, capture]);
  const latest = useCallback(
    (instant = false) => {
      const element = transcript.current;
      if (!element) return;
      following.current = true;
      setHasNew(false);
      move(() => element.scrollHeight, instant);
    },
    [move],
  );
  const jump = useCallback(
    (id: string | null, instant = false) => {
      const region = transcript.current;
      if (!region) return;
      interrupt();
      // Read from DOM markers already owned by the transcript; no parallel chat state.
      const anchor = Array.from(
        region.querySelectorAll<HTMLElement>("article[data-message-id]"),
      ).find((node) => node.dataset.messageId === id);
      move(
        anchor
          ? () =>
              region.scrollTop +
              anchor.getBoundingClientRect().top -
              region.getBoundingClientRect().top -
              16
          : 0,
        instant,
      );
    },
    [interrupt, move],
  );
  useLayoutEffect(() => {
    cancel();
    following.current = true;
    setHasNew(false);
    setActiveId(null);
    readingAnchor.current = null;
    destination.current = null;
    if (transcript.current) transcript.current.scrollTop = 0;
  }, [key, cancel]);
  useLayoutEffect(() => {
    const element = transcript.current;
    if (!element) return;
    if (!following.current) {
      setHasNew(true);
      return;
    }
    const anchor = loading ? pending.current : newest.current;
    if (anchor) {
      // Read from the answer's beginning, even when a whole long answer arrives.
      move(
        () =>
          element.scrollTop +
          anchor.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          16,
      );
    }
  }, [count, loading, move]);
  useEffect(() => {
    const element = transcript.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) interrupt();
    };
    const touch = () => interrupt();
    const keys = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home", "ArrowDown", "PageDown", "End", " "].includes(event.key))
        interrupt();
    };
    element.addEventListener("wheel", wheel, { passive: true });
    element.addEventListener("touchstart", touch, { passive: true });
    element.addEventListener("pointerdown", touch, { passive: true });
    element.addEventListener("keydown", keys);
    const observer = new ResizeObserver(() => {
      const anchor = readingAnchor.current;
      if (following.current && destination.current) move(destination.current);
      if (!following.current && !frame.current && anchor?.element.isConnected) {
        const offset =
          anchor.element.getBoundingClientRect().top - element.getBoundingClientRect().top;
        if (Math.abs(offset - anchor.offset) > 1) element.scrollTop += offset - anchor.offset;
      }
      if (element.scrollHeight - element.scrollTop - element.clientHeight > 80) setHasNew(true);
    });
    const observeContent = () => {
      observer.disconnect();
      observer.observe(element);
      element
        .querySelectorAll("article > *, [data-scroll-pending]")
        .forEach((node) => observer.observe(node));
    };
    const mutations = new MutationObserver(observeContent);
    mutations.observe(element, { childList: true, subtree: true });
    observeContent();
    return () => {
      cancel();
      observer.disconnect();
      mutations.disconnect();
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("touchstart", touch);
      element.removeEventListener("pointerdown", touch);
      element.removeEventListener("keydown", keys);
    };
  }, [cancel, interrupt, key, move]);
  return {
    transcript,
    newest,
    pending,
    hasNew,
    activeId,
    jump,
    latest,
    interrupt,
    onScroll() {
      const element = transcript.current;
      updateActive();
      if (!element) return;
      if (frame.current) {
        capture();
        return;
      }
      const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      if (atEnd) {
        following.current = true;
        destination.current = () => element.scrollHeight;
        setHasNew(false);
      } else setHasNew(true);
      capture();
    },
    begin() {
      following.current = true;
      setHasNew(false);
    },
  };
}
