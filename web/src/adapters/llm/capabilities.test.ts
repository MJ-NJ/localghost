import { afterEach, describe, expect, it, vi } from "vitest";
import { detectVision, serverKind, serverRoot, visionFromLlamaProps, visionFromOllamaShow } from "./capabilities";

afterEach(() => vi.unstubAllGlobals());

const cfg = { baseUrl: "http://localhost:11434/v1", model: "gemma4:e2b", preset: "ollama" };
const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("parsing", () => {
  it("reads Ollama capabilities", () => {
    expect(visionFromOllamaShow({ capabilities: ["completion", "tools", "thinking"] })).toBe(false);
    expect(visionFromOllamaShow({ capabilities: ["completion", "vision"] })).toBe(true);
    expect(visionFromOllamaShow({})).toBeNull(); // older Ollama: unknown
    expect(visionFromOllamaShow(null)).toBeNull();
  });
  it("reads llama.cpp modalities", () => {
    expect(visionFromLlamaProps({ modalities: { vision: true } })).toBe(true);
    expect(visionFromLlamaProps({ modalities: { vision: false } })).toBe(false);
    expect(visionFromLlamaProps({})).toBeNull();
  });
  it("finds the server root and kind", () => {
    expect(serverRoot("http://localhost:11434/v1/")).toBe("http://localhost:11434");
    expect(serverKind("custom", "http://localhost:11434/v1")).toBe("ollama");
    expect(serverKind(undefined, "http://localhost:8080/v1")).toBe("llamacpp");
    expect(serverKind("lmstudio", "http://localhost:1234/v1")).toBe("other");
  });
});

describe("detectVision", () => {
  it("asks Ollama's /api/show about the chosen model", async () => {
    const f = json({ capabilities: ["completion", "vision"] });
    vi.stubGlobal("fetch", f);
    expect(await detectVision(cfg)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/show");
    expect(JSON.parse(init.body as string).model).toBe("gemma4:e2b");
  });
  it("says false for a text-only model", async () => {
    vi.stubGlobal("fetch", json({ capabilities: ["completion", "tools", "thinking"] }));
    expect(await detectVision(cfg)).toBe(false);
  });
  it("is null (unknown) on errors, unreachable servers, empty model or other servers", async () => {
    vi.stubGlobal("fetch", json({ error: "model not found" }, 404));
    expect(await detectVision(cfg)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await detectVision(cfg)).toBeNull();
    expect(await detectVision({ ...cfg, model: " " })).toBeNull();
    expect(await detectVision({ baseUrl: "https://api.example.com/v1", model: "m", preset: "custom" })).toBeNull();
  });
  it("uses /props for llama.cpp", async () => {
    const f = json({ modalities: { vision: true } });
    vi.stubGlobal("fetch", f);
    expect(await detectVision({ baseUrl: "http://localhost:8080/v1", model: "x", preset: "llamacpp" })).toBe(true);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("http://localhost:8080/props");
  });
});
