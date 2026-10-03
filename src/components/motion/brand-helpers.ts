/** Client helpers for brand-from-logo and dropped files. */
import { brandTheme, hasBrandColour, paletteFromPixels } from "@/motion/engine/brand";
import type { Theme } from "@/motion/engine/types";

export const FALLBACK: Theme = {
  bg: "#0c0c0e",
  ink: "#f2efe9",
  accent: "#d97757",
  accent2: "#7f93a8",
  font: "Inter",
};

/** Read a file as a data URL. */
export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string, cors = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed"));
    img.src = src;
  });
}

/** Pixels of an image, scaled to at most `size` on the long side. */
async function pixels(src: string, size = 96) {
  const img = await loadImage(src);
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const k = size / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height).data;
}

/** Main colours of an image. */
export async function paletteOf(src: string): Promise<string[]> {
  const data = await pixels(src).catch(() => null);
  return data ? paletteFromPixels(data) : [];
}

/** A logo is an SVG, or an image with a lot of transparent pixels. */
export async function looksLikeLogo(file: File, dataUrl: string): Promise<boolean> {
  if (file.type === "image/svg+xml") return true;
  if (file.type === "image/jpeg") return false;
  const data = await pixels(dataUrl, 64).catch(() => null);
  if (!data) return false;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 24) clear++;
  return clear / (data.length / 4) > 0.12;
}

/** A remote logo is drawable only if its host allows CORS; else it stays UI-only. */
export async function drawableLogo(url: string): Promise<string | null> {
  try {
    const img = await loadImage(url, true);
    const max = 512;
    const w = img.naturalWidth || max;
    const h = img.naturalHeight || max;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** A friendly word from a file name ("glaido-logo.svg" → "Glaido"), or null. */
export function nameFromFile(file: string): string | null {
  const base = file
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/-[0-9a-f]{8}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(
      /\b(logo|logos|mark|icon|final|white|black|dark|light|copy|lime|v\d+|\d+x|\d+)\b/gi,
      "",
    )
    .trim();
  if (!base || base.length > 16) return null;
  const word = base.split(/\s+/)[0];
  return word.length >= 2 ? word.charAt(0).toUpperCase() + word.slice(1) : null;
}

/** A theme from a logo's colours (null for a black or white logo). */
export function themeFromPalette(palette: string[], name: string | null): Theme | null {
  if (!hasBrandColour(palette)) return null;
  return brandTheme({ colors: palette, name }, FALLBACK);
}

/** A small JPEG poster of a video file (first second). */
export function videoPoster(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    const done = (out: string | null) => {
      URL.revokeObjectURL(url);
      resolve(out);
    };
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) * 0.2);
    };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      const k = 160 / Math.max(1, v.videoWidth);
      c.width = 160;
      c.height = Math.max(1, Math.round(v.videoHeight * k));
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      done(c.toDataURL("image/jpeg", 0.7));
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
  });
}
