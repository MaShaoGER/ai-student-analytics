import { METRICS } from "@/lib/analysis/metrics";
import type { AnalysisResult } from "@/lib/analysis/types";

export function analysisSourceLabel(result: AnalysisResult): string {
  return result.datasetId === "oulad" ? "OULAD 本地数据" : "模拟校园数据";
}

export function analysisDimensionLabel(result: AnalysisResult): string {
  return (result.dimensions ?? [result.dimension])
    .map((dimension) => (dimension === "term" ? "学期" : "课程"))
    .join(" / ");
}

export function analysisMetricDescription(result: AnalysisResult): string {
  const metric = Object.entries(METRICS).find(
    ([, definition]) => definition.label === result.metricLabel,
  );
  if (!metric) return "请结合下方实际查询核对计算口径。";
  if (result.datasetId !== "oulad")
    return metric[0] === "completion_rate"
      ? "学生-课程-开课期记录中，已完成记录占满足统计条件记录的比例。"
      : metric[1].description;
  if (metric[0] === "score")
    return "先计算每名学生在同一课程、开课期的考核平均成绩，再按所选分组取均值。";
  if (metric[0] === "activity") return "汇总学习资源访问记录中的 sum_click，表示资源访问总次数。";
  return "最终结果为 Pass 或 Distinction 的学生课程记录占满足统计条件记录的比例。";
}

export function csvCell(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  // Quoting alone does not prevent Excel from evaluating a cell as a formula.
  const guarded =
    /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value)
      ? `'${value}`
      : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/** Shared by the screen and exports, including old snapshots without a measured count. */
export function analysisSuppressionNote(result: AnalysisResult): string {
  const count = result.filteredOutGroupCount;
  return typeof count === "number" && Number.isInteger(count) && count >= 0
    ? count > 0 ? `本次因样本不足过滤 ${count} 个分组。` : "本次没有因样本不足被过滤的分组。"
    : "本次未记录小样本过滤分组数，无法确定。";
}

export function analysisCsv(result: AnalysisResult): string {
  const dimension = analysisDimensionLabel(result);
  const records: (string | number)[][] = [
    [dimension, "指标值", "参与统计人数", "数据源", "指标", "单位", "统计周期", "最小样本人数", "小样本过滤说明"],
    ...(result.rows.length ? result.rows : [null]).map((row) => [
      row?.dimension ?? "",
      row?.value ?? "",
      row?.sampleSize ?? "",
      analysisSourceLabel(result),
      result.metricLabel,
      result.unit,
      result.period,
      result.minSampleSize,
      analysisSuppressionNote(result),
    ]),
  ];
  return `\uFEFF${records.map((record) => record.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function escapeHtml(value: string | number): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export function analysisReportHtml(
  result: AnalysisResult,
  theme: "light" | "dark" = "light",
): string {
  const h = escapeHtml;
  const dimension = analysisDimensionLabel(result);
  const highest = result.rows.reduce<AnalysisResult["rows"][number] | null>(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  const insight = highest
    ? `${highest.dimension} 的${result.metricLabel}最高，为 ${highest.value} ${result.unit}。`
    : "本次分析没有可展示的分组。";
  const filtered = analysisSuppressionNote(result);
  const max = Math.max(...result.rows.map((row) => row.value), 1);
  const metricColors =
    result.unit === "%"
      ? ["#386454", "#d5e2d4", "#a3d8c3", "#193e37"]
      : result.unit === "次"
        ? ["#835131", "#e8dfce", "#ffbc8f", "#3e2b24"]
        : ["#304b38", "#dbe4d4", "#afdbd9", "#193e45"];
  const rows = result.rows
    .map((row) => {
      const width = Math.min(100, Math.max(0, (row.value / max) * 100));
      return `<tr><th scope="row">${h(row.dimension)}</th><td>${h(row.value)}</td><td>${h(row.sampleSize)}</td><td><div class="bar" style="width:${Number.isFinite(width) ? width : 0}%"></div></td></tr>`;
    })
    .join("");
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme === "dark" ? "dark" : "light"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${h(result.metricLabel)}分析报告 · 学析台</title>
<style>
:root{color-scheme:light;--bg:#e1e3d8;--paper:#f0f0e7;--ink:#242923;--muted:#5c665a;--line:#a5aca0;--inset:#e5e7dc;--accent:#f56837;--metric:${metricColors[0]};--metric-soft:${metricColors[1]}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#101b21;--paper:#16232a;--ink:#e4eef0;--muted:#adc1c8;--line:#3b535c;--inset:#121e25;--accent:#ff5b04;--metric:${metricColors[2]};--metric-soft:${metricColors[3]}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.7 "Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:920px;margin:24px auto;padding:38px;background:var(--paper);border-radius:0;border-top:5px solid var(--accent)}h1{font-size:32px;margin:20px 0 24px;font-weight:700;letter-spacing:-1px}h2{font-size:19px;margin:28px 0 12px;font-weight:600}.brand{display:inline-block;padding:6px 12px;border-radius:0;background:var(--accent);color:#242923;font-size:12px;font-weight:500}.note{color:var(--muted);font-size:12px}.summary{padding:16px 20px;background:var(--metric-soft);border-radius:0}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}dl div{border-bottom:1px solid var(--line);padding:10px 0}dt{font-size:12px;color:var(--muted)}dd{margin:3px 0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}caption{text-align:left;font-weight:500;padding:10px 0}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;overflow-wrap:anywhere}thead{background:var(--inset)}.bar{height:10px;border-radius:0;background:var(--metric);min-width:1px}td:last-child{width:22%}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.7 ui-monospace,monospace;background:var(--inset);padding:16px;border-radius:0}footer{border-top:1px solid var(--line);padding-top:18px;margin-top:28px}@media(max-width:600px){main{margin:0;padding:24px 16px;border-radius:0}dl{grid-template-columns:1fr}}@page{size:A4;margin:16mm}@media print{:root,:root[data-theme="dark"]{color-scheme:light;--paper:#fff;--ink:#252820;--muted:#62675a;--line:#25282018;--inset:#e9ece2;--metric:${metricColors[0]};--metric-soft:${metricColors[1]}}body{background:#fff}main{max-width:none;margin:0;padding:0;border-radius:0}thead{display:table-header-group}tr,dl div,.summary{break-inside:avoid}.bar,.summary,thead{print-color-adjust:exact;-webkit-print-color-adjust:exact}h2{break-after:avoid}}
</style></head><body><main>
<span class="brand">学析台 · 学习数据分析报告</span><h1>${h(result.metricLabel)}按${h(dimension)}比较</h1>
<p class="summary">${h(insight)}</p>
<dl><div><dt>数据源</dt><dd>${h(analysisSourceLabel(result))}</dd></div><div><dt>统计周期</dt><dd>${h(result.period)}</dd></div><div><dt>统计指标与单位</dt><dd>${h(result.metricLabel)}（${h(result.unit)}）</dd></div><div><dt>展示范围</dt><dd>${h(result.rows.length)} 个${h(dimension)}分组；仅包含本次查询返回结果</dd></div><div><dt>指标口径</dt><dd>${h(analysisMetricDescription(result))}</dd></div><div><dt>样本与隐私</dt><dd>每组至少 ${h(result.minSampleSize)} 名学生；少于此阈值的分组不展示。${h(filtered)}</dd></div></dl>
<h2>分组统计与数值对比</h2><table><caption>${h(result.metricLabel)}（${h(result.unit)}）</caption><thead><tr><th>${h(dimension)}</th><th>指标值</th><th>参与统计人数</th><th>数值对比</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">参与统计人数按各分组去重，同一学生可能出现在多个分组；不能将各组人数相加作为独立学生总人数。结论只比较本次返回的分组，不代表未返回的数据范围。</p>
<h2>实际查询与核对依据</h2><pre>${h(result.query)}</pre>
<footer class="note">由本次会话的真实分析结果生成。报告包含聚合统计，不含个人记录。可使用浏览器打印功能，并选择“另存为 PDF”。</footer>
</main></body></html>`;
}

export function analysisExportFilename(result: AnalysisResult, extension: "csv" | "html"): string {
  const name = `${result.datasetId}-${result.metricLabel}-${analysisDimensionLabel(result)}`;
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 90)}.${extension}`;
}

export function downloadAnalysisFile(result: AnalysisResult, format: "csv" | "html"): void {
  const content = format === "csv" ? analysisCsv(result) : analysisReportHtml(result);
  const blob = new Blob([content], {
    type: format === "csv" ? "text/csv;charset=utf-8" : "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = analysisExportFilename(result, format);
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
