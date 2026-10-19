"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type {
  AIBudgets,
  AIConfig,
  AIConfigResponse,
  AICostStats,
  AITestResponse,
  SessionUser,
} from "@/lib/client-types";
import { Icon } from "@/components/app-icons";
import { AdminManagement } from "@/components/admin-management";
import { AnimatedNumber, useCountUp } from "@/components/ui/animated-number";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ThemeToggle } from "@/components/ui/theme-provider";
import { MotionToggle } from "@/components/ui/motion-preferences";
import { AnalysisControls } from "@/components/analysis-controls";
import { BAILIAN_QWEN_FLASH, isBailianQwenFlash } from "@/lib/ai/bailian";
import { ZHIPU_GLM_FLASH, isZhipuGLMFlash } from "@/lib/ai/zhipu";

type AdminTab = "overview" | "users" | "datasets" | "logs" | "ai" | "account";
type Feedback = { kind: "success" | "error"; message: string } | null;
/** Inline custom properties carry entrance delays defined by app/motion.css. */
type MotionStyle = CSSProperties & { [key: `--${string}`]: string };
type ConfigDraft = {
  enabled: boolean;
  apiFormat: AIConfig["apiFormat"];
  baseUrl: string;
  model: string;
  apiKey: string;
  budgets: Record<keyof AIBudgets, string>;
  inputPrice: string;
  outputPrice: string;
};

const budgetFields: { key: keyof AIBudgets; label: string }[] = [
  { key: "perRequest", label: "每次调用" },
  { key: "perHour", label: "每小时" },
  { key: "perDay", label: "每天" },
  { key: "perMonth", label: "每 30 天" },
];

function makeDraft(config: AIConfig): ConfigDraft {
  return {
    enabled: config.enabled,
    apiFormat: config.apiFormat,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: "",
    budgets: {
      perRequest: String(config.budgets.perRequest),
      perHour: String(config.budgets.perHour),
      perDay: String(config.budgets.perDay),
      perMonth: String(config.budgets.perMonth),
    },
    inputPrice:
      config.pricing.inputPerMillion === null ? "" : String(config.pricing.inputPerMillion),
    outputPrice:
      config.pricing.outputPerMillion === null ? "" : String(config.pricing.outputPerMillion),
  };
}

function requestMessage(error: unknown, fallback: string): string {
  return error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof TypeError)
    ? error.message
    : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function FeedbackNotice({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <div
      className={`notice notice-${feedback.kind}`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      <Icon name={feedback.kind === "error" ? "info" : "check"} />
      <span>{feedback.message}</span>
    </div>
  );
}

/** Cost labels keep their fixed 4-decimal shape while counting from zero. */
function AnimatedCost({ value }: { value?: string }) {
  const amount = value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value);
  const display = useCountUp(amount);
  if (amount === undefined) return <>—</>;
  return <>${(display ?? amount).toFixed(4)}</>;
}

export function AdminPanel({
  user,
  onSessionExpired,
}: {
  user: SessionUser;
  onSessionExpired: () => void;
}) {
  const [tab, setTab] = useState<AdminTab>(user.role === "admin" ? "overview" : "account");
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [stats, setStats] = useState<AICostStats | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configFeedback, setConfigFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const sessionExpired = useRef(onSessionExpired);
  const active = useRef(true);
  const pendingRequests = useRef(new Set<AbortController>());

  useEffect(() => {
    sessionExpired.current = onSessionExpired;
  }, [onSessionExpired]);

  // Layout setup runs before passive child fetches. This closes the Strict Mode
  // replay window where AdminManagement could observe the parent's cleanup flag.
  useLayoutEffect(() => {
    active.current = true;
    const requests = pendingRequests.current;
    return () => {
      active.current = false;
      requests.forEach((controller) => controller.abort());
      requests.clear();
    };
  }, []);

  const request = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    if (!active.current) throw new DOMException("Request cancelled", "AbortError");
    const controller = new AbortController();
    const externalSignal = options?.signal;
    const cancel = () => controller.abort();
    if (externalSignal?.aborted) cancel();
    else externalSignal?.addEventListener("abort", cancel, { once: true });
    pendingRequests.current.add(controller);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        ...options,
        signal: controller.signal,
      });
      // A response from a closed panel must never expire a newly opened session.
      if (!active.current || controller.signal.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      if (response.status === 401) {
        sessionExpired.current();
        throw new Error("登录已过期，请重新登录。");
      }
      const payload = (await response.json()) as T & { error?: string };
      if (!active.current || controller.signal.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      if (!response.ok) throw new Error(payload.error || "操作失败，请稍后重试。");
      return payload;
    } finally {
      pendingRequests.current.delete(controller);
      externalSignal?.removeEventListener("abort", cancel);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigFeedback(null);
    let cancelled = false;
    try {
      const payload = await request<AIConfigResponse>("/api/admin/ai-config");
      setConfig(payload.config);
      setDraft(makeDraft(payload.config));
      setStats(payload.stats);
    } catch (error) {
      if (!active.current || isAbortError(error)) {
        cancelled = true;
        return;
      }
      setConfigFeedback({
        kind: "error",
        message: requestMessage(error, "设置加载失败，请稍后重试。"),
      });
    } finally {
      if (active.current && !cancelled) setConfigLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const hasChanges = Boolean(
    draft && config && JSON.stringify(draft) !== JSON.stringify(makeDraft(config)),
  );
  const pricesConfigured = Boolean(
    config && config.pricing.inputPerMillion !== null && config.pricing.outputPerMillion !== null,
  );
  const canTest = Boolean(
    config?.enabled &&
    config.keyConfigured &&
    pricesConfigured &&
    !hasChanges &&
    !saving &&
    !testing,
  );

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving || testing) return;
    setConfigFeedback(null);
    const budgets = Object.fromEntries(
      budgetFields.map(({ key }) => [key, Number(draft.budgets[key])]),
    ) as AIBudgets;
    if (
      budgetFields.some(
        ({ key }) =>
          !draft.budgets[key].trim() || !Number.isFinite(budgets[key]) || budgets[key] <= 0,
      )
    ) {
      setConfigFeedback({ kind: "error", message: "调用预算需要填写大于 0 的金额。" });
      return;
    }
    const pricing = {
      inputPerMillion: draft.inputPrice.trim() === "" ? null : Number(draft.inputPrice),
      outputPerMillion: draft.outputPrice.trim() === "" ? null : Number(draft.outputPrice),
    };
    if (
      Object.values(pricing).some(
        (value) => value !== null && (!Number.isFinite(value) || value < 0),
      )
    ) {
      setConfigFeedback({
        kind: "error",
        message: "模型单价需要填写大于或等于 0 的金额，也可以留空。",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = await request<AIConfigResponse>("/api/admin/ai-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          apiFormat: draft.apiFormat,
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(),
          budgets,
          pricing,
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        }),
      });
      setConfig(payload.config);
      setDraft(makeDraft(payload.config));
      setStats(payload.stats);
      setConfigFeedback({ kind: "success", message: "AI 设置已保存，后续调用会使用这些配置。" });
    } catch (error) {
      setConfigFeedback({
        kind: "error",
        message: requestMessage(error, "设置保存失败，请稍后重试。"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!canTest) return;
    setTesting(true);
    setConfigFeedback(null);
    try {
      const payload = await request<AITestResponse>("/api/admin/ai-test", { method: "POST" });
      setStats(payload.stats);
      setConfigFeedback({
        kind: "success",
        message: payload.message || "连接成功，AI 已返回有效结果。此次测试已计入用量。",
      });
    } catch (error) {
      setConfigFeedback({
        kind: "error",
        message: requestMessage(error, "AI 连接测试失败，请检查设置。"),
      });
    } finally {
      setTesting(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changingPassword) return;
    if (passwords.next !== passwords.confirm) {
      setPasswordFeedback({ kind: "error", message: "两次输入的新密码不一致，请重新确认。" });
      return;
    }
    setChangingPassword(true);
    setPasswordFeedback(null);
    try {
      await request("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.next }),
      });
      setPasswords({ current: "", next: "", confirm: "" });
      sessionExpired.current();
    } catch (error) {
      setPasswordFeedback({
        kind: "error",
        message: requestMessage(error, "密码修改失败，请稍后重试。"),
      });
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="admin-panel">
      <nav
        className="admin-tabs"
        aria-label="管理设置"
        data-enter="rise-sm"
        style={{ "--enter-delay": "20ms" } as MotionStyle}
      >
        <SegmentedControl<AdminTab>
          label="管理分类"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "系统总览", icon: <Icon name="dashboard" size={18} /> },
            { value: "users", label: "账号管理", icon: <Icon name="users" size={18} /> },
            { value: "datasets", label: "数据集", icon: <Icon name="database" size={18} /> },
            { value: "logs", label: "操作日志", icon: <Icon name="activity" size={18} /> },
            { value: "ai", label: "AI 设置", icon: <Icon name="sparkles" size={18} /> },
            { value: "account", label: "我的账号", icon: <Icon name="shield" size={18} /> },
          ]}
        />
      </nav>

      {tab === "overview" && <AdminManagement request={request} user={user} section="overview" />}
      {tab === "users" && <AdminManagement request={request} user={user} section="users" />}
      {tab === "datasets" && <AdminManagement request={request} user={user} section="datasets" />}
      {tab === "logs" && <AdminManagement request={request} user={user} section="logs" />}

      {tab === "ai" && (
        <>
          <div
            className="admin-intro"
            data-enter="rise-sm"
            style={{ "--enter-delay": "60ms" } as MotionStyle}
          >
            <div>
              <h2>让 AI 按你的设置工作</h2>
              <p>在这里连接模型、控制用量，再开放给工作台用户。</p>
            </div>
            <span
              className={`badge ${config?.enabled && config.keyConfigured && pricesConfigured ? "badge-success" : "badge-muted"}`}
            >
              <span className="status-dot" />
              {configLoading
                ? "正在读取设置"
                : !config
                  ? "设置未读取"
                  : config.enabled && config.keyConfigured && pricesConfigured
                    ? "AI 已开启"
                    : "AI 尚未就绪"}
            </span>
          </div>
          <FeedbackNotice feedback={configFeedback} />
          {configLoading ? (
            <div className="panel admin-state" role="status">
              <Icon name="refresh" />
              正在读取 AI 设置…
            </div>
          ) : !draft || !config ? (
            <div className="panel admin-state">
              <p>暂时无法读取 AI 设置。</p>
              <button type="button" className="secondary-button" onClick={() => void loadConfig()}>
                <Icon name="refresh" size={16} />
                重新加载
              </button>
            </div>
          ) : (
            <div
              className="admin-config-layout"
              data-enter="fade"
              style={
                {
                  "--enter-delay": "100ms",
                  "--enter-dur": "var(--motion-enter-fast)",
                } as MotionStyle
              }
            >
              <form
                className="panel admin-config-main"
                onSubmit={saveConfig}
                aria-busy={saving || testing}
                data-enter-group="rise"
                style={{ "--enter-group-delay": "160ms" } as MotionStyle}
              >
                <div className="admin-form-section">
                  <div className="admin-section-heading">
                    <div>
                      <h3>模型连接</h3>
                      <p>密钥保存在服务端，页面不会显示已有密钥。</p>
                    </div>
                    <Icon name="link" size={21} />
                  </div>
                  <label className="admin-toggle" htmlFor="admin-ai-enabled">
                    <span>
                      <strong>允许 AI 分析</strong>
                      <span>开启后，用户可以用自然语言提问。</span>
                    </span>
                    <input
                      id="admin-ai-enabled"
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                      disabled={saving || testing}
                    />
                  </label>
                  <div className="admin-provider-presets">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || testing}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          ...ZHIPU_GLM_FLASH,
                          apiKey: "",
                          inputPrice: "0",
                          outputPrice: "0",
                        });
                        setConfigFeedback(null);
                      }}
                    >
                      使用智谱 GLM-4.7-Flash（免费）
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || testing}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          ...BAILIAN_QWEN_FLASH,
                          apiKey: "",
                          inputPrice: "",
                          outputPrice: "",
                        });
                        setConfigFeedback(null);
                      }}
                    >
                      使用百炼 Qwen3.8 Flash（北京）
                    </button>
                  </div>
                  <p className="form-help">
                    选择预设后填入对应平台的密钥并保存。地址、模型、单价和预算仍可自行修改。
                  </p>
                  <div className="admin-form-grid">
                    <div className="form-field">
                      <label htmlFor="admin-ai-format">接口协议</label>
                      <select
                        id="admin-ai-format"
                        value={draft.apiFormat}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            apiFormat: event.target.value as AIConfig["apiFormat"],
                          })
                        }
                        disabled={saving || testing}
                      >
                        <option value="responses">OpenAI Responses</option>
                        <option value="chat_completions">兼容 Chat Completions</option>
                      </select>
                      <span className="form-help">按服务商文档选择接口格式。</span>
                    </div>
                    <div className="form-field">
                      <label htmlFor="admin-ai-base-url">API 基础地址</label>
                      <input
                        id="admin-ai-base-url"
                        type="url"
                        value={draft.baseUrl}
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                        placeholder="留空使用 OpenAI 官方地址"
                        maxLength={2048}
                        disabled={saving || testing}
                      />
                      <span className="form-help">
                        填写 HTTPS 基础地址，例如 https://服务商域名/v1；不要包含
                        /chat/completions。
                      </span>
                    </div>
                    <div className="form-field">
                      <label htmlFor="admin-ai-model">模型名称</label>
                      <input
                        id="admin-ai-model"
                        value={draft.model}
                        onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                        placeholder="填写服务商提供的模型名称"
                        required
                        maxLength={100}
                        disabled={saving || testing}
                      />
                      <span className="form-help">填写与你的 API 密钥对应的模型。</span>
                    </div>
                    <div className="form-field">
                      <label htmlFor="admin-ai-key">
                        API 密钥{" "}
                        <span
                          className={`badge ${config.keyConfigured ? "badge-success" : "badge-muted"}`}
                        >
                          {config.keyConfigured ? "已配置" : "未配置"}
                        </span>
                      </label>
                      <input
                        id="admin-ai-key"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={draft.apiKey}
                        onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                        placeholder={
                          config.keyConfigured ? "留空则保留已有密钥" : "粘贴你的 API 密钥"
                        }
                        maxLength={500}
                        disabled={saving || testing}
                      />
                      <span className="form-help">
                        输入新密钥会替换已有密钥；更换接口域名或端口时，必须重新填写对应的密钥。
                      </span>
                    </div>
                  </div>
                </div>
                <AnalysisControls
                  request={request}
                  connectionReady={canTest}
                  config={config}
                  onUsageChange={() => {
                    void request<AIConfigResponse>("/api/admin/ai-config")
                      .then((value) => setStats(value.stats))
                      .catch(() => {});
                  }}
                />
                <div className="admin-form-section">
                  <div className="admin-section-heading">
                    <div>
                      <h3>费用估算</h3>
                      <p>按服务商的模型单价填写，单位为美元 / 百万 token。</p>
                    </div>
                    <Icon name="chart" size={21} />
                  </div>
                  <div className="admin-form-grid">
                    <div className="form-field">
                      <label htmlFor="admin-input-price">输入单价（USD / 百万 token）</label>
                      <input
                        id="admin-input-price"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={draft.inputPrice}
                        onChange={(event) => setDraft({ ...draft, inputPrice: event.target.value })}
                        placeholder="请按服务商价格填写"
                        disabled={saving || testing}
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="admin-output-price">输出单价（USD / 百万 token）</label>
                      <input
                        id="admin-output-price"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={draft.outputPrice}
                        onChange={(event) =>
                          setDraft({ ...draft, outputPrice: event.target.value })
                        }
                        placeholder="请按服务商价格填写"
                        disabled={saving || testing}
                      />
                    </div>
                  </div>
                  <p className="form-help">
                    token 是模型处理文字的计量单位。填写单价后才允许 AI 调用，账单金额以服务商为准。
                  </p>
                  {isBailianQwenFlash(draft) && (
                    <p className="form-help">
                      百炼人民币单价需先换算为美元再填写：人民币单价 ÷
                      每美元对应的人民币金额。免费额度不代表单价为
                      0；额度与扣费限制请在百炼控制台设置。
                    </p>
                  )}
                  {isZhipuGLMFlash(draft) && (
                    <p className="form-help">
                      智谱当前将 GLM-4.7-Flash 的输入和输出单价列为免费，预设填写
                      0；仍记录调用次数和 token 用量。免费服务受平台限流约束，价格调整后请更新单价。
                    </p>
                  )}
                </div>
                <div className="admin-form-section">
                  <div className="admin-section-heading">
                    <div>
                      <h3>调用预算</h3>
                      <p>达到对应上限后暂停 AI 调用，帮助控制支出。</p>
                    </div>
                    <Icon name="sliders" size={21} />
                  </div>
                  <div
                    className="admin-budget-grid"
                    data-enter-group="rise"
                    style={{ "--enter-group-delay": "360ms" } as MotionStyle}
                  >
                    {budgetFields.map(({ key, label }) => (
                      <div className="form-field" key={key}>
                        <label htmlFor={`admin-budget-${key}`}>{label}（USD）</label>
                        <input
                          id={`admin-budget-${key}`}
                          type="number"
                          min="0.000001"
                          step="any"
                          inputMode="decimal"
                          required
                          value={draft.budgets[key]}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              budgets: { ...draft.budgets, [key]: event.target.value },
                            })
                          }
                          disabled={saving || testing}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="admin-form-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving || testing || !hasChanges}
                  >
                    <Icon name="check" size={17} />
                    {saving ? "正在保存…" : "保存设置"}
                  </button>
                  <span>{hasChanges ? "有尚未保存的修改" : "当前设置已保存"}</span>
                </div>
              </form>
              <aside
                className="admin-config-side"
                data-enter-group="rise"
                style={{ "--enter-group-delay": "240ms" } as MotionStyle}
              >
                <section className="panel">
                  <div className="panel-header">
                    <h3 className="panel-title">用量与费用</h3>
                    <span className="badge badge-muted">估算</span>
                  </div>
                  <div
                    className="admin-stats"
                    data-enter-group="rise"
                    style={{ "--enter-group-delay": "380ms" } as MotionStyle}
                  >
                    <div className="admin-stat">
                      <span>累计调用</span>
                      <strong>
                        <AnimatedNumber value={stats?.totalCalls} fallback="—" />
                        <small> 次</small>
                      </strong>
                    </div>
                    <div className="admin-stat">
                      <span>实测 / 估算调用</span>
                      <strong>
                        实测 <AnimatedNumber value={stats?.measuredCalls} fallback="—" />
                        <small> 次 · </small>
                        估算 <AnimatedNumber value={stats?.estimatedCalls} fallback="—" />
                        <small> 次</small>
                      </strong>
                    </div>
                    <div className="admin-stat">
                      <span>估算费用占比</span>
                      <strong>
                        <AnimatedNumber
                          value={stats === null ? undefined : stats.estimatedShare * 100}
                          fallback="—"
                        />
                        <small> %</small>
                      </strong>
                    </div>
                    <div className="admin-stat">
                      <span>近 24 小时</span>
                      <strong>
                        <AnimatedCost value={stats?.last24Hours.totalCost} />
                        <small> USD</small>
                      </strong>
                    </div>
                    <div className="admin-stat">
                      <span>近 1 小时</span>
                      <strong>
                        <AnimatedCost value={stats?.lastHour.totalCost} />
                        <small> USD</small>
                      </strong>
                    </div>
                  </div>
                  <p className="form-help">
                    实测指服务商返回了 usage 的调用；估算指网络失败或未返回
                    usage、按请求内容估算的调用（估算费用合计 ${stats?.estimatedCost ?? "—"}
                    ）。费用均按填写的单价估算，用量包含连接测试，以服务商账单为准。
                  </p>
                </section>
                <section className="panel">
                  <div className="panel-header">
                    <h3 className="panel-title">检查连接</h3>
                    <Icon name="link" size={20} />
                  </div>
                  <p className="form-help">保存设置后，发送一次请求，确认模型可以正常返回结果。</p>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canTest}
                    onClick={() => void testConnection()}
                  >
                    <Icon name="refresh" size={17} />
                    {testing ? "正在测试…" : "测试连接"}
                  </button>
                  <p className="form-help">
                    将实际调用 AI 并产生费用。
                    {hasChanges
                      ? "请先保存修改。"
                      : !config.enabled
                        ? "请先开启 AI。"
                        : !config.keyConfigured
                          ? "请先配置密钥。"
                          : !pricesConfigured
                            ? "请先填写输入与输出单价。"
                            : ""}
                  </p>
                </section>
              </aside>
            </div>
          )}
        </>
      )}

      {tab === "account" && (
        <>
          <div
            className="admin-intro"
            data-enter="rise-sm"
            style={{ "--enter-delay": "60ms" } as MotionStyle}
          >
            <div>
              <h2>管理你的登录信息</h2>
              <p>定期更新密码，保护工作台和团队数据。</p>
            </div>
          </div>
          <FeedbackNotice feedback={passwordFeedback} />
          <div
            className="admin-user-layout"
            data-enter-group="rise"
            style={{ "--enter-group-delay": "140ms" } as MotionStyle}
          >
            <section className="panel admin-account-card">
              <div className="admin-user-avatar">
                {(user.displayName || user.username).slice(0, 1)}
              </div>
              <h3>{user.displayName}</h3>
              <p>{user.username}</p>
              <span className="badge badge-muted">
                {user.role === "admin"
                  ? "管理员"
                  : user.role === "readonly"
                    ? "只读用户"
                    : "分析用户"}
              </span>
              <div className="notice notice-info">
                <Icon name="shield" />
                <span>
                  {user.role === "admin"
                    ? "你的账号可以管理账号、数据集与 AI 设置，请妥善保管登录信息。"
                    : "请妥善保管登录信息，并只访问已授权的数据集。"}
                </span>
              </div>
              <div className="account-appearance">
                <h3>外观与动效</h3>
                <ThemeToggle />
                <MotionToggle />
              </div>
            </section>
            <form className="panel" onSubmit={changePassword} aria-busy={changingPassword}>
              <div className="panel-header">
                <h3 className="panel-title">修改密码</h3>
                <Icon name="lock" size={20} />
              </div>
              <div className="form-field">
                <label htmlFor="admin-current-password">当前密码</label>
                <input
                  id="admin-current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={passwords.current}
                  onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
                  disabled={changingPassword}
                />
              </div>
              <div className="form-field">
                <label htmlFor="admin-next-password">新密码</label>
                <input
                  id="admin-next-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={passwords.next}
                  onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
                  placeholder="至少 12 个字符"
                  disabled={changingPassword}
                />
              </div>
              <div className="form-field">
                <label htmlFor="admin-confirm-password">再次输入新密码</label>
                <input
                  id="admin-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={passwords.confirm}
                  onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                  disabled={changingPassword}
                />
              </div>
              <p className="form-help">修改后，你在所有设备上都会退出，需要使用新密码重新登录。</p>
              <button className="primary-button" type="submit" disabled={changingPassword}>
                <Icon name="check" size={17} />
                {changingPassword ? "正在修改…" : "保存新密码并重新登录"}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
