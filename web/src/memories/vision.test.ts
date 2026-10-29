import { describe, expect, it } from "vitest";
import { LLMError, type ChatRequest, type LLMAdapter } from "../adapters/llm/types";
import { fitSize } from "./imagePrep";
import {
  analysePhotos,
  chooseBest,
  extractJson,
  validateInventory,
  type AnyInventory,
  type Inventory,
  type InventoryCache,
} from "./vision";

const inv = (potential: number, place = "a hallway"): Inventory => ({
  place,
  time_of_day: "night",
  lighting: "dim",
  objects: [{ name: "coat", where: "on the door", detail: "grey" }],
  textures_and_sounds: [],
  unsettling_potential: Array.from({ length: potential }, (_, i) => `detail ${i}`),
});

const GOOD = JSON.stringify(inv(3));

function fake(replies: Array<string | Error>): LLMAdapter & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    id: "fake",
    caps: { vision: true, streaming: true, local: true },
    calls,
    async *chat(req) {
      const r = replies[Math.min(calls.length, replies.length - 1)];
      calls.push(req);
      if (r instanceof Error) throw r;
      yield r.slice(0, 10);
      yield r.slice(10);
    },
  };
}

const memCache = (): InventoryCache & { map: Map<string, AnyInventory> } => {
  const map = new Map<string, AnyInventory>();
  return { map, get: async (h) => map.get(h), set: async (h, v) => void map.set(h, v) };
};

const photo = (id: "room_1" | "room_2" | "room_3", hash: string = id) => ({ id, hash, dataUrl: "data:image/jpeg;base64,AAA" });

describe("fitSize", () => {
  it("downscales the longest side to 768 and keeps the aspect ratio", () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 768, height: 576 });
    expect(fitSize(3000, 4000)).toEqual({ width: 576, height: 768 });
  });
  it("never upscales", () => {
    expect(fitSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
});

describe("extractJson", () => {
  it("pulls the first balanced object out of fences and chatter", () => {
    expect(extractJson('Sure! ```json\n{"a": {"b": 1}}\n``` hope that helps')).toBe('{"a": {"b": 1}}');
  });
  it("is not fooled by braces inside strings", () => {
    expect(extractJson('{"a": "x } y"} trailing {')).toBe('{"a": "x } y"}');
  });
  it("returns null when there is no complete object", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson('{"a": 1')).toBeNull();
  });
});

describe("validateInventory", () => {
  it("accepts a good inventory and fills missing arrays", () => {
    const v = validateInventory({ place: "kitchen", objects: [{ name: "kettle", where: "stove", detail: "" }] });
    expect(v?.textures_and_sounds).toEqual([]);
    expect(v?.objects).toHaveLength(1);
  });
  it("rejects missing place or no named objects", () => {
    expect(validateInventory({ objects: [{ name: "x" }] })).toBeNull();
    expect(validateInventory({ place: "x", objects: [] })).toBeNull();
    expect(validateInventory({ place: "x", objects: [{ where: "y" }] })).toBeNull();
    expect(validateInventory("nope")).toBeNull();
  });
  it("truncates to 12 objects", () => {
    const objects = Array.from({ length: 20 }, (_, i) => ({ name: `o${i}`, where: "", detail: "" }));
    expect(validateInventory({ place: "x", objects })?.objects).toHaveLength(12);
  });
});

describe("chooseBest", () => {
  it("picks the photo with the most unsettling_potential, ties to the lowest id", () => {
    expect(chooseBest({ room_1: inv(2), room_2: inv(4), room_3: inv(4) })).toBe("room_2");
    expect(chooseBest({ room_2: inv(1), room_1: inv(1) })).toBe("room_1");
  });
  it("ignores free-form inventories unless they are all there is", () => {
    expect(chooseBest({ room_1: { description: "text" }, room_2: inv(1) })).toBe("room_2");
    expect(chooseBest({ room_1: { description: "text" } })).toBe("room_1");
    expect(chooseBest({})).toBeUndefined();
  });
});

describe("analysePhotos", () => {
  it("asks for JSON at temperature 0.2 and sends the image as a content part", async () => {
    const a = fake([GOOD]);
    await analysePhotos(a, [photo("room_1")], { cache: memCache() });
    expect(a.calls[0].json).toBe(true);
    expect(a.calls[0].temperature).toBe(0.2);
    const user = a.calls[0].messages[1].content as { type: string }[];
    expect(user.some((p) => p.type === "image_url")).toBe(true);
  });

  it("retries once on invalid output, then succeeds", async () => {
    const a = fake(["not json at all", GOOD]);
    const r = await analysePhotos(a, [photo("room_1")], { cache: memCache() });
    expect(a.calls).toHaveLength(2);
    expect("objects" in r.inventories.room_1!).toBe(true);
  });

  it("falls back to the raw text after two bad replies", async () => {
    const a = fake(["a vague description of a room", "still vague"]);
    const r = await analysePhotos(a, [photo("room_1")], { cache: memCache() });
    expect(a.calls).toHaveLength(2);
    expect(r.inventories.room_1).toEqual({ description: "still vague" });
    expect(r.unsupported).toBe(false);
  });

  it("never re-analyses a photo with the same hash", async () => {
    const cache = memCache();
    const a = fake([GOOD]);
    await analysePhotos(a, [photo("room_1", "h1")], { cache });
    await analysePhotos(a, [photo("room_2", "h1")], { cache }); // same pixels, different slot
    expect(a.calls).toHaveLength(1);
    const r = await analysePhotos(a, [photo("room_3", "h1")], { cache });
    expect(r.inventories.room_3).toBeDefined();
  });

  it("reports an unsupported model when the server rejects the image request", async () => {
    const a = fake([new LLMError("The model server returned 400: image input is not supported", [], 400)]);
    const r = await analysePhotos(a, [photo("room_1"), photo("room_2")], { cache: memCache() });
    expect(r.unsupported).toBe(true);
    expect(r.inventories).toEqual({});
    expect(a.calls).toHaveLength(1); // stops at the first rejection
  });

  it("rethrows connection failures instead of calling them 'no vision'", async () => {
    const a = fake([new LLMError("Could not reach localhost")]);
    await expect(analysePhotos(a, [photo("room_1")], { cache: memCache() })).rejects.toThrow(/reach/);
  });

  it("returns the best id across photos", async () => {
    const a = fake([JSON.stringify(inv(1)), JSON.stringify(inv(5))]);
    const r = await analysePhotos(a, [photo("room_1"), photo("room_2")], { cache: memCache() });
    expect(r.bestId).toBe("room_2");
  });
});
