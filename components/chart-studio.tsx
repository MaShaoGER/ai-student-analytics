"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import { Icon } from "@/components/app-icons";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StudioChart } from "@/components/studio-chart";
import {
  defaultStudioFields,
  parseStudioInput,
  studioCsv,
  STUDIO_CHARTS,
  STUDIO_FIELD_ROLES,
  type StudioChartType,
  type StudioFields,
  type StudioProjectData,
} from "@/lib/analysis/chart-studio";
import type { DataSource } from "@/lib/analysis/types";
import styles from "./chart-studio.module.css";

export function ChartStudio({
  datasetId,
  api,
}: {
  datasetId: DataSource;
  api: (url: string, options?: RequestInit) => Promise<StudioProjectData>;
}) {
  const [type, setType] = useState<StudioChartType>("sankey");
  const [source, setSource] = useState<"project" | "custom">("project");
  const [project, setProject] = useState<StudioProjectData | null>(null);
  const [term, setTerm] = useState("");
  const [course, setCourse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [input, setInput] = useState("");
  const [debouncedInput, setDebouncedInput] = useState("");
  const [fileError, setFileError] = useState("");
  const [fieldOverrides, setFieldOverrides] = useState<StudioFields>({});
  const [densityMode, setDensityMode] = useState<"density" | "scatter">("density");
  const [aggregate, setAggregate] = useState<"mean" | "sum">("mean");

  useEffect(() => {
    if (source !== "project") return;
    const controller = new AbortController();
    const params = new URLSearchParams({ datasetId });
    if (term) params.set("term", term);
    if (course) params.set("course", course);
    setLoading(true);
    setError("");
    api(`/api/chart-studio?${params}`, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setProject(payload);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "项目数据暂时无法读取，可直接输入自己的数据。",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source, datasetId, term, course, refresh, api]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInput(input), 350);
    return () => clearTimeout(timer);
  }, [input]);
  const custom = useMemo(() => {
    if (!debouncedInput.trim()) return { table: null, error: "" };
    try {
      return { table: parseStudioInput(debouncedInput), error: "" };
    } catch (reason) {
      return { table: null, error: reason instanceof Error ? reason.message : "无法读取数据。" };
    }
  }, [debouncedInput]);
  const currentProject = project?.datasetId === datasetId ? project : null;
  const table = source === "project" ? (currentProject?.tables[type] ?? null) : custom.table;
  const fields = useMemo(() => {
    if (!table) return {};
    const defaults = defaultStudioFields(type, table);
    return Object.fromEntries(
      Object.entries(defaults).map(([role, fallback]) => {
        const value = fieldOverrides[role];
        return [
          role,
          value !== undefined && (value === "" || table.columns.includes(value)) ? value : fallback,
        ];
      }),
    );
  }, [table, type, fieldOverrides]);
  const chartInfo = STUDIO_CHARTS.find((item) => item.value === type)!;
  const summaryBox = type === "boxplot" && table?.columns.includes("下四分位数");

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileError("");
    if (file.size > 1_000_000) {
      setFileError("请选择 1 MB 以内的 CSV、TSV 或 JSON 文件。");
      event.target.value = "";
      return;
    }
    try {
      const text = await file.text();
      setInput(text);
      setSource("custom");
      setFieldOverrides({});
    } catch {
      setFileError("文件读取失败，请重新选择文件或直接粘贴数据。");
    }
    event.target.value = "";
  }

  return (
    <section className={`analysis-result ${styles.studio}`} aria-labelledby="chart-studio-heading">
      <div
        className={styles.heading}
        data-enter="rise"
        style={{ "--enter-delay": "40ms" } as CSSProperties}
      >
        <div>
          <span className="section-kicker">CHART STUDIO</span>
          <h2 id="chart-studio-heading">把数据，变成可以探索的图</h2>
          <p>选一种表现形式，接入数据，图表就会自动生成。</p>
        </div>
        <span className={styles.auto}>
          <span />
          自动绘图
        </span>
      </div>
      <div
        className={styles.types}
        role="group"
        aria-label="图表工坊图表类型"
        data-enter-group="rise"
        style={{ "--enter-group-delay": "120ms" } as CSSProperties}
      >
        {STUDIO_CHARTS.map((item, i) => (
          <button
            type="button"
            key={item.value}
            aria-pressed={type === item.value}
            onClick={() => {
              setType(item.value);
              setFieldOverrides({});
            }}
          >
            <span className={styles.typeNumber}>0{i + 1}</span>
            <strong>{item.label}</strong>
            <span className={styles.typeDescription}>{item.description}</span>
          </button>
        ))}
      </div>
      <div
        className={styles.sourceBar}
        data-enter-group="fade"
        style={{ "--enter-group-delay": "240ms" } as CSSProperties}
      >
        <div className="control-field">
          <span>数据来源</span>
          <SegmentedControl
            label="工坊数据来源"
            value={source}
            onChange={(value) => {
              setSource(value);
              setFieldOverrides({});
            }}
            options={[
              { value: "project", label: "项目数据" },
              { value: "custom", label: "自定义数据" },
            ]}
          />
        </div>
        {source === "project" && (
          <>
            <label className="control-field">
              <span>学期</span>
              <select
                aria-label="工坊学期"
                disabled={loading || !currentProject?.terms.length}
                value={term || currentProject?.term || ""}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setCourse("");
                }}
              >
                {!currentProject?.terms.length && <option value="">正在读取</option>}
                {currentProject?.terms.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-field">
              <span>学科</span>
              <select
                aria-label="工坊学科"
                disabled={loading || !currentProject?.courses.length}
                value={course}
                onChange={(event) => setCourse(event.target.value)}
              >
                <option value="">全部学科</option>
                {currentProject?.courses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label="刷新工坊数据"
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              {loading ? <span className="spinner" /> : <Icon name="refresh" size={16} />}
            </button>
          </>
        )}
        <label className={`secondary-button ${styles.fileButton}`}>
          <Icon name="database" size={16} />
          导入 CSV / JSON
          <input
            type="file"
            accept=".csv,.tsv,.txt,.json,text/csv,application/json"
            aria-label="导入图表数据文件"
            onChange={readFile}
          />
        </label>
        {source === "project" && table?.rows.length ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setInput(studioCsv(table));
              setSource("custom");
              setFieldOverrides({});
            }}
          >
            编辑这份数据
          </button>
        ) : null}
      </div>
      {source === "project" && error && (
        <div
          className="notice notice-error"
          role="alert"
          data-enter="rise-sm"
          style={{ "--enter-delay": "60ms" } as CSSProperties}
        >
          {error}
          <button
            type="button"
            className="text-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      {fileError && (
        <p
          className="notice notice-error"
          role="alert"
          data-enter="rise-sm"
          style={{ "--enter-delay": "60ms" } as CSSProperties}
        >
          {fileError}
        </p>
      )}
      <div className={styles.workspace} data-editor={source === "custom"}>
        {source === "custom" && (
          <aside
            className={styles.editor}
            aria-label="图表数据输入"
            data-enter="slide-left"
            style={{ "--enter-delay": "80ms" } as CSSProperties}
          >
            <div className={styles.editorHeading}>
              <h3>输入数据</h3>
              <span>
                {input !== debouncedInput ? (
                  "正在更新…"
                ) : table ? (
                  <>
                    <AnimatedNumber value={table.rows.length} /> 行 ·{" "}
                    <AnimatedNumber value={table.columns.length} /> 列
                  </>
                ) : (
                  "CSV / TSV / JSON"
                )}
              </span>
            </div>
            <label className="sr-only" htmlFor="studio-data-input">
              粘贴图表数据
            </label>
            <textarea
              id="studio-data-input"
              aria-label="粘贴图表数据"
              spellCheck={false}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setFileError("");
              }}
              placeholder={
                "粘贴 CSV、从表格复制的内容，或 JSON 对象数组。\n\n第一行写字段名，后续每行是一条数据。"
              }
            />
            <p>输入完成后自动更新。文件和粘贴内容仅在当前浏览器中处理，最多 1 MB、20,000 行。</p>
            {custom.error && (
              <p className={styles.inputError} role="status">
                {custom.error}
              </p>
            )}
            {type === "boxplot" && (
              <p>箱线图可输入“分组、数值”两列原始数据，也可使用项目数据提供的五数概要。</p>
            )}
            {currentProject?.tables[type] && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setInput(studioCsv(currentProject.tables[type]!));
                  setFieldOverrides({});
                }}
              >
                填入当前项目的这类图表数据
              </button>
            )}
          </aside>
        )}
        <div
          className={styles.visual}
          data-enter="panel"
          style={{ "--enter-delay": "320ms" } as CSSProperties}
        >
          <div className={styles.visualHeading}>
            <div>
              <h3>{chartInfo.label}</h3>
              <p>
                {source === "project" && loading
                  ? "正在读取项目数据，保留上次结果…"
                  : (table?.description ?? chartInfo.description)}
              </p>
            </div>
          </div>
          {table && (
            <>
              <div
                className={styles.mapping}
                key={`${type}:${source}`}
                data-enter-group="rise"
                style={{ "--enter-group-delay": "80ms" } as CSSProperties}
              >
                {STUDIO_FIELD_ROLES[type]
                  .filter((role) => !(summaryBox && role.key === "value"))
                  .map((role) => (
                    <label className="control-field" key={role.key}>
                      <span>{role.label}</span>
                      <select
                        aria-label={`图表字段：${role.label}`}
                        value={fields[role.key] ?? ""}
                        onChange={(event) =>
                          setFieldOverrides((previous) => ({
                            ...previous,
                            [role.key]: event.target.value,
                          }))
                        }
                      >
                        {role.optional && (
                          <option value="">{role.key === "weight" ? "每行计 1" : "不使用"}</option>
                        )}
                        {table.columns.map((column) => (
                          <option value={column} key={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                {type === "density" && (
                  <div className="control-field">
                    <span>呈现方式</span>
                    <SegmentedControl
                      label="密度图呈现方式"
                      value={densityMode}
                      onChange={setDensityMode}
                      options={[
                        { value: "density", label: "密度" },
                        { value: "scatter", label: "散点" },
                      ]}
                    />
                  </div>
                )}
                {type === "heatmap" && (
                  <label className="control-field">
                    <span>重复坐标</span>
                    <select
                      aria-label="热力图重复坐标统计"
                      value={aggregate}
                      onChange={(event) => setAggregate(event.target.value as "mean" | "sum")}
                    >
                      <option value="mean">取均值</option>
                      <option value="sum">累加</option>
                    </select>
                  </label>
                )}
              </div>
              {summaryBox && (
                <p
                  className={styles.hint}
                  data-enter="fade"
                  style={{ "--enter-delay": "160ms" } as CSSProperties}
                >
                  已识别五数概要，自动使用最小值、下四分位数、中位数、上四分位数、最大值。
                </p>
              )}
              <StudioChart
                type={type}
                table={table}
                fields={fields}
                densityMode={densityMode}
                aggregate={aggregate}
              />
              <details
                className={styles.preview}
                data-enter="rise-sm"
                style={{ "--enter-delay": "360ms" } as CSSProperties}
              >
                <summary>
                  查看输入数据 · <AnimatedNumber value={table.rows.length} /> 行
                </summary>
                <div>
                  <table>
                    <thead>
                      <tr>
                        {table.columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody data-enter-group="fade">
                      {table.rows.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          {table.columns.map((column) => (
                            <td key={column}>{row[column] ?? "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>预览前 10 行，图表使用全部有效输入。</p>
              </details>
            </>
          )}
          {!table && (
            <div
              className={styles.empty}
              role="status"
              data-enter="rise"
              style={{ "--enter-delay": "200ms" } as CSSProperties}
            >
              <Icon name="chart" size={30} />
              <h3>
                {loading && source === "project"
                  ? "正在准备图表数据…"
                  : source === "custom"
                    ? "输入数据，就能看到图表"
                    : "当前数据源暂不提供这类图表数据"}
              </h3>
              <p>
                {source === "custom"
                  ? "粘贴或导入数据后，可选择字段并自动生成交互图表。"
                  : "可以切换自定义数据，输入这类图表需要的字段。"}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
