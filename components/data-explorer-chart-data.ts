import type { ChartData, ChartItem, ChartPickOrigin } from "./concept-chart";
import { CONCEPT_LABELS, type ConceptLocation } from "@/lib/exploration/concepts";
import { CONCEPT_METRICS, type ConceptExplorerData, type ConceptMetric, type ConceptReading } from "@/lib/analysis/concept-explorer";

/** A concept the reader clicked in the chart; it opens a secondary selection, never navigates by itself. */
export type Picked = { kind: "course"; course: string } | { kind: "metric"; metric: ConceptMetric };

export const HIDDEN = "样本 1–2 人，已隐藏";
const percent = (value: number, total: number) => (total ? ((value / total) * 100).toFixed(1) : "0.0");

export function formatReading(metric: ConceptMetric, reading: ConceptReading) {
  if (reading.value === null) return reading.reason ?? "无数据";
  return metric === "score" ? `${reading.value.toFixed(2)} 分` : `${reading.value.toFixed(2)}%`;
}

/** Turns one scene's single dataset into chart items; every drawing renders exactly these. */
export function chartData(location: ConceptLocation, data: ConceptExplorerData, pick: (picked: Picked, origin: ChartPickOrigin) => void): ChartData | string {
  const term = location.term;
  if (location.scene === "home" || (location.scene === "metric" && location.relation === "subject")) {
    const metric: ConceptMetric = location.scene === "home" ? "score" : location.metric;
    const label = CONCEPT_LABELS[metric];
    if (!data.courses.length) return "当前学期没有有效成绩记录";
    return {
      kind: "courses",
      unit: label.unit,
      axis: "课程",
      min: 0,
      max: 100,
      items: data.courses.map((course): ChartItem => {
        const reading = course.metrics[metric];
        return {
          key: course.course,
          label: course.course,
          value: reading.value,
          note: course.suppressed ? HIDDEN : reading.reason ?? "无数据",
          detail: `${course.course} · ${label.name} ${formatReading(metric, reading)}${course.count ? ` · ${course.count} 人` : ""}`,
          onPick: course.suppressed ? undefined : (origin) => pick({ kind: "course", course: course.course }, origin),
        };
      }),
    };
  }
  const course = data.courses.find((item) => item.course === location.course);
  if (!course) return "这门课不在当前学期中";
  if (course.suppressed) return "这门课样本少于 3 人，数值已隐藏";
  if (location.scene === "course") {
    return {
      kind: "profile",
      unit: "mixed",
      axis: "指标",
      min: 0,
      max: 100,
      items: CONCEPT_METRICS.map((metric): ChartItem => {
        const reading = course.metrics[metric];
        const usable = reading.value !== null && reading.count !== null;
        return {
          key: metric,
          label: CONCEPT_LABELS[metric].name,
          value: reading.value,
          note: reading.reason ?? "无数据",
          detail: `${CONCEPT_LABELS[metric].name} ${formatReading(metric, reading)}`,
          onPick: usable ? (origin) => pick({ kind: "metric", metric }, origin) : undefined,
        };
      }),
    };
  }
  const detail = data.detail;
  if (!detail) return "这门课没有可展示的明细";
  const hidden = HIDDEN;
  switch (location.relation) {
    case "trend":
      if (!detail.weeklyAttendance) return "当前数据源没有校园出勤记录";
      return {
        kind: "series", unit: "%", axis: "教学周", min: 0, max: 100,
        items: detail.weeklyAttendance.map((week) => ({
          key: String(week.week), label: String(week.week), value: week.value,
          note: week.suppressed ? "已隐藏" : "无记录",
          detail: week.value === null ? `第 ${week.week} 周 · ${week.suppressed ? hidden : "无记录"}` : `第 ${week.week} 周 · ${week.value.toFixed(2)}% · ${week.count} 课时`,
        })),
      };
    case "dist":
      return {
        kind: "series", unit: "人", axis: "成绩区间 / 分", min: 0,
        items: detail.scoreBins.map((bin) => {
          const range = `${bin.min}–${bin.max}${bin.includeMax ? "" : "（不含）"} 分`;
          return {
            key: String(bin.min), label: String(bin.min), value: bin.suppressed ? null : bin.count,
            note: "已隐藏", tone: bin.min < 60 ? "c" : undefined,
            detail: bin.suppressed ? `${range} · ${hidden}` : `${range} · ${bin.count} 人`,
          } satisfies ChartItem;
        }),
      };
    case "band-score":
    case "band-pass": {
      if (!detail.attendanceBands) return "当前数据源没有校园出勤记录";
      const score = location.relation === "band-score";
      return {
        kind: "series", unit: score ? "分" : "%", axis: "个人学期出勤率区间 / %", min: 0, max: 100,
        items: detail.attendanceBands.map((band) => {
          const range = `${band.min}–${band.max}%`;
          const value = band.suppressed || band.count === 0 ? null : score ? band.meanScore : band.passRate;
          return {
            key: String(band.min), label: range, value,
            note: band.suppressed ? "已隐藏" : "无人",
            detail: band.suppressed ? `出勤 ${range} · ${hidden}` : band.count === 0 ? `出勤 ${range} · 无人`
              : `出勤 ${range} · ${band.count} 人 · ${score ? `均分 ${band.meanScore?.toFixed(2)} 分` : `通过率 ${band.passRate?.toFixed(2)}%`}`,
          } satisfies ChartItem;
        }),
      };
    }
    case "split-pass":
    case "split-done": {
      const pass = location.relation === "split-pass";
      const counts = pass
        ? detail.passCounts && [detail.passCounts.passed, detail.passCounts.failed]
        : detail.completionCounts && [detail.completionCounts.completed, detail.completionCounts.incomplete];
      if (!counts) return pass ? "没有有效成绩" : "当前数据源没有课程完成标记";
      const [yes, no] = counts;
      const total = yes + no;
      return {
        kind: "parts", unit: "人", axis: pass ? "成绩" : "课程完成",
        items: [
          { key: "yes", label: pass ? "≥ 60 分" : "完成", value: yes, tone: "a", detail: `${pass ? "≥ 60 分" : "完成"} · ${yes} 人 · ${percent(yes, total)}%` },
          { key: "no", label: pass ? "< 60 分" : "未完成", value: no, tone: "c", detail: `${pass ? "< 60 分" : "未完成"} · ${no} 人 · ${percent(no, total)}%` },
        ],
      };
    }
    case "work": {
      const work = detail.homework;
      if (!work) return "当前数据源没有作业提交记录";
      return {
        kind: "parts", unit: "份", axis: "作业",
        items: ([["onTime", "按时", "a"], ["late", "迟交", "b"], ["missing", "缺交", "c"]] as const).map(([key, label, tone]) => ({
          key, label, tone, value: work[key], detail: `${label} · ${work[key]} 份 · 应交 ${work.scheduled} 份中 ${percent(work[key], work.scheduled)}%`,
        })),
      };
    }
  }
  return "这个关系没有数据";
}
