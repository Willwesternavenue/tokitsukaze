import type { Project, Section, SectionDraft } from "./types";

/**
 * 脚本モードのプロ向け解析・変換（すべて決定論的・AI不使用）。
 *
 * 本文フォーマット（prompt-draft-screenplay が生成する形式）:
 *   柱     : 「○ ロケーション名（INT・夜）」
 *   ト書き : 全角スペース始まりの行（例: 「　古い活版印刷機。…」）
 *   セリフ : 話者名だけの行 → 次の行に「セリフ」
 */

// ===== 本文パーサ =====

export type ScreenplayLine =
  | { kind: "slug"; text: string }
  | { kind: "action"; text: string }
  | { kind: "cue"; speaker: string }
  | { kind: "dialogue"; speaker: string; text: string };

/** 話者候補: 短い・句点や括弧書きで終わらない・記号始まりでない行 */
function isSpeakerCandidate(trimmed: string): boolean {
  if (!trimmed || trimmed.length > 14) return false;
  if (/^[○●◯「『（(＃#＝=・\-〜―]/.test(trimmed)) return false;
  if (/[。、！？!?」』]/.test(trimmed)) return false;
  return true;
}

export function parseScreenplayBody(body: string): ScreenplayLine[] {
  const rawLines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: ScreenplayLine[] = [];
  let pendingSpeaker: string | null = null;

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (/^[○◯]/.test(trimmed)) {
      pendingSpeaker = null;
      out.push({ kind: "slug", text: trimmed });
      continue;
    }
    if (/^「/.test(trimmed) || /^（[^）]*）「/.test(trimmed)) {
      if (pendingSpeaker) {
        out.push({ kind: "cue", speaker: pendingSpeaker });
        out.push({ kind: "dialogue", speaker: pendingSpeaker, text: trimmed });
        pendingSpeaker = null;
      } else {
        // 話者行が省略された「」行は直前の話者の続き or ト書き扱い
        const lastDialogue = [...out].reverse().find((l) => l.kind === "dialogue") as
          | { kind: "dialogue"; speaker: string }
          | undefined;
        if (lastDialogue) {
          out.push({ kind: "dialogue", speaker: lastDialogue.speaker, text: trimmed });
        } else {
          out.push({ kind: "action", text: trimmed });
        }
      }
      continue;
    }
    // 直前に話者候補を積んでいたがセリフが来なかった → ト書きに戻す
    if (pendingSpeaker) {
      out.push({ kind: "action", text: pendingSpeaker });
      pendingSpeaker = null;
    }
    if (raw.startsWith("　") || raw.startsWith("  ")) {
      out.push({ kind: "action", text: trimmed });
      continue;
    }
    if (isSpeakerCandidate(trimmed)) {
      pendingSpeaker = trimmed;
      continue;
    }
    out.push({ kind: "action", text: trimmed });
  }
  if (pendingSpeaker) out.push({ kind: "action", text: pendingSpeaker });
  return out;
}

// ===== 実測尺（本文からの尺推定） =====

/**
 * 実測尺（分）。換算の目安:
 *   セリフ ≈ 320字/分（発話速度）、ト書き ≈ 450字/分（アクションは文字数より画で時間を食うが、
 *   ト書きは要約的に書かれるため1字あたりの実時間は長め＝分母を小さくしすぎない）
 * prompt の目安「250〜350字 ≈ 1分」と整合するよう係数を選んでいる。
 */
export type SceneRuntime = {
  dialogueChars: number;
  actionChars: number;
  dialogueLines: number;
  estimatedMinutes: number;
};

export function measureRuntime(body: string): SceneRuntime {
  const lines = parseScreenplayBody(body);
  let dialogueChars = 0;
  let actionChars = 0;
  let dialogueLines = 0;
  for (const l of lines) {
    if (l.kind === "dialogue") {
      dialogueChars += l.text.replace(/[「」]/g, "").length;
      dialogueLines++;
    } else if (l.kind === "action") {
      actionChars += l.text.length;
    }
  }
  const estimatedMinutes = dialogueChars / 320 + actionChars / 450;
  return {
    dialogueChars,
    actionChars,
    dialogueLines,
    estimatedMinutes: Math.round(estimatedMinutes * 10) / 10,
  };
}

/** 想定尺との乖離レベル（尺・テンポチェックの閾値と同じ: ±40%=warn、2倍/半分=error） */
export function runtimeDeviation(
  measured: number,
  planned: number | undefined,
): "ok" | "warn" | "error" | null {
  if (!planned || planned <= 0 || measured <= 0) return null;
  const ratio = measured / planned;
  if (ratio >= 2 || ratio <= 0.5) return "error";
  if (ratio >= 1.4 || ratio <= 0.6) return "warn";
  return "ok";
}

// ===== キャラクター出番・台詞バランス分析 =====

export type CharacterStat = {
  name: string;
  /** 登場シーン数（sceneMeta.presentCharacters ∪ セリフ話者） */
  appearances: number;
  dialogueLines: number;
  dialogueChars: number;
  /** 全セリフに占める台詞シェア（0〜1） */
  dialogueShare: number;
  firstSceneIndex: number; // 0-based（構成順）
  lastSceneIndex: number;
  /** 初登場〜最終登場の間で、連続して出てこないシーン数の最大値 */
  maxGap: number;
  registered: boolean; // 登場人物ナレッジに登録済みか
};

type FlatScene = {
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  section: Section;
  draft?: SectionDraft;
};

export function flattenScenes(project: Project): FlatScene[] {
  const out: FlatScene[] = [];
  for (const c of project.selectedOutline?.chapters ?? []) {
    for (const s of c.sections ?? []) {
      out.push({
        chapterId: c.id,
        chapterTitle: c.title,
        chapterNumber: c.chapterNumber,
        section: s,
        draft: project.generatedSections.find(
          (d) => d.chapterId === c.id && d.sectionId === s.id,
        ),
      });
    }
  }
  return out;
}

/** 話者名の正規化: 「佐藤（45）」「佐藤の声」→「佐藤」 */
export function normalizeSpeaker(name: string): string {
  return name
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/の声$/, "")
    .trim();
}

export function characterStats(project: Project): CharacterStat[] {
  const scenes = flattenScenes(project);
  const registered = new Set((project.characters ?? []).map((c) => c.name));
  const byName = new Map<
    string,
    { scenes: Set<number>; lines: number; chars: number }
  >();
  const touch = (name: string) => {
    const key = normalizeSpeaker(name);
    if (!key) return null;
    if (!byName.has(key)) byName.set(key, { scenes: new Set(), lines: 0, chars: 0 });
    return byName.get(key)!;
  };

  scenes.forEach((sc, idx) => {
    for (const name of sc.section.sceneMeta?.presentCharacters ?? []) {
      touch(name)?.scenes.add(idx);
    }
    if (sc.draft?.body) {
      for (const l of parseScreenplayBody(sc.draft.body)) {
        if (l.kind === "dialogue") {
          const rec = touch(l.speaker);
          if (rec) {
            rec.scenes.add(idx);
            rec.lines++;
            rec.chars += l.text.replace(/[「」]/g, "").length;
          }
        }
      }
    }
  });
  // ナレッジ登録済みでまだ出番ゼロのキャラも一覧に出す（出番の欠落に気づけるように）
  for (const name of registered) touch(name);

  const totalChars = [...byName.values()].reduce((a, x) => a + x.chars, 0);
  const stats: CharacterStat[] = [];
  for (const [name, rec] of byName) {
    const indices = [...rec.scenes].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < indices.length; i++) {
      maxGap = Math.max(maxGap, indices[i] - indices[i - 1] - 1);
    }
    stats.push({
      name,
      appearances: indices.length,
      dialogueLines: rec.lines,
      dialogueChars: rec.chars,
      dialogueShare: totalChars > 0 ? rec.chars / totalChars : 0,
      firstSceneIndex: indices[0] ?? -1,
      lastSceneIndex: indices[indices.length - 1] ?? -1,
      maxGap,
      registered: registered.has(name),
    });
  }
  return stats.sort((a, b) => b.dialogueChars - a.dialogueChars || b.appearances - a.appearances);
}

// ===== 香盤表（ブレークダウン）CSV =====

const TOD_JA: Record<string, string> = {
  DAY: "昼",
  NIGHT: "夜",
  DAWN: "明け方",
  DUSK: "夕",
  CONTINUOUS: "続き",
};

export function todJa(tod: string | undefined): string {
  return TOD_JA[tod ?? ""] ?? "昼";
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 香盤表CSV: 制作向けのシーンブレークダウン（幕・柱・INT/EXT・時間帯・登場人物・尺） */
export function buildBreakdownCsv(project: Project): string {
  const header = [
    "No",
    "幕",
    "シーン",
    "INT/EXT",
    "時間帯",
    "ロケーション",
    "登場人物",
    "想定尺(分)",
    "実測尺(分)",
    "目的",
    "本文",
  ].join(",");
  const rows = flattenScenes(project).map((sc, i) => {
    const m = sc.section.sceneMeta;
    const rt = sc.draft?.body ? measureRuntime(sc.draft.body) : null;
    return [
      String(i + 1),
      csvEscape(`第${sc.chapterNumber}幕 ${sc.chapterTitle}`),
      csvEscape(sc.section.title),
      m?.intExt ?? "",
      m ? todJa(m.timeOfDay) : "",
      csvEscape(m?.location ?? ""),
      csvEscape((m?.presentCharacters ?? []).join("、")),
      m?.estimatedMinutes != null ? String(m.estimatedMinutes) : "",
      rt ? String(rt.estimatedMinutes) : "",
      csvEscape(m?.purpose ?? sc.section.summary ?? ""),
      sc.draft?.body ? "済" : "未",
    ].join(",");
  });
  return "﻿" + [header, ...rows].join("\n"); // BOM付き（Excel対策）
}

// ===== Fountain エクスポート =====

const TOD_EN: Record<string, string> = {
  DAY: "DAY",
  NIGHT: "NIGHT",
  DAWN: "DAWN",
  DUSK: "DUSK",
  CONTINUOUS: "CONTINUOUS",
};

/**
 * Fountain 形式（https://fountain.io）のテキストを組み立てる。
 * Final Draft / Highland / Slugline 等の業界ツールにそのまま読み込める。
 * 日本語の話者名は Fountain の強制キャラクター記法（@名前）を使う。
 * 未執筆シーンはシノプシス行（= 概要）として出力する。
 */
export function buildFountain(project: Project): string {
  const parts: string[] = [];
  parts.push(`Title: ${project.name}`);
  if (project.intervieweeName) parts.push(`Credit: 主人公 ${project.intervieweeName}`);
  parts.push(`Draft date: ${new Date().toISOString().slice(0, 10)}`);
  parts.push("");

  for (const c of project.selectedOutline?.chapters ?? []) {
    parts.push(`# 第${c.chapterNumber}幕 ${c.title}`);
    parts.push("");
    for (const s of c.sections ?? []) {
      const m = s.sceneMeta;
      if (m) {
        const intext = m.intExt === "INT/EXT" ? "INT./EXT." : `${m.intExt}.`;
        parts.push(`${intext} ${m.location} - ${TOD_EN[m.timeOfDay] ?? "DAY"}`);
      } else {
        parts.push(`.${s.title}`); // 強制シーン見出し
      }
      parts.push("");

      const draft = project.generatedSections.find(
        (d) => d.chapterId === c.id && d.sectionId === s.id,
      );
      if (!draft?.body) {
        parts.push(`= ${s.summary || s.title}（未執筆）`);
        parts.push("");
        continue;
      }
      const lines = parseScreenplayBody(draft.body);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.kind === "slug") continue; // 柱は sceneMeta から出力済み
        if (l.kind === "cue") {
          parts.push(`@${l.speaker}`);
          continue;
        }
        if (l.kind === "dialogue") {
          parts.push(l.text.replace(/^「/, "").replace(/」$/, ""));
          if (lines[i + 1]?.kind !== "dialogue") parts.push("");
          continue;
        }
        parts.push(l.text);
        parts.push("");
      }
    }
  }
  return parts.join("\n");
}
