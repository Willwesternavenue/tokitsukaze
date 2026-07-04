"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { loadProject } from "@/lib/storage";
import { getGenreConfig } from "@/lib/genreConfig";
import type { Genre } from "@/lib/types";

const STAGE_HREFS: { key: "material" | "structure" | "writing" | "review"; href: string; num: string }[] = [
  { key: "material", href: "/", num: "01" },
  { key: "structure", href: "/outline", num: "02" },
  { key: "writing", href: "/writer", num: "03" },
  { key: "review", href: "/review", num: "04" },
];

export function Nav(): JSX.Element {
  const pathname = usePathname();
  const [genre, setGenre] = useState<Genre>("biography");
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const knowledgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setGenre(loadProject().genre ?? "biography");
    } catch {
      setGenre("biography");
    }
  }, [pathname]);

  useEffect(() => {
    if (!knowledgeOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (knowledgeRef.current && !knowledgeRef.current.contains(e.target as Node)) {
        setKnowledgeOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setKnowledgeOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [knowledgeOpen]);

  const config = getGenreConfig(genre);
  const knowledgeActive = config.knowledge.some((k) => pathname?.startsWith(k.href));

  return (
    <nav className="nav" aria-label="主要ナビゲーション">
      {/* ワークフロー: 骨格固定、ラベルはジャンル駆動 */}
      {STAGE_HREFS.map((st) => {
        const stage = config.stages[st.key];
        const active = st.href === "/" ? pathname === "/" : pathname?.startsWith(st.href);
        return (
          <Link key={st.href} href={st.href} className={active ? "active" : ""}>
            <span className="step">{st.num}</span>
            <span>{stage.navLabel}</span>
          </Link>
        );
      })}

      {/* ナレッジ: ジャンルで中身が変わるドロップダウン */}
      <div className="nav-dropdown" ref={knowledgeRef}>
        <button
          type="button"
          className={`nav-dropdown-btn ${knowledgeActive ? "active" : ""}`}
          onClick={() => setKnowledgeOpen((o) => !o)}
          aria-expanded={knowledgeOpen}
          aria-haspopup="menu"
        >
          <span>ナレッジ</span>
          <span className="caret">▾</span>
        </button>
        {knowledgeOpen ? (
          <div className="nav-dropdown-menu" role="menu">
            {config.knowledge.map((k) => (
              <Link
                key={k.href}
                href={k.href}
                role="menuitem"
                className={`nav-dropdown-item ${pathname?.startsWith(k.href) ? "active" : ""}`}
                onClick={() => setKnowledgeOpen(false)}
              >
                {k.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {/* 管理 */}
      <Link href="/staff" className={pathname?.startsWith("/staff") ? "active" : ""}>
        <span>AIスタッフ</span>
      </Link>
      <Link href="/settings" className={pathname?.startsWith("/settings") ? "active" : ""}>
        <span>設定</span>
      </Link>
      <Link
        href="/guide"
        className={pathname?.startsWith("/guide") ? "active" : ""}
        style={{ marginLeft: "auto" }}
      >
        <span>使い方</span>
      </Link>
    </nav>
  );
}
