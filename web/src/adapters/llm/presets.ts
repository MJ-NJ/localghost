export interface LLMPreset {
  id: "ollama" | "lmstudio" | "llamacpp" | "custom";
  label: string;
  baseUrl: string;
}

export const LLM_PRESETS: readonly LLMPreset[] = [
  { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { id: "llamacpp", label: "llama.cpp server", baseUrl: "http://localhost:8080/v1" },
  { id: "custom", label: "Custom (OpenAI-compatible)", baseUrl: "" },
];

/**
 * Left empty on purpose: the exact Gemma 4 tag must be confirmed with `ollama list`, not guessed
 * (PLAN.md, M3). Set it once confirmed.
 */
export const DEFAULT_MODEL = "";
