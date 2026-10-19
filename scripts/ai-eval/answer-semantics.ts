import type { Check } from "./unified-scenarios";

export type ExpectedComparison = {
  course: string;
  beforeTerm: string;
  afterTerm: string;
  before: number;
  after: number;
  decline: number;
};

/** Independent oracle for the generated campus CSV, without the SQL/FactRef code. */
export function comparisonFromCsv(
  csv: string,
  beforeTerm: string,
  afterTerm: string,
): ExpectedComparison | null {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = header.split(",");
  const index = (name: string) => {
    const found = columns.indexOf(name);
    if (found < 0) throw new Error(`CSV oracle is missing ${name}`);
    return found;
  };
  const studentIndex = index("id_student"),
    courseIndex = index("code_module"),
    termIndex = index("code_presentation"),
    scoreIndex = index("score");
  const groups = new Map<string, Map<string, Map<string, number[]>>>();
  for (const line of lines) {
    // This oracle deliberately targets the repository's generated sample CSV.
    // Fail on quoted CSV rather than silently parse unsupported input.
    if (line.includes('"')) throw new Error("CSV oracle requires unquoted sample fields");
    const cells = line.split(",");
    const [student, course, term, raw] = [
      cells[studentIndex],
      cells[courseIndex],
      cells[termIndex],
      cells[scoreIndex],
    ];
    if (![beforeTerm, afterTerm].includes(term) || !raw?.trim() || !student || !course) continue;
    const score = Number(raw);
    if (!Number.isFinite(score) || score < 0 || score > 100) continue;
    const terms = groups.get(course) ?? new Map<string, Map<string, number[]>>();
    const students = terms.get(term) ?? new Map<string, number[]>();
    students.set(student, [...(students.get(student) ?? []), score]);
    terms.set(term, students);
    groups.set(course, terms);
  }
  const average = (students: Map<string, number[]> | undefined) => {
    if (!students || students.size < 3) return null;
    const values = [...students.values()].map(
      (scores) => scores.reduce((sum, score) => sum + score, 0) / scores.length,
    );
    return Math.round((values.reduce((sum, score) => sum + score, 0) / values.length) * 100) / 100;
  };
  const changes: ExpectedComparison[] = [];
  for (const [course, terms] of groups) {
    const before = average(terms.get(beforeTerm)),
      after = average(terms.get(afterTerm));
    if (before !== null && after !== null && after < before)
      changes.push({
        course,
        beforeTerm,
        afterTerm,
        before,
        after,
        decline: Math.round((before - after) * 100) / 100,
      });
  }
  return (
    changes.sort((a, b) => b.decline - a.decline || a.course.localeCompare(b.course))[0] ?? null
  );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const amount = (value: number) =>
  escape(String(value)) + (Number.isInteger(value) ? "(?:\\.0{1,2})?" : "0?");

/** Kept independent from the production answer guard so a shared bug cannot certify itself. */
export function comparisonAnswerChecks(answer: string, expected: ExpectedComparison): Check[] {
  const sentences = answer.replace(/(?<=\d),(?=\d)/g, "").split(/[。！？\n]/u);
  let refersToCourse = false;
  const core = sentences.filter((sentence) => {
    const named = sentence.includes(expected.course);
    const continuation = refersToCourse && /^\s*(?:该课程|该课|这门课程)/.test(sentence);
    refersToCourse = named || continuation;
    return refersToCourse;
  });
  const declinePattern = new RegExp(
    `(?:下降(?:了|幅度(?:为|是))?|降幅(?:为|是)?|减少(?:了)?)\\s*${amount(expected.decline)}\\s*分`,
  );
  const scoreChecks = (
    [
      [expected.beforeTerm, expected.before],
      [expected.afterTerm, expected.after],
    ] as const
  ).every(([term, value]) => {
    const pattern = new RegExp(
      `${escape(term)}[^\\d。；，,]{0,12}([+-]?\\d+(?:\\.\\d+)?)\\s*分`,
      "g",
    );
    return core.every((sentence) =>
      [...sentence.matchAll(pattern)].every((match) => Number(match[1]) === value),
    );
  });
  const roleScores = core.every((sentence) =>
    [
      ...sentence.matchAll(
        /(前期|后期)(?:的)?(?:均分|平均成绩|成绩|分数)(?:为|是|降至|升至|达到|降到|升到)?\s*([+-]?\d+(?:\.\d+)?)\s*分/g,
      ),
    ].every(
      (match) => Number(match[2]) === (match[1] === "前期" ? expected.before : expected.after),
    ),
  );
  return [
    {
      name: "answer identifies the independently computed largest-decline course",
      passed: core.some((sentence) =>
        /下降(?:幅度)?(?:最多|最大)|降幅(?:最大|最多)|下滑(?:幅度)?(?:最多|最大)/.test(sentence),
      ),
      detail: expected.course,
    },
    {
      name: "answer binds the decline amount and direction to that course",
      passed: core.some((sentence) => declinePattern.test(sentence)),
      detail: `decline=${expected.decline}`,
    },
    {
      name: "answer preserves the before/after scope",
      passed: answer.includes(expected.beforeTerm) && answer.includes(expected.afterTerm),
    },
    {
      name: "mentioned per-term scores have the correct meaning",
      passed: scoreChecks && roleScores,
    },
  ];
}
