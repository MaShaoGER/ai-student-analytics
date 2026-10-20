import { z } from "zod";
import { dataSourceSchema, type DataSource } from "./types";

/**
 * Absence statistics contract (unified-AI roadmap §4.1).
 *
 * The three questions a user can ask about absence are genuinely different and
 * must never be substituted for one another:
 *
 * - `sessions`: 课时 — scheduled class periods missed (the data's unit).
 * - `days`: 请假天数 — approved leave duration in days from the leave table.
 *   Counting days includes non-class days (weekends), so it is *not* a subset of
 *   missed periods and cannot be converted to or from `sessions`; this unit is
 *   therefore reported as unsupported rather than approximated.
 * - `students`: 去重人数 — distinct students with at least one missed period.
 *
 * `unexcused` excludes approved leave; `absence` includes it. OULAD has no
 * campus attendance fields at all, so the contract returns "unsupported" rather
 * than zero or a substitute activity metric.
 */
export const absenceRequestSchema = z
  .object({
    datasetId: dataSourceSchema,
    term: z.string().trim().min(1).max(80).optional(),
    course: z.string().trim().min(1).max(100).optional(),
    /** Explicit metric the user asked about; no default substitution is allowed. */
    metric: z.enum(["absence", "unexcused", "excused"]).default("absence"),
    /** Count unit the user asked for; ambiguous wording stays `sessions`. */
    unit: z.enum(["sessions", "days", "students"]).default("sessions"),
  })
  .strict();

export type AbsenceRequest = z.infer<typeof absenceRequestSchema>;

export type AbsenceMetric = AbsenceRequest["metric"];
export type AbsenceUnit = AbsenceRequest["unit"];

export type AbsenceCourseRow = {
  course: string;
  /** Missed class periods in the requested scope. */
  sessions: number;
  /** Distinct students with at least one missed period. */
  students: number;
};

export type AbsenceStats = {
  datasetId: DataSource;
  datasetVersion?: string;
  datasetName?: string;
  term: string | null;
  terms: string[];
  course: string | null;
  metric: AbsenceMetric;
  unit: AbsenceUnit;
  /** The unit the user asked for, and whether the data can actually answer it. */
  supported: boolean;
  unsupportedReason: string | null;
  rows: AbsenceCourseRow[];
  totals: {
    sessions: number;
    /**
     * Sum of per-course affected counts. The same student can appear in several
     * courses, so this is a person-course count, NOT a deduplicated headcount.
     */
    studentCourseCount: number;
    /** Distinct affected students across the whole scope (the honest headcount). */
    distinctStudents: number;
    approvedLeaveDays: number;
  };
  /** Periods × 45 minutes: lesson minutes, not clock time including breaks. */
  minutesPerPeriod: number;
  minSampleSize: number;
};

export const ABSENCE_METRIC_LABELS: Record<AbsenceMetric, string> = {
  absence: "缺勤课时",
  unexcused: "旷课课时",
  excused: "请假缺席课时",
};

/** OULAD ships no campus attendance, leave or absence columns. */
export const OULAD_ABSENCE_LIMITATION =
  "OULAD 是英国开放大学公开数据，只有学习资源访问记录，没有校园出勤、请假或缺勤字段；不能用活动量替代缺勤。";

export const ABSENCE_SCOPE_LIMITATIONS = [
  "缺勤按课时统计（每课时 45 分钟），不是请假申请次数、不是缺勤事件次数。",
  "缺勤包含已批准请假的缺席与旷课；旷课仅指无有效批准请假的缺席。",
  "同一学生可出现在多个课程分组，分组人数不能直接相加得到去重总人数。",
  "活动量、出勤率与缺勤课时是不同指标，不能互相替代。",
];

/**
 * Decide whether a requested unit can be answered from this dataset. A leave
 * request day count is not a class-period count, and OULAD has no absence data
 * at all. Returning `supported: false` with a reason is the correct answer to
 * an unsupported question; silently substituting is not.
 */
export function absenceSupport(
  datasetId: DataSource,
  unit: AbsenceUnit,
): { supported: boolean; reason: string | null } {
  if (datasetId.startsWith("grades_"))
    return {
      supported: false,
      reason: "该成绩数据集没有出勤、请假或旷课记录，无法计算缺勤；不能用成绩或活动量替代。",
    };
  if (datasetId === "oulad") return { supported: false, reason: OULAD_ABSENCE_LIMITATION };
  if (unit === "days")
    return {
      supported: false,
      reason:
        "记分数据只按课时记录出勤，没有逐日请假缺席的对应关系；请假申请表的天数不等于缺勤课时，不能换算成缺勤天数。",
    };
  return { supported: true, reason: null };
}

export const ABSENCE_MINUTES_PER_PERIOD = 45;
