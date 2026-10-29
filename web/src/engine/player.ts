// Streaming playback. Audio is scheduled against AudioContext.currentTime as segments become
// available; visual/transcript events are dispatched from a rAF loop reading the same clock.
// If the playhead reaches a segment that is not synthesized yet, the clock is suspended
// ("waiting for the voice") and resumed automatically when it arrives.
import type { CueEvent, Style } from "../cue/spec";
import { AudioGraph } from "./audioGraph";
import { Ambient } from "./ambient";
import { playNonverbal, playSfx } from "./sfx";
import type { StorySession } from "./session";
import type { TimedEvent } from "./timeline";

export interface PlayerHooks {
  onLine?(text: string, style: Style): void;
  /** Non-audio timeline events: light, photo. `at` is timeline seconds. */
  onVisual?(ev: Extract<CueEvent, { kind: "light" | "photo" }>, at: number): void;
  /** Called every frame with timeline seconds. */
  onFrame?(elapsed: number): void;
  /** The playhead caught up with synthesis (true) or synthesis caught up again (false). */
  onWaiting?(waiting: boolean): void;
  onEnd?(reason: "finished" | "stopped"): void;
}

export type PlayerState = "idle" | "playing" | "paused";

const LEAD_IN = 0.3;
/** Suspend this long before the first unsynthesized segment so the clock stops cleanly. */
const WAIT_MARGIN = 0.1;
/** Resume only once this much audio is available beyond the playhead. */
const RESUME_ROOM = 0.25;

export class Player {
  state: PlayerState = "idle";

  private session: StorySession | null = null;
  private graph: AudioGraph | null = null;
  private ambient: Ambient | null = null;
  private speechSources: AudioBufferSourceNode[] = [];
  private unsubscribe: (() => void) | null = null;
  private raf = 0;
  private t0 = 0;
  private next = 0;
  private waiting = false;
  private hooks: PlayerHooks = {};

  constructor(private readonly ctx: AudioContext) {}

  /** Start (or replay) a session. May be called while the session is still synthesizing. */
  async start(session: StorySession, hooks: PlayerHooks = {}) {
    this.teardown();
    this.session = session;
    this.hooks = hooks;
    if (this.ctx.state !== "running") await this.ctx.resume();

    const ctx = this.ctx;
    this.graph = new AudioGraph(ctx);
    this.ambient = new Ambient(ctx, this.graph.ambientBus);
    this.t0 = ctx.currentTime + LEAD_IN;
    this.ambient.start(this.t0);
    this.graph.beginDucking(this.t0);

    this.schedule(session.builder.items);
    this.unsubscribe = session.onItems((added) => this.onItems(added));

    this.next = 0;
    this.waiting = false;
    this.state = "playing";
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  /** Schedule audio for newly timed items. */
  private schedule(items: readonly TimedEvent[]) {
    const { ctx, graph, ambient, t0 } = this;
    if (!graph || !ambient) return;
    for (const { at, ev, buffer, duration } of items) {
      const t = t0 + at;
      switch (ev.kind) {
        case "speech": {
          if (!buffer) break;
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          graph.connectVoice(src, ev.style);
          src.start(t);
          this.speechSources.push(src);
          graph.duckForSpeech(at, at + duration);
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
  }

  private onItems(added: TimedEvent[]) {
    this.schedule(added);
    const s = this.session;
    if (!s || !this.waiting) return;
    const elapsed = this.ctx.currentTime - this.t0;
    if (s.complete || s.builder.frontier > elapsed + RESUME_ROOM) {
      this.waiting = false;
      this.hooks.onWaiting?.(false);
      if (this.state === "playing") void this.ctx.resume();
    }
  }

  private tick() {
    const s = this.session;
    if (!s) return;
    const elapsed = this.ctx.currentTime - this.t0;
    const items = s.builder.items;
    while (this.next < items.length && items[this.next].at <= elapsed) {
      const { at, ev } = items[this.next++];
      if (ev.kind === "speech") this.hooks.onLine?.(ev.text, ev.style);
      else if (ev.kind === "light" || ev.kind === "photo") this.hooks.onVisual?.(ev, at);
    }
    this.hooks.onFrame?.(Math.max(0, elapsed));

    if (s.complete) {
      if (elapsed >= s.builder.total) this.finish("finished");
    } else if (!this.waiting && elapsed >= s.builder.frontier - WAIT_MARGIN) {
      this.waiting = true;
      this.hooks.onWaiting?.(true);
      if (this.state === "playing") void this.ctx.suspend();
    }
  }

  async pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    await this.ctx.suspend();
  }

  async resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    if (!this.waiting) await this.ctx.resume(); // while waiting for the voice the clock must stay stopped
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
    const wasWaiting = this.waiting;
    this.teardown();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (wasWaiting) hooks.onWaiting?.(false);
    hooks.onEnd?.(reason);
  }

  private teardown() {
    cancelAnimationFrame(this.raf);
    this.unsubscribe?.();
    this.unsubscribe = null;
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
    this.session = null;
    this.waiting = false;
    this.state = "idle";
  }
}
