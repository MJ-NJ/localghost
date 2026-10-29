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

/**
 * Builds the timeline incrementally. advance() walks events as far as the synthesized
 * buffers allow and stops at the first speech event that has none yet (streaming playback).
 */
export class TimelineBuilder {
  readonly items: TimedEvent[] = [];
  private i = 0;
  private cursor = 0;
  private ambientEnd = 0;

  constructor(private readonly events: readonly CueEvent[]) {}

  /** Returns the items added by this call. */
  advance(buffers: ReadonlyMap<CueEvent, AudioBuffer>): TimedEvent[] {
    const added: TimedEvent[] = [];
    const push = (t: TimedEvent) => {
      this.items.push(t);
      added.push(t);
    };
    while (this.i < this.events.length) {
      const ev = this.events[this.i];
      if (ev.kind === "speech") {
        const buffer = buffers.get(ev);
        if (!buffer) break; // not synthesized yet
        push({ at: this.cursor, duration: buffer.duration, ev, buffer });
        this.cursor += buffer.duration + PACING.speechGap;
      } else if (ev.kind === "pause") {
        push({ at: this.cursor, duration: ev.seconds, ev });
        this.cursor += ev.seconds;
      } else if (ev.kind === "nonverbal") {
        const duration = PACING.nonverbal[ev.nv];
        push({ at: this.cursor, duration, ev });
        this.cursor += duration;
      } else {
        // sfx / light / ambient / photo are stamped at the cursor and take no time
        push({ at: this.cursor, duration: 0, ev });
        if (ev.kind === "ambient" && ev.mode === "stop") {
          this.ambientEnd = Math.max(this.ambientEnd, this.cursor + PACING.ambientStopFade);
        }
      }
      this.i++;
    }
    return added;
  }

  /** Every event has been placed on the timeline. */
  get complete(): boolean {
    return this.i >= this.events.length;
  }

  /** Timeline seconds known so far; while incomplete, where the next unsynthesized speech would start. */
  get frontier(): number {
    return this.cursor;
  }

  get total(): number {
    return Math.max(this.cursor + PACING.tail, this.ambientEnd);
  }
}

/** One-shot schedule for when every buffer already exists. */
export function schedule(events: CueEvent[], buffers: ReadonlyMap<CueEvent, AudioBuffer>): Timeline {
  const b = new TimelineBuilder(events);
  b.advance(buffers);
  return { items: b.items, total: b.total };
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
