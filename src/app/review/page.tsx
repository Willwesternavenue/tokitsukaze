"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadProject, setFindingDismissed } from "@/lib/storage";
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
  prevByAgent: Map<string, number>; // agent → 前回の指摘件数
  totalFindings: number;
  worst: Severity;
};

// エージェント×節の状態
type FindingStatus = "resolved" | "improved" | "open" | "clean";
function agentStatus(current: number, prev: number | undefined): FindingStatus {
  if (current === 0) return prev && prev > 0 ? "resolved" : "clean";
  if (prev != null && current < prev) return "improved";
  return "open";
}

function worstSeverity(findings: AgentFinding[]): Severity {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return null;
}

function severityBadgeClass(w: Severity): string {
  return w === "error" ? "danger" : w === "warning" ? "warn" : w === "info" ? "gray" : "success";
}

// 重要度Tier（トリアージ用のラベル）。内部の severity と1:1で対応
type Tier = "error" | "warning" | "info";
const TIER_LABEL: Record<Tier, string> = {
  error: "重大",
  warning: "要修正",
  info: "軽微",
};
const TIER_ORDER: Tier[] = ["error", "warning", "info"];

type FlatFinding = {
  id: string; // 安定ID（節key|agent|message|loc）: 無視の永続化に使う
  tier: Tier;
  message: string;
  loc?: string;
  agentLabel: string;
  chapterTitle: string;
  sectionTitle: string;
  chapterNumber: number;
};

export default function ReviewPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<string>("summary");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [triageFilter, setTriageFilter] = useState<Tier | "all">("all");

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const config = getGenreConfig(project?.genre);

  // 節ごとの診断エントリ (構成案の章順に整列)
  const sections: SectionEntry[] = useMemo(() => {
    if (!project) return [];
    const reports = project.sectionAgentReports ?? {};
    const prevReports = project.sectionAgentReportsPrev ?? {};
    const entries: SectionEntry[] = [];
    for (const [key, reps] of Object.entries(reports)) {
      if (!reps || reps.length === 0) continue;
      const [chapterId, sectionId] = key.split("::");
      const draft = project.generatedSections.find(
        (d) => d.chapterId === chapterId && d.sectionId === sectionId,
      );
      const chapter = project.selectedOutline?.chapters.find((c) => c.id === chapterId);
      const allFindings = reps.flatMap((r) => r.findings);
      const prevByAgent = new Map<string, number>();
      for (const pr of prevReports[key] ?? []) prevByAgent.set(pr.agent, pr.findings.length);
      entries.push({
        key,
        chapterTitle: draft?.chapterTitle ?? chapter?.title ?? chapterId,
        sectionTitle:
          draft?.sectionTitle ??
          chapter?.sections.find((s) => s.id === sectionId)?.title ??
          sectionId,
        chapterNumber: chapter?.chapterNumber ?? 0,
        reports: reps,
        prevByAgent,
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
          label: r.label || agentLabel(r.agent, project?.genre),
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
  }, [sections, project]);

  const totalFindings = useMemo(
    () => sections.reduce((sum, s) => sum + s.totalFindings, 0),
    [sections],
  );

  // 全指摘を重要度起点で平坦化（トリアージ用）
  const flatFindings: FlatFinding[] = useMemo(() => {
    const out: FlatFinding[] = [];
    for (const s of sections) {
      for (const r of s.reports) {
        for (const f of r.findings) {
          out.push({
            id: `${s.key}|${r.agent}|${f.message}|${f.loc ?? ""}`,
            tier: f.severity,
            message: f.message,
            loc: f.loc,
            agentLabel: r.label || agentLabel(r.agent, project?.genre),
            chapterTitle: s.chapterTitle,
            sectionTitle: s.sectionTitle,
            chapterNumber: s.chapterNumber,
          });
        }
      }
    }
    // 重大→要修正→軽微、同Tier内は章順
    out.sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
        a.chapterNumber - b.chapterNumber,
    );
    return out;
  }, [sections, project]);

  const dismissedSet = useMemo(
    () => new Set(project?.dismissedFindings ?? []),
    [project],
  );
  const activeFindings = useMemo(
    () => flatFindings.filter((f) => !dismissedSet.has(f.id)),
    [flatFindings, dismissedSet],
  );
  const dismissedFindings = useMemo(
    () => flatFindings.filter((f) => dismissedSet.has(f.id)),
    [flatFindings, dismissedSet],
  );

  // Tier別件数は「無視していない指摘」で数える
  const tierCounts = useMemo(() => {
    const c: Record<Tier, number> = { error: 0, warning: 0, info: 0 };
    for (const f of activeFindings) c[f.tier] += 1;
    return c;
  }, [activeFindings]);

  function dismiss(id: string, on: boolean) {
    setProject(setFindingDismissed(id, on));
  }

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
            <button
              type="button"
              className={`review-tab ${activeTab === "__triage__" ? "active" : ""}`}
              onClick={() => setActiveTab("__triage__")}
              title="重要度順に横断表示（重大から対応）"
            >
              <span className="review-tab-dot sev-error" />
              重要度順
              <span className="review-tab-count">{tierCounts.error}</span>
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
                          {s.reports.map((r) => {
                            const prev = s.prevByAgent.get(r.agent);
                            const status = agentStatus(r.findings.length, prev);
                            return (
                            <div key={r.agent} className="agent-detail-card">
                              <div className="agent-detail-header">
                                <button
                                  type="button"
                                  className="link-like"
                                  onClick={() => setActiveTab(r.agent)}
                                  title="このエージェントのタブへ"
                                >
                                  {r.label || agentLabel(r.agent, project?.genre)}
                                </button>
                                <StatusBadge status={status} current={r.findings.length} prev={prev} parseFailed={r.meta.parseFailed} />
                              </div>
                              <ul className="list-block">
                                {r.findings.length === 0 && !r.meta.parseFailed ? (
                                  <li className="muted" style={{ fontSize: 11 }}>
                                    {status === "resolved" ? "前回の指摘は解決されました。" : "指摘なし"}
                                  </li>
                                ) : null}
                                {r.findings.map((f, i) => (
                                  <li key={i} className={`finding severity-${f.severity}`}>
                                    <div className="finding-message">{f.message}</div>
                                    {f.loc ? <div className="finding-loc">「{f.loc}」</div> : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* 重要度トリアージタブ */}
          {activeTab === "__triage__" ? (
            <div className="panel">
              <div className="panel-header">
                <h2>重要度順トリアージ</h2>
                <span className="hint">重大なものから優先的に対応できます</span>
              </div>
              <div className="panel-body dense">
                <div className="triage-filter">
                  <button
                    type="button"
                    className={`triage-chip ${triageFilter === "all" ? "active" : ""}`}
                    onClick={() => setTriageFilter("all")}
                  >
                    すべて {activeFindings.length}
                  </button>
                  {TIER_ORDER.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`triage-chip ${severityBadgeClass(t)} ${triageFilter === t ? "active" : ""}`}
                      onClick={() => setTriageFilter(t)}
                    >
                      {TIER_LABEL[t]} {tierCounts[t]}
                    </button>
                  ))}
                </div>
                {(() => {
                  const list = activeFindings.filter(
                    (f) => triageFilter === "all" || f.tier === triageFilter,
                  );
                  if (list.length === 0) {
                    return (
                      <div className="empty-state">
                        {triageFilter === "all"
                          ? "対応が必要な指摘はありません。"
                          : `「${TIER_LABEL[triageFilter as Tier]}」の指摘はありません。`}
                      </div>
                    );
                  }
                  return (
                    <ul className="list-block">
                      {list.map((f) => (
                        <li key={f.id} className={`triage-item finding severity-${f.tier}`}>
                          <span className={`badge ${severityBadgeClass(f.tier)}`}>{TIER_LABEL[f.tier]}</span>
                          <div style={{ flex: 1 }}>
                            <div className="finding-message">{f.message}</div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {f.agentLabel} ・ {f.chapterTitle} ／ {f.sectionTitle}
                              {f.loc ? <span>　「{f.loc}」</span> : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn sm ghost"
                            title="この指摘を対応不要にする（トリアージから外す）"
                            onClick={() => dismiss(f.id, true)}
                          >
                            対応不要
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()}

                {dismissedFindings.length > 0 ? (
                  <details className="dismissed-block" style={{ marginTop: 12 }}>
                    <summary>無視した指摘（{dismissedFindings.length}）</summary>
                    <ul className="list-block" style={{ marginTop: 8 }}>
                      {dismissedFindings.map((f) => (
                        <li key={f.id} className="triage-item" style={{ opacity: 0.7 }}>
                          <span className="badge gray">{TIER_LABEL[f.tier]}</span>
                          <div style={{ flex: 1 }}>
                            <div className="finding-message">{f.message}</div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {f.agentLabel} ・ {f.chapterTitle} ／ {f.sectionTitle}
                            </div>
                          </div>
                          <button type="button" className="btn sm" onClick={() => dismiss(f.id, false)}>
                            戻す
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
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
  // このエージェントの結果を、指摘あり / 解決済み / 指摘なし に仕分け
  const withFindings: { entry: SectionEntry; report: AgentReportSummary }[] = [];
  const resolved: SectionEntry[] = [];
  let cleanCount = 0;
  let parseFailedCount = 0;
  for (const s of sections) {
    const r = s.reports.find((rr) => rr.agent === agent);
    if (!r) continue;
    if (r.meta.parseFailed) {
      parseFailedCount += 1;
      continue;
    }
    if (r.findings.length > 0) {
      withFindings.push({ entry: s, report: r });
    } else {
      const prev = s.prevByAgent.get(agent);
      if (prev && prev > 0) resolved.push(s);
      else cleanCount += 1;
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{label}</h2>
        <span className="hint">
          指摘あり {withFindings.length} 節 / 解決済み {resolved.length} 節 / 指摘なし {cleanCount} 節
          {parseFailedCount ? ` / 応答エラー ${parseFailedCount} 節` : ""}
        </span>
      </div>
      <div className="panel-body dense">
        {withFindings.length === 0 && resolved.length === 0 ? (
          <div className="empty-state">
            {label} の指摘はありません。診断済みの節はすべて問題なしと判定されています。
          </div>
        ) : (
          <>
            {withFindings.map(({ entry, report }) => {
              const prev = entry.prevByAgent.get(agent);
              const improved = prev != null && report.findings.length < prev;
              return (
                <div key={entry.key} className="agent-tab-section">
                  <div className="agent-tab-section-head">
                    <span className={`badge ${severityBadgeClass(worstSeverity(report.findings))}`}>
                      {report.findings.length} 件
                    </span>
                    {improved ? (
                      <span className="badge warn" style={{ fontSize: 10 }}>改善 {prev}→{report.findings.length}</span>
                    ) : null}
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
              );
            })}
            {resolved.length > 0 ? (
              <div style={{ marginTop: withFindings.length ? 12 : 0 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>再生成で解決した節</div>
                {resolved.map((entry) => (
                  <div key={entry.key} className="agent-tab-section">
                    <div className="agent-tab-section-head">
                      <span className="badge success" style={{ fontSize: 10 }}>解決済み</span>
                      <span className="review-section-title">
                        {entry.chapterTitle} ／ {entry.sectionTitle}
                      </span>
                      <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
                        前回 {entry.prevByAgent.get(agent)} 件 → 0 件
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  current,
  prev,
  parseFailed,
}: {
  status: FindingStatus;
  current: number;
  prev: number | undefined;
  parseFailed?: boolean;
}) {
  if (parseFailed) return <span className="badge gray" style={{ fontSize: 10 }}>応答エラー</span>;
  if (status === "resolved") return <span className="badge success" style={{ fontSize: 10 }}>解決済み</span>;
  if (status === "improved")
    return <span className="badge warn" style={{ fontSize: 10 }}>改善 {prev}→{current}件</span>;
  if (status === "clean") return <span className="muted" style={{ fontSize: 11 }}>指摘なし</span>;
  return (
    <span className="muted" style={{ fontSize: 11 }}>
      {current}件{prev != null && current > prev ? `（前回${prev}）` : ""}
    </span>
  );
}

function mergeWorst(a: Severity, b: Severity): Severity {
  const rank = (s: Severity) => (s === "error" ? 3 : s === "warning" ? 2 : s === "info" ? 1 : 0);
  return rank(a) >= rank(b) ? a : b;
}
