"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/app-icons";
import { ThemeToggle } from "@/components/ui/theme-provider";
import styles from "./preview.module.css";

const suggestions = [
  { label: "比较课程", question: "各门课程的平均成绩有什么差异？", icon: "chart" as const },
  { label: "观察趋势", question: "对比四个学期的成绩变化趋势", icon: "line" as const },
  { label: "探索关联", question: "学习活动与课程成绩有什么关系？", icon: "link" as const },
];
const courses = [
  { name: "高等数学", value: 76 },
  { name: "大学英语", value: 84 },
  { name: "程序设计", value: 69 },
  { name: "线性代数", value: 73 },
  { name: "大学物理", value: 79 },
  { name: "数据结构", value: 71 },
];

export default function AIHomePreview() {
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (question.trim()) setSubmitted(question.trim());
  }
  function choose(value: string) {
    setQuestion(value);
    setSubmitted("");
    input.current?.focus();
  }

  return (
    <div className={styles.preview}>
      <aside className={styles.rail} aria-label="工作台工具">
        <a href="/" className={styles.mark} aria-label="学析台首页">
          <i />
          <i />
          <i />
          <i />
        </a>
        <a href="#ai-question" aria-label="AI 对话">
          <Icon name="messages" size={21} />
        </a>
        <a href="#overview" aria-label="数据概览">
          <Icon name="dashboard" size={20} />
        </a>
        <span className={styles.railText}>LEARNING INTELLIGENCE</span>
        <div className={styles.railBottom}>
            <ThemeToggle compact />
        </div>
      </aside>

      <div className={styles.canvas}>
        <header className={styles.header}>
          <a href="/" className={styles.brand}>
            学析台<span>让数据，回应每一个教学问题。</span>
          </a>
          <div className={styles.previewLabel}>
            <span />
            首页概念预览 · 01
          </div>
          <a className={styles.avatar} href="/" aria-label="返回当前工作台">
            学
          </a>
        </header>
        <nav className={styles.nav} aria-label="主要功能">
          <a href="#ai-question" aria-current="page">
            首页
          </a>
          <a href="#ai-question">
            AI 对话 <span>AI</span>
          </a>
          <a href="#overview">学习全景</a>
          <a href="#tools">指标分析</a>
          <a href="#source">数据</a>
          <a href="/">
            进入工作台 <Icon name="arrowUpRight" size={14} />
          </a>
        </nav>

        <main>
          <section className={styles.hero} aria-labelledby="hero-title">
            <div className={styles.heroMain}>
              <div className={styles.eyebrow}>
                <span className={styles.cross}>✳</span> 学析台 AI{" "}
                <span className={styles.eyebrowLine} /> 从提问到洞察
              </div>
              <h1 id="hero-title">
                想了解学情，
                <br />从<span>一句话</span>开始。
              </h1>
              <p className={styles.heroDescription}>
                把问题交给 AI，让课程对比、学习趋势与数据关联清晰呈现。
              </p>

              <form className={styles.composer} onSubmit={submit}>
                <label htmlFor="ai-question" className={styles.composerLabel}>
                  <Icon name="messages" size={17} /> 今天，你想从数据中发现什么？
                </label>
                <textarea
                  ref={input}
                  id="ai-question"
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    setSubmitted("");
                  }}
                  placeholder="例如：哪些课程的平均成绩差异最明显？"
                  rows={2}
                />
                <div className={styles.composerBottom}>
                  <span>
                    <Icon name="database" size={13} /> 合成校园演示数据
                  </span>
                  <button type="submit" disabled={!question.trim()}>
                    开始对话 <Icon name="arrowUpRight" size={18} />
                  </button>
                </div>
              </form>
              <div className={styles.composerNote}>
                <Icon name="shield" size={13} /> 仅分析群体统计，保护学生隐私{" "}
                <span>支持连续追问 · 图表呈现</span>
              </div>
            </div>

            <aside className={styles.discovery}>
              <div className={styles.discoveryTitle}>
                <span>不妨从这里开始</span>
                <span>01 — 03</span>
              </div>
              {suggestions.map((item, index) => (
                <button
                  className={styles.prompt}
                  key={item.label}
                  onClick={() => choose(item.question)}
                >
                  <div className={styles.promptMeta}>
                    <span>0{index + 1}</span>
                    <Icon name={item.icon} size={20} />
                  </div>
                  <strong>{item.label}</strong>
                  <div>
                    {item.question}
                    <Icon name="arrowUpRight" size={18} />
                  </div>
                </button>
              ))}
              <p className={styles.discoveryFoot}>
                用自然语言提问，
                <br />
                沿着数据线索，继续往下探索。
              </p>
            </aside>
          </section>

          {submitted && (
            <div className={styles.demoReply} role="status">
              <Icon name="messages" size={20} />
              <div>
                <strong>已收到：{submitted}</strong>
                <p>
                  这里会进入 AI 连续对话，并展示分析与图表。当前为界面交互预览，未调用 AI 服务。
                </p>
              </div>
              <button type="button" aria-label="关闭预览提示" onClick={() => setSubmitted("")}>
                <Icon name="close" size={18} />
              </button>
            </div>
          )}

          <section className={styles.sourceStrip} id="source" aria-label="演示数据范围">
            <div className={styles.sourceName}>
              <Icon name="database" size={20} />
              <div>
                <strong>数据已就位，随时开始探索</strong>
                <span>合成演示数据 / 非真实学生记录</span>
              </div>
            </div>
            <div className={styles.scope}>
              <strong>1,200</strong>
              <span>匿名学生</span>
            </div>
            <div className={styles.scope}>
              <strong>18</strong>
              <span>门课程</span>
            </div>
            <div className={styles.scope}>
              <strong>4</strong>
              <span>个学期</span>
            </div>
            <a href="/">
              管理数据 <Icon name="arrowUpRight" size={16} />
            </a>
          </section>

          <section className={styles.overview} id="overview">
            <div className={styles.sectionHeading}>
              <div>
                <span>02 / DATA AT A GLANCE</span>
                <h2>数据一览</h2>
              </div>
              <p>先看全貌，再深入提问。</p>
              <a href="/">
                查看学习全景 <Icon name="arrow" size={16} />
              </a>
            </div>
            <div className={styles.lowerGrid}>
              <article className={styles.chartPanel}>
                <div className={styles.panelHeading}>
                  <h3>课程成绩概览</h3>
                  <span>示意数值 · 非实时统计</span>
                </div>
                <div className={styles.bars} aria-label="课程平均成绩示意图">
                  {courses.map((course, i) => (
                    <div className={styles.barColumn} key={course.name}>
                      <span>{course.value}</span>
                      <div
                        className={`${styles.bar} ${i === 1 ? styles.highlight : ""}`}
                        style={{ height: `${course.value * 1.12}px` }}
                      />
                      <small>{course.name}</small>
                    </div>
                  ))}
                </div>
                <button
                  className={styles.chartQuestion}
                  onClick={() => choose("各门课程的平均成绩有什么差异？")}
                >
                  <Icon name="sparkles" size={15} /> 让 AI 帮我比较课程表现{" "}
                  <Icon name="arrowUpRight" size={16} />
                </button>
              </article>
              <article className={styles.tools} id="tools">
                <div className={styles.panelHeading}>
                  <h3>换一种方式探索</h3>
                  <span>分析工具</span>
                </div>
                <a href="/">
                  <span className={styles.toolIcon}>
                    <Icon name="sliders" size={20} />
                  </span>
                  <div>
                    <strong>指标分析</strong>
                    <p>选定指标与维度，自主查看数据</p>
                  </div>
                  <Icon name="arrowUpRight" size={18} />
                </a>
                <a href="/">
                  <span className={styles.toolIcon}>
                    <Icon name="link" size={20} />
                  </span>
                  <div>
                    <strong>学科全景</strong>
                    <p>联动观察课程之间的表现与关联</p>
                  </div>
                  <Icon name="arrowUpRight" size={18} />
                </a>
                <div className={styles.toolsNote}>每一种探索，都可以从一句提问继续。</div>
              </article>
            </div>
          </section>
        </main>
        <footer className={styles.footer}>
          <span>学析台 / LEARNING INTELLIGENCE</span>
          <span>首页设计预览 · 所有图表数值均为示意</span>
        </footer>
      </div>
    </div>
  );
}
