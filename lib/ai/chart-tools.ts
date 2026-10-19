import { chartStudioData, courseRelations, coursePanorama } from "../analysis/duckdb";
import type { QueryExecutionOptions } from "../security/query-execution";
import { clearsScope, contextScope, mentionedLabels, type ChatTool } from "./chart-capabilities";
import { chatIntentSchema, type ChatArtifact, type ChatInput, type ChatIntent } from "./chat-types";
import { relationshipMetric, wantsTable, type RelationshipMetric } from "./response-presentation";

export type Catalog = { courses: string[]; terms: string[] };
export class ChartClarification extends Error {}
export function selectedScope(
  input: ChatInput,
  field: "course" | "term",
  catalog: Catalog,
  proposed?: string[] | null,
) {
  if (clearsScope(input.question, field)) return [];
  const labels = field === "course" ? catalog.courses : catalog.terms;
  if (field === "term") {
    const unknown = input.question.match(/\b\d{4}[A-Za-z]\b/g)?.filter((t) => !labels.includes(t));
    if (unknown?.length)
      throw new ChartClarification(
        `当前数据中没有学期 ${unknown.join("、")}，可选择 ${labels.join("、")}。`,
      );
  }
  const explicit = mentionedLabels(input.question, labels);
  if (explicit.length) return explicit;
  if (field === "term") {
    const ordered = [...labels].sort();
    if (/最新|本学期|这学期|当前学期/.test(input.question))
      return ordered.length ? [ordered.at(-1)!] : [];
    if (/上学期|上一学期/.test(input.question)) {
      const current = contextScope(input.context, "term")[0] ?? ordered.at(-1);
      const previous = ordered[ordered.indexOf(current!) - 1];
      if (!previous)
        throw new ChartClarification("当前学期之前没有可用学期，请指定数据中已有的学期。");
      return [previous];
    }
  }
  return proposed?.length ? [...new Set(proposed)] : contextScope(input.context, field);
}
export function makeToolIntent(
  input: ChatInput,
  catalog: Catalog,
  tool: ChatTool,
  proposed?: {
    course?: string | null;
    term?: string | null;
    courses?: string[] | null;
    terms?: string[] | null;
    threshold?: number | null;
    relationMetric?: RelationshipMetric | null;
  },
): Extract<ChatIntent, { kind: "tool" }> {
  const courses = selectedScope(
    input,
    "course",
    catalog,
    proposed?.courses ?? (proposed?.course ? [proposed.course] : null),
  );
  const terms = selectedScope(
    input,
    "term",
    catalog,
    proposed?.terms ?? (proposed?.term ? [proposed.term] : null),
  );
  if (
    courses.some((c) => !catalog.courses.includes(c)) ||
    terms.some((t) => !catalog.terms.includes(t))
  )
    throw new ChartClarification("没有找到对应的课程或学期，请使用数据中的完整名称。");
  if (
    !courses.length &&
    !input.context &&
    /只看|仅看|针对|只展示/.test(input.question) &&
    !clearsScope(input.question, "course")
  )
    throw new ChartClarification("请提供数据中的完整课程名称，以便限定图表范围。");
  if (terms.length > (tool === "dumbbell" ? 2 : 1))
    throw new ChartClarification(
      "这张图按单个学期统计；请指定一个学期，或使用哑铃图比较两个学期。",
    );
  if (clearsScope(input.question, "term"))
    throw new ChartClarification(
      "这张图使用单个学期的数据。请指定一个学期；哑铃图可以指定两个学期作比较。",
    );
  const ordered = [...terms].sort();
  const direction = input.question.match(/从\s*(\d{4}[A-Za-z])\s*(?:到|至|→)\s*(\d{4}[A-Za-z])/);
  if (tool === "dumbbell" && direction && direction[1] === direction[2])
    throw new ChartClarification("请指定两个不同的学期进行比较。");
  const term =
    tool === "dumbbell" && direction && terms.includes(direction[2])
      ? direction[2]
      : (ordered.at(-1) ?? [...catalog.terms].sort().at(-1) ?? "");
  const threshold = input.question.match(
    /(?:低于|不足|未达|阈值|分数线)[：:为是\s]*(\d{1,3})(?:分)?/,
  );
  if (threshold && (Number(threshold[1]) < 1 || Number(threshold[1]) > 100))
    throw new ChartClarification("分数阈值应在一到一百分之间，请调整后继续。");
  return chatIntentSchema.parse({
    kind: "tool",
    tool,
    courses,
    term,
    comparisonTerm:
      tool === "dumbbell"
        ? ordered.length === 2
          ? direction && terms.includes(direction[1])
            ? direction[1]
            : ordered[0]
          : input.context?.kind === "tool" && input.context.tool === tool
            ? input.context.comparisonTerm
            : null
        : null,
    threshold: threshold
      ? Number(threshold[1])
      : (proposed?.threshold ?? (input.context?.kind === "tool" ? input.context.threshold : 60)),
    densityMetric:
      relationshipMetric(input.question, input.context) ??
      proposed?.relationMetric ??
      (input.datasetId === "oulad" ? "activity" : "attendance"),
    densityMode: /密度/.test(input.question)
      ? "density"
      : /散点|关系|关联|相关|联系/.test(input.question)
        ? "scatter"
        : input.context?.kind === "tool" && input.context.tool === "density"
          ? input.context.densityMode
          : "scatter",
    sortChange: /排序|排名|从高到低|从低到高/.test(input.question)
      ? /从低到高|升序/.test(input.question)
        ? "asc"
        : "desc"
      : input.context?.kind === "tool" && input.context.tool === tool
        ? input.context.sortChange
        : undefined,
    view: wantsTable(input.question) ? "table" : "chart",
  }) as Extract<ChatIntent, { kind: "tool" }>;
}
export const toolQueries = {
  studio: chartStudioData,
  relations: courseRelations,
  panorama: coursePanorama,
};
export async function executeChartTool(
  intent: Extract<ChatIntent, { kind: "tool" }>,
  input: ChatInput,
  options: QueryExecutionOptions,
  dependencies: Partial<typeof toolQueries>,
): Promise<ChatArtifact> {
  const deps = { ...toolQueries, ...dependencies };
  if (intent.tool === "chord" || intent.tool === "panorama") {
    const request = {
      datasetId: input.datasetId,
      term: intent.term || undefined,
      threshold: intent.threshold,
      courses: intent.courses.slice(0, 12),
    };
    if (intent.courses.length > 12)
      throw new ChartClarification("关联图最多展示十二门课程，请缩小课程范围。");
    if (intent.tool === "panorama") {
      const data = await deps.panorama(request, options);
      if (intent.courses.some((c) => !data.courses.some((item) => item.name === c)))
        throw new ChartClarification("所选课程在该学期没有达到样本要求的数据，请调整课程或学期。");
      const chosen = intent.courses;
      return {
        kind: "panorama",
        data: chosen.length
          ? {
              ...data,
              courses: data.courses.filter((c) => chosen.includes(c.name)),
              columns: data.columns.filter((c) => chosen.includes(c.course)),
              relations: data.relations.filter(
                (r) => chosen.includes(r.source) && chosen.includes(r.target),
              ),
            }
          : data,
        view: intent.view,
      };
    }
    const data = await deps.relations(request, options);
    if (intent.courses.some((c) => !data.courses.some((item) => item.name === c)))
      throw new ChartClarification("所选课程在该学期没有达到样本要求的数据，请调整课程或学期。");
    const chosen = intent.courses;
    const relations = data.relations.filter((r) =>
      !chosen.length || chosen.length === 1
        ? !chosen.length || r.source === chosen[0] || r.target === chosen[0]
        : chosen.includes(r.source) && chosen.includes(r.target),
    );
    return {
      kind: "relations",
      data: { ...data, relations },
      course: chosen.length === 1 ? chosen[0] : "",
      view: intent.view,
    };
  }
  if (intent.tool === "sankey" && input.datasetId === "oulad")
    throw new ChartClarification(
      "OULAD 没有校园出勤率和作业完成率字段，无法生成这组三层路径。可以生成学习节奏热力图、成绩箱线图或活动量与成绩的散点密度图。",
    );
  if (
    intent.tool === "density" &&
    input.datasetId === "oulad" &&
    intent.densityMetric &&
    intent.densityMetric !== "activity"
  )
    throw new ChartClarification(
      "OULAD 没有出勤或缺勤课时记录，无法计算所问的关系，不能用学习活跃度替代。可以切换到模拟校园数据查看相应的缺勤与成绩关系。",
    );
  const project = await deps.studio(
    input.datasetId,
    intent.term || undefined,
    intent.courses.length === 1 ? intent.courses[0] : "",
    options,
    {
      courses: intent.courses,
      beforeTerm: intent.comparisonTerm ?? undefined,
      densityMetric: intent.densityMetric,
    },
  );
  const type = intent.tool === "rhythm" ? "heatmap" : intent.tool;
  const original = project.tables[type];
  if (!original)
    throw new ChartClarification(
      "当前数据缺少这张图所需的字段。可以尝试成绩箱线图或学习节奏热力图。",
    );
  let table = original;
  if (intent.tool === "dumbbell") {
    const rows = original.rows.map((row) => ({
      ...row,
      变化: Math.round((Number(row["后期均分"]) - Number(row["前期均分"])) * 100) / 100,
    }));
    if (intent.sortChange)
      rows.sort((a, b) =>
        intent.sortChange === "asc" ? a["变化"] - b["变化"] : b["变化"] - a["变化"],
      );
    table = {
      ...original,
      columns: [...original.columns, "变化"],
      rows,
      sortChange: intent.sortChange,
    };
  }
  return {
    kind: "studio",
    tool: intent.tool,
    table,
    term: project.term ?? "",
    view: intent.view,
    // Result identity must distinguish different course scopes.
    courses: intent.courses,
    datasetId: input.datasetId,
    ...(intent.tool === "density" ? { densityMode: intent.densityMode ?? "scatter" } : {}),
  };
}
export function toolFacts(artifact: Exclude<ChatArtifact, { kind: "analysis" | "distribution" }>) {
  if (artifact.kind === "studio")
    return [
      artifact.table.description,
      `返回 ${artifact.table.rows.length} 个聚合数据行；下方图表和数值表使用同一份真实统计。`,
      ...(artifact.tool === "dumbbell"
        ? ["变化为后期均分减前期均分，单位为分；两期选课群体可能不同，不能据此判断个体进步。"]
        : []),
    ];
  const { data } = artifact;
  return [
    `学期 ${data.term ?? "无可用学期"}，共同未达标的阈值为 ${data.threshold} 分；仅展示满足小样本要求的群体。`,
    `当前展示 ${data.courses.length} 门课程（符合条件共 ${data.totalCourses} 门，图表上限 ${data.courseLimit} 门），${data.relations.length} 组薄弱共现。`,
    "共同未达标占比的分母为同时具有两科有效成绩的学生数，不代表因果关系。",
  ];
}
