export type SummaryReading = {
  label: string;
  value: number | null;
  detail: string;
  note?: string;
};

export type SummaryMode = "profile" | "rank" | "trend" | "distribution" | "parts" | "extremes" | "ordered";

const MAX_TEXT_LENGTH = 240;
const PRIVATE_DETAIL = /已隐藏|抑制|不足 3|不足3|样本 1–2|样本1–2|样本少于 3|样本少于3/;

/** Selects facts by the topic's data meaning, never by chart drawing order. */
export function conceptSummary(
  scene: "home" | "course" | "metric",
  title: string,
  mode: SummaryMode,
  readings: readonly SummaryReading[],
): string | null {
  if (scene === "home") return null;
  const visible = readings.filter((reading) => reading.value !== null
    && !PRIVATE_DETAIL.test(`${reading.detail} ${reading.note ?? ""}`));
  if (!visible.length)
    return "当前主题暂无可公开的读数；受抑制或缺失项不会计为 0。";

  let facts: string[];
  const prefix = `本页「${title}」：`;
  if (mode === "profile") {
    const priority = ["均分", "出勤率", "通过率", "课程完成率", "作业提交率", "按时提交率"];
    facts = [...visible]
      .sort((a, b) => {
        const left = priority.findIndex((label) => a.label.includes(label));
        const right = priority.findIndex((label) => b.label.includes(label));
        return (left < 0 ? priority.length : left) - (right < 0 ? priority.length : right);
      })
      .slice(0, 3)
      .map(({ detail }) => detail);
  } else if (mode === "rank" && visible.length > 0) {
    const ordered = [...visible].sort((a, b) => b.value! - a.value!);
    const highest = ordered[0]!;
    const lowest = ordered.at(-1)!;
    facts = visible.length === 1 || highest.value === lowest.value
      ? [`当前展示课程的可见读数为 ${highest.detail}`]
      : [`当前展示课程中最高为 ${highest.detail}`, `最低为 ${lowest.detail}`];
  } else if (mode === "trend") {
    const first = readings[0];
    const last = readings.at(-1);
    if (first?.value === null || last?.value === null || !first || !last
      || PRIVATE_DETAIL.test(`${first.detail} ${first.note ?? ""}`)
      || PRIVATE_DETAIL.test(`${last.detail} ${last.note ?? ""}`)) {
      facts = ["首末时点存在缺失或受抑制读数，具体变化见图表"];
    } else {
      facts = first.value === last.value
        ? [`首末读数相同：${first.detail}`]
        : [`起点 ${first.detail}`, `末点 ${last.detail}`];
    }
  } else if (mode === "distribution") {
    const peak = visible.filter((reading) => reading.value! > 0)
      .reduce<SummaryReading | null>((best, reading) => !best || reading.value! > best.value! ? reading : best, null);
    facts = peak ? [`人数最多的分段为 ${peak.detail}`] : ["当前没有可展示的成绩分段人数"];
  } else if (mode === "extremes") {
    const ordered = [...visible].sort((a, b) => b.value! - a.value!);
    const highest = ordered[0]!;
    const lowest = ordered.at(-1)!;
    facts = highest.value === lowest.value
      ? [`可见读数相同：${highest.detail}`]
      : [`可见范围最高 ${highest.detail}`, `可见范围最低 ${lowest.detail}`];
  } else if (mode === "ordered") {
    facts = [...visible].sort((a, b) => a.label.localeCompare(b.label, "zh-CN")).slice(0, 3).map(({ detail }) => detail);
  } else {
    facts = visible.slice(0, 3).map(({ detail }) => detail);
  }

  const text = `${prefix}${facts.join("；")}。`;
  if (text.length <= MAX_TEXT_LENGTH) return text;
  const shorter = `${prefix}${facts[0] ?? "暂无可展示读数"}。`;
  return shorter.length <= MAX_TEXT_LENGTH ? shorter : `${shorter.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}
