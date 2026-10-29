// The climax: the listener's own photo fades back in, desaturated, red-tinted, grainy and glitching.
// Driven by the timeline clock like the other effects, so Pause freezes it.

export const REVEAL = { fadeIn: 1.5, hold: 4, fadeOut: 2 } as const;
const DURATION = REVEAL.fadeIn + REVEAL.hold + REVEAL.fadeOut;
const DRIFT = 0.04; // scale 1.0 -> 1.04 over the reveal
/** Two brief glitch windows, in seconds from the start of the reveal. */
const GLITCHES: ReadonlyArray<readonly [number, number]> = [
  [2.0, 2.15],
  [4.6, 4.75],
];
const GRAIN_SIZE = 96;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Opacity envelope: fade in, hold, fade out. */
export function revealAlpha(t: number): number {
  if (t < 0 || t > DURATION) return 0;
  return Math.min(clamp01(t / REVEAL.fadeIn), clamp01((DURATION - t) / REVEAL.fadeOut));
}

export class PhotoReveal {
  private img: ImageBitmap | null = null;
  private start = 0;
  private readonly grain: HTMLCanvasElement;
  private readonly grainCtx: CanvasRenderingContext2D | null;

  /** `reduce()` is read live: with Reduce flashing on, the glitch is skipped. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reduce: () => boolean,
  ) {
    this.grain = document.createElement("canvas");
    this.grain.width = this.grain.height = GRAIN_SIZE;
    this.grainCtx = this.grain.getContext("2d");
  }

  /** `now` is timeline seconds. */
  show(img: ImageBitmap, now: number) {
    this.img = img;
    this.start = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
  }

  update(now: number) {
    if (!this.img) return;
    const t = now - this.start;
    if (t > DURATION) {
      this.clear();
      return;
    }
    this.canvas.style.opacity = String(revealAlpha(t));
    this.draw(t);
  }

  clear() {
    this.img = null;
    this.canvas.style.opacity = "0";
  }

  private draw(t: number) {
    const ctx = this.canvas.getContext("2d");
    const img = this.img;
    if (!ctx || !img) return;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // "cover" fit, drifting slowly toward the viewer
    const scale = Math.max(W / img.width, H / img.height) * (1 + DRIFT * clamp01(t / DURATION));
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);

    // faint vertical displacement glitch: a few horizontal strips shifted up or down
    if (!this.reduce() && GLITCHES.some(([a, b]) => t >= a && t <= b)) {
      for (let i = 0; i < 3; i++) {
        const sh = Math.round(H * (0.04 + Math.random() * 0.08));
        const sy = Math.round(Math.random() * (H - sh));
        const shift = Math.round((Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 8));
        ctx.drawImage(this.canvas, 0, sy, W, sh, 0, sy + shift, W, sh);
      }
    }

    // desaturate, then a slight red tint
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(138, 15, 15, 0.28)";
    ctx.fillRect(0, 0, W, H);

    // film grain, regenerated every frame
    if (this.grainCtx) {
      const data = this.grainCtx.createImageData(GRAIN_SIZE, GRAIN_SIZE);
      for (let i = 0; i < data.data.length; i += 4) {
        const v = Math.random() * 255;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
        data.data[i + 3] = 255;
      }
      this.grainCtx.putImageData(data, 0, 0);
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.22;
      ctx.drawImage(this.grain, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // darkened edges
    ctx.globalCompositeOperation = "source-over";
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}
