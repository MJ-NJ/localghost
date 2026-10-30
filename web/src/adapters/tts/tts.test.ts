import { describe, expect, it, vi } from "vitest";
import type { AudioCache, CacheEntry } from "../../lib/cache";
import { cacheKey } from "../../lib/cache";
import type { CueEvent } from "../../cue/spec";
import { ElevenLabsAdapter, ElevenLabsError } from "./elevenlabs";
import { foldNonverbals, routeForAdapter } from "./router";
import { elevenText, kokoroSpeed } from "./styleMap";

const memCache = (): AudioCache & { map: Map<string, CacheEntry> } => {
  const map = new Map<string, CacheEntry>();
  return { map, get: async (k) => map.get(k), put: async (k, e) => void map.set(k, e) };
};
const fakeBuf = (d = 1) => ({ duration: d }) as AudioBuffer;
const speech = (text: string, extra: Partial<Extract<CueEvent, { kind: "speech" }>> = {}): CueEvent => ({
  kind: "speech",
  text,
  style: "normal",
  ...extra,
});

describe("styleMap", () => {
  it("builds ElevenLabs text with non-verbal then style tags", () => {
    expect(elevenText({ text: "It isn't now.", style: "whisper" })).toBe("[whispers] It isn't now.");
    expect(elevenText({ text: "Hi.", style: "normal", leadingNonverbal: "sigh" })).toBe("[sighs] Hi.");
    expect(elevenText({ text: "Hi.", style: "slow", leadingNonverbal: "gasp" })).toBe("[gasps] [slowly] Hi.");
    expect(elevenText({ text: "Plain.", style: "normal" })).toBe("Plain.");
  });
  it("breath has no ElevenLabs tag", () => {
    expect(elevenText({ text: "x", style: "normal", leadingNonverbal: "breath" })).toBe("x");
  });
  it("Kokoro speeds: slow < whisper < baseline", () => {
    expect(kokoroSpeed("slow")).toBeLessThan(kokoroSpeed("whisper"));
    expect(kokoroSpeed("whisper")).toBeLessThan(kokoroSpeed("normal"));
  });
});

describe("router", () => {
  const native = new Set(["sigh", "gasp", "laugh"] as const);

  it("folds a native non-verbal into the next speech, across instant events", () => {
    const out = foldNonverbals([{ kind: "nonverbal", nv: "sigh" }, { kind: "sfx", name: "creak" }, speech("Hello.")], native);
    expect(out).toEqual([{ kind: "sfx", name: "creak" }, speech("Hello.", { leadingNonverbal: "sigh" })]);
  });
  it("keeps non-verbals that are not native, or not directly before speech", () => {
    expect(foldNonverbals([{ kind: "nonverbal", nv: "breath" }, speech("Hi.")], native)).toHaveLength(2);
    const pausedBetween = [{ kind: "nonverbal", nv: "gasp" }, { kind: "pause", seconds: 1 }, speech("Hi.")] as CueEvent[];
    expect(foldNonverbals(pausedBetween, native)).toEqual(pausedBetween);
  });
  it("does nothing for adapters without native non-verbals (Kokoro)", () => {
    const evs: CueEvent[] = [{ kind: "nonverbal", nv: "sigh" }, speech("Hi.")];
    expect(foldNonverbals(evs, new Set())).toBe(evs);
  });
  it("segmenting keeps the non-verbal on the first sentence only, and never merges across it", () => {
    const eleven = new ElevenLabsAdapter({ apiKey: "k", modelId: "m" }, memCache());
    const out = routeForAdapter(
      [speech("One. Two. Three.", { leadingNonverbal: "sigh" }), speech("Four.", { leadingNonverbal: "gasp" })],
      eleven,
    ) as Extract<CueEvent, { kind: "speech" }>[];
    expect(out.map((e) => [e.text, e.leadingNonverbal])).toEqual([
      ["One. Two. Three.", "sigh"],
      ["Four.", "gasp"],
    ]);
  });
});

describe("ElevenLabsAdapter", () => {
  const cfg = { apiKey: "secret", modelId: "eleven_v4" };
  const ok = () => vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

  it("posts text with tags to the voice endpoint with the key header, and decodes the mp3", async () => {
    const f = ok();
    const a = new ElevenLabsAdapter(cfg, memCache(), async () => fakeBuf(2), f as unknown as typeof fetch);
    const buf = await a.synth({ text: "Hello.", style: "whisper", leadingNonverbal: "sigh", voice: "voice-1" });
    expect(buf.duration).toBe(2);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("secret");
    expect(JSON.parse(init.body as string)).toEqual({ text: "[sighs] [whispers] Hello.", model_id: "eleven_v4" });
  });

  it("serves the second identical request from the cache without calling the network", async () => {
    const f = ok();
    const cache = memCache();
    const a = new ElevenLabsAdapter(cfg, cache, async () => fakeBuf(), f as unknown as typeof fetch);
    const seg = { text: "Same line.", style: "normal" as const, voice: "v" };
    await a.synth(seg);
    await a.synth(seg);
    expect(f).toHaveBeenCalledTimes(1);
    expect(cache.map.size).toBe(1);
    await a.synth({ ...seg, voice: "other" }); // a different voice is a different clip
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("explains common failures in plain words", async () => {
    const run = async (status: number, body = "") => {
      const f = vi.fn(async () => new Response(body, { status }));
      const a = new ElevenLabsAdapter(cfg, memCache(), async () => fakeBuf(), f as unknown as typeof fetch);
      return a.synth({ text: "x", style: "normal", voice: "v" }).then(() => new Error("no error"), (e: ElevenLabsError) => e);
    };
    expect((await run(401)).message).toMatch(/API key/);
    expect((await run(429)).message).toMatch(/rate limiting/);
    expect((await run(402, "quota_exceeded")).message).toMatch(/credits/);
    expect((await run(422, "invalid voice")).message).toMatch(/voice or model/);
  });

  it("asks for a key and a voice before calling anything", async () => {
    const f = ok();
    const noKey = new ElevenLabsAdapter({ apiKey: "", modelId: "m" }, memCache(), async () => fakeBuf(), f as unknown as typeof fetch);
    await expect(noKey.synth({ text: "x", style: "normal", voice: "v" })).rejects.toThrow(/API key/);
    const noVoice = new ElevenLabsAdapter(cfg, memCache(), async () => fakeBuf(), f as unknown as typeof fetch);
    await expect(noVoice.synth({ text: "x", style: "normal", voice: "" })).rejects.toThrow(/voice/);
    expect(f).not.toHaveBeenCalled();
  });

  it("lists voices", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ voices: [{ voice_id: "a", name: "Adam", category: "premade" }, { name: "x" }] })));
    const a = new ElevenLabsAdapter(cfg, memCache(), async () => fakeBuf(), f as unknown as typeof fetch);
    expect(await a.listVoices()).toEqual([{ id: "a", label: "Adam (premade)" }]);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://api.elevenlabs.io/v1/voices");
  });
});

describe("cacheKey", () => {
  it("is stable and changes with any part", async () => {
    const a = await cacheKey("kokoro", "v", "normal", "", "Hello");
    expect(await cacheKey("kokoro", "v", "normal", "", "Hello")).toBe(a);
    expect(await cacheKey("kokoro", "v", "whisper", "", "Hello")).not.toBe(a);
    expect(await cacheKey("elevenlabs", "v", "normal", "", "Hello")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
