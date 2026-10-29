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
import { ThemeProvider } from "@/components/ui/theme-provider";

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

// Browser chrome follows the page paper. Values mirror --background from app/theme.css
// for each color scheme; the in-app theme toggle only changes the page itself.
// viewportFit: "cover" is what makes env(safe-area-inset-*) resolve on notched
// phones, so the floating chat composer clears the home indicator.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e1e3d8" },
    { media: "(prefers-color-scheme: dark)", color: "#101b21" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('student-analytics.appearance');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
