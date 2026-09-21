import { describe, expect, it } from "vitest";
import { planQuestion, planQuestionInputSchema } from "./planner";

describe("AI analysis planner", () => {
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
});
