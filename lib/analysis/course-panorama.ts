import { z } from "zod";
import { courseRelationRequestSchema, type CourseRelationData } from "./course-relations";

export const coursePanoramaRequestSchema = courseRelationRequestSchema
  .extend({
    source: z.string().trim().min(1).max(160).optional(),
    target: z.string().trim().min(1).max(160).optional(),
  })
  .refine((input) => Boolean(input.source) === Boolean(input.target), {
    message: "请选择一组完整的学科关联。",
  })
  .refine((input) => !input.source || input.source !== input.target, {
    message: "请选择两门不同的学科。",
  });

export type CoursePanoramaRequest = z.infer<typeof coursePanoramaRequestSchema>;
export type CoursePanoramaStats = {
  count: number;
  mean: number;
  /** Passing is always score >= 60, independent of the exploration threshold. */
  passRate: number;
  /** Twenty shared five-point bins; the last includes 100. */
  bins: number[];
};
export type CoursePanoramaData = CourseRelationData & {
  totalStudents: number;
  selection: { source: string; target: string; count: number; commonCount: number } | null;
  columns: {
    course: string;
    baseline: CoursePanoramaStats;
    /** Null suppresses zero, one and two-person groups, including their exact count. */
    cohort: CoursePanoramaStats | null;
  }[];
};

export class PanoramaSelectionError extends Error {
  constructor() {
    super("这组关联在当前学期或分数线下不可用，请重新选择。");
    this.name = "PanoramaSelectionError";
  }
}
