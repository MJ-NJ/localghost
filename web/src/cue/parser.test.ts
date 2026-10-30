import { describe, expect, it, vi } from "vitest";
import { CueParser } from "./parser";
import { segment } from "./segmenter";
import type { CueEvent } from "./spec";

const quiet = () => {};
const parse = (s: string) => CueParser.parse(s, quiet);

describe("every tag", () => {
  it("pause", () => {
    expect(parse("[pause 2.5]").events).toEqual([{ kind: "pause", seconds: 2.5 }]);
  });
  it.each(["whisper", "slow", "trembling", "shout"] as const)("style %s applies to the rest of the line", (s) => {
    expect(parse(`[${s}] hello there`).events).toEqual([{ kind: "speech", text: "hello there", style: s }]);
  });
  it.each(["breath", "sigh", "gasp", "laugh"] as const)("nonverbal %s", (nv) => {
    expect(parse(`[${nv}]`).events).toEqual([{ kind: "nonverbal", nv }]);
  });
  it.each(["creak", "knock", "footsteps", "door", "heartbeat", "static", "drip", "scrape", "whispers"] as const)(
    "sfx %s",
    (name) => {
      expect(parse(`[sfx ${name}]`).events).toEqual([{ kind: "sfx", name }]);
    },
  );
  it("light modes", () => {
    expect(parse("[light flicker]").events).toEqual([{ kind: "light", mode: "flicker" }]);
    expect(parse("[light red]").events).toEqual([{ kind: "light", mode: "red" }]);
    expect(parse("[light pulse]").events).toEqual([{ kind: "light", mode: "pulse" }]);
    expect(parse("[light calm]").events).toEqual([{ kind: "light", mode: "calm" }]);
    expect(parse("[light blackout 3]").events).toEqual([{ kind: "light", mode: "blackout", seconds: 3 }]);
  });
  it("ambient modes", () => {
    for (const mode of ["low", "swell", "stop"] as const) {
      expect(parse(`[ambient ${mode}]`).events).toEqual([{ kind: "ambient", mode }]);
    }
  });
  it("photo reveal", () => {
    expect(parse("[photo reveal room_1]").events).toEqual([{ kind: "photo", id: "room_1" }]);
  });
});

describe("leniency", () => {
  it("is case-insensitive and tolerates extra spaces", () => {
    expect(parse("[  PAUSE   2 ]  [Sfx  CREAK]").events).toEqual([
      { kind: "pause", seconds: 2 },
      { kind: "sfx", name: "creak" },
    ]);
  });
  it("accepts a unit suffix on pause", () => {
    expect(parse("[pause 2s]").events).toEqual([{ kind: "pause", seconds: 2 }]);
  });
  it("drops unknown tags, warns and counts them", () => {
    const warn = vi.fn();
    const { events, stats } = CueParser.parse("[sfx explosion] [dance] [light disco] [photo reveal] Hello.", warn);
    expect(events).toEqual([{ kind: "speech", text: "Hello.", style: "normal" }]);
    expect(stats.unknownTags).toBe(4);
    expect(warn).toHaveBeenCalledTimes(4);
  });
  it("strips (pause 2) and *junk* instead of speaking it", () => {
    const { events, stats } = parse("You wait (pause 2) and *sighs* listen.");
    expect(events).toEqual([
      { kind: "speech", text: "You wait", style: "normal" },
      { kind: "speech", text: "and", style: "normal" },
      { kind: "speech", text: "listen.", style: "normal" },
    ]);
    expect(stats.junkDropped).toBe(2);
  });
  it("keeps ordinary parentheses as speech", () => {
    expect(parse("The door (the old one) creaks.").events).toEqual([
      { kind: "speech", text: "The door (the old one) creaks.", style: "normal" },
    ]);
  });
  it("drops an unterminated tag rather than speaking it", () => {
    const { events, stats } = parse("Listen [pause 2");
    expect(events).toEqual([{ kind: "speech", text: "Listen", style: "normal" }]);
    expect(stats.junkDropped).toBe(1);
  });
  it("lines with only tags produce only events", () => {
    expect(parse("[sfx creak] [light flicker]").events.map((e) => e.kind)).toEqual(["sfx", "light"]);
  });
  it("drops punctuation-only speech", () => {
    expect(parse("[pause 1] ...").events).toEqual([{ kind: "pause", seconds: 1 }]);
  });
});

describe("forgiving common model slips", () => {
  it("accepts plural/singular sfx names", () => {
    expect(parse("[sfx scrapes] [sfx footstep] [sfx knocks] [sfx whisper]").events).toEqual([
      { kind: "sfx", name: "scrape" },
      { kind: "sfx", name: "footsteps" },
      { kind: "sfx", name: "knock" },
      { kind: "sfx", name: "whispers" },
    ]);
  });
  it("accepts [lights pulse] as [light pulse]", () => {
    expect(parse("[lights pulse]").events).toEqual([{ kind: "light", mode: "pulse" }]);
  });
  it("still drops things that are not near-misses", () => {
    const { events, stats } = parse("[sfx cold breath] [sfx stop] [whispers]");
    expect(events).toEqual([]);
    expect(stats.unknownTags).toBe(3);
  });
});

describe("pause clamping and defaults", () => {
  it("clamps to 0.2-6", () => {
    expect(parse("[pause 0]").events).toEqual([{ kind: "pause", seconds: 0.2 }]);
    expect(parse("[pause 99]").events).toEqual([{ kind: "pause", seconds: 6 }]);
    expect(parse("[pause -3]").events).toEqual([{ kind: "pause", seconds: 0.2 }]);
  });
  it("uses defaults for missing or bad numbers and counts them", () => {
    const a = parse("[pause]");
    expect(a.events).toEqual([{ kind: "pause", seconds: 1 }]);
    expect(a.stats.defaulted).toBe(1);
    expect(parse("[pause abc]").events).toEqual([{ kind: "pause", seconds: 1 }]);
    expect(parse("[light blackout]").events).toEqual([{ kind: "light", mode: "blackout", seconds: 2 }]);
  });
  it("clamps blackout duration", () => {
    expect(parse("[light blackout 60]").events).toEqual([{ kind: "light", mode: "blackout", seconds: 6 }]);
  });
});

describe("style scope", () => {
  it("applies from the tag to the end of the line only", () => {
    const { events } = parse("Before. [whisper] It isn't now.\nNext line.");
    expect(events).toEqual([
      { kind: "speech", text: "Before.", style: "normal" },
      { kind: "speech", text: "It isn't now.", style: "whisper" },
      { kind: "speech", text: "Next line.", style: "normal" },
    ]);
  });
  it("last style wins from that point", () => {
    expect(parse("[slow] [whisper] hello").events).toEqual([{ kind: "speech", text: "hello", style: "whisper" }]);
    expect(parse("[slow] one [shout] two").events).toEqual([
      { kind: "speech", text: "one", style: "slow" },
      { kind: "speech", text: "two", style: "shout" },
    ]);
  });
  it("splits around inline tags", () => {
    expect(parse("The grey coat [pause 0.8] [slow] has one sleeve raised.").events).toEqual([
      { kind: "speech", text: "The grey coat", style: "normal" },
      { kind: "pause", seconds: 0.8 },
      { kind: "speech", text: "has one sleeve raised.", style: "slow" },
    ]);
  });
});

describe("incremental parsing", () => {
  const script = "[ambient low]\nYou hear it. [pause 2]\n[whisper] Closer now.\n[sfx creak] [light flicker]";
  const whole = parse(script).events;

  it("emits events only for completed lines", () => {
    const p = new CueParser(quiet);
    expect(p.push("[ambient low]")).toEqual([]);
    expect(p.push("\n")).toEqual([{ kind: "ambient", mode: "low" }]);
    expect(p.flush()).toEqual([]);
  });
  it("splitting a tag mid-way gives the same result as parsing whole", () => {
    for (let cut = 1; cut < script.length; cut++) {
      const p = new CueParser(quiet);
      const got = [...p.push(script.slice(0, cut)), ...p.push(script.slice(cut)), ...p.flush()];
      expect(got).toEqual(whole);
    }
  });
  it("char-by-char equals whole", () => {
    const p = new CueParser(quiet);
    const got: CueEvent[] = [];
    for (const ch of script) got.push(...p.push(ch));
    got.push(...p.flush());
    expect(got).toEqual(whole);
  });
  it("handles CRLF", () => {
    expect(parse("[ambient low]\r\nHello.\r\n").events).toHaveLength(2);
  });
});

describe("empty input", () => {
  it("yields nothing", () => {
    expect(parse("").events).toEqual([]);
    expect(parse("\n\n   \n").events).toEqual([]);
  });
});

describe("segmenter", () => {
  const sp = (text: string, style: "normal" | "whisper" = "normal"): CueEvent => ({ kind: "speech", text, style });
  const texts = (evs: CueEvent[]) => evs.map((e) => (e.kind === "speech" ? e.text : e.kind));

  it("one sentence per segment when targetChars is 0 (Kokoro)", () => {
    const out = segment([sp("One. Two! Three?")], { maxChars: 500, targetChars: 0 });
    expect(texts(out)).toEqual(["One.", "Two!", "Three?"]);
  });
  it("merges same-style sentences up to the soft target", () => {
    const out = segment([sp("One. Two. Three.")], { maxChars: 500, targetChars: 9 });
    expect(texts(out)).toEqual(["One. Two.", "Three."]);
  });
  it("never merges across a style change or a non-speech event", () => {
    const out = segment([sp("One."), sp("Two.", "whisper"), { kind: "pause", seconds: 1 }, sp("Three.")], {
      maxChars: 500,
      targetChars: 350,
    });
    expect(texts(out)).toEqual(["One.", "Two.", "pause", "Three."]);
  });
  it("hard-splits a sentence longer than maxChars", () => {
    const long = "word ".repeat(40).trim() + ".";
    const out = segment([sp(long)], { maxChars: 50, targetChars: 0 });
    expect(out.length).toBeGreaterThan(1);
    for (const e of out) if (e.kind === "speech") expect(e.text.length).toBeLessThanOrEqual(50);
  });
  it("keeps text without terminal punctuation", () => {
    expect(texts(segment([sp("no full stop")], { maxChars: 500, targetChars: 0 }))).toEqual(["no full stop"]);
  });
});
