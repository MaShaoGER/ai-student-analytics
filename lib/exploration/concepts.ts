import { dataSourceSchema, type DataSource } from "../analysis/types";
import type { ConceptExplorerData, ConceptMetric } from "../analysis/concept-explorer";
import { workspaceParams } from "../navigation";

export type ConceptDrawing = "rank" | "bars" | "dots" | "radar" | "line" | "stack";
export type ConceptRelation = "band-score" | "band-pass" | "trend" | "subject" | "dist" | "split-pass" | "split-done" | "work";
export type ConceptLocation =
  | { scene: "home"; drawing: "rank" | "dots"; term?: string }
  | { scene: "course"; course: string; drawing: "bars" | "dots" | "radar"; term?: string }
  | { scene: "metric"; course: string; metric: ConceptMetric; relation: ConceptRelation; drawing: ConceptDrawing; term?: string };
export type ConceptRoute =
  | { status: "valid"; location: ConceptLocation; datasetId?: DataSource }
  | { status: "invalid"; message: string };

export const CONCEPT_LABELS: Record<ConceptMetric, { name: string; unit: string; definition: string }> = {
  attendance: { name: "出勤率", unit: "%", definition: "实际出勤课时 ÷ 应到课时，包含迟到与早退，不包含请假缺席" },
  score: { name: "均分", unit: "分", definition: "当前课程有效成绩的平均值，百分制" },
  pass: { name: "通过率", unit: "%", definition: "成绩至少60分的人数 ÷ 有效成绩人数" },
  completion: { name: "课程完成率", unit: "%", definition: "课程完成标记的比例；不是教学目标达成率" },
  homework: { name: "作业提交率", unit: "%", definition: "按时与迟交的作业份数 ÷ 应交作业份数" },
  ontime: { name: "按时提交率", unit: "%", definition: "按时提交份数 ÷ 应交作业份数" },
};
export const DRAWING_LABELS: Record<ConceptDrawing, string> = {
  rank: "排序条", bars: "柱形", dots: "点位", radar: "雷达", line: "折线", stack: "堆叠条",
};
export type ConceptRelationOption = { id: ConceptRelation; label: string; scope: "course" | "all"; drawings: readonly ConceptDrawing[] };
export const CONCEPT_RELATIONS: Record<ConceptMetric, readonly ConceptRelationOption[]> = {
  attendance: [
    { id: "band-score", label: "出勤率—成绩", scope: "course", drawings: ["bars", "dots"] },
    { id: "band-pass", label: "出勤率—通过率", scope: "course", drawings: ["bars", "dots"] },
    { id: "trend", label: "出勤率—教学周", scope: "course", drawings: ["line", "bars"] },
    { id: "subject", label: "出勤率—学科", scope: "all", drawings: ["rank", "dots"] },
  ],
  score: [
    { id: "dist", label: "成绩分布", scope: "course", drawings: ["bars", "dots"] },
    { id: "band-score", label: "出勤率—成绩", scope: "course", drawings: ["bars", "dots"] },
    { id: "subject", label: "均分—学科", scope: "all", drawings: ["rank", "dots"] },
  ],
  pass: [
    { id: "split-pass", label: "60分两侧人数", scope: "course", drawings: ["stack", "bars"] },
    { id: "band-pass", label: "出勤率—通过率", scope: "course", drawings: ["bars", "dots"] },
    { id: "subject", label: "通过率—学科", scope: "all", drawings: ["rank", "dots"] },
  ],
  completion: [
    { id: "split-done", label: "完成与未完成", scope: "course", drawings: ["stack", "bars"] },
    { id: "subject", label: "课程完成率—学科", scope: "all", drawings: ["rank", "dots"] },
  ],
  homework: [
    { id: "work", label: "作业去向", scope: "course", drawings: ["stack", "bars"] },
    { id: "subject", label: "作业提交率—学科", scope: "all", drawings: ["rank", "dots"] },
  ],
  ontime: [
    { id: "work", label: "作业去向", scope: "course", drawings: ["stack", "bars"] },
    { id: "subject", label: "按时提交率—学科", scope: "all", drawings: ["rank", "dots"] },
  ],
};
export function conceptDrawings(location: ConceptLocation): readonly ConceptDrawing[] {
  if (location.scene === "home") return ["rank", "dots"];
  if (location.scene === "course") return ["bars", "dots", "radar"];
  return CONCEPT_RELATIONS[location.metric].find(option => option.id === location.relation)!.drawings;
}
/**
 * The identity of one visited topic. A drawing is another view of the same data;
 * a term change is a range change of the same page, handled via replaceState in commit().
 * Neither drawing nor term are part of the key.
 */
export function conceptTopicKey(location: ConceptLocation): string {
  if (location.scene === "home") return "home";
  if (location.scene === "course") return JSON.stringify(["course", location.course]);
  return JSON.stringify(["metric", location.course, location.metric, location.relation]);
}
export function conceptTitle(location: ConceptLocation): string {
  if (location.scene === "home") return "课程全景";
  if (location.scene === "course") return location.course;
  return CONCEPT_RELATIONS[location.metric].find(option => option.id === location.relation)!.label;
}
export function conceptRelationReason(metric: ConceptMetric, relation: ConceptRelation, data: ConceptExplorerData): string | null {
  if (["band-score", "band-pass", "trend"].includes(relation) && !data.capabilities.attendance) return "当前数据源没有校园出勤记录";
  if (relation === "work" && !data.capabilities.homework) return "当前数据源没有作业提交记录";
  if ((relation === "split-done" || (relation === "subject" && metric === "completion")) && !data.capabilities.completion) return "当前数据源没有课程完成标记";
  if (relation === "subject" && ["attendance", "homework", "ontime"].includes(metric)) {
    if (metric === "attendance" && !data.capabilities.attendance) return "当前数据源没有校园出勤记录";
    if (metric !== "attendance" && !data.capabilities.homework) return "当前数据源没有作业提交记录";
  }
  return null;
}
export function metricLocation(course: string, metric: ConceptMetric, term: string | undefined, data: ConceptExplorerData): ConceptLocation | null {
  const relation = CONCEPT_RELATIONS[metric].find(option => !conceptRelationReason(metric, option.id, data));
  return relation ? { scene: "metric", course, metric, relation: relation.id, drawing: relation.drawings[0], term } : null;
}
export function conceptHref(location: ConceptLocation, datasetId?: DataSource): string {
  const params = new URLSearchParams();
  if (datasetId) params.set("source", datasetId === "demo" ? "sample" : datasetId);
  if (location.term) params.set("term", location.term);
  if (location.scene !== "home") params.set("course", location.course);
  if (location.scene === "metric") { params.set("indicator", location.metric); params.set("relation", location.relation); }
  if (location.drawing !== conceptDrawings(location)[0]) params.set("drawing", location.drawing);
  const path = location.scene === "home" ? "/explore" : `/explore/${location.scene}`;
  return params.size ? `${path}?${params}` : path;
}
/**
 * Native back/forward notifies every listener in the app. A browse address belongs
 * to the explorer for this source only when it names the browse workspace and, if
 * it names a source, that same source; anything else is another screen's entry.
 */
export function ownsBrowseLocation(input: string, datasetId: DataSource): boolean {
  const workspace = workspaceParams(input).get("workspace");
  if (workspace && workspace !== "overview") return false;
  const route = parseConceptLocation(input);
  return route.status !== "valid" || !route.datasetId || route.datasetId === datasetId;
}
export function parseConceptLocation(input: string): ConceptRoute {
  const params = workspaceParams(input);
  const fail = (): ConceptRoute => ({ status: "invalid", message: "这个探索地址无效，请回到课程全景重新开始。" });
  const keys = ["workspace", "browse", "drawing", "term", "course", "indicator", "relation", "dataset", "source"];
  if (keys.some(key => params.getAll(key).length > 1)) return fail();
  if (["focus", "draft", "lens", "target"].some(key => params.has(key))) return fail();
  if (params.has("source") && params.has("dataset")) return fail();
  const source = params.get("source");
  if (source === "demo") return fail();
  const rawDataset = source === "sample" ? "demo" : source ?? params.get("dataset");
  const dataset = rawDataset !== null ? dataSourceSchema.safeParse(rawDataset) : null;
  if (dataset && !dataset.success) return fail();
  const datasetId = dataset?.success ? dataset.data : undefined;
  // Pasted links carry padding around values; the trimmed value is the only form the app writes back.
  const rawTerm = params.get("term");
  const term = rawTerm === null ? undefined : rawTerm.trim();
  if (term !== undefined && (!term || term.length > 80)) return fail();
  const scene = params.get("browse") ?? "home";
  const drawing = params.get("drawing");
  if (scene === "home") {
    if (params.has("course") || params.has("indicator") || params.has("relation") || (drawing !== null && drawing !== "rank" && drawing !== "dots")) return fail();
    return { status: "valid", location: { scene: "home", drawing: drawing ?? "rank", term }, datasetId };
  }
  const rawCourse = params.get("course");
  const course = rawCourse === null ? undefined : rawCourse.trim();
  if (!course || course.length > 120) return fail();
  if (scene === "course") {
    if (params.has("indicator") || params.has("relation") || (drawing !== null && !["bars", "dots", "radar"].includes(drawing))) return fail();
    return { status: "valid", location: { scene: "course", course, drawing: (drawing ?? "bars") as "bars" | "dots" | "radar", term }, datasetId };
  }
  const metric = params.get("indicator") as ConceptMetric;
  const relation = params.get("relation") as ConceptRelation;
  if (scene !== "metric" || !Object.hasOwn(CONCEPT_LABELS, metric)) return fail();
  const option = CONCEPT_RELATIONS[metric].find(item => item.id === relation);
  if (!option || (drawing !== null && !option.drawings.includes(drawing as ConceptDrawing))) return fail();
  return { status: "valid", location: { scene: "metric", course, metric, relation, drawing: (drawing ?? option.drawings[0]) as ConceptDrawing, term }, datasetId };
}
