import { describe, expect, it } from "vitest";
import { courseColorTokens } from "./course-colors";

describe("shared subject colors", () => {
  it("keeps a subject's color when chart or display order changes", () => {
    const names = ["数学", "英语", "数据库", "程序设计"];
    expect(courseColorTokens(names)).toEqual(courseColorTokens([...names].reverse()));
  });
  it("gives all twelve visible panorama subjects distinct palette slots", () => {
    const colors = courseColorTokens(Array.from({ length: 12 }, (_, index) => `课程${index}`));
    expect(new Set(colors.values()).size).toBe(12);
  });
  it("does not let duplicated course names shift the other subjects' colors", () => {
    expect(courseColorTokens(["数学", "英语", "数学"])).toEqual(
      courseColorTokens(["数学", "英语"]),
    );
  });
});
