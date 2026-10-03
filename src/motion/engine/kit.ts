/**
 * The motion kit: seeded hashes, periodic noise, easing, timeline helpers,
 * cached offscreen buffers, film grain and light. Everything here is pure or
 * deterministic-cached, so a style built from it stays a pure function of t.
 */
import { rgba } from "./color";
import type { Ctx2D } from "./types";
import { LOOP } from "./types";

export const TAU = Math.PI * 2;
export { LOOP };

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (x: number) => x - Math.floor(x);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Progress of t through [a, b], clamped to 0..1. */
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
/** Loop phase 0..1 (t = LOOP gives 0 again). */
export const phase = (t: number, period = LOOP) => fract(t / period);
/** A sine that completes `cycles` whole turns per loop, so it is seamless. */
export const wave = (t: number, cycles = 1, offset = 0) =>
  Math.sin(TAU * (cycles * (t / LOOP) + offset));

// ── easing ───────────────────────────────────────────────────────────────
export const ease = {
  linear: (t: number) => t,
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t <= 0
      ? 0
      : t >= 1
        ? 1
        : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

// ── seeded hashes ────────────────────────────────────────────────────────
/** Integer hash to [0, 1). Same input, same output, on every machine. */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x2545f491, 0x9e3779b1);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Hash of a string, for per-style seeds. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Seeded PRNG (mulberry32). Use for build-time layouts, never fed by time. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ── periodic Perlin noise ────────────────────────────────────────────────
const PERM = (() => {
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  const r = rng(0x5eed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h: number, x: number, y: number, z: number) {
  const k = h & 15;
  const u = k < 8 ? x : y;
  const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}
const wrap = (i: number, p: number) => (p > 0 ? ((i % p) + p) % p : i) & 255;

/**
 * Improved Perlin noise, about -1..1. Pass integer periods to make any axis
 * tile: noise(x, y, z, 0, 0, 4) repeats every 4 units of z, so feeding
 * z = 4 * t / LOOP gives a field that morphs and loops without a seam.
 */
export function noise3(x: number, y: number, z: number, px = 0, py = 0, pz = 0): number {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const Z = Math.floor(z);
  const xf = x - X;
  const yf = y - Y;
  const zf = z - Z;
  const X0 = wrap(X, px);
  const X1 = wrap(X + 1, px);
  const Y0 = wrap(Y, py);
  const Y1 = wrap(Y + 1, py);
  const Z0 = wrap(Z, pz);
  const Z1 = wrap(Z + 1, pz);
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const a0 = PERM[X0] + Y0;
  const a1 = PERM[X0] + Y1;
  const b0 = PERM[X1] + Y0;
  const b1 = PERM[X1] + Y1;
  const c000 = PERM[PERM[a0] + Z0];
  const c100 = PERM[PERM[b0] + Z0];
  const c010 = PERM[PERM[a1] + Z0];
  const c110 = PERM[PERM[b1] + Z0];
  const c001 = PERM[PERM[a0] + Z1];
  const c101 = PERM[PERM[b0] + Z1];
  const c011 = PERM[PERM[a1] + Z1];
  const c111 = PERM[PERM[b1] + Z1];
  const x1 = lerp(grad(c000, xf, yf, zf), grad(c100, xf - 1, yf, zf), u);
  const x2 = lerp(grad(c010, xf, yf - 1, zf), grad(c110, xf - 1, yf - 1, zf), u);
  const x3 = lerp(grad(c001, xf, yf, zf - 1), grad(c101, xf - 1, yf, zf - 1), u);
  const x4 = lerp(grad(c011, xf, yf - 1, zf - 1), grad(c111, xf - 1, yf - 1, zf - 1), u);
  return lerp(lerp(x1, x2, v), lerp(x3, x4, v), w);
}

/** Fractal noise with the same periods (each octave doubles them, still whole). */
export function fbm3(x: number, y: number, z: number, octaves = 4, px = 0, py = 0, pz = 0): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f, px * f, py * f, pz * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Field that morphs through `speed` whole noise periods per loop. */
export const loopNoise = (x: number, y: number, t: number, speed = 2, octaves = 3) =>
  fbm3(x, y, (speed * t) / LOOP, octaves, 0, 0, speed);

// ── offscreen buffers ────────────────────────────────────────────────────
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(w: number, h: number): AnyCanvas {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(W, H);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return c;
}

export function context(canvas: AnyCanvas): Ctx2D {
  return canvas.getContext("2d", { willReadFrequently: false }) as Ctx2D;
}

type Buffer = { canvas: AnyCanvas; ctx: Ctx2D };
const buffers = new Map<string, Buffer>();
/** A reusable offscreen canvas per key and size (small LRU). Contents are NOT kept between calls unless you build them once. */
export function buffer(key: string, w: number, h: number): Buffer {
  const id = `${key}@${Math.round(w)}x${Math.round(h)}`;
  let b = buffers.get(id);
  if (b) {
    buffers.delete(id);
    buffers.set(id, b);
    return b;
  }
  const canvas = makeCanvas(w, h);
  b = { canvas, ctx: context(canvas) };
  buffers.set(id, b);
  if (buffers.size > 160) buffers.delete(buffers.keys().next().value as string);
  return b;
}

const baked = new Map<string, AnyCanvas>();
/**
 * The texture cache is sized for about 120 styles: builders measured about 38
 * baked layers per 11 styles, so 440 entries keep a whole wall warm. A pixel
 * budget (about 1 GB of RGBA at most) stops a run of 4K exports from holding
 * every frame-sized layer at once.
 */
const BAKE_MAX = 440;
const BAKE_MAX_PIXELS = 256e6;
let bakedPixels = 0;
const pixelsOf = (c: AnyCanvas) => c.width * c.height;
/** Bumped whenever a web font finishes loading, so baked text is rebuilt in the real face. */
let fontEpoch = 0;
if (typeof document !== "undefined" && document.fonts?.addEventListener)
  document.fonts.addEventListener("loadingdone", () => {
    fontEpoch++;
  });

/**
 * Build a static layer once per key and size, then reuse it. `draw` must be
 * deterministic (seeded), so a cached layer is identical to a fresh one.
 */
export function bake(
  key: string,
  w: number,
  h: number,
  draw: (ctx: Ctx2D, w: number, h: number) => void,
): AnyCanvas {
  const id = `${key}@${Math.round(w)}x${Math.round(h)}#${fontEpoch}`;
  let c = baked.get(id);
  if (c) {
    baked.delete(id);
    baked.set(id, c);
    return c;
  }
  c = makeCanvas(w, h);
  draw(context(c), Math.round(w), Math.round(h));
  baked.set(id, c);
  bakedPixels += pixelsOf(c);
  while (baked.size > 1 && (baked.size > BAKE_MAX || bakedPixels > BAKE_MAX_PIXELS)) {
    const oldest = baked.keys().next().value as string;
    bakedPixels -= pixelsOf(baked.get(oldest) as AnyCanvas);
    baked.delete(oldest);
  }
  return c;
}

/** Cache any deterministic value (layouts, trajectories) by key. */
const memo = new Map<string, unknown>();
export function once<T>(key: string, build: () => T): T {
  if (memo.has(key)) {
    const v = memo.get(key) as T;
    memo.delete(key);
    memo.set(key, v);
    return v;
  }
  const v = build();
  memo.set(key, v);
  if (memo.size > 480) memo.delete(memo.keys().next().value as string);
  return v;
}

// ── film grain & light ───────────────────────────────────────────────────
const GRAIN = 192;
const grainTiles: AnyCanvas[] = [];
function grainTile(i: number): AnyCanvas {
  if (grainTiles[i]) return grainTiles[i];
  const c = makeCanvas(GRAIN, GRAIN);
  const g = context(c);
  const img = g.createImageData(GRAIN, GRAIN);
  const r = rng(0x9a17 + i * 7919);
  for (let p = 0; p < GRAIN * GRAIN; p++) {
    // Sum of three uniforms: a soft, film-like distribution around mid grey.
    const v = (r() + r() + r()) / 3;
    const c8 = Math.round(128 + (v - 0.5) * 2.2 * 127);
    img.data[p * 4] = c8;
    img.data[p * 4 + 1] = c8;
    img.data[p * 4 + 2] = c8;
    img.data[p * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTiles[i] = c;
  return c;
}

const patterns = new WeakMap<object, CanvasPattern[]>();
/**
 * Film grain that changes 24 times a second and repeats every loop.
 * amount ~0.25 is subtle; 0.5 is gritty.
 */
export function grain(ctx: Ctx2D, w: number, h: number, t: number, amount = 0.28) {
  const frame = Math.floor(fract(t / LOOP) * LOOP * 24 + 1e-6);
  const index = frame % 3;
  let list = patterns.get(ctx);
  if (!list) {
    list = [];
    patterns.set(ctx, list);
  }
  let pattern = list[index];
  if (!pattern) {
    pattern = ctx.createPattern(grainTile(index) as CanvasImageSource, "repeat") as CanvasPattern;
    list[index] = pattern;
  }
  const scale = Math.max(0.5, Math.min(w, (h * 16) / 9) / 1920);
  const ox = Math.floor(hash(frame, 11) * GRAIN);
  const oy = Math.floor(hash(frame, 23) * GRAIN);
  if (typeof DOMMatrix !== "undefined")
    pattern.setTransform(new DOMMatrix().translateSelf(-ox * scale, -oy * scale).scaleSelf(scale));
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = amount;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Darken the edges toward `color` — the light falls off like a lens. */
export function vignette(ctx: Ctx2D, w: number, h: number, color: string, strength = 0.55) {
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.3,
    w / 2,
    h / 2,
    Math.hypot(w, h) * 0.62,
  );
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, strength));
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A soft pool of light (screen blend). */
export function light(
  ctx: Ctx2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 0.18,
  op: GlobalCompositeOperation = "screen",
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// ── type ─────────────────────────────────────────────────────────────────
export const SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';
export const SERIF = '"Newsreader", Georgia, serif';
export const MONO = '"JetBrains Mono", "SFMono-Regular", Menlo, monospace';

export function font(weight: number | string, size: number, family: string, fallback = SANS) {
  return `${weight} ${Math.max(1, size).toFixed(2)}px "${family}", ${fallback}`;
}

/** Largest size (<= max) at which text fits maxWidth. */
export function fitSize(
  ctx: Ctx2D,
  text: string,
  maxWidth: number,
  max: number,
  weight: number | string,
  family: string,
  fallback = SANS,
): number {
  ctx.font = font(weight, max, family, fallback);
  const width = ctx.measureText(text).width || 1;
  return Math.min(max, (max * maxWidth) / width);
}

/** The word a style sets: the brand name when present, else its own word. */
export function wordFor(themeName: string | null | undefined, fallback: string, maxChars = 14) {
  const name = (themeName || "").trim();
  if (!name) return fallback;
  return name.length > maxChars ? name.slice(0, maxChars).trim() : name;
}

/** Frame facts every layout needs. */
export function frameOf(w: number, h: number) {
  const u = Math.min(w, h);
  return {
    u,
    cx: w / 2,
    cy: h / 2,
    portrait: h > w * 1.05,
    square: Math.abs(w - h) <= Math.max(w, h) * 0.05,
    wide: w > h * 1.2,
    /** Scale relative to a 1080-high 16:9 frame. */
    k: Math.min(w / 1920, h / 1080) || 1,
  };
}

/** Fill the whole frame with a flat colour (the only flat fill a style should use). */
export function ground(ctx: Ctx2D, w: number, h: number, color: string) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
