import type { LLMAdapter } from "../adapters/llm/types";
import { LLMError } from "../adapters/llm/types";
import { VISION_PROMPT } from "../director/prompts";
import { timing } from "../lib/timing";
import type { PhotoId } from "./store";

export interface InventoryObject {
  name: string;
  where: string;
  detail: string;
}

export interface Inventory {
  place: string;
  time_of_day: string;
  lighting: string;
  objects: InventoryObject[];
  textures_and_sounds: string[];
  unsettling_potential: string[];
}

/** Used when the model's reply could not be turned into the JSON shape twice in a row. */
export interface FreeformInventory {
  description: string;
}

export type AnyInventory = Inventory | FreeformInventory;
export const isStructured = (i: AnyInventory): i is Inventory => "objects" in i;

const MAX_OBJECTS = 12;

/** First balanced `{...}` block in the text, respecting strings. Handles code fences and chatter around it. */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * Validate the model's JSON. Lenient on the small stuff (missing arrays become empty,
 * extra objects are truncated), strict on the essentials: a place and at least one named object.
 */
export function validateInventory(raw: unknown): Inventory | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const objects = (Array.isArray(o.objects) ? o.objects : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      return { name: str(r.name), where: str(r.where), detail: str(r.detail) };
    })
    .filter((x) => x.name)
    .slice(0, MAX_OBJECTS);
  const place = str(o.place);
  if (!place || objects.length === 0) return null;
  return {
    place,
    time_of_day: str(o.time_of_day),
    lighting: str(o.lighting),
    objects,
    textures_and_sounds: strList(o.textures_and_sounds),
    unsettling_potential: strList(o.unsettling_potential),
  };
}

/** Photo whose inventory has the most unsettling_potential items; ties go to the lowest id. */
export function chooseBest(inventories: Partial<Record<PhotoId, AnyInventory>>): PhotoId | undefined {
  let best: PhotoId | undefined;
  let bestScore = -1;
  for (const id of Object.keys(inventories).sort() as PhotoId[]) {
    const inv = inventories[id]!;
    const score = isStructured(inv) ? inv.unsettling_potential.length : 0;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

export interface InventoryCache {
  get(hash: string): Promise<AnyInventory | undefined>;
  set(hash: string, inv: AnyInventory): Promise<void>;
}

export interface VisionPhoto {
  id: PhotoId;
  hash: string;
  dataUrl: string;
}

export interface VisionOptions {
  cache: InventoryCache;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

export interface VisionResult {
  inventories: Partial<Record<PhotoId, AnyInventory>>;
  bestId?: PhotoId;
  /** The model rejected image input; the story should use notes only. */
  unsupported: boolean;
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let s = "";
  for await (const d of it) s += d;
  return s;
}

async function describe(adapter: LLMAdapter, photo: VisionPhoto, signal?: AbortSignal): Promise<string> {
  return collect(
    adapter.chat(
      {
        messages: [
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this photo." },
              { type: "image_url", image_url: { url: photo.dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
        maxTokens: 1024,
        json: true,
      },
      signal,
    ),
  );
}

/**
 * One vision call per photo (temperature 0.2, JSON requested). Invalid output is retried once; if it is still
 * not valid JSON the raw text is kept as a free-form description. Inventories are cached by photo hash.
 */
export async function analysePhotos(adapter: LLMAdapter, photos: VisionPhoto[], o: VisionOptions): Promise<VisionResult> {
  const inventories: Partial<Record<PhotoId, AnyInventory>> = {};
  let done = 0;
  o.onProgress?.(0, photos.length);

  for (const photo of photos) {
    let inv = await o.cache.get(photo.hash);
    if (!inv) {
      const stop = timing.start(`vision ${photo.id}`);
      let lastText = "";
      try {
        for (let attempt = 0; attempt < 2 && !inv; attempt++) {
          lastText = await describe(adapter, photo, o.signal);
          const json = extractJson(lastText);
          try {
            inv = (json && validateInventory(JSON.parse(json))) || undefined;
          } catch {
            inv = undefined;
          }
        }
      } catch (e) {
        // The server answered with an error to a request carrying an image: the model can't see.
        // (A connection failure has no status and is rethrown: that is a different problem.)
        if (e instanceof LLMError && e.status !== undefined) {
          stop();
          return { inventories: {}, unsupported: true };
        }
        throw e;
      }
      stop();
      inv ??= { description: lastText.trim() };
      if (isStructured(inv) || (inv as FreeformInventory).description) await o.cache.set(photo.hash, inv);
    }
    if (isStructured(inv) || (inv as FreeformInventory).description) inventories[photo.id] = inv;
    o.onProgress?.(++done, photos.length);
  }

  return { inventories, bestId: chooseBest(inventories), unsupported: false };
}
