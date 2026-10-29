// CSS overlay effects over the Stage, driven by the timeline clock (so Pause freezes them).
import type { LightMode } from "../cue/spec";

export interface EffectElements {
  black: HTMLElement;
  red: HTMLElement;
  vignette: HTMLElement;
}

interface Active {
  mode: "flicker" | "blackout" | "red";
  start: number;
  dur: number;
  /** flicker: per-step opacities */
  steps?: number[];
  hold?: number;
}

const FLICKER_STEP = 0.07;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 0→1 over `fin`, hold, 1→0 over the last `fout` seconds of `dur`. */
function trapezoid(t: number, dur: number, fin: number, fout: number) {
  if (t < 0 || t > dur) return 0;
  return Math.min(clamp01(t / fin), clamp01((dur - t) / fout));
}

export class Effects {
  private active: Active[] = [];
  private pulseStart: number | null = null;

  /** `reduce()` is read live, so the toggle takes effect immediately. */
  constructor(
    private readonly els: EffectElements,
    private readonly reduce: () => boolean,
  ) {}

  /** `now` is timeline seconds. */
  trigger(mode: LightMode, seconds: number | undefined, now: number) {
    const reduce = this.reduce();
    switch (mode) {
      case "flicker": {
        if (reduce) {
          this.active.push({ mode: "flicker", start: now, dur: 2.5 }); // slow dim
        } else {
          const dur = 0.6 + Math.random() * 0.9;
          const steps = Array.from({ length: Math.ceil(dur / FLICKER_STEP) }, () =>
            Math.random() < 0.55 ? 0.35 + Math.random() * 0.6 : 0,
          );
          this.active.push({ mode: "flicker", start: now, dur, steps });
        }
        break;
      }
      case "blackout": {
        const hold = seconds ?? 2;
        // reduce: dim (not black) with 1.5 s fades in and out
        this.active.push({ mode: "blackout", start: now, dur: reduce ? hold + 3 : hold, hold });
        break;
      }
      case "red":
        this.active.push({ mode: "red", start: now, dur: 6 });
        break;
      case "pulse":
        this.pulseStart = now;
        break;
      case "calm":
        this.clear();
        break;
    }
  }

  update(now: number) {
    const reduce = this.reduce();
    let black = 0;
    let red = 0;

    this.active = this.active.filter((a) => now - a.start <= a.dur);
    for (const a of this.active) {
      const t = now - a.start;
      if (a.mode === "flicker") {
        if (a.steps) black = Math.max(black, a.steps[Math.floor(t / FLICKER_STEP)] ?? 0);
        else black = Math.max(black, 0.45 * Math.sin(Math.PI * clamp01(t / a.dur)));
      } else if (a.mode === "blackout") {
        const env = reduce ? trapezoid(t, a.dur, 1.5, 1.5) : trapezoid(t, a.dur, 0.12, 0.8);
        black = Math.max(black, (reduce ? 0.85 : 0.97) * env);
      } else {
        red = Math.max(red, 0.85 * trapezoid(t, a.dur, 1.5, 1.5));
      }
    }

    const vignette = this.pulseStart === null ? 0 : 0.35 + 0.25 * Math.sin(((now - this.pulseStart) * 2 * Math.PI) / 1.2);

    this.els.black.style.opacity = String(black);
    this.els.red.style.opacity = String(red);
    this.els.vignette.style.opacity = String(vignette);
  }

  clear() {
    this.active = [];
    this.pulseStart = null;
    this.els.black.style.opacity = "0";
    this.els.red.style.opacity = "0";
    this.els.vignette.style.opacity = "0";
  }
}
