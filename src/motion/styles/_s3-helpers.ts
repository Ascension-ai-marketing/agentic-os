/**
 * Shared helpers for the design-movement styles (builder s3). Not a style:
 * it has no `style` export. Everything here is pure or a deterministic bake.
 */
import { fromOklch, parse, rgba, toOklch } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  fbm3,
  font,
  frameOf,
  grain,
  hash,
  rng,
  seg,
  TAU,
  vignette,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D, Theme } from "../engine/types";

// ── colour ───────────────────────────────────────────────────────────────
/** A colour at a set OKLCH lightness and chroma, with its hue turned by dh degrees. */
export function turn(color: string, dh: number, L: number, C: number): string {
  const [, c0, h] = toOklch(color);
  return fromOklch([L, Math.min(C, Math.max(c0, 0.06)), (h + dh + 360) % 360]);
}

/**
 * The hue halfway between two colours, on the short (arc 0) or long (arc 1)
 * way round, at a set lightness and chroma. A third ink that stays on-brand.
 */
export function between(a: string, b: string, arc: 0 | 1, L: number, C: number): string {
  const ha = toOklch(a)[2];
  const hb = toOklch(b)[2];
  let d = ((hb - ha + 540) % 360) - 180;
  if (arc === 1) d = d > 0 ? d - 360 : d + 360;
  return fromOklch([L, C, (ha + d / 2 + 360) % 360]);
}

/** Ink overprint: RGB multiply of two colours, eased toward their average by `soft`. */
export function overprint(a: string, b: string, soft = 0.35): string {
  const A = parse(a);
  const B = parse(b);
  const out = A.map((v, i) => {
    const m = (v * B[i]) / 255;
    const avg = (v + B[i]) / 2;
    return Math.round(m + (avg - m) * soft);
  });
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

// ── time ─────────────────────────────────────────────────────────────────
/**
 * Pose timeline: `n` poses, one per beat, looping. Returns the pose we leave,
 * the pose we go to and the eased progress of the move (0 while holding).
 */
export function poseAt(
  t: number,
  n: number,
  beat: number,
  move: number,
  delay = 0,
  curve: (x: number) => number = ease.inOutCubic,
) {
  const local = (((t - delay) % (n * beat)) + n * beat) % (n * beat);
  const i = Math.floor(local / beat) % n;
  const p = curve(seg(local - i * beat, 0, move));
  return { from: (i + n - 1) % n, to: i, p };
}

/** In-out ease with a small overshoot and settle: things land, they don't stop. */
export function settle(x: number, amount = 1.2) {
  const k = clamp(x);
  const c2 = amount * 1.525;
  return k < 0.5
    ? (Math.pow(2 * k, 2) * ((c2 + 1) * 2 * k - c2)) / 2
    : (Math.pow(2 * k - 2, 2) * ((c2 + 1) * (k * 2 - 2) + c2) + 2) / 2;
}

// ── surfaces ─────────────────────────────────────────────────────────────
/**
 * A dark printed stock: the ground colour, a soft mottle, long fibres and
 * specks. Returns a bake draw function (deterministic by seed).
 */
export function stock(theme: Theme, seed: number, mottle = 1, fibres = 1) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const step = Math.max(4, Math.round(u / 80));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.3), y / (u * 0.3), seed * 0.37 + 0.5, 3);
        c.fillStyle = rgba(theme.ink, Math.max(0, (0.012 + 0.022 * n) * mottle));
        c.fillRect(x, y, step, step);
      }
    const r = rng(seed * 977 + 13);
    c.lineCap = "round";
    for (let i = 0; i < 220 * fibres; i++) {
      const x = r() * w;
      const y = r() * h;
      const len = u * (0.015 + r() * 0.06);
      const a = r() * TAU;
      c.strokeStyle = rgba(theme.ink, 0.015 + r() * 0.03);
      c.lineWidth = Math.max(0.5, u * 0.0006);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(
        x + Math.cos(a + 0.5) * len * 0.5,
        y + Math.sin(a + 0.5) * len * 0.5,
        x + Math.cos(a) * len,
        y + Math.sin(a) * len,
      );
      c.stroke();
    }
    for (let i = 0; i < (w * h) / 900; i++) {
      c.fillStyle = rgba(theme.ink, 0.02 + r() * 0.04);
      c.fillRect(r() * w, r() * h, u * 0.0016, u * 0.0016);
    }
  };
}

/**
 * Paper tooth: a static, fine mottled texture laid over the whole frame with
 * soft-light, so flat inks look printed on a sheet rather than filled in code.
 */
export function tooth(ctx: Ctx2D, w: number, h: number, strength = 0.5, seed = 1) {
  const layer = bake(`s3-tooth:${seed}`, w, h, (c, W, H) => {
    const { u } = frameOf(W, H);
    const step = Math.max(2, Math.round(u / 260));
    for (let y = 0; y < H; y += step)
      for (let x = 0; x < W; x += step) {
        const n =
          fbm3(x / (u * 0.05), y / (u * 0.05), seed + 0.3, 3) * 0.6 +
          fbm3(x / (u * 0.012), y / (u * 0.012), seed + 7.1, 2) * 0.4;
        const v = Math.round(128 + n * 150);
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(x, y, step, step);
      }
  });
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = strength;
  ctx.drawImage(layer as CanvasImageSource, 0, 0);
  ctx.restore();
}

/** Light falloff and film grain: the last pass of every style. */
export function finish(ctx: Ctx2D, w: number, h: number, t: number, vig = 0.5, grainAmount = 0.3) {
  vignette(ctx, w, h, "#000000", vig);
  grain(ctx, w, h, t, grainAmount);
}

// ── type ─────────────────────────────────────────────────────────────────
/** Width of text set with extra tracking (px between letters). */
export function trackedWidth(ctx: Ctx2D, text: string, tracking: number) {
  let wsum = 0;
  const chars = [...text];
  for (const ch of chars) wsum += ctx.measureText(ch).width;
  return wsum + tracking * Math.max(0, chars.length - 1);
}

/** Letter-spaced text (canvas letterSpacing is not everywhere yet). Returns the width. */
export function tracked(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "center" | "right" = "left",
) {
  const total = trackedWidth(ctx, text, tracking);
  let cx = align === "left" ? x : align === "center" ? x - total / 2 : x - total;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = prev;
  return total;
}

/** Largest size at which text fits a box (width and cap height). */
export function fitBox(
  ctx: Ctx2D,
  text: string,
  maxW: number,
  maxH: number,
  weight: number | string,
  family: string,
  fallback: string,
  capRatio = 0.72,
) {
  ctx.font = font(weight, 100, family, fallback);
  const wd = ctx.measureText(text).width || 1;
  return Math.max(1, Math.min((100 * maxW) / wd, maxH / capRatio));
}

// ── shapes ───────────────────────────────────────────────────────────────
/** A regular star / burst path: n points, outer radius r1, inner radius r2. */
export function starPath(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  n: number,
  r1: number,
  r2: number,
  rot = 0,
) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rot + (i * Math.PI) / n - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A four-point sparkle with concave sides. */
export function sparklePath(ctx: Ctx2D, cx: number, cy: number, r: number, rot = 0, pinch = 0.18) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 2 - Math.PI / 2;
    const b = a + Math.PI / 4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    const nx = cx + Math.cos(a + Math.PI / 2) * r;
    const ny = cy + Math.sin(a + Math.PI / 2) * r;
    ctx.quadraticCurveTo(cx + Math.cos(b) * r * pinch, cy + Math.sin(b) * r * pinch, nx, ny);
  }
  ctx.closePath();
}

/**
 * A filled stroke along a polyline whose half-width follows `width(s)` for
 * s in 0..1 of the arc length. Used for brush and pen lines.
 */
export function taper(
  ctx: Ctx2D,
  pts: [number, number][],
  width: (s: number) => number,
  cap = true,
) {
  const n = pts.length;
  if (n < 2) return;
  const len: number[] = [0];
  for (let i = 1; i < n; i++)
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = len[n - 1] || 1;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const hw = Math.max(0, width(len[i] / L));
    left.push([pts[i][0] - ty * hw, pts[i][1] + tx * hw]);
    right.push([pts[i][0] + ty * hw, pts[i][1] - tx * hw]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  if (cap) {
    const e = pts[n - 1];
    const hw = Math.max(0, width(1));
    const a = Math.atan2(left[n - 1][1] - e[1], left[n - 1][0] - e[0]);
    ctx.arc(e[0], e[1], hw, a, a - Math.PI, true);
  }
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  if (cap) {
    const s0 = pts[0];
    const hw = Math.max(0, width(0));
    const a = Math.atan2(right[0][1] - s0[1], right[0][0] - s0[0]);
    ctx.arc(s0[0], s0[1], hw, a, a - Math.PI, true);
  }
  ctx.closePath();
  ctx.fill();
}

/** Sample a cubic Bézier chain [p0, c1, c2, p1, c1, c2, p2, ...] into points. */
export function bezierPoints(ctrl: [number, number][], stepsPerSeg = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let s = 0; s + 3 < ctrl.length; s += 3) {
    const [p0, c1, c2, p1] = [ctrl[s], ctrl[s + 1], ctrl[s + 2], ctrl[s + 3]];
    for (let i = s === 0 ? 0 : 1; i <= stepsPerSeg; i++) {
      const u = i / stepsPerSeg;
      const v = 1 - u;
      out.push([
        v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p1[0],
        v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p1[1],
      ]);
    }
  }
  return out;
}

/** The first fraction p (0..1, by arc length) of a polyline. */
export function partial(pts: [number, number][], p: number): [number, number][] {
  if (p >= 1) return pts;
  if (p <= 0 || pts.length < 2) return pts.slice(0, 1);
  const len: number[] = [0];
  for (let i = 1; i < pts.length; i++)
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const target = len[len.length - 1] * p;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (len[i] >= target) {
      const k = (target - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
      out.push([
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k,
      ]);
      break;
    }
    out.push(pts[i]);
  }
  return out;
}

/** Seeded jitter in -1..1 for index i and channel k. */
export const jit = (i: number, k: number, seed = 0) => hash(i, k, seed) * 2 - 1;

export type { AnyCanvas };
