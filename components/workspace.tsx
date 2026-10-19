"use client";

import { NavigationIndicator } from "@/components/ui/navigation-indicator";
import { MotionToggle } from "@/components/ui/motion-preferences";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnalysisResultView } from "@/components/analysis-result";
import { Icon } from "@/components/app-icons";
import { LearningOverview, type OverviewResults } from "@/components/learning-overview";
import { LoginScreen } from "@/components/login-screen";
import { ThemeToggle, useTheme } from "@/components/ui/theme-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ScoreDistribution } from "@/components/score-distribution";
import { ConversationWorkspace, type ConversationTurn } from "@/components/ai-conversation";
import {
  artifactWithView,
  intentWithView,
  type ChatDisplayView,
  type AnalysisStep,
  type ChatIntent,
  type ChatResponse,
} from "@/lib/ai/chat-types";
import { readChatStream } from "@/lib/ai/chat-stream";
import { createPlan } from "@/lib/analysis/plan";
import { METRICS } from "@/lib/analysis/metrics";
import { describeChatContext } from "@/lib/ai/context-label";
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

const CourseRelations = dynamic(
  () => import("@/components/course-relations").then((module) => module.CourseRelations),
  {
    loading: () => (
      <div className="workbench-loading" role="status">
        正在打开学科关联…
      </div>
    ),
  },
);

const CoursePanorama = dynamic(
  () => import("@/components/course-panorama").then((module) => module.CoursePanorama),
  {
    loading: () => (
      <div className="workbench-loading" role="status">
        正在打开学科全景…
      </div>
    ),
  },
);

const ChartStudio = dynamic(
  () => import("@/components/chart-studio").then((module) => module.ChartStudio),
  {
    loading: () => (
      <div className="workbench-loading" role="status">
        正在打开图表工坊…
      </div>
    ),
  },
);

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
type AIStatus = { configured: boolean; enabled: boolean; model: string | null };
type SessionAnalysis = { key: string; result: AnalysisResult };
type FailedAsk = { question: string; code: string | null; retryable: boolean };
/** Mirrors `isRetryableErrorCode` in lib/analysis/http-errors.ts; the server sends
 *  `retryable` itself, this set only covers an older server response. */
const RETRYABLE_CODES = new Set([
  "DATA_SOURCE_UNAVAILABLE",
  "AI_PROVIDER_OVERLOADED",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_UNAVAILABLE",
  "RATE_LIMIT_EXCEEDED",
  "ANALYSIS_FAILED",
  "TIMEOUT",
  "AI_PLANNING_FAILED",
]);
const DATA_SOURCE_UNAVAILABLE_MESSAGE =
  "当前数据源读取失败，请换一个数据源，或联系管理员检查数据文件。";
const STOPPED_MESSAGE = "已停止本轮回复，问题已保留，可直接重发。";
const analysisKey = (result: AnalysisResult) =>
  JSON.stringify([
    result.datasetId,
    result.metricLabel,
    result.dimensions ?? [result.dimension],
    result.query,
  ]);
const NETWORK_ERROR_MESSAGE = "网络连接失败，请检查网络后重试。";

/** Carries the server's code/retryable/Retry-After out of `api()` so the notice
 *  can offer a retry instead of a dead end. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly retryable: boolean,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
function retryAfterSeconds(headers: Headers): number | null {
  const header = headers.get("retry-after");
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const at = Date.parse(header);
  if (Number.isFinite(at)) {
    const delta = Math.ceil((at - Date.now()) / 1000);
    return delta > 0 ? delta : null;
  }
  return null;
}
/** Keep fetch noise out of Chinese notices: cancellation stays silent, server
 *  messages pass through, and network failures get one actionable sentence. */
function requestMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return "";
  if (error instanceof TypeError) return NETWORK_ERROR_MESSAGE;
  return error instanceof Error && error.message ? error.message : fallback;
}
const pageInfo: Record<View, { title: string; description: string }> = {
  overview: { title: "学习全景", description: "把分散的学习记录，变成清晰的教学线索。" },
  analysis: { title: "指标分析", description: "比较课程与学期表现，查看每个结论的统计依据。" },
  data: { title: "数据", description: "查看当前数据源、字段与可用范围。" },
  reports: { title: "本次分析", description: "预览和导出本次会话中的分析结果。" },
  admin: { title: "系统管理", description: "配置 AI 连接、使用预算与工作台账号。" },
  account: { title: "设置", description: "查看账号信息，管理登录密码与工作台偏好。" },
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
  score: "在关联全景中联动查看同一人群，或切换成绩分布、均分对比与学科关联。",
  activity: "比较学习资源的访问次数，了解学习活动情况。",
  completion_rate: "查看课程完成情况，比较不同分组的完成比例。",
};
const formatNumber = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

function DataSourceDetails({ profile }: { profile?: DatasetProfile }) {
  if (!profile) return null;
  return (
    <details
      className="panel source-details"
      data-enter="panel"
      style={{ "--enter-delay": "220ms" } as CSSProperties}
    >
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
        setError(requestMessage(e, "密码修改失败。"));
    } finally {
      if (active.current && !controller.signal.aborted) setSaving(false);
    }
  }
  return (
    <div
      className="account-grid"
      data-enter-group="rise"
      style={{ "--enter-group-delay": "80ms" } as CSSProperties}
    >
      <section className="panel account-card">
        <span className="avatar avatar-large">{user.displayName.slice(0, 1)}</span>
        <h2>{user.displayName}</h2>
        <p>{user.username}</p>
        <span className="badge badge-teal">{user.role === "admin" ? "管理员" : "分析用户"}</span>
        <div className="account-note">
          <Icon name="shield" size={19} />
          <span>你的账号权限由管理员统一管理。</span>
        </div>
        <div className="account-appearance">
          <h3>外观与动效</h3>
          <ThemeToggle />
          <MotionToggle />
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
      <section
        className="panel report-empty"
        data-enter="rise"
        style={{ "--enter-delay": "80ms" } as CSSProperties}
      >
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
    <section
      className="panel report-workspace"
      data-enter="panel"
      style={{ "--enter-delay": "80ms" } as CSSProperties}
    >
      <div
        className="report-controls"
        data-enter-group="rise"
        style={{ "--enter-group-delay": "60ms" } as CSSProperties}
      >
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
        data-enter="fade"
        style={{ "--enter-delay": "280ms" } as CSSProperties}
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
  const sidebar = useRef<HTMLElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const logoutDialog = useRef<HTMLDialogElement>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [profiles, setProfiles] = useState<DatasetProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [datasetId, setDatasetId] = useState<DataSource>("demo");
  const [aiStatus, setAIStatus] = useState<AIStatus>({
    configured: false,
    enabled: false,
    model: null,
  });
  // AI availability is deployment-wide, so it is fetched once per session. Only
  // leaving system management can change it, which refreshes the check once.
  const [aiStatusRefresh, setAiStatusRefresh] = useState(0);
  const previousView = useRef<View | null>(null);
  const [metric, setMetric] = useState<Metric>("score");
  const [scoreView, setScoreView] = useState<
    "panorama" | "distribution" | "comparison" | "relations"
  >("panorama");
  const [analysisView, setAnalysisView] = useState<"standard" | "studio">("standard");
  const [dimension, setDimension] = useState<"course" | "term">("course");
  const [chartType, setChartType] = useState<ChartViewType>("bar");
  const [overview, setOverview] = useState<OverviewResults>({});
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AnalysisResult | null>(null);
  const [chatMessages, setChatMessages] = useState<ConversationTurn[]>([]);
  const [chatContext, setChatContext] = useState<ChatIntent | null>(null);
  const [expandedChartId, setExpandedChartId] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [pendingSteps, setPendingSteps] = useState<AnalysisStep[]>([]);
  const [sessionAnalyses, setSessionAnalyses] = useState<SessionAnalysis[]>([]);
  const [selectedReportKey, setSelectedReportKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [failedAsk, setFailedAsk] = useState<FailedAsk | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const generation = useRef(0);
  const askPending = useRef<AbortController | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === datasetId);
  const canRun = !profilesLoading && Boolean(selectedProfile?.available);
  const aiReady = aiStatus.configured && aiStatus.enabled;
  const showDistribution = mode === "metrics" && metric === "score" && scoreView === "distribution";
  const showRelations = mode === "metrics" && metric === "score" && scoreView === "relations";
  const showPanorama = mode === "metrics" && metric === "score" && scoreView === "panorama";
  const showChartStudio = mode === "metrics" && analysisView === "studio";
  const showSpecialScore = showDistribution || showRelations || showPanorama || showChartStudio;

  const rememberResult = useCallback((result: AnalysisResult) => {
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
    setChatMessages([]);
    setPendingSteps([]);
    setChatContext(null);
    setExpandedChartId(null);
    setQuestion("");
    setError(null);
    setInputError(null);
    setFailedAsk(null);
    setAskLoading(false);
    setBrowseLoading(false);
    sidebar.current?.hidePopover();
    logoutDialog.current?.close();
    setSidebarOpen(false);
    setMode("metrics");
    setView("overview");
  }, []);
  const api = useCallback(
    async (url: string, options?: RequestInit, onStep?: (step: AnalysisStep) => void) => {
      const current = generation.current;
      let response: Response;
      try {
        response = await fetch(url, { ...options, cache: "no-store" });
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError")
          throw requestError;
        if (requestError instanceof TypeError) throw new Error(NETWORK_ERROR_MESSAGE);
        throw requestError;
      }
      if (options?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (response.status === 401) {
        if (current === generation.current) {
          setLoginNotice("登录已过期，请重新登录。");
          expire();
        }
        throw new ApiError("登录已过期，请重新登录。", "UNAUTHORIZED", false, 401, null);
      }
      if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
        try {
          return await readChatStream(response, onStep ?? (() => {}));
        } catch (error) {
          if (options?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
          const failure = error as Error & { code?: string; retryable?: boolean };
          throw new ApiError(
            failure.message || "分析连接中断，请重试。",
            failure.code ?? null,
            failure.retryable ?? true,
            502,
            null,
          );
        }
      }
      const retryAfter = retryAfterSeconds(response.headers);
      // Response shapes differ per route, so the payload stays untyped here and
      // every caller narrows what it asked for.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = await response.json().catch(() => null);
      // A measured empty result still carries scope/privacy metadata for reports.
      // Keep the API's 422/NO_DATA contract while allowing this screen to render it.
      const emptyAnalysis =
        url === "/api/analysis" &&
        response.status === 422 &&
        payload?.code === "NO_DATA" &&
        payload?.plan &&
        Array.isArray(payload?.result?.rows) &&
        payload.result.rows.length === 0 &&
        typeof payload.result.period === "string";
      if (!response.ok && !emptyAnalysis) {
        const code = typeof payload?.code === "string" ? payload.code : null;
        const retryable =
          typeof payload?.retryable === "boolean"
            ? payload.retryable
            : code
              ? RETRYABLE_CODES.has(code)
              : response.status >= 500;
        const serverMessage = typeof payload?.error === "string" ? payload.error : null;
        let message =
          code === "DATA_SOURCE_UNAVAILABLE"
            ? DATA_SOURCE_UNAVAILABLE_MESSAGE
            : (serverMessage ?? "请求失败，请稍后重试。");
        if (response.status === 429 && retryAfter)
          message = `${message}（请约 ${retryAfter} 秒后再试）`;
        throw new ApiError(message, code, retryable, response.status, retryAfter);
      }
      if (payload === null)
        throw new ApiError("返回数据格式异常，请稍后重试。", null, true, response.status, null);
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
        if (!controller.signal.aborted)
          setBootError(requestMessage(requestError, "暂时无法连接工作台，请检查服务后重试。"));
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
          setError(requestMessage(requestError, "请求失败，请稍后重试。"));
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
        if (!controller.signal.aborted && current === generation.current)
          setAIStatus({
            configured: Boolean(payload.configured),
            enabled: Boolean(payload.enabled),
            model: typeof payload.model === "string" && payload.model ? payload.model : null,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted && current === generation.current)
          setAIStatus({ configured: false, enabled: false, model: null });
      });
    return () => controller.abort();
  }, [user, api, aiStatusRefresh]);
  useEffect(() => {
    const previous = previousView.current;
    previousView.current = view;
    if (previous === "admin" && view !== "admin") setAiStatusRefresh((count) => count + 1);
  }, [view]);
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
          `部分概览暂时无法显示：${requestMessage(failure.reason, "请稍后重试。") || "请稍后重试。"}`,
        );
    });
    return () => controller.abort();
  }, [user, datasetId, canRun, api, rememberResult]);
  useEffect(() => {
    if (!user || view !== "analysis" || mode !== "metrics" || !canRun || showSpecialScore) {
      setBrowseLoading(false);
      return;
    }
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
          setError(requestMessage(requestError, "请求失败，请稍后重试。"));
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) setBrowseLoading(false);
      });
    return () => controller.abort();
  }, [
    user,
    view,
    mode,
    datasetId,
    metric,
    dimension,
    canRun,
    api,
    refreshCount,
    rememberResult,
    showSpecialScore,
  ]);

  function changeSource(value: DataSource) {
    generation.current++;
    askPending.current?.abort();
    askPending.current = null;
    setDatasetId(value);
    setOverview({});
    setOverviewLoading(true);
    setAnalysis(null);
    setAskResult(null);
    setChatMessages([]);
    setPendingSteps([]);
    setChatContext(null);
    setExpandedChartId(null);
    setAskLoading(false);
    setBrowseLoading(false);
    setError(null);
    setInputError(null);
    setFailedAsk(null);
  }
  function navigate(next: View) {
    delete document.documentElement.dataset.motionReplayGuard;
    if (next !== "analysis") {
      askPending.current?.abort();
      askPending.current = null;
      setAskLoading(false);
    }
    setView(next);
    sidebar.current?.hidePopover();
    setError(null);
  }
  function changeMode(next: AnalysisMode) {
    delete document.documentElement.dataset.motionReplayGuard;
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
  function requestLogout() {
    sidebar.current?.hidePopover();
    setLogoutError("");
    logoutDialog.current?.showModal();
  }
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await api("/api/auth/logout", { method: "POST" });
      expire();
    } catch (requestError) {
      setLogoutError(requestMessage(requestError, "退出失败，请重试。"));
    } finally {
      setLoggingOut(false);
    }
  }
  async function ask(nextQuestion = question, options: { fresh?: boolean } = {}) {
    const trimmed = nextQuestion.trim();
    if (trimmed.length < 2 || trimmed.length > 500) {
      const message = "请写下 2–500 字的分析问题。";
      setError(message);
      setInputError(message);
      return;
    }
    if ((!canRun && !aiReady) || askPending.current) return;
    // Entry points outside the transcript (home cards) start a fresh
    // conversation instead of inheriting an unrelated earlier scope.
    if (options.fresh) {
      setChatMessages([]);
      setChatContext(null);
      setExpandedChartId(null);
      setPendingSteps([]);
      setAskResult(null);
    }
    const controller = new AbortController();
    askPending.current = controller;
    setQuestion(nextQuestion);
    setPendingQuestion(trimmed);
    setAskLoading(true);
    setPendingSteps([]);
    setError(null);
    setInputError(null);
    setFailedAsk(null);
    const current = generation.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      askPending.current === controller &&
      current === generation.current;
    try {
      const payload = (await api(
        "/api/chat",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            question: trimmed,
            datasetId,
            // Assistant turns carry a compact summary of the results they produced
            // so a follow-up keeps "相关结果与条件" without replaying full artifacts.
            // User turns stay plain, and empty result lists are omitted entirely.
            history: (options.fresh ? [] : chatMessages)
              .filter((message) => !message.system)
              .slice(-12)
              .map((message) => {
                const results =
                  message.role === "assistant"
                    ? (message.response?.resultRefs ?? []).slice(0, 4).map((ref) => ({
                        resultId: ref.resultId,
                        kind: ref.kind,
                        label: ref.scopeLabel,
                      }))
                    : [];
                return {
                  role: message.role,
                  // The request schema bounds history content; a long multi-result
                  // answer must not make the next turn fail with 400.
                  content:
                    message.content.length > 2900
                      ? `${message.content.slice(0, 2890)}…（已截断）`
                      : message.content,
                  ...(results.length ? { results } : {}),
                };
              }),
            context: options.fresh ? null : chatContext,
          }),
          signal: controller.signal,
        },
        (step) => {
          if (isCurrent())
            setPendingSteps((previous) => {
              const index = previous.findIndex((item) => item.id === step.id);
              return index < 0
                ? [...previous, step]
                : previous.map((item) => (item.id === step.id ? step : item));
            });
        },
      )) as ChatResponse;
      if (!isCurrent()) return;
      setPendingSteps([]);
      setChatContext(payload.context);
      const turnId = crypto.randomUUID();
      setChatMessages((previous) =>
        [
          ...(options.fresh ? [] : previous),
          { id: `${turnId}-user`, role: "user" as const, content: trimmed },
          { id: turnId, role: "assistant" as const, content: payload.answer, response: payload },
        ].slice(-40),
      );
      setQuestion((draft) => (draft === nextQuestion ? "" : draft));
      if (payload.artifact) {
        if (payload.presentation !== "text")
          setExpandedChartId(payload.artifacts?.length ? `${turnId}:0` : turnId);
        if (payload.artifact.kind === "analysis") {
          setAskResult(payload.artifact.result);
          rememberResult(payload.artifact.result);
        }
      }
    } catch (requestError) {
      if (!isCurrent()) return;
      const message = requestMessage(requestError, "分析失败，请稍后重试。");
      // Cancellation is silent: the stop button reports its own outcome.
      if (!message) return;
      setError(message);
      setPendingSteps((previous) =>
        previous.map((step) => (step.status === "running" ? { ...step, status: "failed" } : step)),
      );
      setFailedAsk({
        question: trimmed,
        code: requestError instanceof ApiError ? requestError.code : null,
        retryable:
          requestError instanceof ApiError
            ? requestError.retryable
            : requestError instanceof TypeError,
      });
    } finally {
      if (isCurrent()) {
        askPending.current = null;
        setAskLoading(false);
      }
    }
  }
  function changeChatView(id: string, chart: ChatDisplayView, artifactIndex = 0) {
    const selected = chatMessages.find((message) => message.id === id);
    const artifact = selected?.response?.artifacts?.[artifactIndex] ?? selected?.response?.artifact;
    if (!artifact) return;
    const updated = artifactWithView(artifact, chart);
    setChatMessages((previous) =>
      previous.map((message) =>
        message.id === id && message.response
          ? {
              ...message,
              response: {
                ...message.response,
                artifact: artifactIndex === 0 ? updated : message.response.artifact,
                ...(message.response.artifacts
                  ? {
                      artifacts: message.response.artifacts.map((item, index) =>
                        index === artifactIndex ? updated : item,
                      ),
                    }
                  : {}),
              },
            }
          : message,
      ),
    );
    const latestArtifact = [...chatMessages]
      .reverse()
      .find((message) => message.response?.artifact);
    const contextArtifactIndex = (selected?.response?.artifacts?.length ?? 1) - 1;
    if (latestArtifact?.id === id && chatContext && artifactIndex === contextArtifactIndex)
      setChatContext(intentWithView(chatContext, chart));
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
        notice={loginNotice}
        onLogin={(nextUser) => {
          generation.current++;
          setUser(nextUser);
          setProfilesLoading(true);
          setBootError("");
          setLoginNotice(null);
        }}
      />
    );
  const currentPage =
    view === "analysis" && mode === "question"
      ? { title: "一句话分析", description: "连续提问、核对数据，把教学线索追问清楚。" }
      : pageInfo[view];
  const activeResult = mode === "metrics" ? analysis : askResult;
  const visibleResult = activeResult?.datasetId === datasetId ? activeResult : null;
  const loading = mode === "metrics" ? browseLoading : askLoading;
  const showDataset = view === "overview" || view === "analysis" || view === "data";
  const retryableAsk =
    failedAsk && failedAsk.retryable && view === "analysis" && mode === "question"
      ? failedAsk
      : null;
  const notice = error && (
    <div className="notice notice-error global-notice" role="alert" data-enter="fade">
      <Icon name="info" size={18} />
      <span>
        {error}
        {visibleResult && view === "analysis" && " 上次成功的结果仍可查看和导出。"}
      </span>
      {retryableAsk && (
        <button
          type="button"
          className="text-button"
          disabled={askLoading}
          onClick={() => {
            setError(null);
            setFailedAsk(null);
            void ask(retryableAsk.question);
          }}
        >
          重试这次提问
        </button>
      )}
      <button
        type="button"
        aria-label="关闭提示"
        className="icon-button"
        onClick={() => {
          setError(null);
          setFailedAsk(null);
        }}
      >
        <Icon name="close" size={17} />
      </button>
    </div>
  );
  const navigation = (
    <nav className="workspace-nav" aria-label="主要功能">
      <NavigationIndicator activeKey={`${view}-${mode}`} />
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
    <div className="page-introduction" key={`header-${view}-${mode}`}>
      <span className="page-eyebrow" data-enter="wipe">
        {view === "overview" ? "01 / LEARNING OVERVIEW" : "学析台 / LEARNING WORKSPACE"}
      </span>
      <h1
        ref={pageHeading}
        tabIndex={-1}
        id="workspace-heading"
        data-enter="rise"
        style={{ "--enter-delay": "70ms" } as CSSProperties}
      >
        {view === "overview" ? (
          <>
            学习，
            <br />
            有迹可循。
          </>
        ) : (
          currentPage.title
        )}
      </h1>
      <p data-enter="rise-sm" style={{ "--enter-delay": "180ms" } as CSSProperties}>
        {currentPage.description}
      </p>
    </div>
  );
  const sourcePicker = showDataset && (
    <label
      className="workbench-source"
      key={`source-${view}-${mode}`}
      data-enter="rise-sm"
      style={{ "--enter-delay": "240ms" } as CSSProperties}
    >
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
    <div
      className="graphite-workspace workbench-shell"
      data-view={view}
      data-conversation={(view === "analysis" && mode === "question") || undefined}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside
        className="instrument-rail"
        aria-label="工作台工具"
        data-enter="slide-left"
        style={{ "--enter-dur": "620ms" } as CSSProperties}
      >
        <div className="rail-content">
          <button
            type="button"
            className="rail-brand"
            aria-label="返回学习全景"
            onClick={() => navigate("overview")}
          >
            <span className="instrument-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </button>
          <button
            type="button"
            className="rail-menu icon-button"
            aria-label={sidebarOpen ? "收起导航" : "打开导航"}
            aria-expanded={sidebarOpen}
            aria-controls="workspace-navigation"
            popoverTarget="workspace-navigation"
          >
            <Icon name="menu" size={20} />
          </button>
          <span className="rail-wordmark" aria-hidden="true">
            LEARNING INTELLIGENCE
          </span>
          <div className="rail-actions">
            <ThemeToggle compact />
            <button
              type="button"
              className="icon-button"
              aria-label="打开设置"
              title="设置"
              onClick={() => navigate(user.role === "admin" ? "admin" : "account")}
            >
              <Icon name="settings" size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="退出登录"
              title="退出登录"
              onClick={requestLogout}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
          <span className="rail-hatch" aria-hidden="true" />
        </div>
      </aside>
      <header
        className="workbench-header"
        data-enter="fade"
        style={{ "--enter-delay": "60ms" } as CSSProperties}
      >
        <div className="desktop-navigation">{navigation}</div>
        <span className="mobile-workspace-title">
          学析台<small>{currentPage.title}</small>
        </span>
      </header>
      <aside
        id="workspace-navigation"
        ref={sidebar}
        className="workbench-drawer"
        popover="auto"
        onToggle={(event) => setSidebarOpen(event.newState === "open")}
        aria-label="工作台导航"
      >
        <div className="drawer-heading">
          <span className="drawer-label">导航 / NAVIGATION</span>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭导航"
            popoverTarget="workspace-navigation"
            popoverTargetAction="hide"
            autoFocus
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {navigation}
        <div className="drawer-footnote">
          <Icon name="shield" size={14} />
          <span>学析台 · 学习数据分析</span>
        </div>
      </aside>
      <div className="workbench-main">
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
                loading={profilesLoading || (overviewLoading && canRun)}
                profile={selectedProfile}
                canRun={canRun}
                aiReady={aiReady}
                onExplore={(nextMetric) => {
                  setAnalysisView("standard");
                  setMetric(nextMetric);
                  setScoreView("comparison");
                  setDimension("course");
                  setChartType("bar");
                  changeMode("metrics");
                  navigate("analysis");
                }}
                onQuestion={(nextQuestion) => {
                  changeMode("question");
                  navigate("analysis");
                  if (nextQuestion) void ask(nextQuestion, { fresh: true });
                }}
                onData={() => navigate("data")}
                onReport={previewReport}
              />
            )}
            {view === "analysis" &&
              (mode === "question" ? (
                <ConversationWorkspace
                  messages={chatMessages}
                  question={question}
                  loading={askLoading}
                  pendingQuestion={pendingQuestion}
                  pendingSteps={pendingSteps}
                  aiReady={aiReady}
                  canRun={canRun}
                  model={aiStatus.model}
                  contextLabel={describeChatContext(chatContext)}
                  inputError={inputError}
                  expandedChartId={expandedChartId}
                  onQuestionChange={(value) => {
                    setQuestion(value);
                    if (inputError) setInputError(null);
                  }}
                  onAsk={(next) => void ask(next)}
                  onExpandChart={setExpandedChartId}
                  onChartChange={changeChatView}
                  onReport={previewReport}
                  onConfigure={user.role === "admin" ? () => navigate("admin") : undefined}
                  notice={notice}
                  onStop={() => {
                    // Ignore a second stop click after the request already ended.
                    if (!askPending.current) return;
                    askPending.current.abort();
                    askPending.current = null;
                    setAskLoading(false);
                    setPendingSteps([]);
                    setChatMessages((previous) =>
                      [
                        ...previous,
                        {
                          id: `stopped-${crypto.randomUUID()}`,
                          role: "assistant" as const,
                          content: STOPPED_MESSAGE,
                          steps: pendingSteps.map((step) =>
                            step.status === "running"
                              ? { ...step, status: "cancelled" as const }
                              : step,
                          ),
                          system: true,
                        },
                      ].slice(-40),
                    );
                  }}
                  onClearContext={() => setChatContext(null)}
                  onClear={() => {
                    setChatMessages([]);
                    setPendingSteps([]);
                    setChatContext(null);
                    setExpandedChartId(null);
                    setAskResult(null);
                    setQuestion("");
                    setError(null);
                    setInputError(null);
                    setFailedAsk(null);
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                />
              ) : (
                <section
                  className="panel analysis-workspace metric-scope"
                  data-metric={mode === "metrics" ? metric : undefined}
                  aria-label="学习分析工作区"
                >
                  <div
                    className="analysis-workspace-controls"
                    data-enter="rise-sm"
                    style={{ "--enter-delay": "60ms" } as CSSProperties}
                  >
                    {mode === "metrics" && (
                      <div className="control-field">
                        <span>分析方式</span>
                        <SegmentedControl
                          label="分析方式"
                          value={analysisView}
                          onChange={setAnalysisView}
                          options={[
                            { value: "standard", label: "指标分析" },
                            { value: "studio", label: "图表工坊" },
                          ]}
                        />
                      </div>
                    )}
                    {mode === "metrics" ? (
                      showChartStudio ? (
                        <p className="analysis-control-help">
                          五种交互图表，支持项目数据、CSV、JSON 与自由字段映射。输入数据后自动生成。
                        </p>
                      ) : (
                        <>
                          <div className="control-field metric-control">
                            <span>统计指标</span>
                            <SegmentedControl<Metric>
                              label="统计指标"
                              value={metric}
                              onChange={setMetric}
                              disabled={!canRun}
                              options={[
                                { value: "score", label: "成绩" },
                                { value: "activity", label: "活跃次数" },
                                { value: "completion_rate", label: "完成率" },
                              ]}
                            />
                          </div>
                          {metric === "score" && (
                            <div className="control-field">
                              <span>分析视图</span>
                              <SegmentedControl
                                label="成绩分析视图"
                                value={scoreView}
                                onChange={setScoreView}
                                disabled={!canRun}
                                options={[
                                  { value: "panorama", label: "关联全景" },
                                  { value: "distribution", label: "成绩分布" },
                                  { value: "comparison", label: "均分对比" },
                                  { value: "relations", label: "学科关联" },
                                ]}
                              />
                            </div>
                          )}
                          {!showSpecialScore && (
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
                          )}
                          {!showSpecialScore && (
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
                          )}
                          <p className="analysis-control-help">{metricCopy[metric]}</p>
                        </>
                      )
                    ) : null}
                  </div>
                  <div
                    className="analysis-notices"
                    data-enter="fade"
                    style={{ "--enter-delay": "140ms" } as CSSProperties}
                  >
                    {notice}
                    {!showChartStudio && !profilesLoading && !canRun && (
                      <div className="notice notice-warning" role="status">
                        当前数据源不可用，请选择其他数据源或联系管理员检查数据文件。
                      </div>
                    )}
                  </div>
                  {showChartStudio ? (
                    <ChartStudio key={datasetId} datasetId={datasetId} api={api} />
                  ) : showPanorama ? (
                    canRun ? (
                      <CoursePanorama key={datasetId} datasetId={datasetId} api={api} />
                    ) : null
                  ) : showRelations ? (
                    canRun ? (
                      <CourseRelations key={datasetId} datasetId={datasetId} api={api} />
                    ) : null
                  ) : showDistribution ? (
                    canRun ? (
                      <ScoreDistribution key={datasetId} datasetId={datasetId} api={api} />
                    ) : null
                  ) : (
                    <AnalysisResultView
                      result={visibleResult}
                      chartType={chartType}
                      onChartChange={setChartType}
                      loading={loading}
                      onReport={previewReport}
                    />
                  )}
                </section>
              ))}
            {view === "data" && (
              <section
                className="panel dataset-workspace"
                data-enter="panel"
                style={{ "--enter-delay": "60ms" } as CSSProperties}
              >
                <div
                  className="dataset-heading"
                  data-enter="rise-sm"
                  style={{ "--enter-delay": "120ms" } as CSSProperties}
                >
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
                <div
                  className="dataset-scope"
                  data-enter-group="rise"
                  style={{ "--enter-group-delay": "180ms" } as CSSProperties}
                >
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
                <div
                  className="dataset-actions"
                  data-enter="rise-sm"
                  style={{ "--enter-delay": "320ms" } as CSSProperties}
                >
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
            {view === "account" && (
              <>
                <div className="settings-section-label" data-enter="fade">
                  我的账号
                </div>
                <AccountPanel user={user} expire={expire} />
              </>
            )}
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
      <dialog
        ref={logoutDialog}
        className="logout-confirmation"
        aria-labelledby="logout-title"
        aria-describedby="logout-description"
        onCancel={(event) => {
          if (loggingOut) event.preventDefault();
        }}
      >
        <span className="page-eyebrow">SESSION / 退出确认</span>
        <h2 id="logout-title">退出当前账号？</h2>
        <p id="logout-description">退出后需要重新登录才能继续使用工作台。</p>
        {logoutError && (
          <p className="notice notice-error" role="alert">
            {logoutError}
          </p>
        )}
        <div className="logout-confirmation-actions">
          <button
            type="button"
            className="secondary-button"
            autoFocus
            disabled={loggingOut}
            onClick={() => logoutDialog.current?.close()}
          >
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={loggingOut}
            onClick={() => void logout()}
          >
            {loggingOut ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
