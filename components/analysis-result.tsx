"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon } from "@/components/app-icons";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ChartViewPicker } from "@/components/chart-view-picker";
import { planningMethodLabel } from "@/lib/ai/context-label";
import { METRICS } from "@/lib/analysis/metrics";
import type { AnalysisResult, AnalysisRow } from "@/lib/analysis/types";
import { resolveChartView, type ChartViewType } from "@/lib/analysis/visualization";
import { orderTimeRows } from "@/lib/analysis/presentation-policy";
import {
  analysisDimensionLabel,
  analysisSourceLabel,
  analysisSuppressionNote,
  downloadAnalysisFile,
} from "@/lib/exports/analysis";

const AnalysisChart = dynamic(
  () => import("@/components/analysis-chart").then((module) => module.AnalysisChart),
  {
    ssr: false,
    loading: () => (
      <div className="chart-loading" role="status">
        <span>正在准备图表…</span>
        <span className="motion-skeleton chart-loading-skeleton" aria-hidden="true" />
      </div>
    ),
  },
);

export type AnalysisPlanning = {
  source: "golden_case" | "local" | "openai" | "external";
  rationale: string;
  model?: string | null;
};

// Scores always show two decimals (72.9 → 72.90); whole-event counts stay
// integers with thousands; other metrics keep up to two decimals.
const formatNumber = (value: number, unit: string) =>
  value.toLocaleString("zh-CN", {
    minimumFractionDigits: unit === "分" ? 2 : 0,
    maximumFractionDigits: unit === "次" ? 0 : 2,
  });
const formatCount = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });

// Entrance choreography follows the shared motion system: each region mounts with
// its own delay, so data arriving later still enters in a controlled order.
const enterAt = (delay: number) => ({ "--enter-delay": `${delay}ms` }) as CSSProperties;

function ResultTable({
  rows,
  result,
  selected,
  onSelect,
}: {
  rows: AnalysisRow[];
  result: AnalysisResult;
  selected?: string;
  onSelect: (dimension: string) => void;
}) {
  // Re-mount rows only when the underlying data changes (not on search/sort), so
  // the staggered entrance replays for fresh results while typing stays immediate.
  const dataKey = result.rows.map((row) => `${row.dimension}:${row.value}`).join("|");
  return (
    <div className="table-wrap result-table-region">
      <table className="result-table">
        <caption>
          {result.metricLabel}按{analysisDimensionLabel(result)}比较，单位：{result.unit}
        </caption>
        <thead>
          <tr>
            <th scope="col">{analysisDimensionLabel(result)}</th>
            <th scope="col">
              {result.metricLabel}（{result.unit}）
            </th>
            <th scope="col">参与统计人数</th>
          </tr>
        </thead>
        <tbody
          key={dataKey}
          data-enter-group="rise"
          style={{ "--enter-group-delay": "180ms" } as CSSProperties}
        >
          {rows.map((row) => (
            <tr
              key={row.dimension}
              className={row.dimension === selected ? "selected-row" : undefined}
            >
              <td>
                <button
                  type="button"
                  className="table-group-button"
                  aria-pressed={row.dimension === selected}
                  onClick={() => onSelect(row.dimension)}
                >
                  {row.dimension}
                </button>
              </td>
              <td className="numeric">{formatNumber(row.value, result.unit)}</td>
              <td className="numeric">{formatCount(row.sampleSize)} 人</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalysisResultView({
  result,
  chartType,
  onChartChange,
  loading,
  planning,
  canExport,
  onReport,
  allowedViews,
  showViewPicker = true,
  hideViewPicker = false,
  barOrientation = "vertical",
}: {
  result: AnalysisResult | null;
  chartType: ChartViewType;
  onChartChange: (chart: ChartViewType) => void;
  loading: boolean;
  planning?: AnalysisPlanning | null;
  /** Browser-side CSV/HTML downloads are unavailable to read-only accounts. */
  canExport: boolean;
  onReport: (result: AnalysisResult) => void;
  /** Optional semantic whitelist supplied by ConversationArtifact. */
  allowedViews?: readonly ChartViewType[];
  /** Deprecated compatibility flag; prefer hideViewPicker. */
  showViewPicker?: boolean;
  /** Hide the built-in picker when the conversation wrapper owns the choice. */
  hideViewPicker?: boolean;
  barOrientation?: "horizontal" | "vertical";
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");
  const [selectedDimension, setSelectedDimension] = useState<string | null>(null);
  useEffect(() => {
    setSearch("");
    setSort("default");
    setSelectedDimension(null);
  }, [result]);
  const rows = useMemo(() => {
    const filtered =
      result?.rows.filter((row) =>
        row.dimension.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ) ?? [];
    if (sort === "highest")
      filtered.sort((a, b) => b.value - a.value || a.dimension.localeCompare(b.dimension));
    if (sort === "lowest")
      filtered.sort((a, b) => a.value - b.value || a.dimension.localeCompare(b.dimension));
    if (sort === "name") filtered.sort((a, b) => a.dimension.localeCompare(b.dimension));
    return filtered;
  }, [result, search, sort]);
  const highest = rows.reduce<AnalysisRow | null>(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  const selected = rows.find((row) => row.dimension === selectedDimension) ?? highest;
  const dimension = result ? analysisDimensionLabel(result) : "课程";
  const definition = Object.values(METRICS).find((metric) => metric.label === result?.metricLabel);
  const gap = highest && selected ? Math.round((highest.value - selected.value) * 100) / 100 : 0;
  const activeChart = resolveChartView(chartType, result?.unit ?? "", rows);
  // Search/sort may reorder the visible table, but a term trend must never
  // connect observations in an arbitrary alphabetical or value order.
  const chartRows = useMemo(() => {
    if (activeChart !== "line" || result?.dimension !== "term") return rows;
    return orderTimeRows(rows) ?? rows;
  }, [activeChart, result?.dimension, rows]);
  // Counts animate on data arrival; while the user searches, the visible number
  // must respond immediately, so those counts render as plain text.
  const animateCounts = search.trim() === "";
  // Activity is a sum of whole events, so its count-up must stay integer; scores
  // and percentages may legitimately carry two decimals.
  const valueDecimals = result?.unit === "次" ? 0 : 2;

  return (
    <section
      className="analysis-result metric-scope"
      data-metric={
        result?.unit === "%" ? "completion_rate" : result?.unit === "次" ? "activity" : "score"
      }
      aria-label="分析结果"
      aria-busy={loading}
      data-enter="fade"
    >
      <div className="result-section-heading" data-enter="rise-sm" style={enterAt(60)}>
        <div>
          <h2>{result ? `${result.metricLabel}对比` : "分析结果"}</h2>
          <p>
            {result
              ? `按${dimension}比较 · ${result.period}`
              : "选择指标，或用一句话描述你想了解的问题。"}
          </p>
        </div>
        <div className="result-heading-actions">
          {result && (
            <button className="secondary-button" type="button" onClick={() => onReport(result)}>
              <Icon name="file" size={15} />
              生成报告
            </button>
          )}
        </div>
      </div>
      <p className="sr-only" role="status">
        {loading ? (result ? "正在更新分析结果，保留上次成功的结果。" : "正在计算，请稍候…") : ""}
      </p>
      {!result ? (
        <div className="analysis-empty" data-enter="fade" style={enterAt(80)}>
          <Icon name="chart" size={32} />
          <h3>{loading ? "正在读取分析结果" : "从一个问题开始"}</h3>
          <p>
            {loading
              ? "计算完成后，图表与统计依据会一起显示。"
              : "常用指标可以直接比较，推荐问题也可以直接使用。"}
          </p>
          {loading && (
            <div className="analysis-skeleton" aria-hidden="true">
              <span className="motion-skeleton analysis-skeleton-chart" />
              <span className="motion-skeleton analysis-skeleton-focus" />
            </div>
          )}
        </div>
      ) : (
        <>
          {!hideViewPicker && showViewPicker ? (
            <div className="result-chart-picker" data-enter="rise-sm" style={enterAt(120)}>
              <ChartViewPicker
                value={chartType}
                onChange={onChartChange}
                rows={rows}
                unit={result.unit}
                allowedViews={allowedViews}
              />
            </div>
          ) : null}
          <div
            className="result-filter"
            role="group"
            aria-label="筛选与排序"
            data-enter="fade"
            style={enterAt(160)}
          >
            <div className="result-filter-fields disclosure-content">
              <label>
                搜索分组
                <input
                  type="search"
                  name="result-search"
                  placeholder={`搜索${dimension}…`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                结果排序
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="default">分析默认顺序</option>
                  <option value="highest">数值从高到低</option>
                  <option value="lowest">数值从低到高</option>
                  <option value="name">分组名称</option>
                </select>
              </label>
            </div>
            <span className="result-filter-count">
              {animateCounts ? <AnimatedNumber value={rows.length} decimals={0} /> : rows.length} /{" "}
              {animateCounts ? (
                <AnimatedNumber value={result.rows.length} decimals={0} />
              ) : (
                result.rows.length
              )}{" "}
              个分组
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="analysis-empty" role="status" data-enter="fade" style={enterAt(200)}>
              <Icon name="search" size={28} />
              <h3>没有符合条件的结果</h3>
              <p>
                {search
                  ? "更换关键词，或清空搜索条件。"
                  : `当前范围没有可展示的分组；${analysisSuppressionNote(result)}人数少于 ${result.minSampleSize} 人的分组不会显示。`}
              </p>
              {search && (
                <button type="button" className="secondary-button" onClick={() => setSearch("")}>
                  清空搜索
                </button>
              )}
            </div>
          ) : (
            <div className="analysis-result-grid">
              <div className="result-visual" data-enter="panel" style={enterAt(200)}>
                {activeChart === "table" ? (
                  <ResultTable
                    rows={rows}
                    result={result}
                    selected={selected?.dimension}
                    onSelect={setSelectedDimension}
                  />
                ) : (
                  <AnalysisChart
                    rows={chartRows}
                    chartType={activeChart}
                    unit={result.unit}
                    barOrientation={barOrientation}
                    metricLabel={result.metricLabel}
                    dimensionLabel={dimension}
                    selectedDimension={selected?.dimension}
                    onSelectDimension={setSelectedDimension}
                    entrance
                  />
                )}
                {highest && (
                  <div className="result-conclusion" data-enter="fade" style={enterAt(420)}>
                    <Icon name="chart" size={16} />
                    <p>
                      <strong>{highest.dimension}</strong> 的{result.metricLabel}最高，为{" "}
                      <strong>
                        {formatNumber(highest.value, result.unit)} {result.unit}
                      </strong>
                      。{search && <span>仅比较筛选后的分组。</span>}
                    </p>
                  </div>
                )}
              </div>
              {selected && (
                <aside
                  className="result-focus"
                  data-glass-pane="0.55"
                  data-glass-tier="3"
                  data-glass-relief="1"
                  aria-label="选中分组的统计详情"
                  data-enter="slide-right"
                  data-enter-group="rise"
                  style={
                    {
                      "--enter-delay": "260ms",
                      "--enter-group-delay": "320ms",
                    } as CSSProperties
                  }
                >
                  <div className="focus-caption">
                    <span>当前{dimension}</span>
                    <span>{analysisSourceLabel(result)}</span>
                  </div>
                  <label className="focus-group-picker">
                    <span className="sr-only">选择查看的分组</span>
                    <select
                      aria-label="选择查看的分组"
                      value={selected.dimension}
                      onChange={(event) => setSelectedDimension(event.target.value)}
                    >
                      {rows.map((row) => (
                        <option key={row.dimension} value={row.dimension}>
                          {row.dimension}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="focus-number-block">
                    <span>{result.metricLabel}</span>
                    <p>
                      <strong>
                        <AnimatedNumber value={selected.value} decimals={valueDecimals} />
                      </strong>
                      <small>{result.unit}</small>
                    </p>
                  </div>
                  <dl className="focus-statistics">
                    <div>
                      <dt>参与统计</dt>
                      <dd>
                        <AnimatedNumber value={selected.sampleSize} decimals={0} /> 人
                      </dd>
                    </div>
                    <div>
                      <dt>距可见最高值</dt>
                      <dd>
                        <AnimatedNumber value={gap} decimals={valueDecimals} />{" "}
                        {result.unit === "%" ? "个百分点" : result.unit}
                      </dd>
                    </div>
                  </dl>
                  <p className="focus-help">点击图表或表格中的分组，查看对应数值。</p>
                </aside>
              )}
            </div>
          )}
          <div className="result-footer">
            <p data-enter="fade" style={enterAt(460)}>
              {animateCounts ? <AnimatedNumber value={rows.length} decimals={0} /> : rows.length}{" "}
              个可见分组 · 每组至少 {result.minSampleSize} 人
            </p>
            {canExport ? (
              <details
                className="result-export result-disclosure"
                data-enter="rise-sm"
                style={enterAt(500)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    event.currentTarget.open = false;
                }}
              >
                <summary>
                  <Icon name="download" size={16} />
                  导出结果
                  <Icon name="chevron" size={14} />
                </summary>
                <div
                  className="export-options disclosure-content"
                  data-enter="rise-sm"
                  style={{ "--enter-delay": "0ms", "--enter-dur": "320ms" } as CSSProperties}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      downloadAnalysisFile(result, "csv");
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                  >
                    下载 CSV
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      downloadAnalysisFile(result, "html");
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                  >
                    下载 HTML 报告
                  </button>
                  <button type="button" onClick={() => onReport(result)}>
                    预览 / 打印报告
                  </button>
                  <p>导出全部返回分组，保留原始顺序。</p>
                </div>
              </details>
            ) : (
              <p className="muted">只读账号可以预览报告，浏览器导出已关闭。</p>
            )}
          </div>
          <details
            className="result-technical result-disclosure"
            data-enter="fade"
            style={enterAt(540)}
          >
            <summary>
              <Icon name="sliders" size={16} />
              计算依据<span>指标口径、样本范围与 SQL</span>
              <Icon name="chevron" size={15} />
            </summary>
            <div
              className="technical-content disclosure-content"
              data-enter="fade"
              style={{ "--enter-delay": "0ms", "--enter-dur": "320ms" } as CSSProperties}
            >
              <dl>
                <div>
                  <dt>数据源</dt>
                  <dd>
                    {analysisSourceLabel(result)}
                    {result.datasetVersion ? ` · 版本 ${result.datasetVersion}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>计算口径</dt>
                  <dd>{definition?.description}</dd>
                </div>
                <div>
                  <dt>标准公式</dt>
                  <dd>
                    <code>{definition?.formula}</code>
                  </dd>
                </div>
                <div>
                  <dt>统计范围</dt>
                  <dd>
                    {result.period} · 按{dimension}
                  </dd>
                </div>
                <div>
                  <dt>样本与隐私</dt>
                  <dd>
                    仅展示聚合结果，每组至少 {result.minSampleSize} 名学生；
                    {analysisSuppressionNote(result)}
                    各组人数分别去重，同一学生可能出现在多个分组。
                  </dd>
                </div>
                <div>
                  <dt>查询用时</dt>
                  <dd>{formatCount(result.durationMs)} ms</dd>
                </div>
                {planning && (
                  <div>
                    <dt>分析方式</dt>
                    <dd>
                      {planningMethodLabel(planning)} · {planning.rationale}
                    </dd>
                  </div>
                )}
              </dl>
              {result.datasetId === "oulad" &&
                result.metricLabel === METRICS.completion_rate.label && (
                  <p className="technical-note">
                    OULAD 完成率以最终结果为 Pass 或 Distinction 的记录计为完成。
                  </p>
                )}
              <pre>{result.query}</pre>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
