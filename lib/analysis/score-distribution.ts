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
  groups: ScoreDistributionGroup[];
  minSampleSize: number;
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
