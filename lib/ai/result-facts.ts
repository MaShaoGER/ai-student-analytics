import { distributionRows, scoreInterval } from "../analysis/score-distribution";
import type { ChatArtifact } from "./chat-types";
import { toolFacts } from "./chart-tools";

const number = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

/**
 * Prose facts for a computed artifact. Moved out of `conversation.ts` so both
 * the unified tool loop and the deterministic local paths share one source
 * without an import cycle.
 */
export function resultFacts(artifact: ChatArtifact): string[] {
  if (artifact.kind !== "analysis" && artifact.kind !== "distribution") return toolFacts(artifact);
  if (artifact.kind === "analysis") {
    const { result, plan } = artifact;
    const rows = [...result.rows].sort((a, b) => b.value - a.value);
    if (!rows.length) return ["当前筛选没有达到样本要求的统计结果；这不表示指标为零。"];
    return [
      `本次返回 ${rows.length} 个分组，最多返回 ${plan.limit} 个；仅展示至少 ${result.minSampleSize} 人的分组。`,
      `返回分组中最高：${rows[0].dimension}，${result.metricLabel} ${number(rows[0].value)} ${result.unit}，参与统计 ${number(rows[0].sampleSize)} 人。`,
      ...(rows.length > 1
        ? [
            `返回分组中最低：${rows.at(-1)!.dimension}，${number(rows.at(-1)!.value)} ${result.unit}；高低差 ${number(rows[0].value - rows.at(-1)!.value)} ${result.unit === "%" ? "个百分点" : result.unit}。`,
          ]
        : []),
      "各组样本可能重叠，人数不能直接相加；汇总差异不能证明原因或评价个体。",
    ];
  }
  const rows = distributionRows(
    artifact.data.groups,
    artifact.term,
    artifact.course,
    artifact.binWidth,
  );
  if (!rows.length) return ["当前筛选没有达到样本要求的成绩分布；这不表示无人学习或成绩为零。"];
  return [
    `本次展示 ${rows.length} 门课程，按 ${artifact.binWidth} 分一档；${artifact.term ? `学期 ${artifact.term}` : "全部学期，跨学期分别计次"}。`,
    ...rows.slice(0, 4).map((row) => {
      const peak = Math.max(...row.bins);
      const indices = row.bins.flatMap((count, index) => (count === peak ? [index] : []));
      return `${row.course}：有效成绩 ${number(row.count)} ${artifact.term ? "人" : "人次"}；${indices.length > 1 ? "并列最多分数段之一" : "最多的分数段"}为 ${scoreInterval(indices[0], artifact.binWidth)}，${number(peak)} ${artifact.term ? "人" : "人次"}，占 ${((peak / row.count) * 100).toFixed(1)}%。`;
    }),
    `只统计有效成绩，先按学生、课程、学期取均值；不足 ${artifact.data.minSampleSize} 人的课程学期分组已排除，缺失值不作零分。`,
  ];
}
