"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisResultView, type AnalysisPlanning } from "@/components/analysis-result";
import { Icon } from "@/components/app-icons";
import { LearningOverview, type OverviewResults } from "@/components/learning-overview";
import { ProductBrand } from "@/components/product-brand";
import { LoginScreen } from "@/components/login-screen";
import { ThemeToggle, useTheme } from "@/components/ui/theme-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GOLDEN_CASES } from "@/lib/analysis/golden-cases";
import { createPlan } from "@/lib/analysis/plan";
import { METRICS } from "@/lib/analysis/metrics";
import {
  analysisDimensionLabel,
  analysisReportHtml,
  analysisSourceLabel,
  downloadAnalysisFile,
} from "@/lib/exports/analysis";
import type {
  AnalysisPlan,
  AnalysisResult,
  DataSource,
  DatasetProfile,
  Metric,
} from "@/lib/analysis/types";
import type { ChartViewType } from "@/lib/analysis/visualization";
import type { SessionUser } from "@/lib/client-types";

const AdminPanel = dynamic(
  () => import("@/components/admin-panel").then((module) => module.AdminPanel),
  {
    loading: () => (
      <div className="panel workbench-loading" role="status">
        正在打开系统管理…
      </div>
    ),
  },
);
type View = "overview" | "analysis" | "data" | "reports" | "admin" | "account";
type AnalysisMode = "metrics" | "question";
type AIStatus = { configured: boolean; enabled: boolean };
type SessionAnalysis = { key: string; result: AnalysisResult };
const analysisKey = (result: AnalysisResult) =>
  JSON.stringify([
    result.datasetId,
    result.metricLabel,
    result.dimensions ?? [result.dimension],
    result.query,
  ]);
const pageInfo: Record<View, { title: string; description: string }> = {
  overview: { title: "学习全景", description: "把分散的学习记录，变成清晰的教学线索。" },
  analysis: { title: "指标分析", description: "比较课程与学期表现，查看每个结论的统计依据。" },
  data: { title: "数据", description: "查看当前数据源、字段与可用范围。" },
  reports: { title: "本次分析", description: "预览和导出本次会话中的分析结果。" },
  admin: { title: "系统管理", description: "配置 AI 连接、使用预算与工作台账号。" },
  account: { title: "个人设置", description: "查看账号信息，管理登录密码。" },
};
const tableNames: Record<string, string> = {
  learning_activity: "学习活动记录",
  student_outcomes: "课程学习结果",
  students: "学生基本档案",
  student_residences: "学期住宿信息",
  leave_requests: "请假申请记录",
  attendance_weekly: "逐周出勤记录",
  assignment_submissions: "作业提交明细",
  student_term_summary: "学生学期汇总",
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

function ReportCenter({
  analyses,
  selectedKey,
  onSelect,
  onStart,
}: {
  analyses: SessionAnalysis[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onStart: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loadedHtml, setLoadedHtml] = useState("");
  const [printError, setPrintError] = useState("");
  const selected = analyses.find((entry) => entry.key === selectedKey) ?? analyses[0];
  const result = selected?.result;
  const { theme } = useTheme();
  const html = useMemo(() => (result ? analysisReportHtml(result, theme) : ""), [result, theme]);
  function printReport() {
    setPrintError("");
    try {
      const reportWindow = frame.current?.contentWindow;
      if (!reportWindow || loadedHtml !== html) return;
      reportWindow.focus();
      reportWindow.print();
    } catch {
      setPrintError("浏览器暂时无法打印预览。请下载 HTML 报告后打开，再使用浏览器打印。");
    }
  }
  if (!result)
    return (
      <section className="panel report-empty">
        <span className="feature-icon">
          <Icon name="file" size={26} />
        </span>
        <h2>先完成一次分析，再生成报告</h2>
        <p>报告会包含真实结论、分组数据、样本人数和计算说明。本次会话还没有可用的分析结果。</p>
        <button className="primary-button" onClick={onStart} type="button">
          开始分析
          <Icon name="arrow" size={16} />
        </button>
      </section>
    );
  return (
    <section className="panel report-workspace">
      <div className="report-controls">
        <div>
          <span className="section-kicker">ANALYSIS REPORT</span>
          <h2>本次会话的分析报告</h2>
          <p>从已完成的分析中选择一份预览；刷新页面或退出后会清空此列表。</p>
        </div>
        <label className="form-field" htmlFor="report-analysis">
          选择分析结果
          <select
            id="report-analysis"
            value={selected.key}
            onChange={(event) => onSelect(event.target.value)}
          >
            {analyses.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {analysisSourceLabel(entry.result)} · {entry.result.metricLabel} · 按
                {analysisDimensionLabel(entry.result)} · {entry.result.rows.length} 组
              </option>
            ))}
          </select>
        </label>
        <div className="report-actions">
          <button
            className="primary-button"
            disabled={loadedHtml !== html}
            onClick={printReport}
            type="button"
          >
            <Icon name="file" size={16} />
            打印 / 另存 PDF
          </button>
          <button
            className="secondary-button"
            onClick={() => downloadAnalysisFile(result, "html")}
            type="button"
          >
            <Icon name="download" size={16} />
            下载 HTML 报告
          </button>
          <button
            className="secondary-button"
            onClick={() => downloadAnalysisFile(result, "csv")}
            type="button"
          >
            <Icon name="download" size={16} />
            下载 CSV 数据
          </button>
        </div>
        <p className="report-help">
          点击打印后，在浏览器的打印窗口中选择“另存为 PDF”。HTML 报告可下载后独立打开。
        </p>
        {printError && (
          <p className="notice notice-error" role="alert">
            {printError}
          </p>
        )}
      </div>
      <iframe
        className="report-frame"
        ref={frame}
        sandbox="allow-same-origin allow-modals"
        srcDoc={html}
        title={`${result.metricLabel}分析报告预览`}
        onLoad={() => setLoadedHtml(html)}
      />
    </section>
  );
}

export function Workspace() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [bootError, setBootError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [mode, setMode] = useState<AnalysisMode>("metrics");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const drawerWasOpen = useRef(false);
  const [profiles, setProfiles] = useState<DatasetProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [datasetId, setDatasetId] = useState<DataSource>("demo");
  const [aiStatus, setAIStatus] = useState<AIStatus>({ configured: false, enabled: false });
  const [metric, setMetric] = useState<Metric>("score");
  const [dimension, setDimension] = useState<"course" | "term">("course");
  const [chartType, setChartType] = useState<ChartViewType>("bar");
  const [overview, setOverview] = useState<OverviewResults>({});
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AnalysisResult | null>(null);
  const [askChart, setAskChart] = useState<ChartViewType>("bar");
  const [planning, setPlanning] = useState<AnalysisPlanning | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [sessionAnalyses, setSessionAnalyses] = useState<SessionAnalysis[]>([]);
  const [selectedReportKey, setSelectedReportKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const generation = useRef(0);
  const askPending = useRef<AbortController | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === datasetId);
  const canRun = !profilesLoading && Boolean(selectedProfile?.available);
  const aiReady = aiStatus.configured && aiStatus.enabled;

  const rememberResult = useCallback((result: AnalysisResult) => {
    if (!result.rows.length) return;
    const key = analysisKey(result);
    setSessionAnalyses((previous) =>
      [{ key, result }, ...previous.filter((entry) => entry.key !== key)].slice(0, 20),
    );
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      askPending.current?.abort();
      askPending.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!sidebarOpen) {
      if (drawerWasOpen.current) {
        // Restore focus after React has removed inert from the background.
        const target = matchMedia("(min-width: 761px)").matches ? pageHeading : menuButton;
        target.current?.focus({ preventScroll: true });
      }
      drawerWasOpen.current = false;
      return;
    }
    drawerWasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setSidebarOpen(false);
        pageHeading.current?.focus({ preventScroll: true });
      }
    };
    desktop.addEventListener("change", closeOnDesktop);
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
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [sidebarOpen]);
  useEffect(() => {
    if (!user) return;
    pageHeading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [view, mode, user]);
  const expire = useCallback(() => {
    generation.current++;
    askPending.current?.abort();
    askPending.current = null;
    setUser(null);
    setProfiles([]);
    setOverview({});
    setAnalysis(null);
    setAskResult(null);
    setSessionAnalyses([]);
    setSelectedReportKey("");
    setPlanning(null);
    setQuestion("");
    setError(null);
    setAskLoading(false);
    setBrowseLoading(false);
    setSidebarOpen(false);
    setMode("metrics");
    setView("overview");
  }, []);
  const api = useCallback(
    async (url: string, options?: RequestInit) => {
      const current = generation.current;
      const response = await fetch(url, { ...options, cache: "no-store" });
      if (options?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
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
        if (!controller.signal.aborted) {
          setUser(payload.user);
          setSetupRequired(payload.setupRequired);
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setBootError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBootLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const current = generation.current;
    setProfilesLoading(true);
    api("/api/profile", { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted && current === generation.current)
          setProfiles(payload.datasets);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && current === generation.current)
          setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) setProfilesLoading(false);
      });
    return () => controller.abort();
  }, [user, api]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const current = generation.current;
    api("/api/ai/status", { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted && current === generation.current) setAIStatus(payload);
      })
      .catch(() => {
        if (!controller.signal.aborted && current === generation.current)
          setAIStatus({ configured: false, enabled: false });
      });
    return () => controller.abort();
  }, [user, view, datasetId, api]);
  useEffect(() => {
    if (!user || !canRun) return;
    const controller = new AbortController();
    const current = generation.current;
    setOverviewLoading(true);
    const metrics = ["score", "activity", "completion_rate"] as const;
    Promise.allSettled(
      metrics.map(async (value) => {
        const plan = createPlan({
          datasetId,
          metric: value,
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
        return { metric: value, result: payload.result as AnalysisResult };
      }),
    ).then((responses) => {
      if (controller.signal.aborted || current !== generation.current) return;
      const next: OverviewResults = {};
      for (const response of responses) {
        if (response.status === "fulfilled") {
          next[response.value.metric] = response.value.result;
          rememberResult(response.value.result);
        }
      }
      setOverview(next);
      setOverviewLoading(false);
      const failure = responses.find((response) => response.status === "rejected");
      if (failure?.status === "rejected")
        setError(
          `部分概览暂时无法显示：${failure.reason instanceof Error ? failure.reason.message : "请稍后重试。"}`,
        );
    });
    return () => controller.abort();
  }, [user, datasetId, canRun, api, rememberResult]);
  useEffect(() => {
    if (!user || view !== "analysis" || mode !== "metrics" || !canRun) return;
    const controller = new AbortController();
    const current = generation.current;
    setBrowseLoading(true);
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
        if (!controller.signal.aborted && current === generation.current) {
          setAnalysis(payload.result);
          rememberResult(payload.result);
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && current === generation.current)
          setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) setBrowseLoading(false);
      });
    return () => controller.abort();
  }, [user, view, mode, datasetId, metric, dimension, canRun, api, refreshCount, rememberResult]);

  function changeSource(value: DataSource) {
    generation.current++;
    askPending.current?.abort();
    askPending.current = null;
    setDatasetId(value);
    setOverview({});
    setOverviewLoading(true);
    setAnalysis(null);
    setAskResult(null);
    setPlanning(null);
    setAskLoading(false);
    setBrowseLoading(false);
    setError(null);
  }
  function navigate(next: View) {
    if (next !== "analysis") {
      askPending.current?.abort();
      askPending.current = null;
      setAskLoading(false);
    }
    setView(next);
    if (sidebarOpen) menuButton.current?.focus();
    setSidebarOpen(false);
    setError(null);
  }
  function changeMode(next: AnalysisMode) {
    askPending.current?.abort();
    askPending.current = null;
    setAskLoading(false);
    setBrowseLoading(false);
    setMode(next);
    setError(null);
  }
  function previewReport(result: AnalysisResult) {
    rememberResult(result);
    setSelectedReportKey(analysisKey(result));
    navigate("reports");
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      expire();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "退出失败，请重试。");
    }
  }
  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (trimmed.length < 2 || trimmed.length > 500) {
      setError("请写下 2–500 字的分析问题。");
      return;
    }
    if (!canRun) return;
    askPending.current?.abort();
    const controller = new AbortController();
    askPending.current = controller;
    setQuestion(nextQuestion);
    setAskLoading(true);
    setError(null);
    const current = generation.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      askPending.current === controller &&
      current === generation.current;
    try {
      const payload = (await api("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, datasetId }),
        signal: controller.signal,
      })) as { result: AnalysisResult; plan: AnalysisPlan; planning: AnalysisPlanning };
      if (!isCurrent()) return;
      setAskResult(payload.result);
      setAskChart(payload.plan.chartType);
      setPlanning(payload.planning);
      rememberResult(payload.result);
    } catch (requestError) {
      if (isCurrent())
        setError(requestError instanceof Error ? requestError.message : "分析失败，请稍后重试。");
    } finally {
      if (isCurrent()) {
        askPending.current = null;
        setAskLoading(false);
      }
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
  const currentPage =
    view === "analysis" && mode === "question"
      ? { title: "一句话分析", description: "用一个问题，探索学习数据中的教学线索。" }
      : pageInfo[view];
  const activeResult = mode === "metrics" ? analysis : askResult;
  const visibleResult = activeResult?.datasetId === datasetId ? activeResult : null;
  const loading = mode === "metrics" ? browseLoading : askLoading;
  const showDataset = view === "overview" || view === "analysis" || view === "data";
  const notice = error && (
    <div className="notice notice-error global-notice" role="alert">
      <Icon name="info" size={18} />
      <span>
        {error}
        {visibleResult && view === "analysis" && " 上次成功的结果仍可查看和导出。"}
      </span>
      <button
        type="button"
        aria-label="关闭提示"
        className="icon-button"
        onClick={() => setError(null)}
      >
        <Icon name="close" size={17} />
      </button>
    </div>
  );
  const navigation = (
    <nav className="workspace-nav" aria-label="主要功能">
      {(
        [
          ["overview", "学习全景"],
          ["analysis", "指标分析"],
          ["question", "一句话分析"],
          ["data", "数据"],
          ["reports", "分析报告"],
        ] as const
      ).map(([key, label]) => {
        const active =
          key === "question"
            ? view === "analysis" && mode === "question"
            : key === "analysis"
              ? view === "analysis" && mode === "metrics"
              : view === key;
        return (
          <button
            type="button"
            key={key}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (key === "question" || key === "analysis") {
                changeMode(key === "question" ? "question" : "metrics");
                navigate("analysis");
              } else navigate(key);
            }}
          >
            {key === "overview" && <Icon name="dashboard" size={16} />}
            <span>{label}</span>
            {key === "reports" && sessionAnalyses.length > 0 && (
              <small>{sessionAnalyses.length}</small>
            )}
          </button>
        );
      })}
    </nav>
  );
  const pageHeader = (
    <div className="page-introduction">
      <span className="page-eyebrow">
        {view === "overview" ? `你好，${user.displayName}` : "学习数据工作台"}
      </span>
      <h1 ref={pageHeading} tabIndex={-1} id="workspace-heading">
        {currentPage.title}
      </h1>
      <p>{currentPage.description}</p>
    </div>
  );
  const sourcePicker = showDataset && (
    <label className="workbench-source">
      <span>
        <Icon name="database" size={14} />
        当前数据源
      </span>
      <select
        aria-label="选择当前数据源"
        value={datasetId}
        disabled={profilesLoading}
        onChange={(event) => changeSource(event.target.value as DataSource)}
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
  );
  return (
    <div className="graphite-workspace workbench-shell" data-view={view}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="workbench-header" inert={sidebarOpen}>
        <div className="header-brand-group">
          <button
            type="button"
            className="workbench-menu icon-button"
            ref={menuButton}
            aria-label="打开导航"
            aria-expanded={sidebarOpen}
            aria-controls="workspace-navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <button type="button" className="workbench-brand" onClick={() => navigate("overview")}>
            <ProductBrand />
          </button>
        </div>
        <div className="desktop-navigation">{navigation}</div>
        <div className="topbar-actions">
          <ThemeToggle />
          {user.role === "admin" && (
            <button
              type="button"
              className="icon-button header-settings"
              aria-label="系统管理"
              onClick={() => navigate("admin")}
            >
              <Icon name="sliders" size={18} />
            </button>
          )}
          <button
            type="button"
            className="avatar topbar-avatar"
            aria-label="打开个人设置"
            onClick={() => navigate("account")}
          >
            {user.displayName.slice(0, 1)}
          </button>
          <button
            type="button"
            className="icon-button header-logout"
            aria-label="退出登录"
            onClick={() => void logout()}
          >
            <Icon name="logout" size={17} />
          </button>
        </div>
      </header>
      {sidebarOpen && (
        <button
          type="button"
          className="workbench-backdrop"
          aria-label="关闭导航"
          onClick={() => {
            setSidebarOpen(false);
            menuButton.current?.focus();
          }}
        />
      )}
      <aside
        id="workspace-navigation"
        ref={sidebar}
        className="workbench-drawer"
        hidden={!sidebarOpen}
        aria-label="工作台导航"
        role={sidebarOpen ? "dialog" : undefined}
        aria-modal={sidebarOpen || undefined}
      >
        <div className="drawer-heading">
          <strong>工作台导航</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭导航"
            onClick={() => {
              setSidebarOpen(false);
              menuButton.current?.focus();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {navigation}
        <div className="drawer-actions">
          {user.role === "admin" && (
            <button type="button" className="secondary-button" onClick={() => navigate("admin")}>
              <Icon name="settings" size={17} />
              系统管理
            </button>
          )}
          <button type="button" className="secondary-button" onClick={() => navigate("account")}>
            <Icon name="users" size={17} />
            个人设置
          </button>
          <button type="button" className="secondary-button" onClick={() => void logout()}>
            <Icon name="logout" size={17} />
            退出登录
          </button>
        </div>
      </aside>
      <div className="workbench-main" inert={sidebarOpen}>
        <main id="main-content" className="workbench-content" aria-labelledby="workspace-heading">
          {view !== "overview" && (
            <div className="workbench-page-heading">
              {pageHeader}
              {sourcePicker}
            </div>
          )}
          <div key={view} className="view-surface">
            {view !== "analysis" && notice}
            {view === "overview" && (
              <LearningOverview
                heading={pageHeader}
                sourceControl={sourcePicker}
                results={overview}
                loading={overviewLoading && canRun}
                profile={selectedProfile}
                canRun={canRun}
                onExplore={(nextMetric) => {
                  setMetric(nextMetric);
                  setDimension("course");
                  setChartType("bar");
                  changeMode("metrics");
                  navigate("analysis");
                }}
                onQuestion={(nextQuestion) => {
                  changeMode("question");
                  navigate("analysis");
                  if (nextQuestion) void ask(nextQuestion);
                }}
                onData={() => navigate("data")}
                onReport={previewReport}
              />
            )}
            {view === "analysis" && (
              <section
                className="panel analysis-workspace metric-scope"
                data-metric={mode === "metrics" ? metric : undefined}
                aria-label="学习分析工作区"
              >
                <div className="analysis-workspace-controls">
                  {mode === "metrics" ? (
                    <>
                      <div className="control-field metric-control">
                        <span>统计指标</span>
                        <SegmentedControl<Metric>
                          label="统计指标"
                          value={metric}
                          onChange={setMetric}
                          disabled={!canRun}
                          options={[
                            { value: "score", label: "平均成绩" },
                            { value: "activity", label: "活跃次数" },
                            { value: "completion_rate", label: "完成率" },
                          ]}
                        />
                      </div>
                      <label className="control-field dimension-control">
                        <span>比较维度</span>
                        <span className="dimension-select">
                          <select
                            aria-label="比较维度"
                            value={dimension}
                            onChange={(event) => {
                              const next = event.target.value as "course" | "term";
                              setDimension(next);
                              setChartType(next === "term" ? "line" : "bar");
                            }}
                            disabled={!canRun}
                          >
                            <option value="course">课程</option>
                            <option value="term">学期</option>
                          </select>
                          <Icon name="chevron" size={14} />
                        </span>
                      </label>
                      <button
                        type="button"
                        className="secondary-button analysis-refresh"
                        data-loading={loading || undefined}
                        aria-busy={loading}
                        disabled={!canRun || loading}
                        onClick={() => setRefreshCount((count) => count + 1)}
                      >
                        <span className="refresh-feedback" aria-hidden="true">
                          <Icon name="refresh" size={16} />
                          <span className="spinner" />
                        </span>
                        刷新结果
                      </button>
                      <p className="analysis-control-help">{metricCopy[metric]}</p>
                    </>
                  ) : (
                    <div className="question-controls disclosure-content">
                      <p className="analysis-availability question-availability">
                        <span className={aiReady ? "status-dot" : "status-dot is-muted"} />
                        {aiReady ? "自由提问已开启" : "推荐问题可直接使用"}
                      </p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void ask();
                        }}
                      >
                        <label className="control-field" htmlFor="analysis-question">
                          <span>分析问题</span>
                          <textarea
                            id="analysis-question"
                            name="analysis-question"
                            maxLength={500}
                            value={question}
                            placeholder="例如：哪门课程平均成绩最高？"
                            onChange={(event) => setQuestion(event.target.value)}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                !event.shiftKey &&
                                !event.nativeEvent.isComposing
                              ) {
                                event.preventDefault();
                                void ask();
                              }
                            }}
                          />
                        </label>
                        <div className="question-actions">
                          <span>{question.length}/500 · Enter 分析，Shift + Enter 换行</span>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={askLoading || !canRun || question.trim().length < 2}
                          >
                            {askLoading ? (
                              <span className="spinner" />
                            ) : (
                              <Icon name="sparkles" size={16} />
                            )}
                            {askLoading ? "正在分析…" : "开始分析"}
                          </button>
                        </div>
                      </form>
                      <div className="question-presets">
                        <span>推荐问题</span>
                        {[GOLDEN_CASES[0], GOLDEN_CASES[3], GOLDEN_CASES[6]].map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            disabled={askLoading || !canRun}
                            onClick={() => void ask(item.question)}
                          >
                            {item.question}
                          </button>
                        ))}
                      </div>
                      {!aiReady && (
                        <p className="analysis-control-help">
                          推荐问题无需连接 AI。自由提问需要管理员开启并配置 AI。
                          {user.role === "admin" && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => navigate("admin")}
                            >
                              去设置
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="analysis-notices">
                  {notice}
                  {!profilesLoading && !canRun && (
                    <div className="notice notice-warning" role="status">
                      当前数据源不可用，请选择其他数据源或联系管理员检查数据文件。
                    </div>
                  )}
                </div>
                <AnalysisResultView
                  result={visibleResult}
                  chartType={mode === "metrics" ? chartType : askChart}
                  onChartChange={mode === "metrics" ? setChartType : setAskChart}
                  loading={loading}
                  planning={mode === "question" ? planning : null}
                  onReport={previewReport}
                />
              </section>
            )}
            {view === "data" && (
              <section className="panel dataset-workspace">
                <div className="dataset-heading">
                  <span className="feature-icon">
                    <Icon name="database" size={22} />
                  </span>
                  <div>
                    <h2>{selectedProfile?.name ?? "正在读取数据…"}</h2>
                    <p>{selectedProfile?.description ?? "读取数据源信息后，可查看表格和字段。"}</p>
                  </div>
                  <span className={"badge " + (canRun ? "badge-success" : "badge-warning")}>
                    {profilesLoading ? "正在读取" : canRun ? "可用于分析" : "暂不可用"}
                  </span>
                </div>
                <div className="dataset-scope">
                  <span>
                    <strong>
                      {selectedProfile?.tables.filter((table) => table.status === "ready").length ??
                        0}
                    </strong>{" "}
                    张可用数据表
                  </span>
                  <span>只展示分组统计</span>
                  <span>指标口径随结果提供</span>
                </div>
                <DataSourceDetails profile={selectedProfile} />
                <div className="dataset-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!canRun}
                    onClick={() => navigate("analysis")}
                  >
                    开始分析
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              </section>
            )}
            {view === "reports" && (
              <ReportCenter
                analyses={sessionAnalyses}
                selectedKey={selectedReportKey}
                onSelect={setSelectedReportKey}
                onStart={() => navigate("analysis")}
              />
            )}
            {view === "admin" && user.role === "admin" && (
              <AdminPanel user={user} onSessionExpired={expire} />
            )}
            {view === "account" && <AccountPanel user={user} expire={expire} />}
          </div>
          <footer className="workbench-footer">
            <span>学析台 · 学习数据分析</span>
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
