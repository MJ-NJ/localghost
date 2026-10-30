// LLM settings persisted in localStorage. The API key lives here and is only ever sent to baseUrl.
import { DEFAULT_MODEL, LLM_PRESETS, type LLMPreset } from "../adapters/llm/presets";
import { DEFAULT_ELEVEN_MODEL } from "../adapters/tts/elevenlabs";

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

/** ElevenLabs settings. The key is saved in this browser and only ever sent to api.elevenlabs.io. */
export interface ElevenSettings {
  apiKey: string;
  modelId: string;
  voiceId: string;
}

const ELEVEN_KEY = "elevenSettings";

/**
 * Dev only: `web/.env.local` may set VITE_ELEVENLABS_API_KEY. Vite inlines VITE_* values into the browser bundle,
 * so this is guarded by import.meta.env.DEV; production builds replace it with "" and the key is not shipped.
 */
const DEV_ELEVEN_KEY: string = import.meta.env.DEV ? ((import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined) ?? "") : "";
export const usingDevElevenKey = (key: string) => DEV_ELEVEN_KEY !== "" && key === DEV_ELEVEN_KEY;

export const DEFAULT_ELEVEN_SETTINGS: ElevenSettings = { apiKey: DEV_ELEVEN_KEY, modelId: DEFAULT_ELEVEN_MODEL, voiceId: "" };

export function loadElevenSettings(): ElevenSettings {
  try {
    const raw = localStorage.getItem(ELEVEN_KEY);
    if (raw) {
      const merged = { ...DEFAULT_ELEVEN_SETTINGS, ...(JSON.parse(raw) as Partial<ElevenSettings>) };
      if (!merged.apiKey) merged.apiKey = DEV_ELEVEN_KEY;
      return merged;
    }
  } catch {
    /* fall back to defaults */
  }
  return DEFAULT_ELEVEN_SETTINGS;
}

export function saveElevenSettings(v: ElevenSettings) {
  try {
    // a key that came from .env.local is not copied into browser storage
    localStorage.setItem(ELEVEN_KEY, JSON.stringify(usingDevElevenKey(v.apiKey) ? { ...v, apiKey: "" } : v));
  } catch {
    /* storage unavailable */
  }
}

export type TtsProvider = "kokoro-web" | "elevenlabs";

export function loadProvider(): TtsProvider {
  try {
    return localStorage.getItem("ttsProvider") === "elevenlabs" ? "elevenlabs" : "kokoro-web";
  } catch {
    return "kokoro-web";
  }
}

export function saveProvider(p: TtsProvider) {
  try {
    localStorage.setItem("ttsProvider", p);
  } catch {
    /* storage unavailable */
  }
}
