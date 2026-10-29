import { describe, expect, it } from "vitest";
import type { CueEvent } from "../cue/spec";
import { PACING, duckIntervals, schedule } from "./timeline";

const buf = (duration: number) => ({ duration }) as AudioBuffer;
const speech = (text: string): CueEvent => ({ kind: "speech", text, style: "normal" });

describe("schedule", () => {
  it("advances by speech duration + gap, pauses, and nonverbals; stamps instants at the cursor", () => {
    const a = speech("a");
    const b = speech("b");
    const events: CueEvent[] = [
      { kind: "ambient", mode: "low" },
      a,
      { kind: "pause", seconds: 2 },
      { kind: "sfx", name: "creak" },
      { kind: "nonverbal", nv: "gasp" },
      b,
    ];
    const { items, total } = schedule(events, new Map([[a, buf(1.5)], [b, buf(1)]]));
    expect(items.map((i) => [i.ev.kind, +i.at.toFixed(2)])).toEqual([
      ["ambient", 0],
      ["speech", 0],
      ["pause", 1.5 + PACING.speechGap],
      ["sfx", 1.5 + PACING.speechGap + 2],
      ["nonverbal", 1.5 + PACING.speechGap + 2],
      ["speech", 1.5 + PACING.speechGap + 2 + PACING.nonverbal.gasp],
    ].map(([k, t]) => [k, +(t as number).toFixed(2)]));
    const end = 1.5 + PACING.speechGap + 2 + PACING.nonverbal.gasp + 1 + PACING.speechGap;
    expect(total).toBeCloseTo(end + PACING.tail);
  });

  it("does not end before an [ambient stop] fade finishes", () => {
    const { total } = schedule([{ kind: "ambient", mode: "stop" }], new Map());
    expect(total).toBe(PACING.ambientStopFade);
  });

  it("empty input gives an empty timeline", () => {
    expect(schedule([], new Map()).items).toEqual([]);
  });
});

describe("duckIntervals", () => {
  it("merges speech spans separated by less than the merge gap", () => {
    const a = speech("a");
    const b = speech("b");
    const c = speech("c");
    const { items } = schedule(
      [a, b, { kind: "pause", seconds: 5 }, c],
      new Map([[a, buf(1)], [b, buf(1)], [c, buf(1)]]),
    );
    const iv = duckIntervals(items);
    expect(iv).toHaveLength(2);
    expect(iv[0][0]).toBe(0);
    expect(iv[0][1]).toBeCloseTo(1 + PACING.speechGap + 1);
  });
});
