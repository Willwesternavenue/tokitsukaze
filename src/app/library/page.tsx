"use client";

import { useEffect, useRef, useState } from "react";
import {
  addReferenceWork,
  loadLibrary,
  loadProject,
  removeReferenceWork,
  setReferenceWorkIds,
} from "@/lib/storage";
import type { Project, ReferenceWork } from "@/lib/types";

export default function LibraryPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [library, setLibrary] = useState<ReferenceWork[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // アップロードフォーム
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"own" | "reference">("own");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProject(loadProject());
    setLibrary(loadLibrary());
  }, []);

  const selectedIds = new Set(project?.referenceWorkIds ?? []);
  const isFictionProject =
    project?.genre === "novel" || project?.genre === "screenplay";

  function toggleSelected(id: string) {
    if (!project) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const p = setReferenceWorkIds(Array.from(next));
    setProject(p);
  }

  async function handleUpload(file: File) {
    setError(null);
    setInfo(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title.trim() || file.name);
      form.append("kind", kind);
      form.append("isFiction", String(isFictionProject));
      const res = await fetch("/api/ingest-reference", { method: "POST", body: form });
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          res.status === 413 || /timeout|timed out/i.test(text)
            ? "ファイルが大きすぎるか、処理がタイムアウトしました。分割してお試しください。"
            : `サーバエラー（HTTP ${res.status}）`,
        );
      }
      if (!res.ok) throw new Error(data?.error || "カルテ生成に失敗しました。");
      const work: ReferenceWork = data.work;
      const next = addReferenceWork(work);
      setLibrary(next);
      setTitle("");
      setInfo(`「${work.title}」のカルテを生成しました。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  function handleDelete(id: string) {
    if (!confirm("この作品カルテをライブラリから削除します。よろしいですか？")) return;
    const next = removeReferenceWork(id);
    setLibrary(next);
    setProject(loadProject()); // 選択解除が反映される
  }

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>参照ライブラリ</h1>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>参照ライブラリ</h1>
          <p className="subtitle">
            過去作品・参照作品を登録すると、AIが「作品カルテ」（文体・設定・既出の主張・キャラの口調/セリフ）を抽出します。
            チェックした作品は、このプロジェクトの本文生成と重複/一貫性チェックに使われます。
          </p>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>作品を追加</h2>
          <span className="hint">.docx / .pdf / .txt（目安 4MB 以内）</span>
        </div>
        <div className="panel-body">
          <div className="field-row">
            <div className="field">
              <label>作品タイトル（未入力ならファイル名）</label>
              <input
                className="input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：前作『地域と生きる』"
              />
            </div>
            <div className="field">
              <label>種別</label>
              <select
                className="input"
                value={kind}
                onChange={(e) => setKind(e.target.value as "own" | "reference")}
              >
                <option value="own">自作（過去の自分の作品）</option>
                <option value="reference">参照作品（文体を参考にしたい他の作品）</option>
              </select>
            </div>
          </div>
          <div className="flex">
            <button
              className="btn primary"
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <span className="spinner" /> : null}
              {uploading ? "カルテを生成中…（数十秒）" : "ファイルを選んでカルテ生成"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
          </div>
          <p className="help" style={{ marginTop: 8 }}>
            {isFictionProject
              ? "小説・脚本モードなので、登場人物（口調・過去のセリフ）も抽出します。"
              : "登場人物の抽出は小説・脚本モードのプロジェクトで有効になります。"}
            {" "}原本ファイルは保存されず、抽出したカルテのみが残ります。
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>ライブラリ（全プロジェクト共有）</h2>
          <span className="hint">{library.length} 作品 / このPJで {selectedIds.size} 件参照中</span>
        </div>
        <div className="panel-body dense">
          {library.length === 0 ? (
            <div className="empty-state">
              まだ作品がありません。上のフォームから過去作品をアップロードしてください。
            </div>
          ) : (
            library.map((w) => {
              const expanded = expandedId === w.id;
              const selected = selectedIds.has(w.id);
              return (
                <div key={w.id} className={`library-row ${selected ? "selected" : ""}`}>
                  <label className="library-check">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(w.id)}
                    />
                  </label>
                  <div className="library-main">
                    <div className="library-title">
                      <strong>{w.title}</strong>
                      <span className={`badge ${w.kind === "own" ? "" : "gray"}`}>
                        {w.kind === "own" ? "自作" : "参照"}
                      </span>
                      {w.characters?.length ? (
                        <span className="badge success">人物 {w.characters.length}</span>
                      ) : null}
                    </div>
                    <div className="library-summary">{w.summary}</div>
                    {expanded ? (
                      <div className="library-detail">
                        <div className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                          <dt>文体プロファイル</dt>
                          <dd>{w.styleProfile || "—"}</dd>
                          <dt>確定設定</dt>
                          <dd>
                            {w.canonFacts.length ? (
                              <ul className="mini-list">
                                {w.canonFacts.map((f, i) => <li key={i}>{f}</li>)}
                              </ul>
                            ) : "—"}
                          </dd>
                          <dt>既出の主張</dt>
                          <dd>
                            {w.keyClaims.length ? (
                              <ul className="mini-list">
                                {w.keyClaims.map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                            ) : "—"}
                          </dd>
                        </div>
                        {w.characters?.length ? (
                          <div style={{ marginTop: 8 }}>
                            <strong style={{ fontSize: 12 }}>登場人物</strong>
                            <ul className="mini-list">
                              {w.characters.map((c, i) => (
                                <li key={i}>
                                  <strong>{c.name}</strong>（口調: {c.voice || "不明"}）
                                  {c.keyLines.length ? ` セリフ: ${c.keyLines.map((l) => `「${l}」`).join("、")}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="library-actions">
                    <button
                      className="btn sm"
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : w.id)}
                    >
                      {expanded ? "閉じる" : "詳細"}
                    </button>
                    <button
                      className="btn danger sm"
                      type="button"
                      onClick={() => handleDelete(w.id)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              );
            })
          )}
          <p className="help" style={{ marginTop: 10 }}>
            チェックした作品を参照すると、本文生成後に「重複」「一貫性（過去作）」エージェントが働きます。
            続編を書く場合は、前作を「参照する」に選んでください。
          </p>
        </div>
      </div>
    </>
  );
}
