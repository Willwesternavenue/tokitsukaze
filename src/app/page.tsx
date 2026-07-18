"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadProject,
  saveProject,
  resetProject,
  updateProject,
} from "@/lib/storage";
import {
  getGenreConfig,
  allGenres,
  MEDIA_TYPE_OPTIONS,
  NEWS_TYPE_OPTIONS,
  LANGUAGE_OPTIONS,
  WORK_TYPE_OPTIONS,
  PAPER_TYPE_OPTIONS,
  PAPER_STYLE_OPTIONS,
} from "@/lib/genreConfig";
import type {
  LangCode,
  NewsType,
  Project,
  ScreenplayMediaType,
  TranslationWorkType,
  PaperMeta,
  PaperType,
} from "@/lib/types";
import {
  buildTranslationOutline,
  splitIntoChapters,
  stripSourceText,
  type SourceChapter,
} from "@/lib/sourceSplit";

export default function InterviewNotesPage() {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // 翻訳書モード: 原文取り込み（原文はローカル state のみ。分割確定時に構成へ保存される）
  const [sourceText, setSourceText] = useState("");
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [chapterPreview, setChapterPreview] = useState<SourceChapter[] | null>(null);
  const [segmentChars, setSegmentChars] = useState(2000);

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

  function updatePaperField(patch: Partial<PaperMeta>) {
    setProject((prev) => {
      if (!prev) return prev;
      const merged: PaperMeta = {
        paperType: prev.paperMeta?.paperType ?? "empirical",
        field: prev.paperMeta?.field ?? "",
        researchQuestion: prev.paperMeta?.researchQuestion ?? "",
        contributions: prev.paperMeta?.contributions ?? "",
        venue: prev.paperMeta?.venue ?? "",
        keywords: prev.paperMeta?.keywords,
        ...patch,
      };
      const next = { ...prev, paperMeta: merged };
      saveProject(next);
      return next;
    });
  }

  function handleGenerateOutline() {
    if (!project) return;
    if (!project.interviewNotes.trim()) {
      setError("取材メモを入力してください。");
      return;
    }
    setError(null);
    setInfo(null);
    // 章立て生成の前に、AIが確認する事前ヒアリング画面へ
    router.push("/outline/interview");
  }

  function handleReset() {
    if (!confirm("現在のプロジェクトの取材メモ・構成案・本文を、サンプル状態に戻します。よろしいですか？\n（他のプロジェクトには影響しません。）")) return;
    const fresh = resetProject();
    setProject(fresh);
    setInfo("現在のプロジェクトをサンプル状態に戻しました。");
  }

  // ===== 翻訳書モード: 原文取り込み〜章分割 =====

  async function handleSourceFile(file: File) {
    setError(null);
    setInfo(null);
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-source", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.text) {
        throw new Error(data?.error ?? "テキスト抽出に失敗しました。");
      }
      setSourceText(data.text);
      setSourceFilename(data.filename ?? file.name);
      setChapterPreview(splitIntoChapters(data.text));
      setInfo(
        `「${file.name}」から ${Number(data.charCount ?? data.text.length).toLocaleString()} 文字を取り込みました。下の分割プレビューを確認して確定してください。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  function handleSplitPreview() {
    setError(null);
    if (!sourceText.trim()) {
      setError("原文テキストを貼り付けるか、ファイルを取り込んでください。");
      return;
    }
    setChapterPreview(splitIntoChapters(sourceText));
  }

  function handleConfirmSplit() {
    if (!project || !chapterPreview || chapterPreview.length === 0) return;
    if (
      project.generatedSections.length > 0 &&
      !confirm(
        "既に翻訳済みのセグメントがあります。章構成を作り直すと既存の訳文は破棄されます。続行しますか？",
      )
    ) {
      return;
    }
    const outline = buildTranslationOutline(chapterPreview, segmentChars);
    const totalChars = chapterPreview.reduce((a, c) => a + c.text.length, 0);
    const next = updateProject((p) => ({
      ...p,
      selectedOutline: outline,
      // /outline 画面の表示用には sourceText を落とした軽量コピーを置く（localStorage節約）
      outlineProposals: [stripSourceText(outline)],
      generatedSections: [],
      sectionAgentReports: {},
      sectionAgentReportsPrev: {},
      translationMeta: {
        sourceLang: p.translationMeta?.sourceLang ?? "en",
        targetLang: p.translationMeta?.targetLang ?? "ja",
        workType: p.translationMeta?.workType ?? "book",
        stylePolicy: p.translationMeta?.stylePolicy ?? "",
        sourceFilename: sourceFilename ?? undefined,
        sourceCharCount: totalChars,
      },
    }));
    setProject(next);
    router.push("/writer");
  }

  const config = getGenreConfig(project.genre);
  const isTranslation = project.genre === "translation";
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
          {!isTranslation ? (
            <button
              className="btn primary lg"
              onClick={handleGenerateOutline}
              type="button"
            >
              章立て案を生成する →
            </button>
          ) : null}
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
              {project.genre === "paper" ? (
                <>
                  <select
                    id="proj-tone"
                    className="input"
                    value={
                      PAPER_STYLE_OPTIONS.some((o) => o.value === project.desiredTone)
                        ? project.desiredTone
                        : project.desiredTone
                          ? "__custom__"
                          : ""
                    }
                    onChange={(e) => {
                      if (e.target.value === "__custom__") return; // 現在の自由記述を保持
                      updateField("desiredTone", e.target.value);
                    }}
                  >
                    {/* 既存の自由記述（他モードからの引き継ぎ等）があれば失わないよう温存 */}
                    {project.desiredTone &&
                    !PAPER_STYLE_OPTIONS.some((o) => o.value === project.desiredTone) ? (
                      <option value="__custom__">
                        現在の指定: {project.desiredTone.slice(0, 24)}
                        {project.desiredTone.length > 24 ? "…" : ""}
                      </option>
                    ) : null}
                    {PAPER_STYLE_OPTIONS.map((o) => (
                      <option key={o.label} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="help">
                    学術論文の文体はほぼ定型のため選択式です。想定投稿先・読者は下の「論文仕様」で別途指定できます。
                  </p>
                </>
              ) : (
                <input
                  id="proj-tone"
                  type="text"
                  className="input"
                  value={project.desiredTone}
                  onChange={(e) => updateField("desiredTone", e.target.value)}
                  placeholder="例：全体のトーン・語り口の希望（任意）"
                />
              )}
            </div>
          </div>
          {project.genre === "blog" ? (
            <div className="field-row">
              <div className="field">
                <label htmlFor="blog-keyword">対策キーワード</label>
                <input
                  id="blog-keyword"
                  type="text"
                  className="input"
                  value={project.blogMeta?.targetKeyword ?? ""}
                  onChange={(e) =>
                    updateField("blogMeta", {
                      targetKeyword: e.target.value,
                      secondaryKeywords: project.blogMeta?.secondaryKeywords ?? [],
                      searchIntent: project.blogMeta?.searchIntent ?? "",
                      persona: project.blogMeta?.persona ?? "",
                      metaDescription: project.blogMeta?.metaDescription ?? "",
                    })
                  }
                  placeholder="例：生成AI 議事録 自動化"
                />
                <p className="help">
                  検索意図・ペルソナは <Link href="/seo">キーワード・ペルソナ</Link> で詳しく設定できます。
                </p>
              </div>
              <div className="field">
                <label htmlFor="blog-intent">検索意図（簡易）</label>
                <input
                  id="blog-intent"
                  type="text"
                  className="input"
                  value={project.blogMeta?.searchIntent ?? ""}
                  onChange={(e) =>
                    updateField("blogMeta", {
                      targetKeyword: project.blogMeta?.targetKeyword ?? "",
                      secondaryKeywords: project.blogMeta?.secondaryKeywords ?? [],
                      searchIntent: e.target.value,
                      persona: project.blogMeta?.persona ?? "",
                      metaDescription: project.blogMeta?.metaDescription ?? "",
                    })
                  }
                  placeholder="読者がこの検索で本当に知りたいこと"
                />
              </div>
            </div>
          ) : null}
          {project.genre === "news" ? (
            <>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="news-type">記事種別</label>
                  <select
                    id="news-type"
                    className="input"
                    value={project.newsMeta?.newsType ?? "straight"}
                    onChange={(e) =>
                      updateField("newsMeta", {
                        outlet: project.newsMeta?.outlet ?? "",
                        newsType: e.target.value as NewsType,
                        angle: project.newsMeta?.angle ?? "",
                        audience: project.newsMeta?.audience ?? "",
                        headlineDraft: project.newsMeta?.headlineDraft ?? "",
                      })
                    }
                  >
                    {NEWS_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="help">記事種別で構成の規律（逆ピラミッド等）が切り替わります。</p>
                </div>
                <div className="field">
                  <label htmlFor="news-outlet">想定媒体</label>
                  <input
                    id="news-outlet"
                    type="text"
                    className="input"
                    value={project.newsMeta?.outlet ?? ""}
                    onChange={(e) =>
                      updateField("newsMeta", {
                        outlet: e.target.value,
                        newsType: project.newsMeta?.newsType ?? "straight",
                        angle: project.newsMeta?.angle ?? "",
                        audience: project.newsMeta?.audience ?? "",
                        headlineDraft: project.newsMeta?.headlineDraft ?? "",
                      })
                    }
                    placeholder="例：地方紙Web版 / 業界専門メディア"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="news-angle">切り口・アングル</label>
                  <input
                    id="news-angle"
                    type="text"
                    className="input"
                    value={project.newsMeta?.angle ?? ""}
                    onChange={(e) =>
                      updateField("newsMeta", {
                        outlet: project.newsMeta?.outlet ?? "",
                        newsType: project.newsMeta?.newsType ?? "straight",
                        angle: e.target.value,
                        audience: project.newsMeta?.audience ?? "",
                        headlineDraft: project.newsMeta?.headlineDraft ?? "",
                      })
                    }
                    placeholder="この記事は何のニュースか（例：市の新制度が中小企業に与える影響）"
                  />
                </div>
                <div className="field">
                  <label htmlFor="news-audience">想定読者</label>
                  <input
                    id="news-audience"
                    type="text"
                    className="input"
                    value={project.newsMeta?.audience ?? ""}
                    onChange={(e) =>
                      updateField("newsMeta", {
                        outlet: project.newsMeta?.outlet ?? "",
                        newsType: project.newsMeta?.newsType ?? "straight",
                        angle: project.newsMeta?.angle ?? "",
                        audience: e.target.value,
                        headlineDraft: project.newsMeta?.headlineDraft ?? "",
                      })
                    }
                    placeholder="例：地域の中小企業経営者"
                  />
                </div>
              </div>
            </>
          ) : null}
          {project.genre === "paper" ? (
            <>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="paper-type">論文種別</label>
                  <select
                    id="paper-type"
                    className="input"
                    value={project.paperMeta?.paperType ?? "empirical"}
                    onChange={(e) => updatePaperField({ paperType: e.target.value as PaperType })}
                  >
                    {PAPER_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="help">
                    種別で構成の流儀が切り替わります（AI・情報系＝序論→関連研究→提案手法→実験）。
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="paper-field">分野</label>
                  <input
                    id="paper-field"
                    type="text"
                    className="input"
                    value={project.paperMeta?.field ?? ""}
                    onChange={(e) => updatePaperField({ field: e.target.value })}
                    placeholder="例：教育学 / 自然言語処理"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="paper-rq">リサーチクエスチョン・仮説</label>
                  <input
                    id="paper-rq"
                    type="text"
                    className="input"
                    value={project.paperMeta?.researchQuestion ?? ""}
                    onChange={(e) => updatePaperField({ researchQuestion: e.target.value })}
                    placeholder="この研究で何を明らかにするか"
                  />
                </div>
                <div className="field">
                  <label htmlFor="paper-contrib">主張したい貢献・新規性</label>
                  <input
                    id="paper-contrib"
                    type="text"
                    className="input"
                    value={project.paperMeta?.contributions ?? ""}
                    onChange={(e) => updatePaperField({ contributions: e.target.value })}
                    placeholder="先行研究に対して何が新しいか"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="paper-venue">想定投稿先・読者</label>
                  <input
                    id="paper-venue"
                    type="text"
                    className="input"
                    value={project.paperMeta?.venue ?? ""}
                    onChange={(e) => updatePaperField({ venue: e.target.value })}
                    placeholder="例：紀要 / 学会誌 / 一般向け学術書"
                  />
                  <p className="help">
                    投稿先で文体・構成の書き分けが変わります。参考文献は{" "}
                    <Link href="/references">参考文献・用語集</Link> で登録すると引用と出典チェックに使われます。
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="paper-keywords">キーワード（任意）</label>
                  <input
                    id="paper-keywords"
                    type="text"
                    className="input"
                    value={project.paperMeta?.keywords ?? ""}
                    onChange={(e) => updatePaperField({ keywords: e.target.value })}
                    placeholder="例：大規模言語モデル, 教育評価, 自動採点"
                  />
                </div>
              </div>
            </>
          ) : null}
          {isTranslation ? (
            <>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="tr-source-lang">原文の言語</label>
                  <select
                    id="tr-source-lang"
                    className="input"
                    value={project.translationMeta?.sourceLang ?? "en"}
                    onChange={(e) => {
                      const sourceLang = e.target.value as LangCode;
                      updateField("translationMeta", {
                        sourceLang,
                        // 日⇄英の2言語のうちは反対側を自動で選ぶ
                        targetLang: sourceLang === "ja" ? "en" : "ja",
                        workType: project.translationMeta?.workType ?? "book",
                        stylePolicy: project.translationMeta?.stylePolicy ?? "",
                        sourceFilename: project.translationMeta?.sourceFilename,
                        sourceCharCount: project.translationMeta?.sourceCharCount,
                      });
                    }}
                  >
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="help">
                    訳文は{project.translationMeta?.sourceLang === "ja" ? "英語" : "日本語"}になります（他言語は今後追加予定）。
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="tr-work-type">原文の種別</label>
                  <select
                    id="tr-work-type"
                    className="input"
                    value={project.translationMeta?.workType ?? "book"}
                    onChange={(e) =>
                      updateField("translationMeta", {
                        sourceLang: project.translationMeta?.sourceLang ?? "en",
                        targetLang: project.translationMeta?.targetLang ?? "ja",
                        workType: e.target.value as TranslationWorkType,
                        stylePolicy: project.translationMeta?.stylePolicy ?? "",
                        sourceFilename: project.translationMeta?.sourceFilename,
                        sourceCharCount: project.translationMeta?.sourceCharCount,
                      })
                    }
                  >
                    {WORK_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="help">
                    論文=術語・引用・出典表記の保持、創作=声と文体の再現、など翻訳の規律が切り替わります。
                  </p>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="tr-style">文体方針（訳文）</label>
                  <input
                    id="tr-style"
                    type="text"
                    className="input"
                    value={project.translationMeta?.stylePolicy ?? ""}
                    onChange={(e) =>
                      updateField("translationMeta", {
                        sourceLang: project.translationMeta?.sourceLang ?? "en",
                        targetLang: project.translationMeta?.targetLang ?? "ja",
                        workType: project.translationMeta?.workType ?? "book",
                        stylePolicy: e.target.value,
                        sourceFilename: project.translationMeta?.sourceFilename,
                        sourceCharCount: project.translationMeta?.sourceCharCount,
                      })
                    }
                    placeholder="例：である調・直訳寄り / ですます調・読みやすさ優先 / 敬称は「〜さん」で統一"
                  />
                  <p className="help">
                    用語・固有名詞の訳語は <Link href="/terms">対訳表・用語</Link> で管理します。
                  </p>
                </div>
              </div>
            </>
          ) : null}
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

      {isTranslation ? (
        <>
          <div className="panel">
            <div className="panel-header">
              <h2>原文の取り込み</h2>
              <span className="hint">
                {project.translationMeta?.sourceFilename
                  ? `取り込み済み: ${project.translationMeta.sourceFilename}（${(project.translationMeta.sourceCharCount ?? 0).toLocaleString()} 字）`
                  : "Word / PDF / テキストに対応"}
              </span>
            </div>
            <div className="panel-body">
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="tr-file">ファイルから取り込む（.docx / .pdf / .txt / .md）</label>
                <input
                  id="tr-file"
                  type="file"
                  className="input"
                  accept=".docx,.pdf,.txt,.md"
                  disabled={extracting}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSourceFile(f);
                    e.target.value = "";
                  }}
                />
                {extracting ? (
                  <p className="help"><span className="spinner" /> テキストを抽出しています…</p>
                ) : (
                  <p className="help">
                    原文ファイルは保存されません（テキストのみ抽出します）。4MBを超えるPDFはアップロードに失敗する場合があります。
                  </p>
                )}
              </div>
              <div className="field" style={{ marginBottom: 4 }}>
                <label htmlFor="tr-source-text">またはテキストを貼り付け</label>
                <textarea
                  id="tr-source-text"
                  className="input mono"
                  rows={10}
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={labels.placeholder}
                />
                <div className="flex" style={{ marginTop: 8, alignItems: "center", gap: 10 }}>
                  <button className="btn primary" type="button" onClick={handleSplitPreview}>
                    章に分割する →
                  </button>
                  <span className="hint">{sourceText.length.toLocaleString()} 文字</span>
                </div>
                <p className="help">
                  原文テキストはこの画面では保存されません。「章に分割する」→「この分割で確定」で章・セグメントとしてプロジェクトに保存されます。
                </p>
              </div>
            </div>
          </div>

          {chapterPreview ? (
            <div className="panel">
              <div className="panel-header">
                <h2>章分割プレビュー（{chapterPreview.length} 章）</h2>
                <div className="row-actions" style={{ alignItems: "center", gap: 10 }}>
                  <label className="hint" htmlFor="tr-seg-size" style={{ whiteSpace: "nowrap" }}>
                    セグメント長
                  </label>
                  <select
                    id="tr-seg-size"
                    className="input"
                    style={{ width: "auto" }}
                    value={segmentChars}
                    onChange={(e) => setSegmentChars(Number(e.target.value))}
                  >
                    <option value={1200}>短め（約1,200字）</option>
                    <option value={2000}>標準（約2,000字）</option>
                    <option value={3000}>長め（約3,000字）</option>
                  </select>
                  <button className="btn primary" type="button" onClick={handleConfirmSplit}>
                    この分割で確定 → 翻訳へ
                  </button>
                </div>
              </div>
              <div className="panel-body dense">
                <ul className="list-block">
                  {chapterPreview.map((c, i) => (
                    <li key={i} className="flex" style={{ gap: 10, alignItems: "center" }}>
                      <span className="badge gray">第{i + 1}章</span>
                      <input
                        className="input"
                        type="text"
                        value={c.title}
                        onChange={(e) =>
                          setChapterPreview((prev) =>
                            prev ? prev.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)) : prev,
                          )
                        }
                        style={{ flex: 1 }}
                      />
                      <span className="hint" style={{ whiteSpace: "nowrap" }}>
                        {c.text.length.toLocaleString()} 字
                      </span>
                      <button
                        className="btn sm danger"
                        type="button"
                        title="この章を分割対象から外す"
                        onClick={() =>
                          setChapterPreview((prev) => (prev ? prev.filter((_, xi) => xi !== i) : prev))
                        }
                      >
                        除外
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="help" style={{ marginTop: 8 }}>
                  章タイトルは編集できます。目次・索引など翻訳不要な章は「除外」してください。
                  確定すると各章がセグメント（翻訳単位）に分割され、翻訳画面へ移動します。
                </p>
              </div>
            </div>
          ) : null}
        </>
      ) : (
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
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>次のステップ</h2>
        </div>
        <div className="panel-body dense">
          {isTranslation ? (
            <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-soft)", fontSize: 12 }}>
              <li>原文を取り込み「章に分割する」→ プレビューを確認して「この分割で確定」。</li>
              <li>翻訳画面でセグメントを選び「このセグメントを翻訳」。訳抜け・用語統一・表記揺れをAIが自動チェックします。</li>
              <li>対訳表・用語（ナレッジ）で訳語を確定すると、以降の翻訳とチェックに反映されます。対訳・差分ビューや一括置換も翻訳画面と対訳表画面から使えます。</li>
            </ol>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-soft)", fontSize: 12 }}>
              <li>「章立て案を生成する」を押すと、時系列型／テーマ型／人物伝型の3案を提示します。</li>
              <li>構成案画面で1案を選択すると、章ごとに小見出しが自動生成されます。</li>
              <li>原稿生成画面で小見出しをクリックすると、本文と編集メモがAIから返ります。</li>
            </ol>
          )}
        </div>
      </div>
    </>
  );
}
