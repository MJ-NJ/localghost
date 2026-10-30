// Audio cache: synthesized segments are stored in IndexedDB so identical segments never hit the
// provider (or the voice model) twice. Kokoro stores decoded PCM; ElevenLabs stores the mp3 bytes it received.
import { idbDel, idbGet, idbKeys, idbSet } from "./idb";
import { timing } from "./timing";

export type CacheEntry =
  | { kind: "pcm"; sampleRate: number; samples: Float32Array }
  | { kind: "mp3"; bytes: ArrayBuffer };

export interface AudioCache {
  get(key: string): Promise<CacheEntry | undefined>;
  put(key: string, entry: CacheEntry): Promise<void>;
}

const PREFIX = "audio:";

/** sha-256 of the parts joined with `|`: provider | voice | style | nonverbal | text (plus anything that changes the audio). */
export async function cacheKey(...parts: Array<string | number | undefined>): Promise<string> {
  const data = new TextEncoder().encode(parts.map((p) => p ?? "").join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** IndexedDB-backed cache. Counts hits and misses for the DebugPanel. Storage failures degrade to a miss. */
export const idbAudioCache: AudioCache = {
  async get(key) {
    try {
      const hit = await idbGet<CacheEntry>(PREFIX + key);
      timing.count(hit ? "cache hits" : "cache misses");
      return hit;
    } catch {
      return undefined;
    }
  },
  async put(key, entry) {
    try {
      await idbSet(PREFIX + key, entry);
    } catch {
      /* quota or private mode: just don't cache */
    }
  },
};

/** Remove every cached segment. Returns how many were removed. */
export async function clearAudioCache(): Promise<number> {
  const keys = (await idbKeys()).filter((k): k is string => typeof k === "string" && k.startsWith(PREFIX));
  await Promise.all(keys.map((k) => idbDel(k)));
  return keys.length;
}

export async function audioCacheSize(): Promise<number> {
  return (await idbKeys()).filter((k) => typeof k === "string" && k.startsWith(PREFIX)).length;
}
