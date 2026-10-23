"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Icon } from "@/components/app-icons";
import {
  GRADE_FIELDS,
  GRADE_LIMITS,
  type GradeDataset,
  type GradeDraft,
  type GradeField,
  type GradeMapping,
  type GradeRow,
  type GradeSheetPreview,
  type GradeValidation,
  type GradeVersion,
} from "@/lib/datasets/grade-contract";
import styles from "./grade-import.module.css";

type JsonRequest = <T>(url: string, options?: RequestInit) => Promise<T>;
type Feedback = { kind: "success" | "warning" | "error" | "info"; message: string } | null;
type PublicationMode = "new" | "version";
type ValidationSnapshot = {
  draftId: string;
  sheet: number;
  headerRow: number;
  mapping: GradeMapping;
  name: string;
  mode: PublicationMode;
  targetId: string | null;
  baseVersion: string | null;
};

export type GradeImportTarget = {
  id: GradeDataset["id"];
  name: string;
  owner: string;
  currentVersion: string;
  versions: GradeVersion[];
};

const requiredFields: GradeField[] = ["id_student", "code_module", "code_presentation", "score"];
const fieldLabels: Record<GradeField, string> = {
  id_student: "学生编号",
  code_module: "课程",
  code_presentation: "学期 / 场次",
  score: "成绩",
  completed: "完成标记",
};
const fieldHints: Record<GradeField, string> = {
  id_student: "必填 · 学生唯一标识",
  code_module: "必填 · 课程或模块代码",
  code_presentation: "必填 · 学期或开课场次",
  score: "必填 · 0–100 分或空值",
  completed: "可选 · 0 / 1 完成状态",
};
const numericCellPattern = /^-?\d+(?:[.,]\d+)?%?$/;
/** Column previews keep numbers on one line; text may wrap only when it must. */
function previewCellClass(value: string | number | null | undefined): string {
  if (typeof value === "number") return styles.cellNumeric;
  return numericCellPattern.test(String(value ?? "").trim()) ? styles.cellNumeric : styles.cellText;
}

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const numberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : dateTimeFormat.format(date);
}

function formatRemaining(expiresAt: string, now: number): string {
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining)) return "有效期未知";
  if (remaining <= 0) return "已过期";
  if (remaining < 60_000) return `剩余 ${Math.ceil(remaining / 1000)} 秒`;
  return `剩余 ${Math.ceil(remaining / 60_000)} 分钟`;
}

function formatVersionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : dateTimeFormat.format(date);
}

function canonicalMapping(mapping: GradeMapping): GradeMapping {
  const result: GradeMapping = {};
  for (const field of GRADE_FIELDS) {
    const index = mapping[field];
    if (typeof index === "number" && Number.isInteger(index) && index >= 0) {
      result[field] = index;
    }
  }
  return result;
}

function mappingEntries(mapping: GradeMapping): Array<[GradeField, number]> {
  const normalized = canonicalMapping(mapping);
  return GRADE_FIELDS.flatMap((field) => {
    const index = normalized[field];
    return index === undefined ? [] : [[field, index] as [GradeField, number]];
  });
}

function validationKey(snapshot: ValidationSnapshot): string {
  return JSON.stringify({
    draftId: snapshot.draftId,
    sheet: snapshot.sheet,
    headerRow: snapshot.headerRow,
    mapping: mappingEntries(snapshot.mapping),
    name: snapshot.name.trim(),
    mode: snapshot.mode,
    targetId: snapshot.targetId,
    baseVersion: snapshot.baseVersion,
  });
}

function safeCsvCell(value: unknown): string {
  const source = String(value ?? "");
  const neutralized = source.replace(/^(\s*)([=+\-@])/, "$1'$2");
  return `"${neutralized.replaceAll('"', '""')}"`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return "无法连接服务器，请检查网络后重试。";
  return error instanceof Error && error.message ? error.message : fallback;
}

function apiObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("导入服务返回的数据无法识别，请刷新后重试。");
  }
  return value as Record<string, unknown>;
}

function apiArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("导入服务返回的数据无法识别，请刷新后重试。");
  return value;
}

function apiText(value: unknown): string {
  if (typeof value !== "string") throw new Error("导入服务返回的数据无法识别，请刷新后重试。");
  return value;
}

function apiNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("导入服务返回的数据无法识别，请刷新后重试。");
  }
  return value;
}

function parseMapping(value: unknown): GradeMapping {
  const item = apiObject(value);
  const mapping: GradeMapping = {};
  for (const field of GRADE_FIELDS) {
    const index = item[field];
    if (index === undefined || index === null) continue;
    const parsed = apiNumber(index);
    if (!Number.isInteger(parsed) || parsed < 0)
      throw new Error("导入服务返回的列映射无法识别，请刷新后重试。");
    mapping[field] = parsed;
  }
  return mapping;
}

function parseDraftResponse(value: unknown): GradeDraft {
  const draft = apiObject(apiObject(value).draft);
  return {
    id: apiText(draft.id),
    expiresAt: apiText(draft.expiresAt),
    sheets: apiArray(draft.sheets).map((sheet) => {
      const item = apiObject(sheet);
      const rowCount = apiNumber(item.rowCount);
      if (!Number.isInteger(rowCount) || rowCount < 0)
        throw new Error("导入服务返回的工作表信息无法识别，请刷新后重试。");
      return { name: apiText(item.name), rowCount };
    }),
  };
}

function parsePreviewResponse(value: unknown): GradeSheetPreview {
  const selection = apiObject(apiObject(value).selection);
  const headers = apiArray(selection.headers).map(apiText);
  return {
    sheet: apiNumber(selection.sheet),
    headerRow: apiNumber(selection.headerRow),
    headers,
    preview: apiArray(selection.preview).map((row) => apiArray(row).map(apiText)),
    suggestedMapping: parseMapping(selection.suggestedMapping),
  };
}

function parseGradeRow(value: unknown): GradeRow {
  const row = apiObject(value);
  const score = row.score;
  const completed = row.completed;
  if (score !== null && typeof score !== "number")
    throw new Error("导入服务返回的预览成绩无法识别，请刷新后重试。");
  if (completed !== null && completed !== 0 && completed !== 1)
    throw new Error("导入服务返回的完成状态无法识别，请刷新后重试。");
  return {
    id_student: apiText(row.id_student),
    code_module: apiText(row.code_module),
    code_presentation: apiText(row.code_presentation),
    score,
    completed,
  };
}

function parseValidationResponse(value: unknown): GradeValidation {
  const validation = apiObject(apiObject(value).validation);
  const count = (key: string) => {
    const parsed = apiNumber(validation[key]);
    if (!Number.isInteger(parsed) || parsed < 0)
      throw new Error("导入服务返回的校验统计无法识别，请刷新后重试。");
    return parsed;
  };
  return {
    valid: validation.valid === true,
    rowCount: count("rowCount"),
    studentCount: count("studentCount"),
    courseCount: count("courseCount"),
    termCount: count("termCount"),
    missingScores: count("missingScores"),
    hasCompletion: validation.hasCompletion === true,
    errorCount: count("errorCount"),
    issues: apiArray(validation.issues).map((entry) => {
      const issue = apiObject(entry);
      return {
        row: apiNumber(issue.row),
        field: apiText(issue.field),
        code: apiText(issue.code),
        message: apiText(issue.message),
      };
    }),
    preview: apiArray(validation.preview).map(parseGradeRow),
  };
}

function parseGradeVersion(value: unknown): GradeVersion {
  const item = apiObject(value);
  const count = (key: string) => {
    const parsed = apiNumber(item[key]);
    if (!Number.isInteger(parsed) || parsed < 0)
      throw new Error("数据集版本历史无法识别，请刷新后重试。");
    return parsed;
  };
  return {
    version: apiText(item.version),
    createdAt: apiText(item.createdAt),
    rowCount: count("rowCount"),
    studentCount: count("studentCount"),
    courseCount: count("courseCount"),
    termCount: count("termCount"),
    missingScores: count("missingScores"),
    hasCompletion: item.hasCompletion === true,
  };
}

function parsePublishedDataset(value: unknown): GradeDataset {
  const dataset = apiObject(apiObject(value).dataset);
  const id = apiText(dataset.id);
  if (!id.startsWith("grades_"))
    throw new Error("导入服务返回的数据集 ID 无法识别，请刷新后重试。");
  return {
    id: id as GradeDataset["id"],
    name: apiText(dataset.name),
    owner: apiText(dataset.owner),
    enabled: dataset.enabled === true,
    currentVersion: apiText(dataset.currentVersion),
    versions: apiArray(dataset.versions).map(parseGradeVersion),
  };
}

function mappingIssues(mapping: GradeMapping, headers: string[]): string[] {
  const issues: string[] = [];
  const used = new Map<number, GradeField>();
  for (const field of GRADE_FIELDS) {
    const index = mapping[field];
    if (index === undefined) {
      if (requiredFields.includes(field)) issues.push(`请选择${fieldLabels[field]}对应的列。`);
      continue;
    }
    if (!Number.isInteger(index) || index < 0 || index >= headers.length) {
      issues.push(`${fieldLabels[field]}选择了不存在的列。`);
      continue;
    }
    const previous = used.get(index);
    if (previous) issues.push(`${fieldLabels[field]}与${fieldLabels[previous]}不能映射到同一列。`);
    else used.set(index, field);
  }
  return issues;
}

export function GradeImport({
  request,
  targets,
  onPublished,
}: {
  request: JsonRequest;
  targets: GradeImportTarget[];
  onPublished: (dataset: GradeDataset) => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<GradeDraft | null>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  const [headerRowText, setHeaderRowText] = useState("1");
  const [preview, setPreview] = useState<GradeSheetPreview | null>(null);
  const [mapping, setMapping] = useState<GradeMapping>({});
  const [validation, setValidation] = useState<GradeValidation | null>(null);
  const [validatedKey, setValidatedKey] = useState<string | null>(null);
  const [invalidatedReason, setInvalidatedReason] = useState<string | null>(null);
  const [publicationMode, setPublicationMode] = useState<PublicationMode>("new");
  const [targetId, setTargetId] = useState("");
  const [name, setName] = useState("");
  const [published, setPublished] = useState<GradeDataset | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [fileInputKey, setFileInputKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(true);
  const controllersRef = useRef(new Set<AbortController>());
  const uploadGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const validationGeneration = useRef(0);
  const publishGeneration = useRef(0);
  const previewController = useRef<AbortController | null>(null);
  const validationController = useRef<AbortController | null>(null);
  const publishController = useRef<AbortController | null>(null);
  const publishLock = useRef(false);
  const draftRef = useRef<GradeDraft | null>(null);
  const validationKeyRef = useRef<string | null>(null);
  const expirationNotified = useRef(false);
  const unmountCleanupTimer = useRef<number | null>(null);

  const parsedHeaderRow = /^\d+$/.test(headerRowText) ? Number(headerRowText) : 0;
  const headerRowValid =
    Number.isInteger(parsedHeaderRow) &&
    parsedHeaderRow >= 1 &&
    parsedHeaderRow <= GRADE_LIMITS.maxRows;
  const expiresAt = draft ? new Date(draft.expiresAt).getTime() : Number.NaN;
  const expired = Boolean(draft && (!Number.isFinite(expiresAt) || expiresAt <= clock));
  const selectedTarget =
    publicationMode === "version" ? targets.find((target) => target.id === targetId) : undefined;
  const currentSnapshot: ValidationSnapshot | null =
    draft && sheet !== null && headerRowValid
      ? {
          draftId: draft.id,
          sheet,
          headerRow: parsedHeaderRow,
          mapping: canonicalMapping(mapping),
          name,
          mode: publicationMode,
          targetId: publicationMode === "version" ? targetId || null : null,
          baseVersion:
            publicationMode === "version" ? (selectedTarget?.currentVersion ?? null) : null,
        }
      : null;

  draftRef.current = draft;
  validationKeyRef.current = currentSnapshot ? validationKey(currentSnapshot) : null;

  const releaseController = useCallback((controller: AbortController) => {
    controllersRef.current.delete(controller);
  }, []);

  const createController = useCallback(() => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }, []);

  const abortAllRequests = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    previewController.current = null;
    validationController.current = null;
    publishController.current = null;
  }, []);

  const deleteDraft = useCallback(async (draftId: string, signal?: AbortSignal) => {
    const response = await fetch("/api/admin/imports", {
      method: "DELETE",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId }),
      signal,
    });
    if (response.ok) return;
    let message = "暂存数据清理失败。";
    try {
      const payload = apiObject((await response.json()) as unknown);
      if (typeof payload.error === "string" && payload.error) message = payload.error;
    } catch {
      /* The local selection is still reset when the cleanup response has no JSON body. */
    }
    throw new Error(message);
  }, []);

  function cleanDraft(draftId: string): void {
    void deleteDraft(draftId).catch(() => undefined);
  }

  function clearValidation(reason?: string): void {
    const hadValidation = Boolean(validation || validatedKey);
    validationGeneration.current += 1;
    validationController.current?.abort();
    validationController.current = null;
    setValidation(null);
    setValidatedKey(null);
    setPublished(null);
    setFeedback(null);
    // Keep an explicit card when a passed check stops applying, instead of
    // falling back to the "完成列映射后…" placeholder.
    setInvalidatedReason(hadValidation && reason ? reason : null);
  }

  const loadPreview = useCallback(
    async (draftId: string, nextSheet: number, nextHeaderRow: number) => {
      previewController.current?.abort();
      const generation = ++previewGeneration.current;
      const controller = createController();
      previewController.current = controller;
      setPreviewing(true);
      setPreviewError(null);
      try {
        const payload = await request<unknown>("/api/admin/imports/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftId, sheet: nextSheet, headerRow: nextHeaderRow }),
          signal: controller.signal,
        });
        if (
          !activeRef.current ||
          controller.signal.aborted ||
          generation !== previewGeneration.current
        )
          return;
        const nextPreview = parsePreviewResponse(payload);
        setPreview(nextPreview);
        setMapping(canonicalMapping(nextPreview.suggestedMapping));
      } catch (error) {
        if (!activeRef.current || isAbortError(error) || generation !== previewGeneration.current)
          return;
        setPreview(null);
        setPreviewError(errorMessage(error, "表头预览读取失败，请检查工作表或表头行。"));
      } finally {
        releaseController(controller);
        if (generation === previewGeneration.current) {
          previewController.current = null;
          if (activeRef.current) setPreviewing(false);
        }
      }
    },
    [createController, releaseController, request],
  );

  useEffect(() => {
    if (!draft || sheet === null || !headerRowValid) return;
    const timer = window.setTimeout(() => {
      void loadPreview(draft.id, sheet, parsedHeaderRow);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [draft, headerRowValid, loadPreview, parsedHeaderRow, sheet]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!draft || !expired || expirationNotified.current) return;
    expirationNotified.current = true;
    validationGeneration.current += 1;
    validationController.current?.abort();
    validationController.current = null;
    setValidation(null);
    setValidatedKey(null);
    setInvalidatedReason(null);
    setFeedback({
      kind: "warning",
      message: "导入暂存已过期。请取消当前导入后重新选择文件，过期暂存不会再用于校验或发布。",
    });
  }, [draft, expired]);

  useEffect(() => {
    activeRef.current = true;
    if (unmountCleanupTimer.current) {
      window.clearTimeout(unmountCleanupTimer.current);
      unmountCleanupTimer.current = null;
    }
    return () => {
      activeRef.current = false;
      abortAllRequests();
      const currentDraft = draftRef.current;
      if (currentDraft) {
        // Defer so React Strict Mode's effect replay does not delete a live draft.
        unmountCleanupTimer.current = window.setTimeout(() => {
          void deleteDraft(currentDraft.id).catch(() => undefined);
        }, 0);
      }
    };
  }, [abortAllRequests, deleteDraft]);

  const mappingErrors = preview ? mappingIssues(mapping, preview.headers) : [];
  const mappingReady = mappingErrors.length === 0;
  const canValidate =
    Boolean(draft && preview && currentSnapshot) &&
    !expired &&
    !previewing &&
    !uploading &&
    !validating &&
    !publishing &&
    !canceling &&
    mappingReady &&
    name.trim().length > 0 &&
    (publicationMode !== "version" || Boolean(selectedTarget));
  const selectionIsValidated =
    Boolean(validatedKey && validation?.valid) &&
    validatedKey === (currentSnapshot ? validationKey(currentSnapshot) : null) &&
    !expired;

  async function chooseFile(nextFile: File): Promise<void> {
    const lowerName = nextFile.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx")) {
      setFeedback({ kind: "error", message: "仅支持 .csv 或 .xlsx 文件。" });
      return;
    }
    if (nextFile.size > GRADE_LIMITS.maxBytes) {
      setFeedback({
        kind: "error",
        message: `文件不能超过 ${GRADE_LIMITS.maxBytes / 1024 / 1024} MB。`,
      });
      return;
    }

    const previousDraft = draftRef.current;
    abortAllRequests();
    previewGeneration.current += 1;
    validationGeneration.current += 1;
    const generation = ++uploadGeneration.current;
    draftRef.current = null;
    expirationNotified.current = false;
    setFile(nextFile);
    setDraft(null);
    setSheet(null);
    setHeaderRowText("1");
    setPreview(null);
    setPreviewError(null);
    setMapping({});
    const hadValidation = Boolean(validation || validatedKey);
    setValidation(null);
    setValidatedKey(null);
    setInvalidatedReason(hadValidation ? "已替换导入文件，之前的校验结果已失效。" : null);
    setPublicationMode("new");
    setTargetId("");
    setName(nextFile.name.replace(/\.(csv|xlsx)$/i, ""));
    setPublished(null);
    setFeedback(null);
    setUploading(true);
    setCanceling(false);

    if (previousDraft) cleanDraft(previousDraft.id);

    const contentType = lowerName.endsWith(".csv")
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const controller = createController();
    try {
      const payload = await request<unknown>("/api/admin/imports", {
        method: "POST",
        headers: {
          "content-type": contentType,
          "X-File-Name": encodeURIComponent(nextFile.name),
        },
        body: nextFile,
        signal: controller.signal,
      });
      if (
        !activeRef.current ||
        controller.signal.aborted ||
        generation !== uploadGeneration.current
      )
        return;
      const nextDraft = parseDraftResponse(payload);
      if (!nextDraft.sheets.length) {
        cleanDraft(nextDraft.id);
        throw new Error("文件中没有可读取的工作表。");
      }
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setClock(Date.now());
      setSheet(0);
      setFeedback({
        kind: "info",
        message: `已建立临时导入，共 ${nextDraft.sheets.length} 个工作表。请继续确认表头和字段对应关系。`,
      });
    } catch (error) {
      if (!activeRef.current || isAbortError(error) || generation !== uploadGeneration.current)
        return;
      draftRef.current = null;
      setFeedback({ kind: "error", message: errorMessage(error, "文件上传失败，请重试。") });
    } finally {
      releaseController(controller);
      if (generation === uploadGeneration.current && activeRef.current) setUploading(false);
    }
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>): void {
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (nextFile) void chooseFile(nextFile);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) void chooseFile(nextFile);
  }

  function changeSheet(nextSheet: number): void {
    clearValidation("工作表已切换，之前的校验结果已失效。");
    setSheet(nextSheet);
    setHeaderRowText("1");
    setPreview(null);
    setPreviewError(null);
    setMapping({});
  }

  function changeHeaderRow(value: string): void {
    clearValidation("表头行已修改，之前的校验结果已失效。");
    setHeaderRowText(value);
    setPreview(null);
    setPreviewError(null);
    setMapping({});
  }

  function changeMapping(field: GradeField, value: string): void {
    clearValidation("列映射已修改，之前的校验结果已失效。");
    setMapping((current) => {
      const next = { ...current };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  function changePublicationMode(nextMode: PublicationMode): void {
    clearValidation("发布方式已修改，之前的校验结果已失效。");
    setPublicationMode(nextMode);
    if (nextMode === "new") {
      setTargetId("");
      if (file) setName(file.name.replace(/\.(csv|xlsx)$/i, ""));
      return;
    }
    const firstTarget = targets[0];
    setTargetId(firstTarget?.id ?? "");
    if (firstTarget) setName(firstTarget.name);
  }

  function changeTarget(nextTargetId: string): void {
    clearValidation("发布目标已更改，之前的校验结果已失效。");
    setTargetId(nextTargetId);
    const nextTarget = targets.find((target) => target.id === nextTargetId);
    if (nextTarget) setName(nextTarget.name);
  }

  function changeName(value: string): void {
    clearValidation("数据集名称已修改，之前的校验结果已失效。");
    setName(value);
  }

  async function validateSelection(): Promise<void> {
    if (!draft || !preview || !currentSnapshot || !canValidate) return;
    const generation = ++validationGeneration.current;
    validationController.current?.abort();
    const controller = createController();
    validationController.current = controller;
    const targetKey = validationKey(currentSnapshot);
    setValidating(true);
    setValidation(null);
    setValidatedKey(null);
    setInvalidatedReason(null);
    setFeedback(null);
    try {
      const payload = await request<unknown>("/api/admin/imports/validation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId: currentSnapshot.draftId,
          sheet: currentSnapshot.sheet,
          headerRow: currentSnapshot.headerRow,
          mapping: currentSnapshot.mapping,
        }),
        signal: controller.signal,
      });
      if (
        !activeRef.current ||
        controller.signal.aborted ||
        generation !== validationGeneration.current ||
        validationKeyRef.current !== targetKey
      )
        return;
      const nextValidation = parseValidationResponse(payload);
      setValidation(nextValidation);
      setValidatedKey(targetKey);
      if (nextValidation.valid) {
        setFeedback({
          kind: "success",
          message: `校验通过：${formatNumber(nextValidation.rowCount)} 条成绩记录，可以发布当前数据。`,
        });
      } else {
        setFeedback({
          kind: "error",
          message: `校验发现 ${formatNumber(nextValidation.errorCount)} 个问题，请修正源文件或列映射后重新校验。`,
        });
      }
    } catch (error) {
      if (!activeRef.current || isAbortError(error) || generation !== validationGeneration.current)
        return;
      setValidation(null);
      setValidatedKey(null);
      setFeedback({ kind: "error", message: errorMessage(error, "成绩数据校验失败，请重试。") });
    } finally {
      releaseController(controller);
      if (generation === validationGeneration.current) {
        validationController.current = null;
        if (activeRef.current) setValidating(false);
      }
    }
  }

  async function publish(): Promise<void> {
    if (
      publishLock.current ||
      !draft ||
      !currentSnapshot ||
      !validation?.valid ||
      !selectionIsValidated ||
      expired
    )
      return;
    if (!name.trim()) {
      setFeedback({ kind: "error", message: "请填写数据集名称。" });
      return;
    }
    if (publicationMode === "version" && !selectedTarget) {
      setFeedback({ kind: "error", message: "请选择要创建新版本的上传数据集。" });
      return;
    }

    publishLock.current = true;
    const generation = ++publishGeneration.current;
    const controller = createController();
    publishController.current = controller;
    setPublishing(true);
    setFeedback(null);
    try {
      const payload = await request<unknown>("/api/admin/imports/publications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          sheet: currentSnapshot.sheet,
          headerRow: currentSnapshot.headerRow,
          mapping: currentSnapshot.mapping,
          name: name.trim(),
          ...(publicationMode === "version" && selectedTarget
            ? {
                datasetId: selectedTarget.id,
                baseVersion: selectedTarget.currentVersion,
              }
            : {}),
        }),
        signal: controller.signal,
      });
      if (
        !activeRef.current ||
        controller.signal.aborted ||
        generation !== publishGeneration.current
      )
        return;
      const dataset = parsePublishedDataset(payload);
      draftRef.current = null;
      setDraft(null);
      setFile(null);
      setSheet(null);
      setHeaderRowText("1");
      setPreview(null);
      setMapping({});
      setValidation(null);
      setValidatedKey(null);
      setInvalidatedReason(null);
      setPublished(dataset);
      setFeedback({
        kind: "success",
        message: `“${dataset.name}”已发布为版本 ${dataset.currentVersion}。目录已刷新，导入暂存已清理。`,
      });
      setFileInputKey((value) => value + 1);
      await onPublished(dataset);
    } catch (error) {
      if (!activeRef.current || isAbortError(error) || generation !== publishGeneration.current)
        return;
      // Keep the same draft, mapping and target so a deliberate retry is safe and explicit.
      setFeedback({
        kind: "error",
        message: errorMessage(error, "发布失败。当前暂存和校验结果均已保留，可修正冲突后重试。"),
      });
    } finally {
      publishLock.current = false;
      releaseController(controller);
      if (generation === publishGeneration.current) {
        publishController.current = null;
        if (activeRef.current) setPublishing(false);
      }
    }
  }

  function resetSelections(): void {
    uploadGeneration.current += 1;
    previewGeneration.current += 1;
    validationGeneration.current += 1;
    publishGeneration.current += 1;
    abortAllRequests();
    draftRef.current = null;
    expirationNotified.current = false;
    setFile(null);
    setDraft(null);
    setSheet(null);
    setHeaderRowText("1");
    setPreview(null);
    setMapping({});
    setValidation(null);
    setValidatedKey(null);
    setInvalidatedReason(null);
    setPublished(null);
    setPreviewError(null);
    setUploading(false);
    setPreviewing(false);
    setValidating(false);
    setPublishing(false);
    setPublicationMode("new");
    setTargetId("");
    setName("");
    setFileInputKey((value) => value + 1);
  }

  async function cancelImport(): Promise<void> {
    if (canceling) return;
    const currentDraft = draftRef.current;
    setCanceling(true);
    resetSelections();
    if (!currentDraft) {
      setFeedback({ kind: "info", message: "已取消本次导入并清除文件选择。" });
      setCanceling(false);
      return;
    }
    try {
      await deleteDraft(currentDraft.id);
      if (activeRef.current)
        setFeedback({ kind: "success", message: "已取消导入，并清理服务器上的暂存数据。" });
    } catch (error) {
      if (activeRef.current) {
        setFeedback({
          kind: "warning",
          message: `${errorMessage(error, "服务器暂存清理失败。")}本地选择已清除；暂存将在到期后自动失效。`,
        });
      }
    } finally {
      if (activeRef.current) setCanceling(false);
    }
  }

  function downloadValidationIssues(): void {
    if (!validation || !validation.issues.length) return;
    const rows = [
      ["row", "field", "code", "message"],
      ...validation.issues
        .slice(0, GRADE_LIMITS.maxIssues)
        .map((issue) => [issue.row, issue.field, issue.code, issue.message]),
    ];
    const csv = rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(
      new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
      `grade-import-errors-${date}.csv`,
    );
  }

  async function downloadTemplate(): Promise<void> {
    if (downloadingTemplate) return;
    const controller = createController();
    setDownloadingTemplate(true);
    try {
      const response = await fetch("/api/admin/imports/template", {
        cache: "no-store",
        headers: { accept: "text/csv" },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error("登录已过期，请重新登录。");
        let message = "模板下载失败，请稍后重试。";
        try {
          const payload = apiObject((await response.json()) as unknown);
          if (typeof payload.error === "string" && payload.error) message = payload.error;
        } catch {
          /* Keep the stable fallback for non-JSON failures. */
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      triggerDownload(blob, "grade-import-template.csv");
    } catch (error) {
      if (!activeRef.current || isAbortError(error)) return;
      setFeedback({ kind: "error", message: errorMessage(error, "模板下载失败，请重试。") });
    } finally {
      releaseController(controller);
      if (activeRef.current) setDownloadingTemplate(false);
    }
  }

  const activeImport = Boolean(file || draft || uploading || publishing);
  const displayedIssues = validation?.issues.slice(0, GRADE_LIMITS.maxIssues) ?? [];

  return (
    <section className={styles.importLedger} aria-labelledby="grade-import-title">
      <header className={styles.importHeader}>
        <div>
          <span className={styles.eyebrow}>DATA / 版本化成绩导入</span>
          <h3 id="grade-import-title">从原始文件建立可追溯数据集</h3>
          <p>
            先校验，再发布。发布只接受最后一次校验所对应的文件、工作表、表头、映射、名称与目标。
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={downloadingTemplate}
          onClick={() => void downloadTemplate()}
        >
          <Icon name="download" size={16} />
          {downloadingTemplate ? "正在下载…" : "下载 CSV 模板"}
        </button>
      </header>

      {feedback ? (
        <div
          className={`notice notice-${feedback.kind} ${styles.inlineNotice}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          <Icon name={feedback.kind === "success" ? "check" : "info"} />
          <span>{feedback.message}</span>
        </div>
      ) : null}

      {published ? (
        <div className={styles.publishedReceipt} role="status">
          <span className={styles.receiptIndex}>PUBLISHED</span>
          <div>
            <strong>{published.name}</strong>
            <p>
              当前版本 <code>{published.currentVersion}</code> · {published.versions.length}{" "}
              个版本可追溯
            </p>
          </div>
          <Icon name="check" size={22} />
        </div>
      ) : null}

      <div className={styles.ledgerGrid}>
        <section className={styles.stepPanel} aria-labelledby="grade-import-source-title">
          <div className={styles.stepHeading}>
            <span>01</span>
            <div>
              <h4 id="grade-import-source-title">导入源文件</h4>
              <p>CSV 或 XLSX，最大 {GRADE_LIMITS.maxBytes / 1024 / 1024} MB。</p>
            </div>
          </div>
          <label
            className={styles.dropZone}
            data-dragging={dragging}
            data-has-file={Boolean(file)}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={onDrop}
          >
            <input
              key={fileInputKey}
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className={styles.fileInput}
              onChange={onFileInput}
              disabled={uploading || publishing}
            />
            <span className={styles.dropIcon}>
              <Icon name={file ? "file" : "upload"} size={22} />
            </span>
            <span className={styles.dropCopy}>
              <strong>
                {file ? file.name : dragging ? "释放以读取文件" : "选择文件或拖到这里"}
              </strong>
              <small>
                {file
                  ? `${(file.size / 1024).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} KB`
                  : "原始文件只进入管理员导入暂存，不会发送给 AI"}
              </small>
            </span>
            <span className={styles.fileAction}>{file ? "替换" : "浏览"}</span>
          </label>

          {uploading ? (
            <div className={styles.progressLine} role="status">
              <span aria-hidden="true" />
              正在读取工作簿并建立临时导入…
            </div>
          ) : null}

          {draft ? (
            <div className={styles.draftStrip}>
              <div>
                <span>暂存有效期</span>
                <strong>{formatRemaining(draft.expiresAt, clock)}</strong>
                <small>到期于 {formatExpiry(draft.expiresAt)}</small>
              </div>
              <div>
                <span>工作表</span>
                <strong>{draft.sheets.length}</strong>
                <small>校验前可切换</small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={publishing || canceling}
                onClick={() => void cancelImport()}
              >
                {canceling ? "正在清理…" : "取消导入"}
              </button>
            </div>
          ) : activeImport ? (
            <button
              type="button"
              className="secondary-button"
              disabled={canceling}
              onClick={() => void cancelImport()}
            >
              {canceling ? "正在清理…" : "取消导入"}
            </button>
          ) : null}
        </section>

        <section className={styles.stepPanel} aria-labelledby="grade-import-selection-title">
          <div className={styles.stepHeading}>
            <span>02</span>
            <div>
              <h4 id="grade-import-selection-title">定位表头与列映射</h4>
              <p>选择字段名称所在的行，再确认每个字段对应哪一列。</p>
            </div>
          </div>

          {draft ? (
            <>
              <div className={styles.selectionControls}>
                <div className="form-field">
                  <label htmlFor="grade-import-sheet">工作表</label>
                  <select
                    id="grade-import-sheet"
                    value={sheet ?? ""}
                    onChange={(event) => changeSheet(Number(event.target.value))}
                    disabled={previewing || validating || publishing || expired}
                  >
                    {draft.sheets.map((item, index) => (
                      <option key={`${item.name}-${index}`} value={index}>
                        {item.name} · {formatNumber(item.rowCount)} 行
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="grade-import-header-row">表头行（从 1 开始）</label>
                  <input
                    id="grade-import-header-row"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={GRADE_LIMITS.maxRows}
                    step={1}
                    value={headerRowText}
                    aria-invalid={!headerRowValid}
                    aria-describedby="grade-import-header-help"
                    onChange={(event) => changeHeaderRow(event.target.value)}
                    disabled={previewing || validating || publishing || expired}
                  />
                  <p id="grade-import-header-help" className="form-help">
                    输入 1–{formatNumber(GRADE_LIMITS.maxRows)} 的整数。
                  </p>
                </div>
              </div>

              {expired ? (
                <p className={`notice notice-warning ${styles.inlineNotice}`} role="alert">
                  <Icon name="info" />
                  <span>暂存已过期，不能再预览、校验或发布。请取消后重新导入文件。</span>
                </p>
              ) : previewing ? (
                <div className={styles.progressLine} role="status">
                  <span aria-hidden="true" />
                  正在读取第 {parsedHeaderRow || "—"} 行表头…
                </div>
              ) : previewError ? (
                <div className={`notice notice-error ${styles.inlineNotice}`} role="alert">
                  <Icon name="info" />
                  <span>{previewError}</span>
                </div>
              ) : preview ? (
                <>
                  <div className={styles.previewTableWrap}>
                    <table className={styles.previewTable}>
                      <caption className="sr-only">所选工作表预览</caption>
                      <thead>
                        <tr>
                          {preview.headers.map((header, index) => (
                            <th key={`${header}-${index}`} scope="col">
                              <span>列 {index + 1}</span>
                              {header || `第 ${index + 1} 列`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.preview.slice(0, 6).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {preview.headers.map((_, columnIndex) => (
                              <td key={columnIndex} className={previewCellClass(row[columnIndex])}>
                                {row[columnIndex] || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {!preview.preview.length ? (
                          <tr>
                            <td colSpan={Math.max(1, preview.headers.length)}>
                              表头之后没有数据行。
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <fieldset
                    className={styles.mappingFieldset}
                    disabled={validating || publishing || expired}
                  >
                    <legend>字段映射</legend>
                    <div className={styles.mappingGrid}>
                      {GRADE_FIELDS.map((field) => {
                        const value = mapping[field];
                        const missing = requiredFields.includes(field) && value === undefined;
                        return (
                          <label key={field} className="form-field">
                            <span>
                              {fieldLabels[field]}
                              {requiredFields.includes(field) ? " *" : ""}
                            </span>
                            <select
                              value={value ?? ""}
                              aria-invalid={missing}
                              aria-describedby={`grade-import-mapping-${field}-help`}
                              onChange={(event) => changeMapping(field, event.target.value)}
                            >
                              <option value="">
                                {requiredFields.includes(field) ? "请选择列" : "不导入"}
                              </option>
                              {preview.headers.map((header, index) => (
                                <option key={`${field}-${index}`} value={index}>
                                  第 {index + 1} 列 · {header || "未命名"}
                                </option>
                              ))}
                            </select>
                            <small id={`grade-import-mapping-${field}-help`}>
                              {fieldHints[field]}
                            </small>
                          </label>
                        );
                      })}
                    </div>
                    {mappingErrors.length ? (
                      <div className={styles.mappingErrors} role="alert">
                        {mappingErrors.map((message) => (
                          <span key={message}>{message}</span>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.mappingReady}>
                        <Icon name="check" size={14} />
                        四个必填字段均已映射到不同列。
                      </p>
                    )}
                  </fieldset>

                  <div className={styles.validateBar}>
                    <div>
                      <span>显式校验闸门</span>
                      <small>校验会检查行数、学生与课程覆盖、缺失成绩及完成标记。</small>
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!canValidate}
                      onClick={() => void validateSelection()}
                    >
                      <Icon name={validating ? "refresh" : "check"} size={16} />
                      {validating ? "正在校验…" : validation ? "重新校验" : "校验当前选择"}
                    </button>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <div className={styles.stepEmpty}>
              <Icon name="database" size={20} />
              <span>上传文件后，这里会显示工作表、表头行、列预览和字段映射。</span>
            </div>
          )}
        </section>

        <section className={styles.stepPanel} aria-labelledby="grade-import-validation-title">
          <div className={styles.stepHeading}>
            <span>03</span>
            <div>
              <h4 id="grade-import-validation-title">核对校验结果</h4>
              <p>错误预检限制在 {GRADE_LIMITS.maxIssues} 条以内，避免页面与响应失控。</p>
            </div>
          </div>

          {validation ? (
            <>
              <div className={styles.validationSummary} data-valid={validation.valid}>
                <div>
                  <span>结论</span>
                  <strong>{validation.valid ? "PASS" : "BLOCKED"}</strong>
                  <small>{formatNumber(validation.errorCount)} 个错误</small>
                </div>
                <div>
                  <span>记录</span>
                  <strong>{formatNumber(validation.rowCount)}</strong>
                  <small>{formatNumber(validation.missingScores)} 条缺失成绩</small>
                </div>
                <div>
                  <span>覆盖</span>
                  <strong>{formatNumber(validation.studentCount)}</strong>
                  <small>
                    {formatNumber(validation.courseCount)} 课程 ·{" "}
                    {formatNumber(validation.termCount)} 学期
                  </small>
                </div>
                <div>
                  <span>完成标记</span>
                  <strong>{validation.hasCompletion ? "YES" : "NO"}</strong>
                  <small>
                    {validation.hasCompletion ? "已包含可选完成状态" : "仅使用四项必填字段"}
                  </small>
                </div>
              </div>

              {displayedIssues.length ? (
                <div className={styles.issuesBlock}>
                  <div className={styles.issuesToolbar}>
                    <div>
                      <strong>错误明细</strong>
                      <span>
                        显示 {formatNumber(displayedIssues.length)} /{" "}
                        {formatNumber(validation.issues.length)} 条
                      </span>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={downloadValidationIssues}
                    >
                      <Icon name="download" size={16} />
                      下载安全 CSV
                    </button>
                  </div>
                  <div className={styles.issueTableWrap}>
                    <table className={styles.issueTable}>
                      <caption className="sr-only">校验错误明细</caption>
                      <thead>
                        <tr>
                          <th scope="col">行</th>
                          <th scope="col">字段</th>
                          <th scope="col">代码</th>
                          <th scope="col">说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedIssues.map((issue, index) => (
                          <tr key={`${issue.row}-${issue.field}-${issue.code}-${index}`}>
                            <td data-label="行">{formatNumber(issue.row)}</td>
                            <td data-label="字段">
                              <code>{issue.field}</code>
                            </td>
                            <td data-label="代码">
                              <code>{issue.code}</code>
                            </td>
                            <td data-label="说明">{issue.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {validation.preview.length ? (
                <div className={styles.validationPreview}>
                  <div className={styles.subheading}>
                    <strong>规范化预览</strong>
                    <span>仅显示校验服务返回的前 {validation.preview.length} 行</span>
                  </div>
                  <div className={styles.previewTableWrap}>
                    <table className={styles.previewTable}>
                      <caption className="sr-only">规范化成绩预览</caption>
                      <thead>
                        <tr>
                          <th scope="col">学生编号</th>
                          <th scope="col">课程</th>
                          <th scope="col">学期</th>
                          <th scope="col">成绩</th>
                          <th scope="col">完成</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validation.preview.map((row, index) => (
                          <tr
                            key={`${row.id_student}-${row.code_module}-${row.code_presentation}-${index}`}
                          >
                            <td className={previewCellClass(row.id_student)}>{row.id_student}</td>
                            <td className={previewCellClass(row.code_module)}>{row.code_module}</td>
                            <td className={previewCellClass(row.code_presentation)}>
                              {row.code_presentation}
                            </td>
                            <td className={previewCellClass(row.score)}>{row.score ?? "—"}</td>
                            <td className={previewCellClass(row.completed)}>
                              {row.completed ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          ) : validating ? (
            <div className={styles.progressLine} role="status">
              <span aria-hidden="true" />
              正在校验当前选择…
            </div>
          ) : invalidatedReason ? (
            <div
              className={`notice notice-warning ${styles.inlineNotice} ${styles.staleValidation}`}
              role="status"
            >
              <Icon name="info" />
              <span>{invalidatedReason}</span>
              <button
                type="button"
                className="text-button"
                disabled={!canValidate || validating}
                onClick={() => void validateSelection()}
              >
                <Icon name="refresh" size={16} />
                重新校验
              </button>
            </div>
          ) : (
            <div className={styles.stepEmpty}>
              <Icon name="check" size={20} />
              <span>完成列映射并点击“校验当前选择”后，结果会锁定在这里。</span>
            </div>
          )}
        </section>

        <section className={styles.stepPanel} aria-labelledby="grade-import-publish-title">
          <div className={styles.stepHeading}>
            <span>04</span>
            <div>
              <h4 id="grade-import-publish-title">发布版本</h4>
              <p>新版本必须基于目录中的当前版本；本阶段不提供回滚。</p>
            </div>
          </div>

          <fieldset
            className={styles.publishFieldset}
            disabled={validating || publishing || expired}
          >
            <legend>发布目标</legend>
            <div className={styles.modeOptions}>
              <label data-checked={publicationMode === "new"}>
                <input
                  type="radio"
                  name="grade-publication-mode"
                  value="new"
                  checked={publicationMode === "new"}
                  onChange={() => changePublicationMode("new")}
                />
                <span>
                  <strong>新建数据集</strong>
                  <small>创建独立数据集，保留当前数据</small>
                </span>
              </label>
              <label data-checked={publicationMode === "version"}>
                <input
                  type="radio"
                  name="grade-publication-mode"
                  value="version"
                  checked={publicationMode === "version"}
                  onChange={() => changePublicationMode("version")}
                  disabled={!targets.length}
                />
                <span>
                  <strong>上传数据集新版本</strong>
                  <small>
                    {targets.length
                      ? "仅可选择由导入创建的数据集"
                      : "目录中还没有可更新的上传数据集"}
                  </small>
                </span>
              </label>
            </div>

            {publicationMode === "version" ? (
              <div className="form-field">
                <label htmlFor="grade-import-version-target">目标数据集</label>
                <select
                  id="grade-import-version-target"
                  value={targetId}
                  onChange={(event) => changeTarget(event.target.value)}
                >
                  <option value="">请选择上传数据集</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name} · 当前 {target.currentVersion}
                    </option>
                  ))}
                </select>
                {selectedTarget ? (
                  <p className="form-help">
                    发布时以 {selectedTarget.currentVersion}{" "}
                    作为本次更新的参照；若其他人先发布了新版本，请刷新后重试。
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="form-field">
              <label htmlFor="grade-import-dataset-name">数据集名称</label>
              <input
                id="grade-import-dataset-name"
                maxLength={80}
                value={name}
                placeholder="例如：2026 秋季课程成绩"
                onChange={(event) => changeName(event.target.value)}
              />
              <p className="form-help">名称用于标识本次发布的数据集；修改名称后需要重新校验。</p>
            </div>
          </fieldset>

          <div className={styles.publishGate}>
            <div data-ready={selectionIsValidated}>
              <Icon name={selectionIsValidated ? "check" : "shield"} size={18} />
              <span>
                <strong>{selectionIsValidated ? "当前数据已通过校验" : "请先校验当前数据"}</strong>
                <small>
                  {selectionIsValidated
                    ? "文件、列、名称与目标均与最后一次校验一致。"
                    : "任何列映射、表头、文件、名称或发布目标的修改都会撤销发布资格。"}
                </small>
              </span>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!selectionIsValidated || publishing || canceling}
              onClick={() => void publish()}
            >
              <Icon name={publishing ? "refresh" : "database"} size={16} />
              {publishing
                ? "正在发布…"
                : publicationMode === "version"
                  ? "发布新版本"
                  : "发布数据集"}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
