/**
 * The single source of recommended questions for every entry point: the
 * conversation empty state, the composer preset menu and the home "试着问问"
 * card. The two golden cases and the relationship question are deterministic
 * (verified preset plan or the local density tool), so they still work without
 * any AI connection as the unified entry's degraded fallback; the
 * score-distribution question needs the model's tool loop to run.
 */
export type SuggestedQuestion = {
  id: string;
  question: string;
  requiresAI: boolean;
};

export const SUGGESTED_QUESTIONS: readonly SuggestedQuestion[] = [
  { id: "compare-courses", question: "比较各课程平均成绩。", requiresAI: false },
  { id: "term-trend", question: "各学期平均成绩如何？", requiresAI: false },
  { id: "score-distribution", question: "各科成绩分布如何？", requiresAI: true },
  { id: "absence-relationship", question: "缺勤次数和成绩有关系吗？", requiresAI: false },
];

/** Without a configured AI, hide rather than disable the questions that need it. */
export function suggestedQuestionsFor(
  aiReady: boolean,
  datasetId?: string,
): readonly SuggestedQuestion[] {
  return SUGGESTED_QUESTIONS.filter(
    (item) =>
      (aiReady || !item.requiresAI) &&
      (!datasetId?.startsWith("grades_") || item.id !== "absence-relationship"),
  );
}
