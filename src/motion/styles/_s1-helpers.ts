/**
 * Shared helpers for builder 1's Print & craft styles (letterpress, linocut,
 * woodcut, screenprint, cyanotype, collage-cutout, origami-fold, rubber-stamp,
 * washi-scrapbook, torn-poster, embroidery). Pure or deterministic-cached only:
 * everything is seeded, nothing reads the clock.
 */
import { rgba } from "../engine/color";
import {
  context,
  fbm3,
  fract,
  frameOf,
  hash,
  lerp,
  LOOP,
  makeCanvas,
  rng,
  TAU,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D, Theme } from "../engine/types";

export type Pt = [number, number];

/** Loop time held on printed frames (stop-motion): the frame index and its time. */
export function stepped(t: number, fps: number) {
  const frame = Math.floor(fract(t / LOOP) * LOOP * fps + 1e-6);
  return { frame, tq: frame / fps };
}

/** The box a style's visual should fill: the frame minus calm margins. */
export function stageOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const mx = w * (portrait ? 0.075 : square ? 0.07 : 0.075);
  const my = h * (portrait ? 0.07 : square ? 0.07 : 0.095);
  return { x: mx, y: my, w: w - mx * 2, h: h - my * 2, cx: w / 2, cy: h / 2 };
}

// ── ink textures ─────────────────────────────────────────────────────────
const tiles = new Map<string, AnyCanvas>();
/**
 * A 256 px tile of dark specks (alpha only), for knocking holes in an ink layer
 * with destination-out. `count` specks, radius up to `max` px, seeded.
 */
export function speckTile(seed: number, count = 2200, max = 1.8, elongate = 1): AnyCanvas {
  const key = `${seed}|${count}|${max}|${elongate}`;
  let c = tiles.get(key);
  if (c) return c;
  const size = 256;
  c = makeCanvas(size, size);
  const g = context(c);
  const r = rng(seed);
  for (let k = 0; k < count; k++) {
    g.fillStyle = `rgba(0,0,0,${(0.3 + r() * 0.7).toFixed(3)})`;
    const s = 0.5 + r() * r() * max;
    const x = r() * size;
    const y = r() * size;
    const rot = r() * TAU;
    const reach = s * Math.max(1, elongate) + 1;
    // Wrap copies near the edges so the tile repeats without a seam.
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const px = x + ox;
        const py = y + oy;
        if (px < -reach || px > size + reach || py < -reach || py > size + reach) continue;
        g.beginPath();
        g.ellipse(px, py, s * elongate, s, rot, 0, TAU);
        g.fill();
      }
  }
  tiles.set(key, c);
  return c;
}

/** A tileable soft mottle (alpha only), for uneven ink density. */
export function mottleTile(seed: number, scale = 4, contrast = 1): AnyCanvas {
  const key = `mottle|${seed}|${scale}|${contrast}`;
  let c = tiles.get(key);
  if (c) return c;
  const size = 256;
  c = makeCanvas(size, size);
  const g = context(c);
  const img = g.createImageData(size, size);
  const z = seed * 0.137;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = fbm3((x / size) * scale, (y / size) * scale, z, 3, scale, scale, 0);
      const a = Math.max(0, Math.min(1, 0.5 + n * contrast));
      const o = (y * size + x) * 4;
      img.data[o + 3] = Math.round(a * 255);
    }
  g.putImageData(img, 0, 0);
  tiles.set(key, c);
  return c;
}

/** Fill a layer with a repeating tile through `op`, scaled and offset (for ink holes, density). */
export function tileOver(
  layer: Ctx2D,
  w: number,
  h: number,
  tile: AnyCanvas,
  opts: { op?: GlobalCompositeOperation; alpha?: number; scale?: number; ox?: number; oy?: number },
) {
  const pat = layer.createPattern(tile as CanvasImageSource, "repeat");
  if (!pat) return;
  const k = opts.scale ?? 1;
  if (typeof DOMMatrix !== "undefined")
    pat.setTransform(new DOMMatrix().translateSelf(opts.ox ?? 0, opts.oy ?? 0).scaleSelf(k, k));
  layer.save();
  layer.globalCompositeOperation = opts.op ?? "destination-out";
  layer.globalAlpha = opts.alpha ?? 1;
  layer.fillStyle = pat;
  layer.fillRect(0, 0, w, h);
  layer.restore();
}

/** Recolour everything drawn on a layer to one flat colour, keeping its alpha. */
export function tintLayer(layer: Ctx2D, w: number, h: number, color: string) {
  layer.save();
  layer.globalCompositeOperation = "source-in";
  layer.globalAlpha = 1;
  layer.fillStyle = color;
  layer.fillRect(0, 0, w, h);
  layer.restore();
}

// ── paper ────────────────────────────────────────────────────────────────
/**
 * Bake function for a dark sheet of paper in the theme's ground: soft mottling,
 * long cotton fibres and fine specks. `tone` lifts the sheet toward ink.
 */
export function darkPaper(
  theme: Theme,
  seed: number,
  opts: { tone?: number; fibres?: number; mottle?: number; base?: string } = {},
) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = opts.base ?? theme.bg;
    c.fillRect(0, 0, w, h);
    const tone = opts.tone ?? 0;
    if (tone > 0) {
      c.fillStyle = rgba(theme.ink, tone);
      c.fillRect(0, 0, w, h);
    }
    const mottle = opts.mottle ?? 1;
    const step = Math.max(3, Math.round(u / 110));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.3), y / (u * 0.3), seed * 0.31, 3);
        c.fillStyle =
          n > 0 ? rgba(theme.ink, 0.03 * n * mottle) : rgba("#000000", -0.12 * n * mottle);
        c.fillRect(x, y, step, step);
      }
    const r = rng(seed * 7 + 1);
    const count = Math.round(((opts.fibres ?? 1) * (w * h)) / 2600);
    c.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const x = r() * w;
      const y = r() * h;
      const len = u * (0.008 + r() * r() * 0.05);
      const a = r() * TAU;
      c.strokeStyle = r() < 0.6 ? rgba(theme.ink, 0.025 + r() * 0.05) : rgba("#000000", 0.12);
      c.lineWidth = Math.max(0.5, u * (0.0004 + r() * 0.0006));
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
      c.fillStyle = r() < 0.5 ? rgba(theme.ink, 0.03 + r() * 0.04) : rgba("#000000", 0.18);
      const s = Math.max(0.6, u * 0.0012 * (0.5 + r()));
      c.fillRect(r() * w, r() * h, s, s);
    }
  };
}

// ── edges and paths ──────────────────────────────────────────────────────
/** A torn, fibrous line from a to b (endpoints fixed): jagged, seeded. */
export function tornLine(a: Pt, b: Pt, seed: number, amp: number, step: number): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(len / Math.max(0.5, step)));
  const nx = -(b[1] - a[1]) / (len || 1);
  const ny = (b[0] - a[0]) / (len || 1);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const env = Math.min(1, Math.min(f, 1 - f) * 8);
    const low = fbm3(f * len * 0.02 + seed * 3.7, seed * 1.3, 0.5, 3) * 2.2;
    const high = (hash(i, seed, 77) - 0.5) * 0.9;
    const d = amp * env * (low + high);
    out.push([lerp(a[0], b[0], f) + nx * d, lerp(a[1], b[1], f) + ny * d]);
  }
  return out;
}

/** A scissor-cut quad around a box: straight cuts, slightly off square. */
export function scissorQuad(
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  jitter: number,
): Pt[] {
  const j = (i: number) => (hash(seed, i, 5) - 0.5) * 2 * jitter;
  return [
    [x + j(1), y + j(2)],
    [x + w + j(3), y + j(4)],
    [x + w + j(5), y + h + j(6)],
    [x + j(7), y + h + j(8)],
  ];
}

export function polyPath(c: Ctx2D, pts: Pt[], close = true) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  if (close) c.closePath();
}

/** Cumulative lengths of a polyline. */
export function lengths(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++)
    out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** Point and heading at arc length s along a polyline. */
export function pointAt(pts: Pt[], cum: number[], s: number): { x: number; y: number; a: number } {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (d - cum[lo]) / seg;
  const [x0, y0] = pts[lo];
  const [x1, y1] = pts[hi];
  return { x: lerp(x0, x1, f), y: lerp(y0, y1, f), a: Math.atan2(y1 - y0, x1 - x0) };
}

/** Run `draw` with a soft drop shadow. */
export function withShadow(
  c: Ctx2D,
  blur: number,
  dx: number,
  dy: number,
  color: string,
  draw: () => void,
) {
  c.save();
  c.shadowColor = color;
  c.shadowBlur = Math.max(0, blur);
  c.shadowOffsetX = dx;
  c.shadowOffsetY = dy;
  draw();
  c.restore();
}
