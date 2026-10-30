// Guards the bundled demo story: it is what judges hear first, so it must parse cleanly and stay short.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countSpeechWords } from "../director/director";
import { profileFor } from "../director/profiles";
import { CueParser } from "./parser";

const text = readFileSync(new URL("../../public/sample/sample.cue.txt", import.meta.url), "utf8");
const { events, stats } = CueParser.parse(text, () => {});

describe("bundled demo story", () => {
  it("parses with nothing dropped or defaulted", () => {
    expect(stats).toEqual({ unknownTags: 0, junkDropped: 0, defaulted: 0 });
  });

  it("is short but not tiny", () => {
    const words = countSpeechWords(events);
    expect(words).toBeGreaterThanOrEqual(180);
    expect(words).toBeLessThanOrEqual(330);
  });

  it("stays within the level 3 effects budget and uses only lights that level allows", () => {
    const p = profileFor(3);
    const effects = events.filter((e) => e.kind === "sfx" || e.kind === "light");
    expect(effects.length).toBeLessThanOrEqual(p.budget);
    for (const e of events) if (e.kind === "light") expect(p.lights).toContain(e.mode);
  });

  it("starts and ends the drone, and reveals the demo photo exactly once", () => {
    const ambient = events.filter((e) => e.kind === "ambient");
    expect(ambient[0]).toEqual({ kind: "ambient", mode: "low" });
    expect(ambient.at(-1)).toEqual({ kind: "ambient", mode: "stop" });
    expect(events.filter((e) => e.kind === "photo")).toEqual([{ kind: "photo", id: "sample" }]);
  });

  it("shows off every voice style", () => {
    const styles = new Set(events.flatMap((e) => (e.kind === "speech" ? [e.style] : [])));
    for (const s of ["whisper", "slow", "trembling"] as const) expect(styles).toContain(s);
  });
});
