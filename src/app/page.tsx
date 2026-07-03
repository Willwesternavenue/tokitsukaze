"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadProject,
  loadPrompts,
  saveProject,
  setOutlineProposals,
  resetProject,
} from "@/lib/storage";
import { postJson } from "@/lib/apiClient";
import {
  getGenreConfig,
  allGenres,
  MEDIA_TYPE_OPTIONS,
  buildScreenplayExtraContext,
} from "@/lib/genreConfig";
import type { OutlineProposal, Project, ScreenplayMediaType } from "@/lib/types";

export default function InterviewNotesPage() {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const charCount = useMemo(() => project?.interviewNotes.length ?? 0, [project]);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>取材メモ入力</h1>
            <p className="subtitle">取材で聞いた内容を貼り付け、章立て案を生成します。</p>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  function updateField<K extends keyof Project>(key: K, value: Project[K]) {
    setProject((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      saveProject(next);
      return next;
    });
  }

  async function handleGenerateOutline() {
    if (!project) return;
    if (!project.interviewNotes.trim()) {
      setError("取材メモを入力してください。");
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const prompts = loadPrompts();
      const promptTemplate = prompts.find((p) => p.id === config.pipelinePrompts.outline);
      const r = await postJson<{ proposals?: OutlineProposal[] }>("/api/generate-outline", {
        projectName: project.name,
        intervieweeName: project.intervieweeName,
        theme: project.theme,
        targetReader: project.targetReader,
        desiredTone: project.desiredTone,
        interviewNotes: project.interviewNotes,
        promptTemplate,
        extraContext: buildScreenplayExtraContext(project),
      });
      if (!r.ok) {
        setError(`AI生成に失敗しました。${r.error ?? ""}`);
        return;
      }
      const proposals: OutlineProposal[] = Array.isArray(r.data?.proposals)
        ? (r.data!.proposals as OutlineProposal[])
        : [];
      if (proposals.length === 0) {
        setError("AIが構成案を返しませんでした。プロンプトや入力内容を確認してください。");
        return;
      }
      const next = setOutlineProposals(proposals);
      setProject(next);
      router.push("/outline");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`AI生成に失敗しました。${msg}`);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    if (!confirm("現在のプロジェクトの取材メモ・構成案・本文を、サンプル状態に戻します。よろしいですか？\n（他のプロジェクトには影響しません。）")) return;
    const fresh = resetProject();
    setProject(fresh);
    setInfo("現在のプロジェクトをサンプル状態に戻しました。");
  }

  const config = getGenreConfig(project.genre);
  const labels = {
    h1: config.stages.material.pageTitle,
    subtitle: config.stages.material.description,
    panelTitle: config.material.panelTitle,
    placeholder: config.material.placeholder,
    help: config.material.help,
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{labels.h1}</h1>
          <p className="subtitle">{labels.subtitle}</p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={handleReset} type="button">
            このプロジェクトをサンプルに戻す
          </button>
          <button
            className="btn primary lg"
            onClick={handleGenerateOutline}
            disabled={loading}
            type="button"
          >
            {loading ? <span className="spinner" /> : null}
            {loading ? "構成案を生成中…" : "章立て案を生成する"}
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>プロジェクト基本情報</h2>
          <span className="hint">localStorageに自動保存されます</span>
        </div>
        <div className="panel-body">
          <div className="field-row">
            <div className="field">
              <label htmlFor="proj-name">プロジェクト名</label>
              <input
                id="proj-name"
                type="text"
                className="input"
                value={project.name}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="proj-genre">モード</label>
              <select
                id="proj-genre"
                className="input"
                value={project.genre ?? "biography"}
                onChange={(e) => updateField("genre", e.target.value as Project["genre"])}
              >
                {allGenres.map((g) => (
                  <option key={g.genre} value={g.genre}>
                    {g.label}
                  </option>
                ))}
              </select>
              <p className="help">
                モードによってワークフローのラベル・ナレッジ項目・自動実行されるAIスタッフが切り替わります。
              </p>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="proj-interviewee">{config.material.subjectLabel}</label>
              <input
                id="proj-interviewee"
                type="text"
                className="input"
                value={project.intervieweeName}
                onChange={(e) => updateField("intervieweeName", e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="proj-tone">文体の希望</label>
              <input
                id="proj-tone"
                type="text"
                className="input"
                value={project.desiredTone}
                onChange={(e) => updateField("desiredTone", e.target.value)}
                placeholder="例：落ち着いた人物伝風。誠実で読みやすい語り口。"
              />
            </div>
          </div>
          {project.genre === "screenplay" ? (
            <div className="field-row">
              <div className="field">
                <label htmlFor="proj-media">メディア種別</label>
                <select
                  id="proj-media"
                  className="input"
                  value={project.screenplayMeta?.mediaType ?? "film"}
                  onChange={(e) => {
                    const mediaType = e.target.value as ScreenplayMediaType;
                    const preset = MEDIA_TYPE_OPTIONS.find((o) => o.value === mediaType);
                    updateField("screenplayMeta", {
                      mediaType,
                      targetRuntimeMinutes:
                        project.screenplayMeta?.targetRuntimeMinutes && project.screenplayMeta.mediaType === mediaType
                          ? project.screenplayMeta.targetRuntimeMinutes
                          : preset?.defaultMinutes ?? 110,
                    });
                  }}
                >
                  {MEDIA_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="proj-runtime">目標尺（分）</label>
                <input
                  id="proj-runtime"
                  type="number"
                  className="input"
                  min={1}
                  value={project.screenplayMeta?.targetRuntimeMinutes ?? 110}
                  onChange={(e) =>
                    updateField("screenplayMeta", {
                      mediaType: project.screenplayMeta?.mediaType ?? "film",
                      targetRuntimeMinutes: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                />
                <p className="help">幕構成と各シーンの尺配分に反映されます。</p>
              </div>
            </div>
          ) : null}
          <div className="field-row">
            <div className="field">
              <label htmlFor="proj-theme">本にしたいテーマ</label>
              <input
                id="proj-theme"
                type="text"
                className="input"
                value={project.theme}
                onChange={(e) => updateField("theme", e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="proj-reader">想定読者</label>
              <input
                id="proj-reader"
                type="text"
                className="input"
                value={project.targetReader}
                onChange={(e) => updateField("targetReader", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>{labels.panelTitle}</h2>
          <span className={`hint ${charCount > 20000 ? "" : ""}`} style={{
            color: charCount > 40000 ? "var(--danger)" : charCount > 20000 ? "var(--warn)" : undefined,
            fontWeight: charCount > 20000 ? 600 : undefined,
          }}>
            {charCount.toLocaleString()} 文字
            {charCount > 40000 ? "（長すぎ：タイムアウトの可能性）" : charCount > 20000 ? "（推奨上限超え）" : ""}
          </span>
        </div>
        <div className="panel-body">
          <div className="field" style={{ marginBottom: 4 }}>
            <textarea
              className="input mono"
              rows={18}
              value={project.interviewNotes}
              onChange={(e) => updateField("interviewNotes", e.target.value)}
              placeholder={labels.placeholder}
            />
            <p className="help">{labels.help}</p>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>次のステップ</h2>
        </div>
        <div className="panel-body dense">
          <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-soft)", fontSize: 12 }}>
            <li>「章立て案を生成する」を押すと、時系列型／テーマ型／人物伝型の3案を提示します。</li>
            <li>構成案画面で1案を選択すると、章ごとに小見出しが自動生成されます。</li>
            <li>原稿生成画面で小見出しをクリックすると、本文と編集メモがAIから返ります。</li>
          </ol>
        </div>
      </div>
    </>
  );
}
