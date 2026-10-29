// voice -> styleChain -> voiceBus -> (dry + reverb) -> master -> destination
// ambient -> ambientBus (ducked) -> master;  sfx -> sfxBus -> master
import type { Style } from "../cue/spec";
import { PACING } from "./timeline";

const IR_SECONDS = 2.5;

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
    this.voiceBus.connect(dry).connect(this.master);
    this.voiceBus.connect(reverb).connect(wet).connect(this.master);

    this.ambientBus = ctx.createGain();
    this.ambientBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
  }

  /** styleChain: per-style emulation (whisper/trembling/shout) is added in M5; for now all pass through. */
  connectVoice(src: AudioNode, _style: Style) {
    src.connect(this.voiceBus);
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
