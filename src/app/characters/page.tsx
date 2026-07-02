"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadProject, updateCharacters } from "@/lib/storage";
import { makeId } from "@/lib/ids";
import type { CharacterRole, NovelCharacter, Project } from "@/lib/types";

const ROLE_LABEL: Record<CharacterRole, string> = {
  protagonist: "主人公",
  antagonist: "敵役",
  supporting: "脇役",
  minor: "端役",
};

function emptyCharacter(name = "新しい登場人物"): NovelCharacter {
  return {
    id: makeId("char"),
    name,
    nameReadings: "",
    role: "supporting",
    profile: "",
    desire: "",
    need: "",
    wound: "",
    contradiction: "",
    voice: "",
    tabooWords: [],
    arc: { start: "", turningPoint: "", end: "" },
    notes: "",
  };
}

export default function CharactersPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const p = loadProject();
    setProject(p);
    setSelectedId(p.characters?.[0]?.id ?? null);
  }, []);

  const characters = project?.characters ?? [];
  const selected = useMemo(
    () => characters.find((c) => c.id === selectedId) ?? null,
    [characters, selectedId],
  );

  function persist(chars: NovelCharacter[]) {
    const next = updateCharacters(chars);
    setProject(next);
  }

  function handleAdd() {
    const nc = emptyCharacter();
    persist([...characters, nc]);
    setSelectedId(nc.id);
  }

  function handleDelete(id: string) {
    if (!confirm("この登場人物を削除します。よろしいですか？")) return;
    const remaining = characters.filter((c) => c.id !== id);
    persist(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setInfo("削除しました。");
  }

  function updateSelected<K extends keyof NovelCharacter>(key: K, value: NovelCharacter[K]) {
    if (!selectedId) return;
    persist(characters.map((c) => (c.id === selectedId ? { ...c, [key]: value } : c)));
    setInfo(null);
  }

  function updateArc<K extends keyof NonNullable<NovelCharacter["arc"]>>(key: K, value: string) {
    if (!selectedId) return;
    persist(
      characters.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              arc: {
                start: "",
                turningPoint: "",
                end: "",
                ...(c.arc ?? {}),
                [key]: value,
              } as NovelCharacter["arc"],
            }
          : c,
      ),
    );
  }

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>登場人物</h1>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (project.genre !== "novel") {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>登場人物</h1>
            <p className="subtitle">この画面は小説モードのプロジェクトでのみ使えます。</p>
          </div>
        </div>
        <div className="empty-state">
          現在のプロジェクトは「聞き書き」モードです。
          <div style={{ marginTop: 12 }}>
            <Link href="/" className="btn primary">
              取材メモへ戻る
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>登場人物</h1>
          <p className="subtitle">
            登場人物の欲望・傷・口調・アークを登録。本文生成と Character Voice エージェントに反映されます。
          </p>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={handleAdd}>
            ＋ 登場人物を追加
          </button>
        </div>
      </div>

      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="writer-shell">
        <aside className="panel">
          <div className="panel-header">
            <h2>一覧</h2>
            <span className="hint">{characters.length} 名</span>
          </div>
          <ul className="prompt-list">
            {characters.length === 0 ? (
              <li className="muted">まだ登場人物がいません。「＋登場人物を追加」から始めてください。</li>
            ) : null}
            {characters.map((c) => (
              <li
                key={c.id}
                className={c.id === selectedId ? "active" : ""}
                onClick={() => setSelectedId(c.id)}
              >
                <span className="pname">{c.name || "（無題）"}</span>
                <span className="pdesc">
                  {ROLE_LABEL[c.role]} / {c.desire || "欲望未設定"}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        <section>
          {!selected ? (
            <div className="empty-state">左の一覧から編集対象を選んでください。</div>
          ) : (
            <>
              <div className="panel">
                <div className="panel-header">
                  <h2>{selected.name || "（無題）"}</h2>
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() => handleDelete(selected.id)}
                  >
                    削除
                  </button>
                </div>
                <div className="panel-body">
                  <div className="field-row">
                    <div className="field">
                      <label>氏名</label>
                      <input
                        className="input"
                        type="text"
                        value={selected.name}
                        onChange={(e) => updateSelected("name", e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>読み</label>
                      <input
                        className="input"
                        type="text"
                        value={selected.nameReadings ?? ""}
                        onChange={(e) => updateSelected("nameReadings", e.target.value)}
                        placeholder="やまだ たろう"
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label>役割</label>
                    <select
                      className="input"
                      value={selected.role}
                      onChange={(e) => updateSelected("role", e.target.value as CharacterRole)}
                    >
                      <option value="protagonist">主人公 (protagonist)</option>
                      <option value="antagonist">敵役 (antagonist)</option>
                      <option value="supporting">脇役 (supporting)</option>
                      <option value="minor">端役 (minor)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>プロフィール</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={selected.profile}
                      onChange={(e) => updateSelected("profile", e.target.value)}
                      placeholder="年齢、職業、外見、家庭環境など"
                    />
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>キャラクターアーク</h2>
                  <span className="hint">「欲しいもの」と「本当に必要なもの」で駆動する</span>
                </div>
                <div className="panel-body">
                  <div className="field">
                    <label>desire — 表面的に欲しいもの（Want）</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.desire}
                      onChange={(e) => updateSelected("desire", e.target.value)}
                      placeholder="例：会社を大きくして、地元で認められたい"
                    />
                  </div>
                  <div className="field">
                    <label>need — 本当に必要なもの（Need）</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.need}
                      onChange={(e) => updateSelected("need", e.target.value)}
                      placeholder="例：父の期待から解放されて、自分の判断で生きること"
                    />
                  </div>
                  <div className="field">
                    <label>wound — 過去の傷</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.wound ?? ""}
                      onChange={(e) => updateSelected("wound", e.target.value)}
                      placeholder="例：父の期待に応えられなかった記憶"
                    />
                  </div>
                  <div className="field">
                    <label>contradiction — 矛盾・弱点</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.contradiction ?? ""}
                      onChange={(e) => updateSelected("contradiction", e.target.value)}
                      placeholder="例：慎重さゆえに決断が遅い"
                    />
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>voice — 口調・語尾</h2>
                </div>
                <div className="panel-body">
                  <div className="field">
                    <label>voice の特徴</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={selected.voice}
                      onChange={(e) => updateSelected("voice", e.target.value)}
                      placeholder="例：語尾は『〜だ』『〜だろう』寄り、比喩は使わず短文で言い切る。方言のなまりが薄く残る。"
                    />
                  </div>
                  <div className="field">
                    <label>tabooWords — この人物が絶対に言わない語（カンマ区切り）</label>
                    <input
                      className="input"
                      type="text"
                      value={(selected.tabooWords ?? []).join(", ")}
                      onChange={(e) =>
                        updateSelected(
                          "tabooWords",
                          e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        )
                      }
                      placeholder="例：とても、めっちゃ、まじで"
                    />
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>arc — 物語を通した変化</h2>
                </div>
                <div className="panel-body">
                  <div className="field">
                    <label>開始時の状態</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.arc?.start ?? ""}
                      onChange={(e) => updateArc("start", e.target.value)}
                      placeholder="例：家業を継ぐことに反発している"
                    />
                  </div>
                  <div className="field">
                    <label>転機（turning point）</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.arc?.turningPoint ?? ""}
                      onChange={(e) => updateArc("turningPoint", e.target.value)}
                      placeholder="例：父の突然の入院で、家業を引き受けざるを得なくなる"
                    />
                  </div>
                  <div className="field">
                    <label>終盤の状態</label>
                    <input
                      className="input"
                      type="text"
                      value={selected.arc?.end ?? ""}
                      onChange={(e) => updateArc("end", e.target.value)}
                      placeholder="例：地域に必要とされる存在としての誇りを持って続けている"
                    />
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>メモ</h2>
                </div>
                <div className="panel-body">
                  <div className="field">
                    <textarea
                      className="input"
                      rows={4}
                      value={selected.notes ?? ""}
                      onChange={(e) => updateSelected("notes", e.target.value)}
                      placeholder="編集メモ、参考資料、モデルなど"
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
