import { describe, expect, it } from "vitest";
import { suggestedQuestionsFor } from "./suggested-questions";

describe("source-aware suggested questions", () => {
  it.each([true, false])("keeps the local absence analysis available for campus data (AI %s)", (aiReady) => {
    expect(suggestedQuestionsFor(aiReady, "demo").some((item) => item.id === "absence-relationship")).toBe(true);
  });

  it.each(["oulad", "grades_00000000-0000-4000-8000-000000000001", null] as const)(
    "does not recommend unsupported absence analysis for %s",
    (datasetId) => {
      for (const aiReady of [true, false]) {
        expect(suggestedQuestionsFor(aiReady, datasetId).some((item) => item.id === "absence-relationship")).toBe(false);
      }
    },
  );

  it("only offers model-dependent analysis when AI is available", () => {
    expect(suggestedQuestionsFor(false, "demo").some((item) => item.requiresAI)).toBe(false);
    expect(suggestedQuestionsFor(true, "demo").some((item) => item.id === "score-distribution")).toBe(true);
  });
});
