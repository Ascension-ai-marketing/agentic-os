/**
 * Brand images a style may draw (a dropped logo). Only data: or same-origin
 * URLs are used, so the canvas stays exportable. Images are preloaded before a
 * theme reaches the styles; a style simply skips the logo until it is ready.
 */
import type { Theme } from "./types";

type Img = HTMLImageElement | ImageBitmap;
const ready = new Map<string, Img>();
const pending = new Map<string, Promise<boolean>>();

export function isDrawableSource(src: string | null | undefined): src is string {
  if (!src) return false;
  if (src.startsWith("data:image/")) return true;
  if (typeof location !== "undefined") {
    try {
      return new URL(src, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }
  return false;
}

/** Load a logo so styles can draw it. Resolves false when it cannot be drawn. */
export function preloadLogo(src: string | null | undefined): Promise<boolean> {
  if (!isDrawableSource(src) || typeof Image === "undefined") return Promise.resolve(false);
  if (ready.has(src)) return Promise.resolve(true);
  let p = pending.get(src);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        ready.set(src, img);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
    pending.set(src, p);
  }
  return p;
}

/** The theme's logo if it is loaded, else null. */
export function logoFor(theme: Theme): Img | null {
  const src = theme.logo;
  if (!src) return null;
  return ready.get(src) ?? null;
}

/** Natural size of a loaded logo (SVGs without size report 0; treat as square). */
export function logoSize(img: Img): { w: number; h: number } {
  const w = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h = "naturalHeight" in img ? img.naturalHeight : img.height;
  return w > 0 && h > 0 ? { w, h } : { w: 1, h: 1 };
}

const tints = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
/**
 * The logo as a one-colour mark (alpha kept), fitted inside w x h. Cached, so
 * styles can call it every frame. Returns null until the logo has loaded.
 */
export function tintedLogo(theme: Theme, color: string, w: number, h: number) {
  const img = logoFor(theme);
  if (!img || !theme.logo) return null;
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const key = `${theme.logo.length}:${theme.logo.slice(-48)}|${color}|${W}x${H}`;
  let c = tints.get(key);
  if (c) return c;
  c =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  drawLogo(g, img, W / 2, H / 2, W, H);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  tints.set(key, c);
  if (tints.size > 64) tints.delete(tints.keys().next().value as string);
  return c;
}

/** Draw a logo fitted inside a box, centred, keeping its proportions. */
export function drawLogo(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  img: Img,
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
) {
  const { w, h } = logoSize(img);
  const k = Math.min(boxW / w, boxH / h);
  ctx.drawImage(img as CanvasImageSource, cx - (w * k) / 2, cy - (h * k) / 2, w * k, h * k);
}
