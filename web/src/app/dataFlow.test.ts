import { describe, expect, it } from "vitest";
import { dataFlow, type FlowInput } from "./dataFlow";

const base: FlowInput = {
  llmBaseUrl: "http://localhost:11434/v1",
  tts: "kokoro-web",
  photosMaySend: true,
  photoCount: 2,
  hasNotes: true,
};

describe("dataFlow", () => {
  it("green: local model and offline voice, even with photos", () => {
    const f = dataFlow(base);
    expect(f.level).toBe("green");
    expect(f.headline).toBe("Fully local");
    expect(f.rows.find((r) => r.what.startsWith("Your photos"))?.leaves).toBe(false);
  });

  it("yellow: local model, ElevenLabs voice; photos stay on the device", () => {
    const f = dataFlow({ ...base, tts: "elevenlabs" });
    expect(f.level).toBe("yellow");
    expect(f.headline).toBe("Story text → ElevenLabs. Photos stay on this device.");
    expect(f.rows.some((r) => r.where.includes("ElevenLabs") && r.leaves)).toBe(true);
  });

  it("red: remote model and photos, naming the host", () => {
    const f = dataFlow({ ...base, llmBaseUrl: "https://api.example.com/v1" });
    expect(f.level).toBe("red");
    expect(f.headline).toBe("Photos are sent to api.example.com");
    expect(f.rows.find((r) => r.what.startsWith("Your photos"))).toMatchObject({ where: "api.example.com", leaves: true });
  });

  it("remote model with no photos (or photos turned off) is yellow, not red", () => {
    const remote = { ...base, llmBaseUrl: "https://api.example.com/v1" };
    expect(dataFlow({ ...remote, photoCount: 0 }).level).toBe("yellow");
    const off = dataFlow({ ...remote, photosMaySend: false });
    expect(off.level).toBe("yellow");
    expect(off.rows.find((r) => r.what === "Your photos")?.leaves).toBe(false);
  });

  it("remote model plus ElevenLabs without photos names both", () => {
    const f = dataFlow({ ...base, llmBaseUrl: "https://api.example.com/v1", tts: "elevenlabs", photoCount: 0 });
    expect(f.headline).toBe("Notes → api.example.com; story text → ElevenLabs.");
  });

  it("always says nothing goes to us, and omits photo/notes rows when there are none", () => {
    const f = dataFlow({ ...base, photoCount: 0, hasNotes: false });
    expect(f.rows.map((r) => r.what)).not.toContain("Your notes");
    expect(f.rows.some((r) => r.what.startsWith("Your photos"))).toBe(false);
    expect(f.rows.at(-1)?.where).toMatch(/no server of ours/i);
  });
});
