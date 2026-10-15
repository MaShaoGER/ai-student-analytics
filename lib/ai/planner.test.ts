import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planQuestion, planQuestionInputSchema } from "./planner";

describe("AI analysis planner", () => {
  let stateDirectory: string;
  beforeEach(() => {
    stateDirectory = mkdtempSync(join(tmpdir(), "analytics-planner-test-"));
    vi.stubEnv("APP_STATE_DIR", stateDirectory);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("uses a verified plan for an exact golden question without calling a model", async () => {
    let called = false;
    const result = await planQuestion(
      { question: "哪门课程平均成绩最高？", datasetId: "oulad" },
      async () => {
        called = true;
        throw new Error("should not be called");
      },
    );

    expect(called).toBe(false);
    expect(result.source).toBe("golden_case");
    expect(result.matchedCaseId).toBe("score-course-top");
    expect(result.plan).toMatchObject({
      datasetId: "oulad",
      metric: "score",
      dimensions: ["course"],
    });
  });

  it("turns structured model fields into the same validated AnalysisPlan", async () => {
    const result = await planQuestion(
      { question: "按学期看看学生是否完成课程", datasetId: "demo" },
      async () => ({
        canAnalyze: true,
        metric: "completion_rate",
        dimension: "term",
        chartType: "line",
        rationale: "问题要求按学期查看课程完成情况。",
        clarificationQuestion: null,
      }),
    );

    expect(result.source).toBe("openai");
    expect(result.plan).toMatchObject({
      datasetId: "demo",
      metric: "completion_rate",
      aggregation: "rate",
      dimensions: ["term"],
      chartType: "line",
    });
  });

  it("stops before querying when the model requests clarification", async () => {
    await expect(
      planQuestion({ question: "哪些学生有风险？", datasetId: "demo" }, async () => ({
        canAnalyze: false,
        metric: "completion_rate",
        dimension: "course",
        chartType: "bar",
        rationale: "当前 MVP 不提供个体风险名单。",
        clarificationQuestion: "是否改为比较各课程的群体完成率？",
      })),
    ).rejects.toMatchObject({
      name: "AIClarificationError",
      clarificationQuestion: "是否改为比较各课程的群体完成率？",
    });
  });

  it("rejects empty and oversized questions before any model call", () => {
    expect(() => planQuestionInputSchema.parse({ question: " ", datasetId: "demo" })).toThrow();
    expect(() =>
      planQuestionInputSchema.parse({ question: "问".repeat(501), datasetId: "demo" }),
    ).toThrow();
  });

  it("does not plan or call a model for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const generator = vi.fn();
    await expect(planQuestion(
      { question: "哪门课程平均成绩最高？", datasetId: "demo" },
      generator,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "CANCELLED" });
    expect(generator).not.toHaveBeenCalled();
  });

  it("passes cancellation to the generator and rejects a late result after cancellation", async () => {
    const controller = new AbortController();
    const generator = vi.fn(async (_question: string, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      return {
        canAnalyze: true,
        metric: "score" as const,
        dimension: "term" as const,
        chartType: "line" as const,
        rationale: "按学期比较成绩。",
        clarificationQuestion: null,
      };
    });
    await expect(planQuestion(
      { question: "请按学期比较成绩的变化", datasetId: "demo" },
      generator,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
