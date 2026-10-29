// Procedural one-shot sounds. All times are absolute AudioContext times.
import type { NonVerbal, SfxName } from "../cue/spec";

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

const FLOOR = 0.0001;

function envelope(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, peak: number, attack: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  g.connect(out);
  return g;
}

function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  dur: number,
  filter: BiquadFilterType,
  freq: number,
  q: number,
  peak: number,
  attack = 0.005,
  sweepTo?: number,
) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.linearRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  src.connect(f).connect(envelope(ctx, out, t, dur, peak, attack));
  src.start(t, Math.random() * 1.5, dur + 0.05);
}

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  dur: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  peak: number,
  attack = 0.005,
) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(envelope(ctx, out, t, dur, peak, attack));
  o.start(t);
  o.stop(t + dur + 0.05);
}

function creak(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, peak: number) {
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(70, t);
  o.frequency.linearRampToValueAtTime(130, t + dur);
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 9;
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 18;
  wobble.connect(wobbleDepth).connect(o.frequency);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 720;
  bp.Q.value = 8;
  o.connect(bp).connect(envelope(ctx, out, t, dur, peak, dur * 0.3));
  o.start(t);
  wobble.start(t);
  o.stop(t + dur + 0.05);
  wobble.stop(t + dur + 0.05);
}

type SfxFn = (ctx: BaseAudioContext, out: AudioNode, t: number) => void;

const SFX: Record<SfxName, SfxFn> = {
  heartbeat: (c, o, t) => {
    // three lub-dub cycles
    for (let i = 0; i < 3; i++) {
      const b = t + i * 0.95;
      tone(c, o, b, 0.22, "sine", 62, 38, 0.9, 0.01);
      tone(c, o, b + 0.28, 0.2, "sine", 55, 36, 0.6, 0.01);
    }
  },
  knock: (c, o, t) => {
    for (const dt of [0, 0.3, 0.55]) {
      noiseBurst(c, o, t + dt, 0.09, "lowpass", 900, 1, 0.9, 0.002);
      tone(c, o, t + dt, 0.12, "sine", 130, 70, 0.8, 0.002);
    }
  },
  creak: (c, o, t) => creak(c, o, t, 1.6, 0.35),
  footsteps: (c, o, t) => {
    for (let i = 0; i < 6; i++) {
      const s = t + i * 0.55 + (i % 2) * 0.04;
      noiseBurst(c, o, s, 0.14, "lowpass", 260, 1, i % 2 ? 0.5 : 0.7, 0.01);
      tone(c, o, s, 0.12, "sine", 90, 55, 0.4, 0.008);
    }
  },
  drip: (c, o, t) => {
    tone(c, o, t, 0.1, "sine", 1900, 700, 0.5, 0.002);
    tone(c, o, t + 1.1, 0.1, "sine", 1500, 600, 0.25, 0.002);
  },
  static: (c, o, t) => {
    for (let i = 0; i < 6; i++) noiseBurst(c, o, t + i * 0.2, 0.18, "highpass", 2500, 0.7, 0.35 * (i % 2 ? 0.6 : 1), 0.005);
  },
  scrape: (c, o, t) => noiseBurst(c, o, t, 1.3, "bandpass", 350, 3, 0.5, 0.25, 1400),
  door: (c, o, t) => {
    creak(c, o, t, 0.9, 0.3);
    tone(c, o, t + 0.85, 0.3, "sine", 85, 40, 0.9, 0.005);
    noiseBurst(c, o, t + 0.85, 0.2, "lowpass", 500, 1, 0.5, 0.003);
  },
  whispers: (c, o, t) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 2.5;
    const flutter = c.createGain();
    flutter.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 6.5;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(flutter.gain);
    src.connect(bp).connect(flutter).connect(envelope(c, o, t, 3.2, 0.35, 0.8));
    src.start(t, 0, 3.3);
    lfo.start(t);
    lfo.stop(t + 3.3);
  },
};

const NONVERBAL: Record<NonVerbal, SfxFn> = {
  breath: (c, o, t) => noiseBurst(c, o, t, 0.8, "bandpass", 1100, 0.8, 0.35, 0.3),
  sigh: (c, o, t) => noiseBurst(c, o, t, 1.2, "bandpass", 800, 0.7, 0.4, 0.25, 400),
  gasp: (c, o, t) => noiseBurst(c, o, t, 0.5, "bandpass", 1600, 0.9, 0.6, 0.12, 2400),
  laugh: (c, o, t) => {
    for (let i = 0; i < 4; i++) noiseBurst(c, o, t + i * 0.22, 0.14, "bandpass", 900, 1.2, 0.3, 0.02);
  },
};

export function playSfx(name: SfxName, ctx: BaseAudioContext, out: AudioNode, t: number) {
  SFX[name](ctx, out, t);
}

export function playNonverbal(nv: NonVerbal, ctx: BaseAudioContext, out: AudioNode, t: number) {
  NONVERBAL[nv](ctx, out, t);
}
