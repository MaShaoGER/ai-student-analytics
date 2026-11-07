"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { AnalysisResultView } from "./analysis-result";
import { distributionRows, scoreInterval } from "@/lib/analysis/score-distribution";
import type { AnalysisResult } from "@/lib/analysis/types";
import type { ChatArtifact, ChatResponse, ChatDisplayView } from "@/lib/ai/chat-types";
import styles from "./ai-conversation.module.css";
import { ConversationArtifact } from "./conversation-artifact";
import { policyForArtifact } from "@/lib/analysis/presentation-policy";

const ConversationToolResult = dynamic(
  () => import("./conversation-tool-result").then((m) => m.ConversationToolResult),
  {
    loading: () => (
      <p className={styles.loadingHint} role="status">
        正在打开图表…
      </p>
    ),
  },
);

function DistributionResult({
  artifact,
  onViewChange,
  showViewPicker = true,
}: {
  showViewPicker?: boolean;
  artifact: Extract<ChatArtifact, { kind: "distribution" }>;
  onViewChange: (view: "table" | "heatmap") => void;
}) {
  const [view, setView] = useState(artifact.view);
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () =>
      distributionRows(
        artifact.data.groups,
        artifact.term,
        artifact.course,
        artifact.binWidth,
      ).filter((row) => row.course.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
    [artifact, search],
  );
  const max = Math.max(1, ...rows.flatMap((row) => row.bins));
  const unit = artifact.term ? "人" : "人次";
  const intervals = Array.from({ length: 100 / artifact.binWidth }, (_, index) =>
    scoreInterval(index, artifact.binWidth),
  );
  return (
    <section className={`analysis-result ${styles.distribution}`} aria-label="AI 成绩分布结果">
      <div className={styles.resultHeading}>
        <div>
          <span className="section-kicker">SCORE DISTRIBUTION</span>
          <h2>成绩分布</h2>
          <p>
            {artifact.term || "全部学期"} · {artifact.course || "全部课程"} · 每 {artifact.binWidth}{" "}
            分一档
          </p>
        </div>
        {showViewPicker ? (
          <div className={styles.actions} aria-label="成绩分布展示方式">
            <button
              type="button"
              className="secondary-button"
              aria-pressed={view === "heatmap"}
              onClick={() => {
                setView("heatmap");
                onViewChange("heatmap");
              }}
            >
              热力图
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={view === "table"}
              onClick={() => {
                setView("table");
                onViewChange("table");
              }}
            >
              数值表
            </button>
          </div>
        ) : null}
      </div>
      <label className={styles.search}>
        搜索当前结果中的课程
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div
        className={styles.tableScroll}
        role="region"
        aria-label="成绩分布数值表，可横向滚动"
        tabIndex={0}
      >
        <table className={styles.table} data-view={view}>
          <caption>各分数段有效成绩数量（{unit}）；区间含左端、不含右端，最后一档包含100分</caption>
          <thead>
            <tr>
              <th scope="col">课程</th>
              {intervals.map((interval, index) => (
                <th scope="col" key={interval} aria-label={interval} title={interval}>
                  {index * artifact.binWidth}–{(index + 1) * artifact.binWidth}
                </th>
              ))}
              <th scope="col">有效成绩总数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.course}>
                <th scope="row">{row.course}</th>
                {row.bins.map((count, index) => (
                  <td
                    key={index}
                    data-level={view === "heatmap" && count ? Math.ceil((count / max) * 6) : 0}
                    title={`${row.course}，${intervals[index]}，${count}${unit}，占${((count / row.count) * 100).toFixed(1)}%`}
                  >
                    {count.toLocaleString("zh-CN")}
                  </td>
                ))}
                <td>{row.count.toLocaleString("zh-CN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p role="status">当前范围没有满足样本要求的数据，请调整筛选。缺失值不作零分。</p>
      )}
      <p data-workspace-part="composerNote" className={styles.note}>
        仅展示至少 {artifact.data.minSampleSize}{" "}
        人的课程学期分组；同一学生、课程、学期先取有效成绩均值。跨学期分别计次。热力图颜色越深，数量越多，全部课程共用色阶。
      </p>
    </section>
  );
}

export function ConversationResult({
  response,
  artifact,
  artifactIndex,
  onChartChange,
  canExport,
  onReport,
}: {
  response: ChatResponse;
  artifact: ChatArtifact;
  artifactIndex: number;
  onChartChange: (view: ChatDisplayView) => void;
  canExport: boolean;
  onReport: (result: AnalysisResult) => void;
}) {
  const resultId = response.resultRefs?.[artifactIndex]?.resultId;
  const facts = response.factRefs?.filter((fact) => fact.resultId === resultId) ?? [];
  const policy = policyForArtifact(artifact, { facts, resultId });
  const safeArtifact =
    artifact.kind === "studio" &&
    artifact.tool === "density" &&
    policy.structure === "joint_distribution"
      ? { ...artifact, densityMode: "density" as const }
      : artifact;
  return (
    <ConversationArtifact
      artifact={safeArtifact}
      displayView={artifact.view}
      facts={facts}
      resultId={resultId}
      totalFacts={response.facts.length}
      storedPolicy={response.presentationPolicies?.[artifactIndex]}
      onViewChange={onChartChange}
      render={(displayArtifact, change) => (
        <div className={styles.results}>
          {displayArtifact.kind === "analysis" ? (
            <AnalysisResultView
              result={{ ...displayArtifact.result, rows: policy.rows }}
              chartType={displayArtifact.view}
              onChartChange={change}
              showViewPicker={false}
              barOrientation={policy.orientation === "horizontal" ? "horizontal" : "vertical"}
              loading={false}
              planning={response.planning}
              canExport={canExport}
              onReport={onReport}
            />
          ) : displayArtifact.kind === "distribution" ? (
            <DistributionResult
              showViewPicker={false}
              key={displayArtifact.view}
              artifact={displayArtifact}
              onViewChange={change}
            />
          ) : (
            <ConversationToolResult
              showViewPicker={false}
              key={displayArtifact.view}
              artifact={displayArtifact}
              onViewChange={change}
            />
          )}
        </div>
      )}
    />
  );
}
