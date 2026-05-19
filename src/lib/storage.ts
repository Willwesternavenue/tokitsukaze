"use client";

import { defaultPrompts, emptyWritingMemory, sampleInterviewNotes, sampleWritingMemory } from "./samples";
import type { OutlineProposal, Project, PromptTemplate, SectionDraft, WritingMemory } from "./types";
import { makeId } from "./ids";

const KEY_PROJECTS = "kikigaki:projects:v2";
const KEY_CURRENT = "kikigaki:currentProjectId:v2";
const KEY_OLD_PROJECT_V1 = "kikigaki:project:v1";
const KEY_PROMPTS = "kikigaki:prompts:v1";

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function newProject(name?: string): Project {
  return {
    id: makeId("project"),
    name: name ?? "デモプロジェクト",
    intervieweeName: "佐藤一郎（仮名）",
    theme: "地域に根ざして逃げずに続けた人生",
    targetReader: "同世代の経営者、家族、地元の人々",
    desiredTone: "落ち着いた人物伝風。誠実で読みやすい語り口。",
    interviewNotes: sampleInterviewNotes,
    outlineProposals: [],
    selectedOutline: undefined,
    writingMemory: sampleWritingMemory,
    generatedSections: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function emptyProject(name: string): Project {
  return {
    id: makeId("project"),
    name,
    intervieweeName: "",
    theme: "",
    targetReader: "",
    desiredTone: "",
    interviewNotes: "",
    outlineProposals: [],
    selectedOutline: undefined,
    writingMemory: { ...emptyWritingMemory },
    generatedSections: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function mergeDefaults(p: Project): Project {
  return {
    ...newProject(),
    ...p,
    writingMemory: { ...emptyWritingMemory, ...(p.writingMemory || {}) },
  };
}

/**
 * v1 (単一プロジェクト) → v2 (複数) への移行。
 * v2 がまだ無く v1 がある場合、v1 を配列化して v2 に保存する。
 */
function migrateV1IfNeeded(): void {
  if (!isBrowser()) return;
  if (localStorage.getItem(KEY_PROJECTS)) return; // 既に v2 がある
  const oldRaw = localStorage.getItem(KEY_OLD_PROJECT_V1);
  if (!oldRaw) return;
  const old = safeParse<Project>(oldRaw);
  if (!old?.id) return;
  localStorage.setItem(KEY_PROJECTS, JSON.stringify([old]));
  localStorage.setItem(KEY_CURRENT, old.id);
  // v1 は念のため残す（消したい場合は localStorage.removeItem(KEY_OLD_PROJECT_V1)）
}

function loadAll(): Project[] {
  if (!isBrowser()) return [newProject()];
  migrateV1IfNeeded();
  const v2 = safeParse<Project[]>(localStorage.getItem(KEY_PROJECTS));
  if (v2 && Array.isArray(v2) && v2.length > 0) return v2;
  // 初回: サンプル付きの新規プロジェクト1つを作って保存
  const fresh = [newProject()];
  saveAll(fresh);
  setCurrentProjectIdRaw(fresh[0].id);
  return fresh;
}

function saveAll(arr: Project[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_PROJECTS, JSON.stringify(arr));
}

function getCurrentProjectIdRaw(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(KEY_CURRENT);
}

function setCurrentProjectIdRaw(id: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_CURRENT, id);
}

// ===== Public API: project list =====

export function listProjects(): Project[] {
  return loadAll();
}

export function getCurrentProjectId(): string | null {
  return getCurrentProjectIdRaw();
}

export function switchProject(id: string): Project {
  const arr = loadAll();
  if (!arr.some((p) => p.id === id)) {
    throw new Error("指定されたプロジェクトが見つかりません。");
  }
  setCurrentProjectIdRaw(id);
  return loadProject();
}

export function createProject(name?: string, opts?: { withSample?: boolean }): Project {
  const arr = loadAll();
  const withSample = opts?.withSample ?? false;
  const p = withSample ? newProject(name) : emptyProject(name ?? "新しいプロジェクト");
  arr.push(p);
  saveAll(arr);
  setCurrentProjectIdRaw(p.id);
  return p;
}

export function deleteProject(id: string): Project[] {
  const arr = loadAll();
  if (arr.length <= 1) {
    throw new Error("最後のプロジェクトは削除できません。");
  }
  const filtered = arr.filter((p) => p.id !== id);
  saveAll(filtered);
  if (getCurrentProjectIdRaw() === id) {
    setCurrentProjectIdRaw(filtered[0].id);
  }
  return filtered;
}

export function renameProject(id: string, name: string): Project[] {
  const arr = loadAll();
  const idx = arr.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("プロジェクトが見つかりません。");
  arr[idx] = { ...arr[idx], name, updatedAt: nowIso() };
  saveAll(arr);
  return arr;
}

/**
 * 外部からインポートされたProject。
 * asNew=true なら新しいIDを振って追加。falseなら同じIDで上書き保存。
 */
export function importProject(p: Project, asNew = true): Project {
  const arr = loadAll();
  if (asNew) {
    const np: Project = {
      ...p,
      id: makeId("project"),
      createdAt: p.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    arr.push(np);
    saveAll(arr);
    setCurrentProjectIdRaw(np.id);
    return np;
  }
  const idx = arr.findIndex((x) => x.id === p.id);
  const stamped: Project = { ...p, updatedAt: nowIso() };
  if (idx >= 0) arr[idx] = stamped;
  else arr.push(stamped);
  saveAll(arr);
  setCurrentProjectIdRaw(stamped.id);
  return stamped;
}

// ===== Public API: current project =====

export function loadProject(): Project {
  const arr = loadAll();
  const currentId = getCurrentProjectIdRaw();
  if (currentId) {
    const found = arr.find((p) => p.id === currentId);
    if (found) return mergeDefaults(found);
  }
  // 不整合時: 先頭をカレントにする
  const first = arr[0];
  setCurrentProjectIdRaw(first.id);
  return mergeDefaults(first);
}

export function saveProject(p: Project): void {
  if (!isBrowser()) return;
  const arr = loadAll();
  const idx = arr.findIndex((x) => x.id === p.id);
  const next: Project = { ...p, updatedAt: nowIso() };
  if (idx >= 0) arr[idx] = next;
  else arr.push(next);
  saveAll(arr);
}

export function updateProject(mutator: (p: Project) => Project): Project {
  const current = loadProject();
  const next = mutator(current);
  saveProject(next);
  return next;
}

/**
 * 「このプロジェクトをサンプル状態に戻す」。
 * 現在のプロジェクトのIDと名前は保持し、中身だけサンプルに差し替える。
 */
export function resetProject(): Project {
  const current = loadProject();
  const fresh = newProject(current.name);
  const reset: Project = {
    ...fresh,
    id: current.id,
    createdAt: current.createdAt,
  };
  saveProject(reset);
  return reset;
}

export function setOutlineProposals(proposals: OutlineProposal[]): Project {
  return updateProject((p) => ({ ...p, outlineProposals: proposals }));
}

export function selectOutline(outlineId: string): Project {
  return updateProject((p) => {
    const chosen = p.outlineProposals.find((o) => o.id === outlineId);
    if (!chosen) return p;
    return {
      ...p,
      selectedOutline: chosen,
      writingMemory: {
        ...p.writingMemory,
        selectedOutlineSummary: `${chosen.title}：${chosen.concept}`,
      },
    };
  });
}

export function replaceSelectedOutline(outline: OutlineProposal): Project {
  return updateProject((p) => ({ ...p, selectedOutline: outline }));
}

export function upsertDraft(draft: SectionDraft): Project {
  return updateProject((p) => {
    const idx = p.generatedSections.findIndex(
      (s) => s.chapterId === draft.chapterId && s.sectionId === draft.sectionId,
    );
    const list = [...p.generatedSections];
    if (idx >= 0) {
      list[idx] = { ...draft, updatedAt: nowIso() };
    } else {
      list.push(draft);
    }
    return { ...p, generatedSections: list };
  });
}

export function updateWritingMemory(mem: WritingMemory): Project {
  return updateProject((p) => ({ ...p, writingMemory: mem }));
}

// ===== Prompts (global) =====

export function loadPrompts(): PromptTemplate[] {
  if (!isBrowser()) return defaultPrompts;
  const existing = safeParse<PromptTemplate[]>(localStorage.getItem(KEY_PROMPTS));
  if (existing && existing.length) {
    const existingIds = new Set(existing.map((p) => p.id));
    const missing = defaultPrompts.filter((d) => !existingIds.has(d.id));
    if (missing.length > 0) {
      const merged = [...existing, ...missing];
      savePrompts(merged);
      return merged;
    }
    return existing;
  }
  savePrompts(defaultPrompts);
  return defaultPrompts;
}

export function savePrompts(ps: PromptTemplate[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_PROMPTS, JSON.stringify(ps));
}

export function getPrompt(id: string): PromptTemplate {
  const list = loadPrompts();
  return list.find((p) => p.id === id) ?? defaultPrompts.find((p) => p.id === id) ?? defaultPrompts[0];
}

export function withStyleRules(base: PromptTemplate): PromptTemplate {
  const all = loadPrompts();
  const style = all.find((p) => p.id === "prompt-style-rules");
  if (!style || !style.systemPrompt?.trim()) return base;
  return {
    ...base,
    systemPrompt: `${base.systemPrompt}\n\n【共通の校正・編集ルール（必ず守る）】\n${style.systemPrompt}`,
  };
}
