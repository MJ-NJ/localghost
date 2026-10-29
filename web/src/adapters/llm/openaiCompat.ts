import { SseParser } from "../../lib/sse";
import { LLMError, type ChatRequest, type LLMAdapter, type LLMConfig } from "./types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

export function isLocalUrl(baseUrl: string): boolean {
  return LOCAL_HOSTS.has(hostOf(baseUrl));
}

const trimSlash = (s: string) => s.trim().replace(/\/+$/, "");

export class OpenAICompatAdapter implements LLMAdapter {
  readonly id = "openai-compat";
  readonly caps: LLMAdapter["caps"];

  constructor(private readonly cfg: LLMConfig) {
    // vision support can't be known up front; assume yes and let the vision pass report failure (M4)
    this.caps = { vision: true, streaming: true, local: isLocalUrl(cfg.baseUrl) };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  private unreachable(): LLMError {
    const host = hostOf(this.cfg.baseUrl);
    if (this.caps.local) {
      const origin = typeof location !== "undefined" ? location.origin : "http://localhost:5173";
      return new LLMError(
        `Could not reach ${host}. Is Ollama (or your local server) running? Did you set OLLAMA_ORIGINS to include ${origin} and restart Ollama?`,
        [
          { label: "Windows (PowerShell), then restart Ollama", command: `setx OLLAMA_ORIGINS "${origin}"` },
          { label: "macOS / Linux", command: `OLLAMA_ORIGINS=${origin} ollama serve` },
        ],
      );
    }
    return new LLMError(`Could not reach ${host}. Check the URL, your network, and that the server allows requests from this page (CORS).`);
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(`${trimSlash(this.cfg.baseUrl)}/models`, { headers: this.headers(), signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw this.unreachable();
    }
    if (!res.ok) throw new LLMError(`Listing models failed (${res.status}).`);
    const body = (await res.json()) as { data?: { id?: string }[] };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
  }

  async *chat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<string> {
    if (!this.cfg.model.trim()) {
      throw new LLMError("No model name set. Enter the model tag from `ollama list` in Settings.");
    }
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: req.messages,
      stream: true,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    };
    if (req.json) body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await fetch(`${trimSlash(this.cfg.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw this.unreachable();
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new LLMError(`The model server returned ${res.status}${detail ? `: ${detail}` : ""}`, [], res.status);
    }
    if (!res.body) throw new LLMError("The model server sent no response body.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseParser();

    const deltas = function* (data: string[]) {
      for (const d of data) {
        try {
          const text = (JSON.parse(d) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          /* ignore a malformed event */
        }
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const r = sse.push(decoder.decode(value, { stream: true }));
      yield* deltas(r.data);
      if (r.done) return;
    }
    yield* deltas(sse.flush().data);
  }
}
