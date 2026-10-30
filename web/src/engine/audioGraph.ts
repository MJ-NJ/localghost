// voice -> styleChain -> voiceBus -> (dry + reverb) -> master -> destination
// ambient -> ambientBus (ducked) -> master;  sfx -> sfxBus -> master
import type { Style } from "../cue/spec";
import { KOKORO_EMULATION } from "../adapters/tts/styleMap";
import { PACING } from "./timeline";

const IR_SECONDS = 2.5;

/** tanh soft clipper: gentle at low levels, squashes peaks, so a boosted shout distorts instead of hard-clipping. */
export function softClipCurve(amount: number, points = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const norm = Math.tanh(amount);
  for (let i = 0; i < points; i++) curve[i] = Math.tanh((i / (points - 1) * 2 - 1) * amount) / norm;
  return curve;
}

function makeImpulseResponse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * IR_SECONDS);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  const predelay = Math.floor(ctx.sampleRate * 0.02);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = predelay; i < len; i++) {
      const t = (i - predelay) / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.8);
    }
  }
  return ir;
}

export class AudioGraph {
  readonly master: GainNode;
  readonly voiceBus: GainNode;
  readonly ambientBus: GainNode;
  readonly sfxBus: GainNode;
  /** Reverb input, for styles that add their own send (whisper). */
  readonly reverbIn: ConvolverNode;

  constructor(readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.voiceBus = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulseResponse(ctx);
    this.reverbIn = reverb;
    this.voiceBus.connect(dry).connect(this.master);
    this.voiceBus.connect(reverb).connect(wet).connect(this.master);

    this.ambientBus = ctx.createGain();
    this.ambientBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
  }

  /**
   * styleChain. A style the TTS performs natively (`native`) goes straight through. Otherwise Kokoro's styles
   * are emulated here: whisper (quieter, high-passed, more reverb), trembling (pitch wobble), shout (louder,
   * soft-clipped). `slow` is just Kokoro's speed option and needs nothing here. `when` is the absolute start time.
   */
  connectVoice(src: AudioBufferSourceNode, style: Style, when: number, native: boolean) {
    const ctx = this.ctx;
    if (native || style === "normal" || style === "slow") {
      src.connect(this.voiceBus);
      return;
    }
    if (style === "whisper") {
      const e = KOKORO_EMULATION.whisper;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = e.highpassHz;
      const g = ctx.createGain();
      g.gain.value = e.gain;
      const send = ctx.createGain();
      send.gain.value = e.reverbSend;
      src.connect(hp).connect(g);
      g.connect(this.voiceBus);
      g.connect(send).connect(this.reverbIn);
    } else if (style === "trembling") {
      const e = KOKORO_EMULATION.trembling;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = e.lfoHz;
      const depth = ctx.createGain();
      depth.gain.value = e.detuneCents;
      lfo.connect(depth).connect(src.detune);
      lfo.start(when);
      src.onended = () => lfo.stop();
      src.connect(this.voiceBus);
    } else {
      const e = KOKORO_EMULATION.shout;
      const g = ctx.createGain();
      g.gain.value = e.gain;
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve(e.clipAmount);
      clip.oversample = "2x";
      src.connect(g).connect(clip).connect(this.voiceBus);
    }
  }

  private duckEnd: number | null = null;
  private duckT0 = 0;

  /** Call once at playback start. `t0` is the absolute context time of timeline 0. */
  beginDucking(t0: number) {
    this.duckT0 = t0;
    this.duckEnd = null;
    this.ambientBus.gain.setValueAtTime(1, t0);
  }

  /**
   * Lower the ambient bed while a speech segment [s, e] (timeline seconds) plays. Called as segments become
   * known; a segment that starts soon after the previous one extends that duck instead of re-opening the bed.
   */
  duckForSpeech(s: number, e: number) {
    const g = this.ambientBus.gain;
    const t0 = this.duckT0;
    if (this.duckEnd !== null && s - this.duckEnd < PACING.duckMergeGap) {
      g.cancelScheduledValues(t0 + this.duckEnd); // drop the planned release; it is re-planned below
    } else {
      g.setValueAtTime(1, t0 + Math.max(0, s - PACING.duckRampIn));
      g.linearRampToValueAtTime(PACING.duckGain, t0 + s);
    }
    g.setValueAtTime(PACING.duckGain, t0 + e);
    g.linearRampToValueAtTime(1, t0 + e + PACING.duckRampOut);
    this.duckEnd = e;
  }

  dispose() {
    this.master.disconnect();
  }
}
