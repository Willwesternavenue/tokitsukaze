"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadProject } from "@/lib/storage";
import { getGenreConfig } from "@/lib/genreConfig";
import { agentLabel } from "@/lib/staffRegistry";
import type { AgentFinding, AgentReportSummary, Project } from "@/lib/types";

type SectionEntry = {
  key: string; // chapterId::sectionId
  chapterTitle: string;
  sectionTitle: string;
  chapterNumber: number;
  reports: AgentReportSummary[];
  totalFindings: number;
  worst: "error" | "warning" | "info" | null;
};

function worstSeverity(findings: AgentFinding[]): SectionEntry["worst"] {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return null;
}

export default function ReviewPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const config = getGenreConfig(project?.genre);

  // 節ごとの診断エントリを構築 (構成案の章順に整列)
  const sections: SectionEntry[] = useMemo(() => {
    if (!project) return [];
    const reports = project.sectionAgentReports ?? {};
    const entries: SectionEntry[] = [];
    for (const [key, reps] of Object.entries(reports)) {
      if (!reps || reps.length === 0) continue;
      const [chapterId, sectionId] = key.split("::");
      const draft = project.generatedSections.find(
        (d) => d.chapterId === chapterId && d.sectionId === sectionId,
      );
      const chapter = project.selectedOutline?.chapters.find((c) => c.id === chapterId);
      const allFindings = reps.flatMap((r) => r.findings);
      entries.push({
        key,
        chapterTitle: draft?.chapterTitle ?? chapter?.title ?? chapterId,
        sectionTitle:
          draft?.sectionTitle ??
          chapter?.sections.find((s) => s.id === sectionId)?.title ??
          sectionId,
        chapterNumber: chapter?.chapterNumber ?? 0,
        reports: reps,
        totalFindings: allFindings.length,
        worst: worstSeverity(allFindings),
      });
    }
    entries.sort((a, b) => a.chapterNumber - b.chapterNumber);
    return entries;
  }, [project]);

  // エージェント別の全体集計
  const agentTotals = useMemo(() => {
    const m = new Map<string, { label: string; count: number; sections: number }>();
    for (const s of sections) {
      for (const r of s.reports) {
        const cur = m.get(r.agent) ?? { label: r.label || agentLabel(r.agent), count: 0, sections: 0 };
        cur.count += r.findings.length;
        cur.sections += 1;
        m.set(r.agent, cur);
      }
    }
    return Array.from(m.entries()).map(([agent, v]) => ({ agent, ...v }));
  }, [sections]);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>レビュー</h1>
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
          <h1>{config.stages.review.pageTitle}</h1>
          <p className="subtitle">{config.stages.review.description}</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" disabled title="P6 で対応予定">
            全体レビューを実行（準備中）
          </button>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="empty-state">
          まだ診断結果がありません。執筆画面で本文を生成すると、AI編集部の診断結果がここに集まります。
          <div style={{ marginTop: 12 }}>
            <Link href="/writer" className="btn primary">
              執筆画面へ
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-header">
              <h2>エージェント別サマリ</h2>
              <span className="hint">診断済み {sections.length} 節</span>
            </div>
            <div className="panel-body dense">
              <div className="agent-badge-row">
                {agentTotals.map((a) => (
                  <span
                    key={a.agent}
                    className={`badge ${a.count > 0 ? "warn" : "success"}`}
                    title={`${a.sections} 節で実行`}
                  >
                    {a.label} · {a.count} 件
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>節ごとの診断</h2>
              <span className="hint">クリックで詳細</span>
            </div>
            <div className="panel-body dense">
              {sections.map((s) => {
                const expanded = expandedKey === s.key;
                return (
                  <div key={s.key} className="review-section-row">
                    <button
                      type="button"
                      className="review-section-head"
                      onClick={() => setExpandedKey(expanded ? null : s.key)}
                    >
                      <span
                        className={`badge ${
                          s.worst === "error"
                            ? "danger"
                            : s.worst === "warning"
                              ? "warn"
                              : s.worst === "info"
                                ? "gray"
                                : "success"
                        }`}
                      >
                        {s.totalFindings} 件
                      </span>
                      <span className="review-section-title">
                        {s.chapterTitle} ／ {s.sectionTitle}
                      </span>
                      <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>
                        {expanded ? "▲" : "▼"}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="grid grid-2" style={{ marginTop: 10 }}>
                        {s.reports.map((r) => (
                          <div key={r.agent} className="agent-detail-card">
                            <div className="agent-detail-header">
                              <strong>{r.label || agentLabel(r.agent)}</strong>
                              <span className="muted" style={{ fontSize: 11 }}>
                                {r.meta.parseFailed ? "AI応答をパースできず" : `${r.findings.length}件`}
                              </span>
                            </div>
                            <ul className="list-block">
                              {r.findings.length === 0 && !r.meta.parseFailed ? (
                                <li className="muted" style={{ fontSize: 11 }}>指摘なし</li>
                              ) : null}
                              {r.findings.map((f, i) => (
                                <li key={i} className={`finding severity-${f.severity}`}>
                                  <div className="finding-message">{f.message}</div>
                                  {f.loc ? <div className="finding-loc">「{f.loc}」</div> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>今後のレビュー機能</h2>
            </div>
            <div className="panel-body dense">
              <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text-soft)", fontSize: 12 }}>
                <li>章確定時の通しレビュー（章全体の整合性・キャラアーク・伏線回収）</li>
                <li>全巻レビュー（本一冊を通した矛盾・文体・読者体験の総点検）</li>
                <li>ジャンル別専門チェック（出典チェック / 簡易査読 / SEO / プライバシーリスク）</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}
