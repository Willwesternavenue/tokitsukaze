"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadProject } from "@/lib/storage";
import { getGenreConfig } from "@/lib/genreConfig";
import { agentLabel } from "@/lib/staffRegistry";
import type { AgentFinding, AgentReportSummary, Project } from "@/lib/types";

type Severity = "error" | "warning" | "info" | null;

type SectionEntry = {
  key: string; // chapterId::sectionId
  chapterTitle: string;
  sectionTitle: string;
  chapterNumber: number;
  reports: AgentReportSummary[];
  totalFindings: number;
  worst: Severity;
};

function worstSeverity(findings: AgentFinding[]): Severity {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return null;
}

function severityBadgeClass(w: Severity): string {
  return w === "error" ? "danger" : w === "warning" ? "warn" : w === "info" ? "gray" : "success";
}

export default function ReviewPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<string>("summary");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const config = getGenreConfig(project?.genre);

  // 節ごとの診断エントリ (構成案の章順に整列)
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

  // エージェント別の集計（タブ生成に使う）
  const agentStats = useMemo(() => {
    const m = new Map<
      string,
      { agent: string; label: string; count: number; sections: number; worst: Severity }
    >();
    for (const s of sections) {
      for (const r of s.reports) {
        const cur = m.get(r.agent) ?? {
          agent: r.agent,
          label: r.label || agentLabel(r.agent),
          count: 0,
          sections: 0,
          worst: null as Severity,
        };
        cur.count += r.findings.length;
        cur.sections += 1;
        const w = worstSeverity(r.findings);
        cur.worst = mergeWorst(cur.worst, w);
        m.set(r.agent, cur);
      }
    }
    return Array.from(m.values());
  }, [sections]);

  const totalFindings = useMemo(
    () => sections.reduce((sum, s) => sum + s.totalFindings, 0),
    [sections],
  );

  if (!project) {
    return (
      <>
        <div className="page-header"><div><h1>レビュー</h1></div></div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  const activeAgent = agentStats.find((a) => a.agent === activeTab);

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
            <Link href="/writer" className="btn primary">執筆画面へ</Link>
          </div>
        </div>
      ) : (
        <>
          {/* タブバー */}
          <div className="review-tabs">
            <button
              type="button"
              className={`review-tab ${activeTab === "summary" ? "active" : ""}`}
              onClick={() => setActiveTab("summary")}
            >
              サマリ
              <span className="review-tab-count">{totalFindings}</span>
            </button>
            {agentStats.map((a) => (
              <button
                key={a.agent}
                type="button"
                className={`review-tab ${activeTab === a.agent ? "active" : ""}`}
                onClick={() => setActiveTab(a.agent)}
                title={`${a.sections} 節で実行`}
              >
                <span className={`review-tab-dot sev-${a.worst ?? "none"}`} />
                {a.label}
                <span className="review-tab-count">{a.count}</span>
              </button>
            ))}
          </div>

          {/* サマリタブ */}
          {activeTab === "summary" ? (
            <div className="panel">
              <div className="panel-header">
                <h2>節ごとの診断</h2>
                <span className="hint">診断済み {sections.length} 節 / 指摘 {totalFindings} 件 · クリックで詳細</span>
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
                        <span className={`badge ${severityBadgeClass(s.worst)}`}>{s.totalFindings} 件</span>
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
                                <button
                                  type="button"
                                  className="link-like"
                                  onClick={() => setActiveTab(r.agent)}
                                  title="このエージェントのタブへ"
                                >
                                  {r.label || agentLabel(r.agent)}
                                </button>
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
          ) : null}

          {/* エージェント別タブ */}
          {activeAgent ? (
            <AgentTabView agent={activeAgent.agent} label={activeAgent.label} sections={sections} />
          ) : null}
        </>
      )}
    </>
  );
}

function AgentTabView({
  agent,
  label,
  sections,
}: {
  agent: string;
  label: string;
  sections: SectionEntry[];
}) {
  // このエージェントが指摘を出した節だけを抽出
  const withFindings: { entry: SectionEntry; report: AgentReportSummary }[] = [];
  let cleanCount = 0;
  let parseFailedCount = 0;
  for (const s of sections) {
    const r = s.reports.find((rr) => rr.agent === agent);
    if (!r) continue;
    if (r.meta.parseFailed) parseFailedCount += 1;
    if (r.findings.length > 0) withFindings.push({ entry: s, report: r });
    else if (!r.meta.parseFailed) cleanCount += 1;
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{label}</h2>
        <span className="hint">
          指摘あり {withFindings.length} 節 / 指摘なし {cleanCount} 節
          {parseFailedCount ? ` / 応答エラー ${parseFailedCount} 節` : ""}
        </span>
      </div>
      <div className="panel-body dense">
        {withFindings.length === 0 ? (
          <div className="empty-state">
            {label} の指摘はありません。診断済みの節はすべて問題なしと判定されています。
          </div>
        ) : (
          withFindings.map(({ entry, report }) => (
            <div key={entry.key} className="agent-tab-section">
              <div className="agent-tab-section-head">
                <span className={`badge ${severityBadgeClass(worstSeverity(report.findings))}`}>
                  {report.findings.length} 件
                </span>
                <span className="review-section-title">
                  {entry.chapterTitle} ／ {entry.sectionTitle}
                </span>
              </div>
              <ul className="list-block">
                {report.findings.map((f, i) => (
                  <li key={i} className={`finding severity-${f.severity}`}>
                    <div className="finding-message">{f.message}</div>
                    {f.loc ? <div className="finding-loc">「{f.loc}」</div> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function mergeWorst(a: Severity, b: Severity): Severity {
  const rank = (s: Severity) => (s === "error" ? 3 : s === "warning" ? 2 : s === "info" ? 1 : 0);
  return rank(a) >= rank(b) ? a : b;
}
