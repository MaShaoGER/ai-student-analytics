"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/app-icons";
import { useTheme } from "@/components/ui/theme-provider";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
import styles from "./direction.module.css";

/** Direction A, route 1: one flat world lit by a soft light field. Frosted
    glass only on the frame, refracting the content that scrolls beneath it;
    solid reading surface, ruler motif.
    Illustrative numbers only — no account, dataset, or model calls. */

type MetricKey = "score" | "activity" | "completion";
const metrics: Record<MetricKey, { label: string; unit: string; max: number; digits: number }> = {
  score: { label: "平均成绩", unit: "分", max: 100, digits: 1 },
  activity: { label: "活跃次数", unit: "千次", max: 400, digits: 0 },
  completion: { label: "完成率", unit: "%", max: 100, digits: 1 },
};
const courses: { name: string; score: number; activity: number; completion: number }[] = [
  { name: "体育与健康", score: 75.2, activity: 212, completion: 86.4 },
  { name: "大学语文", score: 72.9, activity: 248, completion: 84.1 },
  { name: "数据可视化", score: 70.4, activity: 331, completion: 87.7 },
  { name: "大学英语", score: 70.1, activity: 362, completion: 82.6 },
  { name: "项目实践", score: 69.8, activity: 298, completion: 86.3 },
  { name: "Web前端开发", score: 67.5, activity: 317, completion: 81.0 },
  { name: "软件工程", score: 67.1, activity: 274, completion: 79.8 },
  { name: "程序设计基础", score: 66.8, activity: 355, completion: 77.5 },
  { name: "数据库原理", score: 64.2, activity: 289, completion: 76.9 },
  { name: "计算机网络", score: 63.6, activity: 265, completion: 75.2 },
  { name: "操作系统", score: 62.9, activity: 251, completion: 73.8 },
  { name: "高等数学", score: 61.4, activity: 341, completion: 71.6 },
];
const navigation = ["学习全景", "指标分析", "数据档案", "分析报告"];
const questions = [
  { text: "比较各课程平均成绩", note: "柱状对比 · 18 门课程" },
  { text: "各学期平均成绩如何变化", note: "趋势 · 4 个学期" },
  { text: "缺勤次数和成绩有关系吗", note: "关联 · 群体层面" },
];

function format(value: number, digits: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** The brand signal: a short ruler. Major ticks every fifth mark. */
function Ruler({ count = 41, marker }: { count?: number; marker?: number }) {
  return (
    <span className={styles.ruler} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <i key={index} data-major={index % 5 === 0 || undefined} />
      ))}
      {marker !== undefined && <b style={{ left: `${marker}%` }} />}
    </span>
  );
}

function BrandMark() {
  return (
    <svg className={styles.brandMark} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 20h18" />
      <path d="M5 20v-6M9 20v-10M13 20v-14M17 20v-8" />
      <circle cx="13" cy="4" r="1.6" />
    </svg>
  );
}

export default function DirectionAPreview() {
  const [mode, setMode] = useState<"data" | "ai">("data");
  const [section, setSection] = useState(0);
  const [metric, setMetric] = useState<MetricKey>("score");
  const [selected, setSelected] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState("");
  const [scan, setScan] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const { theme, setTheme } = useTheme();
  const { enabled, reduced } = useMotionPreferences();

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && menu.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const config = metrics[metric];
  const sorted = [...courses].sort((a, b) => b[metric] - a[metric]);
  const mean = sorted.reduce((sum, course) => sum + course[metric], 0) / sorted.length;
  const top = sorted[0];
  const focus = selected ?? top.name;

  function chooseMetric(next: MetricKey) {
    setMetric(next);
    setScan((value) => value + 1);
  }
  function ask(event: FormEvent) {
    event.preventDefault();
    if (draft.trim()) setAsked(draft.trim());
  }

  return (
    <div
      className={styles.stage}
      data-view="overview"
      data-drift={enabled && !reduced && !paused ? "on" : "off"}
    >
      <span className={styles.field} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>

      <header className={styles.topbar}>
        <a className={styles.brand} href="/">
          <BrandMark />
          <span>学析台</span>
        </a>
        <div className={styles.modes} role="tablist" aria-label="工作模式">
          {(
            [
              ["ai", "AI 对话", "sparkles"],
              ["data", "数据浏览", "dashboard"],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
            >
              <Icon name={icon} size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className={styles.topTools}>
          <button type="button" className={styles.source}>
            <i aria-hidden="true" />
            模拟校园数据
            <Icon name="chevron" size={14} />
          </button>
          <div className={styles.account} ref={menu}>
            <button
              type="button"
              className={styles.avatar}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="账户与偏好"
              onClick={() => setMenuOpen((value) => !value)}
            >
              系
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <div className={styles.menuHead}>
                  <strong>系统管理员</strong>
                  <span>admin · 全部数据权限</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                >
                  <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
                  {theme === "light" ? "深色外观" : "浅色外观"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={reduced || !enabled}
                  onClick={() => setPaused((value) => !value)}
                >
                  <Icon name="activity" size={16} />
                  {reduced || !enabled ? "光场已静止" : paused ? "光场漂移" : "停止光场漂移"}
                </button>
                <button type="button" role="menuitem">
                  <Icon name="settings" size={16} />
                  设置与管理
                </button>
                <hr />
                <button type="button" role="menuitem">
                  <Icon name="logout" size={16} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <aside className={styles.sidebar} aria-label="导航">
        {mode === "data" ? (
          <nav className={styles.nav}>
            {navigation.map((label, index) => (
              <button
                key={label}
                type="button"
                aria-current={section === index ? "page" : undefined}
                onClick={() => setSection(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {label}
                {index === 3 && <em>3</em>}
              </button>
            ))}
          </nav>
        ) : (
          <div className={styles.history}>
            <button type="button" className={styles.newChat}>
              <Icon name="plus" size={15} />
              新建对话
            </button>
            <span className={styles.label}>最近</span>
            <p className={styles.empty}>还没有对话。提出的问题会保存在当前账号，保留 10 天。</p>
          </div>
        )}
        <p className={styles.sideFoot}>
          <Icon name="shield" size={14} />
          仅群体统计 · 数字由本地计算
        </p>
      </aside>

      <main className={styles.surface}>
        {mode === "data" ? (
          <>
            <header className={styles.pageHead}>
              <span className={styles.eyebrow}>数据浏览 / {navigation[section]}</span>
              <h1>学习数据总览</h1>
              <p>18 门课程 · 4 个学期（2024B – 2025J） · 1,200 名学生 · 示意数据</p>
              <Ruler count={81} />
            </header>

            <section className={styles.readout} aria-label="关键读数">
              <div>
                <span className={styles.readLabel}>最高课程均分</span>
                <strong className={styles.number}>
                  75.22<small>分</small>
                </strong>
                <Ruler marker={75.22} />
                <span className={styles.readNote}>体育与健康 · 领先第二名 2.32 分</span>
              </div>
              <div>
                <span className={styles.readLabel}>学习活动总量</span>
                <strong className={styles.number}>
                  5,220,398<small>次</small>
                </strong>
                <span className={styles.spark} aria-hidden="true">
                  {[38, 52, 47, 61, 58, 72, 66, 80, 74, 69, 83, 77, 64, 58, 49, 42].map(
                    (height, index) => (
                      <i key={index} style={{ height: `${height}%` }} />
                    ),
                  )}
                </span>
                <span className={styles.readNote}>16 周分布 · 第 11 周达峰</span>
              </div>
              <div>
                <span className={styles.readLabel}>最高课程完成率</span>
                <strong className={styles.number}>
                  87.73<small>%</small>
                </strong>
                <Ruler marker={87.73} />
                <span className={styles.readNote}>数据可视化 · 领先 1.37 个百分点</span>
              </div>
            </section>

            <section className={styles.chartSection} aria-labelledby="compare-title">
              <div className={styles.sectionHead}>
                <div>
                  <h2 id="compare-title">课程对比</h2>
                  <p>
                    按{config.label}降序 · 单位：{config.unit} · 点击一门课程查看说明
                  </p>
                </div>
                <div className={styles.tabs} role="tablist" aria-label="指标">
                  {(Object.keys(metrics) as MetricKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={metric === key}
                      onClick={() => chooseMetric(key)}
                    >
                      {metrics[key].label}
                    </button>
                  ))}
                </div>
              </div>
              <span key={scan} className={styles.scan} aria-hidden="true">
                <Ruler count={81} />
              </span>

              <div className={styles.bars} role="list">
                <span
                  className={styles.mean}
                  style={{
                    left: `calc(var(--name-col) + (100% - var(--name-col) - var(--value-col)) * ${mean / config.max})`,
                  }}
                  aria-hidden="true"
                >
                  <em>均值 {format(mean, config.digits)}</em>
                </span>
                {sorted.map((course, index) => {
                  const value = course[metric];
                  const active = focus === course.name;
                  return (
                    <button
                      key={course.name}
                      type="button"
                      role="listitem"
                      className={styles.bar}
                      data-active={active || undefined}
                      onClick={() => setSelected(course.name === selected ? null : course.name)}
                      style={{
                        ["--w" as string]: `${(value / config.max) * 100}%`,
                        ["--i" as string]: index,
                      }}
                    >
                      <span className={styles.barName}>{course.name}</span>
                      <span className={styles.track}>
                        <i />
                      </span>
                      <span className={styles.barValue}>{format(value, config.digits)}</span>
                    </button>
                  );
                })}
              </div>

              <p className={styles.annotation}>
                <b>{focus}</b>
                {focus === top.name
                  ? `在${config.label}上排名第一，高出均值 ${format(top[metric] - mean, config.digits)} ${config.unit}。`
                  : `排名第 ${sorted.findIndex((course) => course.name === focus) + 1}，与均值相差 ${format(
                      (sorted.find((course) => course.name === focus)?.[metric] ?? 0) - mean,
                      config.digits,
                    )} ${config.unit}。`}
                <span>示意文字，正式版由本地计算生成。</span>
              </p>

              <form className={styles.inlineAsk} onSubmit={ask}>
                <Icon name="sparkles" size={15} />
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={`就这张图提问，例如：为什么${top.name}最高？`}
                  aria-label="就当前图表提问"
                />
                <button type="submit" aria-label="提问">
                  <Icon name="arrow" size={15} />
                </button>
              </form>
              {asked && <p className={styles.askEcho}>预览不会调用 AI：「{asked}」</p>}
            </section>
          </>
        ) : (
          <div className={styles.aiHome}>
            <header className={styles.pageHead}>
              <span className={styles.eyebrow}>AI 对话 / 新对话</span>
              <h1>从你关心的问题开始</h1>
              <p>挑一个常用问题，或直接写下你的问题。结论附带数据来源与计算方式。</p>
              <Ruler count={81} />
            </header>
            <ol className={styles.questions}>
              {questions.map((item, index) => (
                <li key={item.text}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(item.text);
                      composer.current?.focus();
                    }}
                  >
                    <span className={styles.qIndex}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.qText}>{item.text}</span>
                    <span className={styles.qNote}>{item.note}</span>
                    <Icon name="arrowUpRight" size={15} />
                  </button>
                </li>
              ))}
            </ol>
            <form className={styles.composer} onSubmit={ask}>
              <textarea
                ref={composer}
                rows={2}
                value={draft}
                maxLength={500}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) ask(event);
                }}
                placeholder="例如：各学期平均成绩如何变化？"
                aria-label="输入分析问题"
              />
              <div className={styles.composerFoot}>
                <span>{draft.length}/500 · Enter 发送 · 自由提问需管理员开启 AI</span>
                <button type="submit" disabled={!draft.trim()} aria-label="发送">
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            </form>
            {asked && <p className={styles.askEcho}>预览不会调用 AI：「{asked}」</p>}
          </div>
        )}
      </main>
    </div>
  );
}
