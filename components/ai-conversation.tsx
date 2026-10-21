"use client";

import dynamic from "next/dynamic";
import { toolLabel } from "@/lib/ai/chart-capabilities";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AnalysisResultView } from "./analysis-result";
import { Icon } from "./app-icons";
import { ConversationEvidence, ExecutionSteps } from "./conversation-evidence";
import { useMotionPreferences } from "./ui/motion-preferences";
import { distributionRows, scoreInterval } from "@/lib/analysis/score-distribution";
import type { AnalysisResult } from "@/lib/analysis/types";
import type { ChartViewType } from "@/lib/analysis/visualization";
import type {
  ChatArtifact,
  ChatMessage,
  ChatResponse,
  ChatDisplayView,
  AnalysisStep,
} from "@/lib/ai/chat-types";
import { RESULT_CONTRACT_VERSION } from "@/lib/ai/result-contract";
import { planningMethodLabel } from "@/lib/ai/context-label";
import { suggestedQuestionsFor } from "@/lib/ai/suggested-questions";
import styles from "./ai-conversation.module.css";
import experience from "./conversation-experience.module.css";
import { ConversationArtifactBoundary } from "./conversation-artifact-boundary";
import { ConversationArtifact } from "./conversation-artifact";
import { policyForArtifact } from "@/lib/analysis/presentation-policy";
import { ConversationHistory, type ConversationHistoryProps } from "./conversation-history";
import { useConversationScroll } from "./hooks/use-conversation-scroll";

export type ConversationTurn = ChatMessage & {
  id: string;
  response?: ChatResponse;
  /** Locally generated status line (e.g. a cancelled turn), not sent to the model. */
  system?: boolean;
  steps?: AnalysisStep[];
  generatedAt?: number;
  restored?: boolean;
};

const QUESTION_ERROR_ID = "analysis-question-error";
const COMPOSER_FIELDS_ID = "analysis-composer-fields";
/** Enough of the draft to recognise it in the folded button's tooltip. */
const DRAFT_PREVIEW_LENGTH = 24;

function Speaker({ role }: { role: ChatMessage["role"] }) {
  return (
    <div className={styles.speaker}>
      <span className={styles.avatar} data-role={role}>
        <Icon name={role === "user" ? "users" : "sparkles"} size={15} />
      </span>
      <strong>{role === "user" ? "你" : "学析台"}</strong>
    </div>
  );
}

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

function artifactLabel(artifact: ChatArtifact) {
  if (artifact.kind === "studio")
    return `${artifact.tool === "density" ? "联合分档密度图" : toolLabel(artifact.tool)} · ${artifact.term}`;
  if (artifact.kind === "relations" || artifact.kind === "panorama")
    return `${artifact.kind === "relations" ? "学科关联弦图" : "学科全景"} · ${artifact.data.term ?? "无可用学期"}`;
  return artifact.kind === "analysis"
    ? `${artifact.result.metricLabel} · 按${artifact.result.dimension === "term" ? "学期" : "课程"} · ${artifact.result.rows.length} 个分组`
    : `成绩分布 · ${artifact.term || "全部学期"} · ${artifact.course || "全部课程"} · 每 ${artifact.binWidth} 分一档`;
}

/**
 * 图表附件的展开/收起：展开/收起只动画 transform + opacity，高度由内容自然撑开，
 * 不做 layout 动画。收起时先播完退出过渡再卸载图表，避免"啪"地消失；
 * 动效关闭或系统减少动态效果时直接切换，键盘用户保持即时反馈。
 */
function ChartAttachmentBody({
  expanded,
  id,
  children,
}: {
  expanded: boolean;
  id: string;
  children: ReactNode;
}) {
  const { enabled, reduced } = useMotionPreferences();
  const [rendered, setRendered] = useState(expanded);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (expanded) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    if (!enabled || reduced) {
      setRendered(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [enabled, expanded, reduced, rendered]);

  return (
    <div
      id={id}
      className={styles.attachmentBody}
      data-state={closing ? "closing" : "open"}
      hidden={!rendered}
      inert={!expanded || closing ? true : undefined}
    >
      {rendered && children}
    </div>
  );
}

/** One line under the answer: who chose the analysis method, and why. */
function PlanningNote({ planning }: { planning: ChatResponse["planning"] }) {
  return (
    <p className={styles.planning} data-enter="fade">
      <span>分析方式：{planningMethodLabel(planning)}</span>
      {planning.rationale ? (
        <span className={styles.planningRationale} title={planning.rationale}>
          {planning.rationale}
        </span>
      ) : null}
    </p>
  );
}

function ResponseWarning({ warning }: { warning: string }) {
  // Old saved turns retain their original warning; explain them without
  // rewriting the stored response or changing the message TTL.
  const filtered = /未核验数字|事实引用核验|文字核验|已省略这些句子/.test(warning);
  if (!filtered)
    return (
      <p className="notice notice-warning" role="status">
        {warning}
      </p>
    );
  const onlyFiltering =
    /^(?:部分解释含未核验数字或无效事实引用，已省略这些句子。|文字核验：[^。]*。[^。]*。)$/.test(
      warning,
    );
  // Tool, timeout and save failures remain visible even alongside a filter notice.
  if (!onlyFiltering)
    return (
      <p className="notice notice-warning" role="status">
        {warning}
      </p>
    );
  return (
    <details className={styles.validationNote}>
      <summary>部分解释未通过核验 · 查看说明</summary>
      <p>{warning}</p>
      <p>
        过滤只针对 AI
        解释文字；已返回的可信统计结果可在附件和分析依据中核对。未核验句子不会作为结论展示。
      </p>
    </details>
  );
}

export function ConversationWorkspace({
  messages,
  question,
  loading,
  pendingQuestion,
  pendingSteps,
  aiReady,
  aiAllowed,
  canRun,
  canExport,
  model,
  contextLabel,
  inputError,
  expandedChartId,
  onQuestionChange,
  onAsk,
  onStop,
  onClear,
  onClearContext,
  onExpandChart,
  onChartChange,
  onReport,
  onConfigure,
  notice,
  history,
  conversationId,
  sourceControl,
  onRetrySave,
  historyActivity,
}: {
  historyActivity?: ReactNode;
  onRetrySave: (id: string) => void;
  history: ConversationHistoryProps;
  conversationId: string | null;
  sourceControl?: ReactNode;
  messages: ConversationTurn[];
  question: string;
  loading: boolean;
  pendingQuestion: string;
  pendingSteps: AnalysisStep[];
  aiReady: boolean;
  /** Account permission for AI; deployment availability alone is insufficient. */
  aiAllowed: boolean;
  canRun: boolean;
  canExport: boolean;
  model?: string | null;
  contextLabel?: string | null;
  inputError?: string | null;
  expandedChartId: string | null;
  onQuestionChange: (value: string) => void;
  onAsk: (question?: string) => void;
  onStop: () => void;
  onClear: () => void;
  onClearContext?: () => void;
  onExpandChart: (id: string | null) => void;
  onChartChange: (id: string, view: ChatDisplayView, artifactIndex?: number) => void;
  onReport: (result: AnalysisResult) => void;
  onConfigure?: () => void;
  notice?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const scroll = useConversationScroll(conversationId ?? "new", messages.length, loading);
  const { newest, pending } = scroll;
  const [clearConfirming, setClearConfirming] = useState(false);
  const [contextNotice, setContextNotice] = useState("");
  // Collapsing only hides controls: the draft lives in the parent's `question`
  // state, so the textarea keeps its value while folded away.
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const wasCollapsed = useRef(false);
  const stopRequested = useRef(false);

  // A reply can start while the composer is folded (e.g. a transcript
  // suggestion); unfold so "停止回复" stays on screen and reachable.
  useEffect(() => {
    if (loading) setComposerCollapsed(false);
  }, [loading]);

  // Collapse and expand move focus with the control that survives the swap:
  // folding hands focus to the expand button, unfolding returns it to the
  // textarea without scrolling the page.
  useEffect(() => {
    if (wasCollapsed.current === composerCollapsed) return;
    wasCollapsed.current = composerCollapsed;
    const frame = requestAnimationFrame(() => {
      if (composerCollapsed) expandButton.current?.focus({ preventScroll: true });
      else textarea.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [composerCollapsed]);

  // Stopping swaps the stop button for the send button, which would otherwise
  // drop keyboard focus to the body; hand it back once the swap has rendered.
  useEffect(() => {
    if (loading || !stopRequested.current) return;
    stopRequested.current = false;
    const frame = requestAnimationFrame(() => sendButton.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  useEffect(() => {
    // A new turn re-establishes context and settles any pending clear action, so
    // both the confirmation row and its announcement close themselves.
    setClearConfirming(false);
    setContextNotice("");
  }, [messages.length]);

  useLayoutEffect(() => {
    const shell = root.current?.closest<HTMLElement>('[data-conversation="true"]');
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    const measure = () =>
      shell.style.setProperty("--conversation-viewport-height", `${viewport.height}px`);
    viewport.addEventListener("resize", measure);
    measure();
    return () => {
      viewport.removeEventListener("resize", measure);
      shell.style.removeProperty("--conversation-viewport-height");
    };
  }, []);

  const rounds = messages.filter((message) => message.role === "user").length;

  useLayoutEffect(() => {
    // A hidden textarea reports a scrollHeight of 0; remeasure after unfolding.
    if (composerCollapsed || !textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(144, textarea.current.scrollHeight)}px`;
  }, [question, composerCollapsed]);

  useLayoutEffect(() => {
    if (composerCollapsed) return;
    const dock = composer.current;
    const form = dock?.querySelector("form");
    const toggle = dock?.querySelector<HTMLButtonElement>('button[aria-label="收起输入区"]');
    if (!dock || !form || !toggle) return;
    const measure = () => {
      // Keep the square at the same screen position as the expanded toggle,
      // while allowing the reading region to reclaim the hidden input's height.
      const offset = form.getBoundingClientRect().bottom - toggle.getBoundingClientRect().bottom;
      dock.style.setProperty("--composer-fold-offset", `${offset}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    measure();
    return () => observer.disconnect();
  }, [composerCollapsed]);

  // The folded square retains a short, whitespace-normalised draft tooltip.
  const draftText = question.replace(/\s+/g, " ").trim();
  const draftPreview =
    Array.from(draftText).length > DRAFT_PREVIEW_LENGTH
      ? `${Array.from(draftText).slice(0, DRAFT_PREVIEW_LENGTH).join("")}…`
      : draftText;

  return (
    <div className={experience.layout} data-history-collapsed={historyCollapsed}>
      <ConversationHistory
        {...history}
        collapsed={historyCollapsed}
        onToggle={() => setHistoryCollapsed((value) => !value)}
      />
      <div ref={root} className={styles.conversation}>
        <div className={styles.readingArea}>
          <div
            ref={scroll.transcript}
            tabIndex={0}
            onScroll={scroll.onScroll}
            className={styles.transcript}
            role="region"
            aria-label="分析对话"
            aria-live="off"
          >
            <header className={styles.formalHeader}>
              <div>
                <span>从问题出发 / ASK YOUR DATA</span>
                <h1 id="conversation-heading">一句话分析</h1>
                <p>从一个教学问题，走到看得见的依据。</p>
              </div>
              {sourceControl}
            </header>
            <p
              className={styles.availability}
              data-enter="fade"
              style={{ "--enter-delay": "300ms" } as CSSProperties}
            >
              <span className={aiAllowed && aiReady ? "status-dot" : "status-dot is-muted"} />
              {!aiAllowed
                ? "当前账号不能使用 AI 对话"
                : aiReady
                  ? `连续对话已开启${model ? ` · ${model}` : ""}`
                  : "推荐问题可直接使用"}
            </p>
            {!loading && historyActivity}
            {!messages.length && !loading && (
              <div
                className={styles.empty}
                data-enter="rise-sm"
                style={{ "--enter-delay": "400ms" } as CSSProperties}
              >
                <div className={styles.welcomeMark} aria-hidden="true">
                  <Icon name="sparkles" size={30} />
                </div>
                <span className={styles.welcomeEyebrow}>AI / LEARNING INTELLIGENCE</span>
                <h2>
                  <em>一句话分析，</em>
                  把问题聊清楚。
                </h2>
                <p>
                  {aiAllowed
                    ? "问成绩、看趋势、找关联。用你习惯的方式提问，让 AI 帮你整理线索，给出有依据的回答。"
                    : "只读账号可使用指标分析，不能使用 AI 对话。请返回指标分析查看确定性统计结果。"}
                </p>
                {aiAllowed && (
                  <div className={styles.welcomeSuggestions} aria-label="推荐问题">
                    <div className={styles.suggestionHeading}>
                      <span>没想好怎么问？从一条线索开始</span>
                      <span>
                        点击直接分析
                        <Icon name="arrowUpRight" size={12} />
                      </span>
                    </div>
                    {suggestedQuestionsFor(aiReady).map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        disabled={loading || !canRun}
                        onClick={() => {
                          if (!aiAllowed) return;
                          scroll.begin();
                          onAsk(item.question);
                        }}
                      >
                        <Icon
                          name={
                            item.id === "term-trend"
                              ? "line"
                              : item.id === "absence-relationship"
                                ? "link"
                                : "chart"
                          }
                          size={17}
                        />
                        <span>{item.question}</span>
                        <Icon name="arrowUpRight" size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {aiAllowed && (
                  <p className={styles.privacy}>
                    <Icon name="shield" size={13} />
                    仅分析群体统计 · 统计数字由本地计算 · 结论有据可查
                  </p>
                )}
              </div>
            )}
            {messages.map((message, index) => {
              const response = message.response;
              const artifacts =
                response?.artifacts ?? (response?.artifact ? [response.artifact] : []);
              return (
                <article
                  ref={index === messages.length - 1 ? newest : undefined}
                  key={message.id}
                  data-message-id={message.id}
                  className={styles.message}
                  data-role={message.role}
                  data-system={message.system ? "true" : undefined}
                  data-enter="rise-sm"
                  style={
                    {
                      "--enter-delay": index === messages.length - 1 ? "70ms" : "0ms",
                    } as CSSProperties
                  }
                >
                  <Speaker role={message.role} />
                  {message.role === "assistant" ? (
                    <ExecutionSteps
                      steps={response?.steps ?? message.steps ?? []}
                      completion={response?.completion}
                    />
                  ) : null}
                  {message.generatedAt ? (
                    <p className={styles.snapshotNote}>
                      {message.restored ? "历史结果" : "生成于"} ·{" "}
                      {new Date(message.generatedAt).toLocaleString("zh-CN")} · 结果契约 v
                      {RESULT_CONTRACT_VERSION}
                      {response?.resultRefs?.length
                        ? ` · 数据声明版本 ${[...new Set(response.resultRefs.map((ref) => ref.datasetVersion))].join(" / ")} · 指标 ${[...new Set(response.resultRefs.map((ref) => ref.metricVersion))].join(" / ")}`
                        : ""}
                      {message.restored ? " · 数据可能已更新，继续提问会重新查询" : ""}
                    </p>
                  ) : null}
                  <p className={styles.messageText}>{message.content}</p>
                  {response?.warning ? <ResponseWarning warning={response.warning} /> : null}
                  {response?.persistence === "pending" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onRetrySave(message.id)}
                    >
                      重试保存到历史
                    </button>
                  ) : null}
                  {response &&
                    response.presentation !== "text" &&
                    artifacts.map((artifact, artifactIndex) => {
                      const attachmentId = response.artifacts
                        ? `${message.id}:${artifactIndex}`
                        : message.id;
                      const expanded = expandedChartId === attachmentId;
                      const chartId = `conversation-chart-${attachmentId}`;
                      return (
                        <div key={attachmentId} className={styles.chartAttachment}>
                          <button
                            type="button"
                            className={styles.chartToggle}
                            aria-expanded={expanded}
                            aria-controls={chartId}
                            onClick={() => onExpandChart(expanded ? null : attachmentId)}
                          >
                            <Icon name="chart" size={17} />
                            <span>{artifactLabel(artifact)}</span>
                            <small>{expanded ? "收起图表" : "展开图表"}</small>
                            <Icon name="chevron" size={15} />
                          </button>
                          <ChartAttachmentBody expanded={expanded} id={chartId}>
                            <ConversationArtifactBoundary>
                              <ConversationResult
                                response={response}
                                artifact={artifact}
                                artifactIndex={artifactIndex}
                                onChartChange={(view) =>
                                  onChartChange(message.id, view, artifactIndex)
                                }
                                canExport={canExport}
                                onReport={onReport}
                              />
                            </ConversationArtifactBoundary>
                          </ChartAttachmentBody>
                        </div>
                      );
                    })}
                  {response ? <ConversationEvidence response={response} /> : null}
                  {response?.planning ? <PlanningNote planning={response.planning} /> : null}
                  {aiAllowed && index === messages.length - 1 && response?.suggestions.length ? (
                    <div
                      className={styles.suggestions}
                      aria-label="继续探索"
                      data-enter="fade"
                      style={{ "--enter-delay": "240ms" } as CSSProperties}
                    >
                      {response.suggestions.map((suggestion) => (
                        <button
                          type="button"
                          className="secondary-button"
                          key={suggestion}
                          disabled={loading}
                          onClick={() => {
                            if (aiAllowed) {
                              scroll.begin();
                              onAsk(suggestion);
                            }
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {loading && (
              <div ref={pending} data-scroll-pending className={styles.pending}>
                <div
                  className={styles.message}
                  data-role="user"
                  data-enter="rise-sm"
                  style={{ "--enter-delay": "0ms" } as CSSProperties}
                >
                  <Speaker role="user" />
                  <p className={styles.messageText}>{pendingQuestion}</p>
                </div>
                <div
                  className={styles.message}
                  data-role="assistant"
                  data-enter="rise-sm"
                  style={{ "--enter-delay": "60ms" } as CSSProperties}
                >
                  <Speaker role="assistant" />
                  <ExecutionSteps steps={pendingSteps} live />
                </div>
              </div>
            )}
          </div>
          {messages.length > 0 || loading ? (
            <nav className={styles.scrollRuler} aria-label="对话刻度导航">
              <button
                type="button"
                title="对话开头"
                aria-label="跳到对话开头"
                onClick={(event) => scroll.jump(null, event.detail === 0)}
              >
                <span aria-hidden="true">始</span>
              </button>
              <div className={styles.roundTicks}>
                {messages
                  .filter((message) => message.role === "user")
                  .map((message, index) => (
                    <button
                      type="button"
                      key={message.id}
                      title={`第 ${index + 1} 轮：${message.content.slice(0, 60)}`}
                      aria-label={`跳到第 ${index + 1} 轮：${message.content.slice(0, 60)}`}
                      aria-current={scroll.activeId === message.id ? "location" : undefined}
                      onClick={(event) => scroll.jump(message.id, event.detail === 0)}
                    >
                      <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    </button>
                  ))}
              </div>
              <button
                type="button"
                title="最新内容"
                aria-label="跳到最新内容"
                data-unread={scroll.hasNew}
                onClick={(event) => scroll.latest(event.detail === 0)}
              >
                <Icon name="arrow" size={14} />
              </button>
            </nav>
          ) : null}
        </div>
        {!loading && pendingSteps.length > 0 ? <ExecutionSteps steps={pendingSteps} /> : null}
        {aiAllowed && !aiReady && (
          <p className={styles.note}>
            推荐问题和已有结果的表格切换无需连接 AI。自由对话需要管理员开启并配置 AI。
            {onConfigure && (
              <button type="button" className="text-button" onClick={onConfigure}>
                去设置
              </button>
            )}
          </p>
        )}
        <div ref={composer} className={styles.composerDock} data-collapsed={composerCollapsed}>
          {notice}
          <form
            className={styles.composer}
            aria-label="对话输入"
            aria-disabled={!aiAllowed}
            onSubmit={(event) => {
              event.preventDefault();
              if (aiAllowed) {
                scroll.begin();
                onAsk();
              }
            }}
          >
            <div
              id={COMPOSER_FIELDS_ID}
              className={styles.composerFields}
              hidden={composerCollapsed}
            >
              <div className={styles.composerHeading}>
                <label htmlFor="analysis-question">
                  <Icon name="sparkles" size={14} />
                  {messages.length ? "继续追问" : "把你的问题，交给 AI"}
                </label>
                <div className={styles.composerTools}>
                  {clearConfirming && messages.length > 0 ? (
                    <div
                      className={styles.clearConfirm}
                      role="group"
                      aria-label="新建对话确认"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setClearConfirming(false);
                        }
                      }}
                    >
                      <span>当前 {rounds} 轮已保存，可从历史继续</span>
                      <button type="button" autoFocus onClick={() => setClearConfirming(false)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className={styles.clearConfirmAction}
                        onClick={() => {
                          setClearConfirming(false);
                          onClear();
                          textarea.current?.focus({ preventScroll: true });
                        }}
                      >
                        新建
                      </button>
                    </div>
                  ) : (
                    <>
                      {messages.length > 0 && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => setClearConfirming(true)}
                        >
                          <Icon name="plus" size={13} />
                          新对话
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.collapseToggle}
                    aria-expanded="true"
                    aria-controls={COMPOSER_FIELDS_ID}
                    aria-label="收起输入区"
                    title={loading ? "回复中不能收起输入区" : "收起输入区"}
                    disabled={loading}
                    onClick={() => {
                      setClearConfirming(false);
                      setComposerCollapsed(true);
                    }}
                  >
                    <Icon name="chevron" size={13} />
                    <span className="sr-only">收起输入区</span>
                  </button>
                </div>
              </div>
              {contextLabel ? (
                <div className={styles.contextRow}>
                  <span className={styles.contextChip}>
                    <Icon name="sliders" size={12} />
                    <span>{contextLabel}</span>
                    <button
                      type="button"
                      aria-label={`清除筛选：${contextLabel}`}
                      onClick={() => {
                        onClearContext?.();
                        setContextNotice("已清除筛选，后续追问不再沿用当前范围。");
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                  <span className={styles.contextHint}>仅影响后续追问</span>
                </div>
              ) : null}
              {contextNotice ? (
                <p className={styles.contextNotice} role="status" aria-live="polite">
                  {contextNotice}
                </p>
              ) : null}
              <textarea
                ref={textarea}
                id="analysis-question"
                name="analysis-question"
                rows={2}
                maxLength={500}
                value={question}
                placeholder={
                  aiAllowed
                    ? messages.length
                      ? "只看上学期、换成表格，或继续追问…"
                      : "你想了解哪些学习情况？"
                    : "只读账号不能使用 AI 对话"
                }
                disabled={!aiAllowed}
                aria-invalid={inputError ? true : undefined}
                aria-describedby={inputError ? QUESTION_ERROR_ID : undefined}
                onChange={(event) => {
                  if (aiAllowed) onQuestionChange(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (
                    aiAllowed &&
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    scroll.begin();
                    onAsk();
                  }
                }}
              />
              {inputError ? (
                <p className={styles.fieldError} id={QUESTION_ERROR_ID} role="alert">
                  {inputError}
                </p>
              ) : null}
              <div className={styles.composerActions}>
                <span>
                  {question.length}/500
                  <span className={styles.shortcut}> · Enter 发送，Shift + Enter 换行</span>
                </span>
                {loading ? (
                  <button
                    type="button"
                    key="stop"
                    className={styles.stop}
                    onClick={(event) => {
                      // Cancelling swaps this control for a submit button during the click.
                      event.preventDefault();
                      stopRequested.current = true;
                      onStop();
                    }}
                  >
                    停止回复
                  </button>
                ) : (
                  <button
                    ref={sendButton}
                    type="submit"
                    key="send"
                    className={styles.send}
                    disabled={!aiAllowed || !canRun || question.trim().length < 2}
                    aria-label="发送"
                  >
                    <Icon name="arrow" size={19} />
                  </button>
                )}
              </div>
            </div>
            {composerCollapsed ? (
              <div className={styles.composerCollapsed}>
                <button
                  ref={expandButton}
                  type="button"
                  className={styles.collapseToggle}
                  aria-expanded="false"
                  aria-controls={COMPOSER_FIELDS_ID}
                  aria-label="展开输入区"
                  title={draftPreview ? `展开输入区 · 草稿已保留：${draftPreview}` : "展开输入区"}
                  onClick={() => setComposerCollapsed(false)}
                >
                  <Icon name="chevron" size={13} />
                  <span className="sr-only">展开输入区{draftPreview ? "，草稿已保留" : ""}</span>
                </button>
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}

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
      <p className={styles.note}>
        仅展示至少 {artifact.data.minSampleSize}{" "}
        人的课程学期分组；同一学生、课程、学期先取有效成绩均值。跨学期分别计次。热力图颜色越深，数量越多，全部课程共用色阶。
      </p>
    </section>
  );
}

function ConversationResult({
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
