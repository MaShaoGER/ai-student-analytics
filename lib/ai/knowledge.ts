import { createHash } from "node:crypto";
import { METRICS } from "../analysis/metrics";
import type { DataSource } from "../analysis/types";
import type { KnowledgeCitation } from "./chat-types";
import { readState, updateState } from "../settings/storage";

export type KnowledgeDocument = KnowledgeCitation & { keywords: string[] };
export const KNOWLEDGE_VERSION = "2026-10-19.1";
export function knowledgeDocuments(): KnowledgeDocument[] {
  const metrics = Object.entries(METRICS).map(([id, metric]) => ({
    id: `metric-${id}`,
    title: metric.label,
    version: KNOWLEDGE_VERSION,
    source: "/knowledge/teaching#metric-" + id,
    scope: "all" as const,
    excerpt: `${metric.description} 单位：${metric.unit}。模拟校园数据公式：${metric.formula}。OULAD 的字段映射与限制见该数据源说明。`,
    keywords: [
      metric.label,
      id,
      ...(id === "score"
        ? ["成绩", "均分", "平均分"]
        : id === "activity"
          ? ["活跃", "访问", "活动量"]
          : ["完成率", "完成", "结课"]),
    ],
  }));
  return [
    ...metrics,
    {
      id: "attendance-demo",
      title: "出勤、缺勤与旷课的区别",
      version: KNOWLEDGE_VERSION,
      source: "/knowledge/teaching#attendance-demo",
      scope: "demo",
      excerpt:
        "模拟校园数据提供出勤与缺勤记录。缺勤包含已批准请假和旷课；旷课仅指未获批准的缺课。出勤率与课程完成率是不同指标，不能互相替代。",
      keywords: ["出勤", "出勤率", "缺勤", "请假", "旷课", "完成率", "区别"],
    },
    {
      id: "oulad-limits",
      title: "OULAD 数据来源与适用限制",
      version: KNOWLEDGE_VERSION,
      source: "/knowledge/teaching#oulad-limits",
      scope: "oulad",
      excerpt:
        "OULAD 是英国开放大学公开学习分析数据集，完成率依据 final_result 的 Pass 或 Distinction 计算。资源访问次数表示学习活动，不等于出勤。数据没有校园出勤、请假和旷课课时，不能回答相关出勤率或缺勤问题。",
      keywords: ["OULAD", "来源", "完成率", "出勤", "缺勤", "旷课", "活跃", "访问"],
    },
    {
      id: "comparison-scope",
      title: "跨学期比较口径",
      version: KNOWLEDGE_VERSION,
      source: "/knowledge/teaching#comparison-scope",
      scope: "all",
      excerpt:
        "跨学期变化为后期均分减前期均分，单位为分。仅比较两期均达到最小人数阈值的同名课程。两期学生构成可能不同，此比较不是同一学生的配对变化，也不能证明教学或缺勤导致成绩变化。",
      keywords: ["学期", "比较", "变化", "下降", "提升", "均分", "原因", "因果"],
    },
    {
      id: "privacy",
      title: "样本阈值与聚合限制",
      version: KNOWLEDGE_VERSION,
      source: "/knowledge/teaching#privacy",
      scope: "all",
      excerpt:
        "只提供群体聚合分析，不提供学生名单、个人成绩或个体排名。分组至少包含三名不同学生；人数不足的分组被隐藏，隐藏不代表零人。不同分组可能包含相同学生，不能简单相加作为独立总人数。",
      keywords: ["人数", "样本", "阈值", "过滤", "隐藏", "学生", "个人", "名单", "排名"],
    },
    {
      id: "synthetic-demo",
      title: "模拟校园数据说明",
      version: KNOWLEDGE_VERSION,
      source: "/knowledge/teaching#synthetic-demo",
      scope: "demo",
      excerpt:
        "模拟校园数据由程序生成，只用于功能演示与验证，不是真实学生记录，不能作为真实教学效果或真实用户调研证据。实际数据规模以当前载入文件为准。",
      keywords: ["模拟", "演示", "数据来源", "真实", "效果", "数据集"],
    },
  ];
}
function digest(documents: KnowledgeDocument[]) {
  return createHash("sha256").update(JSON.stringify(documents)).digest("hex");
}
type Index = { digest: string; builtAt: string | null; documents: KnowledgeDocument[] };
const initial = (): Index => ({
  digest: digest(knowledgeDocuments()),
  builtAt: null,
  documents: knowledgeDocuments(),
});
export function getKnowledgeIndex() {
  const stored = readState("knowledge-index.json", initial);
  const current = digest(knowledgeDocuments());
  // A changed source is used immediately; stale stored excerpts are never served.
  const index = stored.digest === current ? stored : initial();
  return { ...index, version: KNOWLEDGE_VERSION, stale: stored.digest !== current };
}
export function rebuildKnowledgeIndex() {
  const documents = knowledgeDocuments();
  updateState<Index, void>("knowledge-index.json", initial, (state) => {
    Object.assign(state, {
      documents,
      digest: digest(documents),
      builtAt: new Date().toISOString(),
    });
  });
  return knowledgeStatus();
}
export function knowledgeStatus() {
  const index = getKnowledgeIndex();
  return {
    version: index.version,
    count: index.documents.length,
    builtAt: index.builtAt,
    stale: index.stale,
  };
}

/** Small, deterministic lexical index. Documents are trusted versioned project material, never instructions. */
export function searchKnowledge(
  query: string,
  dataset: DataSource,
  documents = getKnowledgeIndex().documents,
) {
  const text = query.toLowerCase();
  const scored = documents
    .filter((doc) => doc.scope === "all" || doc.scope === dataset)
    .map((doc) => ({
      doc,
      score: doc.keywords.reduce(
        (sum, keyword) => sum + (text.includes(keyword.toLowerCase()) ? keyword.length : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const versions = new Map<string, Set<string>>();
  for (const { doc } of scored) {
    const found = versions.get(doc.id) ?? new Set<string>();
    found.add(doc.version);
    versions.set(doc.id, found);
  }
  const conflict = [...versions.values()].some((set) => set.size > 1);
  return {
    status: conflict
      ? ("conflict" as const)
      : scored.length
        ? ("found" as const)
        : ("not_found" as const),
    citations: conflict
      ? []
      : scored.map(({ doc: { keywords: _keywords, ...citation } }) => citation),
  };
}
