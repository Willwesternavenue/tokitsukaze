"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { loadProject } from "@/lib/storage";

const baseItems = [
  { href: "/", label: "取材メモ", step: "01" },
  { href: "/outline", label: "構成案", step: "02" },
  { href: "/writer", label: "原稿生成", step: "03" },
  { href: "/memory", label: "基本情報・執筆メモリ", step: "—" },
  { href: "/prompts", label: "プロンプト管理", step: "—" },
];

const novelExtras = [
  { href: "/characters", label: "登場人物", step: "小説" },
  { href: "/bible", label: "Story Bible", step: "小説" },
];

export function Nav(): JSX.Element {
  const pathname = usePathname();
  const [genre, setGenre] = useState<"biography" | "novel" | null>(null);

  useEffect(() => {
    try {
      const p = loadProject();
      setGenre(p.genre ?? "biography");
    } catch {
      setGenre("biography");
    }
  }, [pathname]);

  const items = genre === "novel" ? [...baseItems, ...novelExtras] : baseItems;

  return (
    <nav className="nav" aria-label="主要ナビゲーション">
      {items.map((it) => {
        const active = it.href === "/" ? pathname === "/" : pathname?.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} className={active ? "active" : ""}>
            <span className="step">{it.step}</span>
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
