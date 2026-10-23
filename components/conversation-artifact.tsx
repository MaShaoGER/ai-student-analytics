"use client";

import { useMemo, useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./app-icons";
import {
  policyForArtifact,
  type ArtifactPresentationPolicy,
  type PolicyContext,
  type StoredArtifactPresentationPolicy,
} from "@/lib/analysis/presentation-policy";
import type { ChatArtifact, ChatDisplayView } from "@/lib/ai/chat-types";
import styles from "./conversation-artifact.module.css";

type RenderArtifact = (
  artifact: ChatArtifact,
  onChange: (view: ChatDisplayView) => void,
  policy: ArtifactPresentationPolicy,
) => ReactNode;

type CommonProps = {
  artifact: ChatArtifact;
  question?: string;
  capabilities?: PolicyContext["capabilities"];
  facts?: PolicyContext["facts"];
  resultId?: string | null;
  /** Facts across the whole answer; `factIds` only counts the ones bound to this result. */
  totalFacts?: number;
  /** Optional server snapshot; revalidated locally before it reaches the renderer. */
  storedPolicy?: StoredArtifactPresentationPolicy | null;
  /** Optional controlled display choice (local UI state; never a server write). */
  displayView?: ChatDisplayView | null;
  /** Notifies the parent so a collapsed/reopened attachment can keep its choice. */
  onViewChange?: (view: ChatDisplayView) => void;
};

type SlotProps =
  { render: RenderArtifact; children?: never } | { render?: never; children: ReactNode };

export type ConversationArtifactProps = CommonProps & SlotProps;

const VIEW_LABEL: Record<ChatDisplayView, string> = {
  bar: "条形图",
  line: "折线图",
  pie: "环形图",
  treemap: "矩形树图",
  radar: "雷达图",
  scatter: "散点图",
  heatmap: "热力图",
  table: "数值表",
  chart: "图表",
};

const VIEW_ICON: Record<ChatDisplayView, IconName> = {
  bar: "chart",
  line: "line",
  pie: "pie",
  treemap: "treemap",
  radar: "radar",
  scatter: "scatter",
  heatmap: "dashboard",
  table: "database",
  chart: "chart",
};

const ACCEPTED_VIEWS: Record<ChatArtifact["kind"], readonly ChatDisplayView[]> = {
  analysis: ["bar", "line", "pie", "treemap", "radar", "scatter", "table"],
  studio: ["chart", "table"],
  distribution: ["heatmap", "table"],
  relations: ["chart", "table"],
  panorama: ["chart", "table"],
};

export function compatibleArtifactView(artifact: ChatArtifact, view: ChatDisplayView) {
  if (!ACCEPTED_VIEWS[artifact.kind].includes(view)) return false;
  if (artifact.kind === "analysis") return view !== "chart" && view !== "heatmap";
  if (artifact.kind === "distribution") return view === "heatmap" || view === "table";
  return view === "chart" || view === "table";
}

export function withArtifactView(artifact: ChatArtifact, view: ChatDisplayView): ChatArtifact {
  if (!compatibleArtifactView(artifact, view)) return artifact;
  if (artifact.kind === "analysis")
    return { ...artifact, view: view as Exclude<ChatDisplayView, "chart" | "heatmap"> };
  if (artifact.kind === "distribution") return { ...artifact, view: view as "heatmap" | "table" };
  return { ...artifact, view: view as "chart" | "table" };
}

export function mergeStoredPolicy(
  artifact: ChatArtifact,
  policy: ArtifactPresentationPolicy,
  storedPolicy: CommonProps["storedPolicy"],
) {
  if (
    !storedPolicy ||
    storedPolicy.version !== policy.version ||
    storedPolicy.structure !== policy.structure ||
    (storedPolicy.resultId && policy.resultId && storedPolicy.resultId !== policy.resultId)
  )
    return policy;
  // Revalidate the saved choice against current rules. A stale snapshot can
  // restore a preference, never a structurally invalid chart.
  const requested =
    storedPolicy.allowedViews.includes(artifact.view) &&
    compatibleArtifactView(artifact, artifact.view)
      ? artifact.view
      : policy.requestedView;
  return {
    ...policy,
    requestedView: requested,
    effectiveView:
      requested && policy.allowedViews.includes(requested) ? requested : policy.effectiveView,
    fallbackReason:
      requested && !policy.allowedViews.includes(requested)
        ? (policy.rejectedViews.find((item) => item.view === requested)?.reason ??
          policy.fallbackReason)
        : policy.fallbackReason,
    factIds: storedPolicy.factIds.filter((id) => policy.factIds.includes(id)),
    orientation: storedPolicy.orientation,
  };
}

function orientationLabel(policy: ArtifactPresentationPolicy) {
  if (policy.effectiveView === "bar" && policy.orientation === "horizontal")
    return "横向条形 · 类别名更易读";
  if (policy.effectiveView === "line" || policy.orientation === "vertical")
    return "时间从左到右 · 缺失不补零";
  return null;
}

export function ConversationArtifact({
  artifact,
  question,
  capabilities,
  facts,
  resultId,
  totalFacts,
  storedPolicy,
  displayView,
  render,
  children,
  onViewChange,
}: ConversationArtifactProps) {
  const policy = useMemo(
    () =>
      mergeStoredPolicy(
        artifact,
        policyForArtifact(artifact, { question, capabilities, facts, resultId }),
        storedPolicy,
      ),
    [artifact, capabilities, facts, question, resultId, storedPolicy],
  );
  const [requested, setRequested] = useState<ChatDisplayView | null>(null);
  const [notice, setNotice] = useState("");
  const id = useId();
  // A local/controlled selection must drive the slot; otherwise only
  // aria-pressed changes. The parent may keep this in local display state.
  const preferred = displayView ?? requested;
  const activeView =
    preferred && policy.allowedViews.includes(preferred) ? preferred : policy.effectiveView;
  const effectiveArtifact = withArtifactView(artifact, activeView);
  const reasonId = `${id}-reason`;
  const allowed = policy.allowedViews.filter((view) => compatibleArtifactView(artifact, view));
  const requestedRejected =
    !preferred && policy.requestedView
      ? policy.rejectedViews.find((item) => item.view === policy.requestedView)
      : undefined;
  const visibleReason = policy.fallbackReason ?? requestedRejected?.reason ?? null;
  const visibleNotice = notice || visibleReason;
  const orientation = orientationLabel({ ...policy, effectiveView: activeView });

  const change = (view: ChatDisplayView) => {
    const rejection = policy.rejectedViews.find((item) => item.view === view);
    if (!allowed.includes(view)) {
      // Focused controls already expose rejected forms as disabled. This guard
      // protects programmatic/assistive calls and explains why no renderer ran.
      setNotice(
        rejection?.reason ??
          `${VIEW_LABEL[view]}不是当前真实结果可证实的展示形式；当前保留${VIEW_LABEL[policy.effectiveView]}。`,
      );
      return;
    }
    setRequested(view);
    setNotice("");
    onViewChange?.(view);
  };

  const slot =
    render?.(effectiveArtifact, change, { ...policy, effectiveView: activeView }) ?? children;

  // Result and fact ids are internal bookkeeping: keep them in the tooltip so the
  // card header stays readable, and say how a per-result count relates to the
  // answer-wide "统计事实" count instead of leaving two unexplained numbers.
  const identityTitle = [
    policy.resultId ? `结果编号 ${policy.resultId}` : null,
    policy.factIds.length ? `数字依据 ${policy.factIds.join(" · ")}` : null,
    "图、表和结论共用同一计算结果",
  ]
    .filter(Boolean)
    .join(" · ");
  const factSummary = policy.factIds.length
    ? `本结果绑定 ${policy.factIds.length} 条统计事实${
        totalFacts && totalFacts > policy.factIds.length
          ? ` · 全部 ${totalFacts} 条见“分析依据”`
          : ""
      }`
    : "未提供数字依据引用";

  return (
    <section
      className={styles.wrapper}
      aria-label={`分析结果附件 · ${VIEW_LABEL[activeView]}`}
      data-view={activeView}
      data-structure={policy.structure}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.kicker}>可信结果</span>
          <h3>{VIEW_LABEL[activeView]}</h3>
          <span className={styles.identity} title={identityTitle}>
            {factSummary}
          </span>
        </div>
        <div className={styles.controls} role="group" aria-label="结果展示方式">
          {allowed.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={activeView === view}
              onClick={() => change(view)}
              title={`${VIEW_LABEL[view]}（复用同一计算结果，不重新查询）`}
            >
              <Icon name={VIEW_ICON[view]} size={14} />
              <span>{VIEW_LABEL[view]}</span>
            </button>
          ))}
        </div>
      </header>

      <div className={styles.body}>{slot}</div>

      {(orientation || visibleNotice) && (
        <footer className={styles.footer}>
          <p className={visibleNotice ? styles.notice : styles.hint} id={reasonId} role="status">
            <Icon name="info" size={13} />
            {visibleNotice ??
              (orientation === "横向条形 · 类别名更易读"
                ? "课程按横向条形比较，长名称保持可读。"
                : "学期按真实时间顺序连接；缺失值不补零。")}
          </p>
        </footer>
      )}
    </section>
  );
}
