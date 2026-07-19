"use client";

import { useEffect, useState } from "react";
import {
  deleteProject,
  listProjects,
  loadLibrary,
  loadProject,
  loadPrompts,
  resetProject,
  savePrompts,
  importProject as saveImportedProject,
} from "@/lib/storage";
import { exportProjectToJson, importProjectFromFile } from "@/lib/projectIO";
import type { Project } from "@/lib/types";
import { useRef } from "react";

function reloadApp(): void {
  if (typeof window !== "undefined") window.location.reload();
}

export default function SettingsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>設定</h1>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  function handleExport() {
    if (!project) return;
    exportProjectToJson(project, loadPrompts(), loadLibrary());
    setInfo("JSONをダウンロードしました。");
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { project: imported, prompts } = await importProjectFromFile(file);
      const saved = saveImportedProject(imported, true);
      if (prompts && prompts.length > 0) {
        const overwrite = confirm(
          "このファイルにはプロンプト（AIスタッフ設定）も含まれています。現在の設定を上書きしますか？",
        );
        if (overwrite) savePrompts(prompts);
      }
      alert(`プロジェクト「${saved.name}」をインポートしました。`);
      reloadApp();
    } catch (err) {
      alert("インポートに失敗しました: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      e.target.value = "";
    }
  }

  function handleReset() {
    if (!confirm("現在のプロジェクトの内容をサンプル状態に戻します。よろしいですか？")) return;
    const fresh = resetProject();
    setProject(fresh);
    setInfo("サンプル状態に戻しました。");
  }

  function handleDelete() {
    if (listProjects().length <= 1) {
      alert("最後のプロジェクトは削除できません。");
      return;
    }
    if (!project) return;
    if (!confirm(`「${project.name}」を削除します。この操作は取り消せません。よろしいですか？`))
      return;
    deleteProject(project.id);
    reloadApp();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>設定</h1>
          <p className="subtitle">
            データの入出力とプロジェクトの管理。プロジェクト名・モードは「01 素材」で変更できます。
          </p>
        </div>
      </div>

      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>データの入出力</h2>
          <span className="hint">バックアップ・別端末への移行に</span>
        </div>
        <div className="panel-body">
          <div className="flex wrap">
            <button className="btn" type="button" onClick={handleExport}>
              ⇩ このプロジェクトをJSONエクスポート
            </button>
            <button className="btn" type="button" onClick={() => fileInputRef.current?.click()}>
              ⇧ JSONファイルからインポート
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={handleImportFile}
            />
          </div>
          <p className="help" style={{ marginTop: 8 }}>
            エクスポートにはプロジェクト本体とAIスタッフ設定（プロンプト）が含まれます。
            データは localStorage に保存されているため、ブラウザの閲覧データ削除で消えます。定期的なエクスポートを推奨します。
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ color: "var(--danger)" }}>データの初期化</h2>
        </div>
        <div className="panel-body">
          <div className="flex wrap">
            <button className="btn" type="button" onClick={handleReset}>
              このプロジェクトをサンプルに戻す
            </button>
            <button className="btn danger" type="button" onClick={handleDelete}>
              このプロジェクトを削除
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
