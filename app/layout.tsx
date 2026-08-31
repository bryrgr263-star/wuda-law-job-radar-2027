import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "武大法硕求职雷达 · 2027",
  description: "为武汉大学法律硕士（非法学）2027届定制的全国招聘岗位与投递管理网站"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
