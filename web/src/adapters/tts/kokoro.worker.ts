// Runs kokoro-js off the main thread. Protocol is defined by the types below.
import { KokoroTTS } from "kokoro-js";

export interface WorkerVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  grade: string;
}

export type DevicePref = "auto" | "webgpu" | "wasm";

export type WorkerRequest =
  | { type: "load"; device: DevicePref }
  | { type: "synth"; id: number; text: string; voice: string; speed: number };

export interface AudioStats {
  samples: number;
  nan: number;
  peak: number;
  rms: number;
  /** zero-crossing rate; speech is roughly 0.02-0.2, white noise is ~0.5 */
  zcr: number;
}

function analyse(x: Float32Array): AudioStats {
  let nan = 0, peak = 0, sum = 0, zc = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
    if (i && x[i - 1] < 0 !== v < 0) zc++;
  }
  return { samples: x.length, nan, peak, rms: Math.sqrt(sum / x.length), zcr: zc / x.length };
}

export type WorkerResponse =
  | { type: "progress"; file: string; loaded: number; total: number; status: string }
  | { type: "ready"; device: "webgpu" | "wasm"; dtype: string; voices: WorkerVoice[]; loadMs: number }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number; ms: number; stats: AudioStats }
  | { type: "error"; id?: number; message: string };

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: KokoroTTS | null = null;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(pref: DevicePref) {
  const t0 = performance.now();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.file) post({ type: "progress", status: p.status, file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
  };

  let device: "webgpu" | "wasm" = "wasm";
  let dtype: "fp32" | "q8" = "q8";
  // kokoro-js recommends fp32 on WebGPU; q8 is for WASM.
  if (pref !== "wasm" && (await hasWebGpu())) {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "fp32", device: "webgpu", progress_callback });
      device = "webgpu";
      dtype = "fp32";
    } catch (e) {
      console.warn("kokoro: WebGPU load failed, falling back to WASM", e);
    }
  }
  if (!tts) tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm", progress_callback });

  const voices = Object.entries(tts.voices).map(([id, v]) => ({
    id,
    name: v.name,
    language: v.language,
    gender: v.gender,
    grade: v.overallGrade,
  }));
  post({ type: "ready", device, dtype, voices, loadMs: performance.now() - t0 });
}

async function synth(id: number, text: string, voice: string, speed: number) {
  if (!tts) throw new Error("Kokoro is not loaded");
  const t0 = performance.now();
  const audio = await tts.generate(text, { voice: voice as never, speed });
  const samples = audio.audio;
  const stats = analyse(samples);
  post({ type: "audio", id, samples, sampleRate: audio.sampling_rate, ms: performance.now() - t0, stats }, [samples.buffer]);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") await load(msg.device);
    else if (msg.type === "synth") await synth(msg.id, msg.text, msg.voice, msg.speed);
  } catch (err) {
    post({ type: "error", id: msg.type === "synth" ? msg.id : undefined, message: String(err instanceof Error ? err.message : err) });
  }
};
