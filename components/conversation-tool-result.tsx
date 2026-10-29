"use client";

import dynamic from "next/dynamic";
import { useState, type CSSProperties } from "react";
import { SegmentedControl } from "./ui/segmented-control";
import styles from "./ai-conversation.module.css";
import { defaultStudioFields } from "@/lib/analysis/chart-studio";
import { relationKey } from "@/lib/analysis/course-relations";
import { toolLabel } from "@/lib/ai/chart-capabilities";
import type { ChatArtifact, ChatDisplayView } from "@/lib/ai/chat-types";

const StudioChart = dynamic(() => import("./studio-chart").then((m) => m.StudioChart), {
  loading: () => (
    <p className={styles.loadingHint} role="status">
      正在绘图…
    </p>
  ),
});
const RelationChart = dynamic(
  () => import("./course-relation-chart").then((m) => m.CourseRelationChart),
  {
    loading: () => (
      <p className={styles.loadingHint} role="status">
        正在绘图…
      </p>
    ),
  },
);
const PanoramaChart = dynamic(
  () => import("./course-panorama-chart").then((m) => m.CoursePanoramaChart),
  {
    loading: () => (
      <p className={styles.loadingHint} role="status">
        正在绘图…
      </p>
    ),
  },
);
type ToolArtifact = Exclude<ChatArtifact, { kind: "analysis" | "distribution" }>;
export function ConversationToolResult({
  artifact,
  onViewChange,
  showViewPicker = true,
}: {
  showViewPicker?: boolean;
  artifact: ToolArtifact;
  onViewChange: (view: ChatDisplayView) => void;
}) {
  const [focus, setFocus] = useState(artifact.kind === "relations" ? artifact.course : "");
  const [selection, setSelection] = useState("");
  const label =
    artifact.kind === "studio"
      ? artifact.tool === "density"
        ? "联合分档密度图"
        : toolLabel(artifact.tool)
      : artifact.kind === "relations"
        ? "学科关联弦图"
        : "学科全景";
  const columns =
    artifact.kind === "studio"
      ? artifact.table.columns
      : artifact.kind === "panorama"
        ? ["课程", "均分", "及格率", "有效人数"]
        : ["学科一", "学科二", "共同选课人数", "共同未达标人数", "共同未达标占比"];
  const rows =
    artifact.kind === "studio"
      ? artifact.table.rows.map((row) => columns.map((c) => row[c]))
      : artifact.kind === "panorama"
        ? artifact.data.columns.map((c) => [
            c.course,
            c.baseline.mean,
            `${c.baseline.passRate}%`,
            c.baseline.count,
          ])
        : artifact.data.relations.map((r) => [
            r.source,
            r.target,
            r.commonCount,
            r.belowCount,
            `${r.rate}%`,
          ]);
  return (
    <section
      className={`analysis-result ${styles.distribution}`}
      aria-label={`AI ${label}结果`}
      data-enter="fade"
      style={{ "--enter-dur": "320ms", "--enter-delay": "40ms" } as CSSProperties}
    >
      <div
        className={styles.resultHeading}
        data-enter="rise-sm"
        style={{ "--enter-delay": "80ms" } as CSSProperties}
      >
        <div>
          <span className="section-kicker">DATA CHART</span>
          <h2>{label}</h2>
        </div>
        {showViewPicker ? (
          <SegmentedControl
            value={artifact.view}
            options={[
              { value: "chart", label: "图表" },
              { value: "table", label: "数值表" },
            ]}
            onChange={onViewChange}
            label="高级图表展示方式"
          />
        ) : null}
      </div>
      {!rows.length ? (
        <p className="notice" role="status" data-enter="fade">
          当前筛选下没有满足样本要求的数据；可调整课程或学期。这不表示数值为零。
        </p>
      ) : artifact.view === "table" ? (
        <div
          className={styles.tableScroll}
          role="region"
          aria-label="图表数值表，可横向滚动"
          tabIndex={0}
          data-enter="rise-sm"
          style={{ "--enter-delay": "140ms" } as CSSProperties}
        >
          <table className={styles.table}>
            <caption>{label} · 真实聚合数据</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((v, j) => (
                    <td key={j}>{v === null || v === undefined ? "—" : String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : artifact.kind === "studio" ? (
        <StudioChart
          type={artifact.tool === "rhythm" ? "heatmap" : artifact.tool}
          table={artifact.table}
          fields={defaultStudioFields(
            artifact.tool === "rhythm" ? "heatmap" : artifact.tool,
            artifact.table,
          )}
          densityMode={artifact.densityMode ?? "density"}
          aggregate="mean"
        />
      ) : artifact.kind === "relations" ? (
        <>
          <RelationChart
            data={artifact.data}
            course={focus}
            selectedKey={selection}
            onCourse={(course) => {
              setFocus((previous) => (previous === course ? "" : course));
              setSelection("");
            }}
            onRelation={(key) => {
              setSelection((previous) => (previous === key ? "" : key));
              setFocus("");
            }}
          />
          <label
            className="control-field"
            data-enter="rise-sm"
            style={{ "--enter-delay": "160ms" } as CSSProperties}
          >
            <span>查看关联详情</span>
            <select
              value={selection}
              onChange={(e) => {
                setSelection(e.target.value);
                setFocus("");
              }}
            >
              <option value="">选择关联</option>
              {artifact.data.relations.map((r) => (
                <option key={relationKey(r)} value={relationKey(r)}>
                  {r.source} ↔ {r.target}：{r.belowCount} 人 / {r.rate}%
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <PanoramaChart data={artifact.data} disabled onSelect={() => {}} />
      )}
    </section>
  );
}
