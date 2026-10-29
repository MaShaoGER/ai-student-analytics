import { describe, expect, it } from "vitest";
import { composeBoundAnswer } from "./unified";
import type { FactRef } from "./result-contract";

const fact: FactRef = {
  factId: "f-1111111111111111",
  resultId: "result-fixture",
  label: "最低均分",
  text: "AAA 最低均分 50 分",
  numeric: { value: 50, unit: "分", sampleSize: 3 },
  semantic: { subject: "AAA", metric: "score", role: "minimum" },
  limitations: [],
};
describe("fact filtering diagnostics (no rejected prose returned)", () => {
  it("keeps verified prose and explains each rejection without returning its text", () => {
    const result = composeBoundAnswer(
      `AAA最低均分为 {{${fact.factId}}}。最高均分为 {{${fact.factId}}}。均分999分。引用{{f-0000000000000000}}。`,
      [fact],
    );
    expect(result.answer).toBe("AAA最低均分为 50分。");
    expect(result.rejected).toEqual({ unknownReference: 1, meaningMismatch: 1, unboundNumber: 1 });
    expect(result.dropped).toBe(3);
    expect(JSON.stringify(result)).not.toContain("999");
  });
  it.each(["引用{{invalid}}。", "引用{{f-deadbeef}}。", "引用{{f-1111111111111111}。"])(
    "rejects malformed references: %s",
    (text) => {
      const result = composeBoundAnswer(text, [fact]);
      expect(result.answer).toBe("");
      expect(result.rejected.unknownReference).toBe(1);
    },
  );
  it("still rejects full-width numbers and Chinese statistical claims", () => {
    const result = composeBoundAnswer("均分９９分。参与三人。建议核对课程考核。", [fact]);
    expect(result.answer).toBe("建议核对课程考核。");
    expect(result.rejected.unboundNumber).toBe(2);
  });
  it("allows known catalog labels and common quantifiers without trusting new numbers", () => {
    const result = composeBoundAnswer(
      `2025J的AAA最低均分为{{${fact.factId}}}。两个学期需要同口径比较。`,
      [fact],
      ["2025J", "AAA"],
    );
    expect(result.dropped).toBe(0);
    expect(result.answer).toContain("2025J");
    expect(result.answer).toContain("50分");
  });
});
