/**
 * Field Notes kit: the look of the Motion Video deck's story loops, adapted to
 * the Motion Library contract (any aspect ratio, every colour from the theme).
 * Adapted from the Horizon Strike deck kit:
 * night ground with a dawn planet rim, ivory ink lines that draw on, torn ochre
 * paper with an ink compass sketch, one clay nib, Newsreader set at opsz 36.
 */
import { mix, parse, rgba } from "../../engine/color";
import {
  clamp,
  context,
  fbm3,
  lerp,
  makeCanvas,
  noise3,
  once,
  rng,
  TAU,
  type AnyCanvas,
} from "../../engine/kit";
import type { Ctx2D, Theme } from "../../engine/types";

export type Pt = [number, number];

/** Frame facts: `s` scales design pixels (1080-high) to this canvas. */
export function fnFrame(w: number, h: number) {
  const u = Math.min(w, h);
  return {
    w,
    h,
    u,
    s: u / 1080,
    cx: w / 2,
    cy: h / 2,
    portrait: h > w * 1.05,
    square: Math.abs(w - h) <= Math.max(w, h) * 0.05,
  };
}
export type FnFrame = ReturnType<typeof fnFrame>;

/** Palette derived from the theme: night, ivory ink, clay accent, ochre paper. */
export function fnPalette(theme: Theme) {
  return {
    night: theme.bg,
    moon: theme.ink,
    ivory: mix(theme.ink, "#ffffff", 0.35),
    clay: theme.accent,
    ochre: theme.accent2,
    dawn: mix(theme.accent, theme.ink, 0.55),
    inkOnPaper: mix(theme.bg, "#1c140a", 0.6),
  };
}

// ── ground ───────────────────────────────────────────────────────────────
/** Night field, a soft light pool and the dawn planet rim at the foot. */
export function fnGround(ctx: Ctx2D, f: FnFrame, theme: Theme, p: number) {
  const P = fnPalette(theme);
  ctx.fillStyle = P.night;
  ctx.fillRect(0, 0, f.w, f.h);
  const lx = f.cx;
  const ly = f.h * 0.4;
  let g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(f.w, f.h) * 0.75);
  g.addColorStop(0, rgba(P.moon, 0.085));
  g.addColorStop(0.42, rgba(P.moon, 0.036));
  g.addColorStop(1, rgba(P.moon, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.w, f.h);

  // Planet: radius 1.5x the width, apex near the foot; light follows the curve.
  const R = Math.max(f.w, f.h) * 1.5;
  const ax = f.cx;
  const ay = f.h * 0.952;
  const cy = ay + R;
  const glow = 0.92 + 0.08 * Math.cos(TAU * p);
  const k = f.s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, f.w, f.h);
  ctx.arc(ax, cy, R, 0, TAU, true);
  ctx.clip();
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(5.2, 1);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 150 * k);
  g.addColorStop(0, rgba(P.dawn, 0.2 * glow));
  g.addColorStop(0.35, rgba(P.clay, 0.08 * glow));
  g.addColorStop(1, rgba(P.clay, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-190 * k, -160 * k, 380 * k, 170 * k);
  ctx.restore();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, cy, R, 0, TAU);
  ctx.clip();
  ctx.fillStyle = mix(P.night, "#000000", 0.45);
  ctx.fillRect(0, ay - 4, f.w, f.h - ay + 8);
  ctx.restore();
  const span = Math.min(0.3, (f.w * 0.45) / R);
  const lg = ctx.createLinearGradient(ax - f.w * 0.45, 0, ax + f.w * 0.45, 0);
  lg.addColorStop(0, rgba(P.dawn, 0));
  lg.addColorStop(0.3, rgba(P.dawn, 0.28 * glow));
  lg.addColorStop(0.5, rgba(mix(P.dawn, "#ffffff", 0.4), 0.95 * glow));
  lg.addColorStop(0.7, rgba(P.dawn, 0.28 * glow));
  lg.addColorStop(1, rgba(P.dawn, 0));
  ctx.strokeStyle = lg;
  ctx.lineWidth = Math.max(1, 2.2 * k);
  ctx.beginPath();
  ctx.arc(ax, cy, R, -Math.PI / 2 - span, -Math.PI / 2 + span);
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(ax, ay);
  ctx.scale(9, 1);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34 * k);
  g.addColorStop(0, rgba(P.dawn, 0.34 * glow));
  g.addColorStop(1, rgba(P.dawn, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-34 * k, -34 * k, 68 * k, 68 * k);
  ctx.restore();
}

// ── paper ────────────────────────────────────────────────────────────────
/** Ivory paper tile (tooth + fibres), used as a pattern so the texture travels. */
export function fnPaperTile(tone: string, seed = 1): AnyCanvas {
  return once(`fn-paper:${tone}:${seed}`, () => {
    const size = 256;
    const c = makeCanvas(size, size);
    const g = context(c);
    const img = g.createImageData(size, size);
    const [r, gg, b] = parse(tone);
    const rand = rng(seed * 101 + 7);
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const u = i / size;
        const v = j / size;
        const lo =
          noise3(u * 6, v * 6, seed, 6, 6, 0) * 0.6 +
          noise3(u * 24, v * 24, seed + 5, 24, 24, 0) * 0.4;
        const fib = noise3(u * 90, v * 12, seed + 9, 90, 12, 0);
        const k = 1 + lo * 0.018 + fib * 0.012 + (rand() - 0.5) * 0.03;
        const o = (j * size + i) * 4;
        img.data[o] = clamp(r * k, 0, 255);
        img.data[o + 1] = clamp(gg * k, 0, 255);
        img.data[o + 2] = clamp(b * k, 0, 255);
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return c;
  });
}

export interface TornSpec {
  key: string;
  /** Polygon in design px (clockwise), relative to the sprite origin. */
  pts: Pt[];
  /** Which edges are torn (others are the straight cut of the sheet). */
  torn?: boolean[];
  tone: "ochre" | "zebra";
  seed: number;
  /** Where the compass sketch is centred (design px), or none. */
  sketch?: Pt | null;
  dim?: number;
}

function noise1(x: number, s: number) {
  return noise3(x, s * 1.7, 0.31);
}

function tornOutline(spec: TornSpec) {
  const r = rng(spec.seed * 97 + 13);
  const pts = spec.pts;
  const n = pts.length;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let e = 0; e < n; e++) {
    const [x0, y0] = pts[e];
    const [x1, y1] = pts[(e + 1) % n];
    const L = Math.hypot(x1 - x0, y1 - y0);
    const nx = (y1 - y0) / L;
    const ny = -(x1 - x0) / L;
    const torn = spec.torn ? spec.torn[e] : true;
    const steps = Math.max(2, Math.round(L / 2.2));
    const sd = spec.seed * 31 + e * 7;
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const x = lerp(x0, x1, u);
      const y = lerp(y0, y1, u);
      if (!torn) {
        outer.push([x, y]);
        inner.push([x, y]);
        continue;
      }
      const s = u * L;
      const taper = Math.min(1, s / 30, (L - s) / 30);
      const d = (noise1(s / 46, sd) * 9 + noise1(s / 11, sd + 1) * 3.2 + (r() - 0.5) * 1.8) * taper;
      const rim = (2.2 + 2.6 * (0.5 + 0.5 * noise1(s / 17, sd + 2)) + r() * 1.2) * taper;
      outer.push([x + nx * d, y + ny * d]);
      inner.push([x + nx * (d - rim), y + ny * (d - rim)]);
    }
  }
  return { outer, inner };
}

/**
 * A torn sheet of paper (ochre or zebra) with a pale fibre rim, tooth, an ink
 * compass sketch and light falloff. Built once per theme, spec and scale.
 */
export function fnTorn(theme: Theme, spec: TornSpec, dev: number) {
  const P = fnPalette(theme);
  const q = Math.max(0.25, Math.round(dev * 4) / 4);
  return once(`fn-torn:${spec.key}:${spec.tone}:${P.ochre}:${P.night}:${q}`, () => {
    const xs = spec.pts.map((p) => p[0]);
    const ys = spec.pts.map((p) => p[1]);
    const pad = 16;
    const x0 = Math.min(...xs) - pad;
    const y0 = Math.min(...ys) - pad;
    const x1 = Math.max(...xs) + pad;
    const y1 = Math.max(...ys) + pad;
    const w = x1 - x0;
    const h = y1 - y0;
    const cv = makeCanvas(w * q, h * q);
    const x = context(cv);
    x.scale(q, q);
    x.translate(-x0, -y0);
    x.lineCap = "round";
    x.lineJoin = "round";
    const { outer, inner } = tornOutline(spec);
    const poly = (p: Pt[]) => {
      x.beginPath();
      p.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
      x.closePath();
    };
    x.save();
    x.shadowColor = "rgba(0,0,0,0.55)";
    x.shadowBlur = 18 * q;
    x.shadowOffsetY = 6 * q;
    poly(outer);
    x.fillStyle = mix(P.night, "#1a1510", 0.6);
    x.fill();
    x.restore();
    const rimTone =
      spec.tone === "zebra" ? mix(P.moon, "#ffffff", 0.2) : mix(P.ochre, "#f6ecd6", 0.72);
    poly(outer);
    x.fillStyle = rimTone;
    x.fill();
    x.save();
    poly(inner);
    x.clip();
    x.fillStyle = spec.tone === "zebra" ? mix(P.moon, "#ffffff", 0.15) : P.ochre;
    x.fillRect(x0, y0, w, h);
    if (spec.tone === "zebra") {
      x.save();
      x.translate(x0 + w / 2, y0 + h / 2);
      x.rotate(0.42);
      x.fillStyle = mix(P.night, "#17150f", 0.5);
      for (let i = -40; i < 40; i++) {
        const sx = i * 26 + noise1(i * 0.7, spec.seed) * 3;
        x.beginPath();
        for (let k = 0; k <= 30; k++)
          x.lineTo(sx + noise1(i * 3.1 + k * 0.4, spec.seed + 3) * 2.2, -900 + k * 60);
        for (let k = 30; k >= 0; k--)
          x.lineTo(sx + 12.5 + noise1(i * 5.3 + k * 0.4, spec.seed + 4) * 2.2, -900 + k * 60);
        x.closePath();
        x.fill();
      }
      x.restore();
    }
    // Tooth, blotches and fibres at device resolution.
    const W2 = cv.width;
    const H2 = cv.height;
    const im = x.getImageData(0, 0, W2, H2);
    const d = im.data;
    const rr = rng(spec.seed * 7 + 1);
    const blot = spec.tone === "zebra" ? 0.05 : 0.1;
    for (let j = 0; j < H2; j++)
      for (let i = 0; i < W2; i++) {
        const o = (i + j * W2) * 4;
        if (d[o + 3] === 0) continue;
        const u = x0 + i / q;
        const v = y0 + j / q;
        const k =
          1 +
          fbm3(u / 90, v / 90, spec.seed, 3) * blot +
          noise3(u / 3.2, v / 14, spec.seed + 2) * 0.035 +
          (rr() - 0.5) * 0.07;
        d[o] = clamp(d[o] * k, 0, 255);
        d[o + 1] = clamp(d[o + 1] * k, 0, 255);
        d[o + 2] = clamp(d[o + 2] * k, 0, 255);
      }
    x.putImageData(im, 0, 0);
    // Ink sketch: compass arcs, radials, ticks, a pinned centre.
    if (spec.sketch) {
      const r = rng(spec.seed * 5 + 3);
      const [cx, cy] = spec.sketch;
      x.strokeStyle = rgba(P.inkOnPaper, 0.72);
      x.fillStyle = rgba(P.inkOnPaper, 0.8);
      x.lineWidth = 1.35;
      for (let k = 0; k < 4; k++) {
        const rad = 40 + k * 34 + r() * 16;
        const a0 = r() * TAU;
        x.beginPath();
        x.arc(cx, cy, rad, a0, a0 + 1.6 + r() * 2.8);
        x.stroke();
      }
      x.lineWidth = 1.05;
      for (let k = 0; k < 7; k++) {
        const a = r() * TAU;
        const r0 = 10 + r() * 20;
        const r1 = 120 + r() * 140;
        x.beginPath();
        x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        x.stroke();
      }
      const tr = 96 + r() * 30;
      const ta = r() * TAU;
      for (let k = 0; k < 16; k++) {
        const a = ta + k * 0.07;
        const l = k % 4 === 0 ? 11 : 6;
        x.beginPath();
        x.moveTo(cx + Math.cos(a) * tr, cy + Math.sin(a) * tr);
        x.lineTo(cx + Math.cos(a) * (tr + l), cy + Math.sin(a) * (tr + l));
        x.stroke();
      }
      x.beginPath();
      x.arc(cx, cy, 5, 0, TAU);
      x.stroke();
      x.beginPath();
      x.arc(cx, cy, 1.8, 0, TAU);
      x.fill();
    }
    const dim = spec.dim ?? 0.22;
    const lg = x.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, `rgba(10,8,6,${dim * 0.15})`);
    lg.addColorStop(1, `rgba(10,8,6,${dim})`);
    x.fillStyle = lg;
    x.fillRect(x0, y0, w, h);
    x.restore();
    x.strokeStyle = rgba(mix(P.moon, "#ffffff", 0.3), 0.55);
    x.lineWidth = 0.6;
    const rr2 = rng(spec.seed + 77);
    for (let k = 0; k < outer.length; k += 9) {
      if (rr2() < 0.5) continue;
      const [a, b] = outer[k];
      const ang = rr2() * TAU;
      const l = 2 + rr2() * 5;
      x.beginPath();
      x.moveTo(a, b);
      x.lineTo(a + Math.cos(ang) * l, b + Math.sin(ang) * l);
      x.stroke();
    }
    return { cv, x0, y0, w, h };
  });
}

/** Draw a torn sheet with its origin at (ox, oy) and scale s (design px -> canvas px). */
export function drawTorn(
  ctx: Ctx2D,
  theme: Theme,
  spec: TornSpec,
  ox: number,
  oy: number,
  s: number,
  rot = 0,
) {
  const t = fnTorn(theme, spec, s);
  ctx.save();
  ctx.translate(ox, oy);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(t.cv as CanvasImageSource, t.x0 * s, t.y0 * s, t.w * s, t.h * s);
  ctx.restore();
}

// ── ink ──────────────────────────────────────────────────────────────────
const lengths = new WeakMap<Pt[], number[]>();
function lens(pts: Pt[]) {
  let L = lengths.get(pts);
  if (!L) {
    L = [0];
    for (let i = 1; i < pts.length; i++)
      L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    lengths.set(pts, L);
  }
  return L;
}

/** Point and angle at fraction f along a path. */
export function at(pts: Pt[], f: number): [number, number, number] {
  const L = lens(pts);
  const T = L[L.length - 1] * clamp(f);
  let lo = 0;
  let hi = L.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (L[m] < T) lo = m;
    else hi = m;
  }
  const seg = L[hi] - L[lo] || 1;
  const u = (T - L[lo]) / seg;
  return [
    lerp(pts[lo][0], pts[hi][0], u),
    lerp(pts[lo][1], pts[hi][1], u),
    Math.atan2(pts[hi][1] - pts[lo][1], pts[hi][0] - pts[lo][0]),
  ];
}

/** Trace the part of a path between fractions a..b into the current path. */
export function trace(ctx: Ctx2D, pts: Pt[], a = 0, b = 1) {
  a = clamp(a);
  b = clamp(b);
  if (b <= a) return false;
  const L = lens(pts);
  const T = L[L.length - 1];
  const sa = a * T;
  const sb = b * T;
  let started = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = L[i];
    const l1 = L[i + 1];
    if (l1 < sa) continue;
    if (l0 > sb) break;
    const seg = l1 - l0 || 1;
    const u0 = clamp((sa - l0) / seg);
    const u1 = clamp((sb - l0) / seg);
    if (!started) {
      ctx.moveTo(lerp(pts[i][0], pts[i + 1][0], u0), lerp(pts[i][1], pts[i + 1][1], u0));
      started = true;
    }
    ctx.lineTo(lerp(pts[i][0], pts[i + 1][0], u1), lerp(pts[i][1], pts[i + 1][1], u1));
  }
  return started;
}

export function ink(
  ctx: Ctx2D,
  pts: Pt[],
  o: { from?: number; to?: number; color: string; w: number; alpha?: number; dash?: number[] },
) {
  const a = o.from ?? 0;
  const b = o.to ?? 1;
  if (b <= a) return;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.lineWidth = o.w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (o.dash) ctx.setLineDash(o.dash);
  ctx.beginPath();
  trace(ctx, pts, a, b);
  ctx.stroke();
  ctx.restore();
}

/** Hand wobble: offsets along normals by seeded noise (static per path). */
export function wob(pts: Pt[], amp: number, seed: number, freq: number): Pt[] {
  const L = lens(pts);
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const d = noise1(L[i] / freq, seed) * amp + noise1(L[i] / (freq * 0.23), seed + 1) * amp * 0.35;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d] as Pt;
  });
}

export const line = (x0: number, y0: number, x1: number, y1: number, step = 6): Pt[] => {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => [lerp(x0, x1, i / n), lerp(y0, y1, i / n)] as Pt);
};

export const arcPts = (
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  step = 6,
): Pt[] => {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = lerp(a0, a1, i / n);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
};

/** Rounded rectangle path, clockwise from the top-left straight edge. */
export function rrect(x: number, y: number, w: number, h: number, r: number, step = 6): Pt[] {
  r = Math.min(r, w / 2, h / 2);
  const out: Pt[] = [];
  const add = (a: Pt[]) => {
    for (const q of a) {
      const l = out[out.length - 1];
      if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 0.01) out.push(q);
    }
  };
  add(line(x + r, y, x + w - r, y, step));
  add(arcPts(x + w - r, y + r, r, -Math.PI / 2, 0, step));
  add(line(x + w, y + r, x + w, y + h - r, step));
  add(arcPts(x + w - r, y + h - r, r, 0, Math.PI / 2, step));
  add(line(x + w - r, y + h, x + r, y + h, step));
  add(arcPts(x + r, y + h - r, r, Math.PI / 2, Math.PI, step));
  add(line(x, y + h - r, x, y + r, step));
  add(arcPts(x + r, y + r, r, Math.PI, Math.PI * 1.5, step));
  return out;
}

/** The one warm point that does the work: a glowing clay nib. */
export function nib(ctx: Ctx2D, theme: Theme, x: number, y: number, a: number, r: number) {
  if (a <= 0) return;
  const P = fnPalette(theme);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
  g.addColorStop(0, rgba(mix(P.clay, "#ffffff", 0.35), 0.55 * a));
  g.addColorStop(0.25, rgba(P.clay, 0.28 * a));
  g.addColorStop(1, rgba(P.clay, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = mix(P.clay, "#ffffff", 0.8);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ── type ─────────────────────────────────────────────────────────────────
const SERIF_STACK = '"Iowan Old Style", Charter, Georgia, serif';

/** Serif set at 36px and scaled, so the optical size stays at opsz 36 at every size. */
export function serif(
  ctx: Ctx2D,
  family: string,
  str: string,
  x: number,
  y: number,
  size: number,
  o: {
    color: string;
    align?: CanvasTextAlign;
    alpha?: number;
    weight?: number;
    italic?: boolean;
  } = { color: "#fff" },
) {
  ctx.save();
  ctx.translate(x, y);
  const k = size / 36;
  ctx.scale(k, k);
  ctx.font = `${o.italic ? "italic " : ""}${o.weight ?? 500} 36px "${family}", ${SERIF_STACK}`;
  ctx.letterSpacing = `${(-0.018 * 36).toFixed(3)}px`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = o.color;
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

export function serifWidth(ctx: Ctx2D, family: string, str: string, size: number, weight = 500) {
  ctx.save();
  ctx.font = `${weight} 36px "${family}", ${SERIF_STACK}`;
  ctx.letterSpacing = `${(-0.018 * 36).toFixed(3)}px`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return (w * size) / 36;
}

/** The corner collage every Field Notes frame carries: ochre scrap top-right, zebra strip bottom-left. */
export function collage(ctx: Ctx2D, theme: Theme, f: FnFrame, t: number) {
  const s = f.s;
  const drift = Math.sin(TAU * (t / 5)) * 3 * s;
  const ochre = s * (f.portrait ? 0.62 : 0.72);
  drawTorn(
    ctx,
    theme,
    {
      key: "corner-ochre",
      pts: [
        [0, 0],
        [430, 0],
        [430, 250],
        [150, 330],
        [0, 190],
      ],
      torn: [false, false, true, true, true],
      tone: "ochre",
      seed: 4,
      sketch: [300, 90],
    },
    f.w - 430 * ochre,
    -24 * ochre + drift,
    ochre,
  );
  drawTorn(
    ctx,
    theme,
    {
      key: "corner-zebra",
      pts: [
        [0, 0],
        [120, 20],
        [150, 260],
        [20, 250],
      ],
      tone: "zebra",
      seed: 9,
      sketch: null,
      dim: 0.35,
    },
    -30 * s,
    f.h - 300 * s - drift,
    s * (f.portrait ? 0.9 : 1),
    -0.08,
  );
}
