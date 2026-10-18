"use client";

import dynamic from "next/dynamic";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/app-icons";
import { ChartViewPicker } from "@/components/chart-view-picker";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
import { resolveChartView, type ChartViewType } from "@/lib/analysis/visualization";
import { METRICS } from "@/lib/analysis/metrics";
import { GOLDEN_CASES } from "@/lib/analysis/golden-cases";
import type { AnalysisResult, DatasetProfile, Metric } from "@/lib/analysis/types";

const AnalysisChart = dynamic(
  () => import("@/components/analysis-chart").then((module) => module.AnalysisChart),
  {
    ssr: false,
    loading: () => (
      <div className="chart-loading" role="status">
        正在准备图表…
      </div>
    ),
  },
);
export type OverviewResults = Partial<Record<Metric, AnalysisResult>>;
const number = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const highest = (result?: AnalysisResult) =>
  result?.rows.reduce<AnalysisResult["rows"][number] | undefined>(
    (best, row) => (!best || row.value > best.value ? row : best),
    undefined,
  );
// Explain the leader with a real gap to the runner-up instead of a generic label.
const leaderGap = (result?: AnalysisResult) => {
  if (!result || result.rows.length < 2) return undefined;
  const sorted = [...result.rows].sort((a, b) => b.value - a.value);
  return sorted[0].value - sorted[1].value;
};
// The server describes the record scope; drop the dataset name, which the source
// selector already shows, so the hero can state the period in one short line.
const scopeLabel = (period?: string) =>
  period ? period.replace(/^模拟数据/, "").replace(/^OULAD 本地 CSV /, "") : "";

// Data motion belongs to the moment results land: the hero counts up once, then
// holds still. Keyboard, reduced-motion and the local motion switch keep it inert.
const COUNT_UP_MS = 900;
const countUpAllowed = () => {
  const root = document.documentElement;
  // Page-load number motion is presentation, not interaction feedback, so it is
  // not tied to pointer modality; the local motion switch and OS setting still win.
  return root.dataset.motion === "on" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
};
function useCountUp(value: number | undefined) {
  const { enabled, reduced } = useMotionPreferences();
  const [display, setDisplay] = useState<number | undefined>(value);
  useLayoutEffect(() => {
    if (value === undefined) {
      setDisplay(undefined);
      return;
    }
    if (!enabled || reduced || !countUpAllowed()) {
      setDisplay(value);
      return;
    }
    // Count from zero every time a fresh value mounts: page entry, view return and
    // data-source switches all get the same take-off.
    setDisplay(0);
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / COUNT_UP_MS);
      // Strong ease-out: numbers sprint away from zero and settle under the eye.
      setDisplay(value * (1 - Math.pow(1 - progress, 5)));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, enabled, reduced]);
  return display;
}

function MetricNumber({
  value,
  loading,
  unit,
  decimals = 0,
}: {
  value?: number;
  loading: boolean;
  unit: string;
  decimals?: number;
}) {
  const display = useCountUp(loading ? undefined : value);
  const shown = display === undefined ? undefined : decimals === 0 ? Math.round(display) : display;
  return (
    <span className="overview-metric-value">
      {loading ? (
        <span className="metric-pending" aria-hidden="true" />
      ) : value === undefined ? (
        "暂无"
      ) : (
        number(shown ?? value)
      )}
      {!loading && <small>{unit}</small>}
    </span>
  );
}

// Miniatures show the returned course groups, rather than invented trends.
function MetricBars({ result }: { result?: AnalysisResult }) {
  const values = result?.rows.slice(0, 12).map((row) => row.value) ?? [];
  const max = Math.max(...values, 1);
  return (
    <svg className="metric-miniature" viewBox="0 0 100 38" aria-hidden="true">
      {values.map((value, index) => (
        <rect
          key={index}
          x={index * (100 / values.length)}
          y={36 - (value / max) * 30}
          width={Math.max(2, 100 / values.length - 5)}
          height={Math.max(2, (value / max) * 30)}
          rx="0"
        />
      ))}
    </svg>
  );
}

export function LearningOverview({
  heading,
  sourceControl,
  results,
  loading,
  profile,
  canRun,
  onExplore,
  onQuestion,
  onData,
  onReport,
}: {
  heading: ReactNode;
  sourceControl: ReactNode;
  results: OverviewResults;
  loading: boolean;
  profile?: DatasetProfile;
  canRun: boolean;
  onExplore: (metric: Metric) => void;
  onQuestion: (question?: string) => void;
  onData: () => void;
  onReport: (result: AnalysisResult) => void;
}) {
  const [metric, setMetric] = useState<Metric>("score");
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState<string>();
  const [chartViews, setChartViews] = useState<Partial<Record<Metric, ChartViewType>>>({});
  const result = results[metric];
  const score = highest(results.score);
  const completion = highest(results.completion_rate);
  const activity = results.activity?.rows.reduce((total, row) => total + row.value, 0);
  const scoreLead = leaderGap(results.score);
  const completionLead = leaderGap(results.completion_rate);
  const leading = highest(result);
  const ranked = [...(result?.rows ?? [])].sort((a, b) => b.value - a.value);
  const trailing = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const period = scopeLabel(result?.period);
  const chartView = chartViews[metric] ?? "bar";
  const comparisonResult = results[metric === "activity" ? "score" : "activity"];
  // Pair metrics by group name only when both results cover the same visible groups.
  const comparison =
    comparisonResult &&
    result?.rows.every((row) =>
      comparisonResult.rows.some((other) => other.dimension === row.dimension),
    )
      ? {
          rows: comparisonResult.rows,
          metricLabel: comparisonResult.metricLabel,
          unit: comparisonResult.unit,
        }
      : undefined;
  const cards: {
    label: string;
    value?: number;
    unit: string;
    note: string;
    icon: IconName;
    metric: Metric;
    result?: AnalysisResult;
  }[] = [
    {
      label: "最高课程均分",
      value: score?.value,
      unit: "分",
      note: score
        ? scoreLead === undefined
          ? `${score.dimension} · 当前唯一可见课程`
          : `${score.dimension} · 领先第 2 名 ${number(scoreLead)} 分`
        : "等待成绩数据",
      icon: "book",
      metric: "score",
      result: results.score,
    },
    {
      label: "学习活动总量",
      value: activity,
      unit: "次",
      note: results.activity
        ? `${results.activity.rows.length} 门可见课程合计`
        : "可见课程的资源访问总次数",
      icon: "activity",
      metric: "activity",
      result: results.activity,
    },
    {
      label: "最高课程完成率",
      value: completion?.value,
      unit: "%",
      note: completion
        ? completionLead === undefined
          ? `${completion.dimension} · 当前唯一可见课程`
          : `${completion.dimension} · 领先第 2 名 ${number(completionLead)} 个百分点`
        : "等待完成率数据",
      icon: "check",
      metric: "completion_rate",
      result: results.completion_rate,
    },
  ];
  return (
    <div className="learning-overview metric-scope" data-metric={metric}>
      <div className="overview-hero">
        <div className="overview-introduction">
          {heading}
          <div className="overview-toolbar">
            {sourceControl}
            <p title={result?.period}>
              {result?.rows.length ?? 0} 门可见课程
              {period ? ` · ${period}` : " · 当前数据计算"}
            </p>
          </div>
        </div>
        <section className="overview-metrics" aria-label="学习表现速览">
          {cards.map((card, index) => (
            <button
              className={`overview-metric${metric === card.metric ? " is-selected" : ""}`}
              type="button"
              key={card.metric}
              data-metric={card.metric}
              aria-pressed={metric === card.metric}
              disabled={!results[card.metric]}
              onClick={() => {
                setMetric(card.metric);
                setSelected(undefined);
              }}
            >
              <span className="overview-metric-label">
                <Icon name={card.icon} size={16} />
                {card.label}
                <span className="metric-index">0{index + 1}</span>
              </span>
              <span className="overview-metric-body">
                <MetricNumber
                  loading={loading}
                  value={card.value}
                  unit={card.unit}
                  decimals={card.metric === "activity" ? 0 : 2}
                />
                <MetricBars result={card.result} />
              </span>
              {card.metric === "score" && card.value !== undefined && !loading && (
                <span
                  className="score-calibration"
                  role="meter"
                  aria-label="最高课程均分"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={card.value}
                  key={card.value}
                >
                  <i
                    style={
                      {
                        "--fill": Math.min(1, Math.max(0, card.value / 100)),
                      } as CSSProperties
                    }
                  />
                </span>
              )}
              <span className="overview-metric-note">
                {card.note}
                <Icon name="arrowUpRight" size={14} />
              </span>
            </button>
          ))}
        </section>
      </div>
      <div className="overview-section-bar">
        <span>
          <small>A—01</small>课程表现，一眼看清
        </span>
        <button className="text-button" type="button" onClick={() => onExplore(metric)}>
          进入详细分析
          <Icon name="arrowUpRight" size={15} />
        </button>
      </div>
      <div className="overview-columns">
        <div className="overview-primary">
          <section className="panel overview-chart-panel" aria-busy={loading}>
            <div className="overview-panel-heading">
              <div>
                <span className="section-kicker">COURSE PERFORMANCE</span>
                <h2>课程信号</h2>
              </div>
              <div className="overview-panel-actions">
                <span className="overview-chart-legend">
                  <i aria-hidden="true" />
                  {result?.rows.length ?? 0} 门课程 · 单位：{result?.unit ?? METRICS[metric].unit}
                </span>
                <button
                  className="icon-button"
                  aria-label="详细分析"
                  type="button"
                  onClick={() => onExplore(metric)}
                >
                  <Icon name="arrowUpRight" size={15} />
                </button>
              </div>
            </div>
            <div className="overview-chart-toolbar">
              <div className="overview-metric-tabs" aria-label="概览图表指标">
                {(["score", "activity", "completion_rate"] as const).map((value) => (
                  <button
                    key={value}
                    data-metric={value}
                    type="button"
                    aria-pressed={metric === value}
                    onClick={() => {
                      setMetric(value);
                      setSelected(undefined);
                    }}
                  >
                    {METRICS[value].label}
                  </button>
                ))}
              </div>
              <ChartViewPicker
                value={chartView}
                onChange={(value) => setChartViews((current) => ({ ...current, [metric]: value }))}
                rows={result?.rows ?? []}
                unit={result?.unit ?? METRICS[metric].unit}
                includeTable={false}
                scatterDescription={
                  comparison
                    ? `每个气泡代表一门课程。横轴：${comparison.metricLabel}；纵轴：${result?.metricLabel}。气泡面积表示人数，关联不代表因果。`
                    : undefined
                }
              />
            </div>
            {result?.rows.length ? (
              <AnalysisChart
                rows={result.rows}
                chartType={resolveChartView(chartView, result.unit, result.rows)}
                unit={result.unit}
                metricLabel={result.metricLabel}
                dimensionLabel="课程"
                selectedDimension={selected}
                onSelectDimension={setSelected}
                comparison={comparison}
                entrance
              />
            ) : (
              <div className="analysis-empty" role="status">
                <Icon name="chart" size={28} />
                <p>{loading ? "正在计算课程表现…" : "当前没有可显示的分组数据"}</p>
              </div>
            )}
            <div className="overview-chart-insight">
              <span className="insight-icon">
                <Icon name="sparkles" size={17} />
              </span>
              <p key={metric}>
                {leading ? (
                  <>
                    最高 <strong>{leading.dimension}</strong>{" "}
                    <strong>
                      {number(leading.value)} {result?.unit}
                    </strong>
                    {trailing && trailing.dimension !== leading.dimension && (
                      <>
                        ，最低 <strong>{trailing.dimension}</strong> {number(trailing.value)}{" "}
                        {result?.unit}
                      </>
                    )}
                    。点击图形或表格，查看各组数据。
                  </>
                ) : (
                  "每一份洞察，都从可追溯的数据开始。"
                )}
              </p>
              {result && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label="预览当前分析报告"
                  onClick={() => onReport(result)}
                >
                  <Icon name="file" size={17} />
                </button>
              )}
            </div>
          </section>
          <section className="panel overview-ranking">
            <div className="overview-panel-heading">
              <div>
                <h2>分组明细</h2>
                <p>按{METRICS[metric].label}从高到低排列</p>
              </div>
              <span className="subtle-label">{ranked.length} 个分组</span>
            </div>
            <div className="table-wrap">
              <table>
                <caption>课程表现排名</caption>
                <thead>
                  <tr>
                    <th scope="col">课程</th>
                    <th scope="col">{METRICS[metric].label}</th>
                    <th scope="col">参与统计</th>
                    <th scope="col">分布</th>
                  </tr>
                </thead>
                <tbody key={metric}>
                  {ranked.slice(0, 5).map((row, index) => (
                    <tr key={row.dimension} style={{ "--row": index } as CSSProperties}>
                      <td>
                        <button
                          className="ranking-course"
                          type="button"
                          aria-pressed={(selected ?? leading?.dimension) === row.dimension}
                          onClick={() => setSelected(row.dimension)}
                        >
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{row.dimension}</strong>
                        </button>
                      </td>
                      <td className="numeric">
                        {number(row.value)} <small>{result?.unit}</small>
                      </td>
                      <td className="numeric">{number(row.sampleSize)} 人</td>
                      <td>
                        <span className="ranking-track">
                          <i
                            style={
                              {
                                "--fill": leading?.value
                                  ? Math.max(0.04, Math.min(1, row.value / leading.value))
                                  : 0,
                              } as CSSProperties
                            }
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ranking-footer">
              <span>各组人数分别去重，不能相加作为总人数。</span>
              <button className="text-button" type="button" onClick={() => onExplore(metric)}>
                查看全部
                <Icon name="arrowUpRight" size={14} />
              </button>
            </div>
          </section>
        </div>
        <aside className="overview-secondary">
          <section className="overview-ask-card">
            <div className="ask-card-top">
              <span className="ask-card-symbol">
                <Icon name="sparkles" size={23} />
              </span>
              <span>AI 分析助手</span>
            </div>
            <h2>
              好的分析，
              <br />
              从一个问题开始。
            </h2>
            <p>
              用日常语言提问，
              <br />
              把好奇心变成有依据的结论。
            </p>
            <div className="overview-terminal">
              <div className="terminal-label">Q / 01 — QUESTION INPUT</div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onQuestion(question.trim() || undefined);
                }}
              >
                <input
                  aria-label="输入分析问题"
                  placeholder="你想了解什么？"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={1000}
                />
                <button
                  className="ask-card-button"
                  aria-label="开始提问"
                  type="submit"
                  disabled={!canRun}
                >
                  <Icon name="arrowUpRight" size={18} />
                </button>
              </form>
            </div>
            <section className="overview-prompts">
              <div className="overview-panel-heading overview-panel-heading-inline">
                <h2>试着问问</h2>
                <Icon name="messages" size={17} />
              </div>
              {[GOLDEN_CASES[0], GOLDEN_CASES[3], GOLDEN_CASES[6]].map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  disabled={!canRun}
                  onClick={() => onQuestion(item.question)}
                >
                  <span className="prompt-number">0{index + 1}</span>
                  <span>{item.question}</span>
                  <Icon name="arrow" size={14} />
                </button>
              ))}
              <p>
                <Icon name="check" size={13} />
                推荐问题可直接分析，无需 AI 连接
              </p>
            </section>
          </section>
          <section className="panel overview-source-card">
            <div className="source-card-label">
              <Icon name="database" size={17} />
              <span>数据概况</span>
              <button
                type="button"
                className="icon-button"
                aria-label="查看数据档案"
                onClick={onData}
              >
                <Icon name="arrowUpRight" size={16} />
              </button>
            </div>
            <h3>{profile?.name ?? "正在读取数据"}</h3>
            <div className="source-card-stats">
              <span>
                <strong>
                  {profile?.tables.filter((table) => table.status === "ready").length ?? "—"}
                </strong>
                张数据表
              </span>
              <span>
                <strong>{results.score?.rows.length ?? "—"}</strong>门可见课程
              </span>
            </div>
            <button type="button" className="text-button" onClick={onData}>
              查看字段与数据质量
              <Icon name="arrow" size={14} />
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
