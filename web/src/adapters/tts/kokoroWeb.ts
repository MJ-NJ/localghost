import type { Style, TTSAdapter, VoiceInfo } from "./types";
import type { WorkerRequest, WorkerResponse } from "./kokoro.worker";
import { timing } from "../../lib/timing";

export interface KokoroProgress {
  file: string;
  loaded: number;
  total: number;
}

export interface KokoroStatus {
  device: "webgpu" | "wasm";
  dtype: string;
  loadMs: number;
}

/** Kokoro's `speed` per style. Whisper/trembling/shout are emulated in the audio graph (M2/M5), not here. */
const SPEED: Partial<Record<Style, number>> = { slow: 0.8 };

/** Provisional default; chosen from the voice list by grade, not by ear. Verify by listening. */
export const DEFAULT_KOKORO_VOICE = "bm_george";

export class KokoroWebAdapter implements TTSAdapter {
  readonly id = "kokoro-web" as const;
  readonly label = "Kokoro (in browser)";
  readonly caps = {
    styles: new Set<Style>(["normal", "slow"]),
    nonverbals: new Set<never>(),
    offline: true,
    latency: "low" as const,
    maxChars: 500,
  };

  voices: VoiceInfo[] = [];
  status: KokoroStatus | null = null;

  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: { samples: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void }>();

  constructor(private readonly onProgress?: (p: KokoroProgress) => void) {}

  /** Load the model (idempotent). Downloads weights on first use. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === "progress") {
          this.onProgress?.({ file: m.file, loaded: m.loaded, total: m.total });
        } else if (m.type === "ready") {
          this.voices = m.voices.map((v) => ({ id: v.id, label: `${v.name} (${v.language}, ${v.gender}, grade ${v.grade})` }));
          this.status = { device: m.device, dtype: m.dtype, loadMs: m.loadMs };
          timing.record(`kokoro load (${m.device}/${m.dtype})`, m.loadMs);
          resolve();
        } else if (m.type === "audio") {
          timing.record("tts segment", m.ms);
          this.pending.get(m.id)?.resolve({ samples: m.samples, sampleRate: m.sampleRate });
          this.pending.delete(m.id);
        } else if (m.type === "error") {
          const err = new Error(m.message);
          if (m.id === undefined) {
            this.loading = null; // allow retry
            reject(err);
          } else {
            this.pending.get(m.id)?.reject(err);
            this.pending.delete(m.id);
          }
        }
      };
      worker.onerror = (e) => {
        this.loading = null;
        reject(new Error(e.message || "Kokoro worker failed to start"));
      };
      worker.postMessage({ type: "load" } satisfies WorkerRequest);
    });
    return this.loading;
  }

  async synth(
    seg: { text: string; style: Style; voice: string },
    signal?: AbortSignal,
  ): Promise<AudioBuffer> {
    await this.load();
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const id = this.nextId++;
    const result = new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    signal?.addEventListener("abort", () => {
      this.pending.get(id)?.reject(new DOMException("aborted", "AbortError"));
      this.pending.delete(id);
    });
    this.worker!.postMessage({
      type: "synth",
      id,
      text: seg.text,
      voice: seg.voice,
      speed: SPEED[seg.style] ?? 1,
    } satisfies WorkerRequest);
    const { samples, sampleRate } = await result;
    const buf = new AudioBuffer({ length: samples.length, sampleRate, numberOfChannels: 1 });
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return buf;
  }
}
