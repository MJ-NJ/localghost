// M1 minimal playback: prerender speech, then play it back-to-back with pauses as silence.
// Replaced/extended by the full timeline + audio graph in M2.
import type { CueEvent } from "../cue/spec";
import type { TTSAdapter } from "../adapters/tts/types";
import { timing } from "../lib/timing";

export interface PlayOptions {
  adapter: TTSAdapter;
  voice: string;
  ctx: AudioContext;
  signal?: AbortSignal;
  onPrerender?: (done: number, total: number) => void;
  onLine?: (text: string) => void;
}

export async function playSimple(events: CueEvent[], o: PlayOptions): Promise<void> {
  const speech = events.filter((e): e is Extract<CueEvent, { kind: "speech" }> => e.kind === "speech");
  const buffers = new Map<CueEvent, AudioBuffer>();

  const stopPrerender = timing.start("prerender total");
  o.onPrerender?.(0, speech.length);
  for (const ev of speech) {
    buffers.set(ev, await o.adapter.synth({ text: ev.text, style: ev.style, voice: o.voice }, o.signal));
    o.onPrerender?.(buffers.size, speech.length);
  }
  stopPrerender();

  if (o.ctx.state === "suspended") await o.ctx.resume();
  const sources: AudioBufferSourceNode[] = [];
  const timers: number[] = [];
  let cursor = o.ctx.currentTime + 0.3;
  const t0 = cursor;

  for (const ev of events) {
    if (ev.kind === "pause") {
      cursor += ev.seconds;
    } else if (ev.kind === "speech") {
      const buf = buffers.get(ev)!;
      const src = o.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(o.ctx.destination);
      src.start(cursor);
      sources.push(src);
      timers.push(window.setTimeout(() => o.onLine?.(ev.text), (cursor - o.ctx.currentTime) * 1000));
      cursor += buf.duration;
    }
    // other event kinds are timeline-only; they are ignored until M2
  }

  await new Promise<void>((resolve) => {
    const end = window.setTimeout(resolve, (cursor - o.ctx.currentTime) * 1000 + 200);
    o.signal?.addEventListener("abort", () => {
      clearTimeout(end);
      timers.forEach(clearTimeout);
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* not started */
        }
      });
      resolve();
    });
  });
  timing.record("play duration", (cursor - t0) * 1000);
}
