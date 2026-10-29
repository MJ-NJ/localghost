// Photos, notes and cached inventories live in IndexedDB only. Nothing persists outside the browser.
import { idbDel, idbGet, idbSet } from "../lib/idb";
import { blobToDataUrl, prepareImage, sha256Hex } from "./imagePrep";

export const MAX_PHOTOS = 4;
export const PHOTO_IDS = ["room_1", "room_2", "room_3", "room_4"] as const;
export type PhotoId = (typeof PHOTO_IDS)[number];

export interface StoredPhoto {
  id: PhotoId;
  /** Downscaled, EXIF-free JPEG. */
  blob: Blob;
  /** sha-256 of the downscaled bytes; the inventory cache key. */
  hash: string;
  name: string;
}

const photoKey = (id: PhotoId) => `photo:${id}`;
const invKey = (hash: string) => `inventory:${hash}`;

export async function listPhotos(): Promise<StoredPhoto[]> {
  const found = await Promise.all(PHOTO_IDS.map((id) => idbGet<StoredPhoto>(photoKey(id))));
  return found.filter((p): p is StoredPhoto => !!p);
}

/** Adds a photo in the first free slot (ids stay room_1..room_4). Throws if all 4 are used. */
export async function addPhoto(file: File): Promise<StoredPhoto> {
  const taken = new Set((await listPhotos()).map((p) => p.id));
  const id = PHOTO_IDS.find((i) => !taken.has(i));
  if (!id) throw new Error(`You can add up to ${MAX_PHOTOS} photos. Remove one first.`);
  const blob = await prepareImage(file);
  const photo: StoredPhoto = { id, blob, hash: await sha256Hex(blob), name: file.name };
  await idbSet(photoKey(id), photo);
  return photo;
}

export async function removePhoto(id: PhotoId): Promise<void> {
  await idbDel(photoKey(id));
}

export const getNotes = async () => (await idbGet<string>("notes")) ?? "";
export const setNotes = (notes: string) => idbSet("notes", notes);

export const getInventory = <T>(hash: string) => idbGet<T>(invKey(hash));
export const setInventory = (hash: string, inv: unknown) => idbSet(invKey(hash), inv);

export const photoDataUrl = (p: StoredPhoto) => blobToDataUrl(p.blob);
