import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { GateBadge } from "@/components/GateBadge";

export const metadata: Metadata = {
  title: "アキカゼ出版AI（デモ）",
  description: "自費出版・小説・ビジネス書・脚本・ブログ対応 AI編集システムのデモアプリ",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              <span>アキカゼ出版AI</span>
              <span className="tag">DEMO</span>
            </div>
            <ProjectSwitcher />
            <div className="right">
              <GateBadge />
              <span>編集者向け 業務デモ</span>
            </div>
          </header>
          <Nav />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
