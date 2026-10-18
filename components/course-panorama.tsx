"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "@/components/app-icons";
import { CoursePanoramaChart } from "@/components/course-panorama-chart";
import { relationKey } from "@/lib/analysis/course-relations";
import type { CoursePanoramaData } from "@/lib/analysis/course-panorama";
import type { DataSource } from "@/lib/analysis/types";
import styles from "./course-panorama.module.css";

const number = (value: number) => value.toLocaleString("zh-CN");
type Filters = { term: string; threshold: number; source: string; target: string };

export function CoursePanorama({
  datasetId,
  api,
}: {
  datasetId: DataSource;
  api: (url: string, options?: RequestInit) => Promise<CoursePanoramaData>;
}) {
  const [filters, setFilters] = useState<Filters>({
    term: "",
    threshold: 60,
    source: "",
    target: "",
  });
  const [data, setData] = useState<CoursePanoramaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ datasetId, threshold: String(filters.threshold) });
    if (filters.term) params.set("term", filters.term);
    if (filters.source && filters.target) {
      params.set("source", filters.source);
      params.set("target", filters.target);
    }
    setLoading(true);
    setError("");
    api(`/api/course-panorama?${params}`, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "学科全景暂时无法读取。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [datasetId, filters, refresh, api]);
  const current = data?.datasetId === datasetId ? data : null;
  const selection = current?.selection;
  const selectedKey = selection ? JSON.stringify([selection.source, selection.target]) : "";
  const selectRelation = (key: string) => {
    if (loading || !current) return;
    const relation = current.relations.find((item) => relationKey(item) === key);
    setFilters({
      term: current.term ?? "",
      threshold: current.threshold,
      source: relation?.source ?? "",
      target: relation?.target ?? "",
    });
  };
  const changeContext = (value: Partial<Filters>) =>
    setFilters((previous) => ({
      ...previous,
      term: previous.term || current?.term || "",
      source: "",
      target: "",
      ...value,
    }));
  const count = selection?.count ?? current?.totalStudents ?? 0;
  const denominator = selection?.commonCount ?? current?.totalStudents ?? 0;
  const ranked = current?.relations.slice(0, 6) ?? [];
  if (selection && !ranked.some((item) => relationKey(item) === selectedKey)) {
    const item = current?.relations.find((relation) => relationKey(relation) === selectedKey);
    if (item) ranked[ranked.length - 1] = item;
  }
  const largest = Math.max(1, ...(current?.relations.map((item) => item.belowCount) ?? []));

  return (
    <section
      className={`analysis-result ${styles.panel}`}
      aria-labelledby="course-panorama-heading"
      aria-busy={loading}
    >
      <div className={styles.heading} data-enter="rise-sm">
        <div>
          <span className="section-kicker">COURSE PANORAMA</span>
          <h2 id="course-panorama-heading">学科关联全景</h2>
          <p>沿着学科，看见关联、分布与同一群学生。</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新学科全景"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={17} />}
        </button>
      </div>
      <div
        className={styles.filters}
        data-enter-group="fade"
        style={{ "--enter-group-delay": "80ms" } as CSSProperties}
      >
        <label className="control-field">
          <span>学期</span>
          <select
            aria-label="学科全景学期"
            value={filters.term || current?.term || ""}
            disabled={loading || !current?.terms.length}
            onChange={(event) => changeContext({ term: event.target.value })}
          >
            {!current?.terms.length && <option value="">暂无学期</option>}
            {current?.terms.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="control-field">
          <span>未达标线</span>
          <select
            aria-label="学科全景未达标线"
            value={filters.threshold}
            disabled={loading}
            onChange={(event) => changeContext({ threshold: Number(event.target.value) })}
          >
            {[50, 60, 70, 80].map((value) => (
              <option key={value} value={value}>
                低于 {value} 分
              </option>
            ))}
          </select>
        </label>
        <p className={styles.context} role="status">
          {loading
            ? "正在更新联动分析…"
            : current
              ? `${current.term ?? "暂无学期"} · ${current.courses.length} 门学科 · ${current.relations.length} 组关联`
              : ""}
        </p>
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          {current && " 当前保留上次成功的结果。"}
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      {current && (loading || error) && (
        <p className={styles.note}>
          图中仍为 {current.term}、低于 {current.threshold} 分的结果，当前人群以图上标注为准。
        </p>
      )}
      {!current && loading && (
        <div className={styles.empty} role="status">
          正在读取学科成绩与关联…
        </div>
      )}
      {current &&
        (current.columns.length ? (
          <>
            {current.totalCourses > current.courseLimit && (
              <p className={styles.note}>
                按有效成绩人数展示前 {current.courseLimit} 门学科，共 {current.totalCourses}{" "}
                门满足样本要求。
              </p>
            )}
            <div
              className={styles.cohortStrip}
              data-enter="fade"
              style={{ "--enter-delay": "140ms" } as CSSProperties}
            >
              <div className={styles.cohort} aria-live="polite">
                <span className={styles.muted}>当前人群</span>
                <span className={styles.cohortName}>
                  {selection
                    ? `${selection.source} × ${selection.target} · 共同未达标`
                    : "全体学生"}
                </span>
                <span>
                  {number(count)} / {number(denominator)} 人
                  {selection ? "（两科均有成绩）" : "（去重）"}
                </span>
              </div>
              {selection && (
                <button
                  type="button"
                  className="text-button"
                  disabled={loading}
                  onClick={() => selectRelation("")}
                >
                  查看全体
                </button>
              )}
            </div>
            <div className={styles.layout}>
              <CoursePanoramaChart data={current} disabled={loading} onSelect={selectRelation} />
              <aside className={styles.sidebar} aria-label="全景关联选择与详情">
                <label
                  className={`control-field ${styles.relationSelect}`}
                  data-enter="fade"
                  style={{ "--enter-delay": "120ms" } as CSSProperties}
                >
                  <span>关联路径</span>
                  <select
                    aria-label="全景关联路径"
                    value={selectedKey}
                    disabled={loading || !current.relations.length}
                    onChange={(event) => selectRelation(event.target.value)}
                  >
                    <option value="">全体学生</option>
                    {current.relations.map((item) => (
                      <option key={relationKey(item)} value={relationKey(item)}>
                        {item.source} × {item.target} · {number(item.belowCount)} 人
                      </option>
                    ))}
                  </select>
                </label>
                <p
                  className={styles.sidebarNote}
                  data-enter="fade"
                  style={{ "--enter-delay": "160ms" } as CSSProperties}
                >
                  两科学生成绩均低于分数线
                </p>
                <div
                  className={styles.pathList}
                  data-enter-group="rise"
                  style={{ "--enter-group-delay": "200ms" } as CSSProperties}
                >
                  {ranked.map((item, index) => {
                    const key = relationKey(item);
                    return (
                      <button
                        type="button"
                        key={key}
                        disabled={loading}
                        className={styles.path}
                        aria-pressed={key === selectedKey}
                        aria-label={`${item.source} × ${item.target}，${number(item.belowCount)}人共同未达标`}
                        onClick={() => selectRelation(key === selectedKey ? "" : key)}
                      >
                        <span className={styles.pathRow}>
                          <span>
                            {item.source} × {item.target}
                          </span>
                          <strong>{number(item.belowCount)} 人</strong>
                        </span>
                        <span className={styles.pathTrack}>
                          <span
                            data-grow
                            style={
                              {
                                "--fill": item.belowCount / largest,
                                "--enter-delay": `${200 + index * 60}ms`,
                              } as CSSProperties
                            }
                          />
                        </span>
                      </button>
                    );
                  })}
                  {!ranked.length && (
                    <p className={styles.note}>
                      暂无达到 {current.minSampleSize} 人的共同未达标关联，可调整分数线或学期。
                    </p>
                  )}
                </div>
                <div
                  className={styles.detail}
                  aria-live="polite"
                  data-enter="panel"
                  style={{ "--enter-delay": "260ms" } as CSSProperties}
                >
                  <span className={styles.detailName}>
                    {selection ? `${selection.source} × ${selection.target}` : "全体学生"}
                  </span>
                  <div
                    className={styles.detailNumber}
                    data-enter="scale"
                    style={{ "--enter-delay": "340ms" } as CSSProperties}
                  >
                    {number(count)}
                    <span>人</span>
                  </div>
                  <p>
                    {selection ? (
                      <>
                        共同低于 {current.threshold} 分<br />
                        占两科均有成绩人数的{" "}
                        {((selection.count / selection.commonCount) * 100).toFixed(1)}%<br />
                      </>
                    ) : (
                      <>
                        所展示学科的去重学生
                        <br />
                      </>
                    )}
                    各科有效人数见图下方
                  </p>
                </div>
              </aside>
            </div>
            <details
              className={styles.numericDetails}
              data-enter="fade"
              style={{ "--enter-delay": "300ms" } as CSSProperties}
            >
              <summary>查看各科统计数值</summary>
              <div className={styles.tableViewport}>
                <table>
                  <caption>
                    {current.term} · {selection ? "当前关联人群" : "全体学生"}学科统计
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">学科</th>
                      <th scope="col">有效人数</th>
                      <th scope="col">均分</th>
                      {selection && <th scope="col">全体均分</th>}
                      <th scope="col">及格率（≥60分）</th>
                      {selection && <th scope="col">全体及格率</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {current.columns.map((column) => (
                      <tr key={column.course}>
                        <th scope="row">{column.course}</th>
                        <td>{column.cohort ? number(column.cohort.count) : "样本不足"}</td>
                        <td>{column.cohort ? column.cohort.mean.toFixed(2) : "—"}</td>
                        {selection && <td>{column.baseline.mean.toFixed(2)}</td>}
                        <td>{column.cohort ? `${column.cohort.passRate.toFixed(2)}%` : "—"}</td>
                        {selection && <td>{column.baseline.passRate.toFixed(2)}%</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <div
              className={styles.notes}
              data-enter="fade"
              style={{ "--enter-delay": "360ms" } as CSSProperties}
            >
              <p>
                每列按该科有效成绩计算；同一学生、同一课程、同一学期的重复成绩先取均值。分数区间左闭右开，最后一格包含
                100 分。
              </p>
              <p>
                有效样本不足 {current.minSampleSize}{" "}
                人的学科或关联不展示具体统计。每条关联独立计数，同一学生可出现在多条关系中；统计关联不代表因果。
              </p>
              <p>
                {datasetId === "demo"
                  ? "校园演示数据为虚构样本。"
                  : "OULAD 成绩采用同一课程开课期内的有效考核均分。"}
              </p>
            </div>
          </>
        ) : (
          <div className={styles.empty} role="status">
            当前学期暂无满足样本要求的成绩，请切换学期或数据源。
          </div>
        ))}
    </section>
  );
}
