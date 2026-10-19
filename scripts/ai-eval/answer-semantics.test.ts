import { describe, expect, it } from "vitest";
import { comparisonAnswerChecks, comparisonFromCsv } from "./answer-semantics";

const expected = {
  course: "AAA",
  beforeTerm: "2024B",
  afterTerm: "2024J",
  before: 80,
  after: 50,
  decline: 30,
};

describe("comparison evaluation checks meaning rather than number membership", () => {
  it("accepts the correct subject, direction, amount and score roles", () => {
    const checks = comparisonAnswerChecks(
      "AAA均分下降最多，从2024B的80分降至2024J的50分，下降30分。",
      expected,
    );
    expect(checks.every((check) => check.passed)).toBe(true);
  });
  it("accepts the largest-decline paraphrase used by the browser answer", () => {
    expect(
      comparisonAnswerChecks(
        "在2024B到2024J的比较中，AAA成绩下降幅度最大。该课程前期均分为80分，后期均分降至50分，下降了30分。",
        expected,
      ).every((check) => check.passed),
    ).toBe(true);
  });
  it.each([
    "其余多数课程呈上升趋势。",
    "2024B与2024J共比较30门课程。",
    "BBB在2024B到2024J均分下降最多，下降30分。",
    "AAA在2024B到2024J均分下降最多，上升30分。",
    "AAA均分下降最多，从2024B的50分降至2024J的80分，下降30分。",
    "AAA均分下降最多，从2024B的30分降至2024J的50分，下降30分。",
    "AAA在2024B到2024J均分下降最多，前期均分为30分，后期均分为50分，下降30分。",
  ])("rejects a missing or semantically wrong answer: %s", (answer) => {
    expect(comparisonAnswerChecks(answer, expected).some((check) => !check.passed)).toBe(true);
  });
  it("independently averages valid student records and excludes missing or undersized groups", () => {
    const csv = [
      "id_student,code_module,code_presentation,score",
      "S1,AAA,2024B,90",
      "S1,AAA,2024B,70",
      "S2,AAA,2024B,80",
      "S3,AAA,2024B,80",
      "S1,AAA,2024J,40",
      "S2,AAA,2024J,50",
      "S3,AAA,2024J,60",
      "S4,AAA,2024J,",
      "S1,BBB,2024B,100",
      "S1,BBB,2024J,0",
    ].join("\n");
    expect(comparisonFromCsv(csv, "2024B", "2024J")).toEqual(expected);
  });
});
