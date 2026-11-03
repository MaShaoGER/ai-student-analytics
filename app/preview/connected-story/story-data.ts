/** Fixed demo figures shared by every chart of the connected story. Values match static study 02. */
export type CourseKey = "A" | "B" | "C" | "D";

export type Course = {
  key: CourseKey;
  name: string;
  /** This term's mean score; the value every line carries from 01 through 02 into 03. */
  now: number;
  prev: number;
};

export const COURSES: readonly Course[] = [
  { key: "A", name: "课程 A", now: 86, prev: 83 },
  { key: "B", name: "课程 B", now: 82, prev: 84 },
  { key: "C", name: "课程 C", now: 78, prev: 75 },
  { key: "D", name: "课程 D", now: 74, prev: 77 },
];

/** 01 uses the full score scale so bar length is honest from zero. */
export const SCORE_TICKS = [0, 20, 40, 60, 80, 100] as const;
/** 03 zooms into the band that holds both terms. */
export const CHANGE_MIN = 70;
export const CHANGE_MAX = 90;
export const CHANGE_TICKS = [70, 75, 80, 85, 90] as const;

export const changePct = (value: number) => ((value - CHANGE_MIN) / (CHANGE_MAX - CHANGE_MIN)) * 100;
export const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0");

/** Students per course; every course has the same cohort in the demo. */
export const COHORT = 120;

/** 02: five-number summary on the 0–100 scale. The mean is `Course.now`. */
export type Spread = { min: number; q1: number; median: number; q3: number; max: number };
export const SPREAD: Record<CourseKey, Spread> = {
  A: { min: 62, q1: 79, median: 86, q3: 92, max: 99 },
  B: { min: 58, q1: 75, median: 83, q3: 90, max: 98 },
  C: { min: 41, q1: 68, median: 79, q3: 89, max: 99 },
  D: { min: 38, q1: 64, median: 75, q3: 86, max: 97 },
};

/** 04: mean weekly study activity per student, in hours, for weeks 1–12. */
export const WEEKS = 12;
export const ACTIVITY: Record<CourseKey, readonly number[]> = {
  A: [5, 6, 6, 7, 8, 7, 6, 9, 10, 8, 7, 9],
  B: [6, 6, 7, 6, 5, 6, 7, 8, 7, 6, 6, 7],
  C: [3, 4, 5, 5, 6, 7, 7, 8, 9, 9, 10, 11],
  D: [7, 6, 6, 5, 5, 4, 4, 5, 4, 3, 4, 3],
};
export const HEAT_BANDS = [
  { label: "0–3", from: 0 },
  { label: "4–6", from: 4 },
  { label: "7–9", from: 7 },
  { label: "10+", from: 10 },
] as const;
export const heatBand = (hours: number) =>
  HEAT_BANDS.reduce((found, band, index) => (hours >= band.from ? index : found), 0);
export function activitySummary(key: CourseKey) {
  const hours = ACTIVITY[key];
  const peak = Math.max(...hours);
  return { total: hours.reduce((sum, value) => sum + value, 0), peak, peakWeek: hours.indexOf(peak) + 1 };
}

/** 05: enrolments (one student in four courses counts four times) by activity tier × score band. */
export const TIERS = ["低", "中", "高"] as const;
export const TIER_RANGES = ["< 4 小时/周", "4–7 小时/周", "> 7 小时/周"] as const;
/** Index 0 is the lowest band; the chart draws it at the bottom. */
export const SCORE_BANDS = ["<70", "70–80", "80–90", "≥90"] as const;
export const MIX: readonly (readonly number[])[] = [
  [52, 44, 26, 8],
  [30, 58, 62, 30],
  [20, 34, 66, 50],
];

/** 06: students below 70 in each course, and in both courses of each pair. */
export const BELOW_70: Record<CourseKey, number> = { A: 14, B: 19, C: 31, D: 38 };
export type Pair = { id: string; a: CourseKey; b: CourseKey; count: number };
export const PAIRS: readonly Pair[] = [
  { id: "AB", a: "A", b: "B", count: 9 },
  { id: "AC", a: "A", b: "C", count: 6 },
  { id: "AD", a: "A", b: "D", count: 7 },
  { id: "BC", a: "B", b: "C", count: 8 },
  { id: "BD", a: "B", b: "D", count: 11 },
  { id: "CD", a: "C", b: "D", count: 18 },
];

export const courseName = (key: CourseKey) => COURSES.find((course) => course.key === key)!.name;
