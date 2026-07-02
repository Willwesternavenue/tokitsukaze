"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadProject, updateStoryBible } from "@/lib/storage";
import { postJson } from "@/lib/apiClient";
import { makeId } from "@/lib/ids";
import type {
  CharacterRelationship,
  CharacterRole,
  NovelCharacter,
  Project,
} from "@/lib/types";

// 役割ごとの配色 (業務アプリのパレットに合わせる)
const ROLE_COLOR: Record<CharacterRole, { fill: string; text: string; label: string }> = {
  protagonist: { fill: "#1F3A5F", text: "#FFFFFF", label: "主人公" },
  antagonist: { fill: "#B85042", text: "#FFFFFF", label: "敵役" },
  supporting: { fill: "#0E7C7B", text: "#FFFFFF", label: "脇役" },
  minor: { fill: "#7B8794", text: "#FFFFFF", label: "端役" },
};

const VIEW_W = 860;
const VIEW_H = 620;
const NODE_R = 46;

type Pos = { x: number; y: number };

/**
 * レイアウト: 主人公が1人いれば中央に固定し、残りを環状配置。
 * 主人公がいない/複数の場合は全員を環状配置。
 */
function layoutNodes(chars: NovelCharacter[]): Map<string, Pos> {
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const positions = new Map<string, Pos>();
  const protagonists = chars.filter((c) => c.role === "protagonist");
  const centerChar = protagonists.length === 1 && chars.length > 2 ? protagonists[0] : null;
  const ring = centerChar ? chars.filter((c) => c.id !== centerChar.id) : chars;

  if (centerChar) positions.set(centerChar.id, { x: cx, y: cy });

  const R = ring.length <= 4 ? 200 : ring.length <= 8 ? 235 : 255;
  ring.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / ring.length - Math.PI / 2;
    positions.set(c.id, {
      x: cx + R * Math.cos(angle),
      y: cy + (R * 0.82) * Math.sin(angle), // 少し楕円にして横長キャンバスに収める
    });
  });
  return positions;
}

export default function RelationsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const characters = useMemo(() => project?.characters ?? [], [project]);

  // 削除済み人物への参照を除外した有効な関係
  const relationships = useMemo(() => {
    const ids = new Set(characters.map((c) => c.id));
    return (project?.storyBible?.relationships ?? []).filter(
      (r) => ids.has(r.fromId) && ids.has(r.toId),
    );
  }, [project, characters]);

  const positions = useMemo(() => layoutNodes(characters), [characters]);

  // 同一ペア間の複数エッジをずらして描くためのグルーピング
  const edgeOffsets = useMemo(() => {
    const groups = new Map<string, CharacterRelationship[]>();
    for (const r of relationships) {
      const key = [r.fromId, r.toId].sort().join("|");
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    const offsets = new Map<string, number>();
    for (const arr of groups.values()) {
      arr.forEach((r, i) => {
        offsets.set(r.id, (i - (arr.length - 1) / 2) * 22);
      });
    }
    return offsets;
  }, [relationships]);

  function persistRelationships(next: CharacterRelationship[]) {
    if (!project) return;
    const updated = updateStoryBible({ ...project.storyBible, relationships: next });
    setProject(updated);
  }

  async function handleAiUpdate() {
    if (!project) return;
    setError(null);
    setInfo(null);
    setGenerating(true);
    try {
      const r = await postJson<{ relationships?: CharacterRelationship[] }>(
        "/api/generate-relations",
        { project },
      );
      if (!r.ok) throw new Error(r.error ?? "関係の抽出に失敗しました。");
      const aiRels = r.data?.relationships ?? [];
      // 手動分は保持し、AI 分のみ置き換える
      const manual = relationships.filter((x) => x.source === "manual");
      persistRelationships([...manual, ...aiRels]);
      setInfo(
        `AIが ${aiRels.length} 件の関係を抽出しました（手動登録 ${manual.length} 件は保持）。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  function handleAddManual() {
    if (characters.length < 2) return;
    const rel: CharacterRelationship = {
      id: makeId("rel"),
      fromId: characters[0].id,
      toId: characters[1].id,
      label: "関係",
      mutual: true,
      source: "manual",
    };
    persistRelationships([...relationships, rel]);
  }

  function handleUpdateRel(id: string, patch: Partial<CharacterRelationship>) {
    persistRelationships(
      relationships.map((r) =>
        // 手動で編集した AI 関係は manual に昇格し、次回の AI 更新で消えないようにする
        r.id === id ? { ...r, ...patch, source: "manual" } : r,
      ),
    );
  }

  function handleDeleteRel(id: string) {
    persistRelationships(relationships.filter((r) => r.id !== id));
  }

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>人物相関図</h1>
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
            <h1>人物相関図</h1>
            <p className="subtitle">この画面は小説モードのプロジェクトでのみ使えます。</p>
          </div>
        </div>
        <div className="empty-state">
          現在のプロジェクトは「聞き書き」モードです。
          <div style={{ marginTop: 12 }}>
            <Link href="/settings" className="btn primary">設定でモードを変更</Link>
          </div>
        </div>
      </>
    );
  }

  if (characters.length < 2) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>人物相関図</h1>
            <p className="subtitle">登場人物の関係を一覧し、執筆時の整合性の土台にします。</p>
          </div>
        </div>
        <div className="empty-state">
          相関図には登場人物が2名以上必要です（現在 {characters.length} 名）。
          <div style={{ marginTop: 12 }}>
            <Link href="/characters" className="btn primary">登場人物を登録する</Link>
          </div>
        </div>
      </>
    );
  }

  const connectedIds = new Set<string>();
  if (selectedNodeId) {
    connectedIds.add(selectedNodeId);
    for (const r of relationships) {
      if (r.fromId === selectedNodeId) connectedIds.add(r.toId);
      if (r.toId === selectedNodeId) connectedIds.add(r.fromId);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>人物相関図</h1>
          <p className="subtitle">
            登場人物の関係を俯瞰します。AIが素材・本文から関係を抽出し、手動での修正も反映されます。
          </p>
        </div>
        <div className="actions">
          <Link href="/characters" className="btn">登場人物を編集</Link>
          <button
            className="btn primary"
            type="button"
            onClick={handleAiUpdate}
            disabled={generating}
          >
            {generating ? <span className="spinner" /> : null}
            {generating ? "AIが関係を抽出中…" : "AIで相関図を更新"}
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>相関図</h2>
          <span className="hint">
            人物をクリックで関係をハイライト
            {selectedNodeId ? "（もう一度クリックで解除）" : ""}
          </span>
        </div>
        <div className="panel-body" style={{ padding: 8 }}>
          <div className="relations-legend">
            {(Object.keys(ROLE_COLOR) as CharacterRole[]).map((role) => (
              <span key={role} className="relations-legend-item">
                <span
                  className="relations-legend-dot"
                  style={{ background: ROLE_COLOR[role].fill }}
                />
                {ROLE_COLOR[role].label}
              </span>
            ))}
            <span className="relations-legend-item muted">
              ─ 相互 ／ → 一方向
            </span>
          </div>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
            onClick={() => setSelectedNodeId(null)}
          >
            <defs>
              <marker
                id="rel-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#52606D" />
              </marker>
            </defs>

            {/* エッジ */}
            {relationships.map((r) => {
              const from = positions.get(r.fromId);
              const to = positions.get(r.toId);
              if (!from || !to) return null;

              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / dist;
              const uy = dy / dist;
              // 垂直方向オフセット (同一ペア複数関係用)
              const off = edgeOffsets.get(r.id) ?? 0;
              const px = -uy * off;
              const py = ux * off;
              // ノード円の縁から縁まで
              const pad = r.mutual ? 4 : 10; // 矢印分の余白
              const x1 = from.x + ux * NODE_R + px;
              const y1 = from.y + uy * NODE_R + py;
              const x2 = to.x - ux * (NODE_R + pad) + px;
              const y2 = to.y - uy * (NODE_R + pad) + py;
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;

              const dimmed =
                selectedNodeId !== null &&
                r.fromId !== selectedNodeId &&
                r.toId !== selectedNodeId;

              return (
                <g key={r.id} opacity={dimmed ? 0.12 : 1}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#52606D"
                    strokeWidth={1.4}
                    markerEnd={r.mutual ? undefined : "url(#rel-arrow)"}
                  />
                  <text
                    x={mx}
                    y={my - 5}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill="#1F2933"
                    stroke="#FFFFFF"
                    strokeWidth={4}
                    paintOrder="stroke"
                  >
                    {r.label}
                    {r.notes ? <title>{r.notes}</title> : null}
                  </text>
                </g>
              );
            })}

            {/* ノード */}
            {characters.map((c) => {
              const pos = positions.get(c.id);
              if (!pos) return null;
              const color = ROLE_COLOR[c.role] ?? ROLE_COLOR.supporting;
              const dimmed = selectedNodeId !== null && !connectedIds.has(c.id);
              return (
                <g
                  key={c.id}
                  opacity={dimmed ? 0.25 : 1}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNodeId(selectedNodeId === c.id ? null : c.id);
                  }}
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={NODE_R}
                    fill={color.fill}
                    stroke={selectedNodeId === c.id ? "#1F2933" : "#FFFFFF"}
                    strokeWidth={selectedNodeId === c.id ? 3 : 2}
                  />
                  <text
                    x={pos.x}
                    y={pos.y - 2}
                    textAnchor="middle"
                    fontSize={c.name.length > 6 ? 11 : 13}
                    fontWeight={600}
                    fill={color.text}
                  >
                    {c.name.length > 8 ? `${c.name.slice(0, 8)}…` : c.name}
                  </text>
                  <text
                    x={pos.x}
                    y={pos.y + 15}
                    textAnchor="middle"
                    fontSize={9}
                    fill={color.text}
                    opacity={0.8}
                  >
                    {color.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>関係の編集</h2>
          <button className="btn sm" type="button" onClick={handleAddManual}>
            ＋ 関係を追加
          </button>
        </div>
        <div className="panel-body dense">
          {relationships.length === 0 ? (
            <div className="empty-state">
              まだ関係が登録されていません。「AIで相関図を更新」で自動抽出するか、「＋関係を追加」で手動登録してください。
            </div>
          ) : (
            relationships.map((r) => (
              <div key={r.id} className="relation-row">
                <select
                  className="input"
                  value={r.fromId}
                  onChange={(e) => handleUpdateRel(r.id, { fromId: e.target.value })}
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  className="input"
                  value={r.mutual ? "mutual" : "directed"}
                  onChange={(e) => handleUpdateRel(r.id, { mutual: e.target.value === "mutual" })}
                  title="相互 (─) か一方向 (→) か"
                >
                  <option value="mutual">─</option>
                  <option value="directed">→</option>
                </select>
                <select
                  className="input"
                  value={r.toId}
                  onChange={(e) => handleUpdateRel(r.id, { toId: e.target.value })}
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input
                  className="input"
                  type="text"
                  value={r.label}
                  onChange={(e) => handleUpdateRel(r.id, { label: e.target.value })}
                  placeholder="関係ラベル"
                />
                <input
                  className="input"
                  type="text"
                  value={r.notes ?? ""}
                  onChange={(e) => handleUpdateRel(r.id, { notes: e.target.value })}
                  placeholder="補足メモ"
                />
                <span className={`badge ${r.source === "ai" ? "gray" : ""}`}>
                  {r.source === "ai" ? "AI" : "手動"}
                </span>
                <button
                  className="btn danger sm"
                  type="button"
                  onClick={() => handleDeleteRel(r.id)}
                >
                  ×
                </button>
              </div>
            ))
          )}
          <p className="help" style={{ marginTop: 8 }}>
            「AIで相関図を更新」は AI 抽出分（AIバッジ）のみを置き換えます。手動で編集・追加した関係は保持されます。
          </p>
        </div>
      </div>
    </>
  );
}
