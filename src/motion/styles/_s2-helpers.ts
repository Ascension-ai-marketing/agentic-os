/**
 * Shared helpers for the "Paint and draw" styles (builder s2): hand-drawn
 * paths, pressure ribbons, paper tiles, tileable fields and text outlines.
 * Everything is pure or deterministic-cached, like the kit, so a style built
 * from these stays a pure function of t.
 */
import { rgba } from "../engine/color";
import {
  clamp,
  context,
  fbm3,
  fract,
  lerp,
  LOOP,
  makeCanvas,
  noise3,
  once,
  rng,
  TAU,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D } from "../engine/types";

export type Pt = [number, number];

// ── time ─────────────────────────────────────────────────────────────────
/** Frame number inside the loop at `fps` (12 = animating on twos). */
export const frameIndex = (t: number, fps = 12) => Math.floor(fract(t / LOOP) * LOOP * fps + 1e-6);
/** t snapped to whole frames at `fps`. */
export const stepTime = (t: number, fps = 12) => frameIndex(t, fps) / fps;

// ── paths ────────────────────────────────────────────────────────────────
/** Cumulative arc length at each point. */
export function lengths(pts: Pt[]): number[] {
  const out = new Array<number>(pts.length);
  out[0] = 0;
  for (let i = 1; i < pts.length; i++)
    out[i] = out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return out;
}

/** Point and heading at arc length d along a polyline. */
export function pointAt(pts: Pt[], cum: number[], d: number) {
  const last = cum.length - 1;
  const dd = clamp(d, 0, cum[last]);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dd) lo = mid;
    else hi = mid;
  }
  if (hi === lo) hi = Math.min(last, lo + 1);
  const span = cum[hi] - cum[lo] || 1;
  const f = (dd - cum[lo]) / span;
  const [x0, y0] = pts[lo];
  const [x1, y1] = pts[hi];
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a: Math.atan2(y1 - y0, x1 - x0) };
}

/** The first fraction p (by length) of a polyline. */
export function headOf(pts: Pt[], p: number, cum?: number[]): Pt[] {
  if (pts.length < 2 || p <= 0) return [];
  if (p >= 1) return pts;
  const c = cum ?? lengths(pts);
  const L = c[c.length - 1] * p;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (c[i] <= L) out.push(pts[i]);
    else {
      const f = (L - c[i - 1]) / (c[i] - c[i - 1] || 1);
      out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]);
      break;
    }
  }
  return out;
}

export function tracePts(c: Ctx2D, pts: Pt[], close = false) {
  if (!pts.length) return;
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  if (close) c.closePath();
}

/** Stroke the first fraction p of a polyline with the current stroke style. */
export function strokePts(c: Ctx2D, pts: Pt[], p = 1) {
  const h = headOf(pts, p);
  if (h.length < 2) return;
  c.beginPath();
  tracePts(c, h);
  c.stroke();
}

/** Catmull-Rom spline through control points. */
export function spline(ctrl: Pt[], per = 10, closed = false): Pt[] {
  const n = ctrl.length;
  if (n < 3) return ctrl.slice();
  const get = (i: number): Pt =>
    closed ? ctrl[((i % n) + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))];
  const out: Pt[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(closed ? out[0] : ctrl[n - 1]);
  return out;
}

/** A hand-drawn straight line: a slight bow plus a smooth tremor. */
export function handLine(a: Pt, b: Pt, seed: number, tremor: number, n = 14, bow = 0.02): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const bend = (fract(Math.sin(seed * 91.7) * 43758.5453) - 0.5) * 2 * bow * L;
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const off = Math.sin(k * Math.PI) * bend + tremor * noise3(k * 2.6, seed * 0.173, 0.37);
    out.push([a[0] + dx * k + nx * off, a[1] + dy * k + ny * off]);
  }
  return out;
}

/** A hand-drawn ellipse that starts at `start`, runs a little past a full turn and drifts. */
export function handEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  wobble = 0.03,
  n = 72,
  start = -2.4,
  turns = 1.06,
  rot = 0,
): Pt[] {
  const out: Pt[] = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const a = start + k * turns * TAU;
    const w = 1 + wobble * noise3(k * 3.1, seed * 0.29, 0.61) + wobble * 0.8 * k;
    const x = Math.cos(a) * rx * w;
    const y = Math.sin(a) * ry * w;
    out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return out;
}

/** Offset every point by a small hash jitter (line boil); `frame` picks the drawing. */
export function boil(pts: Pt[], frame: number, amp: number, seed: number): Pt[] {
  const out: Pt[] = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const jx = noise3(i * 0.31, frame * 1.37 + 0.5, seed * 0.11) * amp;
    const jy = noise3(i * 0.31 + 17.3, frame * 1.37 + 0.5, seed * 0.11) * amp;
    out[i] = [pts[i][0] + jx, pts[i][1] + jy];
  }
  return out;
}

/**
 * Fill a stroke of varying width along a polyline (a brush or pen under
 * pressure). width(k) gets the position 0..1 along the full path.
 */
export function ribbon(c: Ctx2D, pts: Pt[], width: (k: number) => number, p = 1) {
  const n = pts.length;
  if (n < 2 || p <= 0) return;
  const cum = lengths(pts);
  const L = cum[n - 1] || 1;
  const h = headOf(pts, p, cum);
  if (h.length < 2) return;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let d = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[Math.max(0, i - 1)];
    const b = h[Math.min(h.length - 1, i + 1)];
    if (i > 0) d += Math.hypot(h[i][0] - h[i - 1][0], h[i][1] - h[i - 1][1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const hw = Math.max(0, width(d / L)) / 2;
    left.push([h[i][0] - (dy / l) * hw, h[i][1] + (dx / l) * hw]);
    right.push([h[i][0] + (dy / l) * hw, h[i][1] - (dx / l) * hw]);
  }
  c.beginPath();
  c.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) c.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
  c.fill();
}

/** Pressure profile: soft landing, full body, lifting tail. */
export const pressure = (k: number, land = 0.12, lift = 0.25) =>
  Math.min(1, 0.25 + (0.75 * k) / land) * Math.min(1, 0.15 + (0.85 * (1 - k)) / lift);

// ── private sprite cache ─────────────────────────────────────────────────
const sprites = new Map<string, AnyCanvas>();
/**
 * Build a small sprite once and keep it in this module's own LRU, so many
 * sprites never evict the kit's shared bake/once caches other tiles rely on.
 */
export function sprite(
  key: string,
  w: number,
  h: number,
  draw: (c: Ctx2D, w: number, h: number) => void,
): AnyCanvas {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const id = `${key}@${W}x${H}`;
  let c = sprites.get(id);
  if (c) {
    sprites.delete(id);
    sprites.set(id, c);
    return c;
  }
  c = makeCanvas(W, H);
  draw(context(c), W, H);
  sprites.set(id, c);
  if (sprites.size > 1500) sprites.delete(sprites.keys().next().value as string);
  return c;
}

// ── tiles & textures ─────────────────────────────────────────────────────
/** Dark speckles on transparent: paper tooth, dropout, granulation. */
export function speckleTile(
  seed: number,
  size = 256,
  count = 2400,
  aMin = 0.3,
  aMax = 1,
  sMin = 0.6,
  sMax = 2.4,
): AnyCanvas {
  return once(`s2-speckle:${seed}:${size}:${count}:${aMin}:${aMax}:${sMin}:${sMax}`, () => {
    const c = makeCanvas(size, size);
    const g = context(c);
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      g.fillStyle = `rgba(0,0,0,${(aMin + r() * (aMax - aMin)).toFixed(3)})`;
      const s = sMin + r() * r() * (sMax - sMin);
      const x = r() * size;
      const y = r() * size;
      // Draw wrapped copies so the tile repeats without a seam.
      for (const ox of [-size, 0, size])
        for (const oy of [-size, 0, size]) {
          if (x + ox < -s || x + ox > size + s || y + oy < -s || y + oy > size + s) continue;
          g.beginPath();
          g.ellipse(x + ox, y + oy, s, s * (0.55 + r() * 0.45), r() * TAU, 0, TAU);
          g.fill();
        }
    }
    return c;
  });
}

/**
 * Tileable fractal-noise tile as colour + alpha: value v in -1..1 maps to
 * alpha max(0, bias + gain * v). Periodic, so it repeats without a seam.
 */
export function noiseTile(
  seed: number,
  size = 256,
  freq = 6,
  octaves = 4,
  gain = 1,
  bias = 0,
  color = "#000000",
): AnyCanvas {
  return once(`s2-noise:${seed}:${size}:${freq}:${octaves}:${gain}:${bias}:${color}`, () => {
    const c = makeCanvas(size, size);
    const g = context(c);
    const img = g.createImageData(size, size);
    const [cr, cg, cb] = parseRgb(color);
    const z = seed * 0.713;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = fbm3((x / size) * freq, (y / size) * freq, z, octaves, freq, freq, 0);
        const a = clamp(bias + gain * v);
        const o = (y * size + x) * 4;
        img.data[o] = cr;
        img.data[o + 1] = cg;
        img.data[o + 2] = cb;
        img.data[o + 3] = Math.round(a * 255);
      }
    g.putImageData(img, 0, 0);
    return c;
  });
}

function parseRgb(color: string): [number, number, number] {
  const m = rgba(color, 1).match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}

/** Fill a rect with a repeating tile at a scale and offset. */
export function tileFill(
  c: Ctx2D,
  tile: AnyCanvas,
  w: number,
  h: number,
  scale = 1,
  alpha = 1,
  op: GlobalCompositeOperation = "source-over",
  ox = 0,
  oy = 0,
) {
  const pat = c.createPattern(tile as CanvasImageSource, "repeat");
  if (!pat) return;
  if (typeof DOMMatrix !== "undefined")
    pat.setTransform(new DOMMatrix().translateSelf(ox, oy).scaleSelf(scale));
  c.save();
  c.globalCompositeOperation = op;
  c.globalAlpha = alpha;
  c.fillStyle = pat;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/**
 * A periodic fbm field for fast per-pixel lookups, normalised to zero mean and
 * a standard deviation of 0.35 (so values sit roughly in -1..1).
 */
export function fieldTile(seed: number, size = 256, freq = 8, octaves = 3): Float32Array {
  return once(`s2-field:${seed}:${size}:${freq}:${octaves}`, () => {
    const out = new Float32Array(size * size);
    const z = seed * 0.531;
    let sum = 0;
    let sq = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = fbm3((x / size) * freq, (y / size) * freq, z, octaves, freq, freq, 0);
        out[y * size + x] = v;
        sum += v;
        sq += v * v;
      }
    const n = size * size;
    const mean = sum / n;
    const std = Math.sqrt(Math.max(1e-9, sq / n - mean * mean));
    for (let i = 0; i < n; i++) out[i] = ((out[i] - mean) / std) * 0.35;
    return out;
  });
}

/** Bilinear lookup into a field tile, wrapping at the edges. */
export function sampleField(tex: Float32Array, size: number, x: number, y: number): number {
  const fx = ((x % size) + size) % size;
  const fy = ((y % size) + size) % size;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 === size ? 0 : x0 + 1;
  const y1 = y0 + 1 === size ? 0 : y0 + 1;
  const tx = fx - x0;
  const ty = fy - y0;
  const r0 = y0 * size;
  const r1 = y1 * size;
  const a = tex[r0 + x0] + (tex[r0 + x1] - tex[r0 + x0]) * tx;
  const b = tex[r1 + x0] + (tex[r1 + x1] - tex[r1 + x0]) * tx;
  return a + (b - a) * ty;
}

/** Mottled wash: coarse fbm blotches of `color` over a rect (bake-time only). */
export function mottle(
  c: Ctx2D,
  w: number,
  h: number,
  color: string,
  base: number,
  amount: number,
  scale: number,
  step: number,
  z = 3.1,
) {
  const s = Math.max(2, Math.round(step));
  for (let y = 0; y < h; y += s)
    for (let x = 0; x < w; x += s) {
      const n = fbm3(x / scale, y / scale, z, 3);
      const a = base + amount * n;
      if (a <= 0.002) continue;
      c.fillStyle = rgba(color, a);
      c.fillRect(x, y, s, s);
    }
}

/** Paper fibres: short curved hairs (bake-time only). */
export function fibres(
  c: Ctx2D,
  w: number,
  h: number,
  u: number,
  color: string,
  count: number,
  seed: number,
  alpha = 0.04,
  length = 0.06,
) {
  const r = rng(seed);
  c.save();
  c.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    const len = u * length * (0.3 + r());
    const a = r() * TAU;
    c.strokeStyle = rgba(color, alpha * (0.4 + r()));
    c.lineWidth = Math.max(0.5, u * 0.0007);
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(
      x + Math.cos(a + 0.7) * len * 0.5,
      y + Math.sin(a + 0.7) * len * 0.5,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    c.stroke();
  }
  c.restore();
}

// ── type ─────────────────────────────────────────────────────────────────
/** Largest font size (<= max) at which `text` fits inside maxW. */
export function fitFont(
  c: Ctx2D,
  text: string,
  maxW: number,
  max: number,
  css: (size: number) => string,
): number {
  c.font = css(max);
  const width = c.measureText(text).width || 1;
  return Math.min(max, (max * maxW) / width);
}

export interface Outline {
  /** Closed contour loops in px, x from 0 at the text's left edge, y = 0 on the baseline. */
  loops: Pt[][];
  width: number;
  ascent: number;
  descent: number;
}

/**
 * Outline a line of text as closed polylines (marching squares over a
 * rasterised copy), so a pen can trace the letters. Loops come ordered left to
 * right, outer contour before its counters. Deterministic; cache the result.
 */
export function textOutline(text: string, css: string, px: number, detail = 1): Outline {
  const probe = context(makeCanvas(8, 8));
  probe.font = css;
  const m = probe.measureText(text);
  const ascent = Math.ceil(m.actualBoundingBoxAscent || px * 0.8);
  const descent = Math.ceil(m.actualBoundingBoxDescent || px * 0.2);
  const left = Math.ceil(m.actualBoundingBoxLeft || 0);
  const pad = Math.ceil(px * 0.1) + 2;
  const W = Math.ceil((m.actualBoundingBoxRight || m.width) + left) + pad * 2;
  const H = ascent + descent + pad * 2;
  const canvas = makeCanvas(W, H);
  const g = context(canvas);
  g.font = css;
  g.fillStyle = "#000";
  g.textBaseline = "alphabetic";
  g.fillText(text, pad + left, pad + ascent);
  const data = g.getImageData(0, 0, W, H).data;
  const A = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) A[i] = data[i * 4 + 3] / 255;
  const iso = 0.5;
  // Edge point ids: horizontal edge (x,y)-(x+1,y) -> 2*(y*W+x); vertical (x,y)-(x,y+1) -> 2*(y*W+x)+1.
  const segs: number[] = [];
  const edgePoint = (id: number): Pt => {
    const cell = id >> 1;
    const x = cell % W;
    const y = (cell - x) / W;
    if ((id & 1) === 0) {
      const a = A[y * W + x];
      const b = A[y * W + x + 1];
      const f = b === a ? 0.5 : clamp((iso - a) / (b - a));
      return [x + f, y];
    }
    const a = A[y * W + x];
    const b = A[(y + 1) * W + x];
    const f = b === a ? 0.5 : clamp((iso - a) / (b - a));
    return [x, y + f];
  };
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const tl = A[y * W + x] > iso ? 8 : 0;
      const tr = A[y * W + x + 1] > iso ? 4 : 0;
      const br = A[(y + 1) * W + x + 1] > iso ? 2 : 0;
      const bl = A[(y + 1) * W + x] > iso ? 1 : 0;
      const idx = tl | tr | br | bl;
      if (idx === 0 || idx === 15) continue;
      const top = 2 * (y * W + x);
      const bottom = 2 * ((y + 1) * W + x);
      const lft = 2 * (y * W + x) + 1;
      const rgt = 2 * (y * W + x + 1) + 1;
      switch (idx) {
        case 1:
        case 14:
          segs.push(lft, bottom);
          break;
        case 2:
        case 13:
          segs.push(bottom, rgt);
          break;
        case 3:
        case 12:
          segs.push(lft, rgt);
          break;
        case 4:
        case 11:
          segs.push(top, rgt);
          break;
        case 5:
          segs.push(lft, top, bottom, rgt);
          break;
        case 6:
        case 9:
          segs.push(top, bottom);
          break;
        case 7:
        case 8:
          segs.push(lft, top);
          break;
        case 10:
          segs.push(top, rgt, lft, bottom);
          break;
      }
    }
  // Link segments into loops.
  const adj = new Map<number, number[]>();
  const nSeg = segs.length / 2;
  for (let s = 0; s < nSeg; s++)
    for (const e of [segs[2 * s], segs[2 * s + 1]]) {
      const list = adj.get(e);
      if (list) list.push(s);
      else adj.set(e, [s]);
    }
  const used = new Uint8Array(nSeg);
  const raw: Pt[][] = [];
  for (let s = 0; s < nSeg; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segs[2 * s];
    let cur = segs[2 * s + 1];
    const loop: Pt[] = [edgePoint(start), edgePoint(cur)];
    for (let guard = 0; guard < nSeg && cur !== start; guard++) {
      const next = (adj.get(cur) || []).find((q) => !used[q]);
      if (next === undefined) break;
      used[next] = 1;
      cur = segs[2 * next] === cur ? segs[2 * next + 1] : segs[2 * next];
      loop.push(edgePoint(cur));
    }
    if (loop.length > 8) raw.push(loop);
  }
  const eps = 0.45 / Math.max(0.25, detail);
  const loops = raw
    .map((l) => simplify(l, eps).map(([x, y]) => [x - pad - left, y - pad - ascent] as Pt))
    .map((l) => ({ l, minX: Math.min(...l.map((p) => p[0])), area: Math.abs(areaOf(l)) }))
    .sort((a, b) => a.minX - b.minX || b.area - a.area)
    .map((o) => o.l);
  return { loops, width: m.width, ascent, descent };
}

function areaOf(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

/** Ramer-Douglas-Peucker simplification (keeps closed loops closed). */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  // A closed loop has equal ends; split it at the farthest point first.
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  if (far > 0) {
    keep[far] = 1;
    stack.pop();
    stack.push([0, far], [far, pts.length - 1]);
  }
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy) || 1;
    let idx = -1;
    let dmax = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting: rounder hand-drawn loops. */
export function chaikin(pts: Pt[], iterations = 1, closed = true): Pt[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    const n = cur.length - (closed ? 1 : 0);
    for (let i = 0; i < n - (closed ? 0 : 1); i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (closed && out.length) out.push(out[0]);
    cur = out;
  }
  return cur;
}
