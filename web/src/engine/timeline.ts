// Walks cue events with a time cursor and produces a flat list of timed events.
import type { CueEvent, NonVerbal } from "../cue/spec";

/** Tunables that shape how the narration *feels*. Ear-tuned guesses; see Docs/ADR.md (ADR-010). */
export const PACING = {
  /** Silence added after every speech segment (sentence), on top of explicit [pause]s. */
  speechGap: 0.45,
  /** Seconds a non-verbal occupies on the timeline. */
  nonverbal: { breath: 0.9, sigh: 1.3, gasp: 0.6, laugh: 1.1 } satisfies Record<NonVerbal, number>,
  /** Silence after the last event before the story is considered finished. */
  tail: 0.6,
  /** [ambient stop] fades out over this long; the story must not end before the fade does. */
  ambientStopFade: 3,
  /** Ambient ducking: gain while speech plays, ramp times, and gaps that don't re-open the bed. */
  duckGain: 0.5, // ~ -6 dB
  duckRampIn: 0.25,
  duckRampOut: 0.6,
  duckMergeGap: 1.0,
} as const;

export interface TimedEvent {
  /** Seconds from the start of the timeline. */
  at: number;
  /** Seconds the event occupies (0 for instantaneous events). */
  duration: number;
  ev: CueEvent;
  buffer?: AudioBuffer;
}

export interface Timeline {
  items: TimedEvent[];
  total: number;
}

export function schedule(events: CueEvent[], buffers: ReadonlyMap<CueEvent, AudioBuffer>): Timeline {
  const items: TimedEvent[] = [];
  let cursor = 0;
  let end = 0;

  for (const ev of events) {
    switch (ev.kind) {
      case "speech": {
        const buffer = buffers.get(ev);
        const duration = buffer?.duration ?? 0;
        items.push({ at: cursor, duration, ev, buffer });
        cursor += duration + PACING.speechGap;
        break;
      }
      case "pause":
        items.push({ at: cursor, duration: ev.seconds, ev });
        cursor += ev.seconds;
        break;
      case "nonverbal": {
        const duration = PACING.nonverbal[ev.nv];
        items.push({ at: cursor, duration, ev });
        cursor += duration;
        break;
      }
      case "ambient":
        items.push({ at: cursor, duration: 0, ev });
        if (ev.mode === "stop") end = Math.max(end, cursor + PACING.ambientStopFade);
        break;
      default:
        // sfx / light / ambient / photo are stamped at the cursor and take no time
        items.push({ at: cursor, duration: 0, ev });
    }
  }
  return { items, total: Math.max(cursor + PACING.tail, end) };
}

/** Intervals during which the ambient bed should be ducked (speech spans, merged across short gaps). */
export function duckIntervals(items: TimedEvent[]): Array<[number, number]> {
  const spans = items
    .filter((i) => i.ev.kind === "speech" && i.duration > 0)
    .map((i) => [i.at, i.at + i.duration] as [number, number]);
  const out: Array<[number, number]> = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] - last[1] < PACING.duckMergeGap) last[1] = s[1];
    else out.push([s[0], s[1]]);
  }
  return out;
}
