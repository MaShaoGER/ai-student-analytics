"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon, type IconName } from "@/components/app-icons";
import { ThemeToggle } from "@/components/ui/theme-provider";
import styles from "./preview.module.css";

const prompts: { title: string; question: string; icon: IconName }[] = [
  { title: "比较课程", question: "哪些课程的平均成绩差异最明显？", icon: "chart" },
  { title: "发现变化", question: "各门课程在四个学期里有什么变化？", icon: "line" },
  { title: "探索关联", question: "学习活动与课程成绩有什么关系？", icon: "link" },
];
const steps = [
  { title: "理解你的问题", detail: "识别课程、学期和比较维度", icon: "messages" },
  { title: "沿着数据找线索", detail: "调用统计工具，核对数据范围", icon: "database" },
  { title: "把结论讲清楚", detail: "结合图表、样本和计算依据回答", icon: "chart" },
] satisfies { title: string; detail: string; icon: IconName }[];

export default function AIAnalysisPreview() {
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  function choose(value: string) {
    setQuestion(value);
    setSubmitted("");
    input.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (question.trim()) setSubmitted(question.trim());
  }

  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        跳到主要内容
      </a>
      <aside className={styles.rail} aria-label="快捷导航">
        <a className={styles.mark} href="/" aria-label="返回学析台">
          <i />
          <i />
          <i />
          <i />
        </a>
        <a href="#question" aria-label="一句话分析" aria-current="page">
          <Icon name="sparkles" size={22} />
        </a>
        <a href="#overview" aria-label="数据概览">
          <Icon name="dashboard" size={20} />
        </a>
        <span className={styles.railText}>LEARNING INTELLIGENCE</span>
        <div className={styles.theme}>
          <ThemeToggle compact />
        </div>
      </aside>

      <div className={styles.canvas}>
        <header className={styles.header}>
          <a className={styles.brand} href="/">
            学析台<span>学习数据分析工作台</span>
          </a>
          <span className={styles.previewTag}>视觉预览 / 02</span>
          <a className={styles.back} href="/">
            进入工作台
            <Icon name="arrowUpRight" size={16} />
          </a>
        </header>
        <nav className={styles.nav} aria-label="页面导航">
          <a href="#question" aria-current="page">
            <Icon name="sparkles" size={16} />
            一句话分析<span>AI</span>
          </a>
          <a href="#overview">学习概览</a>
          <a href="/">
            指标分析
            <Icon name="arrowUpRight" size={12} />
          </a>
          <span className={styles.navNote}>从一个教学问题，开始探索</span>
        </nav>

        <main id="main">
          <section className={styles.hero} id="question" aria-labelledby="hero-title">
            <div className={styles.questionArea}>
              <div className={styles.eyebrow}>
                <span>
                  <Icon name="sparkles" size={15} />
                  学析台 AI
                </span>
                <i />
                你的教学数据搭档
              </div>
              <h1 id="hero-title">
                <em>一句话分析，</em>
                <br />
                让数据说清楚。
              </h1>
              <p className={styles.description}>
                问成绩、看趋势、找关联。把问题写下来，
                <br className={styles.desktopBreak} />让 AI 帮你整理线索，给出有依据的回答。
              </p>

              <form className={styles.composer} onSubmit={submit}>
                <div className={styles.composerTop}>
                  <label htmlFor="analysis-question">
                    <Icon name="sparkles" size={16} />
                    今天，想从数据里发现什么？
                  </label>
                  <span>自然语言提问</span>
                </div>
                <textarea
                  id="analysis-question"
                  ref={input}
                  value={question}
                  rows={2}
                  maxLength={500}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    setSubmitted("");
                  }}
                  placeholder="例如：哪些课程需要优先关注，依据是什么？"
                />
                <div className={styles.composerBottom}>
                  <span>
                    <Icon name="database" size={14} />
                    合成校园演示数据
                  </span>
                  <button type="submit" disabled={!question.trim()}>
                    <Icon name="sparkles" size={17} />
                    开始 AI 分析
                    <Icon name="arrowUpRight" size={18} />
                  </button>
                </div>
              </form>
              <div className={styles.assurances}>
                <span>
                  <Icon name="messages" size={14} />
                  可连续追问
                </span>
                <span>
                  <Icon name="chart" size={14} />
                  结论配图表
                </span>
                <span>
                  <Icon name="shield" size={14} />
                  只分析群体统计
                </span>
              </div>

              <div className={styles.suggestions}>
                <span className={styles.tryLabel}>试着问问</span>
                {prompts.map((item) => (
                  <button type="button" key={item.title} onClick={() => choose(item.question)}>
                    <Icon name={item.icon} size={15} />
                    {item.title}
                    <Icon name="plus" size={13} />
                  </button>
                ))}
              </div>
            </div>

            <aside className={styles.assistant} aria-label="AI 分析能力示意">
              <div className={styles.assistantHeader}>
                <span>从提问，到洞察</span>
                <span>能力示意</span>
              </div>
              <div className={styles.signal} aria-hidden="true">
                <div />
                <div />
                <span>
                  <Icon name="sparkles" size={36} />
                </span>
                <b>AI</b>
              </div>
              <h2>
                你来提问，
                <br />
                AI 帮你串起线索。
              </h2>
              <ol className={styles.steps}>
                {steps.map((step, index) => (
                  <li key={step.title}>
                    <span className={styles.stepIcon}>
                      <Icon name={step.icon} size={18} />
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
                    </div>
                    <small>0{index + 1}</small>
                  </li>
                ))}
              </ol>
              <div className={styles.assistantFoot}>
                <Icon name="info" size={14} />
                <span>结论有据可查，关联不等于因果。</span>
              </div>
            </aside>
          </section>

          {submitted && (
            <section className={styles.reply} role="status" aria-live="polite">
              <Icon name="sparkles" size={23} />
              <div>
                <span>交互预览</span>
                <h2>{submitted}</h2>
                <p>
                  正式使用时，这里将进入连续对话，呈现分析结论、图表和数据依据。本页仅演示视觉与输入交互，未调用
                  AI 服务。
                </p>
                <a href="/">
                  进入工作台体验真实分析
                  <Icon name="arrowUpRight" size={15} />
                </a>
              </div>
              <button type="button" onClick={() => setSubmitted("")} aria-label="关闭预览提示">
                <Icon name="close" size={18} />
              </button>
            </section>
          )}

          <section className={styles.overview} id="overview" aria-labelledby="overview-title">
            <div className={styles.overviewHeading}>
              <div>
                <span>DATA CONTEXT / 演示范围</span>
                <h2 id="overview-title">先了解数据，再深入提问。</h2>
              </div>
              <span>合成数据 · 非真实学生记录</span>
            </div>
            <div className={styles.dataStrip}>
              <div className={styles.source}>
                <Icon name="database" size={25} />
                <div>
                  <strong>校园学习演示数据</strong>
                  <span>为课程、学期与学习活动的交叉探索而准备</span>
                </div>
              </div>
              <div className={styles.stat}>
                <strong>1,200</strong>
                <span>匿名学生</span>
              </div>
              <div className={styles.stat}>
                <strong>18</strong>
                <span>门课程</span>
              </div>
              <div className={styles.stat}>
                <strong>4</strong>
                <span>个学期</span>
              </div>
            </div>
            <button
              className={styles.followup}
              type="button"
              onClick={() => {
                choose("先帮我了解这份数据可以分析哪些问题");
                input.current?.scrollIntoView({ behavior: "instant", block: "center" });
              }}
            >
              <Icon name="sparkles" size={16} />
              <span>还没有具体问题？让 AI 帮你找一个切入点。</span>
              <Icon name="arrowUpRight" size={17} />
            </button>
          </section>
        </main>
        <footer className={styles.footer}>
          <span>学析台 / LEARNING INTELLIGENCE</span>
          <span>一句话分析 · 视觉与交互预览</span>
        </footer>
      </div>
    </div>
  );
}
