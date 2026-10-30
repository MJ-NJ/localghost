// LLM settings persisted in localStorage. The API key lives here and is only ever sent to baseUrl.
import { DEFAULT_MODEL, LLM_PRESETS, type LLMPreset } from "../adapters/llm/presets";

export interface LLMSettings {
  preset: LLMPreset["id"];
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Send photos to the model? auto = ask the server whether the model can see; on/off = your call. */
  images: "auto" | "on" | "off";
}

const KEY = "llmSettings";

export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  preset: "ollama",
  baseUrl: LLM_PRESETS[0].baseUrl,
  model: DEFAULT_MODEL,
  apiKey: "",
  images: "auto",
};

export function loadLLMSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_LLM_SETTINGS, ...(JSON.parse(raw) as Partial<LLMSettings>) };
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return DEFAULT_LLM_SETTINGS;
}

export function saveLLMSettings(s: LLMSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
