import { createPlan } from "./plan";
import type { AnalysisPlan, AnalysisRow, DataSource } from "./types";

export type GoldenCase = {
  id: string;
  question: string;
  expectedPlan: AnalysisPlan;
  expectedRows: AnalysisRow[];
  tolerance: number;
};

const scoreByCourse: AnalysisRow[] = [
  { dimension: "AAA", value: 79.67, sampleSize: 3 },
  { dimension: "CCC", value: 70.67, sampleSize: 3 },
  { dimension: "BBB", value: 67.67, sampleSize: 3 },
];

const scoreByTerm: AnalysisRow[] = [
  { dimension: "2024J", value: 73.67, sampleSize: 6 },
  { dimension: "2024B", value: 70.67, sampleSize: 3 },
];

const activityByCourse: AnalysisRow[] = [
  { dimension: "AAA", value: 186, sampleSize: 3 },
  { dimension: "CCC", value: 178, sampleSize: 3 },
  { dimension: "BBB", value: 145, sampleSize: 3 },
];

const activityByTerm: AnalysisRow[] = [
  { dimension: "2024J", value: 331, sampleSize: 6 },
  { dimension: "2024B", value: 178, sampleSize: 3 },
];

const completionByCourse: AnalysisRow[] = [
  { dimension: "AAA", value: 100, sampleSize: 3 },
  { dimension: "BBB", value: 66.67, sampleSize: 3 },
  { dimension: "CCC", value: 66.67, sampleSize: 3 },
];

const completionByTerm: AnalysisRow[] = [
  { dimension: "2024J", value: 83.33, sampleSize: 6 },
  { dimension: "2024B", value: 66.67, sampleSize: 3 },
];

function plan(
  metric: "score" | "activity" | "completion_rate",
  dimension: "course" | "term",
  chartType: "bar" | "line" | "table",
): AnalysisPlan {
  return createPlan({ datasetId: "demo", metric, dimension, chartType });
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    id: "score-course-top",
    question: "哪门课程平均成绩最高？",
    expectedPlan: plan("score", "course", "bar"),
    expectedRows: scoreByCourse,
    tolerance: 0.01,
  },
  {
    id: "score-course-compare",
    question: "比较各课程平均成绩。",
    expectedPlan: plan("score", "course", "bar"),
    expectedRows: scoreByCourse,
    tolerance: 0.01,
  },
  {
    id: "score-term",
    question: "各学期平均成绩如何？",
    expectedPlan: plan("score", "term", "line"),
    expectedRows: scoreByTerm,
    tolerance: 0.01,
  },
  {
    id: "activity-course-top",
    question: "哪门课程学习活跃次数最多？",
    expectedPlan: plan("activity", "course", "bar"),
    expectedRows: activityByCourse,
    tolerance: 0.01,
  },
  {
    id: "activity-course-compare",
    question: "比较各课程学习活跃次数。",
    expectedPlan: plan("activity", "course", "bar"),
    expectedRows: activityByCourse,
    tolerance: 0.01,
  },
  {
    id: "activity-term",
    question: "各学期学习活跃次数如何？",
    expectedPlan: plan("activity", "term", "line"),
    expectedRows: activityByTerm,
    tolerance: 0.01,
  },
  {
    id: "completion-course-top",
    question: "哪门课程完成率最高？",
    expectedPlan: plan("completion_rate", "course", "bar"),
    expectedRows: completionByCourse,
    tolerance: 0.01,
  },
  {
    id: "completion-course-compare",
    question: "比较各课程完成率。",
    expectedPlan: plan("completion_rate", "course", "bar"),
    expectedRows: completionByCourse,
    tolerance: 0.01,
  },
  {
    id: "completion-term",
    question: "各学期完成率如何？",
    expectedPlan: plan("completion_rate", "term", "line"),
    expectedRows: completionByTerm,
    tolerance: 0.01,
  },
  {
    id: "score-course-table",
    question: "用表格查看课程平均成绩和样本数。",
    expectedPlan: plan("score", "course", "table"),
    expectedRows: scoreByCourse,
    tolerance: 0.01,
  },
] as const;

function normalizeQuestion(question: string): string {
  return question
    .trim()
    .replace(/[？?。.！!\s]+$/u, "")
    .replace(/\s+/g, "");
}

export function findGoldenCase(question: string): GoldenCase | undefined {
  const normalized = normalizeQuestion(question);
  return GOLDEN_CASES.find((goldenCase) => normalizeQuestion(goldenCase.question) === normalized);
}

export function planForDataset(goldenCase: GoldenCase, datasetId: DataSource): AnalysisPlan {
  return { ...goldenCase.expectedPlan, datasetId };
}
