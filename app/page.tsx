"use client";

import { useEffect, useMemo, useState } from "react";
import { AnalysisChart } from "@/components/analysis-chart";
import { GOLDEN_CASES } from "@/lib/analysis/golden-cases";
import { METRICS } from "@/lib/analysis/metrics";
import type {
  AnalysisPlan,
  AnalysisResult,
  DataSource,
  DatasetProfile,
  Metric,
} from "@/lib/analysis/types";

type AnalysisResponse = { result: AnalysisResult; plan: unknown } | { error: string };
type AskResponse =
  | {
      result: AnalysisResult;
      plan: AnalysisPlan;
      planning: {
        source: "golden_case" | "openai";
        rationale: string;
        matchedCaseId: string | null;
        model: string | null;
      };
    }
  | { error: string; code?: string };
type AIStatus = { configured: boolean; model: string | null };

const metricOptions: Array<{ value: Metric; label: string }> = [
  { value: "score", label: "平均成绩" },
  { value: "activity", label: "活跃次数" },
  { value: "completion_rate", label: "完成率" },
];

export default function HomePage() {
  const [profiles, setProfiles] = useState<DatasetProfile[]>([]);
  const [datasetId, setDatasetId] = useState<DataSource>("demo");
  const [metric, setMetric] = useState<Metric>("score");
  const [dimension, setDimension] = useState<"course" | "term">("course");
  const [chartType, setChartType] = useState<"bar" | "line" | "table">("bar");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [question, setQuestion] = useState("");
  const [planning, setPlanning] = useState<
    Exclude<AskResponse, { error: string }>["planning"] | null
  >(null);
  const [aiStatus, setAIStatus] = useState<AIStatus>({ configured: false, model: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((response) => response.json())
      .then((payload: { datasets: DatasetProfile[] }) => setProfiles(payload.datasets))
      .catch(() => setError("数据集概览加载失败，请确认服务已启动。"));
    fetch("/api/ai/status")
      .then((response) => response.json())
      .then((payload: AIStatus) => setAIStatus(payload))
      .catch(() => setAIStatus({ configured: false, model: null }));
  }, []);

  const selectedProfile = profiles.find((profile) => profile.id === datasetId);
  const metricDefinition = METRICS[metric];
  const canRun = selectedProfile?.available ?? datasetId === "demo";

  const headline = useMemo(() => {
    if (!analysis || analysis.rows.length === 0) return null;
    return analysis.rows[0];
  }, [analysis]);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          datasetId,
          metric,
          aggregation:
            metric === "activity" ? "sum" : metric === "completion_rate" ? "rate" : "avg",
          dimensions: [dimension],
          filters: [],
          sort: { by: "value", direction: "desc" },
          limit: 20,
          chartType,
        }),
      });
      const payload = (await response.json()) as AnalysisResponse;
      if (!response.ok || "error" in payload)
        throw new Error("error" in payload ? payload.error : "分析请求失败");
      setAnalysis(payload.result);
      setPlanning(null);
    } catch (requestError) {
      setAnalysis(null);
      setError(requestError instanceof Error ? requestError.message : "分析请求失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function handleAsk(nextQuestion = question) {
    const trimmedQuestion = nextQuestion.trim();
    if (trimmedQuestion.length < 2) {
      setError("请输入至少 2 个字符的问题。");
      return;
    }
    setQuestion(nextQuestion);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion, datasetId }),
      });
      const payload = (await response.json()) as AskResponse;
      if (!response.ok || "error" in payload)
        throw new Error("error" in payload ? payload.error : "AI 分析请求失败");
      setMetric(payload.plan.metric);
      setDimension(payload.plan.dimensions[0]);
      setChartType(payload.plan.chartType);
      setPlanning(payload.planning);
      setAnalysis(payload.result);
    } catch (requestError) {
      setAnalysis(null);
      setPlanning(null);
      setError(
        requestError instanceof Error ? requestError.message : "AI 分析请求失败，请稍后重试。",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">析</div>
          <div>
            <div className="brand-title">学析台</div>
            <div className="brand-subtitle">学生学习数据分析助手</div>
          </div>
        </div>
        <div className="topbar-status">
          <span className={`status-dot ${aiStatus.configured ? "" : "status-dot-muted"}`} />
          {aiStatus.configured ? `AI 已连接 · ${aiStatus.model}` : "本地分析已就绪 · AI 未配置"}
        </div>
      </header>

      <div className="content">
        <section className="intro">
          <div>
            <div className="eyebrow">MVP / 可追溯分析</div>
            <h1>先看清数据，再讨论教学行动</h1>
            <p className="intro-copy">
              从受控数据源选择指标和维度，结果由 DuckDB 实际计算，并保留指标口径与只读查询。
            </p>
          </div>
          <div className="updated">数据概览 · 第 1 周基础切片</div>
        </section>

        <div className="layout-grid">
          <aside className="panel">
            <div className="panel-header">
              <h2 className="panel-title">选择数据集</h2>
              <p className="panel-caption">仅读取本地文件，不上传学生记录。</p>
            </div>
            <div className="panel-body">
              <div className="dataset-list">
                {profiles.length === 0 ? (
                  <p className="panel-caption">正在读取数据集...</p>
                ) : (
                  profiles.map((profile) => (
                    <button
                      className={`dataset-option ${datasetId === profile.id ? "selected" : ""}`}
                      disabled={!profile.available}
                      key={profile.id}
                      onClick={() => setDatasetId(profile.id)}
                      type="button"
                    >
                      <span className="dataset-option-title">
                        {profile.name}
                        <span className={profile.available ? "ready-badge" : "missing-badge"}>
                          {profile.available ? "可用" : "缺少文件"}
                        </span>
                      </span>
                      <span className="dataset-option-description">{profile.description}</span>
                    </button>
                  ))
                )}
              </div>

              {selectedProfile && (
                <div className="profile-panel">
                  <div className="panel-caption">来源：{selectedProfile.source}</div>
                  <div className="profile-grid" style={{ marginTop: 10 }}>
                    {selectedProfile.tables.map((table) => (
                      <div className="profile-card" key={table.name}>
                        <div className="profile-card-name">{table.name}</div>
                        <div className="profile-card-meta">
                          {table.rows === null
                            ? "本地文件"
                            : `${table.rows.toLocaleString("zh-CN")} 行`}
                          <br />
                          {table.grain}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

          <section>
            <div className="panel ask-panel">
              <div className="panel-header">
                <h2 className="panel-title">用自然语言提问</h2>
                <p className="panel-caption">
                  固定问题使用已验证计划；其他问题由 AI 生成 AnalysisPlan，再交给 DuckDB 计算。
                </p>
              </div>
              <div className="panel-body">
                <div className="ask-row">
                  <input
                    aria-label="分析问题"
                    maxLength={500}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !loading) void handleAsk();
                    }}
                    placeholder="例如：哪门课程平均成绩最高？"
                    value={question}
                  />
                  <button
                    className="run-button"
                    disabled={loading || !canRun}
                    onClick={() => void handleAsk()}
                    type="button"
                  >
                    {loading ? "分析中..." : "生成分析"}
                  </button>
                </div>
                <div className="question-list" aria-label="固定演示问题">
                  {GOLDEN_CASES.map((goldenCase) => (
                    <button
                      className="question-chip"
                      disabled={loading || !canRun}
                      key={goldenCase.id}
                      onClick={() => void handleAsk(goldenCase.question)}
                      type="button"
                    >
                      {goldenCase.question}
                    </button>
                  ))}
                </div>
                {!aiStatus.configured && (
                  <p className="ai-hint">
                    当前未配置模型，10 个固定问题仍可完整运行；自由提问需要设置服务端环境变量。
                  </p>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2 className="panel-title">固定指标分析</h2>
                <p className="panel-caption">第一版只开放已冻结的指标、维度和图表类型。</p>
              </div>
              <div className="panel-body">
                <div className="control-grid">
                  <div className="field">
                    <label htmlFor="metric">指标</label>
                    <select
                      id="metric"
                      value={metric}
                      onChange={(event) => setMetric(event.target.value as Metric)}
                    >
                      {metricOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="dimension">分组维度</label>
                    <select
                      id="dimension"
                      value={dimension}
                      onChange={(event) => setDimension(event.target.value as "course" | "term")}
                    >
                      <option value="course">课程</option>
                      <option value="term">学期</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="chart">展示方式</label>
                    <select
                      id="chart"
                      value={chartType}
                      onChange={(event) =>
                        setChartType(event.target.value as "bar" | "line" | "table")
                      }
                    >
                      <option value="bar">柱状图</option>
                      <option value="line">折线图</option>
                      <option value="table">数据表</option>
                    </select>
                  </div>
                </div>
                <div className="query-row">
                  <div className="query-note">
                    当前口径：{metricDefinition.description}
                    <br />
                    最小样本阈值：3 名学生；不展示个体记录。
                  </div>
                  <button
                    className="run-button"
                    disabled={loading || !canRun}
                    onClick={handleRun}
                    type="button"
                  >
                    {loading ? "计算中..." : "运行分析"}
                  </button>
                </div>
                {error && <div className="error-box">{error}</div>}
              </div>
            </div>

            {analysis && (
              <section className="panel result-panel">
                <div className="panel-header">
                  <div className="result-summary">
                    <div>
                      <h2 className="panel-title">
                        {analysis.metricLabel} · 按
                        {analysis.dimension === "course" ? "课程" : "学期"}
                      </h2>
                      {headline && (
                        <div className="result-value">
                          {headline.value.toLocaleString("zh-CN")}
                          <span className="result-unit">
                            {analysis.unit} · {headline.dimension}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="result-meta">
                      {analysis.rows.length} 个分组 · 查询耗时 {analysis.durationMs} ms
                      <br />
                      {analysis.period} · 每个分组均满足最小样本阈值
                    </div>
                  </div>
                  {planning && (
                    <div className="planning-note">
                      <strong>
                        {planning.source === "golden_case" ? "金标准计划" : "AI 计划"}
                      </strong>
                      <span>{planning.rationale}</span>
                    </div>
                  )}
                </div>
                <div className="chart-wrap">
                  {analysis.rows.length === 0 ? (
                    <div className="empty-state">没有满足最小样本阈值的结果。</div>
                  ) : analysis.chartType === "table" ? (
                    <div className="table-wrap">
                      <table className="result-table">
                        <thead>
                          <tr>
                            <th>分组</th>
                            <th>样本数</th>
                            <th>数值（{analysis.unit}）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.rows.map((row) => (
                            <tr key={row.dimension}>
                              <td>{row.dimension}</td>
                              <td>{row.sampleSize}</td>
                              <td>{row.value.toLocaleString("zh-CN")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <AnalysisChart
                      rows={analysis.rows}
                      chartType={analysis.chartType}
                      unit={analysis.unit}
                    />
                  )}
                </div>
                <details className="trace">
                  <summary>查看指标口径与只读查询</summary>
                  <pre>{`数据源：${analysis.datasetId}\n指标：${analysis.metricLabel}\n统计周期：${analysis.period}\n单位：${analysis.unit}\nSQL：${analysis.query}`}</pre>
                </details>
              </section>
            )}
          </section>
        </div>

        <p className="footer-note">
          当前版本用于 P0 垂直切片验证：固定指标 → 受控查询 →
          图表与溯源。自然语言问题、口径澄清和上传流程将在这条链路稳定后接入。
        </p>
      </div>
    </main>
  );
}
