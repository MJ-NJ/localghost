// Procedural drone: brown noise -> low-pass (LFO on cutoff) + two detuned low oscillators.
import type { AmbientMode } from "../cue/spec";
import { PACING } from "./timeline";

const LEVEL = { low: 0.12, swell: 0.35, stop: 0 } satisfies Record<AmbientMode, number>;
const RAMP = { low: 1.5, swell: 4, stop: PACING.ambientStopFade } satisfies Record<AmbientMode, number>;

function brownNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}

export class Ambient {
  private readonly level: GainNode;
  private readonly nodes: AudioScheduledSourceNode[] = [];
  private lastValue = 0;
  private lastTime = 0;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(out);

    const noise = ctx.createBufferSource();
    noise.buffer = brownNoise(ctx, 8);
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    noise.connect(lp).connect(this.level);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 150;
    lfo.connect(lfoDepth).connect(lp.frequency);

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.5;
    oscGain.connect(this.level);
    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.value = 47;
    const b = ctx.createOscillator();
    b.type = "triangle";
    b.frequency.value = 53.5;
    a.connect(oscGain);
    b.connect(oscGain);

    this.nodes.push(noise, lfo, a, b);
  }

  /** Start the (silent) sources at absolute context time `t`. */
  start(t: number) {
    this.nodes.forEach((n) => n.start(t));
    this.lastTime = t;
  }

  /** Schedule a mode change at absolute time `t`. Call in time order. */
  apply(mode: AmbientMode, t: number) {
    const g = this.level.gain;
    const at = Math.max(t, this.lastTime);
    g.setValueAtTime(this.lastValue, at);
    g.linearRampToValueAtTime(LEVEL[mode], at + RAMP[mode]);
    this.lastValue = LEVEL[mode];
    this.lastTime = at + RAMP[mode];
  }

  dispose() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* never started */
      }
    }
    this.level.disconnect();
  }
}
