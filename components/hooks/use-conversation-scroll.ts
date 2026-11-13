"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotionPreferences } from "../ui/motion-preferences";

/** Reading position of one transcript, kept per conversation key while it is off screen. */
export type ConversationScrollPosition = { top: number; following: boolean };

/** One cancellable animation per transcript. New targets replace, never queue. */
export function useConversationScroll(
  key: string,
  count: number,
  loading: boolean,
  positions?: Map<string, ConversationScrollPosition>,
) {
  const transcript = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLElement>(null);
  const pending = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const frame = useRef(0);
  const target = useRef(0);
  const destination = useRef<(() => number) | null>(null);
  const readingAnchor = useRef<{ element: Element; offset: number } | null>(null);
  // The scroll offset survives a hidden or detached region, whose own scrollTop
  // reads 0, so the last real offset is tracked as well.
  const lastTop = useRef(0);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const keyRef = useRef(key);
  keyRef.current = key;
  const countRef = useRef(count);
  countRef.current = count;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  /** Position found for this key; applied on mount and key change instead of an auto jump. */
  const restoring = useRef<ConversationScrollPosition | null>(null);
  /** The count/loading pass that just restored a position must not scroll to newest. */
  const restoredPass = useRef<{ key: string; count: number; loading: boolean } | null>(null);
  /** The transcript lost its layout box (another workspace view) and must be put back on return. */
  const suspended = useRef(false);
  const restoreTimer = useRef(0);
  /** Attempts already spent waiting for a short transcript to grow. */
  const restoreTries = useRef(0);
  const applyRestoreRef = useRef<(growth?: boolean) => void>(() => {});
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
    const top = region.getBoundingClientRect().top + parseFloat(getComputedStyle(region).scrollPaddingTop) + 24;
    const rounds = Array.from(region.querySelectorAll<HTMLElement>('article[data-role="user"]'));
    const current = rounds.filter((node) => node.getBoundingClientRect().top <= top).at(-1);
    setActiveId(current?.dataset.messageId ?? null);
  }, []);
  const { enabled, reduced } = useMotionPreferences();
  const cancel = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);
  /** A region without a layout box (`hidden`, detached) reports 0, so only live reads count. */
  const recordTop = useCallback((element: HTMLElement) => {
    if (element.clientHeight > 0) lastTop.current = element.scrollTop;
  }, []);
  /** Capture the live offset for `forKey` before the transcript leaves the page. */
  const remember = useCallback((forKey: string) => {
    const map = positionsRef.current;
    if (!map) return;
    // A restore that has not landed yet owns this entry; the region was never
    // shown at that offset, so rewriting it would lose the position instead.
    if (restoring.current) return;
    // `lastTop` is the last offset read while the region had a layout box. A
    // region being hidden or replaced already reports 0 here, and saving that
    // would turn the reading position into the top of the transcript.
    map.set(forKey, { top: lastTop.current, following: following.current });
  }, []);
  /** Stop any pending restore retry and forget the saved position it owned. */
  const stopRestore = useCallback(() => {
    if (restoreTimer.current) window.clearTimeout(restoreTimer.current);
    restoreTimer.current = 0;
    restoreTries.current = 0;
    restoring.current = null;
  }, []);
  /**
   * Put the transcript back where it was instead of at the newest message. A
   * region without a layout box, or one whose content is still shorter than the
   * saved offset (attachments and charts have not rendered yet), is retried
   * instead of turning the saved offset into a clamped 0.
   */
  const applyRestore = useCallback(
    (growth = false) => {
      const element = transcript.current;
      const saved = restoring.current;
      if (!element || !saved) return;
      // A hidden region cannot be measured or scrolled; the resume path applies
      // the saved position again once the transcript is laid out.
      if (element.clientHeight <= 0) return;
      const max = Math.max(0, element.scrollHeight - element.clientHeight);
      following.current = saved.following;
      let landed = true;
      if (saved.following) {
        // Leaving at the bottom means "keep following", so follow the grown end.
        element.scrollTop = max;
        destination.current = () => element.scrollHeight;
      } else {
        const wanted = Math.max(0, saved.top);
        const top = Math.min(wanted, max);
        element.scrollTop = top;
        destination.current = null;
        // The saved offset has to fit the rendered content; a short layout is a
        // layout that has not finished, not a reading position at its end.
        landed = top + 1 >= wanted;
      }
      recordTop(element);
      if (!landed) {
        // Messages and attachments are still arriving, so the short height is a
        // layout in progress, not the reading position. Growth restarts the
        // count; only a transcript whose list has settled may accept the clamp.
        restoreTries.current = growth ? 0 : restoreTries.current + 1;
        const settled =
          restoreTries.current >= 10 && countRef.current > 0 && !loadingRef.current;
        if (!settled && restoreTries.current < 25) {
          if (!restoreTimer.current) {
            restoreTimer.current = window.setTimeout(() => {
              restoreTimer.current = 0;
              applyRestoreRef.current(false);
            }, 120);
          }
          return;
        }
      }
      stopRestore();
      restoredPass.current = {
        key: keyRef.current,
        count: countRef.current,
        loading: loadingRef.current,
      };
      if (!saved.following) capture();
    },
    [capture, recordTop, stopRestore],
  );
  applyRestoreRef.current = applyRestore;
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
        recordTop(element);
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
          recordTop(element);
          frame.current = 0;
          return;
        }
        element.scrollTop += distance * (1 - Math.exp(-dt / 55));
        recordTop(element);
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [cancel, enabled, recordTop, reduced],
  );
  const interrupt = useCallback(() => {
    following.current = false;
    stopRestore();
    restoredPass.current = null;
    cancel();
    destination.current = null;
    capture();
  }, [cancel, capture, stopRestore]);
  const latest = useCallback(
    (instant = false) => {
      const element = transcript.current;
      if (!element) return;
      following.current = true;
      stopRestore();
      restoredPass.current = null;
      setHasNew(false);
      move(() => element.scrollHeight, instant);
    },
    [move, stopRestore],
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
              parseFloat(getComputedStyle(region).scrollPaddingTop)
          : 0,
        instant,
      );
    },
    [interrupt, move],
  );
  useLayoutEffect(() => {
    const element = transcript.current;
    const saved = positionsRef.current?.get(key) ?? null;
    cancel();
    stopRestore();
    setHasNew(false);
    setActiveId(null);
    readingAnchor.current = null;
    destination.current = null;
    restoredPass.current = null;
    suspended.current = false;
    following.current = saved ? saved.following : true;
    // Seed this key's offset before anything is measured, so a transcript that
    // is not laid out yet cannot save the previous key's offset under the new one.
    lastTop.current = saved ? Math.max(0, saved.top) : 0;
    if (saved) {
      restoring.current = saved;
      applyRestore();
    } else if (element) element.scrollTop = 0;
    if (element) recordTop(element);
    return () => {
      // Runs while the transcript is still in the document, right before it is
      // hidden or removed for another view.
      remember(key);
    };
  }, [key, cancel, applyRestore, recordTop, remember, stopRestore]);
  useLayoutEffect(() => {
    const element = transcript.current;
    if (!element) return;
    // A restore that already landed owns this pass; the newest anchor must not
    // pull it away before the position is even rendered to the user.
    if (restoring.current) applyRestore();
    const pass = restoredPass.current;
    restoredPass.current = null;
    if (pass && pass.key === key && pass.count === count && pass.loading === loading) return;
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
  }, [key, count, loading, move, applyRestore]);
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
      // `hidden` (another workspace view) removes the layout box; its 0 sizes
      // would otherwise scroll the region to 0 and throw the position away.
      if (!element.clientHeight) {
        if (!suspended.current) {
          suspended.current = true;
          // Bank the last live offset before the browser drops it, so a hide
          // that keeps the same transcript mounted still remembers the position.
          remember(keyRef.current);
        }
        return;
      }
      if (suspended.current) {
        suspended.current = false;
        const saved = restoring.current ?? positionsRef.current?.get(keyRef.current) ?? null;
        if (saved) {
          // The same DOM came back with its offset cleared; put it back.
          readingAnchor.current = null;
          restoring.current = saved;
          restoreTries.current = 0;
          cancel();
          applyRestore();
          return;
        }
        if (following.current) {
          destination.current = () => element.scrollHeight;
          move(destination.current, true);
          return;
        }
      }
      if (restoring.current) {
        // Content growth during a pending restore is exactly the layout the
        // saved offset was waiting for.
        applyRestore(true);
        return;
      }
      const anchor = readingAnchor.current;
      if (following.current && destination.current) move(destination.current);
      if (!following.current && !frame.current && anchor?.element.isConnected) {
        const offset =
          anchor.element.getBoundingClientRect().top - element.getBoundingClientRect().top;
        if (Math.abs(offset - anchor.offset) > 1) {
          element.scrollTop += offset - anchor.offset;
          recordTop(element);
        }
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
  }, [applyRestore, cancel, interrupt, key, move, recordTop, remember]);
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
      if (!element) return;
      // A region without a layout box (`hidden`, another workspace view) reports
      // 0 for every metric; its scroll event must not read as "at the end".
      if (element.clientHeight <= 0) return;
      updateActive();
      recordTop(element);
      // Nothing scrolls yet (`hidden`, or a transcript shorter than its box):
      // this pass says nothing about whether the reader follows the end.
      if (element.scrollHeight - element.clientHeight <= 0) return;
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
      stopRestore();
      restoredPass.current = null;
      setHasNew(false);
    },
  };
}
