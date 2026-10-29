import { useState } from "react";
import { LLM_PRESETS } from "../adapters/llm/presets";
import { OpenAICompatAdapter } from "../adapters/llm/openaiCompat";
import type { VoiceInfo } from "../adapters/tts/types";
import type { LLMSettings } from "./settings";
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
      {err != null && <ErrorView error={err} />}

      <h3>Voice</h3>
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

      <h3>Accessibility</h3>
      <label className="check">
        <input type="checkbox" checked={p.reduceFlashing} onChange={(e) => p.onReduceFlashing(e.target.checked)} />
        Reduce flashing
      </label>
    </>
  );
}
