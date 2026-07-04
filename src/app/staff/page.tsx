"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadProject,
  loadPrompts,
  savePrompts,
  updateAgentToggle,
  updateAgentTogglesBulk,
} from "@/lib/storage";
import { defaultPrompts } from "@/lib/samples";
import {
  STAFF_GROUP_LABEL,
  plannedRiskStaff,
  staffRegistry,
  type StaffGroup,
  type StaffMeta,
} from "@/lib/staffRegistry";
import { getGenreConfig } from "@/lib/genreConfig";
import type { PromptTemplate, Project } from "@/lib/types";

const GROUP_ORDER: StaffGroup[] = ["planning", "writing", "review", "risk", "rulebook"];

export default function StaffPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [onlyCurrentGenre, setOnlyCurrentGenre] = useState(true);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
    setPrompts(loadPrompts());
  }, []);

  const genre = project?.genre ?? "biography";
  const genreConfig = getGenreConfig(genre);

  const visibleStaff = useMemo(() => {
    return staffRegistry.filter((s) => {
      if (!onlyCurrentGenre) return true;
      return s.genres === "common" || (Array.isArray(s.genres) && s.genres.includes(genre));
    });
  }, [onlyCurrentGenre, genre]);

  const grouped = useMemo(() => {
    const m = new Map<StaffGroup, StaffMeta[]>();
    for (const g of GROUP_ORDER) m.set(g, []);
    for (const s of visibleStaff) m.get(s.group)!.push(s);
    return m;
  }, [visibleStaff]);

  function promptOf(meta: StaffMeta): PromptTemplate | undefined {
    return prompts.find((p) => p.id === meta.promptId);
  }

  function updatePrompt<K extends keyof PromptTemplate>(
    promptId: string,
    key: K,
    value: PromptTemplate[K],
  ) {
    setPrompts((prev) => prev.map((p) => (p.id === promptId ? { ...p, [key]: value } : p)));
    setInfo(null);
  }

  function handleSave() {
    savePrompts(prompts);
    setInfo("保存しました。");
  }

  function handleResetOne(promptId: string) {
    if (!confirm("このスタッフのプロンプトを初期値に戻します。よろしいですか？")) return;
    const def = defaultPrompts.find((d) => d.id === promptId);
    if (!def) return;
    setPrompts((prev) => prev.map((p) => (p.id === promptId ? def : p)));
    setInfo("初期値に戻しました。「保存」で確定してください。");
  }

  function handleToggle(meta: StaffMeta, enabled: boolean) {
    if (!meta.agentKey) return;
    const next = updateAgentToggle(meta.agentKey, enabled);
    setProject(next);
  }

  function isEnabled(meta: StaffMeta): boolean {
    if (!meta.agentKey) return true;
    return project?.agentToggles?.[meta.agentKey] !== false;
  }

  // このプロジェクトで本文生成時に自動実行されるレビュアー（agentKey 持ち・現ジャンル対象）
  const autoReviewers = useMemo(
    () =>
      staffRegistry.filter(
        (s) =>
          s.agentKey &&
          (s.genres === "common" || (Array.isArray(s.genres) && s.genres.includes(genre))),
      ),
    [genre],
  );
  const activeReviewerCount = autoReviewers.filter((s) => isEnabled(s)).length;

  function setAllReviewers(enabled: boolean) {
    const patch: Record<string, boolean> = {};
    for (const s of autoReviewers) if (s.agentKey) patch[s.agentKey] = enabled;
    const next = updateAgentTogglesBulk(patch as any);
    setProject(next);
    setInfo(enabled ? "すべての自動レビュアーを有効にしました。" : "すべての自動レビュアーを無効にしました（トークン節約）。");
  }

  function genreBadge(meta: StaffMeta): JSX.Element {
    if (meta.genres === "common") return <span className="badge gray">共通</span>;
    return (
      <>
        {meta.genres.map((g) => (
          <span key={g} className="badge">{getGenreConfig(g).label}</span>
        ))}
      </>
    );
  }

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>AIスタッフ</h1>
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
          <h1>AIスタッフ</h1>
          <p className="subtitle">
            あなたのAI編集部。各スタッフの役割・実行タイミング・有効/無効を管理します。
            現在のプロジェクト: <strong>{genreConfig.label}</strong>モード
          </p>
        </div>
        <div className="actions">
          <label className="flex" style={{ fontSize: 12, color: "var(--text-soft)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlyCurrentGenre}
              onChange={(e) => setOnlyCurrentGenre(e.target.checked)}
            />
            このプロジェクトで使うスタッフのみ
          </label>
          <button className="btn primary" onClick={handleSave} type="button">
            保存
          </button>
        </div>
      </div>

      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      {GROUP_ORDER.map((group) => {
        const members = grouped.get(group) ?? [];
        const isRisk = group === "risk";
        if (members.length === 0 && !isRisk) return null;
        return (
          <div className="panel" key={group}>
            <div className="panel-header">
              <h2>{STAFF_GROUP_LABEL[group]}</h2>
              {group === "rulebook" ? (
                <span className="hint">実行されず、他のスタッフに自動注入されます</span>
              ) : group === "review" ? (
                <div className="flex" style={{ gap: 8 }}>
                  <button className="btn sm" type="button" onClick={() => setAllReviewers(true)}>すべて有効</button>
                  <button className="btn sm" type="button" onClick={() => setAllReviewers(false)}>すべて無効</button>
                </div>
              ) : null}
            </div>
            {group === "review" ? (
              <div className="panel-body" style={{ paddingBottom: 0 }}>
                <div className="alert info" style={{ marginBottom: 0 }}>
                  本文生成1回あたり、有効な自動レビュアー <strong>{activeReviewerCount}</strong> / {autoReviewers.length} 個が並列で走ります。
                  使わないレビュアーを無効にするとトークンを節約できます（設定はこのプロジェクトに保存されます）。
                </div>
              </div>
            ) : null}
            <div className="panel-body dense">
              {members.map((meta) => {
                const tpl = promptOf(meta);
                const expanded = expandedId === meta.promptId;
                const enabled = isEnabled(meta);
                return (
                  <div key={meta.promptId} className={`staff-row ${enabled ? "" : "disabled"}`}>
                    <div className="staff-row-main">
                      <div className="staff-row-title">
                        <strong>{meta.staffLabel}</strong>
                        {genreBadge(meta)}
                        {meta.kind === "rulebook" ? (
                          <span className="badge warn">注入</span>
                        ) : null}
                      </div>
                      <div className="staff-row-desc">{meta.description}</div>
                      <div className="staff-row-when">{meta.runsWhen}</div>
                    </div>
                    <div className="staff-row-actions">
                      {meta.agentKey ? (
                        <label className="staff-toggle" title="自動実行の有効/無効">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => handleToggle(meta, e.target.checked)}
                          />
                          <span>{enabled ? "有効" : "無効"}</span>
                        </label>
                      ) : null}
                      <button
                        className="btn sm"
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : meta.promptId)}
                      >
                        {expanded ? "閉じる" : "詳細"}
                      </button>
                    </div>

                    {expanded && tpl ? (
                      <div className="staff-detail">
                        <div className="field">
                          <label>用途説明</label>
                          <input
                            className="input"
                            type="text"
                            value={tpl.description}
                            onChange={(e) => updatePrompt(tpl.id, "description", e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>システムプロンプト</label>
                          <textarea
                            className="input mono"
                            rows={10}
                            value={tpl.systemPrompt}
                            onChange={(e) => updatePrompt(tpl.id, "systemPrompt", e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>ユーザープロンプトテンプレート</label>
                          <textarea
                            className="input mono"
                            rows={8}
                            value={tpl.userPromptTemplate}
                            onChange={(e) =>
                              updatePrompt(tpl.id, "userPromptTemplate", e.target.value)
                            }
                          />
                          <p className="help">
                            {"{{body}} / {{interviewNotes}} / {{chapterTitle}} などの差し込み変数を使えます。"}
                          </p>
                        </div>
                        <div className="field">
                          <label>出力フォーマット（JSONスキーマ）</label>
                          <textarea
                            className="input mono"
                            rows={6}
                            value={tpl.outputFormat}
                            onChange={(e) => updatePrompt(tpl.id, "outputFormat", e.target.value)}
                          />
                        </div>
                        <div className="flex end">
                          <button
                            className="btn sm"
                            type="button"
                            onClick={() => handleResetOne(tpl.id)}
                          >
                            初期値に戻す
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {expanded && !tpl ? (
                      <div className="staff-detail">
                        <div className="muted" style={{ fontSize: 12 }}>
                          プロンプトが見つかりません。「保存」で初期プロンプトが補完されます。
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {isRisk ? (
                <div className="staff-planned">
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    今後追加予定のスタッフ:
                  </div>
                  <div className="tag-list">
                    {plannedRiskStaff.map((p) => (
                      <span key={p.label} className="tag" title={p.genres}>
                        {p.label}
                        <span className="muted" style={{ marginLeft: 4, fontSize: 10 }}>
                          {p.genres}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
