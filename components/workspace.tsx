"use client";

import { LightField } from "@/components/light-field";
import { ProductBrand } from "@/components/product-brand";

import { MotionToggle, useMotionPreferences } from "@/components/ui/motion-preferences";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/components/app-icons";
import { conceptHref, parseConceptLocation, type ConceptLocation } from "@/lib/exploration/concepts";
import { workspaceHref, workspaceParams, type WorkspaceView as View, type WorkspacePrimary as Primary } from "@/lib/navigation";
import { LoginScreen } from "@/components/login-screen";
import { BootScreen, WorkspaceSkeleton } from "@/components/workspace-loading";
import { AccountPanel } from "@/components/workspace-account-panel";
import { DataSourceDetails } from "@/components/workspace-data-source-details";
import { NETWORK_ERROR_MESSAGE, requestMessage } from "@/components/workspace-request";
import { ReportCenter, type SessionAnalysis } from "@/components/workspace-report-center";
import { ConversationWorkspace, type ConversationTurn } from "@/components/ai-conversation";
import type { ConversationScrollPosition } from "@/components/hooks/use-conversation-scroll";
import experienceStyles from "@/components/conversation-experience.module.css";
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
import { describeChatContext } from "@/lib/ai/context-label";
import type { AnalysisResult, DataSource, DatasetProfile } from "@/lib/analysis/types";
import {
  capabilitiesFor,
  datasetAccessKey,
  isDatasetEligible,
  isPasswordChangeRequired,
  sessionScopeKey,
} from "@/lib/client-capabilities";
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
const DataExplorer = dynamic(
  () => import("@/components/data-explorer").then((module) => module.DataExplorer),
  { loading: () => <WorkspaceSkeleton label="正在打开数据浏览…" /> },
);
/** Direction of the workspace transition shared with CSS. */
type ViewTransition = "primary-forward" | "primary-back" | "deeper" | "back";
type AIStatus = { configured: boolean; enabled: boolean; model: string | null };

type FailedAsk = { question: string; code: string | null; retryable: boolean };
/**
 * A history/新建/推荐问题 request held back until the reader decides what
 * happens to the unsent draft. It carries only the target, so nothing is
 * aborted, cleared or fetched before the decision.
 */
type DraftIntent =
  | { kind: "open"; id: string }
  | { kind: "new" }
  | { kind: "ask"; question: string };
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
const analysisKey = (result: AnalysisResult) =>
  JSON.stringify([
    result.datasetId,
    result.metricLabel,
    result.dimensions ?? [result.dimension],
    result.query,
  ]);

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
const pageInfo: Record<View, { title: string; description: string }> = {
  overview: { title: "数据浏览", description: "从真实图表出发，逐层查看学习数据。" },
  analysis: { title: "AI 对话", description: "连续提问、核对数据，把教学线索追问清楚。" },
  reports: { title: "分析报告", description: "预览和导出本次会话中的分析结果。" },
  admin: { title: "系统管理", description: "配置 AI 连接、使用预算与工作台账号。" },
  account: { title: "设置", description: "查看账号信息，管理登录密码与工作台偏好。" },
};

function sourceStatusLabel(profile: DatasetProfile): string {
  if (profile.enabled === false && !profile.available) return "（已停用 · 源文件不可用）";
  if (profile.enabled === false) return "（已停用）";
  if (!profile.available) return "（源文件不可用）";
  return "";
}

function sameSessionPresentation(left: SessionUser, right: SessionUser): boolean {
  return (
    sessionScopeKey(left) === sessionScopeKey(right) &&
    left.username === right.username &&
    left.displayName === right.displayName
  );
}

export function Workspace({ initialConversation = false }: { initialConversation?: boolean } = {}) {
  const motionPreference = useMotionPreferences();
  const explorationLocation = useRef("/explore");
  const explorationState = useRef<Record<string, unknown> | null>(null);
  const conversationScroll = useRef(0);
  /**
   * Per-conversation transcript reading positions shared with the AI screen.
   * The map is session state: it must be cleared whenever the signed-in scope is
   * replaced, or a new account would inherit a stale offset.
   */
  const readingPositions = useRef<Map<string, ConversationScrollPosition> | null>(null);
  if (!readingPositions.current) readingPositions.current = new Map();
  const [workspaceRouteError, setWorkspaceRouteError] = useState("");
  const rememberExplorationLocation = useCallback((href: string) => {
    explorationLocation.current = href;
  }, []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [bootError, setBootError] = useState("");
  const [view, setView] = useState<View>("overview");
  const viewRef = useRef<View>("overview");
  const [primary, setPrimary] = useState<Primary>("explore");
  const [transition, setTransition] = useState<ViewTransition | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const [adminTabRequest, setAdminTabRequest] = useState<{
    tab: "overview" | "ai" | "account";
    sequence: number;
  }>({ tab: "overview", sequence: 0 });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const logoutDialog = useRef<HTMLDialogElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const draftGuardDialog = useRef<HTMLDialogElement>(null);
  /** The control that opened the draft confirmation, so cancelling returns there. */
  const draftGuardTrigger = useRef<HTMLElement | null>(null);
  const [draftIntent, setDraftIntent] = useState<DraftIntent | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
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
  const [question, setQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ConversationTurn[]>([]);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const conversationRef = useRef<ConversationSummary | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationSummary[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  /**
   * The entry whose detail read failed. The list can only retry that entry, not
   * re-open it by refreshing the index, so the message carries its own action.
   */
  const [historyFailedId, setHistoryFailedId] = useState<string | null>(null);
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
  const [browseContext, setBrowseContext] = useState<{
    label: string;
    location: ConceptLocation;
    href: string;
    datasetId: DataSource;
  } | null>(null);
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
  const generation = useRef(0);
  /**
   * Which conversation the reader is currently looking at. Starting an ask, opening
   * history, starting a new conversation or changing source is a new epoch, so an
   * asynchronous round-trip only applies to the epoch it was started in. A late
   * stop response must never overwrite a newer turn or a newer draft.
   */
  const conversationEpoch = useRef(0);
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
  const aiReady = aiStatus.configured && aiStatus.enabled;
  const aiAllowed = capabilities.canUseAI && canRun;
  /** Reports, account and admin are subordinate to whichever primary opened them. */
  const subordinate = view === "reports" || view === "admin" || view === "account";

  const rememberResult = useCallback((result: AnalysisResult) => {
    const key = analysisKey(result);
    setSessionAnalyses((previous) =>
      [{ key, result }, ...previous.filter((entry) => entry.key !== key)].slice(0, 20),
    );
  }, []);

  function invalidateConversationHistory() {
    historyGeneration.current++;
    historySelectionPending.current = false;
    setHistorySelecting(false);
    setHistoryLoading(false);
  }

  const expire = useCallback((notice: string | null = null) => {
    explorationLocation.current = "/explore";
    explorationState.current = null;
    conversationScroll.current = 0;
    readingPositions.current?.clear();
    setWorkspaceRouteError("");
    generation.current++;
    conversationEpoch.current++;
    sessionSyncPending.current?.controller.abort();
    sessionSyncPending.current = null;
    askPending.current?.abort();
    askPending.current = null;
    setLoginNotice(notice);
    setConversationHistory([]);
    setHistoryCursor(null);
    setHistoryError(null);
    setHistoryFailedId(null);
    setUser(null);
    userScope.current = "";
    setProfiles([]);
    profilesLoaded.current = false;
    setProfilesLoading(false);
    setProfilesError(null);
    setDatasetId(null);
    profileAccessKey.current = "";
    setSessionAnalyses([]);
    setSelectedReportKey("");
    conversationRef.current = null;
    setConversation(null);
    pendingTurn.current = null;
    invalidateConversationHistory();
    setChatMessages([]);
    setPendingQuestion("");
    setPendingSteps([]);
    setChatContext(null);
    setBrowseContext(null);
    setExpandedChartId(null);
    setQuestion("");
    setError(null);
    setInputError(null);
    setFailedAsk(null);
    setAskLoading(false);
    sidebar.current?.hidePopover();
    logoutDialog.current?.close();
    // An unsent-draft confirmation belongs to the scope that raised it; signing
    // out must not leave it open over the sign-in screen.
    setDraftIntent(null);
    setSidebarOpen(false);
    setPrimary("explore");
    setTransition(null);
    setView("overview");
  }, []);

  const clearScopedState = useCallback(
    (nextView: View = "overview", notice: string | null = null) => {
      explorationLocation.current = "/explore";
      explorationState.current = null;
      conversationScroll.current = 0;
      // A different signed-in scope must never inherit another account's reader
      // positions: the map is keyed by conversation id, not by account.
      readingPositions.current?.clear();
      setWorkspaceRouteError("");
      generation.current++;
      conversationEpoch.current++;
      askPending.current?.abort();
      askPending.current = null;
      setConversationHistory([]);
      setHistoryCursor(null);
      setHistoryError(null);
      setHistoryFailedId(null);
      setProfiles([]);
      profilesLoaded.current = false;
      setProfilesLoading(true);
      setProfilesError(null);
      setDatasetId(null);
      profileAccessKey.current = "";
      setAIStatus({ configured: false, enabled: false, model: null });
      setSessionAnalyses([]);
      setSelectedReportKey("");
      conversationRef.current = null;
      setConversation(null);
      pendingTurn.current = null;
      invalidateConversationHistory();
      setChatMessages([]);
      setPendingQuestion("");
      setPendingSteps([]);
      setChatContext(null);
      setBrowseContext(null);
      setExpandedChartId(null);
      setQuestion("");
      setError(null);
      setInputError(null);
      setFailedAsk(null);
      setAskLoading(false);
      setDraftIntent(null);
      setLoginNotice(notice);
      setPrimary(nextView === "analysis" ? "conversation" : "explore");
      setTransition(null);
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
          setPrimary("explore");
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
      if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    },
    [],
  );
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    if (!user || view === "overview") return;
    pageHeading.current?.focus({ preventScroll: true });
    // Returning to the AI primary keeps the reader where the conversation was.
    window.scrollTo(0, view === "analysis" ? conversationScroll.current : 0);
  }, [view, user]);
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
  useEffect(() => {
    if (bootLoading || !user || passwordChangeRequired) return;
    const replaceHref = (href: string) => {
      if (window.location.pathname + window.location.search !== href)
        window.history.replaceState(window.history.state, "", href);
    };
    const restoreLocation = () => {
      if (viewRef.current === "analysis") conversationScroll.current = window.scrollY;
      const params = workspaceParams(window.location.href);
      const requested = params.get("workspace");
      const views: View[] = ["overview", "analysis", "reports", "admin", "account"];
      const legacyAnalysis = requested === "analysis" && params.get("mode") === "metrics";
      const invalid =
        params.getAll("workspace").length > 1 ||
        (requested !== null && requested !== "data" && !views.includes(requested as View));
      // The standalone metric page and the old data page no longer exist. Both
      // URLs redirect to browsing instead of rendering a hidden legacy screen.
      if (requested === "data" || legacyAnalysis || invalid) {
        setWorkspaceRouteError(invalid ? "页面地址无效，请从数据浏览重新开始。" : "");
        replaceHref("/explore");
        setPrimary("explore");
        setView("overview");
        return;
      }
      // `/admin`, `?workspace=admin` and a browser history entry kept from a
      // wider grant all resolve here. A signed-in non-admin gets browsing and an
      // explanation instead of an empty management page; the API keeps its own
      // authorization and is never broadened by this redirect.
      if (requested === "admin" && user.role !== "admin") {
        // Reuse the dismissible workspace notice rather than blocking browsing:
        // the reader is already being returned to a page they may use.
        setError("当前账号不是管理员，已返回数据浏览。");
        setWorkspaceRouteError("");
        replaceHref("/explore");
        setPrimary("explore");
        setView("overview");
        return;
      }
      setWorkspaceRouteError("");
      const next: View =
        (requested as View | null) ??
        (params.has("browse") || !initialConversation ? "overview" : "analysis");
      const requestedPrimary = params.get("primary");
      const nextPrimary: Primary =
        next === "overview"
          ? "explore"
          : next === "analysis"
            ? "conversation"
            : requestedPrimary === "explore" || requestedPrimary === "conversation"
              ? requestedPrimary
              : next === "reports"
                ? "conversation"
                : "explore";
      if (next !== "analysis") {
        askPending.current?.abort();
        askPending.current = null;
        setAskLoading(false);
      }
      setPrimary(nextPrimary);
      setView(next);
      if (next !== "overview") replaceHref(workspaceHref(next, nextPrimary));
      if (next === "overview") {
        const route = parseConceptLocation(window.location.href);
        if (route.status === "valid" && route.datasetId) setDatasetId(route.datasetId);
      }
    };
    restoreLocation();
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [initialConversation, bootLoading, user?.id, user?.role, passwordChangeRequired]);

  const api = useCallback(
    async (url: string, options?: RequestInit, onStep?: (step: AnalysisStep) => void) => {
      // A rejected session is judged by the signed-in scope, not by chat
      // navigation: moving between conversations or sources must not keep a dead
      // login alive, and a scope that was already replaced must not expire again.
      const scope = userScope.current;
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
        if (scope === userScope.current) expire("登录已过期，请重新登录。");
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
      setHistoryFailedId(null);
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

  /**
   * Applies one conversation read from the API. `draft` decides what happens to
   * the composer: a history open clears it, while a stop round-trip only clears
   * the question it stopped and keeps anything typed since.
   */
  function applyConversationDetail(
    detail: ConversationDetail,
    options: {
      restored?: boolean;
      draft?: "clear" | { clearIfUnchanged: string };
    } = {},
  ) {
    const { restored = true, draft = "clear" } = options;
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
    setBrowseContext(null);
    resetConversationContext.current = false;
    setPendingSteps([]);
    setPendingQuestion("");
    setAskLoading(false);
    setExpandedChartId(null);
    if (draft === "clear") setQuestion("");
    else setQuestion((current) => (current === draft.clearIfUnchanged ? "" : current));
    setError(null);
    setFailedAsk(null);
  }
  async function openConversation(id: string) {
    const draftAtSelection = question;
    askPending.current?.abort();
    askPending.current = null;
    generation.current++;
    conversationEpoch.current++;
    invalidateConversationHistory();
    const current = historyGeneration.current;
    const scope = userScope.current;
    historySelectionPending.current = true;
    setHistorySelecting(true);
    setAskLoading(false);
    setHistoryError(null);
    setHistoryFailedId(null);
    try {
      const detail = (await api(`/api/conversations/${id}`)) as ConversationDetail;
      if (current !== historyGeneration.current || scope !== userScope.current) return;
      pendingTurn.current = null;
      applyConversationDetail(detail, { draft: { clearIfUnchanged: draftAtSelection } });
    } catch (error) {
      if (current === historyGeneration.current && scope === userScope.current) {
        // Nothing was applied, so the conversation on screen and the draft stay
        // as they were; only the announcement changes. The failed entry is kept
        // so the message can retry that read instead of reloading the index.
        const message = requestMessage(error, "对话已过期、已删除或当前无权访问。");
        if (message) {
          setHistoryFailedId(id);
          setHistoryError(message);
        }
      }
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
      if (scope === userScope.current) {
        setHistoryFailedId(null);
        setHistoryError(requestMessage(error, "删除失败，请重试。"));
      }
    }
  }
  function newConversation() {
    setBrowseContext(null);
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
    conversationEpoch.current++;
    invalidateConversationHistory();
    conversationRef.current = null;
    setConversation(null);
    pendingTurn.current = null;
    setChatMessages([]);
    setPendingSteps([]);
    setChatContext(null);
    setExpandedChartId(null);
    setQuestion("");
    setError(null);
    setInputError(null);
    setFailedAsk(null);
    setAskLoading(false);
    resetConversationContext.current = false;
    setHistoryLoading(false);
  }
  function runDraftIntent(intent: DraftIntent) {
    if (intent.kind === "open") {
      void openConversation(intent.id);
      return;
    }
    if (intent.kind === "ask") {
      // The confirmed question replaces the draft and is what gets sent; the
      // composer text follows it so nothing typed earlier lingers behind.
      void ask(intent.question);
      return;
    }
    // A confirmed reset discards the draft even when there is no conversation
    // yet, which `newConversation` treats as a display-only no-op.
    if (question.trim()) setQuestion("");
    newConversation();
  }
  /**
   * One confirmation surface for every action that would drop an unsent draft:
   * the history list, the history list's 新建 button, the composer's 新对话 and
   * the recommended/follow-up questions all pass through here, and nothing is
   * aborted or cleared before the answer.
   */
  function requestDraftIntent(intent: DraftIntent) {
    const hasDraft = question.trim().length > 0;
    // A suggestion identical to the draft loses nothing by sending it.
    if (intent.kind === "ask" && question === intent.question) {
      runDraftIntent(intent);
      return;
    }
    const needsDecision =
      intent.kind === "open"
        ? hasDraft
        : intent.kind === "ask"
          ? hasDraft
          : hasDraft || chatMessages.length > 0;
    if (!needsDecision) {
      runDraftIntent(intent);
      return;
    }
    draftGuardTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraftIntent(intent);
  }
  function settleDraftIntent(accept: boolean) {
    const intent = draftIntent;
    setDraftIntent(null);
    if (accept && intent) runDraftIntent(intent);
  }
  /** Cancelling or confirming returns focus to wherever the request came from. */
  function restoreDraftGuardFocus() {
    const trigger = draftGuardTrigger.current;
    draftGuardTrigger.current = null;
    // The trigger can be gone or behind a closed history drawer, and the focused
    // textarea can be inside a folded composer, so fall through to whatever the
    // conversation screen still shows.
    const candidates: (Element | null | undefined)[] = [
      trigger,
      document.getElementById("analysis-question"),
      ...Array.from(document.querySelectorAll('[data-workspace-part="collapseToggle"]')),
      document.getElementById("conversation-heading"),
    ];
    candidates
      .find(
        (candidate): candidate is HTMLElement =>
          candidate instanceof HTMLElement &&
          candidate.isConnected &&
          candidate.getClientRects().length > 0,
      )
      ?.focus({ preventScroll: true });
  }
  /** Alternate entry points open the same dropdown and focus its first control. */
  function openTools() {
    const menu = sidebar.current;
    if (!menu) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    requestAnimationFrame(() =>
      menu.querySelector<HTMLElement>('select, button:not([disabled])')?.focus({ preventScroll: true }),
    );
  }
  function accountMenuItems() {
    const menu = accountMenu.current;
    if (!menu) return [];
    return Array.from(
      menu.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }
  /**
   * `role="menu"` owes the reader roving arrow keys, Home/End, Escape back to
   * the trigger, and a close once Tab leaves.
   */
  function handleAccountMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = accountMenuItems();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      accountMenu.current?.hidePopover();
      accountTrigger.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Tab") {
      // Let the browser move focus first, then dismiss: hiding a popover that
      // still holds focus would strand the tab cycle on the body.
      window.setTimeout(() => accountMenu.current?.hidePopover(), 0);
    }
  }
  useEffect(() => {
    const dialog = draftGuardDialog.current;
    if (!dialog) return;
    if (draftIntent && !dialog.open) dialog.showModal();
    else if (!draftIntent && dialog.open) dialog.close();
  }, [draftIntent]);

  useEffect(() => {
    if (!user || passwordChangeRequired) {
      setProfilesLoading(false);
      return;
    }
    const controller = new AbortController();
    // This load is owned by this effect and the signed-in scope only. Chat and
    // browse navigation bump the shared generation for their own requests;
    // discarding an authorized data-source load because the reader opened a
    // conversation would leave the workbench loading until some later refresh.
    const scope = sessionScopeKey(user);
    const showLoading = !profilesLoaded.current;
    if (showLoading) setProfilesLoading(true);
    setProfilesError(null);
    api("/api/profile", { signal: controller.signal })
      .then((payload) => {
        if (
          controller.signal.aborted ||
          scope !== userScope.current ||
          !Array.isArray(payload.datasets)
        )
          return;
        const nextProfiles = payload.datasets as DatasetProfile[];
        const nextKey = datasetAccessKey(nextProfiles);
        if (profileAccessKey.current !== "" && profileAccessKey.current !== nextKey) {
          generation.current++;
          setSessionAnalyses([]);
          setSelectedReportKey("");
          conversationRef.current = null;
          setConversation(null);
          pendingTurn.current = null;
          invalidateConversationHistory();
          setChatMessages([]);
          setPendingQuestion("");
          setPendingSteps([]);
          setChatContext(null);
          setBrowseContext(null);
          setExpandedChartId(null);
          setQuestion("");
          setError(null);
          setInputError(null);
          setFailedAsk(null);
          setAskLoading(false);
        }
        profileAccessKey.current = nextKey;
        profilesLoaded.current = true;
        setProfiles(nextProfiles);
        setDatasetId((previous) => {
          const route = parseConceptLocation(window.location.href);
          if (
            route.status === "valid" &&
            route.datasetId &&
            workspaceParams(window.location.href).get("workspace") !== "analysis"
          ) {
            return route.datasetId;
          }
          const previousProfile = nextProfiles.find((profile) => profile.id === previous);
          if (previousProfile && isDatasetEligible(previousProfile)) return previous;
          return nextProfiles.find(isDatasetEligible)?.id ?? nextProfiles[0]?.id ?? null;
        });
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && scope === userScope.current) {
          profilesLoaded.current = false;
          setProfiles([]);
          setDatasetId(null);
          setProfilesError(requestMessage(requestError, "数据源读取失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && scope === userScope.current) {
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
    // AI availability belongs to this effect and the signed-in scope, not to the
    // chat generation: a conversation the reader opens must not strand the check.
    const scope = sessionScopeKey(user);
    api("/api/ai/status", { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted && scope === userScope.current)
          setAIStatus({
            configured: Boolean(payload.configured),
            enabled: capabilities.canUseAI && Boolean(payload.enabled),
            model: typeof payload.model === "string" && payload.model ? payload.model : null,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted && scope === userScope.current)
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
  function changeSource(value: DataSource) {
    if (view === "overview") window.dispatchEvent(new Event("exploration:leave"));
    generation.current++;
    conversationEpoch.current++;
    askPending.current?.abort();
    askPending.current = null;
    readingPositions.current?.clear();
    setDatasetId(value);
    if (view === "overview") {
      const href = conceptHref({ scene: "home", drawing: "rank" }, value);
      explorationLocation.current = href;
      explorationState.current = null;
      const state = { ...window.history.state, explorationScroll: 0 };
      delete state.explorationHistory;
      delete state.concept;
      window.history.pushState(state, "", href);
      setWorkspaceRouteError("");
    }
    conversationRef.current = null;
    setConversation(null);
    pendingTurn.current = null;
    invalidateConversationHistory();
    setChatMessages([]);
    setPendingSteps([]);
    setChatContext(null);
    setBrowseContext(null);
    setExpandedChartId(null);
    setAskLoading(false);
    setError(null);
    setInputError(null);
    setFailedAsk(null);
  }
  const playTransition = useCallback(
    (kind: ViewTransition) => {
      if (!motionPreference.enabled || motionPreference.reduced) {
        setTransition(null);
        return;
      }
      delete document.documentElement.dataset.motionReplayGuard;
      setTransition(kind);
      if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(() => setTransition(null), 420);
    },
    [motionPreference.enabled, motionPreference.reduced],
  );
  /** Primary entries, subordinate pages, and their shared URL/history contract. */
  function navigate(next: View, options: { origin?: Primary; back?: boolean } = {}) {
    if (passwordChangeRequired && next !== "account") return;
    const nextPrimary: Primary =
      next === "overview"
        ? "explore"
        : next === "analysis"
          ? "conversation"
          : (options.origin ?? primary);
    if (next === view && nextPrimary === primary) {
      if (next === "overview" && workspaceRouteError) setWorkspaceRouteError("");
      sidebar.current?.hidePopover();
      return;
    }
    if (view === "analysis" && next !== "analysis") conversationScroll.current = window.scrollY;
    if (view === "overview" && next !== "overview") {
      // Saving happens synchronously in DataExplorer's listener; capture the
      // resulting state so returning restores the same reading position.
      window.dispatchEvent(new Event("exploration:leave"));
      explorationState.current = { ...window.history.state };
    }
    const wasSubordinate =
      view === "reports" || view === "admin" || view === "account";
    const primarySeries =
      next === "overview" ? "explore" : next === "analysis" ? "conversation" : null;
    let kind: ViewTransition = "deeper";
    if (options.back) kind = "back";
    else if (primarySeries && nextPrimary !== primary)
      kind = nextPrimary === "conversation" ? "primary-forward" : "primary-back";
    else if (wasSubordinate && primarySeries) kind = "back";
    const href = next === "overview" ? explorationLocation.current : workspaceHref(next, nextPrimary);
    if (window.location.pathname + window.location.search !== href) {
      const state = { ...window.history.state };
      if (next === "overview" && explorationState.current) {
        Object.assign(state, explorationState.current);
      } else {
        // Legacy keys only need scrubbing when entering a non-browse entry.
        delete state.explorationHistory;
        delete state.explorationScroll;
      }
      window.history.pushState(state, "", href);
    }
    if (next !== "analysis") {
      askPending.current?.abort();
      askPending.current = null;
      setAskLoading(false);
    }
    setPrimary(nextPrimary);
    setView(next);
    if (next === "overview") setWorkspaceRouteError("");
    sidebar.current?.hidePopover();
    setError(null);
    playTransition(kind);
  }
  function openExplore() {
    // Leaving the AI primary still resolves a running turn, as before.
    if (view === "analysis" && askPending.current) void stopConversation();
    navigate("overview");
  }
  function returnToPrimary() {
    navigate(primary === "conversation" ? "analysis" : "overview", { back: true });
  }
  function previewReport(result: AnalysisResult) {
    rememberResult(result);
    setSelectedReportKey(analysisKey(result));
    navigate("reports", { origin: "conversation" });
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
    const inputQuestion = nextQuestion.trim();
    const activeBrowseContext = !options.fresh && browseContext?.datasetId === currentDatasetId ? browseContext : null;
    const prefix = activeBrowseContext ? `当前浏览：${activeBrowseContext.label}。请按这个数据范围重新查询，不把关系视为因果。问题：` : "";
    const trimmed = prefix + inputQuestion;
    if (inputQuestion.length < 2 || trimmed.length > 500) {
      const message = prefix
        ? `请写下 2–${Math.max(2, 500 - prefix.length)} 字的问题，当前浏览范围会一同带入。`
        : "请写下 2–500 字的分析问题。";
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
      invalidateConversationHistory();
      setChatMessages([]);
      setChatContext(null);
      setBrowseContext(null);
      setExpandedChartId(null);
      setPendingSteps([]);
    }
    conversationEpoch.current++;
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
      if (activeBrowseContext) setBrowseContext(previous => previous === activeBrowseContext ? null : previous);
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
        question: inputQuestion,
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
    /**
     * A stop round-trip can finish long after the reader has moved on. Only the
     * conversation, turn epoch and revision this stop named may be reconciled,
     * and only while no newer ask owns the composer; the draft it may clear is
     * exactly the text it stopped, never something typed since.
     */
    const stopped = {
      epoch: conversationEpoch.current,
      id: selectedId,
      revision: selected?.revision,
      turnId,
      draft: question,
    };
    const stillStopped = () =>
      conversationEpoch.current === stopped.epoch &&
      !askPending.current &&
      conversationRef.current?.id === stopped.id &&
      conversationRef.current?.revision === stopped.revision;
    askPending.current?.abort();
    askPending.current = null;
    setAskLoading(false);
    setPendingSteps([]);
    if (!turnId || !selectedId) return;
    try {
      await api(`/api/conversations/${selectedId}/stop`, {
        method: "POST",
        body: JSON.stringify({ turnId: stopped.turnId }),
      });
      if (!stillStopped()) return;
      const detail = (await api(`/api/conversations/${selectedId}`)) as ConversationDetail;
      // The reconciliation must describe the turn this stop named, never another one.
      if (!stillStopped() || !detail.turns.some((turn) => turn.id === stopped.turnId)) return;
      applyConversationDetail(detail, {
        restored: false,
        draft: { clearIfUnchanged: stopped.draft },
      });
      pendingTurn.current = null;
      void refreshConversationHistory();
    } catch (error) {
      if (stillStopped())
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
  if (bootLoading) return <BootScreen />;
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
  const currentPage = pageInfo[view];
  const retryableAsk =
    failedAsk && failedAsk.retryable && view === "analysis" ? failedAsk : null;
  const notice = error && (
    <div className="notice notice-error global-notice" role="alert" data-enter="fade">
      <Icon name="info" size={18} />
      <span>{error}</span>
      {retryableAsk && (
        <button
          type="button"
          className="text-button"
          disabled={askLoading}
          onClick={() => {
            setError(null);
            setFailedAsk(null);
            requestDraftIntent({ kind: "ask", question: retryableAsk.question });
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
  const primaryNavigation = passwordChangeRequired ? (
    <nav className="workspace-primary-nav glass-mode-switch" aria-label="工作台主入口">
      <button type="button" aria-current="page" onClick={() => navigate("account")}>
        修改密码
      </button>
    </nav>
  ) : (
    <nav className="workspace-primary-nav glass-mode-switch" aria-label="工作台主入口" data-glass-pane="0.08">
      <button
        type="button"
        data-primary-entry="explore"
        aria-current={primary === "explore" ? "page" : undefined}
        data-glass-relief={primary === "explore" ? "0.85" : undefined}
        onClick={openExplore}
      >
        <Icon name="chart" size={15} />
        <span>数据浏览</span>
      </button>
      <button
        type="button"
        data-primary-entry="conversation"
        aria-current={primary === "conversation" ? "page" : undefined}
        data-glass-relief={primary === "conversation" ? "0.85" : undefined}
        disabled={!capabilities.canUseAI}
        title={!capabilities.canUseAI ? "当前账号没有 AI 使用权限" : undefined}
        aria-describedby={!capabilities.canUseAI ? "workspace-primary-ai-reason" : undefined}
        onClick={() => navigate("analysis")}
      >
        <Icon name="sparkles" size={15} />
        <span>AI 对话</span>
        {!capabilities.canUseAI && (
          <span className="workspace-primary-note" aria-hidden="true">
            无权限
          </span>
        )}
      </button>
      {!capabilities.canUseAI && (
        <span id="workspace-primary-ai-reason" className="sr-only">
          当前账号没有 AI 使用权限
        </span>
      )}
      <span id="conversation-history-anchor" className="workspace-history-anchor" />
    </nav>
  );
  const pageHeader = (
    <div className="page-introduction" key={`header-${view}`}>
      <span className="page-eyebrow" data-enter="wipe">
        {view === "overview" ? "01 / DATA EXPLORATION" : "学析台 / LEARNING WORKSPACE"}
      </span>
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
  const draftGuardRounds = chatMessages.filter((message) => message.role === "user").length;
  const draftGuardHasDraft = question.trim().length > 0;
  const draftGuardCopy = draftIntent
    ? draftGuardHasDraft
      ? {
          eyebrow: "DRAFT / 未发送草稿",
          title: "草稿还没有发送",
          description:
            draftIntent.kind === "open"
              ? "切换到所选对话会丢弃这段草稿；已保存的对话不会被删除。"
              : draftIntent.kind === "ask"
                ? "发送这个问题会丢弃这段草稿；已保存的对话不会被删除。"
                : "新建对话会丢弃这段草稿；已保存的对话不会被删除。",
          cancel: "保留草稿",
          confirm: draftIntent.kind === "ask" ? "丢弃草稿并发送" : "丢弃草稿并继续",
        }
      : {
          eyebrow: "SESSION / 新建对话",
          title: "离开当前对话？",
          description: `当前 ${draftGuardRounds} 轮对话已保存，仍可在历史中继续。新建对话只会清空这一屏。`,
          cancel: "取消",
          confirm: "新建对话",
        }
    : null;
  const sourcePicker = !passwordChangeRequired && (
    <label
      className="workbench-source"
      key={`source-${view}`}
      data-enter="rise-sm"
      style={{ "--enter-delay": "240ms" } as CSSProperties}
    >
      <span>
        <Icon name="database" size={14} />
        当前数据源
      </span>
      {/* Only an eligible dataset may present itself as current: a stored but
          unusable source (e.g. 演示数据 without permission) reads as "none". */}
      <select
        aria-label="选择当前数据源"
        value={eligibleDatasetId ?? ""}
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
            {!eligibleDatasetId && <option value="">请选择可用数据源</option>}
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
      className={`graphite-workspace workbench-shell glass-workspace ${experienceStyles.shell}`}
      data-view={view}
      data-primary={primary}
      data-conversation={view === "analysis" || undefined}
      data-exploration={view === "overview" || undefined}
      data-navigation-motion={transition ? "" : undefined}
      data-transition={transition ?? undefined}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      {view !== "overview" && (
        <LightField
          drifting={motionPreference.enabled && !motionPreference.reduced}
        />
      )}
      <header className="workbench-header glass-topbar">
        <div className="glass-entry">
          <button
            type="button"
            className="glass-brand"
            aria-label="返回数据浏览"
            onClick={openExplore}
          >
            <ProductBrand />
          </button>
          {primaryNavigation}
        </div>
        <div className="glass-tools" data-glass-pane="0.08">
          {eligibleDatasetId === "demo" && (
            <span className="glass-demo-tag">合成校园数据</span>
          )}
          {view === "analysis" && (
            <button
              type="button"
              className="workspace-report-trigger"
              aria-label="分析报告"
              onClick={() => navigate("reports", { origin: "conversation" })}
            >
              <Icon name="file" size={15} />
              <span>分析报告</span>
              {sessionAnalyses.length > 0 && <small>{sessionAnalyses.length}</small>}
            </button>
          )}
          <button
            type="button"
            className="icon-button glass-menu"
            aria-label={sidebarOpen ? "收起工具" : "打开工具"}
            aria-expanded={sidebarOpen}
            aria-controls="workspace-navigation"
            aria-haspopup="dialog"
            ref={toolsTrigger}
            popoverTarget="workspace-navigation"
            onClick={() => {
              if (sidebar.current?.matches(":popover-open")) return;
              requestAnimationFrame(() =>
                sidebar.current?.querySelector<HTMLElement>('select, button:not([disabled])')?.focus({ preventScroll: true }),
              );
            }}
          >
            <Icon name="menu" size={18} />
          </button>
          <button
            type="button"
            className="glass-account"
            ref={accountTrigger}
            aria-label="账号与偏好"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            title={user.displayName || user.username}
            popoverTarget="account-menu"
            onClick={() => {
              if (accountMenu.current?.matches(":popover-open")) return;
              // Chrome leaves focus on the invoker. A menu has to start on its
              // first item, otherwise arrows, Home/End and Escape never reach it.
              requestAnimationFrame(() =>
                accountMenuItems()[0]?.focus({ preventScroll: true }),
              );
            }}
          >
            <span className="glass-avatar">{Array.from(user.displayName || user.username)[0]}</span>
            <span className="glass-user-name">{user.displayName || user.username}</span>
          </button>
          <div
            id="account-menu"
            ref={accountMenu}
            className="account-menu workspace-header-popover"
            popover="auto"
            role="menu"
            aria-label="账号与偏好"
            onKeyDown={handleAccountMenuKey}
            onToggle={(event) => setAccountMenuOpen(event.newState === "open")}
            onBlur={(event) => {
              if (event.relatedTarget instanceof Node &&
                  event.relatedTarget !== accountTrigger.current &&
                  !event.currentTarget.contains(event.relatedTarget))
                event.currentTarget.hidePopover();
            }}
          >
            <div className="account-menu-head">
              <strong>{user.displayName || user.username}</strong>
              <span>
                {user.role === "admin" ? "管理员" : "教师"} · {user.username}
              </span>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                accountMenu.current?.hidePopover();
                if (user.role === "admin" && !passwordChangeRequired) {
                  setAdminTabRequest((current) => ({
                    tab: "account",
                    sequence: current.sequence + 1,
                  }));
                  navigate("admin");
                } else {
                  navigate("account");
                }
              }}
            >
              <Icon name="users" size={16} />
              我的账号
            </button>
            {user.role === "admin" && !passwordChangeRequired && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  accountMenu.current?.hidePopover();
                  setAdminTabRequest((current) => ({
                    tab: "overview",
                    sequence: current.sequence + 1,
                  }));
                  navigate("admin");
                }}
              >
                <Icon name="settings" size={16} />
                系统管理
              </button>
            )}
            <hr />
            <div className="account-menu-motion"><MotionToggle /></div>
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                accountMenu.current?.hidePopover();
                requestLogout();
              }}
            >
              <Icon name="logout" size={16} />
              退出登录
            </button>
          </div>
        </div>
      </header>
      <aside
        id="workspace-navigation"
        ref={sidebar}
        className="workspace-tools-menu workspace-header-popover"
        popover="auto"
        onToggle={(event) => setSidebarOpen(event.newState === "open")}
        role="dialog"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          event.preventDefault();
          sidebar.current?.hidePopover();
          toolsTrigger.current?.focus({ preventScroll: true });
        }}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node &&
              event.relatedTarget !== toolsTrigger.current &&
              !event.currentTarget.contains(event.relatedTarget))
            event.currentTarget.hidePopover();
        }}
        aria-label="工作台工具"
      >
        <div className="drawer-heading">
          <span className="drawer-label">工具</span>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭工具"
            popoverTarget="workspace-navigation"
            popoverTargetAction="hide"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {!passwordChangeRequired && (
          <div className="workspace-utilities">
            <span className="drawer-label">数据源与口径</span>
            {sourcePicker}
            <DataSourceDetails profile={selectedProfile} />
          </div>
        )}
        <div className="drawer-footnote">
          <Icon name="shield" size={14} />
          <span>学析台 · 学习数据分析</span>
        </div>
      </aside>
      <div
        className="workbench-main"
        data-glass-pane={view === "analysis" ? undefined : "0.35"}
      >
        <main
          id="main-content"
          className="workbench-content"
          aria-labelledby={
            view === "analysis"
              ? "conversation-heading"
              : view === "overview"
                ? undefined
                : "workspace-heading"
          }
        >
          {subordinate ? (
            <div className="workbench-page-heading workspace-secondary-heading">
              {!passwordChangeRequired && (
                <button type="button" className="workspace-back" onClick={returnToPrimary}>
                  <Icon name="chevron" size={15} />
                  {primary === "conversation" ? "返回 AI 对话" : "返回数据浏览"}
                </button>
              )}
              {pageHeader}
            </div>
          ) : null}
          <div className="workspace-scene" data-scene={view} data-primary={primary}>
            {view !== "analysis" && notice}
            {view === "overview" && (
              <div className="workspace-primary-scene" data-primary-scene="explore">
                {workspaceRouteError ? (
                  <div role="alert" className="exploration-state">
                    <h1>找不到这个位置</h1>
                    <p>{workspaceRouteError}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        explorationLocation.current = "/explore";
                        explorationState.current = null;
                        setWorkspaceRouteError("");
                        navigate("overview");
                      }}
                    >
                      回到数据浏览
                    </button>
                  </div>
                ) : profilesLoading ? (
                  <WorkspaceSkeleton label="正在读取授权数据源…" />
                ) : canRun && eligibleDatasetId && selectedProfile ? (
                  <DataExplorer
                    key={`${sessionScopeKey(user)}:${eligibleDatasetId}:${selectedProfile.datasetVersion ?? ""}`}
                    datasetId={eligibleDatasetId}
                    profile={selectedProfile}
                    scopeKey={`${sessionScopeKey(user)}:${eligibleDatasetId}:${selectedProfile.datasetVersion ?? ""}`}
                    api={api}
                    onLocationChange={rememberExplorationLocation}
                    canUseAI={capabilities.canUseAI}
                    onAI={(context) => {
                      if (!capabilities.canUseAI) return;
                      setBrowseContext({ ...context, datasetId: eligibleDatasetId });
                      navigate("analysis", { origin: "conversation" });
                    }}
                  />
                ) : (
                  <div role="status" className="exploration-state">
                    <h1>暂时无法浏览这份数据</h1>
                    <p>
                      {profilesError ||
                        (selectedProfile
                          ? `${selectedProfile.name}${sourceStatusLabel(selectedProfile)}。请选择可用数据源。`
                          : "这份数据不存在或当前账号没有访问权限。请选择已授权数据源。")}
                    </p>
                    <p>
                      选择一个当前账号可用的数据源后才能继续浏览；没有可用数据源时请联系管理员授权。
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      aria-expanded={sidebarOpen}
                      aria-controls="workspace-navigation"
                      onClick={() => openTools()}
                    >
                      打开数据源工具
                    </button>
                  </div>
                )}
              </div>
            )}
            {primary === "conversation" && (view === "analysis" || subordinate) && (
              <div
                className="workspace-primary-scene"
                data-primary-scene="conversation"
                hidden={view !== "analysis"}
              >
                <ConversationWorkspace
                  historyActivity={
                    conversation?.lastTurn?.status === "running" ? (
                      <p className="notice" role="status">
                        这个会话有一轮分析尚未结束，刷新历史可查看最新状态。
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => requestDraftIntent({ kind: "open", id: conversation.id })}
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
                  history={{
                    entries: conversationHistory.map((entry) => ({
                      ...entry,
                      lastMessageAt: Date.parse(entry.updatedAt),
                      expiresAt: Date.parse(entry.expiresAt),
                    })),
                    selectedId: conversation?.id ?? null,
                    loading: historyLoading || historySelecting,
                    error: historyError,
                    failedId: historyFailedId,
                    onRetry: (id) => requestDraftIntent({ kind: "open", id }),
                    hasMore: Boolean(historyCursor),
                    onMore: () => {
                      if (historyCursor) void refreshConversationHistory(historyCursor);
                    },
                    onRefresh: () => void refreshConversationHistory(),
                    onSelect: (id) => requestDraftIntent({ kind: "open", id }),
                    onDelete: (id) => void deleteConversation(id),
                    onNew: () => requestDraftIntent({ kind: "new" }),
                  }}
                  readingPositions={readingPositions.current ?? undefined}
                  messages={chatMessages}
                  question={question}
                  loading={askLoading}
                  pendingQuestion={pendingQuestion}
                  pendingSteps={pendingSteps}
                  aiReady={aiReady}
                  datasetId={eligibleDatasetId}
                  aiAllowed={capabilities.canUseAI}
                  canRun={canRun}
                  canExport={capabilities.canExport}
                  contextLabel={browseContext?.datasetId === eligibleDatasetId ? `当前浏览 · ${browseContext.label}` : describeChatContext(chatContext)}
                  inputError={inputError}
                  expandedChartId={expandedChartId}
                  onQuestionChange={(value) => {
                    setQuestion(value);
                    if (inputError) setInputError(null);
                  }}
                  onAsk={(next) => void ask(next)}
                  onSuggestion={(next) => requestDraftIntent({ kind: "ask", question: next })}
                  sendBlocked={historySelecting}
                  onExpandChart={setExpandedChartId}
                  onChartChange={changeChatView}
                  onReport={previewReport}
                  onConfigure={
                    user.role === "admin"
                      ? () => {
                          setAdminTabRequest((current) => ({
                            tab: "ai",
                            sequence: current.sequence + 1,
                          }));
                          navigate("admin");
                        }
                      : undefined
                  }
                  notice={notice}
                  onStop={() => void stopConversation()}
                  onClearContext={() => {
                    if (browseContext?.datasetId === eligibleDatasetId) {
                      setBrowseContext(null);
                      return;
                    }
                    setChatContext(null);
                    resetConversationContext.current = true;
                  }}
                  onClear={() => requestDraftIntent({ kind: "new" })}
                />
              </div>
            )}
            {subordinate && (
              <div className="workspace-subordinate-scene" data-subordinate={view}>
                {view === "reports" && (
                  <ReportCenter
                    analyses={sessionAnalyses}
                    selectedKey={selectedReportKey}
                    onSelect={setSelectedReportKey}
                    onStart={() =>
                      navigate("analysis", { origin: "conversation", back: true })
                    }
                    canExport={capabilities.canExport}
                  />
                )}
                {view === "admin" && user.role === "admin" && (
                  <AdminPanel
                    user={user}
                    tabRequest={adminTabRequest}
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
      <dialog
        ref={draftGuardDialog}
        className="logout-confirmation"
        aria-labelledby="draft-guard-title"
        aria-describedby="draft-guard-description"
        onCancel={(event) => {
          event.preventDefault();
          settleDraftIntent(false);
        }}
        onClose={restoreDraftGuardFocus}
      >
        <span className="page-eyebrow">{draftGuardCopy?.eyebrow}</span>
        <h2 id="draft-guard-title">{draftGuardCopy?.title}</h2>
        <p id="draft-guard-description">{draftGuardCopy?.description}</p>
        <div className="logout-confirmation-actions">
          <button type="button" className="secondary-button" onClick={() => settleDraftIntent(false)}>
            {draftGuardCopy?.cancel}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => settleDraftIntent(true)}
          >
            {draftGuardCopy?.confirm}
          </button>
        </div>
      </dialog>
    </div>
  );
}
