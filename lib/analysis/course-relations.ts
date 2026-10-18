import { z } from "zod";
import { dataSourceSchema, type DataSource } from "./types";

export const courseRelationRequestSchema = z.object({
  datasetId: dataSourceSchema,
  term: z.string().trim().min(1).max(80).optional(),
  threshold: z.coerce.number().int().min(1).max(100).default(60),
  courses: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
});

export type CourseRelationRequest = z.infer<typeof courseRelationRequestSchema>;
export type CourseRelation = {
  source: string;
  target: string;
  commonCount: number;
  belowCount: number;
  /** Both below the threshold / students with valid scores in both courses. */
  rate: number;
};
export type CourseRelationData = {
  datasetId: DataSource;
  term: string | null;
  terms: string[];
  threshold: number;
  minSampleSize: number;
  courseLimit: number;
  totalCourses: number;
  courses: { name: string; count: number }[];
  relations: CourseRelation[];
};

export function visibleRelations(relations: CourseRelation[], course: string) {
  return relations
    .filter((relation) => !course || relation.source === course || relation.target === course)
    .sort(
      (a, b) =>
        b.belowCount - a.belowCount ||
        b.rate - a.rate ||
        a.source.localeCompare(b.source, "zh-CN") ||
        a.target.localeCompare(b.target, "zh-CN"),
    );
}

export const relationKey = (relation: CourseRelation) =>
  JSON.stringify([relation.source, relation.target]);
