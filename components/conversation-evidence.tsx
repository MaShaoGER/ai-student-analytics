"use client";

import type { CSSProperties } from "react";
import type { AnalysisStep, ChatResponse } from "@/lib/ai/chat-types";
import { executionStatus } from "@/lib/ai/execution-status";
import { Icon, type IconName } from "./app-icons";
import { AiStatus, type AiStatusState } from "./ui/ai-status";
import styles from "./conversation-evidence.module.css";

// AI Status uses adapted Rare UI source; evidence interactions reference Web Search.
// Attribution and reuse conditions: docs/third-party-notices.md.
export function AnalysisStatus({
  steps,
  live = false,
  completion,
}: {
  steps: AnalysisStep[];
  live?: boolean;
  completion?: ChatResponse["completion"];
}) {
  if (!live && !steps.length) return null;
  const { state, label, completed } = executionStatus(steps, live, completion);
  const phase: AiStatusState =
    state === "completed"
      ? "done"
      : state === "cancelled"
        ? "stopped"
        : state !== "running"
          ? state === "failed"
            ? "error"
            : "partial"
          : /检索|搜索/.test(label)
            ? "researching"
            : /生成|撰写|回答|整理/.test(label)
              ? "writing"
              : /选择|规划|理解/.test(label)
                ? "thinking"
                : /读取|查询|统计|比较|计算|校验/.test(label)
                  ? "analyzing"
                  : "thinking";
  return <AiStatus state={phase} label={label} detail={`已完成 ${completed} 步`} live={live} />;
}

export function ExecutionSteps({
  steps,
  live = false,
  completion,
}: {
  steps: AnalysisStep[];
  live?: boolean;
  completion?: ChatResponse["completion"];
}) {
  if (!live && !steps.length) return null;
  return (
    <details className={styles.trace} aria-label="分析执行过程">
      <summary className={`${styles.summary} ${styles.traceSummary}`}>
        <AnalysisStatus steps={steps} live={live} completion={completion} />
        <Icon name="chevron" size={13} />
      </summary>
      {steps.length ? (
        <ol className={styles.steps}>
          {steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span className={styles.stepMark} aria-hidden="true">
                <Icon
                  name={
                    step.status === "completed"
                      ? "check"
                      : step.status === "running"
                        ? "clock"
                        : step.status === "cancelled"
                          ? "close"
                          : "info"
                  }
                  size={13}
                />
              </span>
              <span className={styles.stepLabel}>{step.label}</span>
              <small>
                {step.status === "running"
                  ? "执行中"
                  : step.status === "failed"
                    ? "未完成"
                    : step.status === "cancelled"
                      ? "已停止"
                      : `${(step.durationMs / 1000).toFixed(1)} 秒`}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.waiting}>等待执行步骤…</p>
      )}
    </details>
  );
}

export function ConversationEvidence({
  response,
}: {
  response: Pick<ChatResponse, "facts" | "factRefs" | "resultRefs" | "citations">;
}) {
  const citations = response.citations ?? [];
  const results = response.resultRefs ?? [];
  const hasStatistics = response.facts.length > 0 || results.length > 0;
  if (!hasStatistics && !citations.length) return null;
  const marks: IconName[] = [
    ...(hasStatistics ? (["database"] as const) : []),
    ...citations.slice(0, 2).map(() => "book" as const),
  ];
  return (
    <details className={styles.evidence}>
      <summary className={styles.summary}>
        <span className={styles.sourceMarks} aria-hidden="true">
          {marks.map((icon, index) => (
            <span key={index}>
              <Icon name={icon} size={13} />
            </span>
          ))}
        </span>
        <strong>分析依据</strong>
        <span className={styles.summaryDetail}>
          {hasStatistics ? `${response.facts.length} 条统计事实` : ""}
          {hasStatistics && citations.length ? " · " : ""}
          {citations.length ? `${citations.length} 条教学引用` : ""}
        </span>
        <Icon name="chevron" size={13} />
      </summary>
      <div className={styles.evidenceBody}>
        {hasStatistics ? (
          <section aria-label="统计依据">
            <h3>数字从哪来</h3>
            {results.length ? (
              <div className={styles.scopeCards}>
                {results.map((result, index) => (
                  <div
                    className={styles.scopeCard}
                    key={result.resultId}
                    style={{ "--source-delay": `${Math.min(index, 4) * 45}ms` } as CSSProperties}
                  >
                    <span className={styles.cardLabel}>
                      <Icon name="database" size={14} />
                      统计结果
                    </span>
                    <p>{result.scopeLabel}</p>
                    <small>
                      {result.sampleSize === null
                        ? "未提供单一参与人数"
                        : `参与统计 ${result.sampleSize} 人`}
                    </small>
                    {result.limitations.map((limitation, index) => (
                      <p className={styles.limitation} key={index}>
                        {limitation}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            <ul className={styles.facts}>
              {response.facts.map((fact, index) => {
                const ref = response.factRefs?.find((item) => item.text === fact);
                return (
                  <li key={ref?.factId ?? index} title={ref ? `数字依据 ${ref.factId}` : undefined}>
                    {fact}
                  </li>
                );
              })}
            </ul>
            {response.factRefs?.length ? (
              // Internal fact ids stay copyable but folded away: the count above
              // and the statements here are what a teacher needs to read.
              <details style={{ marginTop: 12, color: "var(--muted)", fontSize: 11 }}>
                <summary style={{ cursor: "pointer", minHeight: 24 }}>技术详情</summary>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.8 }}>
                  {response.factRefs.map((ref, index) => (
                    <li key={ref.factId}>
                      {ref.factId} · 第 {index + 1} 条统计事实
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}
        {citations.length ? (
          <section aria-label="教学资料引用">
            <h3>依据与引用</h3>
            <div className={styles.citationCards}>
              {citations.map((citation, index) => (
                <details
                  className={styles.citation}
                  key={citation.id}
                  style={{ "--source-delay": `${Math.min(index, 4) * 45}ms` } as CSSProperties}
                >
                  <summary>
                    <span className={styles.cardLabel}>
                      <Icon name="book" size={14} />
                      教学资料 ［{index + 1}］
                    </span>
                    <strong>{citation.title}</strong>
                    <span className={styles.citationVersion}>{citation.version}</span>
                    <span className={styles.previewLabel}>
                      查看引用片段 <Icon name="chevron" size={12} />
                    </span>
                  </summary>
                  <div className={styles.citationBody}>
                    <p>{citation.excerpt}</p>
                    <a href={citation.source} target="_blank" rel="noreferrer">
                      查看来源与适用范围 <Icon name="arrowUpRight" size={13} />
                      <span className="sr-only">（在新标签页打开）</span>
                    </a>
                  </div>
                </details>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}
