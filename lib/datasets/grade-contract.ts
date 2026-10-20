/** Shared browser/server contracts. Student-level values never enter AI context. */
export const GRADE_FIELDS = [
  "id_student",
  "code_module",
  "code_presentation",
  "score",
  "completed",
] as const;
export type GradeField = (typeof GRADE_FIELDS)[number];
export type GradeMapping = Partial<Record<GradeField, number>>;
export type GradeRow = {
  id_student: string;
  code_module: string;
  code_presentation: string;
  score: number | null;
  completed: 0 | 1 | null;
};
export type GradeSheet = { name: string; rows: string[][] };
export type GradeWorkbook = { sheets: GradeSheet[] };
export type GradeIssue = { row: number; field: string; code: string; message: string };
export type GradeValidation = {
  valid: boolean;
  rowCount: number;
  studentCount: number;
  courseCount: number;
  termCount: number;
  missingScores: number;
  hasCompletion: boolean;
  errorCount: number;
  issues: GradeIssue[];
  preview: GradeRow[];
};
export type GradeDraft = {
  id: string;
  expiresAt: string;
  sheets: { name: string; rowCount: number }[];
};
export type GradeSheetPreview = {
  sheet: number;
  headerRow: number;
  headers: string[];
  preview: string[][];
  suggestedMapping: GradeMapping;
};
export type GradeVersion = {
  version: string;
  createdAt: string;
  rowCount: number;
  studentCount: number;
  courseCount: number;
  termCount: number;
  missingScores: number;
  hasCompletion: boolean;
};
export type GradeDataset = {
  id: `grades_${string}`;
  name: string;
  owner: string;
  enabled: boolean;
  currentVersion: string;
  versions: GradeVersion[];
};
export const GRADE_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 50000,
  maxColumns: 50,
  maxSheets: 10,
  maxCellLength: 200,
  maxIssues: 200,
  draftTtlMs: 60 * 60 * 1000,
} as const;
