// Single source of truth for cue tags. Parser, router, prompts and effects import from here.

export const STYLES = ["whisper", "slow", "trembling", "shout"] as const;
export type StyleTag = (typeof STYLES)[number];
export type Style = "normal" | StyleTag;

export const NONVERBALS = ["breath", "sigh", "gasp", "laugh"] as const;
export type NonVerbal = (typeof NONVERBALS)[number];

export const SFX_NAMES = [
  "creak",
  "knock",
  "footsteps",
  "door",
  "heartbeat",
  "static",
  "drip",
  "scrape",
  "whispers",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export const LIGHT_MODES = ["flicker", "blackout", "red", "pulse", "calm"] as const;
export type LightMode = (typeof LIGHT_MODES)[number];

export const AMBIENT_MODES = ["low", "swell", "stop"] as const;
export type AmbientMode = (typeof AMBIENT_MODES)[number];

/** Tag names (first word inside the brackets). */
export const TAG = {
  pause: "pause",
  sfx: "sfx",
  light: "light",
  ambient: "ambient",
  photo: "photo",
} as const;

export const PHOTO_VERB = "reveal";

/** [pause N] is clamped to this range (seconds). */
export const PAUSE_MIN = 0.2;
export const PAUSE_MAX = 6;
/** Used when [pause] has a missing or unparsable argument. */
export const PAUSE_DEFAULT = 1;

/** [light blackout N]: same clamp as pause, default when N is missing/bad. */
export const BLACKOUT_MIN = PAUSE_MIN;
export const BLACKOUT_MAX = PAUSE_MAX;
export const BLACKOUT_DEFAULT = 2;

export type CueEvent =
  | { kind: "speech"; text: string; style: Style }
  | { kind: "nonverbal"; nv: NonVerbal }
  | { kind: "pause"; seconds: number }
  | { kind: "sfx"; name: SfxName }
  | { kind: "light"; mode: LightMode; seconds?: number }
  | { kind: "ambient"; mode: AmbientMode }
  | { kind: "photo"; id: string };

/** Every word that is a recognised tag name; used to recognise stray junk like "(pause 2)". */
export const ALL_TAG_WORDS: readonly string[] = [
  ...Object.values(TAG),
  ...STYLES,
  ...NONVERBALS,
];

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
