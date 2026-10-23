"use client";

import { WorkspaceChrome } from "@/components/workspace-chrome";

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
import experienceStyles from "@/components/conversation-experience.module.css";
import conversationStyles from "@/components/ai-conversation.module.css";
import {
  artifactWithView,
  intentWithView,
  type ChatDisplayView,
  type AnalysisStep,
  type ChatIntent,
  type ChatResponse,
} from "@/lib/ai/chat-types";
import type {
  ConversationDetail,
  ConversationPage,
  ConversationSummary,
} from "@/lib/conversations/types";
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
import {
  capabilitiesFor,
  datasetAccessKey,
  isDatasetEligible,
  isPasswordChangeRequired,
  sessionScopeKey,
} from "@/lib/client-capabilities";
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
        {profile.enabled === false && (
          <div className="notice notice-warning" role="status">
            <Icon name="info" size={17} />
            <span>此数据集已停用。账号仍保留读取授权，但工作台不会发起数据查询。</span>
          </div>
        )}
        {profile.enabled !== false && !profile.available && (
          <div className="notice notice-warning" role="status">
            <Icon name="info" size={17} />
            <span>
              {profile.unavailableReason || "源文件暂不可用"}。请联系管理员检查数据文件或启用状态。
            </span>
          </div>
        )}
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

function sourceStatusLabel(profile: DatasetProfile): string {
  if (profile.enabled === false && !profile.available) return "（已停用 · 源文件不可用）";
  if (profile.enabled === false) return "（已停用）";
  if (!profile.available) return "（源文件不可用）";
  return "";
}

function ReadonlyOverview({
  heading,
  sourceControl,
  profile,
  profilesLoading,
  profilesError,
  onAnalyze,
  onData,
}: {
  heading: React.ReactNode;
  sourceControl: React.ReactNode;
  profile?: DatasetProfile;
  profilesLoading: boolean;
  profilesError: string | null;
  onAnalyze: () => void;
  onData: () => void;
}) {
  const eligible = Boolean(profile && isDatasetEligible(profile));
  return (
    <section className="panel analysis-empty readonly-overview" data-enter="rise">
      <Icon name="shield" size={28} />
      <h2>只读分析工作台</h2>
      {heading}
      <p>
        {profilesLoading
          ? "正在读取账号的数据授权和源文件状态。"
          : profilesError
            ? profilesError
            : !profile
              ? "当前账号尚未授权任何数据集，请联系管理员分配数据范围。"
              : eligible
                ? `已授权 ${profile.name}。可以查看确定性指标、标准图表和报告预览；AI 对话与浏览器导出已关闭。`
                : `${profile.name}${sourceStatusLabel(profile)}，当前不能发起数据查询。`}
      </p>
      {sourceControl}
      <div className="account-actions">
        <button className="primary-button" type="button" disabled={!eligible} onClick={onAnalyze}>
          查看指标分析
          <Icon name="arrow" size={16} />
        </button>
        <button className="secondary-button" type="button" onClick={onData}>
          查看数据权限
        </button>
      </div>
    </section>
  );
}

function sameSessionPresentation(left: SessionUser, right: SessionUser): boolean {
  return (
    sessionScopeKey(left) === sessionScopeKey(right) &&
    left.username === right.username &&
    left.displayName === right.displayName
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  maxLength,
  help,
  clearError,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  help?: string;
  clearError: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="form-field" htmlFor={id}>
      {label}
      <span className="password-input-wrap">
        <input
          autoComplete={autoComplete}
          id={id}
          minLength={minLength}
          maxLength={maxLength}
          onChange={(event) => {
            onChange(event.target.value);
            clearError();
          }}
          required
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          type="button"
          className="account-password-toggle"
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon name={visible ? "eyeOff" : "eye"} size={16} />
        </button>
      </span>
      {help && <span className="form-help">{help}</span>}
    </label>
  );
}

function AccountPanel({
  user,
  passwordChangeRequired,
  onPasswordChanged,
  onSessionExpired,
}: {
  user: SessionUser;
  passwordChangeRequired: boolean;
  onPasswordChanged: () => void;
  onSessionExpired: () => void;
}) {
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
        onSessionExpired();
        return;
      }
      const payload = await response.json();
      if (!active.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error ?? "密码修改失败。");
      onPasswordChanged();
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
        <span className="badge badge-teal">
          {user.role === "admin" ? "管理员" : user.role === "readonly" ? "只读用户" : "分析用户"}
        </span>
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
        {passwordChangeRequired && (
          <div className="notice notice-warning" role="alert">
            <Icon name="lock" size={18} />
            <span>当前使用的是临时密码。请先在这里设置新密码，再使用学习分析工作台。</span>
          </div>
        )}
        <div className="section-heading">
          <div>
            <h2>修改登录密码</h2>
            <p>更新后需要重新登录。</p>
          </div>
          <Icon name="lock" size={22} />
        </div>
        <form onSubmit={submit} className="password-form">
          <PasswordField
            id="current-password"
            label="当前密码"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            clearError={() => setError("")}
          />
          <PasswordField
            id="new-password"
            label="新密码"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            help="至少 12 个字符，建议混合字母、数字和符号。"
            clearError={() => setError("")}
          />
          <PasswordField
            id="confirm-password"
            label="再次输入新密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            clearError={() => setError("")}
          />
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
  canExport,
}: {
  analyses: SessionAnalysis[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onStart: () => void;
  canExport: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loadedHtml, setLoadedHtml] = useState("");
  const [printError, setPrintError] = useState("");
  const selected = analyses.find((entry) => entry.key === selectedKey) ?? analyses[0];
  const result = selected?.result;
  const { theme } = useTheme();
  const html = useMemo(() => (result ? analysisReportHtml(result, theme) : ""), [result, theme]);
  function printReport() {
    if (!canExport) return;
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
        {canExport ? (
          <>
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
          </>
        ) : (
          <p className="muted">只读账号可以预览报告，浏览器导出已关闭。</p>
        )}
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
        sandbox={canExport ? "allow-same-origin allow-modals" : "allow-same-origin"}
        srcDoc={html}
        title={`${result.metricLabel}分析报告预览`}
        onLoad={() => setLoadedHtml(html)}
      />
    </section>
  );
}

export function Workspace({ initialConversation = false }: { initialConversation?: boolean } = {}) {
  const initialEntryApplied = useRef(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [bootError, setBootError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [adminInitialTab, setAdminInitialTab] = useState<"overview" | "ai" | undefined>(undefined);
  const [mode, setMode] = useState<AnalysisMode>("metrics");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const logoutDialog = useRef<HTMLDialogElement>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [profiles, setProfiles] = useState<DatasetProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const profilesLoaded = useRef(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<DataSource | null>(null);
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
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const conversationRef = useRef<ConversationSummary | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationSummary[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyGeneration = useRef(0);
  const historySelectionPending = useRef(false);
  const [historySelecting, setHistorySelecting] = useState(false);
  const resetConversationContext = useRef(false);
  const pendingTurn = useRef<{
    id: string;
    conversationId: string;
    question: string;
    revision: number;
    datasetId: DataSource;
    resetContext: boolean;
  } | null>(null);
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
  const [profileRefreshCount, setProfileRefreshCount] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const generation = useRef(0);
  const askPending = useRef<AbortController | null>(null);
  const sessionSyncPending = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const userScope = useRef("");
  const profileAccessKey = useRef("");
  const selectedProfile = profiles.find((profile) => profile.id === datasetId);
  const capabilities = capabilitiesFor(user);
  const passwordChangeRequired = isPasswordChangeRequired(user);
  const canRun =
    capabilities.canViewBusiness &&
    !profilesLoading &&
    Boolean(selectedProfile && isDatasetEligible(selectedProfile));
  const eligibleDatasetId =
    datasetId && selectedProfile && isDatasetEligible(selectedProfile) ? datasetId : null;
  const availableMetrics: Metric[] = selectedProfile?.metrics ?? [
    "score",
    "activity",
    "completion_rate",
  ];
  const metricCapabilityKey = availableMetrics.join(",");
  const selectedDatasetVersion = selectedProfile?.datasetVersion;
  useEffect(() => {
    if (!(metricCapabilityKey.split(",") as Metric[]).includes(metric)) setMetric("score");
  }, [metricCapabilityKey, metric]);
  const aiReady = aiStatus.configured && aiStatus.enabled;
  const aiAllowed = capabilities.canUseAI && canRun;
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

  const expire = useCallback((notice: string | null = null) => {
    generation.current++;
    sessionSyncPending.current?.controller.abort();
    sessionSyncPending.current = null;
    askPending.current?.abort();
    askPending.current = null;
    setLoginNotice(notice);
    setConversationHistory([]);
    setHistoryCursor(null);
    setHistoryError(null);
    setUser(null);
    userScope.current = "";
    setProfiles([]);
    profilesLoaded.current = false;
    setProfilesLoading(false);
    setProfilesError(null);
    setDatasetId(null);
    profileAccessKey.current = "";
    setOverview({});
    setOverviewLoading(false);
    setAnalysis(null);
    setAskResult(null);
    setSessionAnalyses([]);
    setSelectedReportKey("");
    conversationRef.current = null;
    setConversation(null);
    pendingTurn.current = null;
    historyGeneration.current++;
    historySelectionPending.current = false;
    setHistorySelecting(false);
    setChatMessages([]);
    setPendingQuestion("");
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

  const clearScopedState = useCallback(
    (nextView: View = "overview", notice: string | null = null) => {
      generation.current++;
      askPending.current?.abort();
      askPending.current = null;
      setConversationHistory([]);
      setHistoryCursor(null);
      setHistoryError(null);
      setProfiles([]);
      profilesLoaded.current = false;
      setProfilesLoading(true);
      setProfilesError(null);
      setDatasetId(null);
      profileAccessKey.current = "";
      setOverview({});
      setOverviewLoading(false);
      setAIStatus({ configured: false, enabled: false, model: null });
      setAnalysis(null);
      setAskResult(null);
      setSessionAnalyses([]);
      setSelectedReportKey("");
      conversationRef.current = null;
      setConversation(null);
      pendingTurn.current = null;
      historyGeneration.current++;
      historySelectionPending.current = false;
      setHistorySelecting(false);
      setChatMessages([]);
      setPendingQuestion("");
      setPendingSteps([]);
      setChatContext(null);
      setExpandedChartId(null);
      setQuestion("");
      setError(null);
      setInputError(null);
      setFailedAsk(null);
      setAskLoading(false);
      setBrowseLoading(false);
      setLoginNotice(notice);
      setMode("metrics");
      setView(nextView);
    },
    [],
  );

  // Focus, visibility, and polling share one request. Overlapping events must
  // not cancel the active check and strand boot or permission refresh in a
  // half-applied state. Logout and unmount remain the only cancellation owners.
  const syncAccess = useCallback(
    (options: { boot?: boolean } = {}): Promise<void> => {
      const active = sessionSyncPending.current;
      if (active) {
        if (!options.boot) return active.promise;
        return active.promise.catch((requestError) => {
          throw requestError;
        });
      }

      const controller = new AbortController();
      const promise = (async () => {
        let response: Response;
        try {
          response = await fetch("/api/auth/session", {
            cache: "no-store",
            signal: controller.signal,
          });
        } catch (requestError) {
          if (controller.signal.aborted) return;
          if (options.boot) throw requestError;
          return;
        }
        if (!response.ok) {
          if (response.status === 401) expire("登录已过期，请重新登录。");
          else if (options.boot) throw new Error("暂时无法连接工作台，请检查服务后重试。");
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          user?: SessionUser | null;
          setupRequired?: boolean;
        } | null;
        if (!payload) {
          if (options.boot) throw new Error("返回数据格式异常，请稍后重试。");
          return;
        }
        if (controller.signal.aborted || sessionSyncPending.current?.controller !== controller)
          return;
        const nextUser = payload.user ?? null;
        setSetupRequired(Boolean(payload.setupRequired));
        if (!nextUser) {
          // A first visit also lands here with 200 + user:null; only a real
          // 401 above means the previous session expired.
          expire(null);
          return;
        }
        const nextScope = sessionScopeKey(nextUser);
        const changed = nextScope !== userScope.current;
        setUser((previous) =>
          previous && sameSessionPresentation(previous, nextUser) ? previous : nextUser,
        );
        userScope.current = nextScope;
        setProfileRefreshCount((count) => count + 1);
        if (changed) {
          clearScopedState(nextUser.mustChangePassword ? "account" : "overview");
        } else if (nextUser.mustChangePassword) {
          setMode("metrics");
          setView("account");
        }
      })().finally(() => {
        if (sessionSyncPending.current?.controller === controller)
          sessionSyncPending.current = null;
      });
      sessionSyncPending.current = { controller, promise };
      return promise;
    },
    [clearScopedState, expire],
  );

  useEffect(
    () => () => {
      generation.current++;
      askPending.current?.abort();
      askPending.current = null;
      sessionSyncPending.current?.controller.abort();
      sessionSyncPending.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!user) return;
    pageHeading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [view, mode, user]);
  useEffect(() => {
    void syncAccess({ boot: true })
      .catch((requestError) => {
        setBootError(requestMessage(requestError, "暂时无法连接工作台，请检查服务后重试。"));
      })
      .finally(() => setBootLoading(false));
  }, [syncAccess]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void syncAccess(), 45_000);
    const onFocus = () => void syncAccess();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncAccess();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, syncAccess]);
  // The preview uses this same authenticated workspace and real conversation.
  // Apply its entry point once, after session and password checks have settled.
  useEffect(() => {
    if (!initialConversation || initialEntryApplied.current || bootLoading || !user) return;
    initialEntryApplied.current = true;
    if (user.mustChangePassword || !capabilities.canUseAI) return;
    setMode("question");
    setView("analysis");
  }, [initialConversation, bootLoading, user, capabilities.canUseAI]);

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
        if (current === generation.current) expire("登录已过期，请重新登录。");
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
  const historyDatasetKey = datasetAccessKey(profiles);
  const refreshConversationHistory = useCallback(
    async (cursor?: string) => {
      const current = historyGeneration.current;
      const scope = userScope.current;
      if (!scope) return;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const page = (await api(
          `/api/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        )) as ConversationPage;
        if (current !== historyGeneration.current || scope !== userScope.current) return;
        setConversationHistory((previous) =>
          cursor
            ? [
                ...previous.filter(
                  (item) => !page.conversations.some((next) => next.id === item.id),
                ),
                ...page.conversations,
              ]
            : page.conversations,
        );
        setHistoryCursor(page.nextCursor);
      } catch (error) {
        if (current === historyGeneration.current && scope === userScope.current)
          setHistoryError(requestMessage(error, "历史读取失败，请重试。"));
      } finally {
        if (current === historyGeneration.current) setHistoryLoading(false);
      }
    },
    [api],
  );
  useEffect(() => {
    setConversationHistory([]);
    setHistoryCursor(null);
    if (user && !passwordChangeRequired && capabilities.canUseAI) void refreshConversationHistory();
  }, [
    user?.id,
    passwordChangeRequired,
    capabilities.canUseAI,
    historyDatasetKey,
    refreshConversationHistory,
  ]);

  function applyConversationDetail(detail: ConversationDetail, restored = true) {
    conversationRef.current = detail.conversation;
    setConversation(detail.conversation);
    setDatasetId(detail.conversation.datasetId);
    setChatMessages(
      detail.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.response
          ? {
              response: message.response,
              generatedAt: Date.parse(message.response.generatedAt),
              restored,
            }
          : {}),
        ...(message.response &&
        ["failed", "cancelled", "interrupted"].includes(message.response.status)
          ? { system: true }
          : {}),
      })),
    );
    const response = [...detail.messages].reverse().find((message) => message.response)?.response;
    setChatContext(response?.context ?? null);
    resetConversationContext.current = false;
    setPendingSteps([]);
    setPendingQuestion("");
    setAskLoading(false);
    setExpandedChartId(null);
    setQuestion("");
    setError(null);
    setFailedAsk(null);
  }
  async function openConversation(id: string) {
    askPending.current?.abort();
    askPending.current = null;
    generation.current++;
    const current = ++historyGeneration.current;
    const scope = userScope.current;
    historySelectionPending.current = true;
    setHistorySelecting(true);
    setAskLoading(false);
    setHistoryError(null);
    try {
      const detail = (await api(`/api/conversations/${id}`)) as ConversationDetail;
      if (current !== historyGeneration.current || scope !== userScope.current) return;
      pendingTurn.current = null;
      applyConversationDetail(detail);
    } catch (error) {
      if (current === historyGeneration.current && scope === userScope.current)
        setHistoryError(requestMessage(error, "对话已过期、已删除或当前无权访问。"));
    } finally {
      if (current === historyGeneration.current) {
        historySelectionPending.current = false;
        setHistorySelecting(false);
      }
    }
  }
  async function deleteConversation(id: string) {
    const scope = userScope.current;
    if (conversationRef.current?.id === id) newConversation();
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      if (scope === userScope.current) await refreshConversationHistory();
    } catch (error) {
      if (scope === userScope.current) setHistoryError(requestMessage(error, "删除失败，请重试。"));
    }
  }
  function newConversation() {
    // Repeated clicks on the same empty draft are display-only no-ops. In
    // particular, don't invalidate or reload the already visible history list.
    if (
      !conversationRef.current &&
      !historySelectionPending.current &&
      !askPending.current &&
      !chatMessages.length &&
      !pendingTurn.current
    )
      return;
    askPending.current?.abort();
    askPending.current = null;
    generation.current++;
    historyGeneration.current++;
    historySelectionPending.current = false;
    setHistorySelecting(false);
    conversationRef.current = null;
    setConversation(null);
    pendingTurn.current = null;
    setChatMessages([]);
    setPendingSteps([]);
    setChatContext(null);
    setExpandedChartId(null);
    setAskResult(null);
    setQuestion("");
    setError(null);
    setInputError(null);
    setFailedAsk(null);
    setAskLoading(false);
    resetConversationContext.current = false;
    setHistoryLoading(false);
  }

  useEffect(() => {
    if (!user || passwordChangeRequired) {
      setProfilesLoading(false);
      return;
    }
    const controller = new AbortController();
    const current = generation.current;
    const scope = sessionScopeKey(user);
    const showLoading = !profilesLoaded.current;
    if (showLoading) setProfilesLoading(true);
    setProfilesError(null);
    api("/api/profile", { signal: controller.signal })
      .then((payload) => {
        if (
          controller.signal.aborted ||
          current !== generation.current ||
          scope !== userScope.current ||
          !Array.isArray(payload.datasets)
        )
          return;
        const nextProfiles = payload.datasets as DatasetProfile[];
        const nextKey = datasetAccessKey(nextProfiles);
        if (profileAccessKey.current !== "" && profileAccessKey.current !== nextKey) {
          generation.current++;
          setRefreshCount((count) => count + 1);
          setOverview({});
          setAnalysis(null);
          setAskResult(null);
          setSessionAnalyses([]);
          setSelectedReportKey("");
          conversationRef.current = null;
          setConversation(null);
          pendingTurn.current = null;
          historyGeneration.current++;
          historySelectionPending.current = false;
          setHistorySelecting(false);
          setChatMessages([]);
          setPendingQuestion("");
          setPendingSteps([]);
          setChatContext(null);
          setExpandedChartId(null);
          setQuestion("");
          setError(null);
          setInputError(null);
          setFailedAsk(null);
          setAskLoading(false);
          setBrowseLoading(false);
        }
        profileAccessKey.current = nextKey;
        profilesLoaded.current = true;
        setProfiles(nextProfiles);
        setDatasetId((previous) => {
          const previousProfile = nextProfiles.find((profile) => profile.id === previous);
          if (previousProfile && isDatasetEligible(previousProfile)) return previous;
          return nextProfiles.find(isDatasetEligible)?.id ?? nextProfiles[0]?.id ?? null;
        });
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && current === generation.current) {
          profilesLoaded.current = false;
          setProfiles([]);
          setDatasetId(null);
          setProfilesError(requestMessage(requestError, "数据源读取失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) {
          profilesLoaded.current = true;
          setProfilesLoading(false);
        }
      });
    return () => controller.abort();
  }, [user, api, profileRefreshCount, passwordChangeRequired]);
  useEffect(() => {
    if (!user || passwordChangeRequired || !capabilities.canUseAI) {
      setAIStatus({ configured: false, enabled: false, model: null });
      return;
    }
    const controller = new AbortController();
    const current = generation.current;
    api("/api/ai/status", { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted && current === generation.current)
          setAIStatus({
            configured: Boolean(payload.configured),
            enabled: capabilities.canUseAI && Boolean(payload.enabled),
            model: typeof payload.model === "string" && payload.model ? payload.model : null,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted && current === generation.current)
          setAIStatus({ configured: false, enabled: false, model: null });
      });
    return () => controller.abort();
  }, [user, api, aiStatusRefresh, capabilities.canUseAI]);
  useEffect(() => {
    const previous = previousView.current;
    previousView.current = view;
    if (previous === "admin" && view !== "admin") {
      setAiStatusRefresh((count) => count + 1);
      setProfileRefreshCount((count) => count + 1);
    }
  }, [view]);
  useEffect(() => {
    if (!user || !eligibleDatasetId || passwordChangeRequired) return;
    const currentDatasetId = eligibleDatasetId;
    const controller = new AbortController();
    const current = generation.current;
    setOverviewLoading(true);
    const metrics = metricCapabilityKey.split(",") as Metric[];
    Promise.allSettled(
      metrics.map(async (value) => {
        const plan = createPlan({
          datasetId: currentDatasetId,
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
  }, [
    user,
    eligibleDatasetId,
    selectedDatasetVersion,
    refreshCount,
    metricCapabilityKey,
    passwordChangeRequired,
    api,
    rememberResult,
  ]);
  useEffect(() => {
    if (
      !user ||
      passwordChangeRequired ||
      view !== "analysis" ||
      mode !== "metrics" ||
      !eligibleDatasetId ||
      showSpecialScore
    ) {
      setBrowseLoading(false);
      return;
    }
    const currentDatasetId = eligibleDatasetId;
    const controller = new AbortController();
    const current = generation.current;
    setBrowseLoading(true);
    setError(null);
    const plan = createPlan({
      datasetId: currentDatasetId,
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
    eligibleDatasetId,
    metric,
    dimension,
    passwordChangeRequired,
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
    setMetric("score");
    setOverview({});
    setOverviewLoading(true);
    setAnalysis(null);
    setAskResult(null);
    conversationRef.current = null;
    setConversation(null);
    pendingTurn.current = null;
    historyGeneration.current++;
    historySelectionPending.current = false;
    setHistorySelecting(false);
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
    if (passwordChangeRequired && next !== "account") return;
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
    if (passwordChangeRequired || (next === "question" && !capabilities.canUseAI)) return;
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
      expire(null);
    } catch (requestError) {
      setLogoutError(requestMessage(requestError, "退出失败，请重试。"));
    } finally {
      setLoggingOut(false);
    }
  }
  async function ask(nextQuestion = question, options: { fresh?: boolean } = {}) {
    if (
      !aiAllowed ||
      !eligibleDatasetId ||
      passwordChangeRequired ||
      historySelectionPending.current
    )
      return;
    const currentDatasetId = eligibleDatasetId;
    const trimmed = nextQuestion.trim();
    if (trimmed.length < 2 || trimmed.length > 500) {
      const message = "请写下 2–500 字的分析问题。";
      setError(message);
      setInputError(message);
      return;
    }
    if ((!canRun && !aiReady) || askPending.current) return;
    if (
      !options.fresh &&
      chatMessages.some((message) => message.response?.persistence === "pending")
    ) {
      setError("当前分析已完成但尚未保存，请先重试保存，或新建对话。");
      return;
    }
    // Entry points outside the transcript (home cards) start a fresh
    // conversation instead of inheriting an unrelated earlier scope.
    if (options.fresh) {
      conversationRef.current = null;
      setConversation(null);
      pendingTurn.current = null;
      historyGeneration.current++;
      historySelectionPending.current = false;
      setHistorySelecting(false);
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
      let selectedConversation = conversationRef.current;
      if (!selectedConversation) {
        const created = await api("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ datasetId: currentDatasetId }),
        });
        if (!isCurrent()) return;
        selectedConversation = created.conversation as ConversationSummary;
        conversationRef.current = selectedConversation;
        setConversation(selectedConversation);
      }
      if (selectedConversation.datasetId !== currentDatasetId)
        throw new Error("当前对话的数据源已变化，请新建对话。");
      const previousTurn = pendingTurn.current;
      const turn =
        previousTurn &&
        previousTurn.conversationId === selectedConversation.id &&
        previousTurn.question === trimmed
          ? previousTurn
          : {
              id: crypto.randomUUID(),
              conversationId: selectedConversation.id,
              revision: selectedConversation.revision,
              question: trimmed,
              datasetId: currentDatasetId,
              resetContext: resetConversationContext.current,
            };
      pendingTurn.current = turn;
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
            datasetId: currentDatasetId,
            conversationId: turn.conversationId,
            turnId: turn.id,
            expectedRevision: turn.revision,
            resetContext: turn.resetContext,
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
      const turnId = payload.conversation?.turnId ?? turn.id;
      if (payload.conversation) {
        const updated = { ...selectedConversation, revision: payload.conversation.revision };
        conversationRef.current = updated;
        setConversation(updated);
      }
      pendingTurn.current = null;
      resetConversationContext.current = false;
      void refreshConversationHistory();
      setChatMessages((previous) =>
        [
          ...(options.fresh ? [] : previous),
          { id: `${turnId}-user`, role: "user" as const, content: trimmed },
          {
            id: `${turnId}-assistant`,
            role: "assistant" as const,
            content: payload.answer,
            response: payload,
            generatedAt: payload.generatedAt ? Date.parse(payload.generatedAt) : Date.now(),
          },
        ].slice(-40),
      );
      setQuestion((draft) => (draft === nextQuestion ? "" : draft));
      if (payload.artifact) {
        if (payload.presentation !== "text")
          setExpandedChartId(
            payload.artifacts?.length ? `${turnId}-assistant:0` : `${turnId}-assistant`,
          );
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
      const failedConversationId = pendingTurn.current?.conversationId;
      // A transport failure keeps its identity for safe replay. A known terminal
      // error permits an explicit new retry after refreshing the server revision.
      if (
        requestError instanceof ApiError &&
        requestError.code &&
        !["CONVERSATION_TURN_RUNNING", "TURN_IN_PROGRESS"].includes(requestError.code)
      ) {
        pendingTurn.current = null;
      }
      if (failedConversationId) {
        try {
          const detail = (await api(
            `/api/conversations/${failedConversationId}`,
          )) as ConversationDetail;
          if (isCurrent() && conversationRef.current?.id === failedConversationId) {
            conversationRef.current = detail.conversation;
            setConversation(detail.conversation);
          }
        } catch {
          /* Original error remains visible; no new model request. */
        }
      }
      void refreshConversationHistory();
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
  async function retryConversationPersistence(id: string) {
    const message = chatMessages.find((item) => item.id === id);
    const metadata = message?.response?.conversation;
    if (!metadata || message.response?.persistence !== "pending") return;
    const current = generation.current;
    try {
      const response = (await api("/api/conversation-save", {
        method: "POST",
        body: JSON.stringify({ conversationId: metadata.id, turnId: metadata.turnId }),
      })) as ChatResponse;
      if (current !== generation.current || conversationRef.current?.id !== metadata.id) return;
      setChatMessages((previous) =>
        previous.map((item) => (item.id === id ? { ...item, response } : item)),
      );
      if (response.conversation && conversationRef.current) {
        const updated = { ...conversationRef.current, revision: response.conversation.revision };
        conversationRef.current = updated;
        setConversation(updated);
      }
      setError(null);
      void refreshConversationHistory();
    } catch (error) {
      if (current === generation.current)
        setError(requestMessage(error, "历史保存失败，请稍后重试保存。"));
    }
  }
  async function stopConversation() {
    const selected = conversationRef.current;
    const turnId =
      pendingTurn.current?.id ??
      (selected?.lastTurn?.status === "running" ? selected.lastTurn.id : null);
    if (!askPending.current && !turnId) return;
    const selectedId = selected?.id;
    askPending.current?.abort();
    askPending.current = null;
    setAskLoading(false);
    setPendingSteps([]);
    if (!turnId || !selectedId) return;
    try {
      await api(`/api/conversations/${selectedId}/stop`, {
        method: "POST",
        body: JSON.stringify({ turnId }),
      });
      if (conversationRef.current?.id !== selectedId) return;
      const detail = (await api(`/api/conversations/${selectedId}`)) as ConversationDetail;
      if (conversationRef.current?.id === selectedId) {
        applyConversationDetail(detail, false);
        pendingTurn.current = null;
        void refreshConversationHistory();
      }
    } catch (error) {
      if (conversationRef.current?.id === selectedId)
        setError(requestMessage(error, "停止状态尚未确认，请刷新历史。"));
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
                presentation: chart === "table" ? "table" : "chart",
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
          clearScopedState(nextUser.mustChangePassword ? "account" : "overview");
          userScope.current = sessionScopeKey(nextUser);
          setUser(nextUser);
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
        {visibleResult && view === "analysis" && " 上次成功的结果仍可查看。"}
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
  const navigation = passwordChangeRequired ? (
    <nav className="workspace-nav" aria-label="主要功能">
      <button type="button" aria-current="page" onClick={() => navigate("account")}>
        <span>修改密码</span>
      </button>
    </nav>
  ) : (
    <nav className="workspace-nav" aria-label="主要功能">
      {capabilities.canUseAI && (
        <button
          type="button"
          aria-current={view === "analysis" && mode === "question" ? "page" : undefined}
          data-navigation="conversation"
          onClick={() => {
            if (view === "analysis" && mode === "question") return;
            changeMode("question");
            navigate("analysis");
          }}
        >
          <Icon name="sparkles" size={16} />
          <span>AI 对话</span>
        </button>
      )}
      {(
        [
          ["overview", "学习全景"],
          ["analysis", "指标分析"],
          ["data", "数据"],
          ["reports", "分析报告"],
        ] as const
      ).map(([key, label]) => {
        const active =
          key === "analysis" ? view === "analysis" && mode === "metrics" : view === key;
        return (
          <button
            type="button"
            key={key}
            data-navigation={key}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (key === "analysis") {
                changeMode("metrics");
                navigate("analysis");
              } else navigate(key);
            }}
          >
            <Icon
              name={
                key === "overview"
                  ? "dashboard"
                  : key === "analysis"
                    ? "chart"
                    : key === "data"
                      ? "database"
                      : "file"
              }
              size={16}
            />
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
      <h1
        ref={pageHeading}
        tabIndex={-1}
        id="workspace-heading"
        data-enter="rise"
        style={{ "--enter-delay": "70ms" } as CSSProperties}
      >
        {view === "overview" ? <>学习数据总览</> : currentPage.title}
      </h1>
      <p data-enter="rise-sm" style={{ "--enter-delay": "180ms" } as CSSProperties}>
        {currentPage.description}
      </p>
    </div>
  );
  const sourcePicker = showDataset && !passwordChangeRequired && (
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
        value={datasetId ?? ""}
        disabled={profilesLoading || profilesError !== null || profiles.length === 0}
        onChange={(event) => {
          if (event.target.value) changeSource(event.target.value as DataSource);
        }}
      >
        {profilesLoading ? (
          <option value="">正在读取授权数据源…</option>
        ) : profilesError ? (
          <option value="">数据源读取失败</option>
        ) : profiles.length === 0 ? (
          <option value="">未授权任何数据集</option>
        ) : (
          <>
            {!datasetId && <option value="">请选择数据源</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id} disabled={!isDatasetEligible(profile)}>
                {profile.name}
                {sourceStatusLabel(profile)}
              </option>
            ))}
          </>
        )}
      </select>
      {profilesError && (
        <small className="form-help" role="alert">
          {profilesError}
        </small>
      )}
    </label>
  );
  return (
    <div
      className={`product-workspace workbench-shell ${experienceStyles.shell}`}
      data-view={view}
      data-conversation={(view === "analysis" && mode === "question") || undefined}
      data-drawer-open={sidebarOpen || undefined}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <WorkspaceChrome
        title={view === "analysis" && mode === "question" ? "AI 对话" : currentPage.title}
        navigation={navigation}
        sourceControl={sourcePicker}
        displayName={user.displayName || user.username}
        roleLabel={user.role === "admin" ? "管理员" : user.role === "user" ? "教师" : "只读账号"}
        demo={datasetId === "demo"}
        drawerOpen={sidebarOpen}
        drawerRef={sidebar}
        onDrawerChange={setSidebarOpen}
        onOverview={() => {
          changeMode("metrics");
          navigate("overview");
        }}
        onAccount={() => navigate("account")}
        onLogout={requestLogout}
        settingsActive={view === "admin"}
        onAdmin={
          user.role === "admin" && !passwordChangeRequired
            ? () => {
                setAdminInitialTab(undefined);
                navigate("admin");
              }
            : undefined
        }
      />
      <div className="workbench-main">
        <main
          id="main-content"
          className="workbench-content"
          aria-labelledby={
            view === "analysis" && mode === "question"
              ? "conversation-heading"
              : "workspace-heading"
          }
        >
          {view !== "overview" && (
            <div
              className={`workbench-page-heading ${view === "analysis" && mode === "question" ? conversationStyles.workspaceHeading : ""}`}
            >
              {pageHeader}
            </div>
          )}
          <div key={view} className="view-surface">
            {view !== "analysis" && notice}
            {view === "overview" &&
              (capabilities.canUseAI ? (
                <LearningOverview
                  heading={pageHeader}
                  sourceControl={null}
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
              ) : (
                <ReadonlyOverview
                  heading={pageHeader}
                  sourceControl={null}
                  profile={selectedProfile}
                  profilesLoading={profilesLoading}
                  profilesError={profilesError}
                  onAnalyze={() => navigate("analysis")}
                  onData={() => navigate("data")}
                />
              ))}
            {view === "analysis" &&
              (mode === "question" ? (
                <ConversationWorkspace
                  historyActivity={
                    conversation?.lastTurn?.status === "running" ? (
                      <p className="notice" role="status">
                        这个会话有一轮分析尚未结束，刷新历史可查看最新状态。
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void openConversation(conversation.id)}
                        >
                          刷新状态
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void stopConversation()}
                        >
                          停止这轮分析
                        </button>
                      </p>
                    ) : null
                  }
                  onRetrySave={(id) => void retryConversationPersistence(id)}
                  conversationId={conversation?.id ?? null}
                  sourceControl={null}
                  history={{
                    entries: conversationHistory.map((entry) => ({
                      ...entry,
                      lastMessageAt: Date.parse(entry.updatedAt),
                      expiresAt: Date.parse(entry.expiresAt),
                    })),
                    selectedId: conversation?.id ?? null,
                    loading: historyLoading || historySelecting,
                    error: historyError,
                    hasMore: Boolean(historyCursor),
                    onMore: () => {
                      if (historyCursor) void refreshConversationHistory(historyCursor);
                    },
                    onRefresh: () => void refreshConversationHistory(),
                    onSelect: (id) => void openConversation(id),
                    onDelete: (id) => void deleteConversation(id),
                    onNew: newConversation,
                  }}
                  messages={chatMessages}
                  question={question}
                  loading={askLoading}
                  pendingQuestion={pendingQuestion}
                  pendingSteps={pendingSteps}
                  aiReady={aiReady}
                  aiAllowed={capabilities.canUseAI}
                  canRun={canRun}
                  canExport={capabilities.canExport}
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
                  onConfigure={
                    user.role === "admin"
                      ? () => {
                          setAdminInitialTab("ai");
                          navigate("admin");
                        }
                      : undefined
                  }
                  notice={notice}
                  onStop={() => void stopConversation()}
                  onClearContext={() => {
                    setChatContext(null);
                    resetConversationContext.current = true;
                  }}
                  onClear={newConversation}
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
                              options={
                                [
                                  { value: "score", label: "成绩" },
                                  { value: "activity", label: "活跃次数" },
                                  { value: "completion_rate", label: "完成率" },
                                ].filter((item) =>
                                  availableMetrics.includes(item.value as Metric),
                                ) as { value: Metric; label: string }[]
                              }
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
                  {showChartStudio && eligibleDatasetId ? (
                    <ChartStudio key={eligibleDatasetId} datasetId={eligibleDatasetId} api={api} />
                  ) : showPanorama && eligibleDatasetId ? (
                    <CoursePanorama
                      key={eligibleDatasetId}
                      datasetId={eligibleDatasetId}
                      api={api}
                    />
                  ) : showRelations && eligibleDatasetId ? (
                    <CourseRelations
                      key={eligibleDatasetId}
                      datasetId={eligibleDatasetId}
                      api={api}
                    />
                  ) : showDistribution && eligibleDatasetId ? (
                    <ScoreDistribution
                      key={eligibleDatasetId}
                      datasetId={eligibleDatasetId}
                      api={api}
                    />
                  ) : (
                    <AnalysisResultView
                      result={visibleResult}
                      chartType={chartType}
                      onChartChange={setChartType}
                      loading={loading}
                      onReport={previewReport}
                      canExport={capabilities.canExport}
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
                canExport={capabilities.canExport}
              />
            )}
            {view === "admin" && user.role === "admin" && (
              <AdminPanel
                user={user}
                initialTab={adminInitialTab}
                onSessionExpired={() => expire("登录已过期，请重新登录。")}
              />
            )}
            {view === "account" && (
              <>
                <div className="settings-section-label" data-enter="fade">
                  我的账号
                </div>
                <AccountPanel
                  user={user}
                  passwordChangeRequired={passwordChangeRequired}
                  onPasswordChanged={() => expire("密码已更新，请重新登录。")}
                  onSessionExpired={() => expire("登录已过期，请重新登录。")}
                />
              </>
            )}
          </div>
          <footer
            className={`workbench-footer ${view === "analysis" && mode === "question" ? conversationStyles.conversationFooter : ""}`}
          >
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
