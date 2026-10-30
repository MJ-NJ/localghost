import { describe, expect, it } from "vitest";
import type { CueEvent } from "../cue/spec";
import type { TTSAdapter } from "../adapters/tts/types";
import { MIN_BUFFER_SECONDS, StorySession, shouldStart, synthesizeInto } from "./session";
import { PACING, TimelineBuilder } from "./timeline";

const buf = (duration: number) => ({ duration }) as AudioBuffer;
const speech = (text: string): CueEvent => ({ kind: "speech", text, style: "normal" });

describe("TimelineBuilder", () => {
  it("stops at the first unsynthesized speech and continues when it arrives", () => {
    const a = speech("a");
    const b = speech("b");
    const events: CueEvent[] = [{ kind: "ambient", mode: "low" }, a, { kind: "pause", seconds: 2 }, { kind: "sfx", name: "knock" }, b];
    const buffers = new Map<CueEvent, AudioBuffer>();
    const tb = new TimelineBuilder(events);

    expect(tb.advance(buffers).map((i) => i.ev.kind)).toEqual(["ambient"]);
    expect(tb.complete).toBe(false);
    expect(tb.frontier).toBe(0);

    buffers.set(a, buf(1));
    const added = tb.advance(buffers);
    expect(added.map((i) => i.ev.kind)).toEqual(["speech", "pause", "sfx"]);
    expect(tb.frontier).toBeCloseTo(1 + PACING.speechGap + 2);
    expect(tb.complete).toBe(false);

    buffers.set(b, buf(1));
    expect(tb.advance(buffers)).toHaveLength(1);
    expect(tb.complete).toBe(true);
    expect(tb.total).toBeCloseTo(1 + PACING.speechGap + 2 + 1 + PACING.speechGap + PACING.tail);
  });

  it("gives the same timeline whether built at once or incrementally", () => {
    const a = speech("a");
    const b = speech("b");
    const events: CueEvent[] = [a, { kind: "nonverbal", nv: "sigh" }, b];
    const all = new Map<CueEvent, AudioBuffer>([[a, buf(1.2)], [b, buf(0.8)]]);
    const whole = new TimelineBuilder(events);
    whole.advance(all);

    const inc = new TimelineBuilder(events);
    const part = new Map<CueEvent, AudioBuffer>();
    part.set(a, all.get(a)!);
    inc.advance(part);
    part.set(b, all.get(b)!);
    inc.advance(part);
    expect(inc.items.map((i) => i.at)).toEqual(whole.items.map((i) => i.at));
    expect(inc.total).toBe(whole.total);
  });
});

describe("shouldStart", () => {
  const stats = (o: Partial<Parameters<typeof shouldStart>[0]>) => ({
    readySegments: 2,
    totalSegments: 75,
    readySeconds: 8,
    avgSynthSec: 1,
    ...o,
  });

  it("starts immediately once everything is ready", () => {
    expect(shouldStart(stats({ readySegments: 75, readySeconds: 0.5 }))).toBe(true);
  });
  it("never starts with fewer than 2 segments ready", () => {
    expect(shouldStart(stats({ readySegments: 1, readySeconds: 30 }))).toBe(false);
  });
  it("starts after a small buffer when synthesis is faster than playback", () => {
    // 4 s of playback per segment, 1 s to make each: no shortfall
    expect(shouldStart(stats({}))).toBe(true);
    expect(shouldStart(stats({ readySeconds: MIN_BUFFER_SECONDS - 0.5 }))).toBe(false);
  });
  it("buffers the expected shortfall when synthesis is slower than playback", () => {
    // 2 s of playback per segment but 5 s to make each, 73 remaining: need ~ (5-2)*73*1.15 = 252 s
    const slow = { readySegments: 2, readySeconds: 4, avgSynthSec: 5 };
    expect(shouldStart(stats(slow))).toBe(false);
    expect(shouldStart(stats({ ...slow, readySeconds: 300 }))).toBe(true);
  });
});

describe("StorySession", () => {
  it("is complete immediately when there is no speech, and ready() resolves", async () => {
    const s = new StorySession([{ kind: "ambient", mode: "low" }]);
    expect(s.complete).toBe(true);
    await s.ready();
  });

  it("ready() resolves once enough audio exists and notifies listeners of new items", async () => {
    const evs = Array.from({ length: 10 }, (_, i) => speech(`s${i}`));
    const s = new StorySession(evs);
    const seen: number[] = [];
    s.onItems((a) => seen.push(a.length));
    let resolved = false;
    void s.ready().then(() => (resolved = true));

    s.addBuffer(evs[0], buf(2), 500);
    await Promise.resolve();
    expect(resolved).toBe(false); // only 1 segment
    s.addBuffer(evs[1], buf(2), 500);
    await Promise.resolve();
    expect(resolved).toBe(true); // 2 segments, ~5 s buffered, synthesis faster than playback
    expect(seen).toEqual([1, 1]);
    expect(s.complete).toBe(false);
  });

  it("ready() rejects if synthesis fails first", async () => {
    const s = new StorySession([speech("a one two three")]);
    const p = s.ready();
    s.fail(new Error("boom"));
    await expect(p).rejects.toThrow("boom");
  });
});

describe("synthesizeInto with parallel workers", () => {
  /** Adapter whose segments finish in reverse order, to prove the timeline still comes out in order. */
  const adapter = (delays: Record<string, number>, active: { now: number; max: number }): TTSAdapter => ({
    id: "kokoro-web",
    label: "fake",
    caps: { styles: new Set(), nonverbals: new Set(), offline: true, latency: "low", maxChars: 500, targetChars: 0, concurrency: 1 },
    async synth(seg) {
      active.now++;
      active.max = Math.max(active.max, active.now);
      await new Promise((r) => setTimeout(r, delays[seg.text] ?? 1));
      active.now--;
      return { duration: seg.text.length } as AudioBuffer;
    },
  });

  it("runs up to `concurrency` at once and keeps playback order", async () => {
    const evs = [speech("aaaa"), speech("bb"), speech("c"), speech("dddddd")];
    const s = new StorySession(evs);
    const active = { now: 0, max: 0 };
    await synthesizeInto(s, {
      adapter: adapter({ aaaa: 30, bb: 5, c: 15, dddddd: 1 }, active),
      voice: "v",
      concurrency: 2,
    });
    expect(active.max).toBe(2);
    expect(s.complete).toBe(true);
    const speechAt = s.builder.items.filter((i) => i.ev.kind === "speech").map((i) => (i.ev as { text: string }).text);
    expect(speechAt).toEqual(["aaaa", "bb", "c", "dddddd"]);
  });

  it("defaults to one at a time", async () => {
    const evs = [speech("aa"), speech("bb"), speech("cc")];
    const active = { now: 0, max: 0 };
    await synthesizeInto(new StorySession(evs), { adapter: adapter({}, active), voice: "v" });
    expect(active.max).toBe(1);
  });

  it("fails the session if a worker fails", async () => {
    const s = new StorySession([speech("aa"), speech("bb")]);
    const bad: TTSAdapter = { ...adapter({}, { now: 0, max: 0 }), synth: async () => Promise.reject(new Error("boom")) };
    await expect(synthesizeInto(s, { adapter: bad, voice: "v", concurrency: 2 })).rejects.toThrow("boom");
    expect(s.error?.message).toBe("boom");
  });
});
