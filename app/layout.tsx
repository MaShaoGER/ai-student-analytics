import type { Metadata, Viewport } from "next";
import "./theme.css";
import "./globals.css";
import "./workbench.css";
import "./analysis-layout.css";
import "./overview.css";
import "./auth.css";
import "./interactions.css";
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

// Keep browser chrome aligned with the shared light/dark canvas.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#131518" },
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
