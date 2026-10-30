import { describe, expect, it } from "vitest";
import { MIN_FACTOR, PLAYBACK_MULTIPLIER, SHORT_FACTOR, lengthFactor, maxWordsForSpeed, scaledWords } from "./length";
import { PROFILES, profileFor } from "./profiles";
import { PREMISE_SEEDS, pickPremise } from "./seeds";
import { buildSystemPrompt } from "./prompts";

describe("maxWordsForSpeed", () => {
  it("has no limit when synthesis keeps up with playback", () => {
    expect(maxWordsForSpeed(0.5)).toBe(Infinity);
    expect(maxWordsForSpeed(PLAYBACK_MULTIPLIER)).toBe(Infinity);
  });
  it("shrinks as the machine gets slower", () => {
    expect(maxWordsForSpeed(3)).toBeLessThan(maxWordsForSpeed(2));
    expect(maxWordsForSpeed(3)).toBeGreaterThan(0);
  });
});

describe("lengthFactor", () => {
  const l3 = profileFor(3);
  it("full is the plan's range and short is half of it", () => {
    expect(lengthFactor("full", l3, 9)).toBe(1);
    expect(lengthFactor("short", l3)).toBe(SHORT_FACTOR);
  });
  it("auto does not guess without a speed test", () => {
    expect(lengthFactor("auto", l3)).toBe(1);
  });
  it("auto is 1 on a fast machine, and never below the floor on a slow one", () => {
    expect(lengthFactor("auto", l3, 0.8)).toBe(1);
    expect(lengthFactor("auto", l3, 50)).toBe(MIN_FACTOR);
    const mid = lengthFactor("auto", l3, 3);
    expect(mid).toBeGreaterThanOrEqual(MIN_FACTOR);
    expect(mid).toBeLessThan(1);
  });
});

describe("scaledWords", () => {
  it("keeps the plan's range at factor 1 and rounds to tens otherwise", () => {
    for (const p of PROFILES) expect(scaledWords(p, 1)).toEqual([p.words[0], p.words[1]]);
    expect(scaledWords(profileFor(1), 0.5)).toEqual([180, 230]);
  });
});

describe("story prompt shape", () => {
  it("states the scaled length", () => {
    expect(buildSystemPrompt({ profile: profileFor(1), lengthFactor: 0.5 })).toContain("Length: 180–230 words");
    expect(buildSystemPrompt({ profile: profileFor(1) })).toContain("Length: 350–450 words");
  });
  it("requires a complete ending and a minimum number of lights per level", () => {
    const p1 = buildSystemPrompt({ profile: profileFor(1) });
    expect(p1).toContain("STORY SHAPE");
    expect(p1).toContain("must close the story, not trail off");
    expect(p1).toContain("at least 1 time,");
    expect(buildSystemPrompt({ profile: profileFor(5) })).toContain("at least 4 times,");
  });
  it("includes the premise only when one is given", () => {
    expect(buildSystemPrompt({ profile: profileFor(3) })).not.toContain("PREMISE");
    const withSeed = buildSystemPrompt({ profile: profileFor(3), premise: PREMISE_SEEDS[0] });
    expect(withSeed).toContain("PREMISE");
    expect(withSeed).toContain(PREMISE_SEEDS[0]);
  });
});

describe("premise seeds", () => {
  it("are deterministic with an injected rng and always in range", () => {
    expect(pickPremise(() => 0)).toBe(PREMISE_SEEDS[0]);
    expect(pickPremise(() => 0.999999)).toBe(PREMISE_SEEDS[PREMISE_SEEDS.length - 1]);
    expect(pickPremise(() => 1)).toBe(PREMISE_SEEDS[PREMISE_SEEDS.length - 1]);
  });
  it("avoid the content the profiles forbid", () => {
    for (const s of PREMISE_SEEDS) expect(s).not.toMatch(/child|baby|kid|suicide|self-harm|sexual|blood|gore/i);
  });
});
