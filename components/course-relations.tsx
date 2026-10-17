"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/app-icons";
import { CourseRelationChart } from "@/components/course-relation-chart";
import {
  relationKey,
  visibleRelations,
  type CourseRelationData,
} from "@/lib/analysis/course-relations";
import type { DataSource } from "@/lib/analysis/types";
import styles from "./course-relations.module.css";

const number = (value: number) => value.toLocaleString("zh-CN");

export function CourseRelations({
  datasetId,
  api,
}: {
  datasetId: DataSource;
  api: (url: string, options?: RequestInit) => Promise<CourseRelationData>;
}) {
  const [data, setData] = useState<CourseRelationData | null>(null);
  const [term, setTerm] = useState("");
  const [threshold, setThreshold] = useState(60);
  const [course, setCourse] = useState("");
  const [selection, setSelection] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ datasetId, threshold: String(threshold) });
    if (term) params.set("term", term);
    setLoading(true);
    setError("");
    api(`/api/course-relations?${params}`, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setData(payload);
          setSelection("");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "学科关联暂时无法读取。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [datasetId, term, threshold, refresh, api]);

  const current = data?.datasetId === datasetId ? data : null;
  const activeCourse = current?.courses.some((item) => item.name === course) ? course : "";
  const relations = useMemo(
    () => visibleRelations(current?.relations ?? [], activeCourse),
    [current, activeCourse],
  );
  const selected = relations.find((item) => relationKey(item) === selection) ?? relations[0];
  const connectedCourses = new Set(
    current?.relations.flatMap((item) => [item.source, item.target]),
  );
  const focusCourse = (name: string) => {
    setCourse((previous) => (previous === name ? "" : name));
    setSelection("");
  };

  const selectRelation = (key: string) => {
    setCourse("");
    setSelection((previous) => (previous === key ? "" : key));
  };

  return (
    <section
      className={`analysis-result ${styles.panel}`}
      aria-labelledby="course-relations-heading"
      aria-busy={loading}
    >
      <div className={styles.heading}>
        <div>
          <span className="section-kicker">LEARNING CONNECTIONS</span>
          <h2 id="course-relations-heading">哪些学科，需要一起关注</h2>
          <p>一条弦，连接两门学科共同的学习薄弱点。连带越宽，共同未达标的学生越多。</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新学科关联"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={17} />}
        </button>
      </div>
      <div className={styles.filters}>
        <label className="control-field">
          <span>学期</span>
          <select
            aria-label="学科关联学期"
            value={term || current?.term || ""}
            disabled={loading || !current?.terms.length}
            onChange={(event) => {
              setTerm(event.target.value);
              setCourse("");
            }}
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
            aria-label="学科关联未达标线"
            value={threshold}
            disabled={loading}
            onChange={(event) => setThreshold(Number(event.target.value))}
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
            ? "正在读取关联…"
            : current
              ? `${current.term ?? "暂无学期"} · ${current.courses.length} 门学科 · ${current.relations.length} 组可见关联`
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
            onClick={() => setRefresh((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      {current && (
        <>
          {(loading || error) && (
            <p className={styles.note}>
              图中仍为 {current.term}、低于 {current.threshold} 分的上次结果。
            </p>
          )}
          {current.totalCourses > current.courseLimit && (
            <p className={styles.note}>
              按有效成绩人数选取前 {current.courseLimit} 门学科，共 {current.totalCourses}{" "}
              门符合样本要求。
            </p>
          )}
          {current.relations.length > 0 ? (
            <>
              <div className={styles.layout}>
                <div className={styles.figure}>
                  <CourseRelationChart
                    data={current}
                    course={activeCourse}
                    selectedKey={selection || undefined}
                    onCourse={focusCourse}
                    onRelation={selectRelation}
                  />
                  <p className={styles.caption}>外圈为学科 · 连带为共同未达标人数 · 颜色区分学科</p>
                </div>
                <aside className={styles.sidebar} aria-label="学科关联详情">
                  <div className={styles.detail} aria-live="polite">
                    <span className="section-kicker">当前关联</span>
                    {selected ? (
                      <>
                        <h3>
                          {selected.source}
                          <span>↔</span>
                          {selected.target}
                        </h3>
                        <div className={styles.value}>
                          {number(selected.belowCount)}
                          <span>人共同未达标</span>
                        </div>
                        <p>
                          两科均有有效成绩 {number(selected.commonCount)} 人，其中{" "}
                          <strong>{selected.rate}%</strong> 两科都低于 {current.threshold} 分。
                        </p>
                      </>
                    ) : (
                      <p>该学科暂无满足展示条件的关联。</p>
                    )}
                  </div>
                  <div className={styles.rankingHeading}>
                    <h3>共同薄弱关联</h3>
                    <span>{relations.length} 组 · 按人数</span>
                  </div>
                  {relations.length ? (
                    <ol className={styles.ranking}>
                      {relations.map((item, index) => (
                        <li key={relationKey(item)}>
                          <button
                            type="button"
                            aria-pressed={selection === relationKey(item)}
                            onClick={() => selectRelation(relationKey(item))}
                          >
                            <span className={styles.rank}>
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.pair}>
                              {item.source}
                              <span>↔ {item.target}</span>
                            </span>
                            <span className={styles.count}>
                              {number(item.belowCount)}
                              <small>人 · {item.rate}%</small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={styles.note}>试试选择其他学科，或调整未达标线。</p>
                  )}
                </aside>
              </div>
              <div className={styles.coursePicker} role="group" aria-label="聚焦学科">
                <button
                  type="button"
                  aria-pressed={!activeCourse && !selection}
                  onClick={() => {
                    setCourse("");
                    setSelection("");
                  }}
                >
                  全部学科
                </button>
                {current.courses.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    aria-pressed={activeCourse === item.name}
                    onClick={() => focusCourse(item.name)}
                  >
                    {item.name}
                    {!connectedCourses.has(item.name) && <span> · 暂无关联</span>}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.empty} role="status">
              <Icon name="chart" size={28} />
              <h3>当前条件下，暂无可展示的共同薄弱关联</h3>
              <p>
                需要同一学期至少 {current.minSampleSize} 名学生在两门学科中都有成绩，且共同低于{" "}
                {current.threshold} 分。可调整学期或未达标线。
              </p>
            </div>
          )}
          <details className={styles.method}>
            <summary>怎么看这张图 · 统计口径</summary>
            <p>
              仅在同一学期内，按匿名学生匹配两门学科。先将学生在同一课程、同一学期的重复有效成绩取均值，再判断是否严格低于{" "}
              {current.threshold} 分；0 分和 100 分均有效，缺失和超出 0–100 的成绩不参与。
            </p>
            <p>
              比例 = 两科共同未达标人数 ÷
              两科均有有效成绩人数。每条关系均为去重人数，但同一学生可能出现在多条关系中；外环长度为可见关联人数之和，不是该科独立学生总数。
            </p>
            <p>
              共同未达标少于 {current.minSampleSize} 人的关系不展示，无连带不代表人数为
              0。图中呈现共同出现的情况，不表示学科间的因果关系。
              {datasetId === "oulad" &&
                "OULAD 使用课程学期内的有效考核均分；跨课程共同选课较少时可能没有可见关联。"}
            </p>
          </details>
        </>
      )}
      {!current && !error && (
        <div className={styles.empty} role="status">
          正在计算同一学期的学科关联…
        </div>
      )}
    </section>
  );
}
