import { z } from "zod";

/** Viewport position for a lightweight menu, never part of data identity or SQL scope. */
export type PickAnchor = { x: number; y: number };

const term = z.string().trim().min(1).max(80);
const course = z.string().trim().min(1).max(120);
const population = z.enum(["score", "activity", "completion_rate"]).optional();
const band = z.number().int().min(0).max(2);
export const focusStepSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("course"), term, course, population }).strict(),
    z.object({ kind: z.literal("term"), term, population }).strict(),
    z
      .object({ kind: z.literal("week"), term, course, week: z.number().int().min(-100).max(1000) })
      .strict(),
    z
      .object({
        kind: z.literal("density"),
        term,
        course: course.optional(),
        metric: z.enum(["attendance", "activity"]),
        x: z.number().finite().min(0).max(1e12),
        y: z.number().finite().min(2.5).max(97.5),
      })
      .strict(),
    z
      .object({
        kind: z.literal("path"),
        term,
        course: course.optional(),
        attendance: band.optional(),
        homework: band.optional(),
        score: band.optional(),
      })
      .strict(),
    z.object({ kind: z.literal("pair"), term, source: course, target: course }).strict(),
    z
      .object({
        kind: z.literal("score"),
        term,
        course,
        min: z.number().finite().min(0).max(100),
        max: z.number().finite().min(0).max(100),
        includeMax: z.boolean().optional(),
      })
      .strict(),
  ])
  .superRefine((step, context) => {
    if (step.kind === "pair" && step.source === step.target)
      context.addIssue({ code: "custom", message: "请选择两门不同的课程。" });
    if (
      step.kind === "path" &&
      step.attendance === undefined &&
      step.homework === undefined &&
      step.score === undefined
    )
      context.addIssue({ code: "custom", message: "请选择具体的出勤、作业或成绩档位。" });
    if (step.kind === "score" && (step.min >= step.max || (step.includeMax && step.max !== 100)))
      context.addIssue({ code: "custom", message: "成绩区间不正确。" });
    if (step.kind === "density") {
      const scoreBin = (step.y - 2.5) / 5;
      const xBin = step.metric === "attendance" ? (step.x - 5) / 10 : (step.x - 50) / 100;
      if (
        !Number.isInteger(scoreBin) ||
        !Number.isInteger(xBin) ||
        xBin < 0 ||
        (step.metric === "attendance" && xBin > 9)
      )
        context.addIssue({ code: "custom", message: "请选择原始统计分箱，不支持重新划分的范围。" });
    }
  });

export const explorationFocusSchema = z
  .object({ steps: z.array(focusStepSchema).min(1).max(8) })
  .strict();
export type FocusStep = z.infer<typeof focusStepSchema>;
export type ExplorationFocus = z.infer<typeof explorationFocusSchema>;

/** Chart payload and keyboard detail share this value; display strings never become predicates. */
export type ChartPick =
  | { kind: "course"; course: string }
  | { kind: "week"; course: string; week: number }
  | { kind: "comparison"; course: string; side: "before" | "after" }
  | { kind: "density"; metric: "attendance" | "activity"; x: number; y: number }
  | { kind: "path"; attendance?: number; homework?: number; score?: number }
  | { kind: "score"; course: string; min: number; max: number; includeMax?: boolean };

export type ChartCoverage = {
  scene: "aggregate" | "sankey" | "boxplot" | "heatmap" | "density" | "dumbbell" | "relations" | "panorama";
  available: boolean;
  reason: string;
};
export type FocusSummary = { label: string; count: number | null; suppressed: boolean };

export function parseExplorationFocus(value: string): ExplorationFocus {
  if (!value.trim() || value.length > 12000) throw new Error("数据选择链接为空或过长。");
  return explorationFocusSchema.parse(JSON.parse(value));
}

export function appendFocus(
  focus: ExplorationFocus | undefined,
  step: FocusStep,
): ExplorationFocus {
  const parsed = focusStepSchema.parse(step);
  const steps = focus?.steps ?? [];
  if (steps.some((previous) => JSON.stringify(previous) === JSON.stringify(parsed)))
    return { steps };
  return explorationFocusSchema.parse({ steps: [...steps, parsed] });
}

export function focusStepLabel(step: FocusStep): string {
  switch (step.kind) {
    case "course":
      return `${step.term} · ${step.course}`;
    case "term":
      return `${step.term} 学期`;
    case "week":
      return `${step.term} · ${step.course} · 第 ${step.week} 周有记录群体`;
    case "density":
      return `${step.term} · ${step.course ?? "全部课程"} · ${step.metric === "attendance" ? "出勤" : "活动"} / 成绩分箱 ${step.x} / ${step.y}`;
    case "pair":
      return `${step.term} · ${step.source} × ${step.target} · 两科低于60分`;
    case "score":
      return `${step.term} · ${step.course} · ${step.min}–${step.max}分${step.includeMax ? "（含上界）" : "（不含上界）"}`;
    case "path": {
      const labels: string[] = [];
      if (step.attendance !== undefined)
        labels.push(["出勤低于80%", "出勤80–95%", "出勤至少95%"][step.attendance]);
      if (step.homework !== undefined)
        labels.push(["作业完成低于60%", "作业完成60–90%", "作业完成至少90%"][step.homework]);
      if (step.score !== undefined)
        labels.push(["成绩低于60分", "成绩60–80分", "成绩至少80分"][step.score]);
      return `${step.term} · ${step.course ?? "全部课程"} · ${labels.join(" + ")}`;
    }
  }
}
