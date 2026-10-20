import { z } from "zod";
import { AuthError } from "@/lib/auth/service";
import { gradeDatasetIdSchema } from "@/lib/datasets/id";
import { GRADE_LIMITS } from "@/lib/datasets/grade-contract";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const draftIdSchema = z.string().uuid();
export const sheetSchema = z
  .number()
  .int()
  .min(0)
  .max(GRADE_LIMITS.maxSheets - 1);
export const headerRowSchema = z
  .number()
  .int()
  .min(1, "表头行必须从 1 开始")
  .max(GRADE_LIMITS.maxRows + GRADE_LIMITS.maxSheets);

export const mappingSchema = z
  .object({
    id_student: z
      .number()
      .int()
      .min(0)
      .max(GRADE_LIMITS.maxColumns - 1)
      .optional(),
    code_module: z
      .number()
      .int()
      .min(0)
      .max(GRADE_LIMITS.maxColumns - 1)
      .optional(),
    code_presentation: z
      .number()
      .int()
      .min(0)
      .max(GRADE_LIMITS.maxColumns - 1)
      .optional(),
    score: z
      .number()
      .int()
      .min(0)
      .max(GRADE_LIMITS.maxColumns - 1)
      .optional(),
    completed: z
      .number()
      .int()
      .min(0)
      .max(GRADE_LIMITS.maxColumns - 1)
      .optional(),
  })
  .strict();

export const selectionSchema = z
  .object({
    draftId: draftIdSchema,
    sheet: sheetSchema,
    headerRow: headerRowSchema,
  })
  .strict();

export const validationRequestSchema = selectionSchema.extend({ mapping: mappingSchema }).strict();

const datasetNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), "数据集名称包含控制字符");
const versionSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((version) => !/[\u0000-\u001f\u007f]/.test(version), "版本标识包含控制字符");

export const publicationRequestSchema = z
  .object({
    draftId: draftIdSchema,
    sheet: sheetSchema,
    headerRow: headerRowSchema,
    mapping: mappingSchema,
    name: datasetNameSchema,
    datasetId: gradeDatasetIdSchema.optional(),
    baseVersion: versionSchema.optional(),
  })
  .strict();

export const deleteRequestSchema = z.object({ draftId: draftIdSchema }).strict();

export function enforceImportRateLimit(route: string, actorId: string): void {
  const result = checkRateLimit(`grade-import:${route}:${actorId}`, {
    windowMs: 60000,
    maxRequests: route === "upload" || route === "publication" ? 10 : 30,
  });
  if (!result.allowed)
    throw new AuthError(429, "RATE_LIMIT_EXCEEDED", "成绩导入操作过于频繁，请稍后重试。");
}
