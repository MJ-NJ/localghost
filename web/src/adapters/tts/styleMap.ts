// The whole cue -> voice mapping lives here, so tuning a style or fixing a tag spelling is one edit.
// ElevenLabs takes inline audio tags; Kokoro has none, so its styles are emulated with speed and an audio chain.
import type { NonVerbal, Style } from "../../cue/spec";

/**
 * ElevenLabs inline audio tags. `[whispers] [sighs] [laughs] [gasps] [slowly]` are in ElevenLabs' own docs;
 * `[shouting]` appears in the v4 docs (the plan said `[shouts]`); `[nervous]` is the closest documented-style
 * tag for trembling and is the least certain. Tags are free-form directions, not a closed list, so a wrong
 * spelling degrades gracefully instead of failing. Verify by ear and adjust here.
 */
export const ELEVEN_STYLE_TAG: Record<Exclude<Style, "normal">, string> = {
  whisper: "[whispers]",
  slow: "[slowly]",
  trembling: "[nervous]",
  shout: "[shouting]",
};

/** `breath` has no ElevenLabs tag: it stays a procedural sound effect. */
export const ELEVEN_NONVERBAL_TAG: Partial<Record<NonVerbal, string>> = {
  sigh: "[sighs]",
  gasp: "[gasps]",
  laugh: "[laughs]",
};

/** Text sent to ElevenLabs: optional leading non-verbal tag, optional style tag, then the words. */
export function elevenText(seg: { text: string; style: Style; leadingNonverbal?: NonVerbal }): string {
  const nv = seg.leadingNonverbal && ELEVEN_NONVERBAL_TAG[seg.leadingNonverbal];
  const style = seg.style !== "normal" ? ELEVEN_STYLE_TAG[seg.style] : undefined;
  return [nv, style, seg.text].filter(Boolean).join(" ");
}

/** Kokoro speed per style (the library's own speed option). Baseline is slower than 1.0 for narration (ADR-010). */
export const KOKORO_BASE_SPEED = 0.92;
export const KOKORO_SPEED: Partial<Record<Style, number>> = {
  slow: 0.78,
  whisper: KOKORO_BASE_SPEED * 0.95, // plan: speed 0.95 for whisper
};
export const kokoroSpeed = (style: Style) => KOKORO_SPEED[style] ?? KOKORO_BASE_SPEED;

/**
 * Kokoro style emulation applied in the audio graph (engine/audioGraph.ts) to styles the adapter
 * does not do natively. Values are from PLAN.md M5 and are untuned guesses.
 */
export const KOKORO_EMULATION = {
  whisper: { gain: 0.6, highpassHz: 300, reverbSend: 0.5 },
  trembling: { detuneCents: 15, lfoHz: 6 },
  shout: { gain: 1.2, clipAmount: 2.2 },
} as const;
