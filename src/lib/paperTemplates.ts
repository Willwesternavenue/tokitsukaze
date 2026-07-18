import type { OutlineProposal, OutlineType, PaperMeta, PaperType } from "./types";
import { makeId } from "./ids";

/**
 * 論文モード: 構成テンプレート（AIを使わず章立てを即確定するための骨格）。
 * 各章は「役割」を持ち、summary 冒頭に【役割: …】タグを付ける
 * （prompt-sections-paper / prompt-draft-paper がその役割に沿って節・本文を展開する）。
 */

export type PaperTemplateRole = { title: string; guide: string };

export type PaperTemplate = {
  id: string;
  label: string;
  outlineType: OutlineType; // 既存 OutlineType にマップ（表示・整合のため）
  recommendedFor?: PaperType; // どの論文種別と最も相性が良いか
  concept: string;
  roles: PaperTemplateRole[];
};

export const PAPER_TEMPLATES: PaperTemplate[] = [
  {
    id: "imrad",
    label: "IMRaD（実証・原著）",
    outlineType: "chronological",
    recommendedFor: "empirical",
    concept: "実証研究の標準形。序論→方法→結果→考察→結論で、RQに証拠で答える。",
    roles: [
      { title: "序論", guide: "背景・問題設定・リサーチクエスチョン・本研究の貢献" },
      { title: "方法", guide: "対象・手続き・データ・分析方法。再現可能な粒度で" },
      { title: "結果", guide: "得られた事実のみを提示（解釈は考察へ）" },
      { title: "考察", guide: "結果の解釈・先行研究との対応・限界" },
      { title: "結論", guide: "貢献の要約と今後の展望" },
    ],
  },
  {
    id: "cs-method",
    label: "CS・情報系（提案手法型）",
    outlineType: "chronological",
    recommendedFor: "ai-cs",
    concept: "情報系の標準形。序論→関連研究→提案手法→実験・評価→考察→結論。",
    roles: [
      { title: "序論", guide: "課題・動機・貢献（contributions）を箇条書きで明示" },
      { title: "関連研究", guide: "既存研究の整理と本研究の差分（何が新しいか）" },
      { title: "提案手法", guide: "手法・アルゴリズム・定式化。再現可能に" },
      { title: "実験・評価", guide: "データセット・実験条件・ベースライン・評価指標・結果" },
      { title: "考察", guide: "結果の分析・アブレーション・失敗例・適用範囲" },
      { title: "結論", guide: "貢献の要約と今後の展望" },
    ],
  },
  {
    id: "review",
    label: "総説・レビュー",
    outlineType: "thematic",
    recommendedFor: "review",
    concept: "先行研究の整理・統合。テーマ設定→レビュー方法→論点別整理→統合と展望。",
    roles: [
      { title: "はじめに", guide: "レビューの目的・範囲・意義" },
      { title: "レビューの方法", guide: "対象文献の選定基準・範囲・整理の観点" },
      { title: "論点別レビュー", guide: "系譜・論点ごとに先行研究を整理（複数節になる）" },
      { title: "統合と展望", guide: "全体の統合・未解決の課題・今後の方向" },
    ],
  },
  {
    id: "humanities",
    label: "人文・社会（章立て論証）",
    outlineType: "narrative",
    recommendedFor: "humanities",
    concept: "理論・思想・歴史研究の標準形。問題設定→各論→結論。",
    roles: [
      { title: "問題設定", guide: "問い・先行研究・本稿の立場と射程" },
      { title: "第一の論点", guide: "論点1の論証（史料・理論・分析）" },
      { title: "第二の論点", guide: "論点2の論証" },
      { title: "結論", guide: "論証の総括と含意" },
    ],
  },
  {
    id: "case-study",
    label: "事例研究（ケーススタディ）",
    outlineType: "chronological",
    recommendedFor: "empirical",
    concept: "単一・少数事例の分析。序論→背景・事例概要→分析→考察→結論。",
    roles: [
      { title: "序論", guide: "問題設定・事例を扱う意義・RQ" },
      { title: "背景・事例概要", guide: "対象事例の背景・経緯・記述" },
      { title: "分析", guide: "分析枠組みに沿った事例の分析" },
      { title: "考察", guide: "知見の一般化可能性・先行研究との対応・限界" },
      { title: "結論", guide: "含意と今後の展望" },
    ],
  },
  {
    id: "system-report",
    label: "システム・実装報告",
    outlineType: "chronological",
    recommendedFor: "ai-cs",
    concept: "システム/ツールの設計・実装報告。序論→要件→設計→実装→評価→議論→結論。",
    roles: [
      { title: "序論", guide: "背景・課題・本システムの目的と貢献" },
      { title: "要件", guide: "解決すべき要件・制約" },
      { title: "設計", guide: "アーキテクチャ・設計判断とその根拠" },
      { title: "実装", guide: "実装の要点・技術選定" },
      { title: "評価", guide: "評価方法・結果（性能・ユーザ評価等）" },
      { title: "議論", guide: "限界・適用範囲・今後の課題" },
      { title: "結論", guide: "成果の要約" },
    ],
  },
];

export function paperTemplateById(id: string | undefined): PaperTemplate | undefined {
  return PAPER_TEMPLATES.find((t) => t.id === id);
}

/**
 * テンプレートから章立て（OutlineProposal）を決定論的に組み立てる。
 * 各役割が1章になり、小見出し（節）は空で返す（後段の generate-sections で展開）。
 */
export function buildPaperOutline(
  template: PaperTemplate,
  paperMeta?: PaperMeta,
  titleHint?: string,
): OutlineProposal {
  const title =
    (titleHint && titleHint.trim()) ||
    (paperMeta?.researchQuestion && paperMeta.researchQuestion.trim()) ||
    `${template.label}の論文`;
  return {
    id: `outline-${makeId("paper")}`,
    title,
    type: template.outlineType,
    concept: template.concept,
    recommendedFor: `${template.label} テンプレート`,
    chapters: template.roles.map((role, i) => ({
      id: `chapter-${makeId("ch")}`,
      chapterNumber: i + 1,
      title: role.title,
      summary: `【役割: ${role.title}】${role.guide}`,
      sections: [],
    })),
  };
}
