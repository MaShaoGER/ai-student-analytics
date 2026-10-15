"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Icon, type IconName } from "@/components/app-icons";
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
          rx="2"
        />
      ))}
    </svg>
  );
}

export function LearningOverview({
  results,
  loading,
  profile,
  canRun,
  onExplore,
  onQuestion,
  onData,
  onReport,
}: {
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
  const [selected, setSelected] = useState<string>();
  const result = results[metric];
  const score = highest(results.score);
  const completion = highest(results.completion_rate);
  const activity = results.activity?.rows.reduce((total, row) => total + row.value, 0);
  const leading = highest(result);
  const ranked = [...(result?.rows ?? [])].sort((a, b) => b.value - a.value);
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
      note: score ? `${score.dimension} · 课程成绩领先` : "等待成绩数据",
      icon: "book",
      metric: "score",
      result: results.score,
    },
    {
      label: "学习活动总量",
      value: activity,
      unit: "次",
      note: "可见课程的资源访问总次数",
      icon: "activity",
      metric: "activity",
      result: results.activity,
    },
    {
      label: "最高课程完成率",
      value: completion?.value,
      unit: "%",
      note: completion ? `${completion.dimension} · 完成表现领先` : "等待完成率数据",
      icon: "check",
      metric: "completion_rate",
      result: results.completion_rate,
    },
  ];
  return (
    <div className="learning-overview">
      <section className="overview-metrics" aria-label="学习表现速览">
        {cards.map((card, index) => (
          <button
            className={`overview-metric${metric === card.metric ? " is-selected" : ""}`}
            type="button"
            key={card.metric}
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
              <span className="overview-metric-value">
                {loading ? "—" : card.value === undefined ? "暂无" : number(card.value)}
                <small>{card.unit}</small>
              </span>
              <MetricBars result={card.result} />
            </span>
            <span className="overview-metric-note">
              {card.note}
              <Icon name="arrow" size={14} />
            </span>
          </button>
        ))}
      </section>
      <div className="overview-columns">
        <div className="overview-primary">
          <section className="panel overview-chart-panel" aria-busy={loading}>
            <div className="overview-panel-heading">
              <div>
                <span className="section-kicker">LEARNING PERFORMANCE</span>
                <h2>课程表现，一眼看清</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => onExplore(metric)}>
                详细分析
                <Icon name="arrow" size={15} />
              </button>
            </div>
            <div className="overview-chart-toolbar">
              <div className="overview-metric-tabs" aria-label="概览图表指标">
                {(["score", "activity", "completion_rate"] as const).map((value) => (
                  <button
                    key={value}
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
              <span className="overview-chart-legend">
                <i />
                {result?.rows.length ?? 0} 门可见课程
              </span>
            </div>
            {result?.rows.length ? (
              <AnalysisChart
                rows={result.rows}
                chartType="bar"
                unit={result.unit}
                metricLabel={result.metricLabel}
                dimensionLabel="课程"
                selectedDimension={selected}
                onSelectDimension={setSelected}
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
              <p>
                {leading ? (
                  <>
                    <strong>{leading.dimension}</strong> 的{result?.metricLabel}领先，为{" "}
                    <strong>
                      {number(leading.value)} {result?.unit}
                    </strong>
                    。<span>点击图柱查看各组数据。</span>
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
                <tbody>
                  {ranked.slice(0, 5).map((row, index) => (
                    <tr key={row.dimension}>
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
                            style={{
                              width: `${leading?.value ? Math.max(1, (row.value / leading.value) * 100) : 0}%`,
                            }}
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
                <Icon name="arrow" size={14} />
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
              <span>从问题到洞察</span>
            </div>
            <h2>
              数据里的答案，
              <br />
              问一句就好。
            </h2>
            <p>
              用自然语言描述问题，
              <br />
              让分析从你的好奇心开始。
            </p>
            <button className="ask-card-button" type="button" onClick={() => onQuestion()}>
              一句话分析
              <Icon name="arrow" size={18} />
            </button>
            <div className="ask-card-art" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </section>
          <section className="panel overview-prompts">
            <div className="overview-panel-heading">
              <h2>从这里开始探索</h2>
              <Icon name="arrow" size={16} />
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
                <Icon name="chevron" size={14} />
              </button>
            ))}
            <p>
              <Icon name="check" size={13} />
              推荐问题可直接分析，无需 AI 连接
            </p>
          </section>
          <section className="panel overview-source-card">
            <div className="source-card-label">
              <Icon name="database" size={17} />
              <span>数据档案</span>
              <span className={canRun ? "status-dot" : "status-dot is-muted"} />
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
