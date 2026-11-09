import { describe, expect, it } from "vitest";
import { conceptSummary } from "./concept-summary";

const reading = (label: string, value: number | null, detail = `${label} ${value ?? "无记录"}`, note?: string) => ({ label, value, detail, note });

describe("conceptSummary", () => {
  it("puts the course score first and never ranks unlike units", () => {
    const result = conceptSummary("course", "数据结构", "profile", [
      reading("出勤率", 83.45, "出勤率 83.45%"), reading("均分", 66.91, "均分 66.91 分"),
      reading("通过率", 75.5, "通过率 75.50%"), reading("课程完成率", 90.5, "课程完成率 90.50%"),
    ]);
    expect(result).toContain("均分 66.91 分；出勤率 83.45%；通过率 75.50%");
    expect(result).not.toMatch(/最高|最低|高于|低于/);
  });

  it("uses the highest and lowest shown courses for a rank chart", () => {
    const result = conceptSummary("metric", "出勤率—学科", "rank", [
      reading("课程 A", 70, "课程 A 出勤率 70.00%"), reading("课程 B", 92, "课程 B 出勤率 92.00%"), reading("课程 C", 40, "课程 C 出勤率 40.00%"),
    ]);
    expect(result).toContain("当前展示课程中最高为 课程 B");
    expect(result).toContain("最低为 课程 C");
  });

  it("does not claim a ranking when all ranked values tie", () => {
    const result = conceptSummary("metric", "均分—学科", "rank", [
      reading("课程 A", 80, "课程 A 均分 80.00 分"), reading("课程 B", 80, "课程 B 均分 80.00 分"),
    ]);
    expect(result).toContain("当前展示课程的可见读数为");
    expect(result).not.toContain("最高");
  });

  it("summarizes only the most populated score interval, not lowest bin count as low score", () => {
    const result = conceptSummary("metric", "成绩分布", "distribution", [
      reading("0", 0, "0–10 分 · 0 人"), reading("10", 4, "10–20 分 · 4 人"), reading("20", 9, "20–30 分 · 9 人"),
    ]);
    expect(result).toContain("人数最多的分段为 20–30 分 · 9 人");
    expect(result).not.toContain("最低");
    expect(result).not.toContain("0–10 分");
  });

  it("uses true series endpoints only when both endpoints are visible", () => {
    const full = conceptSummary("metric", "出勤率—教学周", "trend", [
      reading("1", 82, "第 1 周 82.00%"), reading("2", 84, "第 2 周 84.00%"), reading("3", 79, "第 3 周 79.00%"), reading("4", 86, "第 4 周 86.00%"),
    ]);
    expect(full).toContain("起点 第 1 周 82.00%");
    expect(full).toContain("末点 第 4 周 86.00%");
    const missingStart = conceptSummary("metric", "出勤率—教学周", "trend", [
      reading("1", null, "第 1 周 · 样本少于 3 人，已隐藏"), reading("2", 84, "第 2 周 84.00%"),
    ]);
    expect(missingStart).not.toContain("起点");
    expect(missingStart).not.toContain("末点");
  });
  it("does not claim trend endpoints for band-based profile rows", () => {
    const result = conceptSummary("metric", "出勤率—成绩", "parts", [reading("1–3", 48, "出勤 1–3% · 均分 65.00 分"), reading("4–6", 76, "出勤 4–6% · 均分 73.00 分")]);
    expect(result).not.toMatch(/起点|末点|最高|最低/);
  });

  it("keeps parts as independent facts", () => {
    const result = conceptSummary("metric", "完成与未完成", "parts", [reading("完成", 120, "完成 · 120 人 · 60.0%"), reading("未完成", 80, "未完成 · 80 人 · 40.0%")]);
    expect(result).toContain("完成 · 120 人");
    expect(result).toContain("未完成 · 80 人");
    expect(result).not.toMatch(/上升|下降|最高|最低/);
  });

  it("filters suppressed notes even if a hidden item has a numeric value", () => {
    const result = conceptSummary("metric", "出勤率—成绩", "parts", [
      reading("1–3", 25, "出勤率 1–3%", "样本 1–2 人，已隐藏"), reading("4–6", 75, "出勤率 4–6% · 均分 72.00 分"),
    ]);
    expect(result).not.toContain("1–3%");
    expect(result).toContain("4–6");
  });

  it("omits home and handles topics with no public readings", () => {
    expect(conceptSummary("home", "课程全景", "profile", [reading("课程 A", 66, "课程 A 66 分")])).toBeNull();
    expect(conceptSummary("metric", "出勤率—成绩", "parts", [reading("1–3", null, "样本 1–2 人，已隐藏"), reading("3–5", null, "无记录")])).toBe("当前主题暂无可公开的读数；受抑制或缺失项不会计为 0。");
  });

  it("caps total summary length for long labels", () => {
    const result = conceptSummary("metric", "课名".repeat(80), "profile", [reading("一", 70, `${"课程名称".repeat(80)} 70%`), reading("二", 71, "课程2 71%")]);
    expect([...result!].length).toBeLessThanOrEqual(240);
  });
});
