"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadProject, loadPrompts, setOutlineProposals } from "@/lib/storage";
import { postJson } from "@/lib/apiClient";
import { buildScreenplayExtraContext, getGenreConfig } from "@/lib/genreConfig";
import type { OutlineProposal, Project } from "@/lib/types";

export default function OutlineInterviewPage() {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [loadingQ, setLoadingQ] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = loadProject();
    setProject(p);
    if (!p.interviewNotes?.trim()) {
      setLoadingQ(false);
      return;
    }
    (async () => {
      try {
        const r = await postJson<{ questions?: string[] }>("/api/interview-questions", { project: p });
        if (!r.ok) throw new Error(r.error ?? "質問の生成に失敗しました。");
        const qs = r.data?.questions ?? [];
        setQuestions(qs);
        setAnswers(qs.map(() => ""));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingQ(false);
      }
    })();
  }, []);

  async function generate(withAnswers: boolean) {
    if (!project) return;
    setError(null);
    setGenerating(true);
    try {
      const config = getGenreConfig(project.genre);
      const prompts = loadPrompts();
      const promptTemplate = prompts.find((p) => p.id === config.pipelinePrompts.outline);

      // 回答を素材に足して渡す（プロジェクトには保存しない・章立て生成だけに使う）
      let notes = project.interviewNotes;
      if (withAnswers && questions) {
        const qa = questions
          .map((q, i) => ({ q, a: (answers[i] ?? "").trim() }))
          .filter((x) => x.a.length > 0)
          .map((x) => `Q. ${x.q}\nA. ${x.a}`)
          .join("\n\n");
        if (qa) notes = `${project.interviewNotes}\n\n【事前ヒアリングの補足】\n${qa}`;
      }

      const r = await postJson<{ proposals?: OutlineProposal[] }>("/api/generate-outline", {
        projectName: project.name,
        intervieweeName: project.intervieweeName,
        theme: project.theme,
        targetReader: project.targetReader,
        desiredTone: project.desiredTone,
        interviewNotes: notes,
        promptTemplate,
        extraContext: buildScreenplayExtraContext(project),
      });
      if (!r.ok) throw new Error(r.error ?? "構成案の生成に失敗しました。");
      const proposals = Array.isArray(r.data?.proposals) ? (r.data!.proposals as OutlineProposal[]) : [];
      if (proposals.length === 0) throw new Error("AIが構成案を返しませんでした。");
      setOutlineProposals(proposals);
      router.push("/outline");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  if (!project) {
    return (
      <>
        <div className="page-header"><div><h1>事前ヒアリング</h1></div></div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (!project.interviewNotes?.trim()) {
    return (
      <>
        <div className="page-header">
          <div><h1>事前ヒアリング</h1><p className="subtitle">素材が空です。</p></div>
        </div>
        <div className="empty-state">
          先に素材を入力してください。
          <div style={{ marginTop: 12 }}><Link href="/" className="btn primary">素材入力へ</Link></div>
        </div>
      </>
    );
  }

  const answeredCount = answers.filter((a) => a.trim().length > 0).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>事前ヒアリング</h1>
          <p className="subtitle">
            章立ての前に、AIがいくつか確認します。答えると構成の精度が上がり、後の調整が減ります。
            スキップ・「まだ決めていない」等の曖昧な回答でも構いません。
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/">素材へ戻る</Link>
          <button
            className="btn"
            onClick={() => generate(false)}
            disabled={generating || loadingQ}
            type="button"
            title="質問に答えずそのまま章立てを作る"
          >
            質問をスキップして生成
          </button>
          <button
            className="btn primary lg"
            onClick={() => generate(true)}
            disabled={generating || loadingQ}
            type="button"
          >
            {generating ? <span className="spinner" /> : null}
            {generating ? "章立てを生成中…" : `この回答で章立てを生成${answeredCount ? `（${answeredCount}件回答）` : ""}`}
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>AIからの質問</h2>
          {questions ? <span className="hint">{questions.length} 問 / 回答は任意</span> : null}
        </div>
        <div className="panel-body">
          {loadingQ ? (
            <div className="empty-state">
              <span className="spinner" style={{ marginRight: 8 }} />
              素材を読んで質問を準備しています…
            </div>
          ) : !questions || questions.length === 0 ? (
            <div className="empty-state">
              質問は生成されませんでした。このまま章立てを生成できます。
              <div style={{ marginTop: 12 }}>
                <button className="btn primary" type="button" onClick={() => generate(false)} disabled={generating}>
                  章立てを生成
                </button>
              </div>
            </div>
          ) : (
            questions.map((q, i) => (
              <div key={i} className="field" style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13 }}>
                  <span className="badge" style={{ marginRight: 6 }}>Q{i + 1}</span>
                  {q}
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={answers[i] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  placeholder="回答（任意・スキップ可・曖昧でも可）"
                />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
