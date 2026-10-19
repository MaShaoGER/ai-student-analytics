import type { FactRef } from "./result-contract";

/** Conservative checks for common numeric misattributions, not a proof of prose semantics. */
export function factUseMatchesMeaning(prefix: string, fact: FactRef, facts: FactRef[]) {
  // The multi-value summary can be quoted whole, but never inserted into a
  // score/change/headcount slot as if it were one atomic measurement.
  if (fact.label === "学期比较结论")
    return !/(?:均分|分数|成绩|最低分|最高分|降幅|差值|人数|样本|从|降至|下降|相差)[^，,。；;]{0,12}$/.test(
      prefix,
    );
  const semantic = fact.semantic;
  if (!semantic) return true;
  const clause = prefix.split(/[，,；;。！？!?]/u).at(-1) ?? "";
  const local = clause.replace(/\{\{[^}]+\}\}/g, " ");
  const roleWords = [
    ...local.matchAll(
      /下降幅度|降幅|变化|差值|差距|相差|下降(?:了)?|减少(?:了)?|最低(?:分|均分)?|最高(?:分|均分)?|前期(?:均分)?|后期(?:均分)?|均分(?:为|是)?|成绩(?:为|是)?|从|降至|升至/g,
    ),
  ];
  const meaning = roleWords.at(-1)?.[0] ?? "";
  const difference = /下降|降幅|变化|差值|差距|相差|减少/.test(meaning) && meaning !== "降至";
  if (["decrease", "change", "range"].includes(semantic.role) && meaning && !difference)
    return false;
  if (["before", "after", "minimum", "maximum"].includes(semantic.role) && difference) return false;
  if (semantic.role === "maximum" && /最低|最少/.test(meaning)) return false;
  if (semantic.role === "minimum" && /最高|最多/.test(meaning)) return false;
  if (semantic.role === "before" && /后期/.test(meaning)) return false;
  if (semantic.role === "after" && /前期/.test(meaning)) return false;
  if (semantic.role === "change" && /下降|减少|降幅/.test(meaning)) return false;
  if (semantic.role === "decrease" && /变化|差值/.test(meaning)) return false;
  if (semantic.role === "sample_size" && meaning && !/人数|样本/.test(local)) return false;
  if (["before", "after", "sample_size"].includes(semantic.role) && semantic.term) {
    const terms = [semantic.term, semantic.comparisonTerm].filter((term): term is string =>
      Boolean(term),
    );
    const lastTerm = terms
      .filter((term) => local.includes(term))
      .sort((a, b) => local.lastIndexOf(b) - local.lastIndexOf(a))[0];
    if (lastTerm && lastTerm !== semantic.term) return false;
  }
  // A value from one course must not be assigned to a different named course.
  const subjects = [
    ...new Set(facts.flatMap((item) => (item.semantic ? [item.semantic.subject] : []))),
  ];
  const subject = subjects
    .filter((name) => prefix.includes(name))
    .sort((a, b) => prefix.lastIndexOf(b) - prefix.lastIndexOf(a))[0];
  return !subject || semantic.role === "range" || subject === semantic.subject;
}

export function answerCoverageProblems(
  question: string,
  answer: string,
  citedFactIds: string[],
  facts: FactRef[],
) {
  const cited = facts.filter((fact) => citedFactIds.includes(fact.factId));
  const issues: string[] = [];
  const numericalQuestion =
    /多少|几人|几门|几次|几天|幅度|哪(?:门|个|些).*?(?:最高|最低|最多|最少)|(?:下降|提升|增长|减少)最多/.test(
      question,
    );
  // A whole program-written comparison is also safe evidence, but it must be
  // rendered whole; its many values must never alias a single numeric slot.
  const summary = facts.find((fact) => fact.label === "学期比较结论");
  const completeSummary = Boolean(summary && answer.includes(summary.text));
  const noDecline = Boolean(
    summary?.text.includes("没有均分下降") && /没有.*下降|未.*下降/.test(answer),
  );
  if (
    numericalQuestion &&
    facts.some((fact) => fact.numeric) &&
    !cited.some((fact) => fact.numeric) &&
    !completeSummary &&
    !noDecline
  )
    issues.push("未完整回答本轮数值问题");
  if (/下降最多|降幅最大|下滑最多|哪(?:门|个).*下降|下降多少|下降幅度/.test(question)) {
    const winner = facts.find((fact) => fact.semantic?.largestDecline);
    if (
      winner &&
      !completeSummary &&
      (!citedFactIds.includes(winner.factId) || !answer.includes(winner.semantic!.subject))
    )
      issues.push("未完整回答下降最多的课程及其降幅");
  }
  const extremeRole = /(?:下降|降幅|下滑|提升|上升|增幅).*最/.test(question)
    ? null
    : /最低|最少/.test(question)
      ? "minimum"
      : /最高|最多/.test(question)
        ? "maximum"
        : null;
  const extreme = extremeRole && facts.find((fact) => fact.semantic?.role === extremeRole);
  if (
    extreme &&
    (!citedFactIds.includes(extreme.factId) || !answer.includes(extreme.semantic!.subject))
  )
    issues.push("未完整回答所问分组及其指标值");
  return issues;
}
