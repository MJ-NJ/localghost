export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface LLMAdapter {
  id: string;
  caps: { vision: boolean; streaming: boolean; local: boolean };
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<string>;
}

export interface LLMConfig {
  baseUrl: string;
  model: string;
  /** Sent as a Bearer token only when set, and only to baseUrl. */
  apiKey?: string;
}

/** An error with a human-friendly explanation and optional copyable fix commands. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly commands: { label: string; command: string }[] = [],
  ) {
    super(message);
    this.name = "LLMError";
  }
}
