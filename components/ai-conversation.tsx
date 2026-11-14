"use client";

import { toolLabel } from "@/lib/ai/chart-capabilities";
import {
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Icon } from "./app-icons";
import { ConversationEvidence, ExecutionSteps } from "./conversation-evidence";
import { useMotionPreferences } from "./ui/motion-preferences";
import type { AnalysisResult, DataSource } from "@/lib/analysis/types";
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
import { ConversationResult } from "./conversation-result";
import { ConversationHistory, type ConversationHistoryProps } from "./conversation-history";
import {
  useConversationScroll,
  type ConversationScrollPosition,
} from "./hooks/use-conversation-scroll";
import { responseIdToAnimate } from "./hooks/conversation-response-motion";

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
const WELCOME_QUESTION_TITLES: Record<string, string> = {
  "compare-courses": "课程成绩",
  "term-trend": "学期变化",
  "score-distribution": "成绩分布",
  "absence-relationship": "出勤关联",
};
/** Enough of the draft to recognise it in the folded button's tooltip. */
const DRAFT_PREVIEW_LENGTH = 24;
/** The server's "tool-call check" error speaks to administrators; say this instead. */
const FREE_CHAT_OFF_HINT =
  "自由对话还没开启：可先用推荐问题或切换表格；需要管理员在 AI 设置中开启。";
/** Capability/configuration failures arrive as administrator-facing sentences. */
const AI_CONFIG_NOTICE = /工具调用检测|AI 对话分析已停用|AI 设置/;

/** Flatten a rendered notice to its text, so the dock can rephrase it. */
function noticeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => noticeText(child)).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return noticeText(node.props.children);
  return "";
}

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
  datasetId,
  aiAllowed,
  canRun,
  canExport,
  contextLabel,
  inputError,
  expandedChartId,
  onQuestionChange,
  onAsk,
  onSuggestion,
  sendBlocked = false,
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
  onRetrySave,
  historyActivity,
  readingPositions,
}: {
  historyActivity?: ReactNode;
  onRetrySave: (id: string) => void;
  history: ConversationHistoryProps;
  conversationId: string | null;
  /**
   * Shared per-conversation reading positions owned by the workspace, so leaving
   * and returning to a conversation restores the reader's place instead of the
   * newest turn. The transcript hook reads and writes it.
   */
  readingPositions?: Map<string, ConversationScrollPosition>;
  messages: ConversationTurn[];
  question: string;
  loading: boolean;
  pendingQuestion: string;
  pendingSteps: AnalysisStep[];
  aiReady: boolean;
  datasetId: DataSource | null;
  /** Account permission for AI; deployment availability alone is insufficient. */
  aiAllowed: boolean;
  canRun: boolean;
  canExport: boolean;
  contextLabel?: string | null;
  inputError?: string | null;
  expandedChartId: string | null;
  onQuestionChange: (value: string) => void;
  onAsk: (question?: string) => void;
  /**
   * A recommended/nearby question. It goes through the workspace's draft guard
   * instead of `onAsk`, so a card click never silently replaces an unsent draft.
   */
  onSuggestion: (question: string) => void;
  /** A history detail read is in flight; sending would race its transcript. */
  sendBlocked?: boolean;
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
  const scroll = useConversationScroll(
    conversationId ?? "new",
    messages.length,
    loading,
    readingPositions,
  );
  const { newest, pending } = scroll;
  const [contextNotice, setContextNotice] = useState("");
  // Collapsing only hides controls: the draft lives in the parent's `question`
  // state, so the textarea keeps its value while folded away.
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const foldFrom = useRef<DOMRect | null>(null);
  const { enabled: motionEnabled, reduced: reducedMotion } = useMotionPreferences();
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  /**
   * Clicking an entry closes the history layer before its read starts, so a
   * failed read would leave its message inside a hidden panel. The workspace
   * names the entry that failed; reopen the layer once so the error and its
   * retry are actually reachable, without auto-retrying anything.
   */
  const failedHistoryId = history.failedId ?? null;
  useEffect(() => {
    if (failedHistoryId) setHistoryCollapsed(false);
  }, [failedHistoryId]);
  const wasCollapsed = useRef(false);
  const stopRequested = useRef(false);
  const [animatedResponseId, setAnimatedResponseId] = useState<string | null>(null);
  const wasLoading = useRef(false);
  const responseBaseline = useRef<string | null>(null);

  useEffect(() => {
    if (loading) {
      if (!wasLoading.current) {
        responseBaseline.current =
          [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
      }
      wasLoading.current = true;
      return;
    }
    if (!wasLoading.current) return;
    wasLoading.current = false;
    setAnimatedResponseId(responseIdToAnimate(messages, responseBaseline.current));
    responseBaseline.current = null;
  }, [loading, messages]);

  useEffect(() => {
    setAnimatedResponseId(null);
  }, [conversationId]);

  useEffect(() => {
    if (!motionEnabled || reducedMotion) setAnimatedResponseId(null);
  }, [motionEnabled, reducedMotion]);

  const foldComposer = (collapsed: boolean) => {
    foldFrom.current = composer.current?.getBoundingClientRect() ?? null;
    setComposerCollapsed(collapsed);
  };

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
    // A new turn re-establishes context, so the cleared-scope announcement
    // closes itself.
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

  const isEmpty = messages.length === 0 && !loading;
  // Only the AI configuration notice is rephrased; save and transport failures
  // keep their own wording and retry actions.
  const rawNotice = noticeText(notice);
  const configNotice = !aiReady && AI_CONFIG_NOTICE.test(rawNotice);
  // The compact phone empty state can carry three questions, not four: the
  // extra one (only offered once AI is configured) makes the CSS drop the
  // description paragraph so every question stays above the dock.
  const welcomeSuggestions = suggestedQuestionsFor(aiReady, datasetId);

  useLayoutEffect(() => {
    // The empty state is the only view that must fit without scrolling, so a
    // stale scroll offset from a previous conversation must never hide its hero
    // and recommended questions.
    if (!isEmpty) return;
    scroll.transcript.current?.scrollTo({ top: 0 });
  }, [conversationId, isEmpty, scroll.transcript]);

  useEffect(() => {
    if (!isEmpty) return;
    // Shrinking a desktop window into the phone layout keeps the same transcript
    // instance; reset it so the compact empty state starts at the top instead of
    // at the bottom of the old scroll range.
    const mobile = window.matchMedia("(max-width: 600px)");
    const reset = () => scroll.transcript.current?.scrollTo({ top: 0 });
    mobile.addEventListener("change", reset);
    return () => mobile.removeEventListener("change", reset);
  }, [isEmpty, scroll.transcript]);

  useLayoutEffect(() => {
    const dock = composer.current;
    const surface = root.current;
    if (!dock || !surface) return;
    // Reserve scrollable trailing space, not a shorter reading viewport.
    const measure = () =>
      surface.style.setProperty("--composer-clearance", `${dock.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    measure();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    // A hidden textarea reports a scrollHeight of 0; remeasure after unfolding.
    if (composerCollapsed || !textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(144, textarea.current.scrollHeight)}px`;
  }, [question, composerCollapsed]);

  useLayoutEffect(() => {
    const from = foldFrom.current;
    foldFrom.current = null;
    const dock = composer.current;
    if (!from || !dock || !motionEnabled || reducedMotion) return;
    const to = dock.getBoundingClientRect();
    // Both states are anchored on the right, so the surface contracts toward
    // its handle without scaling text or changing the transcript's position.
    const animation = dock.animate(
      [
        { width: `${from.width}px`, height: `${from.height}px` },
        { width: `${to.width}px`, height: `${to.height}px` },
      ],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    const fields = dock.querySelector<HTMLElement>(`#${COMPOSER_FIELDS_ID}`);
    const reveal = !composerCollapsed
      ? fields?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 220,
          delay: 60,
          fill: "backwards",
        })
      : null;
    return () => {
      animation.cancel();
      reveal?.cancel();
    };
  }, [composerCollapsed, motionEnabled, reducedMotion]);

  // The folded square retains a short, whitespace-normalised draft tooltip.
  const draftText = question.replace(/\s+/g, " ").trim();
  const draftPreview =
    Array.from(draftText).length > DRAFT_PREVIEW_LENGTH
      ? `${Array.from(draftText).slice(0, DRAFT_PREVIEW_LENGTH).join("")}…`
      : draftText;

  return (
    <div
      data-workspace-part="layout"
      className={experience.layout}
      data-history-collapsed={historyCollapsed}
      data-glass-pane="0.35"
    >
      <ConversationHistory
        {...history}
        collapsed={historyCollapsed}
        onToggle={() => setHistoryCollapsed((value) => !value)}
      />
      <div ref={root} className={styles.conversation} data-workspace-part="conversation">
        <h1 id="conversation-heading" className="sr-only">
          分析对话
        </h1>
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
            {!loading && historyActivity}
            {!messages.length && !loading && (
              <div
                data-workspace-part="empty"
                className={styles.empty}
                data-suggestion-count={welcomeSuggestions.length}
                data-enter="rise-sm"
                style={{ "--enter-delay": "400ms" } as CSSProperties}
              >
                <div className={styles.welcomeMark} aria-hidden="true">
                  <Icon name="sparkles" size={24} />
                </div>
                <span className={styles.welcomeEyebrow} aria-hidden="true">
                  LEARNING ANALYSIS ASSISTANT
                </span>
                <h2>今天想看清什么？</h2>
                <p>
                  {aiAllowed
                    ? aiReady
                      ? "选择一个常用问题，或在下方输入你想了解的学习情况。"
                      : "选择一个常用问题，查看课程成绩、学期变化或学习关联。"
                    : "只读账号不能使用 AI 对话。可返回数据浏览查看确定性图表和统计结果。"}
                </p>
                {aiAllowed && (
                  <div
                    data-workspace-part="welcomeSuggestions"
                    className={styles.welcomeSuggestions}
                    aria-label="推荐问题"
                  >
                    <div
                      data-workspace-part="suggestionHeading"
                      className={styles.suggestionHeading}
                    >
                      <span>先看整体，再深入分析</span>
                      <span>
                        点击卡片开始
                        <Icon name="arrowUpRight" size={12} />
                      </span>
                    </div>
                    {welcomeSuggestions.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        aria-label={item.question}
                        data-recommended={item.id === "compare-courses" || undefined}
                        disabled={loading || !canRun || sendBlocked}
                        onClick={() => {
                          if (!aiAllowed) return;
                          scroll.begin();
                          onSuggestion(item.question);
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
                        {item.id === "compare-courses" && (
                          <span className="welcome-start-label" aria-hidden="true">
                            建议先看
                          </span>
                        )}
                        <span className="welcome-question-copy">
                          <strong>{WELCOME_QUESTION_TITLES[item.id] ?? "进一步分析"}</strong>
                          <small>{item.question}</small>
                        </span>
                        <Icon name="arrowUpRight" size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {aiAllowed && (
                  <p data-workspace-part="privacy" className={styles.privacy}>
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
                  data-enter={
                    message.id === animatedResponseId && response && !reducedMotion
                      ? "rise-sm"
                      : undefined
                  }
                  style={{ "--enter-delay": "70ms", "--enter-dur": "340ms" } as CSSProperties}
                >
                  <Speaker role={message.role} />
                  {message.role === "assistant" ? (
                    <ExecutionSteps
                      steps={response?.steps ?? message.steps ?? []}
                      completion={response?.completion}
                    />
                  ) : null}
                  {message.generatedAt ? (
                    <div className={styles.snapshotNote}>
                      <span>
                        {message.restored ? "历史结果" : "生成于"} ·{" "}
                        {new Date(message.generatedAt).toLocaleString("zh-CN")}
                        {message.restored ? " · 数据可能已更新，继续提问会重新查询" : ""}
                      </span>
                      <details className={styles.technical}>
                        <summary>技术详情</summary>
                        <p>
                          结果契约 v{RESULT_CONTRACT_VERSION}
                          {response?.resultRefs?.length
                            ? ` · 数据声明版本 ${[...new Set(response.resultRefs.map((ref) => ref.datasetVersion))].join(" / ")} · 指标 ${[...new Set(response.resultRefs.map((ref) => ref.metricVersion))].join(" / ")}`
                            : ""}
                        </p>
                      </details>
                    </div>
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
                        <div
                          key={attachmentId}
                          className={styles.chartAttachment}
                          data-enter={
                            message.id === animatedResponseId && !reducedMotion
                              ? "rise-sm"
                              : undefined
                          }
                          style={
                            {
                              "--enter-delay": `${120 + artifactIndex * 70}ms`,
                              "--enter-dur": "340ms",
                            } as CSSProperties
                          }
                        >
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
                      data-enter={
                        message.id === animatedResponseId && !reducedMotion ? "fade" : undefined
                      }
                      style={{ "--enter-delay": "240ms", "--enter-dur": "220ms" } as CSSProperties}
                    >
                      {response.suggestions.map((suggestion) => (
                        <button
                          type="button"
                          className="secondary-button"
                          key={suggestion}
                          disabled={loading || sendBlocked}
                          onClick={() => {
                            if (!aiAllowed) return;
                            scroll.begin();
                            onSuggestion(suggestion);
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
            {!loading && pendingSteps.length > 0 ? <ExecutionSteps steps={pendingSteps} /> : null}
            {configNotice ? (
              composerCollapsed ? null : (
                <p className={styles.localNotice} role="alert">
                  {FREE_CHAT_OFF_HINT}
                </p>
              )
            ) : (
              !composerCollapsed && notice
            )}
          {messages.length > 0 || loading ? (
            <details className={styles.turnNavigation}>
              <summary>对话导航</summary>
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
            </details>
          ) : null}
          </div>
        </div>
        <div
          ref={composer}
          data-workspace-part="composerDock"
          className={styles.composerDock}
          data-collapsed={composerCollapsed}
        >
          {aiAllowed && !aiReady && !composerCollapsed && (
            <p data-workspace-part="composerNote" className={styles.note}>
              常用问题可直接使用。自由提问需管理员开启 AI 连接。
              {onConfigure && (
                <button type="button" className="text-button" onClick={onConfigure}>
                  去设置
                </button>
              )}
            </p>
          )}
          <form
            data-workspace-part="composer"
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
              <div data-workspace-part="composerHeading" className={styles.composerHeading}>
                <label htmlFor="analysis-question">
                  <Icon name="messages" size={14} />
                  {aiReady && messages.length ? "继续追问" : "输入分析问题"}
                </label>
                <div data-workspace-part="composerTools" className={styles.composerTools}>
                  {messages.length > 0 && (
                    // The workspace owns one confirmation surface for drafts and
                    // live conversations, so this click only requests the reset.
                    <button
                      type="button"
                      className={styles.newConversation}
                      aria-label="新对话"
                      title="新对话"
                      disabled={loading}
                      onClick={onClear}
                    >
                      <Icon name="plus" size={13} />
                      <span>新对话</span>
                    </button>
                  )}
                  <button
                    type="button"
                    data-workspace-part="collapseToggle"
                    className={styles.collapseToggle}
                    aria-expanded="true"
                    aria-controls={COMPOSER_FIELDS_ID}
                    aria-label="收起输入区"
                    title={loading ? "回复中不能收起输入区" : "收起输入区"}
                    disabled={loading}
                    onClick={() => foldComposer(true)}
                  >
                    <Icon name="chevron" size={13} />
                    <span className="sr-only">收起输入区</span>
                  </button>
                </div>
              </div>
              {contextLabel ? (
                <div className={styles.contextRow}>
                  <span className={styles.contextChip} title={contextLabel}>
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
                    ? aiReady
                      ? messages.length
                        ? "只看上学期、换成表格，或继续追问…"
                        : "你想了解哪些学习情况？"
                      : "例如：各学期平均成绩如何？"
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
              <div data-workspace-part="composerActions" className={styles.composerActions}>
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
                    disabled={!aiAllowed || !canRun || sendBlocked || question.trim().length < 2}
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
                  data-workspace-part="collapseToggle"
                  className={styles.collapseToggle}
                  aria-expanded="false"
                  aria-controls={COMPOSER_FIELDS_ID}
                  aria-label="展开输入区"
                  title={draftPreview ? `展开输入区 · 草稿已保留：${draftPreview}` : "展开输入区"}
                  onClick={() => foldComposer(false)}
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
