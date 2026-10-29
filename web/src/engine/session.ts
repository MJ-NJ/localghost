// A story being synthesized. The player can start speaking before synthesis finishes (streaming).
import type { CueEvent } from "../cue/spec";
import type { TTSAdapter } from "../adapters/tts/types";
import { timing } from "../lib/timing";
import { TimelineBuilder, type TimedEvent } from "./timeline";

/** Never start with fewer than this many segments ready, or less than this much audio buffered. */
export const MIN_READY_SEGMENTS = 2;
export const MIN_BUFFER_SECONDS = 3;
/** Safety factor on the estimated shortfall when synthesis is slower than playback. */
export const START_MARGIN = 1.15;

export interface StartStats {
  readySegments: number;
  totalSegments: number;
  /** Timeline seconds already known (speech + gaps + pauses). */
  readySeconds: number;
  /** Mean seconds Kokoro took per segment so far. */
  avgSynthSec: number;
}

/**
 * Decide whether playback can begin without the playhead catching up to synthesis.
 * If a segment takes less time to make than it takes to play (counting gaps and pauses),
 * a small buffer is enough. Otherwise buffer the expected shortfall up front.
 */
export function shouldStart(s: StartStats): boolean {
  if (s.readySegments >= s.totalSegments) return true;
  if (s.readySegments < MIN_READY_SEGMENTS) return false;
  const playSecPerSegment = s.readySeconds / s.readySegments;
  const remaining = s.totalSegments - s.readySegments;
  const shortfall = Math.max(0, s.avgSynthSec - playSecPerSegment) * remaining * START_MARGIN;
  return s.readySeconds >= Math.max(MIN_BUFFER_SECONDS, shortfall);
}

type ItemsListener = (added: TimedEvent[]) => void;

export class StorySession {
  readonly buffers = new Map<CueEvent, AudioBuffer>();
  readonly builder: TimelineBuilder;
  readonly totalSegments: number;
  error: Error | null = null;

  private readonly listeners = new Set<ItemsListener>();
  private readonly waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private readySegments = 0;
  private synthMs = 0;

  constructor(readonly events: CueEvent[]) {
    this.totalSegments = events.filter((e) => e.kind === "speech").length;
    this.builder = new TimelineBuilder(events);
    this.builder.advance(this.buffers); // places everything before the first speech
  }

  get complete(): boolean {
    return this.builder.complete;
  }

  stats(): StartStats {
    return {
      readySegments: this.readySegments,
      totalSegments: this.totalSegments,
      readySeconds: this.builder.frontier,
      avgSynthSec: this.readySegments ? this.synthMs / this.readySegments / 1000 : 0,
    };
  }

  addBuffer(ev: CueEvent, buf: AudioBuffer, synthMs: number) {
    this.buffers.set(ev, buf);
    this.readySegments++;
    this.synthMs += synthMs;
    const added = this.builder.advance(this.buffers);
    this.listeners.forEach((l) => l(added));
    this.checkWaiters();
  }

  fail(err: Error) {
    this.error = err;
    this.waiters.splice(0).forEach((w) => w.reject(err));
  }

  /** Subscribe to newly timed items. Returns an unsubscribe function. */
  onItems(l: ItemsListener): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  /** Resolves when playback can safely begin (see shouldStart); rejects if synthesis fails first. */
  ready(): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (shouldStart(this.stats())) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private checkWaiters() {
    if (this.waiters.length && shouldStart(this.stats())) this.waiters.splice(0).forEach((w) => w.resolve());
  }
}

export interface SynthesizeOptions {
  adapter: TTSAdapter;
  voice: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Synthesize every speech event in order (Kokoro concurrency 1), feeding the session as each finishes. */
export async function synthesizeInto(session: StorySession, o: SynthesizeOptions): Promise<void> {
  const stop = timing.start("prerender total");
  try {
    let done = 0;
    o.onProgress?.(0, session.totalSegments);
    for (const ev of session.events) {
      if (ev.kind !== "speech") continue;
      const t0 = performance.now();
      const buf = await o.adapter.synth({ text: ev.text, style: ev.style, voice: o.voice }, o.signal);
      session.addBuffer(ev, buf, performance.now() - t0);
      o.onProgress?.(++done, session.totalSegments);
    }
    stop();
  } catch (e) {
    session.fail(e instanceof Error ? e : new Error(String(e)));
    throw e;
  }
}
