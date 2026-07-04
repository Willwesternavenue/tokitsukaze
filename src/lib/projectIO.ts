"use client";

import { saveAs } from "file-saver";
import type { Project, PromptTemplate, ReferenceWork } from "./types";

export const EXPORT_VERSION = "kikigaki-export-v1";

export type ProjectExport = {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  project: Project;
  prompts?: PromptTemplate[];
  library?: ReferenceWork[]; // 参照ライブラリ（グローバル）も同梱
};

function fileSafe(name: string): string {
  return (name || "untitled").replace(/[\\\/:*?"<>|]/g, "_").trim();
}

export function exportProjectToJson(
  project: Project,
  prompts?: PromptTemplate[] | null,
  library?: ReferenceWork[] | null,
): void {
  const payload: ProjectExport = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    prompts: prompts && prompts.length ? prompts : undefined,
    library: library && library.length ? library : undefined,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const date = new Date().toISOString().slice(0, 10);
  const fname = `akikaze_${fileSafe(project.name)}_${date}.json`;
  saveAs(blob, fname);
}

export async function importProjectFromFile(
  file: File,
): Promise<{ project: Project; prompts?: PromptTemplate[]; library?: ReferenceWork[] }> {
  const text = await file.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSONの解析に失敗しました。ファイルが壊れていないか確認してください。");
  }
  if (data?.version !== EXPORT_VERSION) {
    throw new Error(
      `ファイル形式が一致しません（${data?.version ?? "version 不明"}）。\nアキカゼ出版AI のエクスポートファイルか確認してください。`,
    );
  }
  const project = data?.project;
  if (!project || typeof project !== "object" || typeof project.id !== "string") {
    throw new Error("プロジェクトデータが正しく含まれていません。");
  }
  const prompts =
    Array.isArray(data?.prompts) && data.prompts.length > 0
      ? (data.prompts as PromptTemplate[])
      : undefined;
  const library =
    Array.isArray(data?.library) && data.library.length > 0
      ? (data.library as ReferenceWork[])
      : undefined;
  return { project: project as Project, prompts, library };
}
