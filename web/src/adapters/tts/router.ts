// Fits a parsed story to a TTS adapter: folds non-verbals the adapter can perform into the next
// speech segment, and splits/merges speech to the adapter's segment limits.
import { segment } from "../../cue/segmenter";
import type { CueEvent, NonVerbal } from "../../cue/spec";
import type { TTSAdapter } from "./types";

type Speech = Extract<CueEvent, { kind: "speech" }>;

/** Kinds that take no time on the timeline, so a non-verbal can still sit "directly before" speech across them. */
const INSTANT = new Set<CueEvent["kind"]>(["sfx", "light", "ambient", "photo"]);

/**
 * For adapters with native non-verbals (ElevenLabs), `[sigh] Hello` becomes one segment `[sighs] Hello`
 * instead of a noise-burst sound effect followed by speech. Non-verbals the adapter cannot do (breath),
 * or that are not followed by speech, stay as events and are played as procedural sounds.
 */
export function foldNonverbals(events: CueEvent[], native: ReadonlySet<NonVerbal>): CueEvent[] {
  if (native.size === 0) return events;
  const out: CueEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === "nonverbal" && native.has(ev.nv)) {
      let j = i + 1;
      while (j < events.length && INSTANT.has(events[j].kind)) j++;
      const next = events[j];
      if (next && next.kind === "speech" && !next.leadingNonverbal) {
        // keep the instant events that sat in between, then the speech with the non-verbal attached
        out.push(...events.slice(i + 1, j), { ...next, leadingNonverbal: ev.nv } as Speech);
        i = j;
        continue;
      }
    }
    out.push(ev);
  }
  return out;
}

export function routeForAdapter(events: CueEvent[], adapter: TTSAdapter): CueEvent[] {
  const folded = foldNonverbals(events, adapter.caps.nonverbals);
  return segment(folded, { maxChars: adapter.caps.maxChars, targetChars: adapter.caps.targetChars });
}
