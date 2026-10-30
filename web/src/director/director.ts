import { CueParser, type ParserStats } from "../cue/parser";
import type { CueEvent } from "../cue/spec";
import type { ChatMessage, LLMAdapter } from "../adapters/llm/types";
import { timing } from "../lib/timing";
import { profileFor } from "./profiles";
import { buildSystemPrompt, REPAIR_LINE, USER_MESSAGE, type PromptInput } from "./prompts";

export const TEMPERATURE = 0.9;
/** ~800 words of speech plus tags fits well under this; it only guards against runaway generation. */
export const MAX_TOKENS = 2048;
export const MIN_SPEECH_WORDS = 10;

export interface DirectorOptions extends Omit<PromptInput, "profile"> {
  adapter: LLMAdapter;
  level: number;
  signal?: AbortSignal;
  /** Raw streamed text, for the live "Summoning" display. */
  onText?(delta: string): void;
}

export interface DirectorResult {
  events: CueEvent[];
  text: string;
  stats: ParserStats;
  attempts: number;
  /** true if the final output still failed the format check */
  degraded: boolean;
  ttftMs: number | null;
  genMs: number;
  tokensPerSec: number;
  /** "length" means the model was cut off before finishing the story. */
  finishReason: string | null;
}

interface Attempt {
  events: CueEvent[];
  text: string;
  stats: ParserStats;
  ttftMs: number | null;
  genMs: number;
  chunks: number;
  finishReason: string | null;
}

/**
 * If the story starts an ambient bed but never stops it (small models write "[sfx stop]" etc.),
 * end with a short pause and a fade-out so it does not just cut off.
 */
export function ensureEnding(events: CueEvent[]): CueEvent[] {
  const ambient = events.filter((e) => e.kind === "ambient");
  if (!ambient.length || (ambient[ambient.length - 1] as { mode: string }).mode === "stop") return events;
  return [...events, { kind: "pause", seconds: 2 }, { kind: "ambient", mode: "stop" }];
}

export const countSpeechWords = (events: CueEvent[]) =>
  events.reduce((n, e) => (e.kind === "speech" ? n + e.text.split(/\s+/).filter(Boolean).length : n), 0);

export const tagCount = (events: CueEvent[]) => events.filter((e) => e.kind !== "speech").length;

/** The repair trigger from PLAN.md: fewer than 10 speech words, or no tags at all. */
export const isBroken = (events: CueEvent[]) => countSpeechWords(events) < MIN_SPEECH_WORDS || tagCount(events) === 0;

async function attempt(adapter: LLMAdapter, messages: ChatMessage[], o: DirectorOptions): Promise<Attempt> {
  const parser = new CueParser();
  const events: CueEvent[] = [];
  let text = "";
  let chunks = 0;
  let ttftMs: number | null = null;
  const t0 = performance.now();

  for await (const delta of adapter.chat({ messages, temperature: TEMPERATURE, maxTokens: MAX_TOKENS }, o.signal)) {
    if (ttftMs === null) ttftMs = performance.now() - t0;
    chunks++;
    text += delta;
    o.onText?.(delta);
    events.push(...parser.push(delta));
  }
  events.push(...parser.flush());
  return {
    events,
    text,
    stats: parser.stats,
    ttftMs,
    genMs: performance.now() - t0,
    chunks,
    finishReason: adapter.lastFinishReason ?? null,
  };
}

/** Stream a story from the LLM, parse it incrementally, and retry once if the format is broken. */
export async function direct(o: DirectorOptions): Promise<DirectorResult> {
  const system = buildSystemPrompt({
    profile: profileFor(o.level),
    inventory: o.inventory,
    notes: o.notes,
    bestPhotoId: o.bestPhotoId,
  });
  const messages = (user: string): ChatMessage[] => [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let best = await attempt(o.adapter, messages(USER_MESSAGE), o);
  let attempts = 1;

  if (isBroken(best.events)) {
    console.warn("director: output broke the format, retrying once");
    o.onText?.("\n");
    const retry = await attempt(o.adapter, messages(`${USER_MESSAGE}\n\n${REPAIR_LINE}`), o);
    attempts = 2;
    // "If it still fails, play what we have": keep whichever attempt has more speech
    if (!isBroken(retry.events) || countSpeechWords(retry.events) > countSpeechWords(best.events)) best = retry;
  }

  const tokensPerSec = best.genMs > 0 ? best.chunks / (best.genMs / 1000) : 0;
  if (best.ttftMs !== null) timing.record("llm time-to-first-token", best.ttftMs);
  timing.record("llm generation", best.genMs);
  timing.note(`llm: ~${tokensPerSec.toFixed(1)} tokens/s (stream chunks), ${attempts} attempt(s)`);
  if (best.stats.unknownTags) timing.count("unknown tags dropped", best.stats.unknownTags);

  const events = ensureEnding(best.events);
  const kinds = new Map<string, number>();
  for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  timing.note(
    `story: ${countSpeechWords(events)} words; ` + [...kinds].map(([k, n]) => `${n} ${k}`).join(", ") + `; finish: ${best.finishReason ?? "unknown"}`,
  );
  if (best.finishReason === "length") {
    console.warn("director: the model hit its token limit; the story was cut off");
    timing.note("The story was cut off by the token limit (max_tokens or the server's context size).");
  }

  return {
    finishReason: best.finishReason,
    events,
    text: best.text,
    stats: best.stats,
    attempts,
    degraded: isBroken(best.events),
    ttftMs: best.ttftMs,
    genMs: best.genMs,
    tokensPerSec,
  };
}
