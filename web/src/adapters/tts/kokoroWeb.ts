import type { NonVerbal, Style, TTSAdapter, VoiceInfo } from "./types";
import type { WorkerRequest, WorkerResponse } from "./kokoro.worker";
import { cacheKey, idbAudioCache, type AudioCache } from "../../lib/cache";
import { measureMemoryMB } from "../../lib/memory";
import { kokoroSpeed } from "./styleMap";
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
  /** crossOriginIsolated: WASM can use multiple threads only when true. */
  isolated: boolean;
  workers: number;
}

/**
 * Kokoro pads every clip with silence of unpredictable length, which makes pacing
 * sound mechanical. Trim it so the timeline controls all gaps (ADR-010).
 */
export function trimSilence(x: Float32Array, sampleRate: number, threshold = 0.004, keepMs = 40): Float32Array {
  let a = 0;
  let b = x.length;
  while (a < b && Math.abs(x[a]) < threshold) a++;
  while (b > a && Math.abs(x[b - 1]) < threshold) b--;
  if (a >= b) return x; // all quiet: leave untouched
  const keep = Math.floor((sampleRate * keepMs) / 1000);
  return x.subarray(Math.max(0, a - keep), Math.min(x.length, b + keep));
}

/** Bump when anything that changes the audio of a segment changes (trim settings, model, dtype). */
const KOKORO_CACHE_VERSION = "q8-trim0.004-40ms";

/** Chosen by the user after listening (replaces the provisional bm_george, ADR-006). Grade A in Kokoro's own list. */
export const DEFAULT_KOKORO_VOICE = "af_heart";

/** Fixed sentence for the speed test, so results are comparable between runs. */
export const BENCHMARK_TEXT = "The hallway light is off, and somewhere in the house, something is breathing.";

export interface BenchmarkResult {
  /** Wall-clock synthesis seconds per second of audio, across all workers. Below 1 is faster than real time. */
  rtf: number;
  workers: number;
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

interface Inflight {
  slot: Slot;
  settled: boolean;
  resolve(r: { samples: Float32Array; sampleRate: number }): void;
  reject(e: Error): void;
}

function pcmToBuffer(samples: Float32Array, sampleRate: number): AudioBuffer {
  const buf = new AudioBuffer({ length: samples.length, sampleRate, numberOfChannels: 1 });
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  return buf;
}

const abortError = () => new DOMException("aborted", "AbortError");

export class KokoroWebAdapter implements TTSAdapter {
  readonly id = "kokoro-web" as const;
  readonly label = "Kokoro (in browser)";
  readonly caps = {
    styles: new Set<Style>(["normal", "slow"]),
    nonverbals: new Set<never>(),
    offline: true,
    latency: "low" as const,
    maxChars: 500,
    targetChars: 0,
    concurrency: 1, // overridden by the worker count
  };

  voices: VoiceInfo[] = [];
  status: KokoroStatus | null = null;

  private slots: Slot[] = [];
  private waiters: Array<{ resolve(s: Slot): void; reject(e: Error): void }> = [];
  private loading: Promise<void> | null = null;
  private nextId = 1;
  private inflight = new Map<number, Inflight>();

  /** `workerCount` independent copies of the model run in parallel (each is a separate worker). */
  constructor(
    private readonly onProgress?: (p: KokoroProgress) => void,
    readonly workerCount = 1,
    private readonly cache: AudioCache = idbAudioCache,
  ) {}

  dispose() {
    this.slots.forEach((s) => s.worker.terminate());
    this.slots = [];
    this.loading = null;
    this.inflight.forEach((f) => !f.settled && f.reject(abortError()));
    this.inflight.clear();
    this.waiters.splice(0).forEach((w) => w.reject(abortError()));
  }

  /** Load the model in every worker (idempotent). The first worker downloads; the rest reuse the cache. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const first = await this.startWorker(0);
      this.slots.push(first);
      const rest = await Promise.all(Array.from({ length: this.workerCount - 1 }, (_, i) => this.startWorker(i + 1)));
      this.slots.push(...rest);
      const mb = await measureMemoryMB();
      if (mb !== null) timing.note(`memory after voice load (${this.workerCount} worker${this.workerCount > 1 ? "s" : ""}): ${mb} MB`);
    })().catch((e) => {
      this.loading = null; // allow retry
      throw e;
    });
    return this.loading;
  }

  private startWorker(index: number): Promise<Slot> {
    return new Promise<Slot>((resolve, reject) => {
      const worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
      const slot: Slot = { worker, busy: false };
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === "progress") {
          if (index === 0) this.onProgress?.({ file: m.file, loaded: m.loaded, total: m.total });
        } else if (m.type === "ready") {
          if (index === 0) {
            this.voices = m.voices.map((v) => ({ id: v.id, label: `${v.name} (${v.language}, ${v.gender}, grade ${v.grade})` }));
            this.status = { device: m.device, dtype: m.dtype, loadMs: m.loadMs, isolated: m.isolated, workers: this.workerCount };
          }
          timing.record(`kokoro load #${index + 1} (${m.device}/${m.dtype})`, m.loadMs);
          resolve(slot);
        } else if (m.type === "audio") {
          timing.record("tts segment", m.ms);
          if (m.stats.nan > 0 || m.stats.zcr > 0.4) {
            timing.note(`WARNING: audio looks like noise (zcr ${m.stats.zcr.toFixed(2)}, nan ${m.stats.nan})`);
          }
          const f = this.inflight.get(m.id);
          this.inflight.delete(m.id);
          this.release(slot);
          if (f && !f.settled) {
            f.settled = true;
            f.resolve({ samples: m.samples, sampleRate: m.sampleRate });
          }
        } else if (m.type === "error") {
          if (m.id === undefined) return reject(new Error(m.message));
          const f = this.inflight.get(m.id);
          this.inflight.delete(m.id);
          this.release(slot);
          if (f && !f.settled) {
            f.settled = true;
            f.reject(new Error(m.message));
          }
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || "Kokoro worker failed to start"));
      worker.postMessage({ type: "load" } satisfies WorkerRequest);
    });
  }

  private release(slot: Slot) {
    slot.busy = false;
    const w = this.waiters.shift();
    if (w) {
      slot.busy = true;
      w.resolve(slot);
    }
  }

  private acquire(): Promise<Slot> {
    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  synth(
    seg: { text: string; style: Style; leadingNonverbal?: NonVerbal; voice: string },
    signal?: AbortSignal,
  ): Promise<AudioBuffer> {
    return this.synthWith(seg, signal, true);
  }

  private async synthWith(
    seg: { text: string; style: Style; leadingNonverbal?: NonVerbal; voice: string },
    signal: AbortSignal | undefined,
    useCache: boolean,
  ): Promise<AudioBuffer> {
    const speed = kokoroSpeed(seg.style);
    const key = await cacheKey("kokoro-web", KOKORO_CACHE_VERSION, seg.voice, seg.style, seg.leadingNonverbal, speed, seg.text);
    if (useCache) {
      const hit = await this.cache.get(key);
      if (hit?.kind === "pcm") return pcmToBuffer(hit.samples, hit.sampleRate); // no model needed for a cached segment
    }

    await this.load();
    if (signal?.aborted) throw abortError();
    const slot = await this.acquire();
    if (signal?.aborted) {
      this.release(slot);
      throw abortError();
    }

    const id = this.nextId++;
    const result = new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => {
      this.inflight.set(id, { slot, settled: false, resolve, reject });
    });
    // On abort the caller is released at once; the worker finishes its current clip and then frees its slot.
    signal?.addEventListener("abort", () => {
      const f = this.inflight.get(id);
      if (f && !f.settled) {
        f.settled = true;
        f.reject(abortError());
      }
    });
    slot.worker.postMessage({ type: "synth", id, text: seg.text, voice: seg.voice, speed } satisfies WorkerRequest);

    const { samples: raw, sampleRate } = await result;
    const samples = trimSilence(raw, sampleRate);
    if (useCache) void this.cache.put(key, { kind: "pcm", sampleRate, samples: samples.slice() });
    return pcmToBuffer(samples, sampleRate);
  }

  /**
   * Speed test: one warm-up clip, then one clip per worker at the same time. The result is the wall-clock
   * synthesis time per second of audio with every worker busy, i.e. the real throughput for a story.
   */
  async benchmark(voice: string): Promise<BenchmarkResult> {
    await this.load();
    const seg = { text: BENCHMARK_TEXT, style: "normal" as const, voice };
    // the speed test must never be served from the cache, or it would time a database read
    await this.synthWith(seg, undefined, false); // warm-up: JIT, first-run allocations
    const t0 = performance.now();
    const bufs = await Promise.all(Array.from({ length: this.workerCount }, () => this.synthWith(seg, undefined, false)));
    const wallSec = (performance.now() - t0) / 1000;
    const audioSec = bufs.reduce((n, b) => n + b.duration, 0);
    const rtf = wallSec / audioSec;
    timing.note(`speed test: ${rtf.toFixed(2)}x real time with ${this.workerCount} worker(s) (below 1 is faster than speech)`);
    return { rtf, workers: this.workerCount };
  }
}
