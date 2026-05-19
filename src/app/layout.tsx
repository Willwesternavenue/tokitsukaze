import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "聞き書き出版AI（デモ）",
  description: "自費出版向け 取材メモ→章立て→本文生成のデモアプリ",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              <span>聞き書き出版AI</span>
              <span className="tag">DEMO</span>
            </div>
            <div className="right">編集者向け 業務デモ</div>
          </header>
          <Nav />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
