"use client";

import { useState } from "react";
import type { AiStatusState } from "@/components/ui/ai-status";
import { ConversationEvidence, ExecutionSteps } from "@/components/conversation-evidence";
import { MotionToggle } from "@/components/ui/motion-preferences";
import { ThemeToggle } from "@/components/ui/theme-provider";
import type { AnalysisStep, ChatResponse } from "@/lib/ai/chat-types";
import styles from "./preview.module.css";

const phases: { state: AiStatusState; label: string }[] = [
  { state: "thinking", label: "理解分析问题" },
  { state: "researching", label: "检索教学依据" },
  { state: "analyzing", label: "比较课程成绩" },
  { state: "writing", label: "整理分析回答" },
  { state: "done", label: "分析完成" },
  { state: "error", label: "分析未完成" },
  { state: "stopped", label: "分析已停止" },
  { state: "partial", label: "分析部分完成" },
];
const steps: AnalysisStep[] = [
  { id: "demo-read", label: "读取课程与学期", status: "completed", durationMs: 180 },
  { id: "demo-compare", label: "比较课程成绩", status: "completed", durationMs: 420 },
  { id: "demo-retrieve", label: "检索教学依据", status: "completed", durationMs: 260 },
];
const evidence: Pick<ChatResponse, "facts" | "citations"> = {
  facts: [
    "演示课程前期均分 72.72，后期 69.65，变化 −3.07 分。",
    "演示样本人数分别为 199、200；两期人群可能不同。",
  ],
  citations: [
    {
      id: "comparison-scope",
      title: "跨学期比较口径",
      version: "演示资料",
      source: "/knowledge/teaching#comparison-scope",
      scope: "all",
      excerpt: "变化为后期减前期。本演示用于检查引用卡片，不代表新的分析结论。",
    },
    {
      id: "metric-score",
      title: "平均成绩",
      version: "演示资料",
      source: "/knowledge/teaching#metric-score",
      scope: "all",
      excerpt: "仅对有效成绩计算均值，缺失值不作零分；小样本群体需隐藏。",
    },
  ],
};

export default function AIMotionPreview() {
  const [selected, setSelected] = useState(phases[0]);
  const live = !["done", "error", "stopped", "partial"].includes(selected.state);
  const previewSteps: AnalysisStep[] =
    live || selected.state === "error" || selected.state === "stopped"
      ? [
          ...steps,
          {
            id: "demo-current",
            label: selected.label,
            status: live ? "running" : selected.state === "error" ? "failed" : "cancelled",
            durationMs: 0,
          },
        ]
      : steps;
  return (
    <main className={styles.preview}>
      <header className={styles.header}>
        <a href="/">返回学析台</a>
        <ThemeToggle compact />
      </header>
      <p className={styles.eyebrow}>AI 对话 · 动效预览</p>
      <h1>让分析过程看得见。</h1>
      <p className={styles.intro}>
        这里使用与正式对话相同的组件。下列数据和状态均为演示，点击切换，不会发起 AI 请求。
      </p>
      <section className={styles.panel} aria-label="阶段动效">
        <h2>分析状态</h2>
        <div className={styles.controls}>
          {phases.map((phase) => (
            <button
              key={phase.state}
              type="button"
              aria-pressed={selected.state === phase.state}
              onClick={() => setSelected(phase)}
            >
              {phase.label}
            </button>
          ))}
        </div>
        <div className={styles.stage}>
          <ExecutionSteps
            steps={previewSteps}
            live={live}
            completion={selected.state === "partial" ? "partial" : "complete"}
          />
        </div>
      </section>
      <section className={styles.panel} aria-label="回答与分析依据">
        <h2>回答与依据</h2>
        <ExecutionSteps steps={steps} completion="complete" />
        <p className={styles.answer}>
          演示课程的平均成绩下降 3.07 分。可以展开分析依据，查看数字口径与教学资料。
        </p>
        <ConversationEvidence response={evidence} />
      </section>
      <footer className={styles.footer}>
        <MotionToggle />
        <p>
          状态动效改编自{" "}
          <a href="https://www.rareui.com/components/aistatus" target="_blank" rel="noreferrer">
            Rare UI
          </a>
          ；依据卡片交互参考其 Web Search。键盘操作与系统减少动态效果时即时呈现。
        </p>
      </footer>
    </main>
  );
}
