/**
 * Shared helpers for the data-and-diagram styles (wave 2, set 6). Pure or
 * deterministic-cached like the kit: nothing here reads the clock or
 * Math.random, so every style built on it stays a pure function of t.
 */
import { mix, rgba } from "../engine/color";
import { bake, ease, fbm3, frameOf, rng, seg, type AnyCanvas } from "../engine/kit";
import type { Ctx2D, Theme } from "../engine/types";

/** 1 unit = 1 px on a 1080-short-side frame, so type sizes read the same at every aspect. */
export const unit = (w: number, h: number) => Math.min(w, h) / 1080;

/** 0 before a, eases up to 1 by b, holds, eases back to 0 between c and d. */
export function envelope(
  t: number,
  a: number,
  b: number,
  c: number,
  d: number,
  fn: (x: number) => number = ease.inOutCubic,
): number {
  if (t <= a || t >= d) return 0;
  if (t < b) return fn(seg(t, a, b));
  if (t <= c) return 1;
  return 1 - fn(seg(t, c, d));
}

/** Thousands separators and fixed decimals: 12840.5 -> "12,840.5". */
export function fmt(value: number, decimals = 0): string {
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, frac] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + grouped + (frac ? "." + frac : "");
}

const widthCache = new Map<string, Map<string, number>>();
function charWidth(ctx: Ctx2D, ch: string): number {
  let m = widthCache.get(ctx.font);
  if (!m) {
    m = new Map();
    widthCache.set(ctx.font, m);
    if (widthCache.size > 160) widthCache.delete(widthCache.keys().next().value as string);
  }
  let v = m.get(ch);
  if (v === undefined) {
    if (ch === "#") {
      v = 0;
      for (const d of "0123456789") v = Math.max(v, ctx.measureText(d).width);
    } else v = ctx.measureText(ch).width;
    m.set(ch, v);
  }
  return v;
}

/** Width of text set with tabular digits (every digit takes the widest digit's advance). */
export function tabularWidth(ctx: Ctx2D, text: string, track = 0): number {
  const prevSpacing = ctx.letterSpacing;
  ctx.letterSpacing = "0px";
  const dw = charWidth(ctx, "#");
  let wsum = 0;
  let n = 0;
  for (const ch of text) {
    wsum += ch >= "0" && ch <= "9" ? dw : charWidth(ctx, ch);
    n++;
  }
  ctx.letterSpacing = prevSpacing;
  return wsum + Math.max(0, n - 1) * track;
}

/**
 * Draw text with tabular digits, so a ticking number never jitters sideways.
 * Uses the current font, fill style and baseline; `track` adds (or, negative,
 * removes) space between characters. Returns the drawn width.
 */
export function tabular(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  align: "left" | "right" | "center" = "left",
  track = 0,
): number {
  const total = tabularWidth(ctx, text, track);
  const prevAlign = ctx.textAlign;
  const prevSpacing = ctx.letterSpacing;
  ctx.letterSpacing = "0px";
  const dw = charWidth(ctx, "#");
  let cx = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  ctx.textAlign = "center";
  for (const ch of text) {
    const cw = ch >= "0" && ch <= "9" ? dw : charWidth(ctx, ch);
    ctx.fillText(ch, cx + cw / 2, y);
    cx += cw + track;
  }
  ctx.textAlign = prevAlign;
  ctx.letterSpacing = prevSpacing;
  return total;
}

/**
 * A soft radial glow sprite, baked once per colour and drawn with drawImage
 * (far cheaper than shadowBlur or a gradient per dot).
 */
export function glowSprite(color: string): AnyCanvas {
  return bake(`s6-glow:${color}`, 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, rgba(color, 1));
    g.addColorStop(0.18, rgba(color, 0.55));
    g.addColorStop(0.45, rgba(color, 0.16));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

/** Draw a glow of radius r at (x, y). Additive (lighter) by default. */
export function glow(
  ctx: Ctx2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
  op: GlobalCompositeOperation = "lighter",
) {
  if (alpha <= 0.002 || r <= 0.5) return;
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowSprite(color) as CanvasImageSource, x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/**
 * The studio ground every set-6 style starts from: the theme's bg, a large
 * soft uneven light (so the ground is never flat), fine paper-like speckle.
 * Baked once per theme, size and variant.
 */
export function studio(
  theme: Theme,
  key: string,
  w: number,
  h: number,
  opts: { lx?: number; ly?: number; tint?: string; mottle?: number; speckle?: number } = {},
): AnyCanvas {
  const lx = opts.lx ?? 0.3;
  const ly = opts.ly ?? 0.2;
  const tint = opts.tint ?? theme.ink;
  const mottle = opts.mottle ?? 1;
  const speckle = opts.speckle ?? 1;
  return bake(
    `s6-studio:${key}:${theme.bg}${tint}${lx}${ly}${mottle}${speckle}`,
    w,
    h,
    (c, W, H) => {
      const { u } = frameOf(W, H);
      c.fillStyle = theme.bg;
      c.fillRect(0, 0, W, H);
      // One broad, soft key light.
      const g = c.createRadialGradient(W * lx, H * ly, 0, W * lx, H * ly, Math.hypot(W, H) * 0.85);
      g.addColorStop(0, rgba(mix(theme.bg, tint, 0.5), 0.14));
      g.addColorStop(0.5, rgba(mix(theme.bg, tint, 0.3), 0.04));
      g.addColorStop(1, rgba(theme.bg, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // Large, low-contrast mottling.
      if (mottle > 0) {
        const step = Math.max(4, Math.round(u / 70));
        for (let y = 0; y < H; y += step)
          for (let x = 0; x < W; x += step) {
            const n = fbm3(x / (u * 0.42), y / (u * 0.42), 1.7, 3);
            const a = 0.022 * mottle * (0.5 + n);
            if (a <= 0.002) continue;
            c.fillStyle = rgba(n > 0 ? tint : "#000000", Math.abs(a));
            c.fillRect(x, y, step, step);
          }
      }
      // Fine speckle, like toner on stock.
      if (speckle > 0) {
        const r = rng(0x5e6);
        const n = Math.round(((W * H) / 700) * speckle);
        for (let i = 0; i < n; i++) {
          c.fillStyle = rgba(r() < 0.5 ? tint : "#000000", 0.02 + r() * 0.05);
          const s = Math.max(0.6, u * 0.0011 * (0.5 + r()));
          c.fillRect(r() * W, r() * H, s, s);
        }
      }
    },
  );
}

/** A polyline sampled from a function, with cumulative arc length for constant-speed travel. */
export interface Track {
  x: Float32Array;
  y: Float32Array;
  len: Float32Array;
  total: number;
}

export function track(n: number, at: (s: number) => [number, number]): Track {
  const x = new Float32Array(n + 1);
  const y = new Float32Array(n + 1);
  const len = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const [px, py] = at(i / n);
    x[i] = px;
    y[i] = py;
    if (i > 0) len[i] = len[i - 1] + Math.hypot(px - x[i - 1], py - y[i - 1]);
  }
  return { x, y, len, total: len[n] };
}

/** Point at arc-length fraction f (0..1) along a track, with the unit tangent. */
export function along(
  tr: Track,
  f: number,
): { x: number; y: number; tx: number; ty: number; i: number } {
  const target = Math.max(0, Math.min(1, f)) * tr.total;
  let lo = 0;
  let hi = tr.len.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.len[mid] < target) lo = mid;
    else hi = mid;
  }
  const span = tr.len[hi] - tr.len[lo] || 1;
  const k = (target - tr.len[lo]) / span;
  const dx = tr.x[hi] - tr.x[lo];
  const dy = tr.y[hi] - tr.y[lo];
  const d = Math.hypot(dx, dy) || 1;
  return { x: tr.x[lo] + dx * k, y: tr.y[lo] + dy * k, tx: dx / d, ty: dy / d, i: lo };
}

/** Stroke a track between arc-length fractions a and b (a < b). */
export function strokeTrack(ctx: Ctx2D, tr: Track, a: number, b: number) {
  if (b <= a) return;
  const p0 = along(tr, a);
  const p1 = along(tr, b);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  for (let i = p0.i + 1; i <= p1.i; i++) ctx.lineTo(tr.x[i], tr.y[i]);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}
