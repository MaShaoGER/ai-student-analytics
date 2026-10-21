import type { Metadata } from "next";
import { ExperienceClient } from "./experience-client";

export const metadata: Metadata = {
  title: "AI 对话体验预览 · 学析台",
  description: "使用预设演示对话，体验从教学问题到图表、依据和连续追问的完整流程。",
  robots: { index: false, follow: false },
};

export default function AIExperiencePreview() {
  return <ExperienceClient />;
}
