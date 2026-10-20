import { z } from "zod";
export const gradeDatasetIdSchema = z
  .string()
  .regex(/^grades_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  .transform((id) => id as `grades_${string}`);
export const datasetIdSchema = z.union([z.enum(["demo", "oulad"]), gradeDatasetIdSchema]);
export type RegisteredDatasetId = z.infer<typeof datasetIdSchema>;
export function isGradeDataset(id: string): id is `grades_${string}` {
  return gradeDatasetIdSchema.safeParse(id).success;
}
