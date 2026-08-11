import { parseScreenplayBody } from "@/lib/screenplay";
import type { SceneMeta, ReferenceCharacterCard } from "@/lib/types";

export type StoryboardPromptInput = {
  sceneTitle?: string;
  sceneMeta?: SceneMeta;
  body: string;
  characters?: ReferenceCharacterCard[];
};

export const STORYBOARD_STYLE_SUFFIX =
  "cinematic film still, color, dramatic cinematic lighting, cohesive art direction, no text, no watermark";

const ACTION_CHAR_LIMIT = 600;

/** ト書き(action)行だけを決定的に連結し、字数上限で切り詰める。AI呼び出しはしない。 */
function condenseAction(body: string): string {
  const lines = parseScreenplayBody(body);
  const action = lines
    .filter((l) => l.kind === "action")
    .map((l) => (l as { text: string }).text.trim())
    .filter(Boolean)
    .join(" ");
  return action.length > ACTION_CHAR_LIMIT ? action.slice(0, ACTION_CHAR_LIMIT) + "…" : action;
}

function describeCharacters(input: StoryboardPromptInput): string {
  const present = input.sceneMeta?.presentCharacters ?? [];
  const cards = input.characters ?? [];
  const picked = present.length
    ? cards.filter((c) => present.includes(c.name))
    : [];
  if (picked.length === 0) return "";
  const lines = picked.map((c) => {
    const facts = (c.facts ?? []).filter(Boolean).join("、");
    return `- ${c.name}: ${facts || "（外見設定なし）"}`;
  });
  return `Characters (keep them visually consistent):\n${lines.join("\n")}`;
}

export function buildStoryboardPrompt(input: StoryboardPromptInput): string {
  const m = input.sceneMeta;
  const sluglineParts = [
    m?.intExt,
    m?.location,
    m?.timeOfDay,
  ].filter(Boolean);
  const slug = sluglineParts.length ? `Scene: ${sluglineParts.join(" · ")}` : "";
  const purpose = m?.purpose ? `Dramatic intent: ${m.purpose}` : "";
  const action = condenseAction(input.body);
  const actionBlock = action ? `Action in frame: ${action}` : "";
  const chars = describeCharacters(input);

  const blocks = [
    "Create a single storyboard frame for a film scene.",
    slug,
    purpose,
    actionBlock,
    chars,
    `Style: ${STORYBOARD_STYLE_SUFFIX}`,
  ].filter(Boolean);

  return blocks.join("\n\n");
}
