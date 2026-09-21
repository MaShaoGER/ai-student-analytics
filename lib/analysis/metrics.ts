import type { Metric } from "./types";

export const METRICS: Record<
  Metric,
  {
    label: string;
    unit: string;
    description: string;
    formula: string;
    defaultChart: "line" | "bar";
  }
> = {
  score: {
    label: "平均成绩",
    unit: "分",
    description: "按学生-课程-开课期记录计算成绩均值。",
    formula: "AVG(student_outcomes.score)",
    defaultChart: "bar",
  },
  activity: {
    label: "活跃次数",
    unit: "次",
    description: "按学习活动事实表汇总资源访问次数。",
    formula: "SUM(learning_activity.activity_count)",
    defaultChart: "line",
  },
  completion_rate: {
    label: "完成率",
    unit: "%",
    description: "完成课程的学生数除以满足统计条件的学生数。",
    formula: "AVG(student_outcomes.completed) * 100",
    defaultChart: "bar",
  },
};

export const DIMENSIONS = {
  course: { label: "课程", column: "code_module" },
  term: { label: "学期", column: "code_presentation" },
} as const;

export function metricAggregation(metric: Metric): "avg" | "sum" | "rate" {
  if (metric === "activity") return "sum";
  if (metric === "completion_rate") return "rate";
  return "avg";
}
