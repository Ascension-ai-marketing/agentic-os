/**
 * Shared helpers for builder 5's "Light and material" styles. Everything here
 * is pure or deterministic-cached, like the kit: periodic noise of time, baked
 * tileable noise tiles with a cheap bilinear sampler, colour ramps, a
 * theme-derived spectrum, cheap glow and text fitting.
 */
import { fromOklch, mix, parse, toOklch } from "../engine/color";
import {
  clamp,
  context,
  fbm3,
  font,
  LOOP,
  makeCanvas,
  noise3,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D } from "../engine/types";

// ── periodic noise ───────────────────────────────────────────────────────
/** Smooth noise of time (about -1..1) that runs `cycles` whole periods per loop, so it is seamless. */
export function tnoise(t: number, cycles: number, seed: number): number {
  return noise3((cycles * t) / LOOP, seed * 7.31 + 0.5, seed * 3.17 + 0.25, cycles, 0, 0) * 1.6;
}

/** Smooth 1D noise along x that repeats every `period` units (period must be a whole number). */
export function pnoise(x: number, period: number, seed: number): number {
  return noise3(x, seed * 5.13 + 0.37, seed * 1.91 + 0.61, period, 0, 0) * 1.6;
}

/** 2D noise that repeats in y every `py` units and in time every loop (`cycles` periods). */
export function flowNoise(x: number, y: number, t: number, cycles: number): number {
  return noise3(x, y, (cycles * t) / LOOP, 0, 0, cycles) * 1.6;
}

// ── baked noise tiles ────────────────────────────────────────────────────
/** A tileable fbm field in 0..1 with a bilinear sampler. Built once, kept for the page's life. */
export class NoiseTile {
  constructor(
    readonly size: number,
    readonly data: Float32Array,
  ) {}
  /** Bilinear lookup in tile pixels; wraps in both axes. */
  sample(x: number, y: number): number {
    const s = this.size;
    const d = this.data;
    const fx = x - Math.floor(x / s) * s;
    const fy = y - Math.floor(y / s) * s;
    const x0 = fx | 0;
    const y0 = fy | 0;
    const x1 = x0 + 1 === s ? 0 : x0 + 1;
    const y1 = y0 + 1 === s ? 0 : y0 + 1;
    const tx = fx - x0;
    const ty = fy - y0;
    const r0 = y0 * s;
    const r1 = y1 * s;
    const a = d[r0 + x0] + (d[r0 + x1] - d[r0 + x0]) * tx;
    const b = d[r1 + x0] + (d[r1 + x1] - d[r1 + x0]) * tx;
    return a + (b - a) * ty;
  }
}

const tiles = new Map<string, NoiseTile>();
/**
 * A size x size tile of fbm noise with `cells` noise periods across it,
 * normalised to 0..1. `ridge` folds it into ridged noise (sharp creases).
 */
export function noiseTile(
  seed: number,
  size = 256,
  cells = 8,
  octaves = 4,
  ridge = false,
): NoiseTile {
  const key = `${seed}|${size}|${cells}|${octaves}|${ridge ? 1 : 0}`;
  let tile = tiles.get(key);
  if (tile) return tile;
  const data = new Float32Array(size * size);
  let lo = Infinity;
  let hi = -Infinity;
  const z = seed * 0.731 + 0.19;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = fbm3((x / size) * cells, (y / size) * cells, z, octaves, cells, cells, 0);
      if (ridge) v = -Math.abs(v);
      data[y * size + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - lo) * k;
  tile = new NoiseTile(size, data);
  tiles.set(key, tile);
  return tile;
}

// ── colour ───────────────────────────────────────────────────────────────
/** A colour ramp as a flat RGB lookup table (n entries). */
export function ramp(stops: [number, string][], n = 256): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * 3);
  const s = [...stops].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    let j = 0;
    while (j < s.length - 2 && p > s[j + 1][0]) j++;
    const [p0, c0] = s[j];
    const [p1, c1] = s[Math.min(s.length - 1, j + 1)];
    const c = parse(mix(c0, c1, p1 > p0 ? clamp((p - p0) / (p1 - p0)) : 0));
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

/**
 * n colours sweeping hue from a to b, taking the way round the colour wheel
 * that passes through green-cyan. A red accent and a violet accent2 give a
 * real rainbow; any brand pair gives its own brand-tinted spectrum.
 */
export function spectrum(
  a: string,
  b: string,
  n: number,
  lightness = 0.78,
  chroma = 0.19,
): string[] {
  const [, , ha] = toOklch(a);
  const [, , hb] = toOklch(b);
  const up = (hb - ha + 360) % 360;
  const through = (170 - ha + 360) % 360;
  const span = through <= up ? up : up - 360;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1);
    // Yellow-green sits lighter in a real spectrum; the ends fall darker.
    const hump = Math.sin(Math.PI * k);
    out.push(fromOklch([lightness - 0.1 + 0.12 * hump, chroma, (ha + span * k + 360) % 360]));
  }
  return out;
}

// ── glow ─────────────────────────────────────────────────────────────────
/**
 * Add a soft glow of `src` (w x h) onto `dst`: shrink it, blur the small copy
 * and draw it back up with "lighter". Meant for bake time; radius is in dst px.
 */
export function addGlow(
  dst: Ctx2D,
  src: AnyCanvas,
  w: number,
  h: number,
  radius: number,
  alpha: number,
) {
  const down = Math.max(1, Math.min(8, radius / 5));
  const sw = Math.max(2, Math.round(w / down));
  const sh = Math.max(2, Math.round(h / down));
  const small = makeCanvas(sw, sh);
  const g = context(small);
  g.filter = `blur(${Math.max(0.6, radius / down).toFixed(2)}px)`;
  g.drawImage(src as CanvasImageSource, 0, 0, sw, sh);
  dst.save();
  dst.globalCompositeOperation = "lighter";
  dst.globalAlpha = clamp(alpha);
  dst.imageSmoothingEnabled = true;
  dst.imageSmoothingQuality = "high";
  dst.drawImage(small as CanvasImageSource, 0, 0, w, h);
  dst.restore();
}

// ── type ─────────────────────────────────────────────────────────────────
export interface Fitted {
  size: number;
  width: number;
  ascent: number;
  descent: number;
}

/**
 * The largest size (<= max) at which text fits a box, with its real ink
 * extents so it can be centred optically. Measured at the size it will be
 * drawn (a few passes), because tracking in px and optical-size axes do not
 * scale linearly. Set ctx.letterSpacing before calling if the text is tracked.
 */
export function fitText(
  ctx: Ctx2D,
  text: string,
  maxW: number,
  maxH: number,
  max: number,
  weight: number | string,
  family: string,
  fallback?: string,
  style = "",
): Fitted {
  const measure = (size: number) => {
    ctx.font = `${style ? style + " " : ""}${font(weight, size, family, fallback)}`;
    const m = ctx.measureText(text);
    return {
      width: Math.max(1e-3, Math.abs(m.actualBoundingBoxLeft) + Math.abs(m.actualBoundingBoxRight)),
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent,
    };
  };
  let size = Math.min(max, 100);
  let m = measure(size);
  for (let pass = 0; pass < 4; pass++) {
    const k = Math.min(maxW / m.width, maxH / Math.max(1e-3, m.ascent + m.descent));
    const next = Math.min(max, size * k);
    if (Math.abs(next - size) < 0.25) {
      size = next;
      m = measure(size);
      break;
    }
    size = next;
    m = measure(size);
  }
  // Never overshoot the box after rounding in the last pass.
  if (m.width > maxW) {
    size *= maxW / m.width;
    m = measure(size);
  }
  return { size, width: m.width, ascent: m.ascent, descent: m.descent };
}

/** A font string, with an optional style prefix such as "italic". */
export function fontOf(
  style: string,
  weight: number | string,
  size: number,
  family: string,
  fallback?: string,
) {
  return `${style ? style + " " : ""}${font(weight, size, family, fallback)}`;
}

/** Smooth pulse: 0 outside [a, d], 1 inside [b, c], eased edges. */
export function pulse(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) {
    const k = (t - a) / (b - a);
    return k * k * (3 - 2 * k);
  }
  if (t <= c) return 1;
  const k = (d - t) / (d - c);
  return k * k * (3 - 2 * k);
}

const readyFonts = new Set<string>();
/** True once a face can draw (so glyph masks baked with it are final). Always true outside a browser. */
export function fontReady(weight: number | string, family: string): boolean {
  const key = `${weight} ${family}`;
  if (readyFonts.has(key)) return true;
  if (typeof document === "undefined" || !document.fonts?.check) return true;
  let ok = false;
  try {
    ok = document.fonts.check(`${weight} 24px "${family}"`);
  } catch {
    ok = true;
  }
  if (ok) readyFonts.add(key);
  return ok;
}
