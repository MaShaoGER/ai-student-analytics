"use client";

import { useEffect, useState } from "react";
import type { AIConfig, AnalysisControlResponse } from "@/lib/client-types";

export function AnalysisControls({
  request,
  connectionReady,
  config,
  onUsageChange,
}: {
  request: <T>(url: string, options?: RequestInit) => Promise<T>;
  connectionReady: boolean;
  config: AIConfig;
  onUsageChange?: () => void;
}) {
  const [state, setState] = useState<AnalysisControlResponse | null>(null);
  const [draft, setDraft] = useState<AnalysisControlResponse["settings"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void request<AnalysisControlResponse>("/api/admin/analysis-settings", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setState(value);
          setDraft(value.settings);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setFeedback({ error: true, message: "综合分析设置读取失败，请重新打开管理页。" });
      });
    return () => controller.abort();
  }, [request, config]);
  async function action(kind: "save" | "probe" | "rebuild") {
    if (busy || !draft) return;
    setBusy(true);
    setFeedback(null);
    try {
      const value = await request<AnalysisControlResponse>("/api/admin/analysis-settings", {
        method: kind === "save" ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "save" ? draft : { action: kind }),
      });
      setState(value);
      setDraft(value.settings);
      setFeedback({
        error: false,
        message:
          kind === "probe"
            ? "工具调用与结果回传检测通过。此次检测已计入用量。"
            : kind === "rebuild"
              ? "知识索引已按当前项目资料重建。"
              : "综合分析限制已保存。",
      });
    } catch (error) {
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : "操作未完成，请重试。",
      });
      // A failed compatibility probe may update its status; reload without swallowing the failure notice.
      if (kind === "probe") {
        try {
          setState(await request<AnalysisControlResponse>("/api/admin/analysis-settings"));
        } catch {
          /* Retain notice. */
        }
      }
    } finally {
      setBusy(false);
      if (kind === "probe") onUsageChange?.();
    }
  }
  return (
    <div className="admin-form-section" aria-busy={busy}>
      <div className="admin-section-heading">
        <div>
          <h3>综合分析</h3>
          <p>允许助手根据真实结果继续查询，并展示步骤和引用。</p>
        </div>
      </div>
      {feedback ? (
        <p
          className={`notice notice-${feedback.error ? "error" : "success"}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
      {!state || !draft ? (
        <p role="status">正在读取综合分析设置…</p>
      ) : (
        <>
          <label className="admin-toggle" htmlFor="analysis-enabled">
            <span>
              <strong>允许综合分析</strong>
              <span>开启后仍需当前模型通过工具调用检测。</span>
            </span>
            <input
              id="analysis-enabled"
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
          </label>
          <div className="admin-form-grid">
            <div className="form-field">
              <label htmlFor="analysis-tool-limit">每轮最多调用工具次数</label>
              <input
                id="analysis-tool-limit"
                type="number"
                min={2}
                max={8}
                required
                value={draft.maxToolCalls}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, maxToolCalls: Number(event.target.value) })
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor="analysis-timeout">每轮最长时间（秒）</label>
              <input
                id="analysis-timeout"
                type="number"
                min={15}
                max={120}
                required
                value={draft.timeoutSeconds}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })
                }
              />
            </div>
          </div>
          <p className="form-help">
            所有步骤共用已有的单次请求预算。工具次数不包含模型决策轮次，模型请求同样计费并受总时间限制。
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void action("save")}
          >
            保存分析限制
          </button>
          <p>
            <strong>模型工具调用：</strong>
            {state.capability.status === "supported"
              ? "已通过检测"
              : state.capability.status === "failed"
                ? "本次检测未通过"
                : "尚未检测或连接已更改"}
          </p>
          {state.capability.checkedAt ? (
            <p className="form-help">
              检测时间：
              {new Date(state.capability.checkedAt).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}
            </p>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !connectionReady}
            onClick={() => void action("probe")}
          >
            {busy ? "正在处理…" : "检测工具调用兼容性"}
          </button>
          <p className="form-help">
            先保存模型连接再检测。检测会实际调用模型并计入预算；更换连接、协议、模型或密钥后需重新检测。
          </p>
          <details className="field-details">
            <summary>
              知识库 · {state.knowledge.count} 条资料 · {state.knowledge.version}
            </summary>
            <p>
              资料包含指标定义、数据来源、比较口径与隐私限制，由项目文件维护。尚未收录学校正式教学规则。
            </p>
            <p className="form-help">
              {state.knowledge.stale
                ? "来源已变更，需重建索引。"
                : state.knowledge.builtAt
                  ? `索引更新：${new Date(state.knowledge.builtAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                  : "当前使用随项目发布的内置索引。"}
            </p>
            <a href="/knowledge/teaching" target="_blank" rel="noreferrer">
              查看资料与版本
            </a>{" "}
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void action("rebuild")}
            >
              重建知识索引
            </button>
          </details>
        </>
      )}
    </div>
  );
}
