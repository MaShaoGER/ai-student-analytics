import type { DataSource } from "./types";

export type ScoreDistributionGroup = {
  course: string;
  term: string;
  count: number;
  /** One-point intervals; the final interval includes a score of 100. */
  bins: number[];
};

export type ScoreDistributionData = {
  datasetId: DataSource;
  datasetVersion?: string;
  datasetName?: string;
  groups: ScoreDistributionGroup[];
  minSampleSize: number;
};

/**
 * Narrowing applied inside the SQL. `course`/`term` are exact catalog labels and
 * must already be validated by the caller; they are always bound as literals,
 * never spliced from free text.
 */
export type DistributionScope = {
  course?: string | null;
  term?: string | null;
};

export type ScoreBinWidth = 2 | 5 | 10;

export function distributionRows(
  groups: ScoreDistributionGroup[],
  term: string,
  course: string,
  width: ScoreBinWidth,
) {
  const rows = new Map<string, { course: string; count: number; bins: number[] }>();
  for (const group of groups) {
    if ((term && group.term !== term) || (course && group.course !== course)) continue;
    let row = rows.get(group.course);
    if (!row) {
      row = { course: group.course, count: 0, bins: Array(100 / width).fill(0) };
      rows.set(group.course, row);
    }
    row.count += group.count;
    group.bins.forEach((count, index) => {
      row.bins[Math.floor(index / width)] += count;
    });
  }
  return [...rows.values()].sort((a, b) => a.course.localeCompare(b.course, "zh-CN"));
}

export function scoreInterval(index: number, width: ScoreBinWidth) {
  const start = index * width;
  const end = start + width;
  return `${start} ≤ 分数 ${end === 100 ? "≤" : "<"} ${end}`;
}

/**
 * Count participating students, not multiply-counted person-terms: a single
 * pinned term counts people, anything wider counts person-terms. The label must
 * never claim "人" when the same student may appear in several terms.
 */
export function distributionCountingUnit(groups: ScoreDistributionGroup[], term?: string | null) {
  if (term) return "人" as const;
  return new Set(groups.map((group) => group.term)).size > 1 ? ("人次" as const) : ("人" as const);
}
