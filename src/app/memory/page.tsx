"use client";

import { useEffect, useState } from "react";
import { loadProject, updateWritingMemory } from "@/lib/storage";
import { sampleWritingMemory } from "@/lib/samples";
import type { Project, WritingMemory } from "@/lib/types";

type ListField =
  | "profile.personality"
  | "profile.keyPhrases"
  | "bookConcept.avoidExpressions"
  | "confirmedFacts"
  | "uncertainFacts"
  | "styleRules";

function TagEditor({
  label,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder?: string;
  onChange: (next: string[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="tag-list" style={{ marginBottom: 6 }}>
        {values.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> : null}
        {values.map((v, i) => (
          <span className="tag" key={`${v}-${i}`}>
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              aria-label="削除"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex">
        <input
          className="input"
          type="text"
          placeholder={placeholder ?? "追加して Enter"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn" type="button" onClick={add}>追加</button>
      </div>
    </div>
  );
}

export default function MemoryPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  function update(mut: (m: WritingMemory) => WritingMemory) {
    setProject((prev) => {
      if (!prev) return prev;
      const nextMem = mut(prev.writingMemory);
      updateWritingMemory(nextMem);
      return { ...prev, writingMemory: nextMem };
    });
    setInfo(null);
  }

  function handleReset() {
    if (!confirm("執筆メモリをサンプルの初期値に戻します。よろしいですか？")) return;
    update(() => ({ ...sampleWritingMemory }));
    setInfo("サンプルの初期値に戻しました。");
  }

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>基本情報・執筆メモリ</h1>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  const mem = project.writingMemory;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>基本情報・執筆メモリ</h1>
          <p className="subtitle">
            長い本の執筆中にAIが基本情報を忘れないよう、プロジェクトの核となる情報を保存します。
            本文生成時に毎回AIへ渡されます。
          </p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={handleReset} type="button">
            サンプルに戻す
          </button>
        </div>
      </div>

      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-header"><h2>人物プロフィール</h2></div>
          <div className="panel-body">
            <div className="field-row">
              <div className="field">
                <label>氏名</label>
                <input className="input" type="text" value={mem.profile.name}
                  onChange={(e) => update((m) => ({ ...m, profile: { ...m.profile, name: e.target.value } }))} />
              </div>
              <div className="field">
                <label>年齢</label>
                <input className="input" type="text" value={mem.profile.age}
                  onChange={(e) => update((m) => ({ ...m, profile: { ...m.profile, age: e.target.value } }))} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>職業</label>
                <input className="input" type="text" value={mem.profile.occupation}
                  onChange={(e) => update((m) => ({ ...m, profile: { ...m.profile, occupation: e.target.value } }))} />
              </div>
              <div className="field">
                <label>地域</label>
                <input className="input" type="text" value={mem.profile.location}
                  onChange={(e) => update((m) => ({ ...m, profile: { ...m.profile, location: e.target.value } }))} />
              </div>
            </div>
            <TagEditor
              label="性格 / 印象"
              values={mem.profile.personality}
              onChange={(next) => update((m) => ({ ...m, profile: { ...m.profile, personality: next } }))}
            />
            <TagEditor
              label="重要な発言 / キーフレーズ"
              values={mem.profile.keyPhrases}
              placeholder="本人が語った印象的な一言"
              onChange={(next) => update((m) => ({ ...m, profile: { ...m.profile, keyPhrases: next } }))}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h2>本のコンセプト</h2></div>
          <div className="panel-body">
            <div className="field">
              <label>本全体のテーマ</label>
              <input className="input" type="text" value={mem.bookConcept.mainTheme}
                onChange={(e) => update((m) => ({ ...m, bookConcept: { ...m.bookConcept, mainTheme: e.target.value } }))} />
            </div>
            <div className="field">
              <label>想定読者</label>
              <input className="input" type="text" value={mem.bookConcept.targetReader}
                onChange={(e) => update((m) => ({ ...m, bookConcept: { ...m.bookConcept, targetReader: e.target.value } }))} />
            </div>
            <div className="field">
              <label>文体・トーン</label>
              <input className="input" type="text" value={mem.bookConcept.tone}
                onChange={(e) => update((m) => ({ ...m, bookConcept: { ...m.bookConcept, tone: e.target.value } }))} />
            </div>
            <TagEditor
              label="避けたい表現"
              values={mem.bookConcept.avoidExpressions}
              onChange={(next) => update((m) => ({ ...m, bookConcept: { ...m.bookConcept, avoidExpressions: next } }))}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>年表</h2>
          <button
            className="btn sm"
            type="button"
            onClick={() =>
              update((m) => ({
                ...m,
                timeline: [...m.timeline, { period: "", event: "", notes: "" }],
              }))
            }
          >
            行を追加
          </button>
        </div>
        <div className="panel-body">
          {mem.timeline.length === 0 ? (
            <div className="empty-state">年表エントリがありません。</div>
          ) : (
            mem.timeline.map((row, i) => (
              <div
                key={i}
                className="field-row"
                style={{ gridTemplateColumns: "160px 1fr 1fr 36px", alignItems: "start" }}
              >
                <div className="field">
                  <label>時期</label>
                  <input className="input" type="text" value={row.period}
                    onChange={(e) => {
                      const next = [...mem.timeline];
                      next[i] = { ...row, period: e.target.value };
                      update((m) => ({ ...m, timeline: next }));
                    }} />
                </div>
                <div className="field">
                  <label>出来事</label>
                  <input className="input" type="text" value={row.event}
                    onChange={(e) => {
                      const next = [...mem.timeline];
                      next[i] = { ...row, event: e.target.value };
                      update((m) => ({ ...m, timeline: next }));
                    }} />
                </div>
                <div className="field">
                  <label>備考</label>
                  <input className="input" type="text" value={row.notes}
                    onChange={(e) => {
                      const next = [...mem.timeline];
                      next[i] = { ...row, notes: e.target.value };
                      update((m) => ({ ...m, timeline: next }));
                    }} />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() => {
                      const next = mem.timeline.filter((_, j) => j !== i);
                      update((m) => ({ ...m, timeline: next }));
                    }}
                  >×</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-header"><h2>確定済み事実</h2></div>
          <div className="panel-body">
            <TagEditor
              label="本文に書いてよい事実"
              values={mem.confirmedFacts}
              onChange={(next) => update((m) => ({ ...m, confirmedFacts: next }))}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>未確認情報</h2></div>
          <div className="panel-body">
            <TagEditor
              label="まだ裏取りができていない事項"
              values={mem.uncertainFacts}
              onChange={(next) => update((m) => ({ ...m, uncertainFacts: next }))}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>文体ルール</h2></div>
          <div className="panel-body">
            <TagEditor
              label="毎回守るルール"
              values={mem.styleRules}
              onChange={(next) => update((m) => ({ ...m, styleRules: next }))}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>各章の要約</h2></div>
          <div className="panel-body">
            {mem.chapterSummaries.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                本文を生成すると、各章のサマリがここに蓄積されていきます。
              </div>
            ) : (
              <ul className="list-block">
                {mem.chapterSummaries.map((c, i) => (
                  <li key={i}>
                    <strong>{c.chapterTitle}：</strong>
                    {c.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>選択中の構成案サマリ</h2></div>
        <div className="panel-body">
          {mem.selectedOutlineSummary ? (
            <div style={{ fontSize: 13 }}>{mem.selectedOutlineSummary}</div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              構成案画面で1案を選択すると、ここに自動で記録されます。
            </div>
          )}
        </div>
      </div>
    </>
  );
}
