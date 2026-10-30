// ElevenLabs text-to-speech, called straight from the browser (their API allows any origin, so no proxy).
// The API key lives in localStorage and is only ever sent to api.elevenlabs.io.
import { cacheKey, idbAudioCache, type AudioCache } from "../../lib/cache";
import { timing } from "../../lib/timing";
import type { NonVerbal, Style, TTSAdapter, VoiceInfo } from "./types";
import { elevenText } from "./styleMap";

export const ELEVEN_API = "https://api.elevenlabs.io";
export const ELEVEN_OUTPUT_FORMAT = "mp3_44100_128";

/** Model ids from ElevenLabs' models page. The plan named eleven_v3; v4 is newer and follows audio tags better. */
export const ELEVEN_MODELS = [
  { id: "eleven_v4", label: "Eleven v4 (most expressive, 10k chars)" },
  { id: "eleven_v3", label: "Eleven v3 (5k chars)" },
  { id: "eleven_v4_turbo", label: "Eleven v4 Turbo (low latency)" },
] as const;
export const DEFAULT_ELEVEN_MODEL = ELEVEN_MODELS[0].id;

export interface ElevenConfig {
  apiKey: string;
  modelId: string;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

const abortError = () => new DOMException("aborted", "AbortError");

async function describeHttpError(res: Response): Promise<ElevenLabsError> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  const status = res.status;
  if (status === 401) return new ElevenLabsError("ElevenLabs rejected the API key (401). Check it in Settings.", status);
  if (status === 402 || /quota|credit/i.test(body)) {
    return new ElevenLabsError(`ElevenLabs says you are out of credits or over quota (${status}). ${body}`, status);
  }
  if (status === 429) return new ElevenLabsError("ElevenLabs is rate limiting requests (429). Wait a moment and try again.", status);
  if (status === 404 || status === 422) {
    return new ElevenLabsError(`ElevenLabs rejected the request (${status}), often an unknown voice or model id. ${body}`, status);
  }
  return new ElevenLabsError(`ElevenLabs returned ${status}. ${body}`, status);
}

/** Decode mp3 bytes to an AudioBuffer. An offline context needs no user gesture. */
export async function decodeMp3(bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes.slice(0));
}

export class ElevenLabsAdapter implements TTSAdapter {
  readonly id = "elevenlabs" as const;
  readonly label = "ElevenLabs";
  readonly caps = {
    // every style has a native tag; sigh/gasp/laugh too. breath is left to the procedural sound effect.
    styles: new Set<Style>(["normal", "whisper", "slow", "trembling", "shout"]),
    nonverbals: new Set<NonVerbal>(["sigh", "gasp", "laugh"]),
    offline: false,
    latency: "high" as const,
    maxChars: 5000, // eleven_v3's limit; v4 allows 10,000 but 350 is the target anyway
    targetChars: 350, // better prosody than very long requests
    concurrency: 2,
  };

  constructor(
    private readonly cfg: ElevenConfig,
    private readonly cache: AudioCache = idbAudioCache,
    private readonly decode: (b: ArrayBuffer) => Promise<AudioBuffer> = decodeMp3,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private headers() {
    return { "xi-api-key": this.cfg.apiKey, "Content-Type": "application/json" };
  }

  async synth(
    seg: { text: string; style: Style; leadingNonverbal?: NonVerbal; voice: string },
    signal?: AbortSignal,
  ): Promise<AudioBuffer> {
    if (!this.cfg.apiKey) throw new ElevenLabsError("Enter your ElevenLabs API key in Settings first.");
    if (!seg.voice) throw new ElevenLabsError("Choose an ElevenLabs voice in Settings first.");
    const text = elevenText(seg);
    const key = await cacheKey("elevenlabs", this.cfg.modelId, seg.voice, seg.style, seg.leadingNonverbal, text);

    const hit = await this.cache.get(key);
    if (hit?.kind === "mp3") return this.decode(hit.bytes);

    const t0 = performance.now();
    let res: Response;
    try {
      res = await this.fetchFn(
        `${ELEVEN_API}/v1/text-to-speech/${encodeURIComponent(seg.voice)}?output_format=${ELEVEN_OUTPUT_FORMAT}`,
        { method: "POST", headers: this.headers(), body: JSON.stringify({ text, model_id: this.cfg.modelId }), signal },
      );
    } catch (e) {
      if (signal?.aborted) throw abortError();
      throw new ElevenLabsError("Could not reach ElevenLabs. Check your connection (and that nothing blocks api.elevenlabs.io).");
    }
    if (!res.ok) throw await describeHttpError(res);
    const bytes = await res.arrayBuffer();
    timing.record("tts segment (elevenlabs)", performance.now() - t0);
    void this.cache.put(key, { kind: "mp3", bytes: bytes.slice(0) });
    return this.decode(bytes);
  }

  /** Voices on the account (needs a valid key). */
  async listVoices(signal?: AbortSignal): Promise<VoiceInfo[]> {
    if (!this.cfg.apiKey) throw new ElevenLabsError("Enter your ElevenLabs API key first.");
    let res: Response;
    try {
      res = await this.fetchFn(`${ELEVEN_API}/v1/voices`, { headers: { "xi-api-key": this.cfg.apiKey }, signal });
    } catch {
      if (signal?.aborted) throw abortError();
      throw new ElevenLabsError("Could not reach ElevenLabs. Check your connection.");
    }
    if (!res.ok) throw await describeHttpError(res);
    const body = (await res.json()) as { voices?: { voice_id?: string; name?: string; category?: string }[] };
    return (body.voices ?? [])
      .filter((v) => v.voice_id)
      .map((v) => ({ id: v.voice_id!, label: `${v.name ?? v.voice_id}${v.category ? ` (${v.category})` : ""}` }));
  }
}
