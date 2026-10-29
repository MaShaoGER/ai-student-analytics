"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/app-icons";
import { ExecutionSteps } from "@/components/conversation-evidence";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
import { ThemeToggle } from "@/components/ui/theme-provider";
import type { AnalysisStep } from "@/lib/ai/chat-types";
import {
  CLARIFICATION_CHOICES,
  DEMO_ANSWERS,
  DEMO_SCENES,
  DEMO_STEPS,
  questionFor,
  type DemoAction,
  type DemoAnswer,
  type DemoChart,
  type DemoSceneId,
} from "./demo-data";
import styles from "./preview.module.css";

type Turn = {
  id: number;
  question: string;
  action: DemoAction;
  status: "running" | "done" | "stopped" | "error";
  steps: AnalysisStep[];
  answer?: DemoAnswer;
  clarification?: boolean;
  localNote?: string;
  table?: boolean;
};

function completedSteps(): AnalysisStep[] {
  return DEMO_STEPS.map((step) => ({ ...step, status: "completed" }));
}

function inferAction(question: string): DemoAction | "table" | null {
  if (/表格|表格视图/.test(question)) return "table";
  if (/部分完成/.test(question)) return "partial";
  if (/失败|重试|超时/.test(question)) return "error";
  if (/活动|关联|学习节奏/.test(question)) return "activity";
  if (/只看|仅看/.test(question) && /2025|学期/.test(question)) return "term";
  if (/2024J/i.test(question) && /2025J/i.test(question)) return "compare";
  if (/前端|比较|对比/.test(question)) return "compare";
  if (/成绩变化|看看成绩/.test(question)) return "clarify";
  return null;
}

function PreviewChart({
  chart,
  turnId,
  expanded,
  onExpand,
  defaultTable,
}: {
  chart: DemoChart;
  turnId: number;
  expanded: boolean;
  onExpand: () => void;
  defaultTable?: boolean;
}) {
  const [view, setView] = useState<"chart" | "table">(defaultTable ? "table" : "chart");
  const maximum = Math.max(1, ...chart.rows.flatMap((row) => [row.before, row.after]));
  const upper = Math.ceil(maximum / 20) * 20;
  const height = chart.rows.length * 58 + 42;
  const bodyId = `preview-chart-${turnId}-${chart.id}`;
  return (
    <section className={styles.chartCard} aria-label={chart.title}>
      <button
        type="button"
        className={styles.chartSummary}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onExpand}
      >
        <span className={styles.chartSummaryIcon}>
          <Icon name="chart" size={19} />
        </span>
        <span className={styles.chartSummaryText}>
          <strong>{chart.title}</strong>
          <small>{chart.description}</small>
        </span>
        <span className={styles.chartSummaryMeta}>{expanded ? "收起" : "查看图表"}</span>
        <Icon name="chevron" size={15} />
      </button>
      <div id={bodyId} className={styles.chartBody} hidden={!expanded}>
        <div className={styles.chartToolbar}>
          <div className={styles.chartLegend}>
            <span>
              <i className={styles.legendMark} />
              {chart.beforeLabel}
            </span>
            <span>
              <i className={styles.legendMark} data-accent />
              {chart.afterLabel}
            </span>
          </div>
          <div className={styles.segmented} role="group" aria-label={`${chart.title}展示方式`}>
            <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
              <Icon name="chart" size={13} />
              图表
            </button>
            <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
              <Icon name="database" size={13} />
              表格
            </button>
          </div>
        </div>
        {view === "chart" ? (
          <svg
            className={styles.chartSvg}
            viewBox={`0 0 720 ${height}`}
            role="img"
            aria-label={`${chart.title}，可切换为表格查看全部数值`}
          >
            <title>{chart.title}</title>
            <desc>
              {chart.rows
                .map(
                  (row) =>
                    `${row.label}：${chart.beforeLabel} ${row.before}${chart.unit}，${chart.afterLabel} ${row.after}${chart.unit}`,
                )
                .join("；")}
            </desc>
            {[0, 1, 2, 3, 4].map((tick) => (
              <g key={tick} aria-hidden="true">
                <line
                  className={styles.chartGrid}
                  x1={144 + tick * 128}
                  x2={144 + tick * 128}
                  y1={12}
                  y2={height - 28}
                />
                <text
                  className={styles.chartAxis}
                  x={144 + tick * 128}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {(upper * tick) / 4}
                </text>
              </g>
            ))}
            {chart.rows.map((row, index) => (
              <g key={row.label} aria-hidden="true">
                <text className={styles.chartLabels} x={128} y={index * 58 + 34} textAnchor="end">
                  {row.label}
                </text>
                <rect
                  className={styles.chartBefore}
                  x={144}
                  y={index * 58 + 14}
                  width={(row.before / upper) * 512}
                  height={12}
                />
                <rect
                  className={styles.chartAfter}
                  x={144}
                  y={index * 58 + 31}
                  width={(row.after / upper) * 512}
                  height={12}
                />
                <text
                  className={styles.chartLabels}
                  x={152 + (row.before / upper) * 512}
                  y={index * 58 + 24}
                >
                  {row.before}
                </text>
                <text
                  className={styles.chartLabels}
                  x={152 + (row.after / upper) * 512}
                  y={index * 58 + 41}
                >
                  {row.after}
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <div
            className={styles.tableWrap}
            tabIndex={0}
            role="region"
            aria-label={`${chart.title}数据表`}
          >
            <table className={styles.dataTable}>
              <caption>
                {chart.title}，单位：{chart.unit}，全部为预设演示数据
              </caption>
              <thead>
                <tr>
                  <th scope="col">分析对象</th>
                  <th scope="col">{chart.beforeLabel}</th>
                  <th scope="col">{chart.afterLabel}</th>
                  <th scope="col">
                    变化{chart.unit === "%" ? "（百分点）" : chart.unit === "分" ? "（分）" : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {chart.rows.map((row) => {
                  const delta = Math.round((row.after - row.before) * 100) / 100;
                  return (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td>{row.before}</td>
                      <td>{row.after}</td>
                      <td>
                        {delta > 0 ? "+" : ""}
                        {delta}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.chartNote}>单位：{chart.unit} · 预设数据 · 切换展示沿用同一份结果</p>
      </div>
    </section>
  );
}

function downloadSummary(answer: DemoAnswer) {
  const content = [
    "学析台 · 预设体验摘要",
    "全部数值为预设演示，不是实时分析结果。",
    "",
    answer.title,
    answer.scope,
    "",
    ...answer.paragraphs,
    "",
    ...answer.facts.map((fact) => `${fact.label}：${fact.value}\n${fact.detail}`),
    "",
    answer.caveat,
  ].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "学析台-预设体验摘要.txt";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExperienceClient() {
  const initialAnswer = DEMO_ANSWERS.compare;
  const [sceneId, setSceneId] = useState<DemoSceneId>("comparison");
  const [turns, setTurns] = useState<Turn[]>(() => [
    {
      id: 1,
      question: questionFor("compare"),
      action: "compare",
      status: "done",
      steps: completedSteps(),
      answer: initialAnswer,
    },
  ]);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState(initialAnswer.scope);
  const [expandedChart, setExpandedChart] = useState<string | null>(
    `1:${initialAnswer.charts[0]?.id}`,
  );
  const [hasNew, setHasNew] = useState(false);
  const [fast, setFast] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [highlight, setHighlight] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runToken = useRef(0);
  const running = useRef(false);
  const following = useRef(false);
  const previousTurns = useRef(turns);
  const { enabled, reduced, pointer, setEnabled } = useMotionPreferences();
  const scene = DEMO_SCENES.find((item) => item.id === sceneId)!;
  const pending = turns.find((turn) => turn.status === "running");
  const isRunning = Boolean(pending);

  function clearTimers() {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    runToken.current += 1;
    running.current = false;
  }

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      runToken.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (previousTurns.current === turns) return;
    previousTurns.current = turns;
    if (following.current && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [turns]);

  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(112, input.current.scrollHeight)}px`;
  }, [draft]);

  function begin(action: DemoAction, question = questionFor(action), fresh = false) {
    if (running.current && !fresh) return;
    clearTimers();
    const token = runToken.current;
    const id = ++sequence.current;
    running.current = true;
    following.current = true;
    setHasNew(false);
    setCopied(null);
    setDraft("");
    setAnnouncement(action === "clarify" ? "正在播放预设澄清对话" : "预设分析开始，可随时停止");
    const firstStep = DEMO_STEPS[0];
    const turn: Turn = {
      id,
      question,
      action,
      status: "running",
      steps: action === "clarify" ? [] : [{ ...firstStep, status: "running", durationMs: 0 }],
    };
    setTurns((previous) => (fresh ? [turn] : [...previous, turn]));
    const patch = (update: Partial<Turn>) => {
      if (runToken.current !== token) return;
      setTurns((previous) =>
        previous.map((item) => (item.id === id ? { ...item, ...update } : item)),
      );
    };
    const later = (callback: () => void, delay: number) => {
      timers.current.push(
        setTimeout(() => {
          if (runToken.current === token) callback();
        }, delay),
      );
    };
    if (action === "clarify") {
      later(
        () => {
          patch({ status: "done", clarification: true });
          running.current = false;
          setAnnouncement("请选择要比较的课程与学期");
        },
        fast ? 180 : 450,
      );
      return;
    }
    const beat = fast ? 280 : 680;
    DEMO_STEPS.slice(1).forEach((step, index) =>
      later(
        () => {
          if (action === "error" && index === 1) {
            patch({
              status: "error",
              steps: DEMO_STEPS.slice(0, index + 1).map((item, position) => ({
                ...item,
                durationMs: beat,
                status: position === index ? "failed" : "completed",
              })),
            });
            running.current = false;
            setAnnouncement("预设失败场景：当前轮次未完成，可以重试");
            // Invalidate the later callbacks; a failed run never publishes an answer.
            for (const timer of timers.current) clearTimeout(timer);
            timers.current = [];
            return;
          }
          patch({
            steps: DEMO_STEPS.slice(0, index + 2).map((item, position) => ({
              ...item,
              durationMs: position === index + 1 ? 0 : beat,
              status: position === index + 1 ? "running" : "completed",
            })),
          });
        },
        beat * (index + 1),
      ),
    );
    later(() => {
      const answer = DEMO_ANSWERS[action as keyof typeof DEMO_ANSWERS];
      const steps = completedSteps().map((step) => ({ ...step, durationMs: beat }));
      patch({ status: "done", answer, steps: action === "partial" ? steps.slice(0, -1) : steps });
      setScope(answer.scope);
      setExpandedChart(answer.charts[0] ? `${id}:${answer.charts[0].id}` : null);
      running.current = false;
      setAnnouncement(
        answer.completion === "partial"
          ? "预设分析部分完成，已保留可用结果"
          : "预设结果已呈现，可查看图表与统计依据",
      );
    }, beat * DEMO_STEPS.length);
  }

  function stop() {
    clearTimers();
    setTurns((previous) =>
      previous.map((turn) =>
        turn.status === "running"
          ? {
              ...turn,
              status: "stopped",
              steps: turn.steps.map((step) =>
                step.status === "running" ? { ...step, status: "cancelled" } : step,
              ),
            }
          : turn,
      ),
    );
    setDraft(pending?.question ?? "");
    setAnnouncement("演示已停止，问题已保留，可以重新发送");
  }

  function selectScene(id: DemoSceneId) {
    clearTimers();
    const next = DEMO_SCENES.find((item) => item.id === id)!;
    setSceneId(id);
    setTurns([]);
    setExpandedChart(null);
    setScope(next.scope);
    setDraft(next.prompt);
    setHasNew(false);
    following.current = true;
    if (transcript.current) transcript.current.scrollTop = 0;
    setAnnouncement(`已切换到${next.name}，预设问题已填入输入框`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || running.current) return;
    const question = draft.trim();
    const action = inferAction(question);
    if (action === "table") {
      const previousAnswer = [...turns]
        .reverse()
        .find((turn) => turn.answer?.charts.length)?.answer;
      if (previousAnswer) {
        const id = ++sequence.current;
        following.current = true;
        setTurns((previous) => [
          ...previous,
          {
            id,
            question,
            action: "compare",
            status: "done",
            steps: [],
            answer: {
              ...previousAnswer,
              eyebrow: "沿用已有结果",
              title: "同一份数据，换成表格查看。",
              paragraphs: ["已切换为表格。统计范围与原结果保持一致，方便逐项核对。"],
              metrics: [],
            },
            table: true,
          },
        ]);
        setExpandedChart(`${id}:${previousAnswer.charts[0].id}`);
        setDraft("");
        return;
      }
    }
    if (!action || action === "table") {
      following.current = true;
      setTurns((previous) => [
        ...previous,
        {
          id: ++sequence.current,
          question,
          action: "clarify",
          status: "done",
          steps: [],
          localNote:
            "这里准备了课程比较、条件澄清和学习活动三个预设场景。选一个问题，就能继续体验完整流程。",
          clarification: true,
        },
      ]);
      setDraft("");
      return;
    }
    begin(action, question);
  }

  function showFact(turnId: number, factId: string) {
    const details = document.getElementById(`evidence-${turnId}`) as HTMLDetailsElement | null;
    if (!details) return;
    details.open = true;
    const id = `fact-${turnId}-${factId}`;
    setHighlight(id);
    requestAnimationFrame(() => {
      const fact = document.getElementById(id);
      fact?.scrollIntoView({
        block: "nearest",
        behavior: enabled && !reduced && pointer ? "smooth" : "instant",
      });
      fact?.focus({ preventScroll: true });
    });
    setAnnouncement("已展开并定位到对应统计依据");
  }

  async function copy(turn: Turn) {
    if (!turn.answer) return;
    try {
      await navigator.clipboard.writeText(
        ["预设演示结果", turn.answer.title, ...turn.answer.paragraphs, turn.answer.caveat].join(
          "\n",
        ),
      );
      setCopied(turn.id);
      setAnnouncement("已复制演示回答");
    } catch {
      setAnnouncement("浏览器暂时无法复制，可以直接选择回答文字。");
    }
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.rail} aria-label="工作台工具">
        <a className={styles.railMark} href="/" aria-label="返回学析台">
          <i />
          <i />
          <i />
          <i />
        </a>
        <a href="/" aria-label="正式工作台" title="正式工作台">
          <Icon name="dashboard" size={20} />
        </a>
        <span aria-label="当前：AI 对话预览" aria-current="page">
          <Icon name="messages" size={21} />
        </span>
        <span className={styles.railLabel}>LEARNING INTELLIGENCE</span>
        <div className={styles.railBottom}>
          <ThemeToggle compact />
        </div>
      </aside>
      <header className={styles.header}>
        <a className={styles.brand} href="/">
          学析台<span>LEARNING INTELLIGENCE</span>
        </a>
        <span className={styles.breadcrumb}>
          工作台 <span>/</span> 一句话分析
        </span>
        <div className={styles.headerActions}>
          <span className={styles.previewBadge}>
            <Icon name="shield" size={13} />
            预设体验<span> · 无 AI 调用</span>
          </span>
          <button
            className={styles.iconButton}
            type="button"
            aria-label={enabled && !reduced ? "关闭预览动效" : "开启预览动效"}
            aria-pressed={enabled && !reduced}
            disabled={reduced}
            onClick={() => setEnabled(!enabled)}
            title={reduced ? "已跟随系统减少动态效果" : "切换交互动效"}
          >
            <Icon name="activity" size={17} />
          </button>
        </div>
      </header>
      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="预设对话场景">
          <div className={styles.sidebarLabel}>
            <span>体验场景</span>
            <small>01 — 03</small>
          </div>
          <div className={styles.sceneList}>
            {DEMO_SCENES.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={styles.sceneButton}
                aria-pressed={sceneId === item.id}
                onClick={() => selectScene(item.id)}
              >
                <span className={styles.sceneIndex}>0{index + 1}</span>
                <span>
                  <strong className={styles.sceneName}>{item.name}</strong>
                  <small className={styles.sceneDescription}>{item.description}</small>
                </span>
                <Icon name="arrowUpRight" size={14} />
              </button>
            ))}
          </div>
          <div className={styles.sidebarFoot}>
            <p className={styles.sidebarLabel}>也看看其他状态</p>
            <button
              type="button"
              className={styles.quickAction}
              disabled={isRunning}
              onClick={() => begin("partial")}
            >
              <Icon name="info" size={14} />
              部分完成
              <Icon name="arrowUpRight" size={13} />
            </button>
            <button
              type="button"
              className={styles.quickAction}
              disabled={isRunning}
              onClick={() => begin("error")}
            >
              <Icon name="refresh" size={14} />
              失败与重试
              <Icon name="arrowUpRight" size={13} />
            </button>
            <p className={styles.sidebarNote}>
              使用固定对话与演示数据。
              <br />
              可以放心尝试、停止和重来。
            </p>
            <a
              className={styles.sourceLink}
              href="https://www.rareui.com/components/aistatus"
              target="_blank"
              rel="noreferrer"
            >
              状态动效来源 Rare UI <Icon name="arrowUpRight" size={11} />
            </a>
          </div>
        </aside>
        <main className={styles.main}>
          <div className={styles.conversationHeader}>
            <div className={styles.titleRow}>
              <div>
                <p className={styles.eyebrow}>从问题出发 / ASK YOUR DATA</p>
                <h1>一句话分析</h1>
              </div>
              <div className={styles.headerTools}>
                <button
                  className={styles.smallButton}
                  type="button"
                  aria-pressed={fast}
                  onClick={() => setFast(!fast)}
                  title="切换预设过程播放速度"
                >
                  <Icon name="clock" size={13} />
                  {fast ? "快速" : "标准节奏"}
                </button>
                <button
                  className={styles.resetButton}
                  type="button"
                  onClick={() => begin(scene.action, scene.prompt, true)}
                >
                  <Icon name="refresh" size={14} />
                  从头体验
                </button>
              </div>
            </div>
            <p className={styles.subtitle}>从一个教学问题，走到看得见的依据。</p>
          </div>
          <div className={styles.scopeStrip}>
            <span className={styles.scopeDot} />
            <span>合成校园数据 · 预设片段</span>
            <span>{scope}</span>
          </div>
          <div
            className={styles.transcript}
            ref={transcript}
            tabIndex={0}
            role="region"
            aria-label="预设对话记录"
            onScroll={() => {
              const element = transcript.current;
              if (!element) return;
              following.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 72;
              if (following.current) setHasNew(false);
            }}
          >
            {!turns.length ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <Icon name="sparkles" size={24} />
                </div>
                <p className={styles.eyebrow}>
                  场景 0{DEMO_SCENES.findIndex((item) => item.id === sceneId) + 1}
                </p>
                <h2 className={styles.emptyTitle}>{scene.name}</h2>
                <p className={styles.emptyDescription}>{scene.description}</p>
                <button
                  type="button"
                  className={styles.presetCard}
                  onClick={() => begin(scene.action, scene.prompt)}
                >
                  <span>{scene.prompt}</span>
                  <Icon name="arrow" size={18} />
                </button>
                <p className={styles.chartNote}>点选问题，或在下方发送已填好的预设问题。</p>
              </div>
            ) : null}
            {turns.map((turn) => (
              <div key={turn.id}>
                <div className={styles.userTurn}>
                  <span className={styles.userAvatar}>我</span>
                  <p className={styles.userBubble}>{turn.question}</p>
                </div>
                <article
                  className={styles.assistantTurn}
                  aria-label={`学析台回复：${turn.question}`}
                >
                  <div className={styles.assistantIdentity}>
                    <span className={styles.assistantMark}>
                      <Icon name="sparkles" size={15} />
                    </span>
                    <strong>学析台</strong>
                    <span>预设演示</span>
                  </div>
                  <div className={styles.assistantBody}>
                    {turn.steps.length || turn.status === "running" ? (
                      <ExecutionSteps
                        steps={turn.steps}
                        live={turn.status === "running"}
                        completion={turn.answer?.completion}
                      />
                    ) : null}
                    {turn.status === "running" ? (
                      <p className={styles.chartNote}>正在播放本轮预设过程，可随时停止。</p>
                    ) : null}
                    {turn.status === "stopped" ? (
                      <div className={styles.statusMessage}>
                        <p>本轮体验已停止，问题已保留。</p>
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => begin(turn.action, turn.question)}
                          disabled={isRunning}
                        >
                          <Icon name="refresh" size={13} />
                          重新发送
                        </button>
                      </div>
                    ) : null}
                    {turn.status === "error" ? (
                      <div className={styles.errorCard} role="status">
                        <strong>这轮分析暂未完成。</strong>
                        <p>这是预设的失败场景。问题和已完成步骤都已保留，可以体验恢复后的结果。</p>
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => begin("compare", "重新尝试刚才的课程比较")}
                          disabled={isRunning}
                        >
                          <Icon name="refresh" size={13} />
                          重试本轮
                        </button>
                      </div>
                    ) : null}
                    {turn.clarification ? (
                      <div className={styles.clarificationCard}>
                        <p className={styles.answerEyebrow}>先确定分析范围</p>
                        <h2 className={styles.answerTitle}>你想从哪一个问题开始？</h2>
                        <p className={styles.answerParagraph}>
                          {turn.localNote ??
                            "成绩变化可以按课程或学期来看。先选一个范围，我会沿着它继续分析。"}
                        </p>
                        <div className={styles.clarificationOptions}>
                          {CLARIFICATION_CHOICES.map((choice) => (
                            <button
                              type="button"
                              key={choice.action}
                              disabled={isRunning}
                              onClick={() => begin(choice.action, choice.label)}
                            >
                              <Icon name="chart" size={16} />
                              <span>{choice.label}</span>
                              <Icon name="arrowUpRight" size={14} />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {turn.answer ? (
                      <div className={styles.answerContent}>
                        <p className={styles.answerEyebrow}>{turn.answer.eyebrow}</p>
                        <h2 className={styles.answerTitle}>{turn.answer.title}</h2>
                        {turn.answer.paragraphs.map((paragraph, index) => {
                          const fact = turn.answer!.facts.find(
                            (item) => item.id === turn.answer!.paragraphFactIds?.[index],
                          );
                          return (
                            <p key={paragraph} className={styles.answerParagraph}>
                              {paragraph}
                              {fact ? (
                                <button
                                  type="button"
                                  className={styles.inlineSource}
                                  aria-label={`查看依据：${fact.label}`}
                                  onClick={() => showFact(turn.id, fact.id)}
                                >
                                  {index + 1}
                                </button>
                              ) : null}
                            </p>
                          );
                        })}
                        {turn.answer.metrics.length ? (
                          <div className={styles.metricGrid}>
                            {turn.answer.metrics.map((metric) => (
                              <div key={metric.label} className={styles.metricCard}>
                                <span>{metric.label}</span>
                                <strong className={styles.metricValue}>{metric.value}</strong>
                                <small className={styles.metricNote}>{metric.note}</small>
                                {metric.factId ? (
                                  <button
                                    className={styles.inlineSource}
                                    type="button"
                                    aria-label={`查看${metric.label}的统计依据`}
                                    onClick={() => showFact(turn.id, metric.factId!)}
                                  >
                                    <Icon name="arrowUpRight" size={12} />
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {turn.answer.completion === "partial" ? (
                          <div className={styles.warningCard}>
                            <Icon name="info" size={16} />
                            <span>{turn.answer.caveat}</span>
                          </div>
                        ) : null}
                        <div className={styles.chartStack}>
                          {turn.answer.charts.map((chart) => (
                            <PreviewChart
                              key={`${turn.id}:${chart.id}`}
                              chart={chart}
                              turnId={turn.id}
                              defaultTable={turn.table}
                              expanded={expandedChart === `${turn.id}:${chart.id}`}
                              onExpand={() =>
                                setExpandedChart(
                                  expandedChart === `${turn.id}:${chart.id}`
                                    ? null
                                    : `${turn.id}:${chart.id}`,
                                )
                              }
                            />
                          ))}
                        </div>
                        <details className={styles.evidence} id={`evidence-${turn.id}`}>
                          <summary className={styles.evidenceSummary}>
                            <Icon name="shield" size={15} />
                            <strong>数字从哪来</strong>
                            <span className={styles.evidenceCount}>
                              {turn.answer.facts.length} 条统计依据
                            </span>
                            <Icon name="chevron" size={14} />
                          </summary>
                          <div className={styles.evidenceBody}>
                            {turn.answer.facts.map((fact, index) => (
                              <section
                                className={styles.factCard}
                                id={`fact-${turn.id}-${fact.id}`}
                                key={fact.id}
                                tabIndex={-1}
                                data-highlight={highlight === `fact-${turn.id}-${fact.id}`}
                              >
                                <p className={styles.factLabel}>
                                  <span>0{index + 1}</span>
                                  {fact.label}
                                </p>
                                <strong className={styles.factValue}>{fact.value}</strong>
                                <p className={styles.factDetail}>{fact.detail}</p>
                              </section>
                            ))}
                            <p className={styles.caveat}>
                              <Icon name="info" size={14} />
                              {turn.answer.caveat}
                            </p>
                            <p className={styles.citation}>
                              <Icon name="database" size={13} />
                              来源：本页固定的预设数据 · 仅用于体验界面
                            </p>
                          </div>
                        </details>
                        <div className={styles.answerActions}>
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => copy(turn)}
                          >
                            <Icon name={copied === turn.id ? "check" : "file"} size={13} />
                            {copied === turn.id ? "已复制" : "复制回答"}
                          </button>
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => downloadSummary(turn.answer!)}
                          >
                            <Icon name="download" size={13} />
                            导出演示摘要
                          </button>
                          <span className={styles.viewLabel}>
                            {turn.table ? "展示切换 · 沿用原结果" : "预设数据 · 可追溯"}
                          </span>
                        </div>
                        {turn.id === turns.at(-1)?.id ? (
                          <div className={styles.followups}>
                            <p className={styles.followupLabel}>沿着这个问题，继续看看</p>
                            {turn.answer.suggestions.map((choice) => (
                              <button
                                type="button"
                                className={styles.followupButton}
                                key={choice.label}
                                disabled={isRunning}
                                onClick={() => begin(choice.action, choice.label)}
                              >
                                {choice.label}
                                <Icon name="arrowUpRight" size={13} />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              </div>
            ))}
          </div>
          {hasNew ? (
            <div className={styles.jumpWrap}>
              <button
                type="button"
                className={styles.jumpButton}
                onClick={() => {
                  following.current = true;
                  if (transcript.current)
                    transcript.current.scrollTop = transcript.current.scrollHeight;
                  setHasNew(false);
                }}
              >
                <Icon name="arrow" size={13} />
                回到最新回复
              </button>
            </div>
          ) : null}
          <div className={styles.composerArea}>
            <div className={styles.composerContext}>
              <span className={styles.composerTitle}>
                {turns.length ? "继续追问" : "从这个问题开始"}
              </span>
              <span className={styles.contextTag}>
                <Icon name="sliders" size={12} />
                <span>{scope}</span>
                <button
                  type="button"
                  className={styles.clearScope}
                  aria-label="清除后续追问范围"
                  disabled={isRunning}
                  onClick={() => {
                    setScope("未限定范围");
                    setAnnouncement("已清除范围，可选择其他预设问题");
                  }}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            </div>
            <form className={styles.composer} onSubmit={submit}>
              <label className="sr-only" htmlFor="preview-question">
                预设体验问题
              </label>
              <textarea
                id="preview-question"
                ref={input}
                className={styles.composerInput}
                value={draft}
                rows={1}
                maxLength={500}
                placeholder={turns.length ? "试试：只看 2025J，或者换成表格…" : scene.prompt}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className={styles.composerBottom}>
                <span className={styles.composerHint}>
                  <Icon name="database" size={12} />
                  预设对话<span> · Enter 发送</span>
                </span>
                {isRunning ? (
                  <button
                    key="stop"
                    className={styles.stopButton}
                    type="button"
                    onClick={(event) => {
                      // Cancelling replaces this control with a submit button during the click.
                      event.preventDefault();
                      stop();
                    }}
                  >
                    <Icon name="close" size={13} />
                    停止体验
                  </button>
                ) : (
                  <button
                    key="send"
                    className={styles.sendButton}
                    type="submit"
                    disabled={!draft.trim()}
                    aria-label="发送预设问题"
                  >
                    <Icon name="arrow" size={19} />
                  </button>
                )}
              </div>
            </form>
            <p className={styles.composerFoot}>
              所有数值与过程均为预设演示，不连接 AI 或查询真实数据。
            </p>
          </div>
        </main>
      </div>
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>
    </div>
  );
}
