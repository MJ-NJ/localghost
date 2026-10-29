import { describe, expect, it, vi } from "vitest";
import { OpenAICompatAdapter } from "../adapters/llm/openaiCompat";
import { LLMError, type ChatRequest, type LLMAdapter } from "../adapters/llm/types";
import { SFX_NAMES } from "../cue/spec";
import { direct, isBroken } from "./director";
import { PROFILES, profileFor } from "./profiles";
import { buildSystemPrompt, REPAIR_LINE } from "./prompts";

const GOOD = "[ambient low]\nYou hear the old hallway breathing slowly around you tonight.\n[pause 2]\n[sfx creak]\n[ambient stop]\n";

function fakeAdapter(outputs: string[]): LLMAdapter & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    id: "fake",
    caps: { vision: false, streaming: true, local: true },
    calls,
    async *chat(req) {
      calls.push(req);
      const out = outputs[Math.min(calls.length - 1, outputs.length - 1)];
      for (let i = 0; i < out.length; i += 7) yield out.slice(i, i + 7); // awkward chunk boundaries
    },
  };
}

describe("director", () => {
  it("streams, parses incrementally and does not retry good output", async () => {
    const a = fakeAdapter([GOOD]);
    const seen: string[] = [];
    const r = await direct({ adapter: a, level: 3, onText: (d) => seen.push(d) });
    expect(a.calls).toHaveLength(1);
    expect(r.attempts).toBe(1);
    expect(r.degraded).toBe(false);
    expect(seen.join("")).toBe(GOOD);
    expect(r.events.map((e) => e.kind)).toEqual(["ambient", "speech", "pause", "sfx", "ambient"]);
  });

  it("retries once with the repair line when there are no tags", async () => {
    const a = fakeAdapter(["Just a plain paragraph with no tags at all but plenty of words in it.", GOOD]);
    const r = await direct({ adapter: a, level: 3 });
    expect(a.calls).toHaveLength(2);
    const retryUser = a.calls[1].messages[1].content as string;
    expect(retryUser).toContain(REPAIR_LINE);
    expect(r.attempts).toBe(2);
    expect(r.degraded).toBe(false);
  });

  it("plays what it has if the retry also fails, and never retries twice", async () => {
    const a = fakeAdapter(["nope", "still nope"]);
    const r = await direct({ adapter: a, level: 3 });
    expect(a.calls).toHaveLength(2);
    expect(r.degraded).toBe(true);
  });

  it("isBroken: <10 speech words or no tags", () => {
    expect(isBroken([])).toBe(true);
    expect(isBroken([{ kind: "pause", seconds: 1 }])).toBe(true);
    expect(isBroken([{ kind: "speech", text: "one two three four five six seven eight nine ten", style: "normal" }])).toBe(true);
  });
});

describe("prompts", () => {
  it("only offers light modes the level allows, in both the tag list and the example", () => {
    const p1 = buildSystemPrompt({ profile: profileFor(1) });
    expect(p1).toContain("[light pulse|calm]");
    expect(p1).not.toMatch(/flicker|blackout|red/);
    const p3 = buildSystemPrompt({ profile: profileFor(3) });
    expect(p3).toContain("[light flicker|blackout N|pulse|calm]");
    expect(p3).not.toContain("|red");
  });
  it("lists every sfx from the spec", () => {
    const p = buildSystemPrompt({ profile: profileFor(3) });
    expect(p).toContain(`[sfx ${SFX_NAMES.join("|")}]`);
  });
  it("photo rule depends on whether a photo exists", () => {
    expect(buildSystemPrompt({ profile: profileFor(3) })).toContain("Do not use [photo reveal].");
    expect(buildSystemPrompt({ profile: profileFor(3), bestPhotoId: "room_2" })).toContain(
      "Use [photo reveal room_2] exactly once, at the climax.",
    );
  });
  it("fills inventory, notes and fallbacks", () => {
    const empty = buildSystemPrompt({ profile: profileFor(2) });
    expect(empty).toContain("No photos. Invent an ordinary modern home.");
    expect(empty).toContain("LISTENER'S NOTES:\nNone.");
    const full = buildSystemPrompt({ profile: profileFor(2), inventory: '{"place":"hall"}', notes: "cat named Moss" });
    expect(full).toContain('{"place":"hall"}');
    expect(full).toContain("cat named Moss");
  });
  it("matches the profile table", () => {
    expect(PROFILES.map((p) => p.budget)).toEqual([3, 5, 8, 12, 16]);
    expect(PROFILES.map((p) => p.jumps)).toEqual([0, 1, 2, 3, 4]);
    expect(buildSystemPrompt({ profile: profileFor(5) })).toContain("Length: 600–800 words");
  });
});

describe("OpenAICompatAdapter", () => {
  const sse = (...chunks: string[]) =>
    chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") + "data: [DONE]\n\n";

  async function collect(it: AsyncIterable<string>) {
    let s = "";
    for await (const d of it) s += d;
    return s;
  }

  it("streams deltas, sends bearer only when a key is set, and image parts pass through", async () => {
    const fetchMock = vi.fn(async () => new Response(sse("Hel", "lo"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = new OpenAICompatAdapter({ baseUrl: "http://localhost:11434/v1/", model: "m" });
    const img = { type: "image_url" as const, image_url: { url: "data:image/jpeg;base64,AAA" } };
    expect(await collect(a.chat({ messages: [{ role: "user", content: [img] }], json: true }))).toBe("Hello");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content[0]).toEqual(img);

    const keyed = new OpenAICompatAdapter({ baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" });
    await collect(keyed.chat({ messages: [] }));
    const init2 = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((init2.headers as Record<string, string>).Authorization).toBe("Bearer k");
    vi.unstubAllGlobals();
  });

  it("detects local hosts", () => {
    const c = (u: string) => new OpenAICompatAdapter({ baseUrl: u, model: "m" }).caps.local;
    expect(c("http://localhost:11434/v1")).toBe(true);
    expect(c("http://127.0.0.1:1234/v1")).toBe(true);
    expect(c("http://[::1]:8080/v1")).toBe(true);
    expect(c("https://api.example.com/v1")).toBe(false);
  });

  it("explains a refused connection with the OLLAMA_ORIGINS fix", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const a = new OpenAICompatAdapter({ baseUrl: "http://localhost:11434/v1", model: "m" });
    const err = await collect(a.chat({ messages: [] })).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.message).toContain("OLLAMA_ORIGINS");
    expect(err.commands.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("requires a model name", async () => {
    const a = new OpenAICompatAdapter({ baseUrl: "http://localhost:11434/v1", model: " " });
    await expect(collect(a.chat({ messages: [] }))).rejects.toThrow(/model name/i);
  });

  it("reports HTTP errors with status and detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("model not found", { status: 404 })));
    const a = new OpenAICompatAdapter({ baseUrl: "http://localhost:11434/v1", model: "x" });
    await expect(collect(a.chat({ messages: [] }))).rejects.toThrow(/404.*model not found/);
    vi.unstubAllGlobals();
  });
});
