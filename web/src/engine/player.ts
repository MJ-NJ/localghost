// Prerender -> schedule -> play. Audio is scheduled against AudioContext.currentTime;
// visual/transcript events are dispatched from a rAF loop reading the same clock.
import type { CueEvent, Style } from "../cue/spec";
import type { TTSAdapter } from "../adapters/tts/types";
import { timing } from "../lib/timing";
import { AudioGraph } from "./audioGraph";
import { Ambient } from "./ambient";
import { playNonverbal, playSfx } from "./sfx";
import { schedule, type Timeline } from "./timeline";

export interface Prepared {
  events: CueEvent[];
  timeline: Timeline;
}

export interface PrepareOptions {
  adapter: TTSAdapter;
  voice: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface PlayerHooks {
  onLine?(text: string, style: Style): void;
  /** Non-audio timeline events: light, photo. `at` is timeline seconds. */
  onVisual?(ev: Extract<CueEvent, { kind: "light" | "photo" }>, at: number): void;
  /** Called every frame with timeline seconds. */
  onFrame?(elapsed: number): void;
  onEnd?(reason: "finished" | "stopped"): void;
}

export type PlayerState = "idle" | "playing" | "paused";

/** Synthesize all speech (Kokoro concurrency 1) and compute the timeline. */
export async function prepare(events: CueEvent[], o: PrepareOptions): Promise<Prepared> {
  const speech = events.filter((e): e is Extract<CueEvent, { kind: "speech" }> => e.kind === "speech");
  const buffers = new Map<CueEvent, AudioBuffer>();
  const stop = timing.start("prerender total");
  o.onProgress?.(0, speech.length);
  for (const ev of speech) {
    buffers.set(ev, await o.adapter.synth({ text: ev.text, style: ev.style, voice: o.voice }, o.signal));
    o.onProgress?.(buffers.size, speech.length);
  }
  stop();
  return { events, timeline: schedule(events, buffers) };
}

const LEAD_IN = 0.3;

export class Player {
  state: PlayerState = "idle";

  private graph: AudioGraph | null = null;
  private ambient: Ambient | null = null;
  private speechSources: AudioBufferSourceNode[] = [];
  private raf = 0;
  private t0 = 0;
  private next = 0;
  private prepared: Prepared | null = null;
  private hooks: PlayerHooks = {};

  constructor(private readonly ctx: AudioContext) {}

  /** Start (or replay) a prepared story. No re-synthesis. */
  async start(p: Prepared, hooks: PlayerHooks = {}) {
    this.teardown();
    this.prepared = p;
    this.hooks = hooks;
    if (this.ctx.state !== "running") await this.ctx.resume();

    const ctx = this.ctx;
    const graph = (this.graph = new AudioGraph(ctx));
    const ambient = (this.ambient = new Ambient(ctx, graph.ambientBus));
    const t0 = (this.t0 = ctx.currentTime + LEAD_IN);
    ambient.start(t0);
    graph.scheduleDucking(p.timeline.items, t0);

    for (const { at, ev, buffer } of p.timeline.items) {
      const t = t0 + at;
      switch (ev.kind) {
        case "speech": {
          if (!buffer) break;
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          graph.connectVoice(src, ev.style);
          src.start(t);
          this.speechSources.push(src);
          break;
        }
        case "sfx":
          playSfx(ev.name, ctx, graph.sfxBus, t);
          break;
        case "nonverbal":
          playNonverbal(ev.nv, ctx, graph.sfxBus, t);
          break;
        case "ambient":
          ambient.apply(ev.mode, t);
          break;
        default:
          break; // pause, light, photo: no audio
      }
    }

    this.next = 0;
    this.state = "playing";
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  private tick() {
    const p = this.prepared;
    if (!p) return;
    const elapsed = this.ctx.currentTime - this.t0;
    const items = p.timeline.items;
    while (this.next < items.length && items[this.next].at <= elapsed) {
      const { at, ev } = items[this.next++];
      if (ev.kind === "speech") this.hooks.onLine?.(ev.text, ev.style);
      else if (ev.kind === "light" || ev.kind === "photo") this.hooks.onVisual?.(ev, at);
    }
    this.hooks.onFrame?.(Math.max(0, elapsed));
    if (elapsed >= p.timeline.total) this.finish("finished");
  }

  async pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    await this.ctx.suspend();
  }

  async resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    await this.ctx.resume();
  }

  async toggle() {
    if (this.state === "playing") await this.pause();
    else if (this.state === "paused") await this.resume();
  }

  stop() {
    if (this.state === "idle") return;
    this.finish("stopped");
  }

  private finish(reason: "finished" | "stopped") {
    const hooks = this.hooks;
    this.teardown();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    hooks.onEnd?.(reason);
  }

  private teardown() {
    cancelAnimationFrame(this.raf);
    for (const s of this.speechSources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.speechSources = [];
    this.ambient?.dispose();
    this.graph?.dispose();
    this.ambient = null;
    this.graph = null;
    this.state = "idle";
  }
}
