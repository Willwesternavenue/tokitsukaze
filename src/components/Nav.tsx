"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "取材メモ", step: "01" },
  { href: "/outline", label: "構成案", step: "02" },
  { href: "/writer", label: "原稿生成", step: "03" },
  { href: "/memory", label: "基本情報・執筆メモリ", step: "—" },
  { href: "/prompts", label: "プロンプト管理", step: "—" },
];

export function Nav(): JSX.Element {
  const pathname = usePathname();
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
