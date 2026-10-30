// Ask the model server whether the selected model can read images, so we only send photos when it can.
// Answers are `true`, `false`, or `null` (the server could not tell us; the caller decides what to do).
import type { LLMConfig } from "./types";

export type VisionSupport = boolean | null;
export type ServerKind = "ollama" | "llamacpp" | "other";

/** The server's own API root: the OpenAI-compatible base URL without its trailing `/v1`. */
export const serverRoot = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");

export function serverKind(preset: string | undefined, baseUrl: string): ServerKind {
  if (preset === "ollama" || preset === "llamacpp") return preset;
  try {
    const port = new URL(baseUrl).port;
    if (port === "11434") return "ollama";
    if (port === "8080") return "llamacpp";
  } catch {
    /* not a URL */
  }
  return "other";
}

/** Ollama `POST /api/show` lists `capabilities`, e.g. ["completion","vision","thinking"]. */
export function visionFromOllamaShow(body: unknown): VisionSupport {
  const caps = (body as { capabilities?: unknown } | null)?.capabilities;
  return Array.isArray(caps) ? caps.includes("vision") : null;
}

/** llama.cpp `GET /props` reports `modalities: { vision: boolean }` once a projector is loaded. */
export function visionFromLlamaProps(body: unknown): VisionSupport {
  const v = (body as { modalities?: { vision?: unknown } } | null)?.modalities?.vision;
  return typeof v === "boolean" ? v : null;
}

export async function detectVision(
  cfg: LLMConfig & { preset?: string },
  signal?: AbortSignal,
): Promise<VisionSupport> {
  const root = serverRoot(cfg.baseUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  try {
    switch (serverKind(cfg.preset, cfg.baseUrl)) {
      case "ollama": {
        if (!cfg.model.trim()) return null;
        const res = await fetch(`${root}/api/show`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: cfg.model, name: cfg.model }),
          signal,
        });
        return res.ok ? visionFromOllamaShow(await res.json()) : null;
      }
      case "llamacpp": {
        const res = await fetch(`${root}/props`, { headers, signal });
        return res.ok ? visionFromLlamaProps(await res.json()) : null;
      }
      default:
        return null;
    }
  } catch {
    return null; // unreachable, CORS, or not JSON: we simply do not know
  }
}
