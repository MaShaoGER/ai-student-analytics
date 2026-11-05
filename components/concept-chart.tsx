"use client";

import { useId } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { ConceptDrawing } from "@/lib/exploration/concepts";
import type { PickAnchor } from "@/lib/exploration/selection";
import styles from "./concept-chart.module.css";

/** Viewport point where a mark was picked, so the picker can open over the mark itself. */
export type ChartPickOrigin = PickAnchor;

/** One dataset per scene; every drawing renders exactly these items. */
export type ChartItem = {
  key: string;
  label: string;
  value: number | null;
  /** Shown instead of a mark when value is null. */
  note?: string;
  detail: string;
  tone?: "a" | "b" | "c";
  onPick?: (origin: ChartPickOrigin) => void;
};
export type ChartData = {
  kind: "courses" | "profile" | "series" | "parts";
  unit: string;
  axis: string;
  min?: number;
  max?: number;
  items: ChartItem[];
};

const fmt = (value: number, unit: string) => unit === "mixed" ? value.toFixed(1) : `${unit === "人" || unit === "份" ? Math.round(value) : value.toFixed(1)}${unit === "%" ? "%" : ` ${unit}`}`;

/** Center of the mark in viewport coordinates; used when a pick carries no pointer position. */
function markOrigin(element: Element): ChartPickOrigin {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** A pickable mark opens the explorer's secondary selection; it never navigates by itself. */
function pickKeys(item: ChartItem) {
  if (!item.onPick) return {};
  const onPick = item.onPick;
  const onClick = (event: MouseEvent<SVGGElement>) => {
    // Assistive-technology and synthetic clicks report no pointer position; anchor to the mark.
    onPick(event.detail === 0 && event.clientX === 0 && event.clientY === 0
      ? markOrigin(event.currentTarget)
      : { x: event.clientX, y: event.clientY });
  };
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPick(markOrigin(event.currentTarget));
  };
  return { tabIndex: 0, role: "button", "aria-haspopup": "dialog" as const, "aria-label": `${item.detail}，选择去向或画法`, "data-interactive": "", onClick, onKeyDown };
}

/** Null because the sample is too small to publish (n < 3) — withheld, not empty and not zero. */
const withheld = (item: ChartItem) => item.value === null && /隐藏/.test(item.note ?? "");

/** Diagonal hatch fill for withheld marks: pattern colours come from the sheet tokens, never new ones. */
function useHatch() {
  const id = `withheld-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return {
    fill: `url(#${id})`,
    defs: (
      <defs>
        <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className={styles.hatchGround} width="6" height="6" />
          <line className={styles.hatchLine} x1="0" y1="0" x2="0" y2="6" />
        </pattern>
      </defs>
    ),
  };
}

/** Withheld marks explain themselves in sheet typography, not the browser's default title bubble.
 *  The anchor is the mark's top-left in user units (every drawing is 820 wide); the tooltip sits
 *  just above it and hangs to whichever side still fits on the sheet. */
function SuppressedTip({ at, text }: { at: readonly [number, number]; text: string }) {
  const width = 360;
  const hangLeft = at[0] > 430;
  return (
    <foreignObject
      className={styles.tipFrame}
      data-side={hangLeft ? "left" : "right"}
      x={hangLeft ? Math.max(2, at[0] - width) : Math.max(2, Math.min(at[0], 820 - width))}
      y={Math.max(2, at[1] - 30)}
      width={width}
      height={26}
      aria-hidden
    >
      <div className={styles.tip}>{text}</div>
    </foreignObject>
  );
}

export function ConceptChart({ data, drawing, label, compact = false }: { data: ChartData; drawing: ConceptDrawing; label: string; compact?: boolean }) {
  const values = data.items.map((item) => item.value).filter((value): value is number => value !== null);
  if (!values.length) return <p className={styles.empty}>{data.items[0]?.note ?? "这组数据没有可显示的值"}</p>;
  const min = data.min ?? 0;
  const max = data.max ?? Math.max(1, Math.ceil((Math.max(...values) * 1.12) / 5) * 5);
  const chart = drawing === "rank" ? <Rank data={data} max={max} label={label} compact={compact} />
    : drawing === "radar" ? <Radar data={data} label={label} compact={compact} />
      : drawing === "stack" ? <Stack data={data} label={label} compact={compact} />
        : <Cartesian data={data} drawing={drawing} min={min} max={max} label={label} compact={compact} />;
  return compact ? chart : <div className={styles.viewport} tabIndex={0} role="region" aria-label={`${label}，窄屏可横向滚动`}><p className={styles.scrollHint}>图表可在此区域内横向滚动</p>{chart}</div>;
}

function Rank({ data, max, label, compact }: { data: ChartData; max: number; label: string; compact: boolean }) {
  const items = [...data.items].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const hatch = useHatch();
  const row = compact ? 9 : 30, W = 820, L = compact ? 8 : 230, H = items.length * row + 28;
  const x = (value: number) => L + (value / max) * (W - L - 70);
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
      {items.some(withheld) && hatch.defs}
      {items.map((item, i) => {
        const y = 14 + i * row;
        return (
          <g key={item.key} className={styles.datum} {...(compact ? {} : pickKeys(item))}>
            {(compact || !withheld(item)) && <title>{item.detail}</title>}
            {!compact && <text className={styles.label} x={L - 12} y={y + row / 2 + 4} textAnchor="end">{item.label.length > 14 ? `${item.label.slice(0, 13)}…` : item.label}</text>}
            <rect className={styles.track} data-void={item.value === null || undefined} x={L} y={y + row * 0.2} width={W - L - 70} height={row * 0.6} />
            {withheld(item) && <rect className={styles.hatch} fill={hatch.fill} x={L} y={y + row * 0.2} width={W - L - 70} height={row * 0.6} />}
            {item.value === null ? (
              !compact && <text className={styles.void} x={L + 10} y={y + row / 2 + 4}>{item.note}</text>
            ) : (
              <>
                <rect className={styles.bar} x={L} y={y + row * 0.2} width={Math.max(2, x(item.value) - L)} height={row * 0.6} />
                {!compact && <text className={styles.value} x={x(item.value) + 8} y={y + row / 2 + 4}>{fmt(item.value, data.unit)}</text>}
              </>
            )}
            {!compact && withheld(item) && <SuppressedTip at={[L, y + row * 0.2]} text={item.note ?? "已隐藏"} />}
          </g>
        );
      })}
    </svg>
  );
}

function Cartesian({ data, drawing, min, max, label, compact }: { data: ChartData; drawing: ConceptDrawing; min: number; max: number; label: string; compact: boolean }) {
  const W = 820, H = compact ? 200 : 380, L = compact ? 6 : 52, R = W - 14, top = 26, B = H - (compact ? 10 : 62);
  const hatch = useHatch();
  const step = (R - L) / data.items.length;
  const y = (value: number) => B - ((Math.max(value, min) - min) / (max - min || 1)) * (B - top);
  const points = data.items.map((item, i) => [L + step * (i + 0.5), item.value === null ? null : y(item.value)] as const);
  const path = points.map((p, i) => p[1] === null ? "" : `${i > 0 && points[i - 1][1] !== null ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const crowded = data.items.length > 10;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
      {data.items.some(withheld) && hatch.defs}
      {!compact && [0, 1, 2, 3, 4].map((k) => {
        const v = min + ((max - min) * k) / 4;
        return (
          <g key={k}>
            <line className={styles.grid} x1={L} x2={R} y1={y(v)} y2={y(v)} />
            <text className={styles.tick} x={L - 8} y={y(v) + 4} textAnchor="end">{Math.round(v)}</text>
          </g>
        );
      })}
      {drawing === "line" && path && (<><path className={styles.glowLine} d={path} /><path className={styles.line} d={path} /></>)}
      {data.items.map((item, i) => {
        const [cx, cy] = points[i];
        const text = item.label.length > 6 && crowded ? `${item.label.slice(0, 5)}…` : item.label;
        return (
          <g key={item.key} className={styles.datum} {...(compact ? {} : pickKeys(item))}>
            {(compact || !withheld(item)) && <title>{item.detail}</title>}
            <rect className={styles.hit} x={cx - step / 2} y={top} width={step} height={B - top} />
            {cy === null ? (
              <>
                <rect className={styles.voidBox} x={cx - step * 0.3} y={B - 36} width={step * 0.6} height={36} />
                {withheld(item) && <rect className={styles.hatch} fill={hatch.fill} x={cx - step * 0.3} y={B - 36} width={step * 0.6} height={36} />}
                {!compact && <text className={styles.void} x={cx} y={B - 44} textAnchor="middle">{item.note}</text>}
                {!compact && withheld(item) && <SuppressedTip at={[cx - step * 0.3, B - 36]} text={item.note ?? "已隐藏"} />}
              </>
            ) : drawing === "bars" ? (
              <rect className={styles.bar} data-tone={item.tone} x={cx - step * 0.3} y={cy} width={step * 0.6} height={Math.max(1, B - cy)} />
            ) : (
              <>
                {drawing === "dots" && <line className={styles.stem} x1={cx} x2={cx} y1={B} y2={cy} />}
                <circle className={styles.dot} data-tone={item.tone} cx={cx} cy={cy} r={compact ? 8 : 6} />
              </>
            )}
            {!compact && cy !== null && (!crowded || drawing !== "line") && (
              <text className={styles.value} x={cx} y={cy - 10} textAnchor="middle">{fmt(item.value!, data.unit)}</text>
            )}
            {!compact && (
              <text className={styles.tick} x={cx} y={B + 20} textAnchor={crowded ? "end" : "middle"} transform={crowded ? `rotate(-35 ${cx} ${B + 20})` : undefined}>{text}</text>
            )}
          </g>
        );
      })}
      {!compact && <text className={styles.axis} x={(L + R) / 2} y={H - 6} textAnchor="middle">{data.axis}</text>}
    </svg>
  );
}

function Radar({ data, label, compact }: { data: ChartData; label: string; compact: boolean }) {
  const W = 820, H = compact ? 200 : 420, cx = W / 2, cy = H / 2, r = H / 2 - (compact ? 12 : 64);
  const hatch = useHatch();
  const n = data.items.length;
  const at = (i: number, k: number) => [cx + Math.sin((i / n) * 2 * Math.PI) * r * k, cy - Math.cos((i / n) * 2 * Math.PI) * r * k] as const;
  const poly = data.items.map((item, i) => at(i, (item.value ?? 0) / 100).join(",")).join(" ");
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${label}；雷达轴统一为 0–100，缺失项不绘制数值与完整面积`}>
      {data.items.some(withheld) && hatch.defs}
      {[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} className={styles.grid} points={data.items.map((_, i) => at(i, k).join(",")).join(" ")} fill="none" />)}
      {data.items.every(item => item.value !== null) && <polygon className={styles.area} points={poly} />}
      {data.items.map((item, i) => {
        const [x, y] = at(i, item.value === null ? 1 : item.value / 100);
        const [lx, ly] = at(i, 1.18);
        return (
          <g key={item.key} className={styles.datum} {...(compact ? {} : pickKeys(item))}>
            {(compact || !withheld(item)) && <title>{item.detail}</title>}
            <circle className={item.value === null ? styles.voidDot : styles.dot} cx={x} cy={y} r={compact ? 7 : 6} />
            {withheld(item) && <circle className={styles.hatch} fill={hatch.fill} cx={x} cy={y} r={compact ? 7 : 6} />}
            {!compact && (
              <text className={styles.label} x={lx} y={ly + 4} textAnchor={Math.abs(lx - cx) < 10 ? "middle" : lx > cx ? "start" : "end"}>
                {item.label} {item.value === null ? `· ${item.note}` : item.key === "score" ? `${item.value.toFixed(1)} 分` : `${item.value.toFixed(1)}%`}
              </text>
            )}
            {!compact && withheld(item) && <SuppressedTip at={[x - 12, y - 10]} text={item.note ?? "已隐藏"} />}
          </g>
        );
      })}
    </svg>
  );
}

function Stack({ data, label, compact }: { data: ChartData; label: string; compact: boolean }) {
  const W = 820, H = compact ? 200 : 220, L = 10, R = W - 10;
  const total = data.items.reduce((sum, item) => sum + (item.value ?? 0), 0) || 1;
  let x = L;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
      {data.items.map((item) => {
        const w = ((item.value ?? 0) / total) * (R - L);
        const left = x;
        x += w;
        return (
          <g key={item.key} className={styles.datum}>
            <title>{item.detail}</title>
            <rect className={styles.bar} data-tone={item.tone} x={left} y={compact ? 40 : 60} width={Math.max(0, w - 3)} height={compact ? 120 : 64} />
            {!compact && w > 60 && (
              <>
                <text className={styles.value} x={left + 10} y={48}>{item.label}</text>
                <text className={styles.label} x={left + 10} y={150}>{fmt(item.value ?? 0, data.unit)} · {(((item.value ?? 0) / total) * 100).toFixed(1)}%</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
