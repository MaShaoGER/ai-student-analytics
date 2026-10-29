import { z } from "zod";
import {
  analysisPlanSchema,
  chartTypeSchema,
  dimensionSchema,
  dataSourceSchema,
  filterSchema,
} from "../analysis/types";
import { toolSchema } from "../ai/chart-capabilities";
import { RESULT_KINDS, RESULT_CONTRACT_VERSION } from "../ai/result-contract";
import { chatIntentSchema } from "../ai/chat-types";

/**
 * Structural schemas for the parts of a trusted result that history persists.
 *
 * These are storage validators, not an inference layer. They prove that a
 * restored row has the shape its renderer needs and strip anything else, so a
 * damaged file or a future field cannot smuggle raw rows into a response.
 */
const text = (max: number) => z.string().max(max);
const finite = z.number().finite();

export const analysisRowSchema = z.object({
  dimension: text(200),
  value: finite,
  sampleSize: z.number().int().nonnegative(),
});

export const analysisResultSchema = z.object({
  datasetVersion: text(100).optional(),
  datasetName: text(200).optional(),
  datasetId: dataSourceSchema,
  dimension: dimensionSchema,
  dimensions: z.array(dimensionSchema).min(1).max(2).optional(),
  chartType: chartTypeSchema,
  rows: z.array(analysisRowSchema).max(100),
  unit: text(20),
  metricLabel: text(100),
  period: text(200),
  query: text(0),
  durationMs: finite.nonnegative(),
  minSampleSize: z.number().int().nonnegative(),
  filteredOutGroupCount: z.number().int().nonnegative().nullable(),
});

export const studioTableSchema = z
  .object({
    columns: z.array(text(200)).min(1).max(30),
    rows: z
      .array(z.record(z.string().max(200), z.union([z.string().max(2_000), finite, z.null()])))
      .max(2_000),
    description: text(500),
    sortChange: z.enum(["asc", "desc"]).optional(),
  })
  .superRefine((table, context) => {
    if (new Set(table.columns).size !== table.columns.length)
      context.addIssue({ code: "custom", message: "表格字段名重复。", path: ["columns"] });
    table.rows.forEach((row, index) => {
      const extra = Object.keys(row).filter((key) => !table.columns.includes(key));
      if (extra.length)
        context.addIssue({
          code: "custom",
          message: "表格行含未声明的字段。",
          path: ["rows", index],
        });
    });
  });

const distributionGroupSchema = z.object({
  course: text(200),
  term: text(100),
  count: z.number().int().nonnegative(),
  bins: z.array(z.number().int().nonnegative()).length(100),
});

export const scoreDistributionDataSchema = z.object({
  datasetId: dataSourceSchema,
  datasetVersion: text(100).optional(),
  datasetName: text(200).optional(),
  groups: z.array(distributionGroupSchema).max(500),
  minSampleSize: z.number().int().nonnegative(),
});

const relationSchema = z.object({
  source: text(200),
  target: text(200),
  commonCount: z.number().int().nonnegative(),
  belowCount: z.number().int().nonnegative(),
  rate: finite,
});

export const courseRelationDataSchema = z.object({
  datasetId: dataSourceSchema,
  datasetVersion: text(100).optional(),
  datasetName: text(200).optional(),
  term: text(100).nullable(),
  terms: z.array(text(100)).max(100),
  threshold: z.number().int().min(1).max(100),
  minSampleSize: z.number().int().nonnegative(),
  courseLimit: z.number().int().nonnegative(),
  totalCourses: z.number().int().nonnegative(),
  courses: z.array(z.object({ name: text(200), count: z.number().int().nonnegative() })).max(500),
  relations: z.array(relationSchema).max(5_000),
});

export const coursePanoramaDataSchema = courseRelationDataSchema.extend({
  totalStudents: z.number().int().nonnegative(),
  selection: z
    .object({
      source: text(200),
      target: text(200),
      count: z.number().int().nonnegative(),
      commonCount: z.number().int().nonnegative(),
    })

    .nullable(),
  columns: z
    .array(
      z.object({
        course: text(200),
        baseline: z.object({
          count: z.number().int().nonnegative(),
          mean: finite,
          passRate: finite,
          bins: z.array(z.number().int().nonnegative()).length(20),
        }),
        cohort: z
          .object({
            count: z.number().int().nonnegative(),
            mean: finite,
            passRate: finite,
            bins: z.array(z.number().int().nonnegative()).length(20),
          })

          .nullable(),
      }),
    )
    .max(500),
});

export const chatResponseArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("analysis"),
    plan: analysisPlanSchema,
    result: analysisResultSchema,
    view: z.enum(["bar", "line", "table", "pie", "treemap", "radar", "scatter"]),
  }),
  z.object({
    kind: z.literal("studio"),
    tool: toolSchema.exclude(["chord", "panorama"]),
    table: studioTableSchema,
    densityMode: z.enum(["density", "scatter"]).optional(),
    term: text(100),
    comparisonTerm: text(100).optional(),
    view: z.enum(["chart", "table"]),
    courses: z.array(text(200)).max(100).optional(),
    datasetId: dataSourceSchema.optional(),
    datasetVersion: text(100).optional(),
    datasetName: text(200).optional(),
  }),
  z.object({
    kind: z.literal("relations"),
    data: courseRelationDataSchema,
    course: text(200),
    view: z.enum(["chart", "table"]),
  }),
  z.object({
    kind: z.literal("panorama"),
    data: coursePanoramaDataSchema,
    view: z.enum(["chart", "table"]),
  }),
  z.object({
    kind: z.literal("distribution"),
    data: scoreDistributionDataSchema,
    course: text(200),
    term: text(100),
    binWidth: z.union([z.literal(2), z.literal(5), z.literal(10)]),
    view: z.enum(["table", "heatmap"]),
  }),
]);

export const resultRefSchema = z.object({
  version: z.literal(RESULT_CONTRACT_VERSION),
  resultId: z.string().regex(/^r-[0-9a-f]{16}$/),
  datasetId: dataSourceSchema,
  datasetVersion: text(100),
  metricVersion: text(100),
  kind: z.enum(RESULT_KINDS),
  metric: text(100),
  granularity: z.enum(["course", "term", "course_term", "student_course_term", "group"]),
  courses: z.array(text(200)).max(100),
  terms: z.array(text(100)).max(100),
  filters: z.array(filterSchema).max(20),
  extra: z.record(z.string().max(100), z.union([z.string().max(500), finite, z.null()])),
  unit: text(20),
  minSampleSize: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative().nullable(),
  scopeLabel: text(300),
  limitations: z.array(text(500)).max(20),
});

export const factRefSchema = z.object({
  factId: z.string().regex(/^f-[0-9a-f]{16}$/),
  resultId: z.string().regex(/^r-[0-9a-f]{16}$/),
  label: text(200),
  text: text(2_000),
  numeric: z
    .object({
      value: finite,
      unit: text(20),
      sampleSize: z.number().int().nonnegative().nullable(),
      numerator: finite.optional(),
      denominator: finite.optional(),
    })

    .nullable(),
  semantic: z
    .object({
      subject: text(200),
      metric: text(100),
      role: z.enum([
        "before",
        "after",
        "change",
        "decrease",
        "sample_size",
        "maximum",
        "minimum",
        "range",
      ]),
      term: text(100).optional(),
      comparisonTerm: text(100).optional(),
      largestDecline: z.boolean().optional(),
    })

    .optional(),
  limitations: z.array(text(500)).max(20),
});

export const knowledgeCitationSchema = z.object({
  id: text(100),
  title: text(500),
  version: text(100),
  source: text(500),
  scope: z.enum(["all", "demo", "oulad"]),
  excerpt: text(2_000),
});

export const analysisStepSchema = z.object({
  id: text(100),
  label: text(200),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  durationMs: finite.nonnegative(),
  summary: text(1_000).optional(),
});

export const chatIntentStoredSchema = chatIntentSchema;
