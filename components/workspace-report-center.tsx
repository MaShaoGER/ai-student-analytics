"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/app-icons";
import type { AnalysisResult } from "@/lib/analysis/types";
import {
  analysisDimensionLabel,
  analysisReportHtml,
  analysisSourceLabel,
  downloadAnalysisFile,
} from "@/lib/exports/analysis";

export type SessionAnalysis = { key: string; result: AnalysisResult };

export function ReportCenter({
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
  const html = useMemo(() => (result ? analysisReportHtml(result) : ""), [result]);
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
        <h2>先完成一次分析，再预览报告</h2>
        <p>
          报告预览包含真实结论、分组数据、样本人数和计算说明。本次会话还没有可用的分析结果。
        </p>
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
