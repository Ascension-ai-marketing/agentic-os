/**
 * Shared helpers for builder 8's Type & editorial styles: loop time, the safe
 * stage box, kerned type setting, orphan-free line breaking, early loading of
 * faces the engine does not preload (italics, variable-width instances) and a
 * baked dark stock. Pure or deterministic-cached, like the kit.
 */
import { luminance, mix, rgba } from "../engine/color";
import { bake, clamp, ease, fbm3, font, frameOf, fract, LOOP, rng, SANS, TAU } from "../engine/kit";
import type { Ctx2D, Theme } from "../engine/types";

/** Loop-local time: 0 <= t < LOOP, with t = LOOP mapped to 0 (so the loop closes). */
export const loopT = (t: number) => fract(t / LOOP) * LOOP;

/** Piecewise keyframes [[t, v], ...], eased per segment, clamped at both ends. */
export function keyed(t: number, frames: [number, number][], e = ease.inOutCubic): number {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i];
    if (t <= t1) {
      const [t0, v0] = frames[i - 1];
      const k = t1 > t0 ? e(clamp((t - t0) / (t1 - t0))) : 1;
      return v0 + (v1 - v0) * k;
    }
  }
  return frames[frames.length - 1][1];
}

// ── layout ───────────────────────────────────────────────────────────────
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The house stage for any aspect: side margins, a label band on top, a foot band. */
export function stageBox(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const mx = w * (portrait ? 0.08 : square ? 0.075 : 0.085);
  const top = h * (portrait ? 0.1 : square ? 0.13 : 0.16);
  const bottom = h * (portrait ? 0.92 : square ? 0.91 : 0.9);
  return { x: mx, y: top, w: w - mx * 2, h: bottom - top, label: top * 0.62 };
}

// ── type ─────────────────────────────────────────────────────────────────
type TypeCtx = Ctx2D & {
  letterSpacing: string;
  fontKerning: CanvasFontKerning;
  fontStretch: CanvasFontStretch;
};

export interface TypeOpts {
  fallback?: string;
  /** Tracking in em. */
  tracking?: number;
  stretch?: CanvasFontStretch;
  italic?: boolean;
}

/** Set a face with real kerning, tracking in em and an optional width keyword. */
export function setType(
  ctx: Ctx2D,
  weight: number | string,
  size: number,
  family: string,
  opts: TypeOpts = {},
) {
  const c = ctx as TypeCtx;
  c.font = (opts.italic ? "italic " : "") + font(weight, size, family, opts.fallback ?? SANS);
  c.fontKerning = "normal";
  c.fontStretch = opts.stretch ?? "normal";
  c.letterSpacing = `${((opts.tracking ?? 0) * size).toFixed(2)}px`;
}

/** Tracking currently set on ctx, in px. */
export const trackingOf = (ctx: Ctx2D) => parseFloat((ctx as TypeCtx).letterSpacing || "0") || 0;

/** Width of text as set, without the trailing letter-space tracking adds. */
export function widthOf(ctx: Ctx2D, text: string) {
  return ctx.measureText(text).width - (text ? trackingOf(ctx) : 0);
}

let epoch = 0;
if (typeof document !== "undefined" && document.fonts?.addEventListener)
  document.fonts.addEventListener("loadingdone", () => {
    epoch++;
  });
/** Bumped whenever a web font lands; add it to caches of measured text. */
export const typeEpoch = () => epoch;

const xsCache = new Map<string, number[]>();
/**
 * Kerned x offset of every glyph (and the end), measured from prefixes, so
 * letters animated one by one sit exactly where the shaped string puts them.
 */
export function glyphXs(ctx: Ctx2D, text: string): number[] {
  const c = ctx as TypeCtx;
  const key = `${epoch}|${c.font}|${c.letterSpacing}|${c.fontStretch}|${text}`;
  let xs = xsCache.get(key);
  if (!xs) {
    xs = [0];
    let acc = "";
    for (const ch of [...text]) {
      acc += ch;
      xs.push(ctx.measureText(acc).width);
    }
    if (xsCache.size > 600) xsCache.clear();
    xsCache.set(key, xs);
  }
  return xs;
}

/**
 * Greedy line breaking that never leaves one word alone on the last line:
 * if it would, a word moves down from the line above.
 */
export function breakLines(ctx: Ctx2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const word of words) {
    const next = [...cur, word].join(" ");
    if (cur.length && widthOf(ctx, next) > max) {
      lines.push(cur);
      cur = [word];
    } else cur.push(word);
  }
  if (cur.length) lines.push(cur);
  const n = lines.length;
  if (n >= 2 && lines[n - 1].length === 1 && lines[n - 2].length >= 2)
    lines[n - 1].unshift(lines[n - 2].pop() as string);
  return lines.map((l) => l.join(" "));
}

/**
 * Balanced display breaking: the fewest lines that fit, split so the longest
 * line is as short as possible, with at least two words on every line.
 */
export function balanceLines(ctx: Ctx2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const n = breakLines(ctx, text, max).length;
  if (n <= 1 || words.length < 2 * n) return breakLines(ctx, text, max);
  let best: string[] | null = null;
  let bestW = Infinity;
  const cut = (start: number, left: number, acc: string[]) => {
    if (left === 1) {
      const rest = words.slice(start);
      if (rest.length < 2) return;
      const lines = [...acc, rest.join(" ")];
      const worst = Math.max(...lines.map((l) => widthOf(ctx, l)));
      if (worst <= max * 1.001 && worst < bestW) {
        bestW = worst;
        best = lines;
      }
      return;
    }
    for (let end = start + 2; end <= words.length - 2 * (left - 1); end++)
      cut(end, left - 1, [...acc, words.slice(start, end).join(" ")]);
  };
  cut(0, n, []);
  return best ?? breakLines(ctx, text, max);
}

// ── faces the engine does not preload ────────────────────────────────────
const cssHref = (spec: string) =>
  `https://fonts.googleapis.com/css2?family=${spec.trim().replace(/ /g, "+")}&display=swap`;

const readyFaces = new Set<string>();
const injected = new Set<string>();
/**
 * The engine preloads each family's upright faces. Italics and other extra
 * faces start loading here, when the style module loads, so they are in
 * before frame 0. faceReady() says when one can be drawn.
 */
export function preloadFaces(spec: string, faces: string[]) {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const href = cssHref(spec);
  if (injected.has(href)) return;
  injected.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.onload = () => {
    for (const f of faces)
      document.fonts
        .load(f)
        .then((list) => {
          if (list.length) readyFaces.add(f);
        })
        .catch(() => undefined);
  };
  document.head.appendChild(link);
}
export const faceReady = (face: string) => readyFaces.has(face);

const stretchMaps = new Map<string, Map<number, string>>();
function latinUrl(css: string): string | null {
  for (const block of css.split("/*")) {
    if (!block.trim().startsWith("latin */")) continue;
    const m = block.match(/url\((https:[^)]+)\)/);
    if (m) return m[1];
  }
  const all = [...css.matchAll(/url\((https:[^)]+)\)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/**
 * Canvas can only ask for nine width keywords. For a smooth width axis, the
 * variable file is registered again as one face per width stop, each pinned
 * to that width by its font-stretch descriptor (the browser clamps wdth to it).
 */
export function preloadWidths(family: string, spec: string, stops: number[], weights = "100 900") {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  if (typeof fetch === "undefined" || stretchMaps.has(family)) return;
  const map = new Map<number, string>();
  stretchMaps.set(family, map);
  fetch(cssHref(spec))
    .then((r) => r.text())
    .then((css) => {
      const url = latinUrl(css);
      if (!url) return;
      for (const s of stops) {
        const name = `${family} W${Math.round(s * 10)}`;
        const face = new FontFace(name, `url(${url})`, { stretch: `${s}%`, weight: weights });
        document.fonts.add(face);
        face
          .load()
          .then(() => map.set(s, name))
          .catch(() => undefined);
      }
    })
    .catch(() => undefined);
}

const KEYWORDS: [number, CanvasFontStretch][] = [
  [50, "ultra-condensed"],
  [62.5, "extra-condensed"],
  [75, "condensed"],
  [87.5, "semi-condensed"],
  [100, "normal"],
  [112.5, "semi-expanded"],
  [125, "expanded"],
  [150, "extra-expanded"],
];

/**
 * The face (family + width keyword) that draws `family` at width `s`%.
 * Uses the pinned instance for the nearest stop once it has loaded, else the
 * nearest width keyword of the real family (exact at keyword widths).
 */
export function widthFace(
  family: string,
  s: number,
): { family: string; stretch: CanvasFontStretch } {
  const map = stretchMaps.get(family);
  if (map && map.size) {
    let best: string | null = null;
    let d = Infinity;
    for (const [stop, name] of map) {
      const dd = Math.abs(stop - s);
      if (dd < d) {
        d = dd;
        best = name;
      }
    }
    // Keyword widths are exact on the real family; prefer them when closer.
    const kw = KEYWORDS.reduce((a, b) => (Math.abs(b[0] - s) < Math.abs(a[0] - s) ? b : a));
    if (best && d <= Math.abs(kw[0] - s)) return { family: best, stretch: "normal" };
    return { family, stretch: kw[1] };
  }
  const kw = KEYWORDS.reduce((a, b) => (Math.abs(b[0] - s) < Math.abs(a[0] - s) ? b : a));
  return { family, stretch: kw[1] };
}

// ── texture ──────────────────────────────────────────────────────────────
/**
 * Dark stock: the theme ground with a soft mottle, a faint warm light and
 * fine speckle, so no style sits on a flat fill. Baked once per theme/size.
 */
export function darkStock(theme: Theme, id: string, w: number, h: number, seed = 7, mottle = 1) {
  return bake(`s8-stock:${id}:${theme.bg}${theme.ink}:${seed}:${mottle}`, w, h, (c, W, H) => {
    const { u } = frameOf(W, H);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, W, H);
    const step = Math.max(3, Math.round(u / 110));
    for (let y = 0; y < H; y += step)
      for (let x = 0; x < W; x += step) {
        const n = fbm3(x / (u * 0.42), y / (u * 0.42), seed * 0.37, 3);
        c.fillStyle = rgba(theme.ink, Math.max(0, (0.012 + n * 0.02) * mottle));
        c.fillRect(x, y, step, step);
      }
    const r = rng(seed * 131 + 7);
    const dots = Math.round((W * H) / 700);
    for (let i = 0; i < dots; i++) {
      c.fillStyle = rgba(r() < 0.5 ? theme.ink : "#000000", 0.02 + r() * 0.05);
      const s = Math.max(0.6, u * 0.0011 * (0.5 + r()));
      c.fillRect(r() * W, r() * H, s, s);
    }
  });
}

/** A rounded-rect path (radius clamped to the box). */
export function rounded(c: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.roundRect(x, y, w, h, rr);
}

/** Ink colour that stays readable on a given fill (dark text on light fills). */
export function inkOn(fill: string, theme: Theme): string {
  return luminance(fill) > 0.36 ? mix(theme.bg, "#000000", 0.25) : theme.ink;
}

export { TAU };
