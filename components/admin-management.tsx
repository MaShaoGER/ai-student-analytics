"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { DatasetId, ManagedUser, SessionUser, UserRole } from "@/lib/client-types";
import { datasetIdSchema } from "@/lib/datasets/id";
import type { GradeDataset, GradeVersion } from "@/lib/datasets/grade-contract";
import { Icon } from "@/components/app-icons";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GradeImport } from "@/components/grade-import";
import styles from "./admin-management.module.css";

export type AdminManagementSection = "overview" | "users" | "datasets" | "logs";
type AdminRequest = <T>(url: string, options?: RequestInit) => Promise<T>;
type MetricsWindow = "today" | "7d" | "30d";
type Feedback = { kind: "success" | "error"; message: string } | null;

type OverviewResponse = {
  window: MetricsWindow;
  updatedAt: string;
  range: { start: string; end: string; timezone: "Asia/Shanghai" };
  accounts: {
    total: number;
    active: number;
    disabled: number;
    byRole: { admin: number; user: number; readonly: number };
    mustChangePassword: number;
  };
  datasets: { total: number; enabled: number; available: number; unavailable: number };
  requests: {
    total: number;
    success: number;
    partial: number;
    failure: number;
    successRate: number | null;
    partialRate: number | null;
    failureRate: number | null;
    legacyWithoutRequestId: number;
    durationMs: { p95: number | null; samples: number };
  };
  ai: {
    calls: number;
    estimatedCalls: number;
    measuredCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    estimated: true;
  };
  coverage: {
    records: {
      scanned: number;
      valid: number;
      malformed: number;
      legacy: number;
      truncatedTail: boolean;
    };
    costHistory: { status: "ok" | "missing" | "invalid"; records: number; malformed: number };
    limitations: string[];
  };
};

type DatasetEntry = {
  id: DatasetId;
  name: string;
  owner: string;
  enabled: boolean;
  available: boolean;
  version: string;
  source: string;
  capabilities: string[];
  unavailableReason?: string;
  grade?: {
    currentVersion: string;
    versions: GradeVersion[];
  };
};

type AccountsResponse = {
  users: ManagedUser[];
  total: number;
  page: number;
  pageSize: number;
};

type LogSource = "accounts" | "datasets" | "grades" | "ai-config" | "analysis-settings";
type AuditLog = {
  version: 1;
  id: string;
  timestamp: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: Record<string, string | number | boolean | null>;
  result: "success" | "failure";
  errorCode?: string;
  requestId?: string;
  source: LogSource;
};
type LogsResponse = {
  events: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    from: string | null;
    to: string | null;
    actorId: string | null;
    action: string | null;
    result: "success" | "failure" | null;
  };
  coverage: {
    sources: Array<{
      source: LogSource;
      status: "ok" | "missing" | "invalid";
      events: number;
      legacy: number;
    }>;
  };
};

type ConfirmAction = {
  title: string;
  description: string;
  label: string;
  tone?: "danger";
  run: () => Promise<void>;
};

const roleLabels: Record<UserRole, string> = {
  admin: "管理员",
  user: "分析用户",
  readonly: "只读用户",
};
const sourceLabels: Record<LogSource, string> = {
  accounts: "账号",
  datasets: "数据集",
  grades: "导入数据",
  "ai-config": "AI 配置",
  "analysis-settings": "分析设置",
};
const targetTypeLabels: Record<string, string> = {
  user: "账号",
  dataset: "数据集",
  "ai-config": "AI 配置",
  "analysis-settings": "分析设置",
};
const actionLabels: Record<string, string> = {
  "user.admin_initialize": "初始化管理员",
  "user.create": "创建账号",
  "user.disabled": "修改账号状态",
  "user.update": "更新账号",
  "user.password.reset": "重置密码",
  "user.sessions.revoke": "撤销会话",
  "dataset.status": "修改数据集状态",
  "dataset.publish": "发布成绩数据版本",
  "ai-config.update": "更新 AI 配置",
  "analysis-settings.update": "更新分析设置",
};
const knownSummaryFields = new Set([
  "rowCount",
  "studentCount",
  "courseCount",
  "termCount",
  "missingScores",
  "versionNumber",
  "role",
  "beforeRole",
  "disabled",
  "beforeDisabled",
  "enabled",
  "beforeEnabled",
  "datasetIds",
  "beforeDatasetIds",
  "nameChanged",
  "changedFields",
  "keyChanged",
  "mustChangePassword",
  "model",
  "beforeModel",
  "apiFormat",
  "beforeApiFormat",
  "perRequest",
  "beforePerRequest",
  "perHour",
  "beforePerHour",
  "perDay",
  "beforePerDay",
  "perMonth",
  "beforePerMonth",
  "inputPerMillion",
  "beforeInputPerMillion",
  "outputPerMillion",
  "beforeOutputPerMillion",
  "maxToolCalls",
  "beforeMaxToolCalls",
  "timeoutSeconds",
  "beforeTimeoutSeconds",
]);

function contractError(path: string): never {
  throw new Error(`服务返回的数据无法识别（${path}），请刷新后重试。`);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) contractError(path);
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) contractError(path);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string") contractError(path);
  return value;
}
function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) contractError(path);
  return value;
}
function integer(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path);
  if (!Number.isInteger(parsed) || parsed < 0) contractError(path);
  return parsed;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") contractError(path);
  return value;
}
function nullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : finiteNumber(value, path);
}
function optionalText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, path);
}
function role(value: unknown, path: string): UserRole {
  if (value !== "admin" && value !== "user" && value !== "readonly") contractError(path);
  return value;
}
function datasetId(value: unknown, path: string): DatasetId {
  const parsed = datasetIdSchema.safeParse(value);
  if (!parsed.success) contractError(path);
  return parsed.data;
}
function result(value: unknown, path: string): "success" | "failure" {
  if (value !== "success" && value !== "failure") contractError(path);
  return value;
}
function source(value: unknown, path: string): LogSource {
  if (
    value !== "accounts" &&
    value !== "datasets" &&
    value !== "grades" &&
    value !== "ai-config" &&
    value !== "analysis-settings"
  )
    contractError(path);
  return value;
}
function metricsWindow(value: unknown, path: string): MetricsWindow {
  if (value !== "today" && value !== "7d" && value !== "30d") contractError(path);
  return value;
}
function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => text(item, `${path}[${index}]`));
}

function parseOverview(value: unknown): OverviewResponse {
  const root = record(value, "总览");
  const range = record(root.range, "总览.range");
  const accounts = record(root.accounts, "总览.accounts");
  const roles = record(accounts.byRole, "总览.accounts.byRole");
  const datasets = record(root.datasets, "总览.datasets");
  const requests = record(root.requests, "总览.requests");
  const duration = record(requests.durationMs, "总览.requests.durationMs");
  const ai = record(root.ai, "总览.ai");
  const coverage = record(root.coverage, "总览.coverage");
  const records = record(coverage.records, "总览.coverage.records");
  const costHistory = record(coverage.costHistory, "总览.coverage.costHistory");
  if (range.timezone !== "Asia/Shanghai") contractError("总览.range.timezone");
  if (
    costHistory.status !== "ok" &&
    costHistory.status !== "missing" &&
    costHistory.status !== "invalid"
  )
    contractError("总览.coverage.costHistory.status");
  if (ai.estimated !== true) contractError("总览.ai.estimated");
  return {
    window: metricsWindow(root.window, "总览.window"),
    updatedAt: text(root.updatedAt, "总览.updatedAt"),
    range: {
      start: text(range.start, "总览.range.start"),
      end: text(range.end, "总览.range.end"),
      timezone: "Asia/Shanghai",
    },
    accounts: {
      total: integer(accounts.total, "总览.accounts.total"),
      active: integer(accounts.active, "总览.accounts.active"),
      disabled: integer(accounts.disabled, "总览.accounts.disabled"),
      byRole: {
        admin: integer(roles.admin, "总览.accounts.byRole.admin"),
        user: integer(roles.user, "总览.accounts.byRole.user"),
        readonly: integer(roles.readonly, "总览.accounts.byRole.readonly"),
      },
      mustChangePassword: integer(accounts.mustChangePassword, "总览.accounts.mustChangePassword"),
    },
    datasets: {
      total: integer(datasets.total, "总览.datasets.total"),
      enabled: integer(datasets.enabled, "总览.datasets.enabled"),
      available: integer(datasets.available, "总览.datasets.available"),
      unavailable: integer(datasets.unavailable, "总览.datasets.unavailable"),
    },
    requests: {
      total: integer(requests.total, "总览.requests.total"),
      success: integer(requests.success, "总览.requests.success"),
      partial: integer(requests.partial, "总览.requests.partial"),
      failure: integer(requests.failure, "总览.requests.failure"),
      successRate: nullableNumber(requests.successRate, "总览.requests.successRate"),
      partialRate: nullableNumber(requests.partialRate, "总览.requests.partialRate"),
      failureRate: nullableNumber(requests.failureRate, "总览.requests.failureRate"),
      legacyWithoutRequestId: integer(
        requests.legacyWithoutRequestId,
        "总览.requests.legacyWithoutRequestId",
      ),
      durationMs: {
        p95: nullableNumber(duration.p95, "总览.requests.durationMs.p95"),
        samples: integer(duration.samples, "总览.requests.durationMs.samples"),
      },
    },
    ai: {
      calls: integer(ai.calls, "总览.ai.calls"),
      estimatedCalls: integer(ai.estimatedCalls, "总览.ai.estimatedCalls"),
      measuredCalls: integer(ai.measuredCalls, "总览.ai.measuredCalls"),
      promptTokens: integer(ai.promptTokens, "总览.ai.promptTokens"),
      completionTokens: integer(ai.completionTokens, "总览.ai.completionTokens"),
      totalTokens: integer(ai.totalTokens, "总览.ai.totalTokens"),
      costUsd: finiteNumber(ai.costUsd, "总览.ai.costUsd"),
      estimated: true,
    },
    coverage: {
      records: {
        scanned: integer(records.scanned, "总览.coverage.records.scanned"),
        valid: integer(records.valid, "总览.coverage.records.valid"),
        malformed: integer(records.malformed, "总览.coverage.records.malformed"),
        legacy: integer(records.legacy, "总览.coverage.records.legacy"),
        truncatedTail: bool(records.truncatedTail, "总览.coverage.records.truncatedTail"),
      },
      costHistory: {
        status: costHistory.status,
        records: integer(costHistory.records, "总览.coverage.costHistory.records"),
        malformed: integer(costHistory.malformed, "总览.coverage.costHistory.malformed"),
      },
      limitations: stringArray(coverage.limitations, "总览.coverage.limitations"),
    },
  };
}

function parseAccount(value: unknown, path: string): ManagedUser {
  const item = record(value, path);
  const mustChangePassword = item.mustChangePassword;
  if (typeof mustChangePassword !== "boolean") contractError(`${path}.mustChangePassword`);
  return {
    id: text(item.id, `${path}.id`),
    username: text(item.username, `${path}.username`),
    displayName: text(item.displayName, `${path}.displayName`),
    role: role(item.role, `${path}.role`),
    datasetIds: array(item.datasetIds, `${path}.datasetIds`).map((id, index) =>
      datasetId(id, `${path}.datasetIds[${index}]`),
    ),
    mustChangePassword,
    disabled: bool(item.disabled, `${path}.disabled`),
    createdAt: text(item.createdAt, `${path}.createdAt`),
  };
}

function parseAccounts(value: unknown): AccountsResponse {
  const root = record(value, "账号列表");
  return {
    users: array(root.users, "账号列表.users").map((item, index) =>
      parseAccount(item, `账号列表.users[${index}]`),
    ),
    total: integer(root.total, "账号列表.total"),
    page: integer(root.page, "账号列表.page"),
    pageSize: integer(root.pageSize, "账号列表.pageSize"),
  };
}

function parseGradeVersion(value: unknown, path: string): GradeVersion {
  const item = record(value, path);
  const count = (key: string) => integer(item[key], `${path}.${key}`);
  return {
    version: text(item.version, `${path}.version`),
    createdAt: text(item.createdAt, `${path}.createdAt`),
    rowCount: count("rowCount"),
    studentCount: count("studentCount"),
    courseCount: count("courseCount"),
    termCount: count("termCount"),
    missingScores: count("missingScores"),
    hasCompletion: bool(item.hasCompletion, `${path}.hasCompletion`),
  };
}

function parseDataset(value: unknown, path: string): DatasetEntry {
  const item = record(value, path);
  const id = datasetId(item.id, `${path}.id`);
  const name = text(item.name, `${path}.name`);
  const owner = text(item.owner, `${path}.owner`);
  const enabled = bool(item.enabled, `${path}.enabled`);
  if (id.startsWith("grades_")) {
    const versions = array(item.versions, `${path}.versions`).map((entry, index) =>
      parseGradeVersion(entry, `${path}.versions[${index}]`),
    );
    const currentVersion = text(item.currentVersion, `${path}.currentVersion`);
    if (!versions.some((version) => version.version === currentVersion))
      contractError(`${path}.currentVersion`);
    return {
      id,
      name,
      owner,
      enabled,
      available: item.available === undefined ? true : bool(item.available, `${path}.available`),
      version: currentVersion,
      source:
        item.source === undefined
          ? "管理员导入 · 版本化成绩数据"
          : text(item.source, `${path}.source`),
      capabilities:
        item.capabilities === undefined
          ? ["成绩分析", "版本历史"]
          : stringArray(item.capabilities, `${path}.capabilities`),
      unavailableReason: optionalText(item.unavailableReason, `${path}.unavailableReason`),
      grade: { currentVersion, versions },
    };
  }
  if (owner !== "system") contractError(`${path}.owner`);
  return {
    id,
    name,
    owner,
    enabled,
    available: bool(item.available, `${path}.available`),
    version: text(item.version, `${path}.version`),
    source: text(item.source, `${path}.source`),
    capabilities: stringArray(item.capabilities, `${path}.capabilities`),
    unavailableReason: optionalText(item.unavailableReason, `${path}.unavailableReason`),
  };
}

function parseDatasets(value: unknown): DatasetEntry[] {
  const root = record(value, "数据集目录");
  return array(root.datasets, "数据集目录.datasets").map((item, index) =>
    parseDataset(item, `数据集目录.datasets[${index}]`),
  );
}

function parseLog(value: unknown, path: string): AuditLog {
  const item = record(value, path);
  if (item.version !== 1) contractError(`${path}.version`);
  const summaryInput = record(item.summary, `${path}.summary`);
  const summary: AuditLog["summary"] = {};
  for (const [key, entry] of Object.entries(summaryInput)) {
    if (
      entry !== null &&
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    )
      contractError(`${path}.summary.${key}`);
    summary[key] = entry as string | number | boolean | null;
  }
  return {
    version: 1,
    id: text(item.id, `${path}.id`),
    timestamp: text(item.timestamp, `${path}.timestamp`),
    actorId: text(item.actorId, `${path}.actorId`),
    action: text(item.action, `${path}.action`),
    targetType: text(item.targetType, `${path}.targetType`),
    targetId: text(item.targetId, `${path}.targetId`),
    summary,
    result: result(item.result, `${path}.result`),
    errorCode: optionalText(item.errorCode, `${path}.errorCode`),
    requestId: optionalText(item.requestId, `${path}.requestId`),
    source: source(item.source, `${path}.source`),
  };
}

function parseLogs(value: unknown): LogsResponse {
  const root = record(value, "操作日志");
  const filters = record(root.filters, "操作日志.filters");
  const coverage = record(root.coverage, "操作日志.coverage");
  const filterResult = filters.result;
  if (filterResult !== null && filterResult !== "success" && filterResult !== "failure")
    contractError("操作日志.filters.result");
  return {
    events: array(root.events, "操作日志.events").map((item, index) =>
      parseLog(item, `操作日志.events[${index}]`),
    ),
    total: integer(root.total, "操作日志.total"),
    page: integer(root.page, "操作日志.page"),
    pageSize: integer(root.pageSize, "操作日志.pageSize"),
    filters: {
      from: filters.from === null ? null : text(filters.from, "操作日志.filters.from"),
      to: filters.to === null ? null : text(filters.to, "操作日志.filters.to"),
      actorId: filters.actorId === null ? null : text(filters.actorId, "操作日志.filters.actorId"),
      action: filters.action === null ? null : text(filters.action, "操作日志.filters.action"),
      result: filterResult,
    },
    coverage: {
      sources: array(coverage.sources, "操作日志.coverage.sources").map((entry, index) => {
        const item = record(entry, `操作日志.coverage.sources[${index}]`);
        if (item.status !== "ok" && item.status !== "missing" && item.status !== "invalid")
          contractError(`操作日志.coverage.sources[${index}].status`);
        return {
          source: source(item.source, `操作日志.coverage.sources[${index}].source`),
          status: item.status,
          events: integer(item.events, `操作日志.coverage.sources[${index}].events`),
          legacy: integer(item.legacy, `操作日志.coverage.sources[${index}].legacy`),
        };
      }),
    },
  };
}

function requestMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return "无法连接服务器，请检查网络后重试。";
  return error instanceof Error && error.message ? error.message : fallback;
}

const numberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const durationFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
function formatNumber(value: number): string {
  return numberFormat.format(value);
}
function formatPercent(value: number | null): string {
  return value === null ? "—" : `${durationFormat.format(value * 100)}%`;
}
function formatDuration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) return "<1 ms";
  if (value < 1000) return `${durationFormat.format(value)} ms`;
  return `${durationFormat.format(value / 1000)} s`;
}
function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : dateTimeFormat.format(date);
}
function formatCost(value: number): string {
  return `$${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
}
function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function formatPageRange(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 条";
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `${formatNumber(start)}–${formatNumber(end)}，共 ${formatNumber(total)} 条`;
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

function EmptyState({
  icon = "file",
  title,
  description,
  action,
}: {
  icon?: "file" | "users" | "database" | "activity";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={22} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function LoadingState({ children }: { children: ReactNode }) {
  return (
    <div className={styles.loadingState} role="status">
      <span className={styles.loadingMark} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function ErrorState({
  message,
  retry,
  busy = false,
}: {
  message: string;
  retry: () => void;
  busy?: boolean;
}) {
  return (
    <div className={`notice notice-error ${styles.inlineNotice}`} role="alert">
      <Icon name="info" />
      <span>{message}</span>
      <button type="button" className="text-button" onClick={retry} disabled={busy}>
        <Icon name="refresh" size={16} />
        重试
      </button>
    </div>
  );
}

function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
  busy = false,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      {children}
    </dialog>
  );
}

function ConfirmationModal({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={Boolean(action)}
      onClose={onCancel}
      labelledBy="admin-confirm-title"
      describedBy="admin-confirm-description"
      busy={busy}
    >
      {action ? (
        <>
          <div className={styles.dialogHeader}>
            <span
              className={`${styles.dialogIcon} ${action.tone === "danger" ? styles.dangerIcon : ""}`}
            >
              <Icon name={action.tone === "danger" ? "shield" : "info"} size={20} />
            </span>
            <div>
              <h2 id="admin-confirm-title">{action.title}</h2>
              <p id="admin-confirm-description">{action.description}</p>
            </div>
          </div>
          <div className={styles.dialogActions}>
            <button
              type="button"
              className="secondary-button"
              autoFocus
              onClick={onCancel}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className={action.tone === "danger" ? styles.dangerButton : "primary-button"}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? "正在处理…" : action.label}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  busy,
  pageSizeOptions,
  onPage,
  onPageSize,
  noun,
}: {
  page: number;
  pageSize: number;
  total: number;
  busy: boolean;
  pageSizeOptions: readonly number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  noun: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const label = `${noun}每页`;
  return (
    <div className={styles.pagination}>
      <span>{formatPageRange(page, pageSize, total)}</span>
      <div className={styles.paginationControls}>
        <label>
          <span className="sr-only">{label}</span>
          <select
            aria-label={label}
            value={pageSize}
            disabled={busy}
            onChange={(event) => onPageSize(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                每页 {size} 条
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          aria-label="上一页"
          disabled={busy || page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          <Icon name="arrowLeft" size={16} />
        </button>
        <span className={styles.pageIndicator}>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="secondary-button"
          aria-label="下一页"
          disabled={busy || page >= totalPages}
          onClick={() => onPage(Math.min(totalPages, page + 1))}
        >
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: number;
  detail: string;
  loading: boolean;
}) {
  return (
    <article
      className={styles.metricCard}
      data-glass-pane="0.6"
      data-glass-tier="3"
      data-glass-relief="1"
    >
      <span>{label}</span>
      <strong>
        <AnimatedNumber value={value} loading={loading} fallback="—" />
      </strong>
      <small>{detail}</small>
    </article>
  );
}

function OverviewWorkspace({ request }: { request: AdminRequest }) {
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>("7d");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const raw = await request<unknown>(`/api/admin/overview?window=${metricsWindow}`);
      const parsed = parseOverview(raw);
      if (id === requestId.current) setData(parsed);
    } catch (caught) {
      if (id === requestId.current)
        setError(requestMessage(caught, "系统概览读取失败，请稍后重试。"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [metricsWindow, request]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load]);

  return (
    <section aria-labelledby="admin-overview-heading">
      <header className={`${styles.intro} ${styles.introWithAction}`}>
        <div>
          <span className={styles.eyebrow}>SYSTEM / 运行总览</span>
          <h2 id="admin-overview-heading">从真实记录看清系统运行</h2>
          <p>统计按北京时间划分，业务请求与模型调用分开计算。</p>
        </div>
        <div className={styles.windowControl}>
          <SegmentedControl<MetricsWindow>
            label="概览时间范围"
            value={metricsWindow}
            onChange={setMetricsWindow}
            options={[
              { value: "today", label: "今天" },
              { value: "7d", label: "7 天" },
              { value: "30d", label: "30 天" },
            ]}
          />
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => void load()}
          >
            <Icon name="refresh" size={16} />
            刷新
          </button>
        </div>
      </header>

      {error ? <ErrorState message={error} retry={() => void load()} busy={loading} /> : null}
      {loading && !data ? <LoadingState>正在汇总系统记录…</LoadingState> : null}
      {data ? (
        <div className={styles.dashboard} aria-busy={loading}>
          <div className={styles.metricGrid}>
            <OverviewMetric
              label="账号"
              value={data.accounts.total}
              detail={`${formatNumber(data.accounts.active)} 个启用 · ${formatNumber(data.accounts.disabled)} 个停用`}
              loading={loading}
            />
            <OverviewMetric
              label="业务请求"
              value={data.requests.total}
              detail={`${formatPercent(data.requests.successRate)} 完整成功`}
              loading={loading}
            />
            <OverviewMetric
              label="模型调用"
              value={data.ai.calls}
              detail="AI 用量，不等同于业务请求"
              loading={loading}
            />
            <article
              className={`${styles.metricCard} ${styles.costMetric}`}
              data-glass-pane="0.6"
              data-glass-tier="3"
              data-glass-relief="1"
            >
              <span>估算费用</span>
              <strong>{formatCost(data.ai.costUsd)}</strong>
              <small>根据记录单价估算，不是供应商账单</small>
            </article>
          </div>

          <div className={styles.overviewGrid}>
            <section className={`panel ${styles.dataPanel}`}>
              <div className="panel-header">
                <h3 className="panel-title">请求完成情况</h3>
                <span className="badge badge-muted">
                  {data.window === "today" ? "今天" : `${data.window.replace("d", "")} 天`}
                </span>
              </div>
              <div className={styles.panelBody}>
                <div className={styles.requestBreakdown}>
                  <div>
                    <span>完整成功</span>
                    <strong>{formatNumber(data.requests.success)}</strong>
                    <small>{formatPercent(data.requests.successRate)}</small>
                  </div>
                  <div>
                    <span>部分完成</span>
                    <strong>{formatNumber(data.requests.partial)}</strong>
                    <small>{formatPercent(data.requests.partialRate)}</small>
                  </div>
                  <div>
                    <span>失败</span>
                    <strong>{formatNumber(data.requests.failure)}</strong>
                    <small>{formatPercent(data.requests.failureRate)}</small>
                  </div>
                </div>
                <dl className={styles.factList}>
                  <div>
                    <dt>P95 执行耗时</dt>
                    <dd>{formatDuration(data.requests.durationMs.p95)}</dd>
                  </div>
                  <div>
                    <dt>有效耗时样本</dt>
                    <dd>{formatNumber(data.requests.durationMs.samples)}</dd>
                  </div>
                  <div>
                    <dt>无请求 ID 的旧记录</dt>
                    <dd>{formatNumber(data.requests.legacyWithoutRequestId)}</dd>
                  </div>
                </dl>
                <p className={styles.rangeNote}>
                  范围：{formatDateTime(data.range.start)} 至 {formatDateTime(data.range.end)}
                  （不含） · Asia/Shanghai
                  <br />
                  服务观察于：{formatDateTime(data.updatedAt)}
                </p>
                {data.requests.total === 0 ? (
                  <EmptyState
                    icon="activity"
                    title="这个时间范围内没有请求记录"
                    description="这表示暂无可统计的业务请求，不代表系统未运行。"
                  />
                ) : null}
              </div>
            </section>

            <section className={`panel ${styles.dataPanel}`}>
              <div className="panel-header">
                <h3 className="panel-title">账号与数据集</h3>
                <span className="badge badge-muted">当前状态</span>
              </div>
              <div className={styles.panelBody}>
                <dl className={styles.factList}>
                  <div>
                    <dt>管理员 / 分析 / 只读</dt>
                    <dd>
                      {data.accounts.byRole.admin} / {data.accounts.byRole.user} /{" "}
                      {data.accounts.byRole.readonly}
                    </dd>
                  </div>
                  <div>
                    <dt>待修改临时密码</dt>
                    <dd>{formatNumber(data.accounts.mustChangePassword)}</dd>
                  </div>
                  <div>
                    <dt>数据集启用</dt>
                    <dd>
                      {data.datasets.enabled} / {data.datasets.total}
                    </dd>
                  </div>
                  <div>
                    <dt>源文件可用</dt>
                    <dd>{data.datasets.available} 个</dd>
                  </div>
                  <div>
                    <dt>源文件不可用</dt>
                    <dd>{data.datasets.unavailable} 个</dd>
                  </div>
                </dl>
              </div>
            </section>
          </div>

          <section className={`panel ${styles.dataPanel}`}>
            <div className="panel-header">
              <h3 className="panel-title">数据覆盖与口径</h3>
              <span
                className={`badge ${data.coverage.records.malformed || data.coverage.costHistory.status !== "ok" ? "badge-warning" : "badge-success"}`}
              >
                {data.coverage.records.malformed || data.coverage.costHistory.status !== "ok"
                  ? "存在记录缺口"
                  : "记录完整"}
              </span>
            </div>
            <div className={`${styles.panelBody} ${styles.coverageLayout}`}>
              <dl className={styles.factList}>
                <div>
                  <dt>模型调用</dt>
                  <dd>{formatNumber(data.ai.calls)} 次</dd>
                </div>
                <div>
                  <dt>实测 / 估算调用</dt>
                  <dd>
                    {formatNumber(data.ai.measuredCalls)} / {formatNumber(data.ai.estimatedCalls)}
                  </dd>
                </div>
                <div>
                  <dt>提示 / 补全 Token</dt>
                  <dd>
                    {formatNumber(data.ai.promptTokens)} / {formatNumber(data.ai.completionTokens)}
                  </dd>
                </div>
                <div>
                  <dt>Token 总量</dt>
                  <dd>{formatNumber(data.ai.totalTokens)}</dd>
                </div>
                <div>
                  <dt>Token 对账</dt>
                  <dd
                    className={
                      data.ai.promptTokens + data.ai.completionTokens !== data.ai.totalTokens
                        ? styles.warningText
                        : undefined
                    }
                  >
                    {data.ai.promptTokens + data.ai.completionTokens === data.ai.totalTokens
                      ? "提示 + 补全 = 总量"
                      : `差额 ${formatNumber(data.ai.promptTokens + data.ai.completionTokens - data.ai.totalTokens)}`}
                  </dd>
                </div>
                <div>
                  <dt>扫描 / 有效 / 损坏记录</dt>
                  <dd>
                    {formatNumber(data.coverage.records.scanned)} /{" "}
                    {formatNumber(data.coverage.records.valid)} /{" "}
                    {formatNumber(data.coverage.records.malformed)}
                  </dd>
                </div>
                <div>
                  <dt>费用历史</dt>
                  <dd>
                    {data.coverage.costHistory.status === "ok"
                      ? `可用，${formatNumber(data.coverage.costHistory.records)} 条`
                      : data.coverage.costHistory.status === "missing"
                        ? "未找到"
                        : "格式损坏"}
                  </dd>
                </div>
              </dl>
              <div className={styles.limitations}>
                <strong>统计限制</strong>
                {data.coverage.limitations.length ? (
                  <ul>
                    {data.coverage.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                ) : (
                  <p>接口未报告额外限制。</p>
                )}
                {data.coverage.records.truncatedTail ? (
                  <p className={styles.warningText}>记录尾部已截断，最新事件可能尚未进入统计。</p>
                ) : null}
                {data.ai.promptTokens + data.ai.completionTokens !== data.ai.totalTokens ? (
                  <p className={styles.warningText} role="alert">
                    Token 记录未对账：提示与补全之和为{" "}
                    {formatNumber(data.ai.promptTokens + data.ai.completionTokens)}， 总量记录为{" "}
                    {formatNumber(data.ai.totalTokens)}。请以供应商账单核对。
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function DatasetChoices({
  datasets,
  selected,
  disabled,
  onChange,
}: {
  datasets: DatasetEntry[];
  selected: DatasetId[];
  disabled: boolean;
  onChange: (ids: DatasetId[]) => void;
}) {
  return (
    <fieldset className={styles.datasetChoices} disabled={disabled}>
      <legend>数据集授权</legend>
      {datasets.length ? (
        datasets.map((dataset) => (
          <label key={dataset.id} className={styles.checkRow}>
            <input
              type="checkbox"
              checked={selected.includes(dataset.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, dataset.id]
                    : selected.filter((id) => id !== dataset.id),
                )
              }
            />
            <span>
              <strong>{dataset.name}</strong>
              <small>
                {dataset.enabled ? "已启用" : "目录已停用"} ·{" "}
                {dataset.available ? "源文件可用" : "源文件不可用"}
              </small>
            </span>
          </label>
        ))
      ) : (
        <p className="form-help">暂无可授权的数据集。</p>
      )}
      <p className="form-help">可以不授权任何数据集；授权与目录启停相互独立。</p>
    </fieldset>
  );
}

function AccountsWorkspace({ request, user }: { request: AdminRequest; user: SessionUser }) {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [datasetsReload, setDatasetsReload] = useState(0);

  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState<{
    username: string;
    displayName: string;
    password: string;
    role: "user" | "readonly";
    datasetIds: DatasetId[];
  }>({ username: "", displayName: "", password: "", role: "user", datasetIds: [] });
  const [createErrors, setCreateErrors] = useState<{
    displayName?: string;
    username?: string;
    password?: string;
  }>({});
  const displayNameInput = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [editDraft, setEditDraft] = useState<{
    displayName: string;
    role: "user" | "readonly";
    datasetIds: DatasetId[];
  }>({ displayName: "", role: "user", datasetIds: [] });
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<{
    account: ManagedUser;
    password: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const loadAccounts = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) params.set("q", query);
    if (roleFilter !== "all") params.set("role", roleFilter);
    if (statusFilter !== "all") params.set("disabled", String(statusFilter === "disabled"));
    try {
      const raw = await request<unknown>(`/api/admin/users?${params.toString()}`);
      const parsed = parseAccounts(raw);
      if (id !== requestId.current) return;
      const maxPage = Math.max(1, Math.ceil(parsed.total / pageSize));
      if (page > maxPage) {
        setPage(maxPage);
        return;
      }
      setData(parsed);
    } catch (caught) {
      if (id === requestId.current)
        setError(requestMessage(caught, "账号列表读取失败，请稍后重试。"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [page, pageSize, query, request, roleFilter, statusFilter]);

  useEffect(() => {
    void loadAccounts();
    return () => {
      requestId.current++;
    };
  }, [loadAccounts, reloadKey]);

  const loadDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    setDatasetsError(null);
    try {
      const parsed = parseDatasets(await request<unknown>("/api/admin/datasets"));
      setDatasets(parsed);
    } catch (caught) {
      setDatasetsError(requestMessage(caught, "数据集目录读取失败，账号授权暂不可编辑。"));
    } finally {
      setDatasetsLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadDatasets();
  }, [datasetsReload, loadDatasets]);

  function refreshAccounts() {
    setReloadKey((value) => value + 1);
  }

  function openEdit(account: ManagedUser) {
    if (account.role === "admin") return;
    setEditing(account);
    setEditDraft({
      displayName: account.displayName,
      role: account.role,
      datasetIds: account.datasetIds ?? [],
    });
    setFeedback(null);
  }

  function clearCreateError(field: "displayName" | "username" | "password"): void {
    setCreateErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || datasetsLoading || datasetsError) return;
    const username = newUser.username.trim();
    const displayName = newUser.displayName.trim();
    const nextErrors: typeof createErrors = {};
    if (!displayName || displayName.length > 60) {
      nextErrors.displayName = "显示名称需为 1–60 个字符。";
    }
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
      nextErrors.username = "登录账号需为 3–40 个字母、数字、点、下划线或短横线。";
    }
    if (newUser.password.length < 12 || newUser.password.length > 128) {
      nextErrors.password = "初始密码需为 12–128 个字符。";
    }
    if (Object.keys(nextErrors).length) {
      setCreateErrors(nextErrors);
      setFeedback({ kind: "error", message: "请先修正标出的字段，再创建账号。" });
      if (nextErrors.displayName) displayNameInput.current?.focus();
      else if (nextErrors.username) usernameInput.current?.focus();
      else passwordInput.current?.focus();
      return;
    }
    setCreateErrors({});
    setBusy("create");
    setFeedback(null);
    try {
      await request("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          displayName,
          password: newUser.password,
          role: newUser.role,
          datasetIds: newUser.datasetIds,
        }),
      });
      setNewUser({
        username: "",
        displayName: "",
        password: "",
        role: "user",
        datasetIds: [],
      });
      setShowCreate(false);
      setPage(1);
      refreshAccounts();
      setFeedback({ kind: "success", message: "账号已创建，请通过安全渠道交付初始密码。" });
    } catch (caught) {
      setFeedback({ kind: "error", message: requestMessage(caught, "账号创建失败，请稍后重试。") });
    } finally {
      setBusy(null);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy || datasetsLoading || datasetsError) return;
    const displayName = editDraft.displayName.trim();
    if (!displayName || displayName.length > 60) {
      setFeedback({ kind: "error", message: "显示名称需为 1–60 个字符。" });
      return;
    }
    setBusy(`edit:${editing.id}`);
    setFeedback(null);
    try {
      await request("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          displayName,
          role: editDraft.role,
          datasetIds: editDraft.datasetIds,
        }),
      });
      setEditing(null);
      refreshAccounts();
      setFeedback({ kind: "success", message: `${displayName}的资料与权限已更新。` });
    } catch (caught) {
      setFeedback({ kind: "error", message: requestMessage(caught, "账号更新失败，请稍后重试。") });
    } finally {
      setBusy(null);
    }
  }

  function confirmToggleStatus(account: ManagedUser) {
    const disabling = !account.disabled;
    setConfirmation({
      title: disabling ? "停用这个账号？" : "重新启用这个账号？",
      description: disabling
        ? `${account.displayName}将立即退出所有会话，并无法登录。已有分析权限不会改变。`
        : `${account.displayName}将可以重新登录，并继续使用已授予的数据集。`,
      label: disabling ? "停用账号" : "启用账号",
      tone: disabling ? "danger" : undefined,
      run: async () => {
        await request("/api/admin/users", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: account.id, disabled: disabling }),
        });
        refreshAccounts();
        setFeedback({
          kind: "success",
          message: disabling
            ? `${account.displayName}的账号已停用。`
            : `${account.displayName}的账号已启用。`,
        });
      },
    });
  }

  function confirmResetPassword(account: ManagedUser) {
    setConfirmation({
      title: "重置临时密码？",
      description: `${account.displayName}的现有会话将立即失效。新密码只显示一次，账号下次登录时必须修改它。`,
      label: "生成临时密码",
      tone: "danger",
      run: async () => {
        const raw = record(
          await request<unknown>("/api/admin/users", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "reset-password", id: account.id }),
          }),
          "重置密码响应",
        );
        const password = text(raw.temporaryPassword, "重置密码响应.temporaryPassword");
        if (!password) contractError("重置密码响应.temporaryPassword");
        setTemporaryPassword({ account, password });
        setCopyState("idle");
        refreshAccounts();
      },
    });
  }

  function confirmRevokeSessions(account: ManagedUser) {
    setConfirmation({
      title: "撤销全部登录会话？",
      description: `${account.displayName}已登录的设备会立即退出，需要使用当前密码重新登录。密码和权限不会改变。`,
      label: "撤销会话",
      tone: "danger",
      run: async () => {
        await request("/api/admin/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "revoke-sessions", id: account.id }),
        });
        setFeedback({ kind: "success", message: `${account.displayName}的登录会话已撤销。` });
      },
    });
  }

  async function runConfirmation() {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await confirmation.run();
      setConfirmation(null);
    } catch (caught) {
      setFeedback({ kind: "error", message: requestMessage(caught, "操作未完成，请重试。") });
    } finally {
      setConfirmBusy(false);
    }
  }

  async function copyTemporaryPassword() {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword.password);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section aria-labelledby="admin-accounts-heading">
      <header className={`${styles.intro} ${styles.introWithAction}`}>
        <div>
          <span className={styles.eyebrow}>ACCESS / 账号与授权</span>
          <h2 id="admin-accounts-heading">按角色和数据范围管理访问</h2>
          <p>管理员账号受保护；普通与只读账号只能访问被明确授予的数据集。</p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setShowCreate((value) => !value);
            setFeedback(null);
            setCreateErrors({});
          }}
          aria-expanded={showCreate}
          aria-controls="admin-create-account"
        >
          <Icon name={showCreate ? "close" : "plus"} size={17} />
          {showCreate ? "收起创建表单" : "创建账号"}
        </button>
      </header>

      <FeedbackNotice feedback={feedback} />
      {datasetsError ? (
        <ErrorState
          message={datasetsError}
          retry={() => setDatasetsReload((value) => value + 1)}
          busy={datasetsLoading}
        />
      ) : null}

      {showCreate ? (
        <form
          id="admin-create-account"
          className={`panel ${styles.createPanel}`}
          onSubmit={createAccount}
          aria-busy={busy === "create"}
          noValidate
        >
          <div className="panel-header">
            <div>
              <h3 className="panel-title">创建分析或只读账号</h3>
              <p className={styles.panelSubtitle}>初始密码至少 12 个字符，请通过安全渠道交付。</p>
            </div>
            <Icon name="users" size={20} />
          </div>
          <div className={styles.createGrid}>
            <div className="form-field">
              <label htmlFor="admin-new-display-name">
                显示名称
                <span className={styles.requiredMark} aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="admin-new-display-name"
                ref={displayNameInput}
                required
                maxLength={60}
                autoComplete="off"
                value={newUser.displayName}
                aria-invalid={createErrors.displayName ? true : undefined}
                aria-describedby={
                  createErrors.displayName ? "admin-new-display-name-error" : undefined
                }
                onChange={(event) => {
                  clearCreateError("displayName");
                  setNewUser({ ...newUser, displayName: event.target.value });
                }}
                disabled={busy === "create"}
                placeholder="例如 王老师"
              />
              {createErrors.displayName ? (
                <p className={styles.fieldError} id="admin-new-display-name-error">
                  {createErrors.displayName}
                </p>
              ) : null}
            </div>
            <div className="form-field">
              <label htmlFor="admin-new-username">
                登录账号
                <span className={styles.requiredMark} aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="admin-new-username"
                ref={usernameInput}
                required
                minLength={3}
                maxLength={40}
                pattern={"[A-Za-z0-9._\\-]{3,40}"}
                autoComplete="off"
                spellCheck={false}
                value={newUser.username}
                aria-invalid={createErrors.username ? true : undefined}
                aria-describedby={
                  createErrors.username
                    ? "admin-new-username-help admin-new-username-error"
                    : "admin-new-username-help"
                }
                onChange={(event) => {
                  clearCreateError("username");
                  setNewUser({ ...newUser, username: event.target.value });
                }}
                disabled={busy === "create"}
                placeholder="例如 teacher.wang"
              />
              <span className="form-help" id="admin-new-username-help">
                3–40 个字母、数字、点、下划线或短横线。
              </span>
              {createErrors.username ? (
                <p className={styles.fieldError} id="admin-new-username-error">
                  {createErrors.username}
                </p>
              ) : null}
            </div>
            <div className="form-field">
              <label htmlFor="admin-new-password">
                初始密码
                <span className={styles.requiredMark} aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="admin-new-password"
                ref={passwordInput}
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={newUser.password}
                aria-invalid={createErrors.password ? true : undefined}
                aria-describedby={createErrors.password ? "admin-new-password-error" : undefined}
                onChange={(event) => {
                  clearCreateError("password");
                  setNewUser({ ...newUser, password: event.target.value });
                }}
                disabled={busy === "create"}
                placeholder="至少 12 个字符"
              />
              {createErrors.password ? (
                <p className={styles.fieldError} id="admin-new-password-error">
                  {createErrors.password}
                </p>
              ) : null}
            </div>
            <div className="form-field">
              <label htmlFor="admin-new-role">角色</label>
              <select
                id="admin-new-role"
                value={newUser.role}
                onChange={(event) =>
                  setNewUser({ ...newUser, role: event.target.value as "user" | "readonly" })
                }
                disabled={busy === "create"}
              >
                <option value="user">分析用户：查看、AI 分析与导出</option>
                <option value="readonly">只读用户：查看聚合结果，不可 AI 或导出</option>
              </select>
            </div>
            <DatasetChoices
              datasets={datasets}
              selected={newUser.datasetIds}
              disabled={busy === "create" || datasetsLoading || Boolean(datasetsError)}
              onChange={(datasetIds) => setNewUser({ ...newUser, datasetIds })}
            />
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setShowCreate(false);
                setCreateErrors({});
              }}
              disabled={busy === "create"}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy === "create" || datasetsLoading || Boolean(datasetsError)}
            >
              {busy === "create" ? "正在创建…" : "创建账号"}
            </button>
          </div>
        </form>
      ) : null}

      <section className={`panel ${styles.tablePanel}`} aria-busy={loading}>
        <div className={styles.toolbar}>
          <div className={styles.searchField}>
            <Icon name="search" size={17} />
            <label className="sr-only" htmlFor="admin-account-search">
              搜索账号
            </label>
            <input
              id="admin-account-search"
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="搜索登录账号或显示名称"
              maxLength={100}
            />
          </div>
          <label className={styles.compactField}>
            <span>角色</span>
            <select
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value as "all" | UserRole);
                setPage(1);
              }}
            >
              <option value="all">全部角色</option>
              <option value="admin">管理员</option>
              <option value="user">分析用户</option>
              <option value="readonly">只读用户</option>
            </select>
          </label>
          <label className={styles.compactField}>
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as "all" | "active" | "disabled");
                setPage(1);
              }}
            >
              <option value="all">全部状态</option>
              <option value="active">已启用</option>
              <option value="disabled">已停用</option>
            </select>
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setQueryInput("");
              setQuery("");
              setRoleFilter("all");
              setStatusFilter("all");
              setPage(1);
            }}
            disabled={loading || (!queryInput && roleFilter === "all" && statusFilter === "all")}
          >
            清除筛选
          </button>
        </div>

        {error ? (
          <ErrorState message={error} retry={() => void loadAccounts()} busy={loading} />
        ) : null}
        {loading && !data ? <LoadingState>正在读取账号列表…</LoadingState> : null}
        {data ? (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption className="sr-only">管理账号列表</caption>
                <thead>
                  <tr>
                    <th scope="col">账号</th>
                    <th scope="col">角色</th>
                    <th scope="col">数据集</th>
                    <th scope="col">状态</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((account) => {
                    const protectedAdmin = account.role === "admin";
                    const grants = account.datasetIds ?? [];
                    return (
                      <tr key={account.id}>
                        <td data-label="账号">
                          <div
                            className={styles.accountIdentity}
                            title={`${account.displayName}（${account.username}）`}
                          >
                            <span className={styles.avatar} aria-hidden="true">
                              {(account.displayName || account.username).slice(0, 1)}
                            </span>
                            <span>
                              <strong title={account.displayName}>
                                {account.displayName}
                                {account.id === user.id ? (
                                  <span className="badge badge-muted">你</span>
                                ) : null}
                              </strong>
                              <small title={account.username}>{account.username}</small>
                            </span>
                          </div>
                        </td>
                        <td data-label="角色">
                          <span
                            className={`badge ${account.role === "admin" ? "badge-muted" : account.role === "readonly" ? "badge-warning" : "badge-teal"}`}
                          >
                            {roleLabels[account.role]}
                          </span>
                          {account.mustChangePassword ? (
                            <span className="badge badge-warning">待改密</span>
                          ) : null}
                        </td>
                        <td data-label="数据集">
                          <div className={styles.grantList}>
                            {grants.length ? (
                              grants.map((id) => {
                                const datasetName = datasets.find(
                                  (dataset) => dataset.id === id,
                                )?.name;
                                return (
                                  <span key={id} title={datasetName ?? id}>
                                    {datasetName ?? id}
                                  </span>
                                );
                              })
                            ) : (
                              <span className={styles.mutedCell}>未授权</span>
                            )}
                          </div>
                        </td>
                        <td data-label="状态">
                          <span
                            className={`badge ${account.disabled ? "badge-warning" : "badge-success"}`}
                          >
                            {account.disabled ? "已停用" : "已启用"}
                          </span>
                        </td>
                        <td data-label="操作">
                          {protectedAdmin ? (
                            <span className={styles.protectedText}>
                              <Icon name="shield" size={15} />
                              受保护
                            </span>
                          ) : (
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => openEdit(account)}
                                disabled={Boolean(busy)}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => confirmResetPassword(account)}
                                disabled={Boolean(busy)}
                              >
                                重置密码
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => confirmRevokeSessions(account)}
                                disabled={Boolean(busy)}
                              >
                                撤销会话
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => confirmToggleStatus(account)}
                                disabled={Boolean(busy)}
                              >
                                {account.disabled ? "启用" : "停用"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.users.length === 0 ? (
              <EmptyState
                icon="users"
                title="没有符合条件的账号"
                description="调整搜索词、角色或状态筛选后再试。"
                action={
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setQueryInput("");
                      setQuery("");
                      setRoleFilter("all");
                      setStatusFilter("all");
                      setPage(1);
                    }}
                  >
                    清除筛选
                  </button>
                }
              />
            ) : null}
            {data.total > 0 ? (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                busy={loading}
                pageSizeOptions={[20, 50]}
                onPage={setPage}
                onPageSize={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="账号"
              />
            ) : null}
          </>
        ) : null}
      </section>

      <Modal
        open={Boolean(editing)}
        onClose={() => {
          if (busy?.startsWith("edit:") || datasetsLoading) return;
          setEditing(null);
        }}
        labelledBy="admin-edit-account-title"
        describedBy="admin-edit-account-description"
        busy={Boolean(busy?.startsWith("edit:")) || datasetsLoading}
        wide
      >
        {editing ? (
          <form onSubmit={saveAccount}>
            <div className={styles.dialogHeader}>
              <span className={styles.dialogIcon}>
                <Icon name="users" size={20} />
              </span>
              <div>
                <h2 id="admin-edit-account-title">编辑 {editing.displayName}</h2>
                <p id="admin-edit-account-description">
                  登录账号 <strong>{editing.username}</strong> 创建后不可修改。
                </p>
              </div>
            </div>
            {datasetsError ? (
              <p className="notice notice-error" role="alert">
                {datasetsError}
              </p>
            ) : null}
            <div className={styles.editGrid}>
              <div className="form-field">
                <label htmlFor="admin-edit-display-name">显示名称</label>
                <input
                  id="admin-edit-display-name"
                  required
                  maxLength={60}
                  autoFocus
                  value={editDraft.displayName}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, displayName: event.target.value })
                  }
                  disabled={Boolean(busy?.startsWith("edit:"))}
                />
              </div>
              <div className="form-field">
                <label htmlFor="admin-edit-role">角色</label>
                <select
                  id="admin-edit-role"
                  value={editDraft.role}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, role: event.target.value as "user" | "readonly" })
                  }
                  disabled={Boolean(busy?.startsWith("edit:"))}
                >
                  <option value="user">分析用户：查看、AI 分析与导出</option>
                  <option value="readonly">只读用户：查看聚合结果，不可 AI 或导出</option>
                </select>
              </div>
              <DatasetChoices
                datasets={datasets}
                selected={editDraft.datasetIds}
                disabled={
                  Boolean(busy?.startsWith("edit:")) || datasetsLoading || Boolean(datasetsError)
                }
                onChange={(datasetIds) => setEditDraft({ ...editDraft, datasetIds })}
              />
            </div>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditing(null)}
                disabled={Boolean(busy?.startsWith("edit:"))}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={
                  Boolean(busy?.startsWith("edit:")) || datasetsLoading || Boolean(datasetsError)
                }
              >
                {busy?.startsWith("edit:") ? "正在保存…" : "保存账号"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmationModal
        action={confirmation}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirmation(null);
        }}
        onConfirm={() => void runConfirmation()}
      />

      <Modal
        open={Boolean(temporaryPassword)}
        onClose={() => {
          setTemporaryPassword(null);
          setCopyState("idle");
        }}
        labelledBy="admin-temporary-password-title"
        describedBy="admin-temporary-password-description"
      >
        {temporaryPassword ? (
          <>
            <div className={styles.dialogHeader}>
              <span className={styles.dialogIcon}>
                <Icon name="lock" size={20} />
              </span>
              <div>
                <h2 id="admin-temporary-password-title">临时密码只显示一次</h2>
                <p id="admin-temporary-password-description">
                  关闭后无法再次查看。请通过安全渠道交给 {temporaryPassword.account.displayName}
                  ，账号下次登录时必须修改。
                </p>
              </div>
            </div>
            <div className={styles.passwordReveal}>
              <code>{temporaryPassword.password}</code>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void copyTemporaryPassword()}
              >
                <Icon name={copyState === "copied" ? "check" : "file"} size={16} />
                {copyState === "copied" ? "已复制" : "复制密码"}
              </button>
            </div>
            {copyState === "error" ? (
              <p className="notice notice-error" role="alert">
                浏览器无法自动复制，请手动选择并复制上面的密码。
              </p>
            ) : null}
            <div className={styles.dialogActions}>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setTemporaryPassword(null);
                  setCopyState("idle");
                }}
              >
                我已安全保存
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </section>
  );
}

function DatasetsWorkspace({ request }: { request: AdminRequest }) {
  const [datasets, setDatasets] = useState<DatasetEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<DatasetId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDatasets(parseDatasets(await request<unknown>("/api/admin/datasets")));
    } catch (caught) {
      setError(requestMessage(caught, "数据集目录读取失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleDataset(dataset: DatasetEntry, enabled: boolean) {
    setBusyId(dataset.id);
    setFeedback(null);
    try {
      const raw = record(
        await request<unknown>("/api/admin/datasets", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: dataset.id, enabled }),
        }),
        "数据集更新响应",
      );
      const updated = parseDataset(raw.dataset, "数据集更新响应.dataset");
      setDatasets(
        (current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? [updated],
      );
      setFeedback({
        kind: "success",
        message: `${updated.name}已${updated.enabled ? "启用" : "停用"}。${updated.enabled ? "" : "新业务查询会立即被拒绝。"}`,
      });
    } catch (caught) {
      setFeedback({
        kind: "error",
        message: requestMessage(caught, "数据集状态修改失败，请稍后重试。"),
      });
      throw caught;
    } finally {
      setBusyId(null);
    }
  }

  function changeDataset(dataset: DatasetEntry, enabled: boolean) {
    if (!enabled) {
      setConfirmation({
        title: `停用“${dataset.name}”？`,
        description:
          "停用后，所有账号的新业务查询都会拒绝该数据集。已有授权会保留，恢复后可继续使用。",
        label: "停用数据集",
        tone: "danger",
        run: async () => {
          await toggleDataset(dataset, false);
        },
      });
      return;
    }
    void toggleDataset(dataset, true).catch(() => undefined);
  }

  async function runConfirmation() {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await confirmation.run();
      setConfirmation(null);
    } catch {
      /* The action already writes the user-facing error notice. */
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <section aria-labelledby="admin-datasets-heading">
      <header className={`${styles.intro} ${styles.introWithAction}`}>
        <div>
          <span className={styles.eyebrow}>DATA / 目录与可用性</span>
          <h2 id="admin-datasets-heading">掌握数据源状态</h2>
          <p>目录启停与源文件可用性分开显示；停用只会阻止新查询，不会删除已有记录。</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => void load()}
        >
          <Icon name="refresh" size={16} />
          刷新目录
        </button>
      </header>
      <FeedbackNotice feedback={feedback} />
      {error ? <ErrorState message={error} retry={() => void load()} busy={loading} /> : null}
      <GradeImport
        request={request}
        targets={(datasets ?? []).flatMap((dataset) =>
          dataset.grade
            ? [
                {
                  id: dataset.id as GradeDataset["id"],
                  name: dataset.name,
                  owner: dataset.owner,
                  currentVersion: dataset.grade.currentVersion,
                  versions: dataset.grade.versions,
                },
              ]
            : [],
        )}
        onPublished={async () => {
          await load();
        }}
      />
      {loading && !datasets ? <LoadingState>正在检查数据集目录与源文件…</LoadingState> : null}
      {datasets ? (
        datasets.length ? (
          <div className={styles.datasetGrid} aria-busy={loading}>
            {datasets.map((dataset) => (
              <article key={dataset.id} className={`panel ${styles.datasetCard}`}>
                <div className={styles.datasetHeader}>
                  <span className={styles.datasetIcon}>
                    <Icon name="database" size={21} />
                  </span>
                  <div>
                    <span className={styles.eyebrow}>{dataset.id.toUpperCase()}</span>
                    <h3>{dataset.name}</h3>
                    <p>{dataset.source}</p>
                  </div>
                  <span
                    className={`badge ${dataset.available ? "badge-success" : "badge-warning"}`}
                  >
                    {dataset.available ? "源文件可用" : "源文件不可用"}
                  </span>
                </div>
                <dl className={styles.datasetFacts}>
                  <div>
                    <dt>目录状态</dt>
                    <dd>{dataset.enabled ? "已启用" : "已停用"}</dd>
                  </div>
                  <div>
                    <dt>版本</dt>
                    <dd>{dataset.version}</dd>
                  </div>
                  <div>
                    <dt>归属</dt>
                    <dd>{dataset.owner === "system" ? "系统内置" : "管理员导入"}</dd>
                  </div>
                </dl>
                <div className={styles.capabilities}>
                  <strong>能力</strong>
                  <div>
                    {dataset.capabilities.map((capability) => (
                      <span key={capability}>{capability}</span>
                    ))}
                  </div>
                </div>
                {!dataset.available ? (
                  <p className={`notice notice-warning ${styles.inlineNotice}`}>
                    <Icon name="info" />
                    <span>{dataset.unavailableReason || "必需源文件缺失或不可读。"}</span>
                  </p>
                ) : null}
                {dataset.grade && (
                  <details>
                    <summary>版本历史（{dataset.grade.versions.length}）</summary>
                    <ul>
                      {dataset.grade.versions.map((version) => (
                        <li key={version.version}>
                          {version.version}
                          {version.version === dataset.grade?.currentVersion
                            ? " · 当前"
                            : ""} · {new Date(version.createdAt).toLocaleString("zh-CN")} ·{" "}
                          {version.rowCount.toLocaleString("zh-CN")} 条记录
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className={styles.datasetFooter}>
                  <span className={styles.mutedCell}>
                    {dataset.enabled ? "允许获授权账号发起新查询" : "所有新业务查询均已阻止"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={dataset.enabled}
                    aria-label={`${dataset.name}${dataset.enabled ? "已启用" : "已停用"}`}
                    className={styles.switchButton}
                    data-checked={dataset.enabled}
                    disabled={busyId === dataset.id}
                    onClick={() => changeDataset(dataset, !dataset.enabled)}
                  >
                    <span aria-hidden="true" />
                    {busyId === dataset.id ? "处理中…" : dataset.enabled ? "停用" : "启用"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon="database" title="还没有登记数据集" description="服务端目录当前为空。" />
        )
      ) : null}
      <ConfirmationModal
        action={confirmation}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirmation(null);
        }}
        onConfirm={() => void runConfirmation()}
      />
    </section>
  );
}

function summaryValue(key: string, value: string | number | boolean | null): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null) return "未记录";
  if (
    (key === "role" || key === "beforeRole") &&
    (value === "admin" || value === "user" || value === "readonly")
  )
    return roleLabels[value];
  return String(value).replaceAll("demo", "模拟校园").replaceAll("oulad", "OULAD");
}

function summaryParts(log: AuditLog): string[] {
  return Object.entries(log.summary)
    .filter(([key]) => knownSummaryFields.has(key))
    .slice(0, 8)
    .map(([key, value]) => {
      const label: Record<string, string> = {
        rowCount: "记录数",
        studentCount: "学生数",
        courseCount: "课程数",
        termCount: "学期数",
        missingScores: "缺失成绩",
        versionNumber: "版本序号",
        role: "角色",
        beforeRole: "原角色",
        disabled: "停用",
        beforeDisabled: "原停用",
        enabled: "启用",
        beforeEnabled: "原启用",
        datasetIds: "数据集",
        beforeDatasetIds: "原数据集",
        nameChanged: "修改名称",
        changedFields: "变更字段",
        keyChanged: "密钥变更",
        mustChangePassword: "强制改密",
      };
      return `${label[key] ?? key}：${summaryValue(key, value)}`;
    });
}

/** IDs stay available as a `title`, but rows read as names rather than UUIDs. */
function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

function LogsWorkspace({ request }: { request: AdminRequest }) {
  const [draft, setDraft] = useState({
    actorId: "",
    action: "",
    result: "" as "" | "success" | "failure",
    from: "",
    to: "",
  });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<LogsResponse | null>(null);
  const [actors, setActors] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const requestId = useRef(0);

  // The directory is only used to read audit rows as names; ids remain in title.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const parsed = parseAccounts(
          await request<unknown>("/api/admin/users?page=1&pageSize=100"),
        );
        if (!cancelled) setActors(parsed.users);
      } catch {
        // Fall back to truncated ids; the audit list itself must stay readable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  function actorAccount(id: string): ManagedUser | undefined {
    return actors.find((account) => account.id === id);
  }

  function actorLabel(id: string): string {
    return actorAccount(id)?.displayName ?? shortId(id);
  }

  function actorTitle(id: string): string {
    const account = actorAccount(id);
    return account ? `${account.displayName}（${account.username}）· ${id}` : id;
  }

  function targetLabel(log: AuditLog): string {
    if (log.targetType === "user") {
      const account = actorAccount(log.targetId);
      if (account) return account.displayName;
    }
    return log.targetId;
  }

  /** The API filters by exact actor id; accept a name/username and resolve it. */
  function resolveActorFilter(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const byUsername = actors.find((account) => account.username === trimmed);
    if (byUsername) return byUsername.id;
    if (actors.some((account) => account.id === trimmed)) return trimmed;
    const byName = actors.filter((account) => account.displayName === trimmed);
    return byName.length === 1 ? byName[0].id : trimmed;
  }

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters.actorId.trim()) params.set("actorId", filters.actorId.trim());
    if (filters.action) params.set("action", filters.action);
    if (filters.result) params.set("result", filters.result);
    const from = localDateTimeToIso(filters.from);
    const to = localDateTimeToIso(filters.to);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const parsed = parseLogs(await request<unknown>(`/api/admin/logs?${params.toString()}`));
      if (id !== requestId.current) return;
      const maxPage = Math.max(1, Math.ceil(parsed.total / pageSize));
      if (page > maxPage) {
        setPage(maxPage);
        return;
      }
      setData(parsed);
    } catch (caught) {
      if (id === requestId.current)
        setError(requestMessage(caught, "操作日志读取失败，请稍后重试。"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filters, page, pageSize, request]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilterError(null);
    if (draft.from && !localDateTimeToIso(draft.from)) {
      setFilterError("开始时间格式不正确。");
      return;
    }
    if (draft.to && !localDateTimeToIso(draft.to)) {
      setFilterError("结束时间格式不正确。");
      return;
    }
    if (draft.from && draft.to) {
      const from = new Date(`${draft.from}:00+08:00`).getTime();
      const to = new Date(`${draft.to}:00+08:00`).getTime();
      if (to <= from) {
        setFilterError("结束时间必须晚于开始时间。");
        return;
      }
    }
    setPage(1);
    setFilters({ ...draft, actorId: resolveActorFilter(draft.actorId) });
  }

  function clearFilters() {
    const cleared = { actorId: "", action: "", result: "" as const, from: "", to: "" };
    setDraft(cleared);
    setFilters(cleared);
    setPage(1);
    setFilterError(null);
  }

  return (
    <section aria-labelledby="admin-logs-heading">
      <header className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>AUDIT / 操作留痕</span>
          <h2 id="admin-logs-heading">追踪关键管理操作</h2>
          <p>
            只展示经过白名单过滤的审计字段；密码、密钥、令牌、对话正文和学生明细不会出现在这里。
          </p>
        </div>
      </header>

      <form className={`panel ${styles.logFilters}`} onSubmit={applyFilters}>
        <div className={styles.filterGrid}>
          <div className="form-field">
            <label htmlFor="admin-log-actor">操作者姓名或账号</label>
            <input
              id="admin-log-actor"
              value={draft.actorId}
              onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
              placeholder="输入登录账号、姓名或账号 ID"
              aria-describedby="admin-log-actor-help"
              maxLength={100}
            />
            <span className="form-help" id="admin-log-actor-help">
              姓名或账号需精确输入；也可粘贴账号 ID。
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="admin-log-action">操作类型</label>
            <select
              id="admin-log-action"
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            >
              <option value="">全部操作</option>
              {Object.entries(actionLabels).map(([action, label]) => (
                <option key={action} value={action}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="admin-log-result">结果</label>
            <select
              id="admin-log-result"
              value={draft.result}
              onChange={(event) =>
                setDraft({ ...draft, result: event.target.value as "" | "success" | "failure" })
              }
            >
              <option value="">全部结果</option>
              <option value="success">成功</option>
              <option value="failure">失败</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="admin-log-from">开始时间（北京时间）</label>
            <input
              id="admin-log-from"
              type="datetime-local"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </div>
          <div className="form-field">
            <label htmlFor="admin-log-to">结束时间（不含）</label>
            <input
              id="admin-log-to"
              type="datetime-local"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </div>
        </div>
        {filterError ? (
          <p className="notice notice-error" role="alert">
            {filterError}
          </p>
        ) : null}
        <div className={styles.filterActions}>
          <button type="button" className="text-button" onClick={clearFilters}>
            清除筛选
          </button>
          <button type="submit" className="secondary-button">
            <Icon name="search" size={16} />
            应用筛选
          </button>
        </div>
      </form>

      {error ? <ErrorState message={error} retry={() => void load()} busy={loading} /> : null}
      {loading && !data ? <LoadingState>正在合并管理操作日志…</LoadingState> : null}
      {data ? (
        <section className={`panel ${styles.tablePanel}`} aria-busy={loading}>
          <div className="panel-header">
            <h3 className="panel-title">审计事件</h3>
            <span className="badge badge-muted">最新在前</span>
          </div>
          {data.events.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption className="sr-only">管理操作日志</caption>
                <thead>
                  <tr>
                    <th scope="col">时间</th>
                    <th scope="col">操作</th>
                    <th scope="col">对象</th>
                    <th scope="col">结果</th>
                    <th scope="col">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((log) => (
                    <tr key={log.id}>
                      <td data-label="时间">
                        <span className={styles.logTime}>{formatDateTime(log.timestamp)}</span>
                        <small>{sourceLabels[log.source]}</small>
                      </td>
                      <td data-label="操作">
                        <strong>{actionLabels[log.action] ?? log.action}</strong>
                        <small title={actorTitle(log.actorId)}>
                          操作者 {actorLabel(log.actorId)}
                        </small>
                      </td>
                      <td data-label="对象">
                        <span>{targetTypeLabels[log.targetType] ?? log.targetType}</span>
                        <small title={log.targetId}>{targetLabel(log)}</small>
                      </td>
                      <td data-label="结果">
                        <span
                          className={`badge ${log.result === "success" ? "badge-success" : "badge-warning"}`}
                        >
                          {log.result === "success" ? "成功" : "失败"}
                        </span>
                        {log.errorCode ? <small>{log.errorCode}</small> : null}
                      </td>
                      <td data-label="详情">
                        <div className={styles.summaryList}>
                          {summaryParts(log).length ? (
                            summaryParts(log).map((part) => <span key={part}>{part}</span>)
                          ) : (
                            <span>无额外摘要</span>
                          )}
                        </div>
                        {log.requestId ? <small>请求 {log.requestId}</small> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="activity"
              title="没有符合条件的日志"
              description="调整时间或筛选条件后重试。旧版无标识记录只计入覆盖统计，不在此列表暴露。"
              action={
                <button type="button" className="secondary-button" onClick={clearFilters}>
                  清除筛选
                </button>
              }
            />
          )}
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            busy={loading}
            pageSizeOptions={[25, 50]}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun="日志"
          />
          <div className={styles.coverageStrip}>
            <strong>来源覆盖</strong>
            {data.coverage.sources.map((item) => (
              <span
                key={item.source}
                className={`badge ${item.status === "ok" ? "badge-success" : "badge-warning"}`}
              >
                {sourceLabels[item.source]}：
                {item.status === "ok"
                  ? `${item.events} 条`
                  : item.status === "missing"
                    ? "缺失"
                    : "损坏"}
              </span>
            ))}
            <span className={styles.mutedCell}>旧格式记录不会作为日志正文展示。</span>
          </div>
        </section>
      ) : null}
    </section>
  );
}

export function AdminManagement({
  request,
  user,
  section,
}: {
  request: AdminRequest;
  user: SessionUser;
  section: AdminManagementSection;
}) {
  if (section === "overview") return <OverviewWorkspace request={request} />;
  if (section === "users") return <AccountsWorkspace request={request} user={user} />;
  if (section === "datasets") return <DatasetsWorkspace request={request} />;
  return <LogsWorkspace request={request} />;
}
