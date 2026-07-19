"use client";

import { useEffect, useState } from "react";

/**
 * ゲスト/関係者のロールをトップバーに小さく表示する。
 * 表示専用（gate_role Cookie を読むだけ。認証本体は httpOnly の別Cookie）。
 * ゲート無効時（合言葉未設定）は何も出さない。
 */
export function GateBadge() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)gate_role=([^;]+)/);
    setRole(m ? decodeURIComponent(m[1]) : null);
  }, []);

  if (!role) return null;

  async function handleLock() {
    await fetch("/api/gate", { method: "DELETE" }).catch(() => {});
    window.location.href = "/gate";
  }

  return (
    <span className="gate-badge">
      <span className={`badge ${role === "guest" ? "warn" : "success"}`}>
        {role === "guest" ? "ゲスト（デモ）" : "関係者"}
      </span>
      <button type="button" className="gate-lock" onClick={handleLock} title="ロックして合言葉入力に戻る">
        ロック
      </button>
    </span>
  );
}
