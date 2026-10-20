"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/app-icons";
import { ThemeToggle } from "@/components/ui/theme-provider";
import styles from "./preview.module.css";

const starters: { icon: IconName; title: string; question: string }[] = [
  {
    icon: "chart",
    title: "找出值得关注的课程",
    question: "哪些课程需要优先关注？请说明判断依据。",
  },
  {
    icon: "line",
    title: "看看学期之间的变化",
    question: "对比四个学期，各门课程的成绩有什么变化？",
  },
  { icon: "link", title: "探索学习与成绩的联系", question: "学习活动与课程成绩有什么关系？" },
];
const followups = ["先帮我明确分析范围", "我应该关注哪些指标？", "如何判断结论是否可靠？"];
type Turn = { id: number; question: string };

export default function AIAnalysisPreview() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [showScope, setShowScope] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLElement>(null);
  const nextId = useRef(0);

  function expand() {
    setCollapsed(false);
    requestAnimationFrame(() => input.current?.focus());
  }
  function choose(value: string) {
    setQuestion(value);
    expand();
  }
  function send() {
    const value = question.trim();
    if (!value) return;
    setTurns((current) => [...current, { id: nextId.current++, question: value }]);
    setQuestion("");
    requestAnimationFrame(() =>
      latest.current?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    send();
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }
  function reset() {
    setTurns([]);
    setQuestion("");
    expand();
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }

  return (
    <div className={styles.page} data-collapsed={collapsed}>
      <a className={styles.skip} href="#conversation">
        跳到对话
      </a>
      <aside className={styles.sidebar} aria-label="对话导航">
        <a className={styles.brand} href="/">
          <span className={styles.brandIcon}>
            <i />
            <i />
            <i />
            <i />
          </span>
          学析台<span className={styles.aiTag}>AI</span>
        </a>
        <button className={styles.newChat} type="button" onClick={reset}>
          <Icon name="plus" size={17} />
          开启新对话<kbd>↗</kbd>
        </button>
        <div className={styles.history}>
          <span className={styles.sidebarLabel}>当前会话</span>
          <button
            type="button"
            className={styles.activeChat}
            onClick={() =>
              document.getElementById("conversation")?.scrollIntoView({ behavior: "instant" })
            }
          >
            <Icon name="messages" size={16} />
            <span>{turns[0]?.question ?? "从一个问题开始"}</span>
          </button>
          <p>
            沿着同一条线索，
            <br />
            把问题一点点问清楚。
          </p>
        </div>
        <div className={styles.sidebarBottom}>
          <a href="/">
            <Icon name="dashboard" size={17} />
            返回工作台
            <Icon name="arrowUpRight" size={14} />
          </a>
          <div className={styles.appearance}>
            <span>外观</span>
            <ThemeToggle compact />
          </div>
          <small>对话界面预览 · 不调用 AI</small>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <span className={styles.headerTitle}>一句话分析</span>
            <span className={styles.headerHint}>你的教学数据搭档</span>
          </div>
          <div className={styles.headerRight}>
            <span className={styles.previewBadge}>PREVIEW 04</span>
          </div>
        </header>
        <main id="conversation" className={styles.conversation} aria-label="分析对话">
          {turns.length === 0 ? (
            <section className={styles.welcome} aria-labelledby="welcome-title">
              <div className={styles.intelligenceMark} aria-hidden="true">
                <Icon name="sparkles" size={32} />
                <i />
                <i />
              </div>
              <div className={styles.eyebrow}>一起，把教学问题想明白</div>
              <h1 id="welcome-title">
                <em>一句话分析，</em>
                <br />
                把问题聊清楚。
              </h1>
              <p className={styles.intro}>
                成绩里的变化、课程间的差异、还没想清楚的线索。
                <br />
                用你习惯的方式问，我来帮你理清思路。
              </p>
              <div className={styles.starters}>
                <span>没想好怎么问？试试这些</span>
                {starters.map((item) => (
                  <button key={item.title} type="button" onClick={() => choose(item.question)}>
                    <Icon name={item.icon} size={18} />
                    <span>{item.title}</span>
                    <Icon name="arrowUpRight" size={15} />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className={styles.thread}>
              <div className={styles.threadNote}>
                <Icon name="info" size={13} />
                以下为交互演示，未读取数据或调用 AI。
              </div>
              {turns.map((turn, index) => (
                <section
                  key={turn.id}
                  ref={index === turns.length - 1 ? latest : undefined}
                  className={styles.turn}
                  aria-label={`第 ${index + 1} 轮对话`}
                >
                  <div className={styles.userMessage}>
                    <span>你</span>
                    <p>{turn.question}</p>
                  </div>
                  <div className={styles.assistantMessage}>
                    <div className={styles.assistantName}>
                      <span>
                        <Icon name="sparkles" size={17} />
                      </span>
                      学析台 AI<small>演示回复</small>
                    </div>
                    <div className={styles.answer}>
                      <h2>
                        {index === 0
                          ? "好，我们顺着这个问题往下看。"
                          : "可以，我们接着把范围缩小。"}
                      </h2>
                      <p>
                        真正开始分析前，可以先明确你关心的课程、学期和指标，再比较数据，并核对样本是否足够。
                      </p>
                      <p>
                        正式对话会在这里呈现统计结论、图表和计算依据；这版先让你体验提问与连续追问的节奏。
                      </p>
                      <div className={styles.followups}>
                        <span>接下来可以问</span>
                        {followups.map((item) => (
                          <button type="button" key={item} onClick={() => choose(item)}>
                            {item}
                            <Icon name="arrowUpRight" size={13} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>

        <div className={styles.dock}>
          {collapsed ? (
            <button
              type="button"
              className={styles.restore}
              onClick={expand}
              aria-expanded={false}
              aria-controls="question-composer"
            >
              <Icon name="sparkles" size={18} />
              <span>{question.trim() ? "继续编辑你的问题" : "继续和 AI 聊聊"}</span>
              <Icon name="chevron" size={16} />
            </button>
          ) : (
            <div className={styles.composerWrap} id="question-composer">
              <div className={styles.composerCaption}>
                <span>
                  <Icon name="sparkles" size={13} />
                  {turns.length ? "沿着刚才的线索，继续追问" : "一句话，也可以是好分析的开始"}
                </span>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  aria-label="收起提问栏"
                  aria-expanded={true}
                  aria-controls="question-composer"
                >
                  <Icon name="chevron" size={15} />
                  收起
                </button>
              </div>
              <form className={styles.composer} onSubmit={submit}>
                <label className={styles.srOnly} htmlFor="analysis-question">
                  输入你的分析问题
                </label>
                <textarea
                  id="analysis-question"
                  ref={input}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={onKeyDown}
                  maxLength={500}
                  rows={2}
                  placeholder={turns.length ? "继续追问，或换个角度看看…" : "把你的问题，交给 AI…"}
                />
                <div className={styles.composerToolbar}>
                  <div className={styles.scopeWrapper}>
                    <button
                      type="button"
                      className={styles.scopeButton}
                      onClick={() => setShowScope(!showScope)}
                      aria-expanded={showScope}
                      aria-controls="data-scope"
                    >
                      <Icon name="database" size={14} />
                      校园演示数据
                      <Icon name="chevron" size={12} />
                    </button>
                    {showScope && (
                      <div className={styles.scopePopover} id="data-scope">
                        <strong>合成校园演示数据</strong>
                        <p>1,200 名匿名学生 · 18 门课程 · 4 个学期</p>
                        <span>仅为界面示意，非真实学生记录。</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.sendArea}>
                    <span>Enter 发送</span>
                    <button
                      type="submit"
                      className={styles.send}
                      disabled={!question.trim()}
                      aria-label="发送问题"
                    >
                      <Icon name="arrow" size={19} />
                    </button>
                  </div>
                </div>
              </form>
              <div className={styles.composerFoot}>
                <span>AI 辅助理解，结论以数据依据为准。</span>
                <span>界面预览 · 未连接 AI</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
