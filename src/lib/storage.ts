"use client";

import { defaultPrompts, emptyWritingMemory, sampleInterviewNotes, sampleWritingMemory } from "./samples";
import type { OutlineProposal, Project, PromptTemplate, SectionDraft, WritingMemory } from "./types";
import { makeId } from "./ids";

const KEY_PROJECT = "kikigaki:project:v1";
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

export function newProject(): Project {
  return {
    id: makeId("project"),
    name: "デモプロジェクト",
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

export function loadProject(): Project {
  if (!isBrowser()) return newProject();
  const existing = safeParse<Project>(localStorage.getItem(KEY_PROJECT));
  if (existing) {
    // 後方互換: 不足フィールドを補う
    return {
      ...newProject(),
      ...existing,
      writingMemory: { ...emptyWritingMemory, ...(existing.writingMemory || {}) },
    };
  }
  const fresh = newProject();
  saveProject(fresh);
  return fresh;
}

export function saveProject(p: Project): void {
  if (!isBrowser()) return;
  const next = { ...p, updatedAt: nowIso() };
  localStorage.setItem(KEY_PROJECT, JSON.stringify(next));
}

export function updateProject(mutator: (p: Project) => Project): Project {
  const current = loadProject();
  const next = mutator(current);
  saveProject(next);
  return next;
}

export function resetProject(): Project {
  const fresh = newProject();
  saveProject(fresh);
  return fresh;
}

export function loadPrompts(): PromptTemplate[] {
  if (!isBrowser()) return defaultPrompts;
  const existing = safeParse<PromptTemplate[]>(localStorage.getItem(KEY_PROMPTS));
  if (existing && existing.length) {
    // 既存のlocalStorageに、後から追加されたデフォルトプロンプトが無い場合は補う
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

/**
 * 渡したプロンプトに、共通の校正・編集ルールを末尾結合した版を返す。
 * 本文生成・編集レビューなど、文章スタイルの統一が必要な処理で使う。
 */
export function withStyleRules(base: PromptTemplate): PromptTemplate {
  const all = loadPrompts();
  const style = all.find((p) => p.id === "prompt-style-rules");
  if (!style || !style.systemPrompt?.trim()) return base;
  return {
    ...base,
    systemPrompt: `${base.systemPrompt}\n\n【共通の校正・編集ルール（必ず守る）】\n${style.systemPrompt}`,
  };
}

export function savePrompts(ps: PromptTemplate[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_PROMPTS, JSON.stringify(ps));
}

export function getPrompt(id: string): PromptTemplate {
  const list = loadPrompts();
  return list.find((p) => p.id === id) ?? defaultPrompts.find((p) => p.id === id) ?? defaultPrompts[0];
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
