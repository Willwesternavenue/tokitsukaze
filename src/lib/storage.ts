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
// グローバル対訳表（シリーズ物・分野術語集の使い回し。参照ライブラリと同パターン）
const KEY_TERMSETS = "akikaze:termsets:v1";
// 進行中の本文生成 run（タブ切替・移動・リロードからの復帰用）
const KEY_PENDING_RUNS = "akikaze:pendingRuns:v1";

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
    dismissedFindings: Array.isArray((p as any).dismissedFindings)
      ? (p as any).dismissedFindings
      : [],
    references: Array.isArray((p as any).references) ? (p as any).references : [],
    glossary: Array.isArray((p as any).glossary) ? (p as any).glossary : [],
    screenplayMeta: (p as any).screenplayMeta ?? undefined,
    blogMeta: (p as any).blogMeta ?? undefined,
    newsMeta: (p as any).newsMeta ?? undefined,
    paperMeta: (p as any).paperMeta ?? undefined,
    translationMeta: (p as any).translationMeta ?? undefined,
    termPairs: Array.isArray((p as any).termPairs) ? (p as any).termPairs : [],
    termSetIds: Array.isArray((p as any).termSetIds) ? (p as any).termSetIds : [],
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

/**
 * 翻訳書モードの保険: 新しい構成に sourceText（セグメント原文）が無い場合、
 * 旧 selectedOutline の同じ section id から引き継ぐ。
 * AIが返す構成JSON（refine-outline 等）や outlineProposals の軽量コピーには
 * sourceText が含まれないため、無防備に置き換えると原文が全損する。
 */
function preserveSourceText(
  next: OutlineProposal,
  old: OutlineProposal | undefined,
): OutlineProposal {
  if (!old) return next;
  const oldSource = new Map<string, string>();
  for (const c of old.chapters) {
    for (const s of c.sections ?? []) {
      if (s.sourceText) oldSource.set(s.id, s.sourceText);
    }
  }
  if (oldSource.size === 0) return next;
  return {
    ...next,
    chapters: next.chapters.map((c) => ({
      ...c,
      sections: (c.sections ?? []).map((s) =>
        s.sourceText ? s : { ...s, sourceText: oldSource.get(s.id) },
      ),
    })),
  };
}

export function selectOutline(outlineId: string): Project {
  return updateProject((p) => {
    const chosen = p.outlineProposals.find((o) => o.id === outlineId);
    if (!chosen) return p;
    const outline =
      p.genre === "translation" ? preserveSourceText(chosen, p.selectedOutline) : chosen;
    return {
      ...p,
      selectedOutline: outline,
      writingMemory: {
        ...p.writingMemory,
        selectedOutlineSummary: `${chosen.title}：${chosen.concept}`,
      },
    };
  });
}

export function replaceSelectedOutline(outline: OutlineProposal): Project {
  return updateProject((p) => ({
    ...p,
    selectedOutline:
      p.genre === "translation" ? preserveSourceText(outline, p.selectedOutline) : outline,
  }));
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

/** 章内でセクション（シーン）を上下に並べ替える（シーンボード用） */
export function moveSectionInChapter(
  chapterId: string,
  sectionId: string,
  dir: -1 | 1,
): Project {
  return updateProject((p) => {
    if (!p.selectedOutline) return p;
    const chapters = p.selectedOutline.chapters.map((c) => {
      if (c.id !== chapterId) return c;
      const sections = [...(c.sections ?? [])];
      const idx = sections.findIndex((s) => s.id === sectionId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= sections.length) return c;
      [sections[idx], sections[to]] = [sections[to], sections[idx]];
      return { ...c, sections };
    });
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
  reason: "user" | "manual" = "user",
): Project {
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) =>
      d.chapterId === chapterId && d.sectionId === sectionId
        ? { ...d, locked, lockReason: locked ? reason : undefined }
        : d,
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

/** 複数の自動レビュアーを一括で有効/無効にする */
export function updateAgentTogglesBulk(
  patch: Partial<Record<import("./types").AgentKey, boolean>>,
): Project {
  return updateProject((p) => ({
    ...p,
    agentToggles: { ...(p.agentToggles ?? {}), ...patch },
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

/** 指摘の「対応不要（無視）」を切り替える。id は安定ID（節key|agent|message|loc） */
export function setFindingDismissed(id: string, dismissed: boolean): Project {
  return updateProject((p) => {
    const set = new Set(p.dismissedFindings ?? []);
    if (dismissed) set.add(id);
    else set.delete(id);
    return { ...p, dismissedFindings: [...set] };
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

// ===== ニュース記事 =====

export function updateNewsMeta(meta: import("./types").NewsMeta): Project {
  return updateProject((p) => ({ ...p, newsMeta: meta }));
}

// ===== 論文 =====

export function updatePaperMeta(meta: import("./types").PaperMeta): Project {
  return updateProject((p) => ({ ...p, paperMeta: meta }));
}

// ===== 翻訳書 =====

export function updateTranslationMeta(meta: import("./types").TranslationMeta): Project {
  return updateProject((p) => ({ ...p, translationMeta: meta }));
}

export function updateTermPairs(terms: import("./types").TermPair[]): Project {
  return updateProject((p) => ({ ...p, termPairs: terms }));
}

// ===== グローバル対訳表（プロジェクト横断。参照ライブラリと同じパターン）=====

export function loadTermSets(): import("./types").TermSet[] {
  if (!isBrowser()) return [];
  const existing = safeParse<import("./types").TermSet[]>(localStorage.getItem(KEY_TERMSETS));
  return existing && Array.isArray(existing) ? existing : [];
}

export function saveTermSets(sets: import("./types").TermSet[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_TERMSETS, JSON.stringify(sets));
}

/** 現在の対訳表からグローバル対訳表（セット）を作成する */
export function createTermSet(
  name: string,
  terms: import("./types").TermPair[],
  description?: string,
): import("./types").TermSet {
  const set: import("./types").TermSet = {
    id: makeId("termset"),
    name,
    description,
    // セットに入れる語は id を振り直し、status は confirmed に寄せる（使い回す確定語集の想定）
    terms: terms.map((t) => ({ ...t, id: makeId("term"), status: "confirmed" as const })),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveTermSets([...loadTermSets(), set]);
  return set;
}

export function updateTermSet(set: import("./types").TermSet): import("./types").TermSet[] {
  const next = loadTermSets().map((s) =>
    s.id === set.id ? { ...set, updatedAt: nowIso() } : s,
  );
  saveTermSets(next);
  return next;
}

export function deleteTermSet(id: string): import("./types").TermSet[] {
  const next = loadTermSets().filter((s) => s.id !== id);
  saveTermSets(next);
  // どのプロジェクトの参照からも外す
  const arr = loadAll();
  let changed = false;
  const cleaned = arr.map((p) => {
    if (p.termSetIds?.includes(id)) {
      changed = true;
      return { ...p, termSetIds: p.termSetIds.filter((x) => x !== id) };
    }
    return p;
  });
  if (changed) saveAll(cleaned);
  return next;
}

/** このプロジェクトが参照するグローバル対訳表のID */
export function setProjectTermSetIds(ids: string[]): Project {
  return updateProject((p) => ({ ...p, termSetIds: ids }));
}

/** 現在のプロジェクトが参照しているグローバル対訳表の本体を返す */
export function getReferencedTermSets(project: Project): import("./types").TermSet[] {
  const ids = new Set(project.termSetIds ?? []);
  if (ids.size === 0) return [];
  return loadTermSets().filter((s) => ids.has(s.id));
}

/**
 * 実効対訳表: 参照グローバルセットの語 ＋ プロジェクト固有の語をマージして返す。
 * 同じ原語（source、大小文字無視）はプロジェクト固有の定義が優先される。
 * 翻訳の system prompt と各チェック（用語統一・表記揺れ・適用チェック）の参照元になる。
 */
export function effectiveTermPairs(project: Project): import("./types").TermPair[] {
  const map = new Map<string, import("./types").TermPair>();
  const keyOf = (t: import("./types").TermPair) => t.source.trim().toLowerCase();
  for (const s of getReferencedTermSets(project)) {
    for (const t of s.terms) {
      const k = keyOf(t);
      if (k) map.set(k, t);
    }
  }
  // プロジェクト固有が最後に上書き（同一原語はプロジェクトの定義が勝つ）
  for (const t of project.termPairs ?? []) {
    const k = keyOf(t);
    if (k) map.set(k, t);
  }
  return [...map.values()];
}

/**
 * 訳文（本文）を差し替え、旧本文を bodyHistory に退避する（最大10版）。
 * 翻訳書モードの手動編集・一括置換で使用。
 */
export function replaceDraftBody(
  chapterId: string,
  sectionId: string,
  newBody: string,
  note: string,
): Project {
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) => {
      if (d.chapterId !== chapterId || d.sectionId !== sectionId) return d;
      if (d.body === newBody) return d;
      const history = [
        ...(d.bodyHistory ?? []),
        { savedAt: d.updatedAt, body: d.body, note },
      ].slice(-10);
      return { ...d, body: newBody, bodyHistory: history, updatedAt: new Date().toISOString() };
    }),
  }));
}

/**
 * 本文の手動編集を保存する（全ジャンル共通）。
 * 第4引数 isManualEdit は「非翻訳の手動編集か」＝自動保護と履歴圧縮の**両方**を制御する。
 * - 旧本文を bodyHistory に退避（最大10版）。isManualEdit のときだけ、前回の手動保存(bodyEditedAt)から
 *   5分以内の連続編集は積み増さずまとめる（AI 生成版が履歴から押し出されるのを防ぐ）。
 * - bodyEditedAt を更新。
 * - isManualEdit=true かつ初回(bodyEditedAt 未設定)かつ未ロックのときのみ自動保護(locked/lockReason="manual")。
 * - **翻訳モードは isManualEdit=false で呼ぶ**＝自動保護もしない・履歴圧縮もしない（毎回1版積む＝従来の
 *   replaceDraftBody と同じ挙動）。波及・一括翻訳の対象からも外さない。
 */
export function saveManualBodyEdit(
  chapterId: string,
  sectionId: string,
  newBody: string,
  isManualEdit: boolean,
): Project {
  const HISTORY_COALESCE_MS = 5 * 60 * 1000;
  const nowIso = new Date().toISOString();
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) => {
      if (d.chapterId !== chapterId || d.sectionId !== sectionId) return d;
      if (d.body === newBody) return d;
      const hist = d.bodyHistory ?? [];
      const last = hist[hist.length - 1];
      const coalesce =
        isManualEdit &&
        !!last &&
        last.note === "手動編集前" &&
        !!d.bodyEditedAt &&
        Date.now() - Date.parse(d.bodyEditedAt) < HISTORY_COALESCE_MS;
      const bodyHistory = coalesce
        ? hist
        : [...hist, { savedAt: d.updatedAt, body: d.body, note: "手動編集前" }].slice(-10);
      const autoLockNow = isManualEdit && !d.bodyEditedAt && !d.locked;
      return {
        ...d,
        body: newBody,
        bodyHistory,
        bodyEditedAt: nowIso,
        ...(autoLockNow ? { locked: true, lockReason: "manual" as const } : {}),
        updatedAt: nowIso,
      };
    }),
  }));
}

// ===== 進行中の本文生成 run（復帰用）=====
// 本文生成は runId 即返し→ポーリングになったため、進行中の runId を保存しておき、
// /writer への再訪・タブ復帰・リロード時に再ポーリングして結果を回収する。

export type PendingRun = {
  projectId: string;
  chapterId: string;
  sectionId: string;
  chapterTitle: string;
  sectionTitle: string;
  runId: string;
  startedAt: string;
};

function pendingKey(projectId: string, chapterId: string, sectionId: string): string {
  return `${projectId}::${chapterId}::${sectionId}`;
}

export function loadPendingRuns(): Record<string, PendingRun> {
  if (!isBrowser()) return {};
  const raw = safeParse<Record<string, PendingRun>>(localStorage.getItem(KEY_PENDING_RUNS));
  return raw && typeof raw === "object" ? raw : {};
}

function savePendingRuns(map: Record<string, PendingRun>): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_PENDING_RUNS, JSON.stringify(map));
}

export function setPendingRun(run: PendingRun): void {
  const map = loadPendingRuns();
  map[pendingKey(run.projectId, run.chapterId, run.sectionId)] = run;
  savePendingRuns(map);
}

export function clearPendingRun(projectId: string, chapterId: string, sectionId: string): void {
  const map = loadPendingRuns();
  delete map[pendingKey(projectId, chapterId, sectionId)];
  savePendingRuns(map);
}

/** 指定プロジェクトの進行中 run（古すぎる=30分超は自動で捨てる） */
export function listPendingRuns(projectId: string): PendingRun[] {
  const map = loadPendingRuns();
  const now = Date.now();
  const alive: Record<string, PendingRun> = {};
  const out: PendingRun[] = [];
  let changed = false;
  for (const [k, r] of Object.entries(map)) {
    const age = now - new Date(r.startedAt).getTime();
    if (age > 30 * 60 * 1000) {
      changed = true; // 期限切れは捨てる
      continue;
    }
    alive[k] = r;
    if (r.projectId === projectId) out.push(r);
  }
  if (changed) savePendingRuns(alive);
  return out;
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

export function withStyleRules(base: PromptTemplate, genre?: import("./types").Genre): PromptTemplate {
  // 論文モードは「である調・学術文体」を論文仕様（PAPER_STYLE_OPTIONS）＋ prompt-draft-paper で
  // 指定するため、共通の新聞文体ガイド（共同通信・朝日準拠：一文40〜60字・用字用語など）は注入しない。
  // 学術文体と規律が衝突するため（ユーザー指摘・2026-07-19）。
  if (genre === "paper") return base;
  const all = loadPrompts();
  const style = all.find((p) => p.id === "prompt-style-rules");
  if (!style || !style.systemPrompt?.trim()) return base;
  return {
    ...base,
    systemPrompt: `${base.systemPrompt}\n\n【共通の校正・編集ルール（必ず守る）】\n${style.systemPrompt}`,
  };
}
