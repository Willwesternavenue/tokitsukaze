"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProject, updateStoryBible } from "@/lib/storage";
import { makeId } from "@/lib/ids";
import type {
  Foreshadow,
  Project,
  StoryBible,
  StoryLocation,
  TimelineEvent,
  WorldRule,
} from "@/lib/types";

function TagList({
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

export default function BiblePage() {
  const [project, setProject] = useState<Project | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  function persist(next: StoryBible) {
    const p = updateStoryBible(next);
    setProject(p);
    setInfo(null);
  }

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Story Bible</h1>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (!["novel", "screenplay"].includes(project.genre)) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Story Bible</h1>
            <p className="subtitle">この画面は小説・脚本モードのプロジェクトでのみ使えます。</p>
          </div>
        </div>
        <div className="empty-state">
          現在のプロジェクトのモードではこの画面は使いません。
          <div style={{ marginTop: 12 }}>
            <Link href="/settings" className="btn primary">
              設定でモードを変更
            </Link>
          </div>
        </div>
      </>
    );
  }

  const bible = project.storyBible;

  function addWorldRule() {
    const nr: WorldRule = { id: makeId("wr"), category: "", rule: "", exceptions: "" };
    persist({ ...bible, worldRules: [...bible.worldRules, nr] });
  }
  function updateWorldRule(id: string, patch: Partial<WorldRule>) {
    persist({
      ...bible,
      worldRules: bible.worldRules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }
  function removeWorldRule(id: string) {
    persist({ ...bible, worldRules: bible.worldRules.filter((r) => r.id !== id) });
  }

  function addTimeline() {
    const ne: TimelineEvent = {
      id: makeId("tl"),
      when: "",
      event: "",
      involvedCharacters: [],
      location: "",
    };
    persist({ ...bible, timelineEvents: [...bible.timelineEvents, ne] });
  }
  function updateTimeline(id: string, patch: Partial<TimelineEvent>) {
    persist({
      ...bible,
      timelineEvents: bible.timelineEvents.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }
  function removeTimeline(id: string) {
    persist({ ...bible, timelineEvents: bible.timelineEvents.filter((t) => t.id !== id) });
  }

  function addLocation() {
    const nl: StoryLocation = { id: makeId("loc"), name: "", description: "" };
    persist({ ...bible, locations: [...bible.locations, nl] });
  }
  function updateLocation(id: string, patch: Partial<StoryLocation>) {
    persist({
      ...bible,
      locations: bible.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  }
  function removeLocation(id: string) {
    persist({ ...bible, locations: bible.locations.filter((l) => l.id !== id) });
  }

  function addForeshadow() {
    const nf: Foreshadow = {
      id: makeId("fs"),
      content: "",
      plannedResolution: "",
      status: "seeded",
    };
    persist({ ...bible, foreshadowingItems: [...bible.foreshadowingItems, nf] });
  }
  function updateForeshadow(id: string, patch: Partial<Foreshadow>) {
    persist({
      ...bible,
      foreshadowingItems: bible.foreshadowingItems.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }
  function removeForeshadow(id: string) {
    persist({
      ...bible,
      foreshadowingItems: bible.foreshadowingItems.filter((f) => f.id !== id),
    });
  }

  const characters = project.characters ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Story Bible</h1>
          <p className="subtitle">
            世界ルール・年表・場所・伏線・継続性ファクト。本文生成時に AI へ渡され、Consistency と Character エージェントの参照元になります。
          </p>
        </div>
      </div>

      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>世界ルール（World Rules）</h2>
          <button className="btn sm" type="button" onClick={addWorldRule}>行を追加</button>
        </div>
        <div className="panel-body">
          {bible.worldRules.length === 0 ? (
            <div className="empty-state">「魔法は一日一回」等、破ってはいけない世界の制約を書きます。</div>
          ) : (
            bible.worldRules.map((r) => (
              <div
                key={r.id}
                className="field-row"
                style={{ gridTemplateColumns: "160px 1fr 1fr 36px", alignItems: "start" }}
              >
                <div className="field">
                  <label>カテゴリ</label>
                  <input
                    className="input"
                    type="text"
                    value={r.category}
                    onChange={(e) => updateWorldRule(r.id, { category: e.target.value })}
                    placeholder="魔法 / 地理 / 身分制度"
                  />
                </div>
                <div className="field">
                  <label>ルール</label>
                  <input
                    className="input"
                    type="text"
                    value={r.rule}
                    onChange={(e) => updateWorldRule(r.id, { rule: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>例外・備考</label>
                  <input
                    className="input"
                    type="text"
                    value={r.exceptions ?? ""}
                    onChange={(e) => updateWorldRule(r.id, { exceptions: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn danger sm" type="button" onClick={() => removeWorldRule(r.id)}>×</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>年表（Timeline）</h2>
          <button className="btn sm" type="button" onClick={addTimeline}>行を追加</button>
        </div>
        <div className="panel-body">
          {bible.timelineEvents.length === 0 ? (
            <div className="empty-state">「1985年春：帰郷」等、絶対に矛盾させたくないイベントを記録します。</div>
          ) : (
            bible.timelineEvents.map((t) => (
              <div
                key={t.id}
                className="field-row"
                style={{ gridTemplateColumns: "140px 1fr 1fr 140px 36px", alignItems: "start" }}
              >
                <div className="field">
                  <label>時期</label>
                  <input
                    className="input"
                    type="text"
                    value={t.when}
                    onChange={(e) => updateTimeline(t.id, { when: e.target.value })}
                    placeholder="1985年春"
                  />
                </div>
                <div className="field">
                  <label>出来事</label>
                  <input
                    className="input"
                    type="text"
                    value={t.event}
                    onChange={(e) => updateTimeline(t.id, { event: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>関わる人物（カンマ区切り）</label>
                  <input
                    className="input"
                    type="text"
                    value={t.involvedCharacters.join(", ")}
                    onChange={(e) =>
                      updateTimeline(t.id, {
                        involvedCharacters: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={characters.map((c) => c.name).join(", ") || "人物名"}
                  />
                </div>
                <div className="field">
                  <label>場所</label>
                  <input
                    className="input"
                    type="text"
                    value={t.location ?? ""}
                    onChange={(e) => updateTimeline(t.id, { location: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn danger sm" type="button" onClick={() => removeTimeline(t.id)}>×</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>場所（Locations）</h2>
          <button className="btn sm" type="button" onClick={addLocation}>行を追加</button>
        </div>
        <div className="panel-body">
          {bible.locations.length === 0 ? (
            <div className="empty-state">物語に登場する主要な場所を登録します。</div>
          ) : (
            bible.locations.map((l) => (
              <div
                key={l.id}
                className="field-row"
                style={{ gridTemplateColumns: "200px 1fr 36px", alignItems: "start" }}
              >
                <div className="field">
                  <label>場所名</label>
                  <input
                    className="input"
                    type="text"
                    value={l.name}
                    onChange={(e) => updateLocation(l.id, { name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>説明</label>
                  <input
                    className="input"
                    type="text"
                    value={l.description ?? ""}
                    onChange={(e) => updateLocation(l.id, { description: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn danger sm" type="button" onClick={() => removeLocation(l.id)}>×</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>伏線（Foreshadowing）</h2>
          <button className="btn sm" type="button" onClick={addForeshadow}>行を追加</button>
        </div>
        <div className="panel-body">
          {bible.foreshadowingItems.length === 0 ? (
            <div className="empty-state">仕込んだ伏線・回収予定・回収済みを一覧で管理します。</div>
          ) : (
            bible.foreshadowingItems.map((f) => (
              <div
                key={f.id}
                className="field-row"
                style={{ gridTemplateColumns: "1fr 1fr 120px 36px", alignItems: "start" }}
              >
                <div className="field">
                  <label>仕込み内容</label>
                  <input
                    className="input"
                    type="text"
                    value={f.content}
                    onChange={(e) => updateForeshadow(f.id, { content: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>回収予定</label>
                  <input
                    className="input"
                    type="text"
                    value={f.plannedResolution ?? ""}
                    onChange={(e) => updateForeshadow(f.id, { plannedResolution: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>状態</label>
                  <select
                    className="input"
                    value={f.status}
                    onChange={(e) =>
                      updateForeshadow(f.id, { status: e.target.value as Foreshadow["status"] })
                    }
                  >
                    <option value="seeded">seeded</option>
                    <option value="resolved">resolved</option>
                    <option value="unresolved">unresolved (要注意)</option>
                  </select>
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn danger sm" type="button" onClick={() => removeForeshadow(f.id)}>×</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-header"><h2>継続性ファクト（Continuity Facts）</h2></div>
          <div className="panel-body">
            <TagList
              label="細部で崩したくない事実"
              values={bible.continuityFacts}
              placeholder="例：主人公は左利き"
              onChange={(next) => persist({ ...bible, continuityFacts: next })}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>読者の未解決の疑問</h2></div>
          <div className="panel-body">
            <TagList
              label="現時点で読者が抱えているはずの疑問"
              values={bible.unresolvedQuestions}
              placeholder="例：主人公はなぜ帰郷を決意したのか"
              onChange={(next) => persist({ ...bible, unresolvedQuestions: next })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
