import { AMBIENT_MODES, NONVERBALS, PHOTO_VERB, SFX_NAMES, STYLES, TAG, type LightMode } from "../cue/spec";
import type { ScareProfile } from "./profiles";
import { scaledWords } from "./length";

export const USER_MESSAGE = "Begin.";
export const REPAIR_LINE = "Your previous output broke the format. Output only the cue script.";

export interface PromptInput {
  profile: ScareProfile;
  /** JSON string of the vision inventories (M4). */
  inventory?: string;
  notes?: string;
  /** Photo id to reveal at the climax, when photos exist (M4). */
  bestPhotoId?: string;
  /** Scales the level's word range (1 = the plan's range). See director/length.ts. */
  lengthFactor?: number;
  /** A premise seed to build the story around (director/seeds.ts). */
  premise?: string;
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
  const [minWords, maxWords] = scaledWords(p, i.lengthFactor ?? 1);
  const photoRule = i.bestPhotoId
    ? `Use [${TAG.photo} ${PHOTO_VERB} ${i.bestPhotoId}] exactly once, at the climax.`
    : `Do not use [${TAG.photo} ${PHOTO_VERB}].`;

  return `You write and direct short horror audio dramas that are performed aloud to one listener in a dark room.

LISTENER'S PLACE (from their own photos):
${i.inventory?.trim() || "No photos. Invent an ordinary modern home."}

LISTENER'S NOTES:
${i.notes?.trim() || "None."}

SCARE LEVEL ${p.level} — ${p.name}:
- Length: ${minWords}–${maxWords} words of spoken text.
- Jump scares: ${p.jumps}. Build slowly; earn each one with silence first.
- Effects budget: at most ${p.budget} [sfx]/[light] tags in total.
- Ending: ${p.ending}.
- Content limits: ${p.ceiling}. Never sexual content, never harm to children, never self-harm.

STORY SHAPE (it must be complete and stand on its own):
- Opening, about the first fifth: an ordinary, calm moment in the listener's place, told concretely.
- Middle: three small wrong things, each stranger than the last, with silence between them.
- Climax: the wrongness becomes unmistakable.
- Ending: ${p.ending}. The last spoken line must close the story, not trail off, and you must not stop mid-scene.
- Use [${TAG.light} ...] at least ${p.minLights} time${p.minLights === 1 ? "" : "s"}, timed to the tense moments.
${i.premise ? `
PREMISE (a seed: build the story around it and make it your own; never call it a premise; the ending rule above overrides it):
${i.premise}
` : ""}
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

/** Vision pass system prompt (verbatim from PLAN.md, M4). */
export const VISION_PROMPT = `You are a set designer for a horror radio play. You will see one photo of a real place from the listener's life.
Describe only what is physically visible, concretely, as material for a story set in this exact place.
Never identify anyone or describe a person's face, age, body or identity. If a person is visible, write only "a person" and where they are.
Return ONLY JSON:
{
  "place": string,
  "time_of_day": string,
  "lighting": string,
  "objects": [{ "name": string, "where": string, "detail": string }],
  "textures_and_sounds": string[],
  "unsettling_potential": string[]
}
"objects": 5–12 items. "unsettling_potential": 3–5 small real details that could turn eerie (a door ajar, a coat on a hook, a dark window).`;
