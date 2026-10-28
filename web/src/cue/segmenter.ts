import type { CueEvent, Style } from "./spec";

export interface SegmentOptions {
  /** Hard limit per segment (adapter.caps.maxChars). */
  maxChars: number;
  /**
   * Soft target: merge consecutive same-style sentences while the merged text
   * stays within this many chars. 0 = never merge (one sentence per segment, Kokoro).
   */
  targetChars: number;
}

type SpeechEvent = Extract<CueEvent, { kind: "speech" }>;

/** Split text into sentences, keeping terminal punctuation. Naive: "Mr." will split. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) ?? [];
  return parts.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** Break an over-long sentence at commas, then spaces, so no piece exceeds max. */
function hardSplit(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    if (cut < max * 0.4) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max; // no space at all: cut hard
    else cut += 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Split speech events into sentences and merge adjacent same-style sentences
 * up to targetChars. Non-speech events pass through and act as merge barriers,
 * so a pause or sfx between two sentences is never swallowed.
 */
export function segment(events: CueEvent[], opts: SegmentOptions): CueEvent[] {
  const out: CueEvent[] = [];
  let pending: SpeechEvent | null = null;

  const flush = () => {
    if (pending) out.push(pending);
    pending = null;
  };

  for (const ev of events) {
    if (ev.kind !== "speech") {
      flush();
      out.push(ev);
      continue;
    }
    for (const sentence of splitSentences(ev.text).flatMap((s) => hardSplit(s, opts.maxChars))) {
      const p: SpeechEvent | null = pending;
      if (p && p.style === (ev.style as Style) && p.text.length + 1 + sentence.length <= Math.min(opts.targetChars, opts.maxChars)) {
        p.text += " " + sentence;
      } else {
        flush();
        pending = { kind: "speech", text: sentence, style: ev.style };
      }
    }
  }
  flush();
  return out;
}
