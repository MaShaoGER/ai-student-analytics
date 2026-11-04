"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConceptChart, type ChartData, type ChartItem, type ChartPickOrigin } from "./concept-chart";
import { HomeShowcase } from "./home-showcase";
import { RadialMenu, type RadialOption } from "./radial-menu";
import { SpatialOverview, type OverviewPlane } from "./spatial-overview";
import type { ConceptExplorerData, ConceptMetric, ConceptReading } from "@/lib/analysis/concept-explorer";
import {
  parseConceptLocation,
  conceptHref,
  conceptTitle,
  conceptDrawings,
  conceptRelationReason,
  metricLocation,
  CONCEPT_LABELS,
  CONCEPT_RELATIONS,
  DRAWING_LABELS,
  type ConceptLocation,
  type ConceptDrawing,
} from "@/lib/exploration/concepts";
import { CONCEPT_METRICS } from "@/lib/analysis/concept-explorer";
import type { DataSource, DatasetProfile } from "@/lib/analysis/types";
import { useMotionPreferences } from "./ui/motion-preferences";
import { CountUp, InkText, MaskRise } from "./ui/editorial-motion";
import styles from "./data-explorer.module.css";

type Api = (url: string, options?: RequestInit) => Promise<any>;
type TrailEntry = { id: string; href: string; title: string; centre: string; views: ConceptDrawing[]; scroll: number };
type EntryState = { scope: string; id: string; scroll: number };
type Remote = { key: string; data?: ConceptExplorerData; error?: string };
/** A concept the reader clicked in the chart; it opens a secondary selection, never navigates by itself. */
type Picked = { kind: "course"; course: string } | { kind: "metric"; metric: ConceptMetric };
/** The radial picker blooms from the mark that was picked (or the entry button that opened it). */
type Radial = { kind: "pick"; pick: Picked; origin: ChartPickOrigin } | { kind: "drawings"; origin: ChartPickOrigin };
/** Long lists stay in a scrollable detail dialog; picks and drawings use the radial menu. */
type Sheet = { kind: "routes" } | { kind: "data" };
/** Which semantic transition the next rendered scene plays. */
type MotionKind = "topic" | "return" | "drawing";

const RECENT_TOPICS = 5;
const HIDDEN = "样本 1–2 人，已隐藏";
const percent = (value: number, total: number) => (total ? ((value / total) * 100).toFixed(1) : "0.0");

function formatReading(metric: ConceptMetric, reading: ConceptReading) {
  if (reading.value === null) return reading.reason ?? "无数据";
  return metric === "score" ? `${reading.value.toFixed(2)} 分` : `${reading.value.toFixed(2)}%`;
}

function readLocation(datasetId: DataSource): ConceptLocation | string {
  const route = parseConceptLocation(window.location.href);
  if (route.status === "invalid") return route.message;
  if (route.datasetId && route.datasetId !== datasetId) return { scene: "home", drawing: "rank" };
  return route.location;
}

function centreOf(location: ConceptLocation) {
  if (location.scene === "home") return "课程 · 均分";
  if (location.scene === "course") return `课程 · ${location.course}`;
  return `${CONCEPT_LABELS[location.metric].name} · ${location.course}`;
}


function readTrail(key: string, datasetId: DataSource): TrailEntry[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item): TrailEntry[] => {
      if (!item || typeof item.id !== "string" || typeof item.href !== "string" || !Array.isArray(item.views)) return [];
      const route = parseConceptLocation(item.href);
      if (route.status !== "valid" || route.datasetId !== datasetId) return [];
      const allowed = conceptDrawings(route.location);
      const views = item.views.filter((view: unknown): view is ConceptDrawing => allowed.includes(view as ConceptDrawing));
      if (!views.length) return [];
      return [{ id: item.id, href: conceptHref(route.location, datasetId), title: conceptTitle(route.location), centre: centreOf(route.location), views, scroll: Number.isFinite(item.scroll) && item.scroll >= 0 ? item.scroll : 0 }];
    });
  } catch { return []; }
}

/** The one query a scene needs; the overview reuses it to restore visited scenes. */
function queryFor(location: ConceptLocation, datasetId: DataSource) {
  const params = new URLSearchParams({ datasetId });
  if (location.term) params.set("term", location.term);
  if (location.scene !== "home") params.set("course", location.course);
  return `/api/concept-explorer?${params}`;
}

/** Cache identity for one scene payload: the scope plus the exact query that produced it. */
const sceneKey = (location: ConceptLocation, datasetId: DataSource, scopeKey: string) =>
  `${scopeKey}::${queryFor(location, datasetId)}`;

/** Turns one scene's single dataset into chart items; every drawing renders exactly these. */
function chartData(location: ConceptLocation, data: ConceptExplorerData, pick: (picked: Picked, origin: ChartPickOrigin) => void): ChartData | string {
  const term = location.term;
  if (location.scene === "home" || (location.scene === "metric" && location.relation === "subject")) {
    const metric: ConceptMetric = location.scene === "home" ? "score" : location.metric;
    const label = CONCEPT_LABELS[metric];
    if (!data.courses.length) return "当前学期没有有效成绩记录";
    return {
      kind: "courses",
      unit: label.unit,
      axis: "课程",
      min: 0,
      max: 100,
      items: data.courses.map((course): ChartItem => {
        const reading = course.metrics[metric];
        return {
          key: course.course,
          label: course.course,
          value: reading.value,
          note: course.suppressed ? HIDDEN : reading.reason ?? "无数据",
          detail: `${course.course} · ${label.name} ${formatReading(metric, reading)}${course.count ? ` · ${course.count} 人` : ""}`,
          onPick: course.suppressed ? undefined : (origin) => pick({ kind: "course", course: course.course }, origin),
        };
      }),
    };
  }
  const course = data.courses.find((item) => item.course === location.course);
  if (!course) return "这门课不在当前学期中";
  if (course.suppressed) return "这门课样本少于 3 人，数值已隐藏";
  if (location.scene === "course") {
    return {
      kind: "profile",
      unit: "mixed",
      axis: "指标",
      min: 0,
      max: 100,
      items: CONCEPT_METRICS.map((metric): ChartItem => {
        const reading = course.metrics[metric];
        const usable = reading.value !== null && reading.count !== null;
        return {
          key: metric,
          label: CONCEPT_LABELS[metric].name,
          value: reading.value,
          note: reading.reason ?? "无数据",
          detail: `${CONCEPT_LABELS[metric].name} ${formatReading(metric, reading)}`,
          onPick: usable ? (origin) => pick({ kind: "metric", metric }, origin) : undefined,
        };
      }),
    };
  }
  const detail = data.detail;
  if (!detail) return "这门课没有可展示的明细";
  const hidden = HIDDEN;
  switch (location.relation) {
    case "trend":
      if (!detail.weeklyAttendance) return "当前数据源没有校园出勤记录";
      return {
        kind: "series", unit: "%", axis: "教学周", min: 0, max: 100,
        items: detail.weeklyAttendance.map((week) => ({
          key: String(week.week), label: String(week.week), value: week.value,
          note: week.suppressed ? "已隐藏" : "无记录",
          detail: week.value === null ? `第 ${week.week} 周 · ${week.suppressed ? hidden : "无记录"}` : `第 ${week.week} 周 · ${week.value.toFixed(2)}% · ${week.count} 课时`,
        })),
      };
    case "dist":
      return {
        kind: "series", unit: "人", axis: "成绩区间 / 分", min: 0,
        items: detail.scoreBins.map((bin) => {
          const range = `${bin.min}–${bin.max}${bin.includeMax ? "" : "（不含）"} 分`;
          return {
            key: String(bin.min), label: String(bin.min), value: bin.suppressed ? null : bin.count,
            note: "已隐藏", tone: bin.min < 60 ? "c" : undefined,
            detail: bin.suppressed ? `${range} · ${hidden}` : `${range} · ${bin.count} 人`,
          } satisfies ChartItem;
        }),
      };
    case "band-score":
    case "band-pass": {
      if (!detail.attendanceBands) return "当前数据源没有校园出勤记录";
      const score = location.relation === "band-score";
      return {
        kind: "series", unit: score ? "分" : "%", axis: "个人学期出勤率区间 / %", min: 0, max: 100,
        items: detail.attendanceBands.map((band) => {
          const range = `${band.min}–${band.max}%`;
          const value = band.suppressed || band.count === 0 ? null : score ? band.meanScore : band.passRate;
          return {
            key: String(band.min), label: range, value,
            note: band.suppressed ? "已隐藏" : "无人",
            detail: band.suppressed ? `出勤 ${range} · ${hidden}` : band.count === 0 ? `出勤 ${range} · 无人`
              : `出勤 ${range} · ${band.count} 人 · ${score ? `均分 ${band.meanScore?.toFixed(2)} 分` : `通过率 ${band.passRate?.toFixed(2)}%`}`,
          } satisfies ChartItem;
        }),
      };
    }
    case "split-pass":
    case "split-done": {
      const pass = location.relation === "split-pass";
      const counts = pass
        ? detail.passCounts && [detail.passCounts.passed, detail.passCounts.failed]
        : detail.completionCounts && [detail.completionCounts.completed, detail.completionCounts.incomplete];
      if (!counts) return pass ? "没有有效成绩" : "当前数据源没有课程完成标记";
      const [yes, no] = counts;
      const total = yes + no;
      return {
        kind: "parts", unit: "人", axis: pass ? "成绩" : "课程完成",
        items: [
          { key: "yes", label: pass ? "≥ 60 分" : "完成", value: yes, tone: "a", detail: `${pass ? "≥ 60 分" : "完成"} · ${yes} 人 · ${percent(yes, total)}%` },
          { key: "no", label: pass ? "< 60 分" : "未完成", value: no, tone: "c", detail: `${pass ? "< 60 分" : "未完成"} · ${no} 人 · ${percent(no, total)}%` },
        ],
      };
    }
    case "work": {
      const work = detail.homework;
      if (!work) return "当前数据源没有作业提交记录";
      return {
        kind: "parts", unit: "份", axis: "作业",
        items: ([["onTime", "按时", "a"], ["late", "迟交", "b"], ["missing", "缺交", "c"]] as const).map(([key, label, tone]) => ({
          key, label, tone, value: work[key], detail: `${label} · ${work[key]} 份 · 应交 ${work.scheduled} 份中 ${percent(work[key], work.scheduled)}%`,
        })),
      };
    }
  }
  return "这个关系没有数据";
}

export function DataExplorer({
  datasetId,
  profile,
  scopeKey,
  api,
  onLocationChange,
  canUseAI,
  onAI,
}: {
  datasetId: DataSource;
  profile: DatasetProfile;
  scopeKey: string;
  api: Api;
  onLocationChange: (href: string) => void;
  canUseAI: boolean;
  onAI: (context: { label: string; location: ConceptLocation; href: string }) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trailKey = `concept-trail:${scopeKey}:${datasetId}`;
  const [location, setLocation] = useState<ConceptLocation | string | null>(null);
  const [entryId, setEntryId] = useState("");
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const trailRef = useRef<TrailEntry[]>([]);
  const currentEntry = useRef("");
  const scrollPosition = useRef(0);
  const overviewTrigger = useRef<HTMLButtonElement>(null);
  const [remote, setRemote] = useState<Remote>({ key: "" });
  const [retry, setRetry] = useState(0);
  const [overview, setOverview] = useState(false);
  const [earlier, setEarlier] = useState(false);
  /** Explorer payloads already fetched in this scope, keyed by scope + the full query they answered. */
  const [planes, setPlanes] = useState<Record<string, ConceptExplorerData | undefined>>({});
  const [planeErrors, setPlaneErrors] = useState<Record<string, string | undefined>>({});
  const planeRequests = useRef(new Set<string>());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const sheetDialog = useRef<HTMLDialogElement>(null);
  const [radial, setRadial] = useState<Radial | null>(null);
  const drawingButton = useRef<HTMLButtonElement>(null);
  const trailStrip = useRef<HTMLOListElement>(null);
  const returnFocus = useRef<HTMLElement | SVGElement | null>(null);
  const [transition, setTransition] = useState<MotionKind>("topic");
  const { enabled, reduced } = useMotionPreferences();
  const motion = enabled && !reduced;
  const pendingScroll = useRef<number | null>(null);
  const focusAfter = useRef(false);

  const saveTrail = useCallback((next: TrailEntry[]) => {
    trailRef.current = next;
    setTrail(next);
    try { sessionStorage.setItem(trailKey, JSON.stringify(next)); } catch {}
  }, [trailKey]);

  /** Registers the current history entry as a trail topic, recording its drawing. */
  const record = useCallback((next: ConceptLocation, id: string, list: TrailEntry[]) => {
    const href = conceptHref(next, datasetId);
    const found = list.find((item) => item.id === id);
    const updated = found
      ? list.map((item) => item.id === id ? { ...item, href, views: item.views.includes(next.drawing) ? item.views : [...item.views, next.drawing] } : item)
      : [...list, { id, href, title: conceptTitle(next), centre: centreOf(next), views: [next.drawing], scroll: 0 }];
    saveTrail(updated);
  }, [datasetId, saveTrail]);

  // Restore from the URL on mount and on native back/forward. The scope check stops another account's state leaking in.
  useEffect(() => {
    const stored = readTrail(trailKey, datasetId);
    const currentHref = window.location.href;
    const currentSaved = window.history.state?.concept as EntryState | undefined;
    const currentRoute = readLocation(datasetId);
    const currentLocation = typeof currentRoute === "string" ? null : currentRoute;
    const currentSavedHref = currentLocation ? conceptHref(currentLocation, datasetId) : currentHref;
    const currentSavedEntry = stored.find((item) => item.href === currentSavedHref);
    const currentId = currentSaved?.scope === scopeKey && currentSaved.id ? currentSaved.id : currentSavedEntry?.id ?? crypto.randomUUID();
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const previousHome = stored.find((item) => item.href.includes("browse=home"));
    const homeLocation: ConceptLocation = { scene: "home", drawing: "rank", term: currentLocation?.term };
    const homeEntry: TrailEntry = previousHome ?? {
      id: crypto.randomUUID(), href: conceptHref(homeLocation, datasetId), title: conceptTitle(homeLocation),
      centre: centreOf(homeLocation), views: ["rank"], scroll: 0,
    };

    const topicsByHref = new Map<string, TrailEntry>();
    for (const item of stored) {
      if (item.href.includes("browse=home")) continue;
      const route = parseConceptLocation(item.href);
      if (route.status !== "valid") continue;
      const topicHref = conceptHref({ ...route.location, drawing: "bars" } as ConceptLocation, datasetId)
        .replace(/&drawing=bars(?=&|$)/, "");
      const previous = topicsByHref.get(topicHref);
      topicsByHref.set(topicHref, previous
        ? { ...previous, views: [...new Set([...previous.views, ...item.views])] }
        : { ...item, href: topicHref, views: [...item.views] });
    }
    const orderedTopics = [...topicsByHref.values()];
    const distinctTopics = [...new Map(orderedTopics.map((item) => [item.title === "课程全景" ? item.title : `${item.title}|${item.centre}`, item])).values()];
    let initialTrail = [homeEntry, ...distinctTopics];
    if (currentLocation && currentLocation.scene !== "home") {
      const currentTopicHref = conceptHref({ ...currentLocation, drawing: "bars" } as ConceptLocation, datasetId)
        .replace(/&drawing=bars(?=&|$)/, "");
      const currentRecord = topicsByHref.get(currentTopicHref) ?? {
        id: currentId, href: currentTopicHref, title: conceptTitle(currentLocation), centre: centreOf(currentLocation),
        views: [currentLocation.drawing], scroll: currentSaved?.scroll ?? 0,
      };
      currentRecord.id = currentId;
      currentRecord.views = [...new Set([...currentRecord.views, currentLocation.drawing])];
      initialTrail = [homeEntry, ...[...topicsByHref.values()].filter((item) => item.href !== currentTopicHref), currentRecord];
    }
    trailRef.current = initialTrail;
    try { sessionStorage.setItem(trailKey, JSON.stringify(initialTrail)); } catch {}
    const sync = (initial: boolean) => {
      if (!initial && currentEntry.current) {
        saveTrail(trailRef.current.map(item => item.id === currentEntry.current ? { ...item, scroll: scrollPosition.current } : item));
      }
      const next = readLocation(datasetId);
      const saved = window.history.state?.concept as EntryState | undefined;
      const id = saved?.scope === scopeKey && saved.id ? saved.id : crypto.randomUUID();
      if (typeof next !== "string") {
        const href = conceptHref(next, datasetId);
        if (!saved || saved.scope !== scopeKey)
          window.history.replaceState({ ...window.history.state, concept: { scope: scopeKey, id, scroll: 0 } }, "", href);
        record(next, id, trailRef.current);
        onLocationChange(href);
      }
      pendingScroll.current = saved?.scope === scopeKey ? trailRef.current.find(item => item.id === id)?.scroll ?? saved.scroll : 0;
      currentEntry.current = id;
      scrollPosition.current = pendingScroll.current ?? 0;
      focusAfter.current = !initial;
      setTransition(initial ? "topic" : "return");
      setSheet(null);
      setEntryId(id);
      setLocation(next);
    };
    sync(true);
    const onPop = () => sync(false);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.history.scrollRestoration = previousRestoration;
    };
  }, [datasetId, scopeKey, trailKey, record, saveTrail, onLocationChange]);

  const saveReading = useCallback(() => {
    const saved = window.history.state?.concept as EntryState | undefined;
    if (saved?.scope !== scopeKey) return;
    const scroll = window.scrollY;
    scrollPosition.current = scroll;
    window.history.replaceState({ ...window.history.state, concept: { ...saved, scroll } }, "", window.location.href);
    saveTrail(trailRef.current.map(item => item.id === saved.id ? { ...item, scroll } : item));
  }, [scopeKey, saveTrail]);
  useEffect(() => {
    let timer: number;
    const scroll = () => {
      scrollPosition.current = window.scrollY;
      window.clearTimeout(timer);
      timer = window.setTimeout(saveReading, 150);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("exploration:leave", saveReading);
    window.addEventListener("pagehide", saveReading);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("exploration:leave", saveReading);
      window.removeEventListener("pagehide", saveReading);
    };
  }, [saveReading]);

  const valid = location && typeof location !== "string" ? location : null;
  const queryKey = valid ? queryFor(valid, datasetId) : "";
  // Payloads never cross an account/scope boundary: both the live scene and the overview cache key on this.
  const cacheKey = valid ? sceneKey(valid, datasetId, scopeKey) : "";

  // Only the latest query may write; drawing/relation changes keep the same key, so they never refetch.
  useEffect(() => {
    if (!queryKey || !cacheKey) return;
    const controller = new AbortController();
    setRemote((prev) => prev.key === cacheKey && prev.data ? prev : { key: cacheKey });
    api(queryKey, { signal: controller.signal })
      .then((data: ConceptExplorerData) => { if (!controller.signal.aborted) setRemote({ key: cacheKey, data }); })
      .catch((error: Error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        setRemote({ key: cacheKey, error: error?.message || "数据加载失败" });
      });
    return () => controller.abort();
  }, [api, queryKey, cacheKey, retry]);

  const data = remote.key === cacheKey ? remote.data : undefined;
  const error = remote.key === cacheKey ? remote.error : undefined;

  // The overview may only show payloads this component actually received; another scope starts empty.
  useEffect(() => {
    setPlanes({});
    setPlaneErrors({});
    planeRequests.current.clear();
  }, [scopeKey, datasetId]);
  useEffect(() => {
    if (!data || !cacheKey) return;
    setPlanes((prev) => prev[cacheKey] === data ? prev : { ...prev, [cacheKey]: data });
  }, [data, cacheKey]);

  // After the scene data is in, restore scroll or move focus to the new heading.
  useEffect(() => {
    if (!data) return;
    if (pendingScroll.current !== null) {
      const top = pendingScroll.current;
      pendingScroll.current = null;
      requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
    }
    if (focusAfter.current) {
      focusAfter.current = false;
      root.current?.querySelector<HTMLElement>("[data-scene-heading]")?.focus({ preventScroll: true });
    }
  }, [data, entryId]);

  /** Explicit commits only: candidates and cancel never reach here, so they never change data, scroll or history. */
  const go = useCallback((next: ConceptLocation, previous?: TrailEntry) => {
    saveReading();
    const id = previous?.id ?? crypto.randomUUID();
    const scroll = previous?.scroll ?? 0;
    const href = conceptHref(next, datasetId);
    window.history.pushState({ ...window.history.state, concept: { scope: scopeKey, id, scroll } }, "", href);
    record(next, id, trailRef.current);
    onLocationChange(href);
    focusAfter.current = true;
    pendingScroll.current = scroll;
    currentEntry.current = id;
    scrollPosition.current = scroll;
    returnFocus.current = null;
    setTransition(previous ? "return" : "topic");
    setSheet(null);
    setRadial(null);
    setEntryId(id);
    setLocation(next);
    setOverview(false);
  }, [datasetId, scopeKey, record, saveReading, onLocationChange]);

  /** Same data, another drawing: replace the entry, then return focus to whatever opened the choice. */
  const draw = useCallback((drawing: ConceptDrawing) => {
    if (!valid) return;
    const next = { ...valid, drawing } as ConceptLocation;
    const href = conceptHref(next, datasetId);
    window.history.replaceState(window.history.state, "", href);
    record(next, entryId, trailRef.current);
    onLocationChange(href);
    setTransition("drawing");
    setLocation(next);
    setSheet(null);
    setRadial(null);
    const target = returnFocus.current ?? drawingButton.current;
    returnFocus.current = null;
    requestAnimationFrame(() => (target?.isConnected ? target : drawingButton.current)?.focus({ preventScroll: true }));
  }, [valid, datasetId, record, entryId, onLocationChange]);

  const openSheet = useCallback((next: Sheet) => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    setRadial(null);
    setSheet(next);
  }, []);
  /** Cancel: nothing but the dialog changes; focus returns to the mark or entry that opened it. */
  const closeSheet = useCallback(() => {
    setSheet(null);
    const target = returnFocus.current;
    returnFocus.current = null;
    requestAnimationFrame(() => target?.isConnected && target.focus({ preventScroll: true }));
  }, []);
  const openRadial = useCallback((next: Radial) => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    setSheet(null);
    setRadial(next);
  }, []);
  const closeRadial = useCallback(() => {
    setRadial(null);
    const target = returnFocus.current;
    returnFocus.current = null;
    requestAnimationFrame(() => target?.isConnected && target.focus({ preventScroll: true }));
  }, []);
  const closeOverview = useCallback(() => {
    setOverview(false);
    requestAnimationFrame(() => overviewTrigger.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const dialog = sheetDialog.current;
    if (sheet && dialog && !dialog.open) dialog.showModal();
    if (!sheet && dialog?.open) dialog.close();
  }, [sheet]);

  const visible = trail;
  const home = visible.find((item) => item.href.includes("browse=home"));
  const topics = visible.filter((item) => item !== home);
  const recent = topics.slice(-RECENT_TOPICS);
  const older = topics.slice(0, -RECENT_TOPICS);
  const shown = visible.filter((item) =>
    item === home || item.id === entryId || recent.includes(item) || (earlier && older.includes(item)));

  // Keep the current step inside the compact strip without turning the page.
  useEffect(() => {
    const strip = trailStrip.current;
    const mark = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !mark) return;
    const start = mark.offsetLeft;
    const end = start + mark.offsetWidth;
    if (start < strip.scrollLeft || end > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = Math.max(0, start - (strip.clientWidth - mark.offsetWidth) / 2);
    }
  }, [entryId, visible.length]);

  /** Fills the overview cache with the same permission-scoped query the page itself uses. */
  const loadPlane = (entry: TrailEntry, retryFailed = false) => {
    const route = parseConceptLocation(entry.href);
    if (route.status !== "valid") return;
    const query = queryFor(route.location, datasetId);
    const key = sceneKey(route.location, datasetId, scopeKey);
    if (planes[key] || planeRequests.current.has(key) || (!retryFailed && planeErrors[key])) return;
    planeRequests.current.add(key);
    api(query)
      .then((payload: ConceptExplorerData) => setPlanes((prev) => prev[key] ? prev : { ...prev, [key]: payload }))
      .catch((failure: Error) => {
        if (failure?.name === "AbortError") return;
        setPlaneErrors((prev) => ({ ...prev, [key]: "这次访问的数据没能恢复，请回到原位置重试" }));
      })
      .finally(() => planeRequests.current.delete(key));
  };
  const openOverview = () => {
    if (!shown.length) return;
    saveReading();
    setPlaneErrors((prev) => Object.keys(prev).length ? {} : prev);
    shown.forEach((item) => loadPlane(item, true));
    setOverview(true);
  };

  if (typeof location === "string") {
    return (
      <div ref={root} className={styles.root}>
        <div className={styles.state} role="alert">
          <p>{location}</p>
          <button type="button" className={styles.action} onClick={() => go({ scene: "home", drawing: "rank" })}>回到课程全景</button>
        </div>
      </div>
    );
  }
  if (!valid) return <div ref={root} className={styles.root}><p className={styles.state} role="status">正在打开数据浏览…</p></div>;

  const drawings = conceptDrawings(valid);
  const plot = data ? chartData(valid, data, (pick, origin) => openRadial({ kind: "pick", pick, origin })) : null;
  const course = data && valid.scene !== "home" ? data.courses.find((item) => item.course === valid.course) : undefined;
  const allScope = valid.scene === "metric" && CONCEPT_RELATIONS[valid.metric].find((option) => option.id === valid.relation)?.scope === "all";
  const termLabel = data?.term ?? valid.term ?? "最新学期";
  const scope = !data ? termLabel
    : valid.scene === "home" ? `${termLabel} · ${data.totalCourses} 门课程${data.totalCourses > data.courseLimit ? `，显示前 ${data.courseLimit} 门` : ""}`
      : allScope ? `${termLabel} · 共 ${data.totalCourses} 门课程${data.totalCourses > data.courses.length ? `，展示 ${data.courses.length} 门` : ""}（由「${valid.course}」显式扩展）`
        : `${termLabel} · ${valid.course} · ${course?.count ?? "样本少于 3"} 人`;
  /** The course page leads with its own mean score: six metrics mix 分, %, 课时 and 份, so no cross-metric maximum. */
  const scoreReading = course?.metrics.score;
  const heroValue = valid.scene === "course" ? scoreReading?.value ?? null : null;
  const heroCount = scoreReading?.count ?? null;
  const heroVisible = heroValue !== null && heroCount !== null && heroCount >= 3 && !course?.suppressed;
  const heroMissing = valid.scene === "course" && course && !heroVisible
    ? course.suppressed
      ? `课程均分：${HIDDEN}`
      : heroCount !== null && heroCount < 3
        ? "课程均分：有效成绩不足 3 人，已隐藏"
        : `课程均分：${scoreReading?.reason ?? "这学期没有可用成绩记录"}`
    : null;
  const title = conceptTitle(valid);
  const href = conceptHref(valid, datasetId);
  const position = visible.findIndex((item) => item.id === entryId);
  const previous = position > 0 ? visible[position - 1] : undefined;
  const following = position >= 0 && position < visible.length - 1 ? visible[position + 1] : undefined;
  /** Compact trail: real two-digit ordinals; past six entries only the home page and the neighbourhood stay visible. */
  const trailMarks = visible
    .map((item, index) => ({ item, ordinal: index + 1 }))
    .filter((_, index) => visible.length <= 6 || index === 0 || index === position || Math.abs(index - position) <= 2);
  const openEntry = (item: TrailEntry, kind: MotionKind) => {
    const route = parseConceptLocation(item.href);
    if (route.status !== "valid") return;
    go(route.location, item);
    setTransition(kind);
  };
  const hint = valid.scene === "home" ? "点一门课程，选择去向或换画法。"
    : valid.scene === "course" ? "点一项指标，打开它的关联。"
      : allScope ? "已显式扩展到全部课程；点一门课可从它重新开始。"
        : "换画法只换表达，范围与分母不变。";

  /** One row of the long lists that stay in the scrollable detail dialog. */
  const asRow = (choice: RadialOption) => (
    <li key={choice.key}>
      <button type="button" className={styles.option} disabled={choice.disabled} aria-current={choice.current || undefined}
        onClick={choice.current ? closeSheet : choice.onSelect}>
        <span className={styles.optionLabel}>{choice.label}</span>
        {(choice.note || choice.current) && <span className={styles.optionNote}>{choice.current ? `当前${choice.note ? ` · ${choice.note}` : ""}` : choice.note}</span>}
      </button>
    </li>
  );
  /** Same data, another drawing: replaces the entry's drawing and never adds history or a request. */
  const drawingOptions: RadialOption[] = drawings.map((drawing) => ({
    key: drawing, kind: "drawing", label: DRAWING_LABELS[drawing],
    current: drawing === valid.drawing,
    onSelect: () => draw(drawing),
  }));
  const relationOptions = (target: ConceptMetric): RadialOption[] => CONCEPT_RELATIONS[target].map((relation) => {
    const reason = data ? conceptRelationReason(target, relation.id, data) : null;
    return {
      key: relation.id,
      kind: "topic",
      label: relation.label,
      note: reason ?? (relation.scope === "all" ? "扩展到全部课程" : `仅「${valid.scene === "home" ? "" : valid.course}」`),
      disabled: !!reason,
      current: valid.scene === "metric" && valid.metric === target && valid.relation === relation.id,
      onSelect: () => {
        if (valid.scene === "home") return;
        go({ scene: "metric", course: valid.course, metric: target, relation: relation.id, drawing: relation.drawings[0], term: valid.term });
      },
    };
  });
  const topicSection = (label: string, rows: ReactNode) => (
    <section className={styles.group} aria-label={label}>
      <h3 className={styles.groupTitle}>{label}</h3>
      <p className={styles.groupHint}>改变探索中心，进入新的一页。</p>
      <ul className={styles.options}>{rows}</ul>
    </section>
  );
  let sheetBody: ReactNode = null;
  let sheetEyebrow = "";
  let sheetTitle = "";
  if (sheet && data) {
    if (sheet.kind === "routes") {
      sheetEyebrow = title;
      sheetTitle = "去向";
      sheetBody = valid.scene === "home" ? (
        <>
          {data.terms.length > 1 && (
            <section className={styles.group} aria-labelledby="sheet-terms">
              <h3 id="sheet-terms" className={styles.groupTitle}>学期</h3>
              <ul className={styles.options} data-inline>
                {data.terms.map((term) => asRow({ key: term, kind: "topic", label: term, current: term === data.term, onSelect: () => go({ scene: "home", drawing: valid.drawing, term }) }))}
              </ul>
            </section>
          )}
          {topicSection("选一门课程作为中心", data.courses.map((item) => asRow({
            key: item.course, kind: "topic", label: item.course,
            note: item.suppressed ? "样本少于 3 人，已隐藏" : `${formatReading("score", item.metrics.score)} · ${item.count} 人`,
            disabled: item.suppressed,
            onSelect: () => go({ scene: "course", course: item.course, drawing: "bars", term: data.term ?? undefined }),
          })))}
        </>
      ) : valid.scene === "course" ? (
        <>
          {course && topicSection("从一项指标出发", CONCEPT_METRICS.map((metric) => {
            const next = metricLocation(valid.course, metric, valid.term, data);
            const usable = course.metrics[metric].value !== null && course.metrics[metric].count !== null && next;
            return asRow({ key: metric, kind: "topic", label: CONCEPT_LABELS[metric].name, note: formatReading(metric, course.metrics[metric]), disabled: !usable, onSelect: () => next && go(next) });
          }))}
          {topicSection("离开这门课", asRow({ key: "home", kind: "topic", label: "课程全景", note: "全部课程的均分", onSelect: () => go({ scene: "home", drawing: "rank", term: valid.term }) }))}
        </>
      ) : (
        <>
          {topicSection(`「${CONCEPT_LABELS[valid.metric].name}」的其他关联`, relationOptions(valid.metric).map(asRow))}
          {course && topicSection("换一个指标作为中心", CONCEPT_METRICS.filter((metric) => metric !== valid.metric).map((metric) => {
            const next = course.metrics[metric].value === null || course.metrics[metric].count === null ? null : metricLocation(valid.course, metric, valid.term, data);
            return asRow({ key: metric, kind: "topic", label: CONCEPT_LABELS[metric].name, note: next ? formatReading(metric, course.metrics[metric]) : course.metrics[metric].reason ?? "无数据", disabled: !next, onSelect: () => next && go(next) });
          }))}
          {topicSection("回到上一层", asRow({ key: "course", kind: "topic", label: `课程「${valid.course}」`, note: "六项统一指标", onSelect: () => go({ scene: "course", course: valid.course, drawing: "bars", term: valid.term }) }))}
        </>
      );
    } else if (sheet.kind === "data") {
      sheetEyebrow = title;
      sheetTitle = "数据与口径";
      sheetBody = (
        <>
          {valid.scene === "course" && course ? (
            <table className={styles.table}>
              <caption className={styles.groupTitle}>统一指标</caption>
              <thead><tr><th scope="col">指标</th><th scope="col">数值</th><th scope="col">贡献样本</th></tr></thead>
              <tbody>
                {CONCEPT_METRICS.map((metric) => (
                  <tr key={metric}>
                    <th scope="row">{CONCEPT_LABELS[metric].name}<small>{CONCEPT_LABELS[metric].definition}</small></th>
                    <td>{formatReading(metric, course.metrics[metric])}</td>
                    <td>{course.metrics[metric].count === null ? "—" : `${course.metrics[metric].count} 人`}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">目标达成率<small>未配置教学目标定义，不用完成率代替</small></th>
                  <td>未配置</td><td>—</td>
                </tr>
              </tbody>
            </table>
          ) : typeof plot === "object" && plot ? (
            <section className={styles.group} aria-labelledby="sheet-values">
              <h3 id="sheet-values" className={styles.groupTitle}>图中读数</h3>
              <ol className={styles.values}>{plot.items.map((item) => <li key={item.key}>{item.detail}</li>)}</ol>
            </section>
          ) : null}
          {valid.scene === "metric" && <p className={styles.definition}>{CONCEPT_LABELS[valid.metric].name}：{CONCEPT_LABELS[valid.metric].definition}</p>}
          {valid.scene === "home" && <p className={styles.definition}>均分：{CONCEPT_LABELS.score.definition}</p>}
          <p className={styles.groupHint}>样本少于 3 人的组隐藏，缺失不补 0。数据源：{profile.name}{data.synthetic ? "（演示合成数据）" : ""}。</p>
        </>
      );
    }
  }

  /** Radial content: the same topics and drawings the old side sheet offered, anchored on the picked mark. */
  let radialModel: { eyebrow: string; title: string; reading?: ReactNode; options: RadialOption[] } | null = null;
  if (radial && data) {
    if (radial.kind === "drawings") {
      radialModel = { eyebrow: title, title: "换画法", reading: "范围、口径与分母不变，不新增探索记录。", options: drawingOptions };
    } else {
      const { pick } = radial;
      if (pick.kind === "course") {
        const picked = data.courses.find((item) => item.course === pick.course);
        const metric: ConceptMetric = valid.scene === "metric" ? valid.metric : "score";
        const next = picked && valid.scene === "metric" ? metricLocation(picked.course, metric, valid.term, data) : null;
        radialModel = {
          eyebrow: "已选课程",
          title: picked?.course ?? pick.course,
          reading: picked ? <>{CONCEPT_LABELS[metric].name} <strong>{formatReading(metric, picked.metrics[metric])}</strong>{picked.count ? ` · ${picked.count} 人` : ""}</> : undefined,
          options: picked ? [
            {
              key: "course", kind: "topic", label: `进入课程「${picked.course}」`, note: "六项统一指标",
              onSelect: () => go({ scene: "course", course: picked.course, drawing: "bars", term: data.term ?? undefined }),
            },
            ...(valid.scene === "metric" ? [{
              key: "metric", kind: "topic" as const,
              label: `看「${picked.course}」的${CONCEPT_LABELS[metric].name}关联`,
              note: next ? undefined : "这门课没有可用关联",
              disabled: !next,
              current: picked.course === valid.course && valid.relation !== "subject",
              onSelect: () => next && go(next),
            }] : []),
            ...drawingOptions,
          ] : drawingOptions,
        };
      } else {
        const metric = pick.metric;
        radialModel = {
          eyebrow: `已选指标${valid.scene === "home" ? "" : ` · ${valid.course}`}`,
          title: CONCEPT_LABELS[metric].name,
          reading: course ? <>{CONCEPT_LABELS[metric].name} <strong>{formatReading(metric, course.metrics[metric])}</strong>{course.metrics[metric].count !== null ? ` · ${course.metrics[metric].count} 人贡献` : ""}</> : undefined,
          options: [...relationOptions(metric), ...drawingOptions],
        };
      }
    }
  }

  /** Every visited topic becomes one translucent plane; only payloads this scope really received are drawn. */
  const planeList: OverviewPlane[] = shown.flatMap((item) => {
    const route = parseConceptLocation(item.href);
    if (route.status !== "valid") return [];
    const key = sceneKey(route.location, datasetId, scopeKey);
    const payload = planes[key];
    const plot: OverviewPlane["plot"] = payload
      ? chartData(route.location, payload, () => {})
      : planeErrors[key] ?? "正在恢复这次访问的真实数据…";
    return [{
      id: item.id,
      title: item.title,
      centre: item.centre,
      views: item.views,
      plot,
      current: item.id === entryId,
      currentDrawing: item.id === entryId ? valid.drawing : undefined,
    }];
  });
  /** Entering a plane reuses the trail entry's own history state, scroll and restore path. */
  const enterPlane = (id: string, drawing: ConceptDrawing) => {
    const item = trailRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    const route = parseConceptLocation(item.href);
    if (route.status !== "valid") return;
    go({ ...route.location, drawing } as ConceptLocation, item);
    setTransition("return");
  };

  return (
    <div ref={root} className={styles.root} data-motion={motion ? "on" : "off"}>
      <div className={styles.periphery} aria-hidden />
      {valid.scene === "home" && data && !error && (
        <div className={styles.homeShowcase} data-home-showcase>
          <HomeShowcase courses={data.courses} term={termLabel} totalCourses={data.totalCourses}
            onPick={(course, origin) => openRadial({ kind: "pick", pick: { kind: "course", course }, origin })} />
        </div>
      )}
      <article className={styles.poster} aria-busy={!data && !error} data-transition={transition} data-navigation-motion>
        <header className={styles.head} key={`head:${entryId}`}>
          <InkText text={centreOf(valid)} as="p" className={styles.eyebrow} step={18} />
          {valid.scene === "home" && data
            ? <h2 className={styles.title} tabIndex={-1} data-scene-heading><MaskRise className={styles.titleMask}>{title}</MaskRise></h2>
            : <h1 className={styles.title} tabIndex={-1} data-scene-heading><MaskRise className={styles.titleMask}>{title}</MaskRise></h1>}
          <InkText text={`${scope}${data?.synthetic ? " · 演示合成数据" : ""}`} as="p" className={styles.scope} step={18} delay={40} />
          {data && !error && <InkText text={hint} as="p" className={styles.hint} step={16} delay={120} />}
          {heroVisible && heroValue !== null && heroCount !== null ? (
            <div className={styles.lead} data-navigation-motion>
              <p className={styles.leadNumber}>
                <CountUp className={styles.heroNumber} value={heroValue} duration={0.6}
                  format={(value) => value.toFixed(2)} />
                <span className={styles.heroUnit}>分</span>
              </p>
              <InkText text={`课程均分 · 有效成绩贡献 ${heroCount} 人`} as="p" className={styles.leadNote} step={16} delay={140} />
            </div>
          ) : heroMissing ? (
            <p className={styles.leadMissing} data-navigation-motion>{heroMissing}</p>
          ) : null}
          {data && !error && (
            <div className={styles.entries} role="group" aria-label="按需打开" data-navigation-motion>
              {drawings.length > 1 && (
                <button ref={drawingButton} type="button" className={styles.entry} aria-haspopup="dialog"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openRadial({ kind: "drawings", origin: { x: rect.left + rect.width / 2, y: rect.bottom } });
                  }}>
                  <span>画法</span><strong>{DRAWING_LABELS[valid.drawing]}</strong>
                </button>
              )}
              <button type="button" className={styles.entry} aria-haspopup="dialog" onClick={() => openSheet({ kind: "routes" })}>
                <span>去向</span><strong>{valid.scene === "home" ? "课程 · 学期" : valid.scene === "course" ? "指标" : "关联 · 指标"}</strong>
              </button>
              <button type="button" className={styles.entry} aria-haspopup="dialog" onClick={() => openSheet({ kind: "data" })}>
                <span>数据</span><strong>读数与口径</strong>
              </button>
            </div>
          )}
        </header>

        <section className={styles.stage} aria-label={`${title} · 主图`}>
          {error ? (
            <div className={styles.state} role="alert">
              <p>{error}</p>
              <button type="button" className={styles.action} onClick={() => setRetry((value) => value + 1)}>重试</button>
              {valid.scene !== "home" && <button type="button" className={styles.ghost} onClick={() => go({ scene: "home", drawing: "rank", term: valid.term })}>回到课程全景</button>}
            </div>
          ) : !data ? (
            <p className={styles.state} role="status"><span className={styles.loader} aria-hidden />正在读取{valid.scene === "home" ? "课程目录" : `「${valid.course}」`}的聚合数据…</p>
          ) : (
            <figure className={styles.figure} key={`figure:${entryId}:${valid.drawing}`} data-navigation-motion>
              {typeof plot === "string" || !plot
                ? <p className={styles.state}>{plot ?? "没有数据"}</p>
                : <ConceptChart data={plot} drawing={valid.drawing} label={`${title} · ${DRAWING_LABELS[valid.drawing]}`} />}
              <InkText as="figcaption" className={styles.caption} step={14} delay={120}
                text={`${DRAWING_LABELS[valid.drawing]}${valid.scene === "course" ? " · 均分单位：分；其余指标：%" : ""} · 样本少于 3 人的组隐藏，缺失不补 0。`} />
            </figure>
          )}
        </section>

        <nav className={styles.pager} aria-label="探索前后页">
          <ol ref={trailStrip} className={styles.trail} role="list" aria-label={visible.length > 6 ? "探索轨迹（仅显示首页与相邻页）" : "探索轨迹"} data-collapsed={visible.length > 6 ? "" : undefined}>
            {trailMarks.map(({ item, ordinal }, index) => (
              <Fragment key={item.id}>
                {index > 0 && ordinal - trailMarks[index - 1].ordinal > 1 && (
                  <li className={styles.trailGap} aria-hidden>…</li>
                )}
                <li>
                  <button type="button" className={styles.trailMark}
                    aria-current={item.id === entryId ? "page" : undefined}
                    aria-label={`第 ${ordinal} 步 · ${item.title}`} title={item.title}
                    onClick={() => { if (item.id !== entryId) openEntry(item, "return"); }}>
                    <span>{String(ordinal).padStart(2, "0")}</span>
                  </button>
                </li>
              </Fragment>
            ))}
          </ol>
          {previous ? (
            <button type="button" className={styles.page} data-direction="previous" onClick={() => openEntry(previous, "return")}>
              <span>← 上一页</span><strong>{previous.title}</strong>
            </button>
          ) : <span className={styles.page} data-direction="previous" aria-hidden />}
          {following ? (
            <button type="button" className={styles.page} data-direction="next" onClick={() => openEntry(following, "topic")}>
              <span>下一页 →</span><strong>{following.title}</strong>
            </button>
          ) : <span className={styles.page} data-direction="next" aria-hidden />}
        </nav>
      </article>

      <nav className={styles.cornerLeft} aria-label="探索">
        <button ref={overviewTrigger} type="button" className={styles.ghost} onClick={openOverview} aria-expanded={overview}>
          全览{visible.length > 1 ? ` · ${visible.length}` : ""}
        </button>
        <button type="button" className={styles.ghost} aria-current={valid.scene === "home" || undefined} onClick={() => {
          const route = home ? parseConceptLocation(home.href) : null;
          go(route?.status === "valid" ? route.location : { scene: "home", drawing: "rank", term: valid.term }, home);
        }}>首页</button>
      </nav>
      {canUseAI && (
        <button type="button" className={styles.cornerRight} onClick={() => onAI({ label: `${title} · ${scope}`, location: valid, href })}>
          带着「{title}」问 AI
        </button>
      )}

      <dialog ref={sheetDialog} className={styles.sheet} aria-labelledby="explorer-sheet-title" data-navigation-motion
        onCancel={(event) => { event.preventDefault(); closeSheet(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeSheet(); }}>
        {sheet && (
          <div className={styles.sheetInner}>
            <header className={styles.sheetHead}>
              <div>
                <p className={styles.eyebrow}>{sheetEyebrow}</p>
                <h2 id="explorer-sheet-title">{sheetTitle}</h2>
              </div>
              <button type="button" className={styles.ghost} onClick={closeSheet}>取消（Esc）</button>
            </header>
            {sheetBody}
          </div>
        )}
      </dialog>

      {overview && planeList.length > 0 && (
        <SpatialOverview planes={planeList} earlierCount={older.length} showEarlier={earlier}
          onToggleEarlier={() => {
            if (!earlier) older.forEach((item) => loadPlane(item, true));
            setEarlier((value) => !value);
          }}
          motion={motion} onEnter={enterPlane} onClose={closeOverview} />
      )}

      {radial && radialModel && (
        <RadialMenu origin={radial.origin} eyebrow={radialModel.eyebrow} title={radialModel.title}
          reading={radialModel.reading} options={radialModel.options} motion={motion} onClose={closeRadial} />
      )}
    </div>
  );
}
