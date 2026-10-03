/**
 * Shared helpers for the Nature family (builder 7): cached light sprites,
 * periodic 1D noise, loop-safe timing, textured grounds and tracked type.
 * Everything is deterministic, so styles built on it stay pure functions of t.
 */
import { mix, parse, rgba } from "../engine/color";
import {
  context,
  fbm3,
  font,
  frameOf,
  LOOP,
  makeCanvas,
  noise3,
  rng,
  TAU,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D } from "../engine/types";

// ── loop-safe timing ─────────────────────────────────────────────────────
/** Angle for `cycles` whole turns per loop (plus an offset in turns). */
export const turn = (t: number, cycles = 1, offset = 0) => TAU * ((cycles * t) / LOOP + offset);
/** 0..1 phase that wraps `cycles` whole times per loop. */
export const cyc = (t: number, cycles = 1, offset = 0) => {
  const v = (cycles * t) / LOOP + offset;
  return v - Math.floor(v);
};
/** Smooth 0..1..0 bump over [a, b] (zero outside). */
export const bump = (x: number, a: number, b: number) => {
  if (x <= a || x >= b) return 0;
  const k = (x - a) / (b - a);
  return Math.sin(Math.PI * k) ** 2;
};

// ── periodic noise ───────────────────────────────────────────────────────
/** 1D Perlin noise (about -1..1) that repeats every `period` units of x (integer period). */
export const pnoise = (x: number, period: number, seed = 0) =>
  noise3(x, seed * 7.31 + 0.5, seed * 3.17 + 0.5, period, 0, 0);

/** 1D fractal noise with the same whole period. */
export function pfbm(x: number, period: number, seed = 0, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, seed * 7.31 + 0.5 + o * 1.7, seed * 3.17 + 0.5, period * f, 0, 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Noise that loops in time: a field sampled on a circle, `cycles` turns per loop. */
export const tnoise = (x: number, t: number, seed = 0, cycles = 1, radius = 0.8) => {
  const a = turn(t, cycles);
  return noise3(x, seed + Math.cos(a) * radius, Math.sin(a) * radius);
};

// ── sprites ──────────────────────────────────────────────────────────────
const sprites = new Map<string, AnyCanvas>();
function cached(key: string, size: number, draw: (g: Ctx2D, s: number) => void): AnyCanvas {
  let c = sprites.get(key);
  if (c) return c;
  c = makeCanvas(size, size);
  draw(context(c), size);
  sprites.set(key, c);
  if (sprites.size > 160) sprites.delete(sprites.keys().next().value as string);
  return c;
}

/**
 * A soft round glow: a hot core falling off smoothly to nothing. Draw it with
 * "lighter" or "screen" for light. `core` 0..1 sets how tight the hot centre is;
 * `hot` (a theme colour, usually ink) whitens the very centre.
 */
export function glow(color: string, core = 0.18, hot?: string): AnyCanvas {
  const S = 128;
  return cached(`glow|${color}|${core}|${hot ?? ""}`, S, (g, s) => {
    const r = s / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, rgba(hot ? mix(color, hot, 0.55) : color, 1));
    grad.addColorStop(core * 0.5, rgba(color, 0.9));
    grad.addColorStop(core, rgba(color, 0.42));
    grad.addColorStop(Math.min(0.95, core * 2.4), rgba(color, 0.12));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** An out-of-focus disc (bokeh): flat body, slightly brighter rim, soft edge. */
export function bokeh(color: string, rim = 0.35, soft = 0.1): AnyCanvas {
  const S = 128;
  return cached(`bokeh|${color}|${rim}|${soft}`, S, (g, s) => {
    const r = s / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    const edge = 1 - soft;
    grad.addColorStop(0, rgba(color, 0.55));
    grad.addColorStop(edge * 0.82, rgba(color, 0.62));
    grad.addColorStop(edge * 0.97, rgba(color, 0.62 + rim * 0.38));
    grad.addColorStop(edge, rgba(color, 0.5));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** Draw a square sprite centred at (x, y) with diameter d. */
export function blit(ctx: Ctx2D, img: AnyCanvas, x: number, y: number, d: number, alpha = 1) {
  if (alpha <= 0.002 || d <= 0.05) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(img as CanvasImageSource, x - d / 2, y - d / 2, d, d);
}

// ── grounds ──────────────────────────────────────────────────────────────
/**
 * A hand-made dark ground: base colour, large soft mottling and a fine
 * speckle, so no frame is ever a flat fill. Use inside bake().
 */
export function mottled(
  c: Ctx2D,
  w: number,
  h: number,
  base: string,
  tone: string,
  amount = 0.05,
  seed = 1,
  speckle = 0.035,
) {
  const { u } = frameOf(w, h);
  c.fillStyle = base;
  c.fillRect(0, 0, w, h);
  const step = Math.max(3, Math.round(u / 80));
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const n = fbm3(x / (u * 0.3), y / (u * 0.3), seed * 1.7 + 0.3, 3);
      c.fillStyle = rgba(tone, Math.max(0, amount * (0.5 + n)));
      c.fillRect(x, y, step, step);
    }
  if (speckle > 0) {
    const r = rng(9000 + seed);
    const dot = Math.max(0.6, u * 0.0014);
    for (let i = 0; i < (w * h) / 700; i++) {
      c.fillStyle = rgba(tone, speckle * (0.3 + r()));
      c.fillRect(r() * w, r() * h, dot, dot);
    }
  }
}

/** Vertical gradient fill between y0 and y1 with colour stops [pos, colour, alpha]. */
export function vgrad(
  c: Ctx2D,
  x: number,
  y0: number,
  w: number,
  y1: number,
  stops: [number, string, number?][],
) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [p, col, a] of stops) g.addColorStop(Math.max(0, Math.min(1, p)), rgba(col, a ?? 1));
  c.fillStyle = g;
  c.fillRect(x, y0, w, y1 - y0);
}

// ── type ─────────────────────────────────────────────────────────────────
type Spaced = Ctx2D & { letterSpacing?: string };

/** Set text with tracking (letter-spacing in em). Returns the drawn width. */
export function tracked(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number | string,
  family: string,
  fallback: string,
  trackingEm = 0.2,
  align: "left" | "center" | "right" = "center",
) {
  const c = ctx as Spaced;
  c.font = font(weight, size, family, fallback);
  const spacing = size * trackingEm;
  const had = c.letterSpacing;
  c.letterSpacing = `${spacing.toFixed(2)}px`;
  // Tracking adds space after the last glyph too; take it off so centring is true.
  const width = c.measureText(text).width - spacing;
  const x0 = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  c.textAlign = "left";
  c.fillText(text, x0, y);
  c.letterSpacing = had ?? "0px";
  return width;
}

/** Widest a tracked line may be before it must shrink: returns a size that fits. */
export function fitTracked(
  ctx: Ctx2D,
  text: string,
  maxWidth: number,
  max: number,
  weight: number | string,
  family: string,
  fallback: string,
  trackingEm = 0.2,
) {
  const c = ctx as Spaced;
  c.font = font(weight, max, family, fallback);
  const had = c.letterSpacing;
  c.letterSpacing = `${(max * trackingEm).toFixed(2)}px`;
  const width = c.measureText(text).width - max * trackingEm;
  c.letterSpacing = had ?? "0px";
  return Math.min(max, (max * maxWidth) / Math.max(1, width));
}

/** RGB triple of a colour for per-pixel work. */
export const rgbOf = (color: string) => parse(color);
