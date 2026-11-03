import type { Metadata } from "next";
import { StoryClient } from "./story-client";

export const metadata: Metadata = {
  title: "连续图表叙事预览 · 知序",
  description: "沿着同一门课的线，从课程差异读到学期变化。固定演示数据。",
  robots: { index: false, follow: false },
};

export default function ConnectedStoryPreview() {
  return <StoryClient />;
}
