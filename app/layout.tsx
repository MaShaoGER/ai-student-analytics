import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./workbench.css";
import "./theme.css";
import "./motion.css";
import "./motion-analysis.css";
import "./motion-conversation.css";
import "./motion-auth.css";
import "./glass-workspace.css";
import "./glass-auth.css";
import "./glass-controls.css";
import "./glass-hierarchy.css";
import "./tokens.css";
import { MotionPreferences } from "@/components/ui/motion-preferences";

export const metadata: Metadata = {
  title: "学析台 | 学生学习数据分析",
  description: "查看学习情况、比较课程表现，用一句话分析学习数据。",
  openGraph: {
    title: "学析台 | 学生学习数据分析",
    description: "查看学习情况、比较课程表现，用一句话分析学习数据。",
    siteName: "学析台",
    locale: "zh_CN",
    type: "website",
  },
};

// Browser chrome mirrors the single light workspace ground.
// viewportFit: "cover" is what makes env(safe-area-inset-*) resolve on notched
// phones, so the floating chat composer clears the home indicator.
export const viewport: Viewport = {
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#f5f5f2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="light">
      <body>
        <MotionPreferences>{children}</MotionPreferences>
      </body>
    </html>
  );
}
