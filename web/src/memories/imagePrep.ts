// Client-side photo preparation: downscale and re-encode through a canvas.
// Re-encoding drops EXIF (GPS, camera, timestamps) so only pixels ever leave the original file.

export const MAX_SIDE = 768;
export const JPEG_QUALITY = 0.8;

/** Fit within max on the longest side. Never upscales. */
export function fitSize(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h };
  const k = max / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Downscale to <= 768 px on the longest side and re-encode as JPEG (quality 0.8). */
export async function prepareImage(file: Blob): Promise<Blob> {
  // createImageBitmap applies the EXIF orientation by default, so the result is upright
  const bmp = await createImageBitmap(file);
  try {
    const { width, height } = fitSize(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.drawImage(bmp, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), "image/jpeg", JPEG_QUALITY),
    );
  } finally {
    bmp.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
