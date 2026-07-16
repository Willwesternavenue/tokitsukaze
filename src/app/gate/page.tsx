"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function GateForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) {
      setError("合言葉を入力してください。");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "合言葉が違います。");
      }
      const next = params.get("next");
      const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      router.replace(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <div className="gate-overlay">
      <form className="gate-card" onSubmit={handleSubmit}>
        <div className="gate-brand">
          アキカゼ出版AI <span className="tag">DEMO</span>
        </div>
        <h1 className="gate-title">合言葉を入力してください</h1>
        <p className="gate-help">
          このデモは合言葉をお持ちの方のみご利用いただけます。関係者・ゲスト用の合言葉を入力してください。
        </p>
        <input
          className="input"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="合言葉"
          autoFocus
          autoComplete="off"
        />
        {error ? <div className="alert" style={{ marginTop: 12 }}>{error}</div> : null}
        <button className="btn primary lg" type="submit" disabled={loading} style={{ marginTop: 16, width: "100%" }}>
          {loading ? <span className="spinner" /> : null}
          {loading ? "確認中…" : "入室する"}
        </button>
      </form>
    </div>
  );
}

export default function GatePage() {
  return (
    <Suspense fallback={<div className="gate-overlay" />}>
      <GateForm />
    </Suspense>
  );
}
