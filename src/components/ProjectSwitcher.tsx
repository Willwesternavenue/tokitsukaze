"use client";

import { useEffect, useRef, useState } from "react";
import {
  createProject,
  deleteProject,
  importProject as saveImportedProject,
  listProjects,
  loadLibrary,
  loadPrompts,
  loadProject,
  renameProject,
  saveLibrary,
  savePrompts,
  switchProject,
} from "@/lib/storage";
import { exportProjectToJson, importProjectFromFile } from "@/lib/projectIO";
import { allGenres } from "@/lib/genreConfig";
import type { Project } from "@/lib/types";

function reloadApp(): void {
  // 全画面の React state を確実に新しいプロジェクトに揃えるためフルリロード
  if (typeof window !== "undefined") window.location.reload();
}

export function ProjectSwitcher(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    refresh();
  }, []);

  function refresh() {
    setProjects(listProjects());
    try {
      setCurrentId(loadProject().id);
    } catch {
      setCurrentId("");
    }
  }

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSwitch(id: string) {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    switchProject(id);
    setOpen(false);
    reloadApp();
  }

  function handleNew() {
    const name = window.prompt("新しいプロジェクト名を入力してください。", "");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      alert("プロジェクト名を入力してください。");
      return;
    }
    // モード一覧は genreConfig の登録順から動的生成（新モード追加時にここは触らない）
    const menu = allGenres.map((g, i) => `${i + 1} = ${g.label}`).join("\n");
    const choice = window.prompt(`モードを選択してください（番号を入力）:\n${menu}`, "1");
    if (choice === null) return;
    const idx = Number(choice.trim()) - 1;
    const genre =
      Number.isInteger(idx) && idx >= 0 && idx < allGenres.length
        ? allGenres[idx].genre
        : allGenres[0].genre;
    createProject(trimmed, { withSample: false, genre });
    setOpen(false);
    reloadApp();
  }

  function handleRename() {
    const cur = projects.find((p) => p.id === currentId);
    if (!cur) return;
    const name = window.prompt("プロジェクト名を変更します。", cur.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === cur.name) return;
    renameProject(cur.id, trimmed);
    refresh();
  }

  function handleDelete() {
    if (projects.length <= 1) {
      alert("最後のプロジェクトは削除できません。");
      return;
    }
    const cur = projects.find((p) => p.id === currentId);
    if (!cur) return;
    if (!confirm(`「${cur.name}」を削除します。この操作は取り消せません。よろしいですか？`)) return;
    deleteProject(cur.id);
    setOpen(false);
    reloadApp();
  }

  function handleExport() {
    try {
      const p = loadProject();
      const prompts = loadPrompts();
      const library = loadLibrary();
      exportProjectToJson(p, prompts, library);
      setOpen(false);
    } catch (e) {
      alert("エクスポートに失敗しました: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { project, prompts, library } = await importProjectFromFile(file);
      const importedAsNew = saveImportedProject(project, true);
      if (prompts && prompts.length > 0) {
        const overwritePrompts = confirm(
          "このファイルにはプロンプトテンプレートも含まれています。現在のプロンプトを上書きしますか？\n\nOK = 上書きする\nキャンセル = プロンプトは現状維持",
        );
        if (overwritePrompts) savePrompts(prompts);
      }
      if (library && library.length > 0) {
        const mergeLib = confirm(
          `このファイルには参照ライブラリ（${library.length}件）が含まれています。現在のライブラリに統合しますか？\n\nOK = 統合する\nキャンセル = 統合しない`,
        );
        if (mergeLib) {
          const existing = loadLibrary();
          const ids = new Set(existing.map((w) => w.id));
          const merged = [...existing, ...library.filter((w) => !ids.has(w.id))];
          saveLibrary(merged);
        }
      }
      alert(`プロジェクト「${importedAsNew.name}」をインポートしました。`);
      setOpen(false);
      reloadApp();
    } catch (err) {
      alert("インポートに失敗しました: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      e.target.value = "";
    }
  }

  // SSR時は固定の表示にしてHydrationエラーを避ける
  if (!mounted) {
    return (
      <div className="project-switcher">
        <button className="project-switcher-btn" type="button" disabled>
          <span className="label">プロジェクト</span>
          <span className="name">読み込み中…</span>
          <span className="caret">▾</span>
        </button>
      </div>
    );
  }

  const current = projects.find((p) => p.id === currentId);

  return (
    <div className="project-switcher" ref={rootRef}>
      <button
        className="project-switcher-btn"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="label">プロジェクト</span>
        <span className="name">{current?.name ?? "—"}</span>
        <span className="caret">▾</span>
      </button>
      {open ? (
        <div className="project-switcher-menu" role="menu">
          <div className="menu-section-label">プロジェクトを切り替え</div>
          <div className="menu-section">
            {projects.map((p) => (
              <button
                key={p.id}
                role="menuitem"
                type="button"
                className={`menu-item ${p.id === currentId ? "active" : ""}`}
                onClick={() => handleSwitch(p.id)}
                title={`更新: ${new Date(p.updatedAt).toLocaleString()}`}
              >
                <span className="check">{p.id === currentId ? "✓" : ""}</span>
                <span className="menu-item-name">{p.name}</span>
                {(p as any).genre === "novel" ? (
                  <span className="badge" style={{ marginLeft: "auto" }}>小説</span>
                ) : (p as any).genre === "business" ? (
                  <span className="badge" style={{ marginLeft: "auto" }}>ビジネス書</span>
                ) : (p as any).genre === "screenplay" ? (
                  <span className="badge" style={{ marginLeft: "auto" }}>脚本</span>
                ) : (p as any).genre === "blog" ? (
                  <span className="badge" style={{ marginLeft: "auto" }}>ブログ</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="menu-divider" />
          <button role="menuitem" type="button" className="menu-item" onClick={handleNew}>
            ＋ 新しいプロジェクトを作成
          </button>
          <button
            role="menuitem"
            type="button"
            className="menu-item"
            onClick={handleRename}
            disabled={!current}
          >
            ✎ 現在のプロジェクト名を変更
          </button>
          <div className="menu-divider" />
          <button role="menuitem" type="button" className="menu-item" onClick={handleExport}>
            ⇩ 現在のプロジェクトをJSONエクスポート
          </button>
          <button role="menuitem" type="button" className="menu-item" onClick={handleImportClick}>
            ⇧ JSONファイルからインポート
          </button>
          <div className="menu-divider" />
          <button
            role="menuitem"
            type="button"
            className="menu-item danger"
            onClick={handleDelete}
            disabled={projects.length <= 1}
            title={projects.length <= 1 ? "最後のプロジェクトは削除できません" : ""}
          >
            🗑 このプロジェクトを削除
          </button>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />
    </div>
  );
}
