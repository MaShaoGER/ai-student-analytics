import { numeric } from "../analysis/chart-studio";
import { buildFactRef, type ResultRef, type FactRef } from "./result-contract";
import type { ChatArtifact } from "./chat-types";

type Comparison = Extract<ChatArtifact, { kind: "studio" }>;
const format = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
/** Read only the actual dumbbell tool columns; never estimate a missing mean/sample. */
export function studioComparisonValues(artifact: Comparison) {
  if (artifact.tool !== "dumbbell") return [];
  return artifact.table.rows.flatMap((row) => {
    const subject = row["课程"];
    const before = numeric(row["前期均分"]),
      after = numeric(row["后期均分"]);
    const beforeN = numeric(row["前期样本"]),
      afterN = numeric(row["后期样本"]);
    if (
      typeof subject !== "string" ||
      before === null ||
      after === null ||
      beforeN === null ||
      afterN === null ||
      beforeN < 3 ||
      afterN < 3
    )
      return [];
    return [
      { subject, before, after, beforeN, afterN, change: Math.round((after - before) * 100) / 100 },
    ];
  });
}
export function studioComparisonLines(artifact: Comparison) {
  return studioComparisonValues(artifact)
    .slice(0, 8)
    .map(
      (row) =>
        `${row.subject}：${artifact.comparisonTerm || "前期"}均分 ${format(row.before)} 分（${format(row.beforeN)} 个有效样本），${artifact.term || "后期"}均分 ${format(row.after)} 分（${format(row.afterN)} 个有效样本）；${row.change < 0 ? "下降" : row.change > 0 ? "上升" : "变化"} ${format(Math.abs(row.change))} 分。`,
    );
}
export function studioComparisonFactRefs(artifact: Comparison, result: ResultRef): FactRef[] {
  return studioComparisonValues(artifact)
    .slice(0, 8)
    .flatMap((row) => {
      const common = { subject: row.subject, metric: "score" };
      return [
        buildFactRef(result, {
          label: `${row.subject}前期均分`,
          text: `${row.subject}：${artifact.comparisonTerm || "前期"}均分 ${format(row.before)} 分，有效样本 ${format(row.beforeN)} 人。`,
          numeric: { value: row.before, unit: "分", sampleSize: row.beforeN },
          semantic: { ...common, role: "before", term: artifact.comparisonTerm },
          limitations: [],
        }),
        buildFactRef(result, {
          label: `${row.subject}后期均分`,
          text: `${row.subject}：${artifact.term || "后期"}均分 ${format(row.after)} 分，有效样本 ${format(row.afterN)} 人。`,
          numeric: { value: row.after, unit: "分", sampleSize: row.afterN },
          semantic: { ...common, role: "after", term: artifact.term },
          limitations: [],
        }),
        buildFactRef(result, {
          label: `${row.subject}均分变化`,
          text: `${row.subject}：后期减前期为 ${format(row.change)} 分。`,
          numeric: { value: row.change, unit: "分", sampleSize: null },
          semantic: {
            ...common,
            role: "change",
            term: artifact.term,
            comparisonTerm: artifact.comparisonTerm,
          },
          limitations: ["两期群体可能不同，不代表同一批学生的个人变化。"],
        }),
      ];
    });
}
