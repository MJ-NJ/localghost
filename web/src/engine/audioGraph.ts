// voice -> styleChain -> voiceBus -> (dry + reverb) -> master -> destination
// ambient -> ambientBus (ducked) -> master;  sfx -> sfxBus -> master
import type { Style } from "../cue/spec";
import { PACING, type TimedEvent, duckIntervals } from "./timeline";

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

  /** Lower the ambient bed while speech plays. `t0` is the absolute context time of timeline 0. */
  scheduleDucking(items: TimedEvent[], t0: number) {
    const g = this.ambientBus.gain;
    g.setValueAtTime(1, t0);
    for (const [s, e] of duckIntervals(items)) {
      const a = t0 + Math.max(0, s - PACING.duckRampIn);
      g.setValueAtTime(1, a);
      g.linearRampToValueAtTime(PACING.duckGain, t0 + s);
      g.setValueAtTime(PACING.duckGain, t0 + e);
      g.linearRampToValueAtTime(1, t0 + e + PACING.duckRampOut);
    }
  }

  dispose() {
    this.master.disconnect();
  }
}
