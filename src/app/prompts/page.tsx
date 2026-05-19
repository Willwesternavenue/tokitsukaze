"use client";

import { useEffect, useState } from "react";
import { loadPrompts, savePrompts } from "@/lib/storage";
import { defaultPrompts } from "@/lib/samples";
import type { PromptTemplate } from "@/lib/types";

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const ps = loadPrompts();
    setPrompts(ps);
    if (ps.length) setSelectedId(ps[0].id);
  }, []);

  const selected = prompts.find((p) => p.id === selectedId) ?? null;

  function updateSelected<K extends keyof PromptTemplate>(key: K, value: PromptTemplate[K]) {
    setPrompts((prev) => prev.map((p) => (p.id === selectedId ? { ...p, [key]: value } : p)));
    setInfo(null);
  }

  function handleSave() {
    savePrompts(prompts);
    setInfo("プロンプトを保存しました。");
  }

  function handleResetOne() {
    if (!selected) return;
    if (!confirm("このプロンプトを初期値に戻します。よろしいですか？")) return;
    const def = defaultPrompts.find((d) => d.id === selected.id);
    if (!def) return;
    setPrompts((prev) => prev.map((p) => (p.id === selected.id ? def : p)));
    setInfo("このプロンプトを初期値に戻しました。保存ボタンで確定してください。");
  }

  function handleResetAll() {
    if (!confirm("すべてのプロンプトを初期値に戻します。よろしいですか？")) return;
    setPrompts(defaultPrompts);
    savePrompts(defaultPrompts);
    setInfo("すべて初期値に戻しました。");
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>プロンプト管理</h1>
          <p className="subtitle">
            AIへの指示テンプレートを編集・保存します。各テンプレートは API Route から読み込まれます。
          </p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={handleResetAll} type="button">
            全プロンプトを初期値に戻す
          </button>
          <button className="btn primary" onClick={handleSave} type="button">
            保存
          </button>
        </div>
      </div>

      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="writer-shell">
        <aside className="panel">
          <div className="panel-header">
            <h2>プロンプト一覧</h2>
          </div>
          <ul className="prompt-list">
            {prompts.map((p) => (
              <li
                key={p.id}
                className={p.id === selectedId ? "active" : ""}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="pname">{p.name}</span>
                <span className="pdesc">{p.description}</span>
              </li>
            ))}
          </ul>
        </aside>

        <section>
          {!selected ? (
            <div className="empty-state">左側のリストから編集対象を選んでください。</div>
          ) : (
            <>
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h2 style={{ marginBottom: 2 }}>{selected.name}</h2>
                    {selected.id === "prompt-style-rules" ? (
                      <span className="badge warn">
                        本文生成・編集レビューに自動で結合されます
                      </span>
                    ) : null}
                  </div>
                  <button className="btn sm" onClick={handleResetOne} type="button">
                    このプロンプトを初期値に戻す
                  </button>
                </div>
                <div className="panel-body">
                  {selected.id === "prompt-style-rules" ? (
                    <div className="alert info" style={{ marginBottom: 12 }}>
                      校正・編集ルールはフリーテキストで編集できます。
                      ここに書いた内容は <strong>本文生成</strong> と <strong>編集レビュー</strong> 実行時に、
                      対応するプロンプトの末尾へ自動で結合されます。
                      文体（ですます調／である調）、てにをは、禁則、用字用語など、本書共通のスタイルを記入してください。
                    </div>
                  ) : null}
                  <div className="field">
                    <label>プロンプト名</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.name}
                      onChange={(e) => updateSelected("name", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>用途説明</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.description}
                      onChange={(e) => updateSelected("description", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>システムプロンプト</label>
                    <textarea
                      className="input mono"
                      rows={10}
                      value={selected.systemPrompt}
                      onChange={(e) => updateSelected("systemPrompt", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>ユーザープロンプトテンプレート</label>
                    <textarea
                      className="input mono"
                      rows={10}
                      value={selected.userPromptTemplate}
                      onChange={(e) => updateSelected("userPromptTemplate", e.target.value)}
                    />
                    <p className="help">
                      {"{{projectName}} / {{interviewNotes}} / {{chapterTitle}} などの差し込み変数を使えます。"}
                    </p>
                  </div>
                  <div className="field">
                    <label>出力フォーマット（JSONスキーマ）</label>
                    <textarea
                      className="input mono"
                      rows={8}
                      value={selected.outputFormat}
                      onChange={(e) => updateSelected("outputFormat", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
