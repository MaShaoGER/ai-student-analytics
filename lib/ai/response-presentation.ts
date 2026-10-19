import { requestedTool, type ChatTool } from "./chart-capabilities";
import type { ChatArtifact, ChatInput, ChatIntent } from "./chat-types";
import type { ChartViewType } from "../analysis/visualization";
import type { StudioRelationshipMetric } from "../analysis/chart-studio";

export type AnalysisGoal =
  "explain" | "lookup" | "compare" | "trend" | "distribution" | "relationship" | "auto";
export type RelationshipMetric = StudioRelationshipMetric;
export type ResponsePresentation = "text" | "chart" | "table";
export function inferGoal(question: string, proposed?: AnalysisGoal | null): AnalysisGoal {
  if (/是什么|什么是|怎么理解|有什么区别|的区别|如何阅读|原理|介绍/.test(question))
    return "explain";
  if (/关系|关联|相关|联系/.test(question)) return "relationship";
  if (/分布|离散|集中程度|波动大不大/.test(question)) return "distribution";
  if (/趋势|走势|随.*学期|按学期.*(?:变化|比较)|各学期.*变化/.test(question)) return "trend";
  if (/对比|比较|排名|各门|各科|每门|差异/.test(question)) return "compare";
  if (/多少|几人|哪门.*(?:最高|最低)|哪个.*(?:最高|最低)|均分是|平均成绩是/.test(question))
    return "lookup";
  return proposed ?? "auto";
}
export function relationshipMetric(
  question: string,
  context?: ChatIntent | null,
): RelationshipMetric | undefined {
  if (/旷课/.test(question)) return "unexcused";
  if (/缺勤|缺课|缺席/.test(question)) return "absence";
  if (/出勤|到课/.test(question)) return "attendance";
  if (/活动|活跃|访问/.test(question)) return "activity";
  return context?.kind === "tool" && context.tool === "density" ? context.densityMetric : undefined;
}
export function inferChartTool(input: ChatInput): ChatTool | undefined {
  const explicit = requestedTool(input.question);
  if (explicit) return explicit;
  const goal = inferGoal(input.question);
  if (goal === "explain") return undefined;
  // Relationship questions map to the deterministic density tool: the tool is
  // local, so "缺勤次数和成绩有关系吗？" still works without a model. A plain
  // distribution question ("各科成绩分布如何？") is deliberately NOT mapped to
  // a local boxplot: score-distribution is a model-planned view (heatmap/table),
  // and guessing a boxplot here silently changed the requested artifact.
  if (
    goal === "relationship" &&
    relationshipMetric(input.question, input.context) &&
    (/成绩|得分|分数|均分/.test(input.question) ||
      (input.context?.kind === "tool" && input.context.tool === "density"))
  )
    return "density";
  return undefined;
}
export function wantsTable(question: string) {
  const positive = question.replace(
    /(?:不需要|不要|不用|不必|别用)(?:用|返回|显示|生成)?(?:表格|数值表)/g,
    "",
  );
  return /表格|数值表|列成表|清单|明细|逐项|列出每门|列出各门/.test(positive);
}
export function wantsText(question: string) {
  return /只(?:用|要)?(?:文字|结论)|用文字(?:回答|说明|概括)|一句话(?:回答|说明|概括)|不要(?:图表|图和表)|不需要任何图|不用(?:任何)?图表/.test(
    question,
  );
}
export function responsePresentation(
  question: string,
  artifact: ChatArtifact,
  goal: AnalysisGoal,
): ResponsePresentation {
  if (wantsText(question)) return "text";
  if (wantsTable(question)) return "table";
  if (/图|可视化/.test(question)) return "chart";
  if (goal === "lookup" || goal === "explain") return "text";
  if (artifact.kind === "analysis" && artifact.result.rows.length === 1 && goal === "auto")
    return "text";
  return artifact.view === "table" ? "table" : "chart";
}
const format = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export function binnedCorrelation(
  artifact: Extract<ChatArtifact, { kind: "studio" }>,
): number | null {
  const [x, y, weight] = artifact.table.columns;
  const rows = artifact.table.rows
    .map((row) => ({ x: Number(row[x]), y: Number(row[y]), n: Number(row[weight]) }))
    .filter(
      (row) =>
        Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.n) && row.n > 0,
    );
  const n = rows.reduce((sum, row) => sum + row.n, 0);
  if (!n) return null;
  const meanX = rows.reduce((sum, row) => sum + row.x * row.n, 0) / n;
  const meanY = rows.reduce((sum, row) => sum + row.y * row.n, 0) / n;
  const xx = rows.reduce((sum, row) => sum + (row.x - meanX) ** 2 * row.n, 0);
  const yy = rows.reduce((sum, row) => sum + (row.y - meanY) ** 2 * row.n, 0);
  const xy = rows.reduce((sum, row) => sum + (row.x - meanX) * (row.y - meanY) * row.n, 0);
  return xx > 0 && yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
}
export function resultNarrative(
  artifact: ChatArtifact,
  goal: AnalysisGoal,
  question: string,
): string {
  if (artifact.kind === "analysis") {
    const { rows, metricLabel, unit } = artifact.result;
    const term = artifact.plan.filters?.find((f) => f.field === "term");
    const scope = term ? `${term.op === "eq" ? term.value : term.value.join("、")}，` : "";
    if (!rows.length)
      return "当前筛选下没有达到样本要求的数据，不能将其当作零值。可以调整课程或学期。";
    const sorted = [...rows].sort((a, b) => a.value - b.value);
    const course = artifact.plan.filters?.find((f) => f.field === "course");
    const subject =
      artifact.result.dimension === "term" && course
        ? course.op === "eq"
          ? course.value
          : `${course.value.join("、")}合并统计`
        : rows[0].dimension;
    if (rows.length === 1)
      return `${scope}${subject}的${metricLabel}为 ${format(rows[0].value)}${unit}，参与统计 ${format(rows[0].sampleSize)} 人。`;
    const low = sorted[0],
      high = sorted.at(-1)!;
    if (goal === "lookup") {
      const row = /最低|最少/.test(question) ? low : high;
      return `${scope}本次返回分组中，${row.dimension}的${metricLabel}${/最低|最少/.test(question) ? "最低" : "最高"}，为 ${format(row.value)}${unit}。`;
    }
    if (goal === "trend" || artifact.plan.dimensions[0] === "term")
      return `已按学期展示${metricLabel}的变化，共 ${rows.length} 个分组；各学期的样本可能不同，变化不直接代表同一批学生的个人进步。`;
    return `${scope}本次比较 ${rows.length} 个分组的${metricLabel}：${high.dimension}为 ${format(high.value)}${unit}，${low.dimension}为 ${format(low.value)}${unit}，相差 ${format(high.value - low.value)}${unit === "%" ? "个百分点" : unit}。`;
  }
  if (artifact.kind === "studio") {
    if (!artifact.table.rows.length) return "当前范围没有达到样本要求的数据，可以调整课程或学期。";
    if (artifact.tool === "density") {
      const x = artifact.table.columns[0].replace(/区间中心$/, "");
      const r = binnedCorrelation(artifact);
      const observation =
        r === null
          ? "当前分档数据缺乏足够变化，无法判断线性关联。"
          : `按可见分档数据估算，${x}与成绩的相关系数约为 ${format(r)}，${Math.abs(r) < 0.1 ? "线性关联接近于零" : r < 0 ? "呈负向关联" : "呈正向关联"}，不代表因果。`;
      const definition = /缺勤/.test(x)
        ? "缺勤按课时统计，包含请假缺席和旷课。"
        : /旷课/.test(x)
          ? "旷课按课时统计，不含已批准请假。"
          : "";
      return `${artifact.term}，${observation}${definition}${wantsText(question) ? "" : `图中横轴为${x}、纵轴为成绩，${artifact.densityMode === "density" ? "颜色" : "点的大小"}表示选课人次。`}`;
    }
    if (artifact.tool === "boxplot")
      return `用箱线图比较 ${artifact.table.rows.length} 门课程的成绩分布，可同时观察中位数、分布区间与离散程度。`;
    if (artifact.tool === "dumbbell")
      return `已比较两个学期的课程均分，连线呈现变化方向，数值表包含后期减前期的差值；两期选课群体可能不同。`;
    if (artifact.tool === "rhythm")
      return "用热力图呈现各课程逐周的人均活动次数，颜色越深表示该周活动越多；没有记录的组合留空。";
    return "用桑基图呈现出勤、作业完成和成绩档位的群体分布，连接带宽度表示选课人次，不能据此判断因果。";
  }
  if (artifact.kind === "distribution")
    return `已展示${artifact.term || "所选学期范围"}的成绩分布，按 ${artifact.binWidth} 分一档；颜色表示对应分数段的有效成绩人数。`;
  return artifact.kind === "relations"
    ? "用弦图呈现学科共同未达标的情况，连接带越宽表示共现人数越多；可点选查看共同选课样本与占比。"
    : "全景图汇集所选学期的各科成绩分布、均分、及格率与薄弱共现，便于一起观察。";
}
