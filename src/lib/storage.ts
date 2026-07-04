"use client";

import {
  defaultPrompts,
  emptyCharacters,
  emptyStoryBible,
  emptyWritingMemory,
  sampleInterviewNotes,
  sampleWritingMemory,
} from "./samples";
import type { OutlineProposal, Project, PromptTemplate, SectionDraft, WritingMemory } from "./types";
import { makeId } from "./ids";

const KEY_PROJECTS = "kikigaki:projects:v2";
const KEY_CURRENT = "kikigaki:currentProjectId:v2";
const KEY_OLD_PROJECT_V1 = "kikigaki:project:v1";
const KEY_PROMPTS = "kikigaki:prompts:v1";
// 参照ライブラリはプロジェクト横断のグローバル（プロンプトと同じパターン）
const KEY_LIBRARY = "akikaze:library:v1";

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
    // P3
    genre: "biography",
    characters: [],
    storyBible: { ...emptyStoryBible },
    agentToggles: {},
    sectionAgentReports: {},
    references: [],
    glossary: [],
  };
}

function emptyProject(name: string, genre: import("./types").Genre = "biography"): Project {
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
    // P3
    genre,
    characters: [...emptyCharacters],
    storyBible: { ...emptyStoryBible },
    agentToggles: {},
    sectionAgentReports: {},
    references: [],
    glossary: [],
  };
}

function mergeDefaults(p: Project): Project {
  return {
    ...newProject(),
    ...p,
    writingMemory: { ...emptyWritingMemory, ...(p.writingMemory || {}) },
    // P3: 既存 v2 プロジェクトに P3 フィールドが無ければ補う
    genre: (p as any).genre ?? "biography",
    characters: Array.isArray((p as any).characters) ? (p as any).characters : [],
    storyBible: { ...emptyStoryBible, ...((p as any).storyBible || {}) },
    agentToggles: { ...((p as any).agentToggles || {}) },
    sectionAgentReports: { ...((p as any).sectionAgentReports || {}) },
    sectionAgentReportsPrev: { ...((p as any).sectionAgentReportsPrev || {}) },
    references: Array.isArray((p as any).references) ? (p as any).references : [],
    glossary: Array.isArray((p as any).glossary) ? (p as any).glossary : [],
    screenplayMeta: (p as any).screenplayMeta ?? undefined,
    blogMeta: (p as any).blogMeta ?? undefined,
    referenceWorkIds: Array.isArray((p as any).referenceWorkIds)
      ? (p as any).referenceWorkIds
      : [],
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

export function createProject(
  name?: string,
  opts?: { withSample?: boolean; genre?: import("./types").Genre },
): Project {
  const arr = loadAll();
  const withSample = opts?.withSample ?? false;
  const genre = opts?.genre ?? "biography";
  const p = withSample
    ? { ...newProject(name), genre }
    : emptyProject(name ?? "新しいプロジェクト", genre);
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

// ===== 選択中構成の小見出し（section）を個別に編集 =====

export function updateSectionInOutline(
  chapterId: string,
  sectionId: string,
  patch: Partial<import("./types").Section>,
): Project {
  return updateProject((p) => {
    if (!p.selectedOutline) return p;
    const chapters = p.selectedOutline.chapters.map((c) =>
      c.id === chapterId
        ? {
            ...c,
            sections: (c.sections ?? []).map((s) =>
              s.id === sectionId ? { ...s, ...patch } : s,
            ),
          }
        : c,
    );
    return { ...p, selectedOutline: { ...p.selectedOutline, chapters } };
  });
}

export function addSectionToChapter(chapterId: string, title = "新しい小見出し"): Project {
  const sectionId = `section-${makeId("s")}`;
  return updateProject((p) => {
    if (!p.selectedOutline) return p;
    const chapters = p.selectedOutline.chapters.map((c) =>
      c.id === chapterId
        ? { ...c, sections: [...(c.sections ?? []), { id: sectionId, title, summary: "" }] }
        : c,
    );
    return { ...p, selectedOutline: { ...p.selectedOutline, chapters } };
  });
}

export function removeSectionFromOutline(chapterId: string, sectionId: string): Project {
  return updateProject((p) => {
    if (!p.selectedOutline) return p;
    const chapters = p.selectedOutline.chapters.map((c) =>
      c.id === chapterId
        ? { ...c, sections: (c.sections ?? []).filter((s) => s.id !== sectionId) }
        : c,
    );
    return { ...p, selectedOutline: { ...p.selectedOutline, chapters } };
  });
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

/** 節本文の locked（波及再生成からの保護）を切り替え */
export function setSectionLocked(
  chapterId: string,
  sectionId: string,
  locked: boolean,
): Project {
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) =>
      d.chapterId === chapterId && d.sectionId === sectionId ? { ...d, locked } : d,
    ),
  }));
}

// ===== P3 helpers =====

export function updateGenre(genre: import("./types").Genre): Project {
  return updateProject((p) => ({ ...p, genre }));
}

export function updateCharacters(chars: import("./types").NovelCharacter[]): Project {
  return updateProject((p) => ({ ...p, characters: chars }));
}

export function updateStoryBible(bible: import("./types").StoryBible): Project {
  return updateProject((p) => ({ ...p, storyBible: bible }));
}

// ===== Nav 再構成: AIスタッフのトグルと診断結果 =====

export function updateAgentToggle(
  agentKey: import("./types").AgentKey,
  enabled: boolean,
): Project {
  return updateProject((p) => ({
    ...p,
    agentToggles: { ...(p.agentToggles ?? {}), [agentKey]: enabled },
  }));
}

export function saveSectionAgentReports(
  sectionKey: string,
  reports: import("./types").AgentReportSummary[],
): Project {
  return updateProject((p) => {
    const prev = { ...(p.sectionAgentReportsPrev ?? {}) };
    const cur = { ...(p.sectionAgentReports ?? {}) };
    // 再生成時: いまの診断をひとつ前に退避してから新しい診断を入れる
    if (cur[sectionKey]) prev[sectionKey] = cur[sectionKey];
    cur[sectionKey] = reports;
    return { ...p, sectionAgentReports: cur, sectionAgentReportsPrev: prev };
  });
}

// ===== ビジネス書: 参考文献・用語集 =====

export function updateReferences(refs: import("./types").Reference[]): Project {
  return updateProject((p) => ({ ...p, references: refs }));
}

export function updateGlossary(terms: import("./types").GlossaryTerm[]): Project {
  return updateProject((p) => ({ ...p, glossary: terms }));
}

// ===== 脚本 =====

export function updateScreenplayMeta(meta: import("./types").ScreenplayMeta): Project {
  return updateProject((p) => ({ ...p, screenplayMeta: meta }));
}

// ===== ブログ記事 =====

export function updateBlogMeta(meta: import("./types").BlogMeta): Project {
  return updateProject((p) => ({ ...p, blogMeta: meta }));
}

// ===== 参照ライブラリ（グローバル。プロジェクト横断）=====

export function loadLibrary(): import("./types").ReferenceWork[] {
  if (!isBrowser()) return [];
  const existing = safeParse<import("./types").ReferenceWork[]>(localStorage.getItem(KEY_LIBRARY));
  return existing && Array.isArray(existing) ? existing : [];
}

export function saveLibrary(works: import("./types").ReferenceWork[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_LIBRARY, JSON.stringify(works));
}

export function addReferenceWork(work: import("./types").ReferenceWork): import("./types").ReferenceWork[] {
  const next = [...loadLibrary(), work];
  saveLibrary(next);
  return next;
}

export function removeReferenceWork(id: string): import("./types").ReferenceWork[] {
  const next = loadLibrary().filter((w) => w.id !== id);
  saveLibrary(next);
  // どのプロジェクトの選択からも外す
  const arr = loadAll();
  let changed = false;
  const cleaned = arr.map((p) => {
    if (p.referenceWorkIds?.includes(id)) {
      changed = true;
      return { ...p, referenceWorkIds: p.referenceWorkIds.filter((x) => x !== id) };
    }
    return p;
  });
  if (changed) saveAll(cleaned);
  return next;
}

// このプロジェクトが参照する作品IDの選択
export function setReferenceWorkIds(ids: string[]): Project {
  return updateProject((p) => ({ ...p, referenceWorkIds: ids }));
}

/** 現在のプロジェクトが選択している参照作品のカルテ本体を返す */
export function getSelectedReferenceWorks(project: Project): import("./types").ReferenceWork[] {
  const ids = new Set(project.referenceWorkIds ?? []);
  if (ids.size === 0) return [];
  return loadLibrary().filter((w) => ids.has(w.id));
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
