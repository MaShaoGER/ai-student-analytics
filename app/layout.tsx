import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "学析台 | 学生学习数据分析",
  description: "面向高校教学管理的可追溯学生学习数据分析助手",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
