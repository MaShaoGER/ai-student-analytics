"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import { anchorId } from "./geometry";
import { MIX, SCORE_BANDS, TIER_RANGES, TIERS } from "./story-data";
import styles from "./story.module.css";

const LARGEST = Math.max(...MIX.flat());
/** Area, not diameter, follows the count. */
const size = (count: number) => `${Math.sqrt(count / LARGEST) * 100}%`;
/** Shown without hover: the biggest share of the under-70 band. */
const LEAD = { tier: 0, band: 0 } as const;

function TierColumn({ tier, progress, selected, onSelect }: {
  tier: number;
  progress: MotionValue<number>;
  selected: number | null;
  onSelect: (tier: number) => void;
}) {
  // The tiers appear after the merged line has landed, low to high.
  const shown = useTransform(progress, [0.55 + tier * 0.1, 0.7 + tier * 0.1], [0, 1]);
  const state = selected === null ? "idle" : selected === tier ? "on" : "off";
  const counts = MIX[tier];
  return (
    <motion.div className={styles.tier} data-state={state} style={{ opacity: shown }}>
      {/* Index 0 (<70) is drawn last so it sits at the bottom of the column. */}
      {SCORE_BANDS.map((band, b) => (
        <span key={band} className={styles.mixCell} style={{ gridRow: SCORE_BANDS.length - b }}>
          <motion.span
            className={styles.dot}
            data-lead={(tier === LEAD.tier && b === LEAD.band) || undefined}
            style={{ width: size(counts[b]), scale: shown }}
          />
          <span className={styles.dotValue}>{counts[b]}</span>
        </span>
      ))}
      <button
        type="button"
        className={styles.tierKey}
        aria-pressed={selected === tier}
        aria-label={`${TIERS[tier]}活动量（${TIER_RANGES[tier]}）：${SCORE_BANDS.map((band, b) => `${band} 分 ${counts[b]} 人次`).join("，")}`}
        onClick={() => onSelect(tier)}
      >
        {TIERS[tier]}
        <span>{TIER_RANGES[tier]}</span>
      </button>
    </motion.div>
  );
}

/** 05: enrolments counted by activity tier, not by course; one bubble per tier × score band. */
export function ScatterChart({ progress, tier, onTier }: {
  progress: MotionValue<number>;
  tier: number | null;
  onTier: (tier: number | null) => void;
}) {
  return (
    <figure className={`${styles.figure} ${styles.figureMix}`}>
      <span className={styles.mixMerge} data-anchor={anchorId.mixMerge} />
      <div className={styles.mixPlot}>
        <div className={styles.mixAxis} aria-hidden="true">
          {SCORE_BANDS.map((band, b) => (
            <span key={band} style={{ gridRow: SCORE_BANDS.length - b }}>
              {band}
            </span>
          ))}
        </div>
        {TIERS.map((_, t) => (
          <TierColumn
            key={t}
            tier={t}
            progress={progress}
            selected={tier}
            onSelect={(next) => onTier(tier === next ? null : next)}
          />
        ))}
      </div>
      <figcaption className={styles.caption}>
        纵向：成绩区间 / 分 · 横向：每周学习活动档 · 点的面积 = 选课人次 · 按活动档统计，不区分课程
      </figcaption>
      <span className={styles.mixSplit} data-anchor={anchorId.mixSplit} />
    </figure>
  );
}
