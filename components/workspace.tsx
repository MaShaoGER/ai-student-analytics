"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisChart } from "@/components/analysis-chart";
import { AdminPanel } from "@/components/admin-panel";
import { Icon, type IconName } from "@/components/app-icons";
import { LoginScreen } from "@/components/login-screen";
import { GOLDEN_CASES } from "@/lib/analysis/golden-cases";
import { createPlan } from "@/lib/analysis/plan";
import { METRICS } from "@/lib/analysis/metrics";
import type {
  AnalysisPlan,
  AnalysisResult,
  ChartType,
  DataSource,
  DatasetProfile,
  Metric,
} from "@/lib/analysis/types";
import type { SessionUser } from "@/lib/client-types";

type View = "overview" | "browse" | "ask" | "reports" | "admin" | "account";
type Planning = { source: "golden_case" | "openai"; rationale: string };
type AIStatus = { configured: boolean; enabled: boolean };
type Overview = Partial<Record<Metric, AnalysisResult>>;
const pageInfo: Record<View, { title: string; description: string }> = {
  overview: { title: "数据概览", description: "从这里了解数据，找到下一步要分析的问题。" },
  browse: { title: "数据浏览", description: "选择想比较的内容，用图表和表格快速看清差异。" },
  ask: { title: "智能分析", description: "把想了解的问题写下来，让数据给出答案。" },
  reports: { title: "报告中心", description: "这里将汇集可分享、可下载的分析报告。" },
  admin: { title: "系统管理", description: "管理 AI 连接、使用预算和工作台账号。" },
  account: { title: "个人设置", description: "查看账号信息，管理你的登录密码。" },
};
const tableNames: Record<string, string> = {
  learning_activity: "学习活动记录",
  student_outcomes: "课程学习结果",
  studentInfo: "学生课程信息",
  studentVle: "学习资源访问记录",
  studentAssessment: "考核成绩记录",
  assessments: "课程考核信息",
  courses: "课程信息",
};
const metricCopy: Record<Metric, string> = {
  score: "比较不同课程或学期的平均成绩，了解整体表现。",
  activity: "比较学习资源的访问次数，了解学习活动情况。",
  completion_rate: "查看课程完成情况，比较不同分组的完成比例。",
};
const formatNumber = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

function FutureCard({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  action: string;
}) {
  return (
    <article className="future-card">
      <div className="future-heading">
        <span className="feature-icon">
          <Icon name={icon} />
        </span>
        <span className="badge badge-planned">即将支持</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="future-action" disabled type="button">
        {action}
        <Icon name="arrow" size={15} />
      </button>
    </article>
  );
}

function ResultTable({ rows, result }: { rows: AnalysisResult["rows"]; result: AnalysisResult }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="table-wrap">
      <table className="result-table">
        <caption>
          {result.metricLabel}按{result.dimension === "term" ? "学期" : "课程"}比较，单位：
          {result.unit}
        </caption>
        <thead>
          <tr>
            <th>{result.dimension === "term" ? "学期" : "课程"}</th>
            <th>
              {result.metricLabel}（{result.unit}）
            </th>
            <th>参与统计人数</th>
            <th className="table-bar-col">数值对比</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dimension}>
              <td>
                <span className="row-label">{row.dimension}</span>
              </td>
              <td className="numeric">{formatNumber(row.value)}</td>
              <td>{formatNumber(row.sampleSize)} 人</td>
              <td className="table-bar-col">
                <div className="table-bar">
                  <span style={{ width: `${Math.max(0, (row.value / max) * 100)}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultPanel({
  result,
  chartType,
  onChartChange,
  loading = false,
  searchable = false,
  planning,
}: {
  result: AnalysisResult | null;
  chartType: ChartType;
  onChartChange: (value: ChartType) => void;
  loading?: boolean;
  searchable?: boolean;
  planning?: Planning | null;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");
  useEffect(() => {
    setSearch("");
    setSort("default");
  }, [result]);
  const rows = useMemo(() => {
    const filtered =
      result?.rows.filter((row) =>
        row.dimension.toLowerCase().includes(search.trim().toLowerCase()),
      ) ?? [];
    if (sort === "highest")
      filtered.sort((a, b) => b.value - a.value || a.dimension.localeCompare(b.dimension));
    if (sort === "lowest")
      filtered.sort((a, b) => a.value - b.value || a.dimension.localeCompare(b.dimension));
    if (sort === "name") filtered.sort((a, b) => a.dimension.localeCompare(b.dimension));
    return filtered;
  }, [result, search, sort]);
  const highest = rows.reduce<(typeof rows)[number] | null>(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  const dimensionLabel = result?.dimension === "term" ? "学期" : "课程";
  const metricDefinition = Object.values(METRICS).find(
    (item) => item.label === result?.metricLabel,
  );
  return (
    <section className="panel results-panel" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <span className="section-kicker">ANALYSIS RESULT</span>
          <h2>{result ? `${result.metricLabel}对比` : "分析结果"}</h2>
          <p>
            {result
              ? `按${dimensionLabel}比较 · ${result.period}`
              : "选择一个问题，或者设置比较方式开始分析。"}
          </p>
        </div>
        <div className="segmented" aria-label="结果展示方式">
          {(
            [
              ["bar", "柱状图"],
              ["line", "折线图"],
              ["table", "表格"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={chartType === value}
              className={chartType === value ? "active" : ""}
              key={value}
              onClick={() => onChartChange(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="result-loading" role="status">
          <span className="spinner" />
          <strong>正在计算，请稍候</strong>
          <span>结果会在这里更新。</span>
        </div>
      ) : !result ? (
        <div className="result-empty">
          <span className="empty-icon">
            <Icon name="chart" size={32} />
          </span>
          <h3>准备好查看你的数据了吗？</h3>
          <p>开始分析后，结论、图表和数据会一起出现在这里。</p>
        </div>
      ) : (
        <>
          {searchable && (
            <div className="table-tools">
              <label className="search-field">
                <Icon name="search" size={17} />
                <input
                  aria-label={`搜索当前结果中的${dimensionLabel}`}
                  placeholder={`搜索当前结果中的${dimensionLabel}…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="sort-field">
                <span>排序</span>
                <select
                  aria-label="结果排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="default">分析默认顺序</option>
                  <option value="highest">数值从高到低</option>
                  <option value="lowest">数值从低到高</option>
                  <option value="name">分组名称</option>
                </select>
              </label>
              <span className="muted">
                {rows.length} / {result.rows.length} 个分组
              </span>
            </div>
          )}
          {highest && (
            <div className="insight-strip">
              <span className="insight-icon">
                <Icon name="sparkles" size={20} />
              </span>
              <div>
                <strong>
                  {highest.dimension} 的{result.metricLabel}最高，为 {formatNumber(highest.value)}{" "}
                  {result.unit}
                </strong>
                <p>
                  {search
                    ? "以上结论仅比较搜索后的可见分组。"
                    : `本次展示 ${rows.length} 个分组；人数少于 ${result.minSampleSize} 人的分组不展示。`}
                </p>
              </div>
              <span className="badge badge-teal">数据计算结果</span>
            </div>
          )}
          {rows.length === 0 ? (
            <div className="result-empty" role="status">
              <Icon name="search" size={28} />
              <h3>没有符合条件的结果</h3>
              <p>
                {search
                  ? "试试其他关键词，或清空搜索条件。"
                  : "请调整分析条件；人数过少的分组不会显示。"}
              </p>
              {search && (
                <button className="secondary-button" onClick={() => setSearch("")} type="button">
                  清空搜索
                </button>
              )}
            </div>
          ) : chartType === "table" ? (
            <ResultTable rows={rows} result={result} />
          ) : (
            <div className="chart-wrap">
              <AnalysisChart
                rows={rows}
                chartType={chartType}
                unit={result.unit}
                metricLabel={result.metricLabel}
                dimensionLabel={dimensionLabel}
              />
            </div>
          )}
          <div className="result-bottom">
            <span>
              <Icon name="database" size={14} />
              {result.datasetId === "demo" ? "模拟校园数据" : "OULAD 数据"}
            </span>
            <span>
              单位：{result.unit} · 每组至少 {result.minSampleSize} 人
            </span>
          </div>
          {chartType !== "table" && rows.length > 0 && (
            <details className="result-details">
              <summary>
                <Icon name="file" size={16} />
                查看对应数据表<span>核对图表数值</span>
              </summary>
              <ResultTable rows={rows} result={result} />
            </details>
          )}
          <details className="result-details technical-details">
            <summary>
              <Icon name="sliders" size={16} />
              计算说明与专业详情<span>指标定义、数据来源和 SQL</span>
            </summary>
            <div className="technical-content">
              <dl>
                <div>
                  <dt>统计指标</dt>
                  <dd>
                    {result.metricLabel}（{result.unit}）
                  </dd>
                </div>
                <div>
                  <dt>计算口径</dt>
                  <dd>{metricDefinition?.description}</dd>
                </div>
                <div>
                  <dt>标准指标公式</dt>
                  <dd>
                    <code>{metricDefinition?.formula}</code>
                  </dd>
                </div>
                <div>
                  <dt>统计范围</dt>
                  <dd>
                    {result.period} · 按{dimensionLabel}
                  </dd>
                </div>
                <div>
                  <dt>隐私与样本</dt>
                  <dd>
                    仅展示聚合结果，每组至少 {result.minSampleSize} 名学生；过滤{" "}
                    {result.filteredOutGroupCount} 个分组。
                  </dd>
                </div>
                <div>
                  <dt>查询用时</dt>
                  <dd>{result.durationMs} ms</dd>
                </div>
                {planning && (
                  <div>
                    <dt>分析方式</dt>
                    <dd>
                      {planning.source === "golden_case" ? "已验证的分析方式" : "AI 生成分析计划"} ·{" "}
                      {planning.rationale}
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

function DataSourceDetails({ profile }: { profile?: DatasetProfile }) {
  if (!profile) return null;
  return (
    <details className="panel source-details">
      <summary>
        <span className="feature-icon">
          <Icon name="database" size={19} />
        </span>
        <div>
          <strong>了解这份数据</strong>
          <p>{profile.name} · 数据表、字段和数据质量</p>
        </div>
        <Icon name="chevron" size={18} />
      </summary>
      <div className="source-details-body">
        <p className="muted">{profile.description}</p>
        <div className="source-tables">
          {profile.tables.map((table) => (
            <article key={table.name}>
              <div className="source-table-title">
                <strong>{tableNames[table.name] ?? table.name}</strong>
                <span
                  className={`badge ${table.status === "ready" ? "badge-teal" : "badge-planned"}`}
                >
                  {table.status === "ready" ? "可用" : "未导入"}
                </span>
              </div>
              <p>
                {table.rows === null ? "暂无统计" : `${formatNumber(table.rows)} 条记录`}
                {table.fields && ` · ${table.fields.length} 个字段`}
              </p>
              <details className="field-details">
                <summary>查看字段与专业说明</summary>
                <p>
                  表名：{table.name}
                  <br />
                  记录粒度：{table.grain}
                </p>
                {table.fields && (
                  <div className="table-wrap">
                    <table className="field-table">
                      <caption>字段质量</caption>
                      <thead>
                        <tr>
                          <th>字段</th>
                          <th>类型</th>
                          <th>缺失数量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.fields.map((field) => (
                          <tr key={field.name}>
                            <td>{field.name}</td>
                            <td>{field.type}</td>
                            <td>{field.missing}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </article>
          ))}
        </div>
        <p className="technical-note">来源：{profile.source}</p>
      </div>
    </details>
  );
}

function AccountPanel({ user, expire }: { user: SessionUser; expire: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setSaving(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        signal: controller.signal,
      });
      if (!active.current || controller.signal.aborted) return;
      if (response.status === 401) {
        expire();
        return;
      }
      const payload = await response.json();
      if (!active.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error ?? "密码修改失败。");
      expire();
    } catch (e) {
      if (active.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "密码修改失败。");
    } finally {
      if (active.current && !controller.signal.aborted) setSaving(false);
    }
  }
  return (
    <div className="account-grid">
      <section className="panel account-card">
        <span className="avatar avatar-large">{user.displayName.slice(0, 1)}</span>
        <h2>{user.displayName}</h2>
        <p>{user.username}</p>
        <span className="badge badge-teal">{user.role === "admin" ? "管理员" : "分析用户"}</span>
        <div className="account-note">
          <Icon name="shield" size={19} />
          <span>你的账号权限由管理员统一管理。</span>
        </div>
      </section>
      <section className="panel password-panel">
        <div className="section-heading">
          <div>
            <h2>修改登录密码</h2>
            <p>更新后需要重新登录。</p>
          </div>
          <Icon name="lock" size={22} />
        </div>
        <form onSubmit={submit} className="password-form">
          <label className="form-field" htmlFor="current-password">
            当前密码
            <input
              autoComplete="current-password"
              id="current-password"
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </label>
          <label className="form-field" htmlFor="new-password">
            新密码
            <input
              autoComplete="new-password"
              id="new-password"
              minLength={12}
              maxLength={128}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              type="password"
              value={newPassword}
            />
            <span className="form-help">至少 12 个字符，建议混合字母、数字和符号。</span>
          </label>
          <label className="form-field" htmlFor="confirm-password">
            再次输入新密码
            <input
              autoComplete="new-password"
              id="confirm-password"
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "正在更新…" : "更新密码"}
            <Icon name="arrow" size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}

export function Workspace() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [bootError, setBootError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const [profiles, setProfiles] = useState<DatasetProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [datasetId, setDatasetId] = useState<DataSource>("demo");
  const [aiStatus, setAIStatus] = useState<AIStatus>({ configured: false, enabled: false });
  const [overview, setOverview] = useState<Overview>({});
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewMetric, setOverviewMetric] = useState<Metric>("score");
  const [overviewChart, setOverviewChart] = useState<ChartType>("bar");
  const [metric, setMetric] = useState<Metric>("score");
  const [dimension, setDimension] = useState<"course" | "term">("course");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AnalysisResult | null>(null);
  const [askChart, setAskChart] = useState<ChartType>("bar");
  const [planning, setPlanning] = useState<Planning | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const generation = useRef(0);
  const selectedProfile = profiles.find((profile) => profile.id === datasetId);
  const canRun = !profilesLoading && Boolean(selectedProfile?.available);
  const aiReady = aiStatus.configured && aiStatus.enabled;
  useEffect(() => {
    if (!sidebarOpen) return;
    const controls = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled)") ?? [],
      );
    controls()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        menuButton.current?.focus();
      } else if (event.key === "Tab") {
        const elements = controls();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);
  const expire = useCallback(() => {
    generation.current++;
    setUser(null);
    setProfiles([]);
    setOverview({});
    setAnalysis(null);
    setAskResult(null);
    setPlanning(null);
    setQuestion("");
    setError(null);
    setAskLoading(false);
    setView("overview");
  }, []);
  const api = useCallback(
    async (url: string, options?: RequestInit) => {
      const current = generation.current;
      const response = await fetch(url, { ...options, cache: "no-store" });
      if (response.status === 401) {
        if (current === generation.current) expire();
        throw new Error("登录已过期，请重新登录。");
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "请求失败，请稍后重试。");
      return payload;
    },
    [expire],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("暂时无法连接工作台，请检查服务后重试。");
        const payload = await response.json();
        setUser(payload.user);
        setSetupRequired(payload.setupRequired);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setBootError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBootLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setProfilesLoading(true);
    api("/api/profile", { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setProfiles(payload.datasets);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfilesLoading(false);
      });
    return () => controller.abort();
  }, [user, api]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    api("/api/ai/status", { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setAIStatus(payload);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAIStatus({ configured: false, enabled: false });
      });
    return () => controller.abort();
  }, [user, view, api]);
  useEffect(() => {
    if (!user || profilesLoading) return;
    const controller = new AbortController();
    setOverview({});
    if (!canRun) {
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(true);
    const metrics: Metric[] = ["score", "activity", "completion_rate"];
    Promise.allSettled(
      metrics.map(async (currentMetric) => {
        const plan = createPlan({
          datasetId,
          metric: currentMetric,
          dimension: "course",
          chartType: "bar",
        });
        plan.limit = 100;
        const payload = await api("/api/analysis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(plan),
          signal: controller.signal,
        });
        return [currentMetric, payload.result] as const;
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next: Overview = {};
      results.forEach((result) => {
        if (result.status === "fulfilled") next[result.value[0]] = result.value[1];
      });
      setOverview(next);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected")
        setError(
          `部分概览暂时无法显示：${failure.reason instanceof Error ? failure.reason.message : "请稍后重试。"}`,
        );
      setOverviewLoading(false);
    });
    return () => controller.abort();
  }, [user, datasetId, canRun, profilesLoading, api, refreshCount]);
  useEffect(() => {
    if (!user || view !== "browse" || !canRun) return;
    const controller = new AbortController();
    setBrowseLoading(true);
    setAnalysis(null);
    setError(null);
    const plan = createPlan({
      datasetId,
      metric,
      dimension,
      chartType: dimension === "term" ? "line" : "bar",
    });
    plan.limit = 100;
    api("/api/analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan),
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) setAnalysis(payload.result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBrowseLoading(false);
      });
    return () => controller.abort();
  }, [user, view, datasetId, metric, dimension, canRun, api, refreshCount]);
  function changeSource(value: DataSource) {
    generation.current++;
    setDatasetId(value);
    setOverview({});
    setAnalysis(null);
    setAskResult(null);
    setPlanning(null);
    setAskLoading(false);
    setError(null);
  }
  function navigate(next: View) {
    setView(next);
    if (sidebarOpen) menuButton.current?.focus();
    setSidebarOpen(false);
    setError(null);
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      expire();
    } catch (e) {
      setError(e instanceof Error ? e.message : "退出失败，请重试。");
    }
  }
  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (trimmed.length < 2) {
      setError("请写下你想了解的问题，至少输入 2 个字。");
      return;
    }
    if (!canRun || askLoading) return;
    setQuestion(nextQuestion);
    setAskLoading(true);
    setError(null);
    setAskResult(null);
    setPlanning(null);
    const current = generation.current;
    try {
      const payload = (await api("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, datasetId }),
      })) as { result: AnalysisResult; plan: AnalysisPlan; planning: Planning };
      if (current !== generation.current) return;
      setAskResult(payload.result);
      setAskChart(payload.plan.chartType);
      setPlanning(payload.planning);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "分析失败，请稍后重试。");
    } finally {
      if (current === generation.current) setAskLoading(false);
    }
  }
  if (bootLoading)
    return (
      <main className="boot-screen">
        <span className="brand-symbol">
          <Icon name="chart" size={25} />
        </span>
        <span className="spinner" />
        <p>正在打开学析台…</p>
      </main>
    );
  if (bootError)
    return (
      <main className="boot-screen">
        <Icon name="info" size={32} />
        <h1>暂时无法打开工作台</h1>
        <p>{bootError}</p>
        <button className="primary-button" onClick={() => window.location.reload()} type="button">
          重新连接
        </button>
      </main>
    );
  if (!user)
    return (
      <LoginScreen
        setupRequired={setupRequired}
        onLogin={(nextUser) => {
          generation.current++;
          setUser(nextUser);
          setProfilesLoading(true);
          setBootError("");
        }}
      />
    );
  const score = overview.score;
  const highestScore = score?.rows.reduce<AnalysisResult["rows"][number] | null>(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  const completion = overview.completion_rate?.rows.reduce<AnalysisResult["rows"][number] | null>(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  const activity = overview.activity?.rows.reduce((sum, row) => sum + row.value, 0);
  const overviewResult =
    overview[overviewMetric]?.datasetId === datasetId ? overview[overviewMetric]! : null;
  const kpis = [
    {
      label: "最高课程均分",
      value: highestScore ? formatNumber(highestScore.value) : "—",
      unit: "分",
      note: highestScore ? `${highestScore.dimension} · 可见课程中的最高值` : "分析就绪后显示",
      icon: "book" as const,
      tone: "blue",
    },
    {
      label: "学习活动次数",
      value: activity === undefined ? "—" : formatNumber(activity),
      unit: "次",
      note: "当前可见课程的资源访问总次数",
      icon: "activity" as const,
      tone: "teal",
    },
    {
      label: "最高课程完成率",
      value: completion ? formatNumber(completion.value) : "—",
      unit: "%",
      note: completion ? `${completion.dimension} · 可见课程中的最高值` : "分析就绪后显示",
      icon: "check" as const,
      tone: "violet",
    },
    {
      label: "可见课程分组",
      value: score ? formatNumber(score.rows.length) : "—",
      unit: "组",
      note: "成绩分析中每组至少 3 名学生",
      icon: "users" as const,
      tone: "amber",
    },
  ];

  return (
    <div className="workspace">
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          onClick={() => {
            setSidebarOpen(false);
            menuButton.current?.focus();
          }}
          aria-label="关闭导航"
          type="button"
        />
      )}
      <aside
        id="workspace-navigation"
        ref={sidebar}
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
      >
        <a
          className="workspace-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-symbol">
            <Icon name="chart" size={24} />
          </span>
          <span>
            <strong>
              学析台<span className="brand-dot">.</span>
            </strong>
            <small>学习数据，看得明白</small>
          </span>
        </a>
        <div className="sidebar-label">我的工作台</div>
        <nav className="primary-nav" aria-label="工作台导航">
          {(
            [
              ["overview", "dashboard", "数据概览"],
              ["browse", "database", "数据浏览"],
              ["ask", "sparkles", "智能分析"],
              ["reports", "file", "报告中心"],
            ] as const
          ).map(([key, icon, label]) => (
            <button
              type="button"
              className={`nav-item ${view === key ? "active" : ""}`}
              aria-current={view === key ? "page" : undefined}
              key={key}
              onClick={() => navigate(key)}
            >
              <Icon name={icon} size={20} />
              <span>{label}</span>
              {key === "reports" ? (
                <small>规划中</small>
              ) : view === key ? (
                <span className="nav-active-dot" />
              ) : null}
            </button>
          ))}
        </nav>
        {user.role === "admin" && (
          <>
            <div className="sidebar-label management-label">管理空间</div>
            <button
              className={`nav-item ${view === "admin" ? "active" : ""}`}
              aria-current={view === "admin" ? "page" : undefined}
              onClick={() => navigate("admin")}
              type="button"
            >
              <Icon name="settings" size={20} />
              <span>系统管理</span>
              <span className="nav-admin-mark">
                <Icon name="shield" size={13} />
              </span>
            </button>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="sidebar-tip-icon">
              <Icon name="sparkles" size={20} />
            </span>
            <strong>让数据回答你的问题</strong>
            <p>从一个简单的问题开始，发现课程表现中的线索。</p>
            <button onClick={() => navigate("ask")} type="button">
              开始一次分析
              <Icon name="arrow" size={15} />
            </button>
          </div>
          <button
            className={`sidebar-account ${view === "account" ? "active" : ""}`}
            onClick={() => navigate("account")}
            type="button"
          >
            <span className="avatar">{user.displayName.slice(0, 1)}</span>
            <span>
              <strong>{user.displayName}</strong>
              <small>{user.role === "admin" ? "管理员" : "分析用户"}</small>
            </span>
            <Icon name="settings" size={17} />
          </button>
          <button className="logout-button" onClick={() => void logout()} type="button">
            <Icon name="logout" size={16} />
            退出登录
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              ref={menuButton}
              onClick={() => setSidebarOpen(true)}
              aria-label="打开导航"
              aria-expanded={sidebarOpen}
              aria-controls="workspace-navigation"
              type="button"
            >
              <Icon name="menu" size={22} />
            </button>
            <span>工作台</span>
            <Icon name="chevron" size={13} />
            <strong>{pageInfo[view].title}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-status ${aiReady ? "connected" : ""}`}>
              <span />
              {aiReady ? "AI 分析已开启" : "基础分析可用"}
            </span>
            <div className="topbar-divider" />
            <span className="topbar-user">
              {user.displayName}
              <span className="avatar avatar-small">{user.displayName.slice(0, 1)}</span>
            </span>
          </div>
        </header>
        <main className="workspace-content" id="main-content">
          <div className="page-heading">
            <div>
              <p className="page-eyebrow">
                {view === "overview" ? "一眼看清 · 从容分析" : "学析台 / 学习数据工作台"}
              </p>
              <h1>{view === "overview" ? "看清学习表现，找到教学线索" : pageInfo[view].title}</h1>
              <p>{pageInfo[view].description}</p>
            </div>
            {(["overview", "browse", "ask"] as View[]).includes(view) && (
              <label className="source-selector">
                <span>
                  <Icon name="database" size={16} />
                  当前数据
                </span>
                <select
                  aria-label="选择当前数据源"
                  value={datasetId}
                  disabled={profilesLoading}
                  onChange={(e) => changeSource(e.target.value as DataSource)}
                >
                  {profiles.length === 0 ? (
                    <option value="demo">{profilesLoading ? "正在读取…" : "暂无可用数据"}</option>
                  ) : (
                    profiles.map((profile) => (
                      <option key={profile.id} value={profile.id} disabled={!profile.available}>
                        {profile.name}
                        {!profile.available ? "（未导入）" : ""}
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
          </div>
          {error && (
            <div className="notice notice-error global-notice" role="alert">
              <Icon name="info" size={18} />
              <span>{error}</span>
              <button
                aria-label="关闭提示"
                className="icon-button"
                onClick={() => setError(null)}
                type="button"
              >
                <Icon name="close" size={17} />
              </button>
            </div>
          )}
          {!profilesLoading &&
            !canRun &&
            (["overview", "browse", "ask"] as View[]).includes(view) && (
              <div className="notice notice-warning" role="status">
                当前没有可用的数据源，请联系管理员检查数据文件。
              </div>
            )}
          {view === "overview" && (
            <>
              <section className="welcome-banner">
                <div>
                  <span className="banner-label">
                    <span />
                    你的数据分析空间
                  </span>
                  <h2>少一点翻找，多一点发现。</h2>
                  <p>
                    浏览课程表现，或直接问一个问题。
                    <br />
                    从数据到结果，每一步都清晰可见。
                  </p>
                  <button className="banner-button" onClick={() => navigate("ask")} type="button">
                    用一句话开始分析
                    <Icon name="arrow" size={17} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="art-orbit orbit-one" />
                  <div className="art-orbit orbit-two" />
                  <div className="art-dot dot-one" />
                  <div className="art-dot dot-two" />
                  <div className="art-card art-card-back">
                    <Icon name="database" size={24} />
                    <span className="art-line" />
                    <span className="art-line short" />
                  </div>
                  <div className="art-card art-card-front">
                    <div className="art-chart-title">
                      <span />
                      <span />
                    </div>
                    <div className="art-bars">
                      {[35, 62, 45, 80, 59, 93].map((height, index) => (
                        <i key={index} style={{ height: `${height}%` }} />
                      ))}
                    </div>
                    <div className="art-chart-baseline" />
                  </div>
                  <span className="art-check">
                    <Icon name="check" size={22} />
                  </span>
                </div>
              </section>
              <div className="overview-section-label">
                <h2>学习表现速览</h2>
                <span>
                  <span className="status-dot" />
                  真实计算 · 仅统计可见课程分组
                </span>
              </div>
              <section className="kpi-grid" aria-label="当前数据源的统计摘要">
                {kpis.map((kpi) => (
                  <article className="kpi-card" key={kpi.label}>
                    <div className="kpi-heading">
                      <span>{kpi.label}</span>
                      <span className={`kpi-icon ${kpi.tone}`}>
                        <Icon name={kpi.icon} size={19} />
                      </span>
                    </div>
                    <div className={`kpi-value ${overviewLoading ? "kpi-pending" : ""}`}>
                      {overviewLoading ? <span className="skeleton-value" /> : kpi.value}
                      <small>{kpi.unit}</small>
                    </div>
                    <p>{kpi.note}</p>
                  </article>
                ))}
              </section>
              <div className="overview-main-grid">
                <div>
                  <div className="overview-chart-tabs" aria-label="选择概览指标">
                    {(["score", "activity", "completion_rate"] as Metric[]).map((value) => (
                      <button
                        type="button"
                        aria-pressed={overviewMetric === value}
                        className={overviewMetric === value ? "active" : ""}
                        key={value}
                        onClick={() => {
                          setOverviewMetric(value);
                          setOverviewChart("bar");
                        }}
                      >
                        {METRICS[value].label}
                      </button>
                    ))}
                    <button
                      className="text-button"
                      onClick={() => navigate("browse")}
                      type="button"
                    >
                      详细浏览
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                  <ResultPanel
                    result={overviewResult}
                    loading={overviewLoading}
                    chartType={overviewChart}
                    onChartChange={setOverviewChart}
                  />
                </div>
                <aside className="overview-side">
                  <section className="panel quick-start">
                    <span className="section-kicker">QUICK START</span>
                    <h2>你想了解什么？</h2>
                    <p>选一个问题，马上查看结果。</p>
                    {[GOLDEN_CASES[0], GOLDEN_CASES[3], GOLDEN_CASES[6]].map((item, index) => (
                      <button
                        className="quick-question"
                        disabled={!canRun}
                        key={item.id}
                        onClick={() => {
                          navigate("ask");
                          void ask(item.question);
                        }}
                        type="button"
                      >
                        <span className={`quick-icon tone-${index}`}>
                          <Icon
                            name={index === 0 ? "book" : index === 1 ? "activity" : "check"}
                            size={18}
                          />
                        </span>
                        <span>{item.question}</span>
                        <Icon name="chevron" size={15} />
                      </button>
                    ))}
                    <div className="quick-note">
                      <Icon name="shield" size={15} />
                      以上问题无需连接 AI 即可分析
                    </div>
                  </section>
                  <section className="data-note">
                    <span className="feature-icon">
                      <Icon name="database" size={21} />
                    </span>
                    <h3>{selectedProfile?.name ?? "数据正在加载"}</h3>
                    <p>{selectedProfile?.description ?? "读取可用的数据源后，即可开始分析。"}</p>
                    <button
                      className="text-button"
                      onClick={() => navigate("browse")}
                      type="button"
                    >
                      查看数据详情
                      <Icon name="arrow" size={15} />
                    </button>
                  </section>
                </aside>
              </div>
              <div className="overview-section-label future-section-label">
                <h2>接下来，还能做更多</h2>
                <span>规划中的功能也在这里，后续逐步开放</span>
              </div>
              <section className="future-grid">
                <FutureCard
                  icon="upload"
                  title="导入自己的数据"
                  description="上传课程成绩和学习记录，让分析贴近你的实际教学场景。"
                  action="CSV / Excel 数据导入"
                />
                <FutureCard
                  icon="activity"
                  title="发现值得关注的变化"
                  description="自动检查成绩和课程完成情况，整理需要进一步了解的异常变化。"
                  action="查看异常提醒"
                />
                <FutureCard
                  icon="download"
                  title="把分析整理成报告"
                  description="将结论、图表和数据来源整理在一起，方便分享和留存。"
                  action="生成与导出报告"
                />
              </section>
            </>
          )}
          {view === "browse" && (
            <>
              <section className="panel browse-controls">
                <div className="browse-intro">
                  <span className="feature-icon">
                    <Icon name="sliders" size={22} />
                  </span>
                  <div>
                    <h2>想比较什么？</h2>
                    <p>修改选项后会自动更新结果，切换图表无需重新计算。</p>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={!canRun || browseLoading}
                    onClick={() => setRefreshCount((count) => count + 1)}
                    type="button"
                  >
                    <Icon name="refresh" size={16} />
                    刷新结果
                  </button>
                </div>
                <div className="control-grid">
                  <label className="form-field" htmlFor="browse-metric">
                    查看内容
                    <select
                      id="browse-metric"
                      aria-label="查看内容"
                      value={metric}
                      onChange={(e) => setMetric(e.target.value as Metric)}
                    >
                      {(["score", "activity", "completion_rate"] as Metric[]).map((value) => (
                        <option value={value} key={value}>
                          {METRICS[value].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field" htmlFor="browse-dimension">
                    按什么比较
                    <select
                      id="browse-dimension"
                      aria-label="按什么比较"
                      value={dimension}
                      onChange={(e) => {
                        const next = e.target.value as "course" | "term";
                        setDimension(next);
                        setChartType(next === "term" ? "line" : "bar");
                      }}
                    >
                      <option value="course">按课程</option>
                      <option value="term">按学期</option>
                    </select>
                  </label>
                  <div className="control-description">
                    <Icon name="info" size={17} />
                    <p>
                      {metricCopy[metric]}
                      <span>每组至少 3 人，最多展示 100 个分组。</span>
                    </p>
                  </div>
                </div>
              </section>
              <ResultPanel
                key={`${datasetId}-${metric}-${dimension}`}
                result={
                  analysis?.datasetId === datasetId &&
                  analysis.dimension === dimension &&
                  analysis.metricLabel === METRICS[metric].label
                    ? analysis
                    : null
                }
                loading={browseLoading}
                chartType={chartType}
                onChartChange={setChartType}
                searchable
              />
              <DataSourceDetails profile={selectedProfile} />
              <section className="planned-toolbar">
                <span className="feature-icon">
                  <Icon name="upload" size={20} />
                </span>
                <div>
                  <strong>更多数据操作</strong>
                  <p>导入文件、多条件筛选与数据导出将逐步开放。</p>
                </div>
                <span className="badge badge-planned">即将支持</span>
                <button className="secondary-button" disabled type="button">
                  <Icon name="upload" size={16} />
                  导入数据
                </button>
                <button className="secondary-button" disabled type="button">
                  <Icon name="download" size={16} />
                  导出数据
                </button>
              </section>
            </>
          )}
          {view === "ask" && (
            <>
              <section className="panel ask-composer">
                <div className="ask-heading">
                  <span className="ask-symbol">
                    <Icon name="sparkles" size={27} />
                  </span>
                  <div>
                    <h2>你想从数据中了解什么？</h2>
                    <p>比如“哪门课程平均成绩最高？”或“各学期完成率如何？”</p>
                  </div>
                  <span className={`badge ${aiReady ? "badge-teal" : "badge-neutral"}`}>
                    {aiReady ? "自由提问已开启" : "推荐问题可用"}
                  </span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask();
                  }}
                >
                  <label className="sr-only" htmlFor="analysis-question">
                    输入分析问题
                  </label>
                  <textarea
                    id="analysis-question"
                    maxLength={500}
                    placeholder="写下你的问题，让数据来回答…"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void ask();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <span>
                      <Icon name="database" size={15} />
                      {selectedProfile?.name ?? "暂无数据"}
                      <small>{question.length}/500</small>
                    </span>
                    <button
                      className="primary-button"
                      disabled={askLoading || !canRun || question.trim().length < 2}
                      type="submit"
                    >
                      <Icon name="sparkles" size={17} />
                      {askLoading ? "正在分析…" : "开始分析"}
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                </form>
                {!aiReady && (
                  <div className="ai-availability">
                    <Icon name="info" size={16} />
                    <span>
                      下面的推荐问题可以直接使用。自由提问需要管理员
                      {aiStatus.enabled ? "配置 AI 连接" : "开启并配置 AI"}。
                    </span>
                    {user.role === "admin" && (
                      <button
                        className="text-button"
                        onClick={() => navigate("admin")}
                        type="button"
                      >
                        去设置
                        <Icon name="arrow" size={14} />
                      </button>
                    )}
                  </div>
                )}
              </section>
              <div className="question-section-heading">
                <h2>没有头绪？从这些问题开始</h2>
                <span>每个问题都有经过验证的分析方式</span>
              </div>
              <div className="question-grid">
                {GOLDEN_CASES.slice(0, 9).map((item, index) => (
                  <button
                    className="question-card"
                    disabled={askLoading || !canRun}
                    key={item.id}
                    onClick={() => void ask(item.question)}
                    type="button"
                  >
                    <span className={`quick-icon tone-${Math.floor(index / 3)}`}>
                      <Icon
                        name={index < 3 ? "book" : index < 6 ? "activity" : "check"}
                        size={19}
                      />
                    </span>
                    <span>
                      {item.question}
                      <small>
                        {index < 3
                          ? "了解成绩表现"
                          : index < 6
                            ? "了解学习活动"
                            : "了解课程完成情况"}
                      </small>
                    </span>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
              <ResultPanel
                result={askResult?.datasetId === datasetId ? askResult : null}
                loading={askLoading}
                chartType={askChart}
                onChartChange={setAskChart}
                planning={planning}
              />
              <div className="planned-toolbar">
                <span className="feature-icon">
                  <Icon name="sparkles" size={20} />
                </span>
                <div>
                  <strong>连续追问与分析记录</strong>
                  <p>后续可继续追问，并回看之前的分析过程。</p>
                </div>
                <span className="badge badge-planned">即将支持</span>
              </div>
            </>
          )}
          {view === "reports" && (
            <>
              <section className="report-preview panel">
                <div className="report-preview-copy">
                  <span className="badge badge-planned">功能规划中</span>
                  <span className="section-kicker">FROM INSIGHT TO ACTION</span>
                  <h2>
                    让每次分析，
                    <br />
                    成为一份清晰的报告。
                  </h2>
                  <p>
                    这里将保存你的分析结论、图表和统计说明。
                    <br />
                    从一次探索，到一份可以分享的教学参考。
                  </p>
                  <div className="report-features">
                    <span>
                      <Icon name="check" size={16} />
                      完整结论与图表
                    </span>
                    <span>
                      <Icon name="check" size={16} />
                      数据来源与计算说明
                    </span>
                    <span>
                      <Icon name="check" size={16} />
                      PDF / 图片导出
                    </span>
                  </div>
                  <button className="primary-button" disabled type="button">
                    <Icon name="plus" size={17} />
                    创建分析报告
                  </button>
                  <button className="text-button" onClick={() => navigate("ask")} type="button">
                    先开始一次分析
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
                <div className="report-paper" aria-label="报告版式示意">
                  <span className="report-paper-label">报告版式示意</span>
                  <div className="paper-line paper-title" />
                  <div className="paper-line paper-subtitle" />
                  <div className="paper-divider" />
                  <div className="paper-summary">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="paper-chart">
                    {[42, 68, 53, 85, 64].map((height, i) => (
                      <span key={i} style={{ height: `${height}%` }} />
                    ))}
                  </div>
                  <div className="paper-line" />
                  <div className="paper-line" />
                  <div className="paper-line short" />
                  <div className="paper-bottom">
                    <Icon name="chart" size={17} />
                    <span>学析台 · 分析报告</span>
                  </div>
                </div>
              </section>
              <section className="future-grid">
                <FutureCard
                  icon="file"
                  title="分析报告库"
                  description="集中保存分析结果，按课程、学期或时间查找。"
                  action="查看报告"
                />
                <FutureCard
                  icon="sliders"
                  title="自定义报告内容"
                  description="选择要保留的图表和说明，组织适合你的报告。"
                  action="配置报告模板"
                />
                <FutureCard
                  icon="link"
                  title="分享与协作"
                  description="在权限范围内分享报告，让教学讨论有据可依。"
                  action="创建分享链接"
                />
              </section>
            </>
          )}
          {view === "admin" && user.role === "admin" && (
            <AdminPanel user={user} onSessionExpired={expire} />
          )}
          {view === "account" && <AccountPanel user={user} expire={expire} />}
          <footer className="workspace-footer">
            <span>
              <span className="footer-brand">学析台</span>让学习数据更容易理解
            </span>
            <span>
              <Icon name="shield" size={13} />
              只展示分组统计，保护个人信息
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
