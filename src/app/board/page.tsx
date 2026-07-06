"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { saveAs } from "file-saver";
import { loadProject, moveSectionInChapter } from "@/lib/storage";
import {
  buildBreakdownCsv,
  buildFountain,
  characterStats,
  flattenScenes,
  measureRuntime,
  runtimeDeviation,
  todJa,
} from "@/lib/screenplay";
import type { Project } from "@/lib/types";

/**
 * 脚本モード: シーンボード（ハコ書きボード）・香盤表・キャラ出番分析。
 * すべて決定論的（AI不使用）で即時に再計算される。
 */
export default function BoardPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // フィルタ
  const [charFilter, setCharFilter] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [intExtFilter, setIntExtFilter] = useState("");
  const [todFilter, setTodFilter] = useState("");

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const scenes = useMemo(() => (project ? flattenScenes(project) : []), [project]);

  const runtimes = useMemo(
    () =>
      new Map(
        scenes
          .filter((s) => s.draft?.body)
          .map((s) => [s.section.id, measureRuntime(s.draft!.body)] as const),
      ),
    [scenes],
  );

  const allCharacters = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenes) for (const n of s.section.sceneMeta?.presentCharacters ?? []) set.add(n);
    for (const c of project?.characters ?? []) set.add(c.name);
    return [...set].sort();
  }, [scenes, project]);

  const allLocations = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenes) {
      const loc = s.section.sceneMeta?.location;
      if (loc) set.add(loc);
    }
    return [...set].sort();
  }, [scenes]);

  const stats = useMemo(() => (project ? characterStats(project) : []), [project]);

  const summary = useMemo(() => {
    let int = 0, ext = 0, both = 0, day = 0, night = 0, other = 0;
    let planned = 0, measured = 0, drafted = 0;
    for (const s of scenes) {
      const m = s.section.sceneMeta;
      if (m) {
        if (m.intExt === "INT") int++;
        else if (m.intExt === "EXT") ext++;
        else both++;
        if (m.timeOfDay === "DAY") day++;
        else if (m.timeOfDay === "NIGHT") night++;
        else other++;
        planned += m.estimatedMinutes ?? 0;
      }
      const rt = runtimes.get(s.section.id);
      if (rt) {
        measured += rt.estimatedMinutes;
        drafted++;
      }
    }
    return {
      total: scenes.length, int, ext, both, day, night, other,
      locations: allLocations.length,
      planned: Math.round(planned),
      measured: Math.round(measured * 10) / 10,
      drafted,
    };
  }, [scenes, runtimes, allLocations]);

  if (!project) {
    return (
      <>
        <div className="page-header"><div><h1>シーンボード・香盤表</h1></div></div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (project.genre !== "screenplay") {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>シーンボード・香盤表</h1>
            <p className="subtitle">この画面は脚本モードのプロジェクトでのみ使えます。</p>
          </div>
        </div>
        <div className="empty-state">
          プロジェクトのモードを「脚本」に切り替えると、シーンボード・香盤表・キャラ出番分析が使えます。
          <div style={{ marginTop: 12 }}>
            <Link href="/" className="btn primary">素材入力でモードを変更</Link>
          </div>
        </div>
      </>
    );
  }

  if (!project.selectedOutline) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>シーンボード・香盤表</h1>
            <p className="subtitle">構成（ハコ書き）がまだありません。</p>
          </div>
        </div>
        <div className="empty-state">
          先に構成案画面で幕構成を選び、シーンを展開してください。
          <div style={{ marginTop: 12 }}>
            <Link href="/outline" className="btn primary">構成案画面へ</Link>
          </div>
        </div>
      </>
    );
  }

  function handleMove(chapterId: string, sectionId: string, dir: -1 | 1) {
    const next = moveSectionInChapter(chapterId, sectionId, dir);
    setProject(next);
  }

  function handleExportCsv() {
    if (!project) return;
    const blob = new Blob([buildBreakdownCsv(project)], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `香盤表_${project.name}.csv`);
    setInfo("香盤表CSVを書き出しました。");
  }

  function handleExportFountain() {
    if (!project) return;
    const blob = new Blob([buildFountain(project)], { type: "text/plain;charset=utf-8" });
    saveAs(blob, `${project.name}.fountain`);
    setInfo("Fountain形式で書き出しました（Final Draft / Highland 等で読み込めます）。");
  }

  const matches = (s: (typeof scenes)[number]): boolean => {
    const m = s.section.sceneMeta;
    if (charFilter) {
      const inMeta = (m?.presentCharacters ?? []).includes(charFilter);
      if (!inMeta) return false;
    }
    if (locFilter && m?.location !== locFilter) return false;
    if (intExtFilter && m?.intExt !== intExtFilter) return false;
    if (todFilter && m?.timeOfDay !== todFilter) return false;
    return true;
  };

  const filtering = !!(charFilter || locFilter || intExtFilter || todFilter);
  const totalScenes = scenes.length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>シーンボード・香盤表</h1>
          <p className="subtitle">
            シーンカードの俯瞰・並べ替え・フィルタ、制作向けブレークダウン、キャラクターの出番分析。
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={handleExportCsv} type="button" title="制作向けのシーンブレークダウンをCSVで書き出す">
            香盤表CSVを出力
          </button>
          <button className="btn" onClick={handleExportFountain} type="button" title="Fountain形式（Final Draft / Highland 等の業界ツールで読み込み可能）">
            Fountainで出力
          </button>
        </div>
      </div>

      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>作品サマリ</h2>
          <span className="hint">執筆済み {summary.drafted} / {summary.total} シーン</span>
        </div>
        <div className="panel-body dense">
          <div className="agent-badge-row">
            <span className="badge gray">全 {summary.total} シーン</span>
            <span className="badge gray">INT {summary.int} / EXT {summary.ext}{summary.both > 0 ? ` / 両方 ${summary.both}` : ""}</span>
            <span className="badge gray">昼 {summary.day} / 夜 {summary.night}{summary.other > 0 ? ` / その他 ${summary.other}` : ""}</span>
            <span className="badge gray">ロケーション {summary.locations} 箇所</span>
            <span className="badge">想定尺 計 {summary.planned} 分{project.screenplayMeta ? ` / 目標 ${project.screenplayMeta.targetRuntimeMinutes} 分` : ""}</span>
            {summary.measured > 0 ? (
              <span className="badge success">実測尺 計 {summary.measured} 分（執筆済み分）</span>
            ) : null}
          </div>
          <p className="help" style={{ marginTop: 8 }}>
            実測尺は本文から機械換算した目安です（セリフ≈320字/分・ト書き≈450字/分）。
            香盤表CSVにはシーン別の想定尺・実測尺・登場人物が入ります。
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>シーンボード</h2>
          <div className="row-actions" style={{ gap: 8 }}>
            <select className="input" style={{ width: "auto" }} value={charFilter} onChange={(e) => setCharFilter(e.target.value)}>
              <option value="">全キャラクター</option>
              {allCharacters.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input" style={{ width: "auto" }} value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
              <option value="">全ロケーション</option>
              {allLocations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select className="input" style={{ width: "auto" }} value={intExtFilter} onChange={(e) => setIntExtFilter(e.target.value)}>
              <option value="">INT/EXT</option>
              <option value="INT">INT</option>
              <option value="EXT">EXT</option>
              <option value="INT/EXT">INT/EXT</option>
            </select>
            <select className="input" style={{ width: "auto" }} value={todFilter} onChange={(e) => setTodFilter(e.target.value)}>
              <option value="">全時間帯</option>
              <option value="DAY">昼</option>
              <option value="NIGHT">夜</option>
              <option value="DAWN">明け方</option>
              <option value="DUSK">夕</option>
              <option value="CONTINUOUS">続き</option>
            </select>
          </div>
        </div>
        <div className="panel-body dense">
          {filtering ? (
            <p className="help" style={{ marginBottom: 10 }}>
              フィルタ表示中（{scenes.filter(matches).length} / {totalScenes} シーン）。並べ替えボタンはフィルタ解除時に使えます。
            </p>
          ) : null}
          {project.selectedOutline.chapters.map((c) => {
            const visible = (c.sections ?? []).filter((s) =>
              matches({ chapterId: c.id, chapterTitle: c.title, chapterNumber: c.chapterNumber, section: s, draft: undefined }),
            );
            if (filtering && visible.length === 0) return null;
            return (
              <div key={c.id} style={{ marginBottom: 16 }}>
                <div className="chapter-title" style={{ marginBottom: 8 }}>
                  第{c.chapterNumber}幕　{c.title}
                </div>
                <div className="scene-card-grid">
                  {(c.sections ?? []).map((s, si) => {
                    if (filtering && !visible.some((v) => v.id === s.id)) return null;
                    const m = s.sceneMeta;
                    const rt = runtimes.get(s.id);
                    const dev = rt ? runtimeDeviation(rt.estimatedMinutes, m?.estimatedMinutes) : null;
                    return (
                      <div key={s.id} className="scene-card">
                        <div className="scene-card-head">
                          <span className="scene-card-slug">
                            {m ? `○ ${m.location}（${m.intExt}・${todJa(m.timeOfDay)}）` : s.title}
                          </span>
                          {!filtering ? (
                            <span className="scene-card-move">
                              <button type="button" title="上へ" disabled={si === 0} onClick={() => handleMove(c.id, s.id, -1)}>↑</button>
                              <button type="button" title="下へ" disabled={si === (c.sections ?? []).length - 1} onClick={() => handleMove(c.id, s.id, 1)}>↓</button>
                            </span>
                          ) : null}
                        </div>
                        <div className="scene-card-title">{s.title}</div>
                        {m?.purpose ? <div className="scene-card-purpose">{m.purpose}</div> : null}
                        {m?.presentCharacters?.length ? (
                          <div className="scene-card-chars">
                            {m.presentCharacters.map((n) => (
                              <span key={n} className="badge gray">{n}</span>
                            ))}
                          </div>
                        ) : null}
                        <div className="scene-card-foot">
                          <span className={`badge ${rt ? "success" : "gray"}`}>{rt ? "執筆済" : "未執筆"}</span>
                          {m?.estimatedMinutes != null ? <span className="hint">想定 {m.estimatedMinutes}分</span> : null}
                          {rt ? (
                            <span className={`hint ${dev === "error" ? "runtime-over" : ""}`} style={dev === "warn" ? { color: "var(--warn)", fontWeight: 600 } : undefined}>
                              実測 {rt.estimatedMinutes}分{dev === "warn" || dev === "error" ? "（乖離）" : ""}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>キャラクター出番・台詞バランス</h2>
          <span className="hint">
            出番 = sceneMeta の登場人物 ＋ 本文のセリフ話者（執筆済みシーンから自動集計）
          </span>
        </div>
        <div className="panel-body dense">
          {stats.length === 0 ? (
            <div className="empty-state">
              まだ集計対象がありません。シーンに登場人物を設定するか、本文を執筆すると自動で集計されます。
            </div>
          ) : (
            <div className="char-stat-table">
              <div className="char-stat-row char-stat-head">
                <span>キャラクター</span>
                <span>出番</span>
                <span>セリフ</span>
                <span>台詞シェア</span>
                <span>出番の分布</span>
              </div>
              {stats.map((st) => {
                const gapWarn = st.appearances >= 2 && totalScenes >= 6 && st.maxGap >= Math.ceil(totalScenes * 0.3);
                return (
                  <div key={st.name} className="char-stat-row">
                    <span>
                      {st.name}
                      {!st.registered ? (
                        <span className="badge warn" style={{ marginLeft: 6 }} title="登場人物ナレッジに未登録の話者。表記揺れの可能性もあります">未登録</span>
                      ) : null}
                    </span>
                    <span>{st.appearances} シーン</span>
                    <span>{st.dialogueLines} 行 / {st.dialogueChars.toLocaleString()} 字</span>
                    <span>
                      <span className="share-bar"><span style={{ width: `${Math.round(st.dialogueShare * 100)}%` }} /></span>
                      {Math.round(st.dialogueShare * 100)}%
                    </span>
                    <span>
                      {st.appearances > 0 ? `S${st.firstSceneIndex + 1}〜S${st.lastSceneIndex + 1}` : "出番なし"}
                      {gapWarn ? (
                        <span className="badge warn" style={{ marginLeft: 6 }} title={`最大 ${st.maxGap} シーン連続で登場しません。観客が忘れる恐れがあります`}>
                          空白 {st.maxGap}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="help" style={{ marginTop: 8 }}>
            「未登録」の話者は<Link href="/characters">登場人物</Link>への登録漏れか、話者名の表記揺れです。
            「空白」は初登場〜最終登場の間に連続して出てこないシーン数で、主要キャラで大きい場合は再登場の設計を検討してください。
          </p>
        </div>
      </div>
    </>
  );
}
