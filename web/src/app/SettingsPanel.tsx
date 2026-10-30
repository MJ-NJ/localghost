import { useState } from "react";
import { LLM_PRESETS } from "../adapters/llm/presets";
import { OpenAICompatAdapter } from "../adapters/llm/openaiCompat";
import type { VisionSupport } from "../adapters/llm/capabilities";
import type { VoiceInfo } from "../adapters/tts/types";
import type { LengthMode } from "../director/length";
import { ELEVEN_MODELS } from "../adapters/tts/elevenlabs";
import { usingDevElevenKey, type ElevenSettings, type LLMSettings, type TtsProvider } from "./settings";
import { ErrorView } from "./ErrorView";

export interface SettingsPanelProps {
  llm: LLMSettings;
  onLlm(s: LLMSettings): void;
  voices: VoiceInfo[];
  voice: string;
  onVoice(v: string): void;
  device: string;
  locked: boolean;
  onLoadVoiceModel(): void;
  provider: TtsProvider;
  onProvider(p: TtsProvider): void;
  eleven: ElevenSettings;
  onEleven(v: ElevenSettings): void;
  elevenVoices: VoiceInfo[];
  loadingElevenVoices: boolean;
  onLoadElevenVoices(): void;
  /** Number of cached audio segments. */
  cacheSize: number;
  onClearCache(): void;
  /** Result of the last "can this model see?" check: undefined = not checked. */
  visionSupport: VisionSupport | undefined;
  checkingVision: boolean;
  onCheckVision(): void;
  /** Parallel Kokoro workers: each is a separate copy of the model (more memory, faster stories). */
  workers: number;
  maxWorkers: number;
  onWorkers(n: number): void;
  lengthMode: LengthMode;
  onLengthMode(m: LengthMode): void;
  /** Measured synthesis seconds per audio second, null until the speed test has run. */
  bench: number | null;
  benching: boolean;
  onSpeedTest(): void;
  reduceFlashing: boolean;
  onReduceFlashing(on: boolean): void;
}

export function SettingsPanel(p: SettingsPanelProps) {
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  async function fetchModels() {
    setErr(null);
    setFetching(true);
    try {
      setModels(await new OpenAICompatAdapter(p.llm).listModels());
    } catch (e) {
      setErr(e);
    }
    setFetching(false);
  }

  const set = (patch: Partial<LLMSettings>) => p.onLlm({ ...p.llm, ...patch });

  return (
    <>
      <h3>Story model</h3>
      <label>
        Provider
        <select
          value={p.llm.preset}
          onChange={(e) => {
            const preset = LLM_PRESETS.find((x) => x.id === e.target.value)!;
            set({ preset: preset.id, baseUrl: preset.id === "custom" ? p.llm.baseUrl : preset.baseUrl });
          }}
        >
          {LLM_PRESETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Base URL
        <input value={p.llm.baseUrl} onChange={(e) => set({ preset: "custom", baseUrl: e.target.value })} />
      </label>
      <label>
        Model
        <input
          list="llm-models"
          placeholder="tag from `ollama list`"
          value={p.llm.model}
          onChange={(e) => set({ model: e.target.value })}
        />
        <datalist id="llm-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <button onClick={fetchModels} disabled={fetching || !p.llm.baseUrl}>
        {fetching ? "Fetching…" : "Fetch models"}
      </button>
      {models.length > 0 && <div className="badge">{models.length} model(s) found</div>}
      <label>
        API key (optional, only sent to the URL above)
        <input type="password" autoComplete="off" value={p.llm.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
      </label>
      <label>
        Read my photos with this model
        <select value={p.llm.images} onChange={(e) => set({ images: e.target.value as LLMSettings["images"] })}>
          <option value="auto">Auto (ask the server)</option>
          <option value="on">Yes, my model can see images</option>
          <option value="off">No, use notes only</option>
        </select>
      </label>
      <button onClick={p.onCheckVision} disabled={p.checkingVision || !p.llm.model.trim()}>
        {p.checkingVision ? "Checking…" : "Check model for image support"}
      </button>
      {p.visionSupport !== undefined && (
        <div className="badge">
          {p.visionSupport === true
            ? "This model reports image support."
            : p.visionSupport === false
              ? "This model reports no image support: photos will be skipped in Auto mode."
              : "The server did not say. In Auto mode photos are tried, and skipped if the model refuses them."}
        </div>
      )}
      {err != null && <ErrorView error={err} />}

      <h3>Voice</h3>
      <label>
        Voice provider
        <select value={p.provider} disabled={p.locked} onChange={(e) => p.onProvider(e.target.value as TtsProvider)}>
          <option value="kokoro-web">Kokoro, in this browser (offline, free)</option>
          <option value="elevenlabs">ElevenLabs (your API key, uses credits)</option>
        </select>
      </label>
      {p.provider === "elevenlabs" && (
        <>
          <label>
            ElevenLabs API key (only sent to api.elevenlabs.io)
            <input
              type="password"
              autoComplete="off"
              value={p.eleven.apiKey}
              onChange={(e) => p.onEleven({ ...p.eleven, apiKey: e.target.value })}
            />
          </label>
          {usingDevElevenKey(p.eleven.apiKey) && (
            <div className="badge">Using the key from web/.env.local (development only; it is not saved in the browser).</div>
          )}
          <label>
            Model
            <select value={p.eleven.modelId} onChange={(e) => p.onEleven({ ...p.eleven, modelId: e.target.value })}>
              {ELEVEN_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={p.onLoadElevenVoices} disabled={p.loadingElevenVoices || !p.eleven.apiKey}>
            {p.loadingElevenVoices ? "Loading voices…" : "Load my voices"}
          </button>
          <label>
            Voice
            <select value={p.eleven.voiceId} onChange={(e) => p.onEleven({ ...p.eleven, voiceId: e.target.value })}>
              {!p.elevenVoices.length && <option value={p.eleven.voiceId}>{p.eleven.voiceId || "(load your voices first)"}</option>}
              {p.elevenVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <div className="badge">
            ElevenLabs charges credits per character. Segments you have already heard are cached on this device and are not paid for again.
          </div>
        </>
      )}
      <label>
        Voice (Kokoro)
        <select value={p.voice} onChange={(e) => p.onVoice(e.target.value)} disabled={p.locked}>
          {!p.voices.length && <option value={p.voice}>{p.voice} (load model to list voices)</option>}
          {p.voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <button onClick={p.onLoadVoiceModel} disabled={p.locked}>
        Load voice model
      </button>
      {p.device && <div className="badge">Running on {p.device}</div>}
      <label>
        Voice workers (parallel copies of the voice model)
        <select value={p.workers} disabled={p.locked} onChange={(e) => p.onWorkers(Number(e.target.value))}>
          {Array.from({ length: p.maxWorkers }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "1 (off, uses least memory)" : `${n} (faster, more memory)`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Story length
        <select value={p.lengthMode} disabled={p.locked} onChange={(e) => p.onLengthMode(e.target.value as LengthMode)}>
          <option value="auto">Auto (fit this computer)</option>
          <option value="short">Short (half length)</option>
          <option value="full">Full (as designed)</option>
        </select>
      </label>
      <button onClick={p.onSpeedTest} disabled={p.locked || p.benching}>
        {p.benching ? "Timing the voice…" : "Run voice speed test"}
      </button>
      <div className="badge">
        {p.bench === null
          ? "Not timed yet with this many workers."
          : p.bench <= 1
            ? `Voice is faster than speech (${p.bench.toFixed(2)}x).`
            : `Voice takes ${p.bench.toFixed(1)}x as long as the speech it makes.`}
      </div>

      <h3>Audio cache</h3>
      <div className="badge">{p.cacheSize} segment{p.cacheSize === 1 ? "" : "s"} saved on this device. Replays never call the voice again.</div>
      <button onClick={p.onClearCache} disabled={p.cacheSize === 0}>
        Clear audio cache
      </button>

      <h3>Accessibility</h3>
      <label className="check">
        <input type="checkbox" checked={p.reduceFlashing} onChange={(e) => p.onReduceFlashing(e.target.checked)} />
        Reduce flashing
      </label>
    </>
  );
}
