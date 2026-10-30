// Story length vs. hardware. The plan's word counts assume speech can be made roughly as fast as it is
// played; on slow machines that means minutes of waiting, so the range can be scaled down.
import type { ScareProfile } from "./profiles";

export type LengthMode = "auto" | "short" | "full";

/** Spoken seconds per word at the narration speed (about 140 wpm, ADR-010). */
export const SECONDS_PER_WORD = 0.43;
/**
 * Playback is longer than the speech alone (gaps between sentences, explicit pauses, sound effects).
 * 1.5 is an estimate from the sample and early stories, not a measurement.
 */
export const PLAYBACK_MULTIPLIER = 1.5;
/** Auto aims for playback to start within about this long after the story text exists. */
export const TARGET_WAIT_SECONDS = 90;
/** Auto never shrinks a story below this share of the plan's range. */
export const MIN_FACTOR = 0.35;
export const SHORT_FACTOR = 0.5;

/**
 * Words the machine can speak while keeping the start wait near the target.
 * With streaming, the wait is about (synthesis time - playback time) of the whole story:
 *   words * SPW * (rtf - PLAYBACK_MULTIPLIER) <= TARGET_WAIT.
 * At rtf <= PLAYBACK_MULTIPLIER synthesis keeps up with playback, so there is no limit.
 */
export function maxWordsForSpeed(rtf: number): number {
  if (!Number.isFinite(rtf) || rtf <= PLAYBACK_MULTIPLIER) return Infinity;
  return TARGET_WAIT_SECONDS / (SECONDS_PER_WORD * (rtf - PLAYBACK_MULTIPLIER));
}

/** Factor applied to a level's word range: 1 = the plan's range. */
export function lengthFactor(mode: LengthMode, profile: ScareProfile, rtf?: number): number {
  if (mode === "full") return 1;
  if (mode === "short") return SHORT_FACTOR;
  if (rtf === undefined) return 1; // no speed test yet: do not guess
  const mid = (profile.words[0] + profile.words[1]) / 2;
  return Math.min(1, Math.max(MIN_FACTOR, maxWordsForSpeed(rtf) / mid));
}

/** The level's word range scaled by `factor`, rounded to tens. */
export function scaledWords(profile: ScareProfile, factor: number): [number, number] {
  const r = (n: number) => Math.max(10, Math.round((n * factor) / 10) * 10);
  return [r(profile.words[0]), r(profile.words[1])];
}
