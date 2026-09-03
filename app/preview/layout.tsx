import type { Metadata } from "next";
import React from "react";
import type { ReactNode } from "react";

import "./preview.css";

export const metadata: Metadata = {
  title: "官方招聘数据预览 · P2-08",
  description: "基于 P2-07 只读投影的官方招聘采集结果预览"
};

export default function PreviewLayout({ children }: { readonly children: ReactNode }) {
  return <div className="p208-root">{children}</div>;
}
