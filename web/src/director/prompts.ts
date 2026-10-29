import { AMBIENT_MODES, NONVERBALS, PHOTO_VERB, SFX_NAMES, STYLES, TAG, type LightMode } from "../cue/spec";
import type { ScareProfile } from "./profiles";

export const USER_MESSAGE = "Begin.";
export const REPAIR_LINE = "Your previous output broke the format. Output only the cue script.";

export interface PromptInput {
  profile: ScareProfile;
  /** JSON string of the vision inventories (M4). */
  inventory?: string;
  notes?: string;
  /** Photo id to reveal at the climax, when photos exist (M4). */
  bestPhotoId?: string;
}

const lightArg = (m: LightMode) => (m === "blackout" ? "blackout N" : m);

/** Tag reference generated from cue/spec.ts so the prompt can never drift from the parser. */
function tagReference(p: ScareProfile): string {
  return [
    [`[${TAG.pause} N]`, ...STYLES.map((s) => `[${s}]`), ...NONVERBALS.map((n) => `[${n}]`)].join(" "),
    `[${TAG.sfx} ${SFX_NAMES.join("|")}]`,
    `[${TAG.light} ${p.lights.map(lightArg).join("|")}] [${TAG.ambient} ${AMBIENT_MODES.join("|")}]`,
  ]
    .map((l) => `   ${l}`)
    .join("\n");
}

/** The style example must only use tags this level allows, or small models will copy the violation. */
function example(p: ScareProfile): string {
  const flicker = p.lights.includes("flicker") ? `[${TAG.light} flicker]` : `[${TAG.light} pulse]`;
  const blackout = p.lights.includes("blackout") ? `[${TAG.light} blackout 3]` : `[${TAG.light} calm]`;
  return [
    `[${TAG.ambient} low]`,
    "You told yourself the hallway light was off when you left.",
    `[${TAG.pause} 1.5]`,
    "[whisper] It isn't now.",
    `[${TAG.sfx} creak] ${flicker}`,
    `[${TAG.pause} 3]`,
    `The grey coat on your door [${TAG.pause} 0.8] [slow] has one sleeve raised.`,
    `[gasp] ${blackout}`,
  ].join("\n");
}

export function buildSystemPrompt(i: PromptInput): string {
  const p = i.profile;
  const photoRule = i.bestPhotoId
    ? `Use [${TAG.photo} ${PHOTO_VERB} ${i.bestPhotoId}] exactly once, at the climax.`
    : `Do not use [${TAG.photo} ${PHOTO_VERB}].`;

  return `You write and direct short horror audio dramas that are performed aloud to one listener in a dark room.

LISTENER'S PLACE (from their own photos):
${i.inventory?.trim() || "No photos. Invent an ordinary modern home."}

LISTENER'S NOTES:
${i.notes?.trim() || "None."}

SCARE LEVEL ${p.level} — ${p.name}:
- Length: ${p.words[0]}–${p.words[1]} words of spoken text.
- Jump scares: ${p.jumps}. Build slowly; earn each one with silence first.
- Effects budget: at most ${p.budget} [sfx]/[light] tags in total.
- Ending: ${p.ending}.
- Content limits: ${p.ceiling}. Never sexual content, never harm to children, never self-harm.

WRITING RULES:
1. Second person, present tense ("You hear..."). Written for the ear: short sentences, rhythm, repetition.
2. Set it in the listener's place. Use at least 3 concrete objects from the inventory, by name, where they are.
3. Output ONLY the cue script. One beat per line. No title, no markdown, no notes, no explanations.
4. Use ONLY these tags, exactly as written:
${tagReference(p)}
   ${photoRule}
5. Silence is your strongest tool. Use [${TAG.pause}] generously before reveals.
6. Start with [${TAG.ambient} low]. End with [${TAG.pause} 3] then [${TAG.ambient} stop].
7. Never mention AI, models, photos, or that this is a story.

EXAMPLE STYLE (do not reuse its content):
${example(p)}`;
}
