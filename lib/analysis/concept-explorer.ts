import type { DataSource } from "./types";

export const CONCEPT_METRICS = ["attendance", "score", "pass", "completion", "homework", "ontime"] as const;
export type ConceptMetric = (typeof CONCEPT_METRICS)[number];

/** Null is not zero. `count` is contributing students, not session-hours or assignment counts. */
export type ConceptReading = {
  value: number | null;
  count: number | null;
  reason?: string;
};
export type ConceptCourse = {
  course: string;
  count: number | null;
  suppressed: boolean;
  metrics: Record<ConceptMetric, ConceptReading>;
};
export type ConceptBin = {
  min: number;
  max: number;
  includeMax: boolean;
  count: number | null;
  suppressed: boolean;
};
export type ConceptAttendanceBand = ConceptBin & {
  meanScore: number | null;
  passRate: number | null;
  attendanceRate: number | null;
};
export type ConceptCourseDetail = {
  course: string;
  scoreBins: ConceptBin[];
  attendanceBands: ConceptAttendanceBand[] | null;
  weeklyAttendance: { week: number; value: number | null; count: number | null; suppressed: boolean }[] | null;
  homework: { scheduled: number; onTime: number; late: number; missing: number } | null;
  passCounts: { passed: number; failed: number } | null;
  completionCounts: { completed: number; incomplete: number } | null;
};
export type ConceptExplorerData = {
  datasetId: DataSource;
  datasetName: string;
  datasetVersion?: string;
  synthetic: boolean;
  term: string | null;
  terms: string[];
  courses: ConceptCourse[];
  totalCourses: number;
  courseLimit: number;
  detail: ConceptCourseDetail | null;
  capabilities: { attendance: boolean; homework: boolean; completion: boolean };
};
