"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Icon } from "@/components/app-icons";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  distributionRows,
  scoreInterval,
  type ScoreBinWidth,
  type ScoreDistributionData,
} from "@/lib/analysis/score-distribution";
import type { DataSource } from "@/lib/analysis/types";
import styles from "./score-distribution.module.css";

type Cell = { course: string; bin: number };
const number = (value: number) => value.toLocaleString("zh-CN");

export function ScoreDistribution({
  datasetId,
  api,
}: {
  datasetId: DataSource;
  api: (url: string, options?: RequestInit) => Promise<ScoreDistributionData>;
}) {
  const [data, setData] = useState<ScoreDistributionData | null>(null);
  const [dataEpoch, setDataEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [term, setTerm] = useState<string | null>(null);
  const [course, setCourse] = useState("");
  const [width, setWidth] = useState<ScoreBinWidth>(2);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [hovered, setHovered] = useState<Cell | null>(null);
  const chart = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api(`/api/score-distribution?datasetId=${datasetId}`, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setData(payload);
          // A fresh payload is the moment data lands: bump the epoch so the heatmap
          // rows remount and replay their staged entrance instead of mutating in place.
          setDataEpoch((value) => value + 1);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "成绩分布暂时无法读取。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [datasetId, api, refresh]);

  const groups = data?.datasetId === datasetId ? data.groups : [];
  const terms = [...new Set(groups.map((group) => group.term))].sort().reverse();
  const activeTerm = term ?? terms[0] ?? "";
  const courses = [
    ...new Set(
      groups
        .filter((group) => !activeTerm || group.term === activeTerm)
        .map((group) => group.course),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const rows = useMemo(
    () => distributionRows(groups, activeTerm, course, width),
    [groups, activeTerm, course, width],
  );
  const max = Math.max(0, ...rows.flatMap((row) => row.bins));
  const levels = Math.min(6, max);
  const unit = activeTerm ? "人" : "人次";
  const countLabel = activeTerm ? "人数" : "人次";
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const focusCell =
    selected && rows.some((row) => row.course === selected.course) && selected.bin < 100 / width
      ? selected
      : rows.length
        ? { course: rows[0].course, bin: 0 }
        : null;
  const active = hovered ?? selected;
  const activeRow = rows.find((row) => row.course === active?.course);
  const activeCount = activeRow && active ? activeRow.bins[active.bin] : undefined;
  const hasDetail = activeRow && active && activeCount !== undefined;
  const shade = (count: number) => (count === 0 ? 0 : Math.ceil((count / max) * levels));

  function resetCell() {
    setSelected(null);
    setHovered(null);
  }
  function moveCell(event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, bin: number) {
    let nextRow = rowIndex;
    let nextBin = bin;
    if (event.key === "ArrowRight") nextBin++;
    else if (event.key === "ArrowLeft") nextBin--;
    else if (event.key === "ArrowDown") nextRow++;
    else if (event.key === "ArrowUp") nextRow--;
    else if (event.key === "Home") nextBin = 0;
    else if (event.key === "End") nextBin = 100 / width - 1;
    else if (event.key === "Escape") {
      resetCell();
      return;
    } else return;
    event.preventDefault();
    nextRow = Math.max(0, Math.min(rows.length - 1, nextRow));
    nextBin = Math.max(0, Math.min(100 / width - 1, nextBin));
    chart.current
      ?.querySelector<HTMLButtonElement>(`[data-row="${nextRow}"][data-bin="${nextBin}"]`)
      ?.focus();
  }

  return (
    <section
      className={`analysis-result ${styles.panel}`}
      aria-labelledby="score-distribution-heading"
      aria-busy={loading}
    >
      <div
        className={styles.heading}
        data-enter="rise"
        style={{ "--enter-delay": "40ms" } as CSSProperties}
      >
        <div>
          <span className="section-kicker">SCORE DISTRIBUTION</span>
          <h2 id="score-distribution-heading">每一门学科，成绩落在哪里</h2>
          <p>从左到右，分数逐渐升高；同一分数段，颜色越深，{countLabel}越多。</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新成绩分布"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={17} />}
        </button>
      </div>

      <div
        className={styles.filters}
        data-enter-group="rise"
        style={{ "--enter-group-delay": "140ms" } as CSSProperties}
      >
        <label className="control-field">
          <span>学期</span>
          <select
            aria-label="成绩分布学期"
            value={activeTerm}
            disabled={!groups.length}
            onChange={(event) => {
              setTerm(event.target.value);
              setCourse("");
              resetCell();
            }}
          >
            <option value="">全部学期</option>
            {terms.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="control-field">
          <span>学科</span>
          <select
            aria-label="成绩分布学科"
            value={course}
            disabled={!groups.length}
            onChange={(event) => {
              setCourse(event.target.value);
              resetCell();
            }}
          >
            <option value="">全部学科</option>
            {courses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="control-field">
          <span>分数段宽度</span>
          <SegmentedControl
            label="分数段宽度"
            value={String(width)}
            onChange={(value) => {
              setWidth(Number(value) as ScoreBinWidth);
              resetCell();
            }}
            options={[
              { value: "2", label: "2 分" },
              { value: "5", label: "5 分" },
              { value: "10", label: "10 分" },
            ]}
          />
        </div>
      </div>

      {error && (
        <div
          className="notice notice-error"
          role="alert"
          data-enter="rise-sm"
          style={{ "--enter-delay": "80ms" } as CSSProperties}
        >
          {error} {data && "仍显示上次成功的数据。"}
          <button
            type="button"
            className="text-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      {rows.length ? (
        <>
          <div
            className={styles.chartMeta}
            data-enter="fade"
            style={{ "--enter-delay": "40ms" } as CSSProperties}
          >
            <p>
              <strong>
                <AnimatedNumber value={rows.length} decimals={0} />
              </strong>{" "}
              门学科 <span>·</span>{" "}
              <strong>
                <AnimatedNumber value={total} decimals={0} />
              </strong>{" "}
              条成绩记录
            </p>
            <div
              className={styles.legend}
              aria-label={`人数色阶，所有学科共用刻度，最多每格 ${max} ${unit}`}
            >
              <span>每格{countLabel}</span>
              <i data-level="0" title={`0 ${unit}`} />
              <span>0</span>
              {Array.from({ length: levels }, (_, index) => (
                <i
                  key={index}
                  data-level={Math.ceil(((index + 1) / levels) * 6)}
                  title={`${Math.floor((index * max) / levels) + 1}–${Math.floor(((index + 1) * max) / levels)} ${unit}`}
                />
              ))}
              <span>{number(max)}</span>
            </div>
          </div>
          <p className="sr-only" id="distribution-keyboard-help">
            色块表示选课{countLabel}。聚焦色块后，用左右方向键切换分数段，上下方向键切换学科，Home
            和 End 跳到首尾分数段。
          </p>
          <p
            className={styles.scrollHint}
            data-enter="fade"
            style={{ "--enter-delay": "80ms" } as CSSProperties}
          >
            左右滑动查看全部分数段，学科名称固定在左侧。
          </p>
          <div className={styles.scroll} ref={chart}>
            <table className={styles.chart} aria-describedby="distribution-keyboard-help">
              <caption className="sr-only">
                {activeTerm || "全部学期"}各学科成绩分布，每 {width} 分一格
              </caption>
              <thead data-enter="fade" style={{ "--enter-delay": "80ms" } as CSSProperties}>
                <tr>
                  <th scope="col" className={styles.subject}>
                    学科
                  </th>
                  <th scope="col" className={styles.axisCell}>
                    <div className={styles.axisTitle}>
                      成绩 / 分 <span>60 分参考线</span>
                    </div>
                    <div className={styles.axis}>
                      {Array.from({ length: 11 }, (_, index) => (
                        <span key={index} style={{ left: `${index * 10}%` }}>
                          {index * 10}
                        </span>
                      ))}
                    </div>
                  </th>
                  <th scope="col" className={styles.total}>
                    {countLabel}
                  </th>
                </tr>
              </thead>
              <tbody
                key={`${dataEpoch}|${activeTerm}|${course}|${width}`}
                data-enter-group="fade"
                style={{ "--enter-group-delay": "140ms" } as CSSProperties}
                onMouseLeave={() => setHovered(null)}
              >
                {rows.map((row, rowIndex) => (
                  <tr key={row.course} data-active={active?.course === row.course || undefined}>
                    <th scope="row" className={styles.subject}>
                      <span title={row.course}>{row.course}</span>
                    </th>
                    <td className={styles.stripCell}>
                      <div
                        className={styles.strip}
                        data-enter="wipe"
                        style={
                          {
                            "--bin-count": 100 / width,
                            "--enter-delay": `${140 + Math.min(rowIndex, 7) * 60}ms`,
                            "--enter-dur": "480ms",
                          } as CSSProperties
                        }
                      >
                        {row.bins.map((count, bin) => (
                          <button
                            type="button"
                            key={bin}
                            data-row={rowIndex}
                            data-bin={bin}
                            data-level={count ? Math.ceil((shade(count) / levels) * 6) : 0}
                            data-selected={
                              (selected?.course === row.course && selected.bin === bin) || undefined
                            }
                            className={styles.cell}
                            tabIndex={
                              focusCell?.course === row.course && focusCell.bin === bin ? 0 : -1
                            }
                            aria-label={`${row.course}，${scoreInterval(bin, width)}，${count} ${unit}，占 ${((count / row.count) * 100).toFixed(1)}%`}
                            onMouseEnter={() => setHovered({ course: row.course, bin })}
                            onFocus={() => {
                              setSelected({ course: row.course, bin });
                              setHovered(null);
                            }}
                            onClick={() => {
                              setSelected({ course: row.course, bin });
                              setHovered(null);
                            }}
                            onKeyDown={(event) => moveCell(event, rowIndex, bin)}
                          >
                            <span />
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className={styles.total}>{number(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className={styles.detail}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-enter="rise-sm"
            style={{ "--enter-delay": "620ms" } as CSSProperties}
          >
            {hasDetail ? (
              <>
                <strong>{activeRow.course}</strong>
                <span>{scoreInterval(active.bin, width)}</span>
                <strong className={styles.detailCount}>
                  {number(activeCount)} <small>{unit}</small>
                </strong>
                <span>占该学科 {((activeCount / activeRow.count) * 100).toFixed(1)}%</span>
              </>
            ) : (
              <>
                <Icon name="info" size={17} />
                <span>悬停或点选色块，查看这个分数段的{countLabel}与占比。</span>
              </>
            )}
          </div>
          <p
            className={styles.note}
            data-enter="fade"
            style={{ "--enter-delay": "700ms" } as CSSProperties}
          >
            各学科使用相同色阶，空白表示 0 {unit}。
            {activeTerm
              ? "同一学生在同一学科、学期只计一次。"
              : "跨学期分别计次，同一学生可能出现多次。"}
            仅展示至少 {data?.minSampleSize ?? 3} 人的学科与学期分组；
            {datasetId === "oulad"
              ? "成绩为该学生在该课程、学期的有效考核均分。"
              : datasetId.startsWith("grades_")
                ? "成绩来自管理员发布的导入版本，每个学生-课程-学期只保留唯一记录。"
                : "重复成绩记录先按学生、学科、学期取均分。"}
            无效或缺失成绩不计入。
          </p>
        </>
      ) : (
        <div
          className={styles.empty}
          role="status"
          data-enter="rise"
          style={{ "--enter-delay": "120ms" } as CSSProperties}
        >
          <Icon name="chart" size={30} />
          <h3>{loading ? "正在读取各学科成绩…" : "暂无可展示的成绩分布"}</h3>
          <p>
            {loading
              ? "将成绩按分数段汇总。"
              : "当前范围没有达到 3 人样本要求的有效成绩，请调整筛选。"}
          </p>
        </div>
      )}
    </section>
  );
}
