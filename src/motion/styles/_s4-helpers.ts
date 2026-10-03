/**
 * Shared helpers for the Retro tech family (builder s4): a 5x7 bitmap font,
 * an Asteroids-style vector font, cheap glow, scanlines, a CRT barrel warp,
 * TV snow and a monospace glyph atlas. Everything is pure or deterministic-cached.
 */
import { rgba } from "../engine/color";
import { bake, buffer, context, fract, LOOP, makeCanvas, rng, type AnyCanvas } from "../engine/kit";
import type { Ctx2D } from "../engine/types";

/** Frame index at a stepped frame rate, wrapped to the loop (t = LOOP gives 0). */
export function stepFrame(t: number, fps: number): number {
  return Math.floor(fract(t / LOOP) * LOOP * fps + 1e-6);
}

/** t quantised to a stepped frame rate (animate "on twos" and so on). */
export function stepTime(t: number, fps: number): number {
  return stepFrame(t, fps) / fps;
}

// ── 5x7 bitmap font ──────────────────────────────────────────────────────
/** Each glyph: 7 rows of 5 bits, top row first. */
export const FONT57: Record<string, string> = {
  A: "01110100011000111111100011000110001",
  B: "11110100011000111110100011000111110",
  C: "01110100011000010000100001000101110",
  D: "11110100011000110001100011000111110",
  E: "11111100001000011110100001000011111",
  F: "11111100001000011110100001000010000",
  G: "01110100011000010111100011000101111",
  H: "10001100011000111111100011000110001",
  I: "01110001000010000100001000010001110",
  J: "00111000100001000010000101001001100",
  K: "10001100101010011000101001001010001",
  L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001",
  N: "10001100011100110101100111000110001",
  O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101",
  R: "11110100011000111110101001001010001",
  S: "01111100001000001110000010000111110",
  T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100",
  W: "10001100011000110101101011010101010",
  X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100",
  Z: "11111000010001000100010001000011111",
  "0": "01110100011001110101110011000101110",
  "1": "00100011000010000100001000010001110",
  "2": "01110100010000100010001000100011111",
  "3": "11111000100010000010000011000101110",
  "4": "00010001100101010010111110001000010",
  "5": "11111100001111000001000011000101110",
  "6": "00110010001000011110100011000101110",
  "7": "11111000010001000100010000100001000",
  "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000010001001100",
  "-": "00000000000000011111000000000000000",
  "+": "00000001000010011111001000010000000",
  "=": "00000000001111100000111110000000000",
  ".": "00000000000000000000000000110001100",
  ",": "00000000000000000000001100010001000",
  ":": "00000011000110000000011000110000000",
  ";": "00000011000110000000011000010001000",
  "!": "00100001000010000100001000000000100",
  "?": "01110100010000100010001000000000100",
  "'": "00100001000100000000000000000000000",
  '"': "01010010100101000000000000000000000",
  "/": "00001000010001000100010001000010000",
  "*": "00000001001010101110101010010000000",
  "#": "01010010101111101010111110101001010",
  "%": "11000110010001000100010001001100011",
  "&": "01100100101010001000101011001001101",
  "(": "00010001000100001000010000010000010",
  ")": "01000001000001000010000100010001000",
  "[": "01110010000100001000010000100001110",
  "]": "01110000100001000010000100001001110",
  "<": "00010001000100010000010000010000010",
  ">": "01000001000001000001000100010001000",
  _: "00000000000000000000000000000011111",
  "@": "01110100011011110101101111000001110",
  $: "00100011111010001110001011111000100",
  "·": "00000000000000000100000000000000000",
  "•": "00000000000111001110011100000000000",
  "◆": "00000001000111011111011100010000000",
  "▶": "10000110001110011110111001100010000",
  "◀": "00001000110011101111001110001100001",
  "♥": "00000010101111111111011100010000000",
  "★": "00100001001111101110010100000000000",
  "›": "00000010000010000010001000100000000",
  "‹": "00000000100010001000001000001000000",
  " ": "00000000000000000000000000000000000",
};

/** The glyph bits for a character (upper-cased), or null when the font lacks it. */
export function glyph57(ch: string): string | null {
  return FONT57[ch] ?? FONT57[ch.toUpperCase()] ?? null;
}

/** Keep only characters the 5x7 font can draw (others become spaces). */
export function clean57(text: string): string {
  return [...text.toUpperCase()].map((c) => (FONT57[c] ? c : " ")).join("");
}

/** Width in font pixels of a 5x7 string with `gap` pixels between glyphs. */
export function width57(text: string, gap = 1): number {
  const n = [...text].length;
  return n ? n * (5 + gap) - gap : 0;
}

/** Call fn for every lit pixel of a 5x7 string, in font-pixel coordinates. */
export function dots57(
  text: string,
  fn: (x: number, y: number, index: number) => void,
  gap = 1,
): void {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const g = glyph57(chars[i]);
    if (!g) continue;
    const ox = i * (5 + gap);
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 5; x++) if (g.charCodeAt(y * 5 + x) === 49) fn(ox + x, y, i);
  }
}

// ── vector stroke font (Asteroids-style, 4 x 6 grid, y down) ─────────────
type Stroke = [number, number][];
export const VFONT: Record<string, Stroke[]> = {
  A: [
    [
      [0, 6],
      [0, 2],
      [2, 0],
      [4, 2],
      [4, 6],
    ],
    [
      [0, 4],
      [4, 4],
    ],
  ],
  B: [
    [
      [0, 6],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [0, 3],
    ],
    [
      [3, 3],
      [4, 4],
      [4, 5],
      [3, 6],
      [0, 6],
    ],
  ],
  C: [
    [
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
    ],
  ],
  D: [
    [
      [0, 0],
      [0, 6],
      [2, 6],
      [4, 4],
      [4, 2],
      [2, 0],
      [0, 0],
    ],
  ],
  E: [
    [
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
  F: [
    [
      [4, 0],
      [0, 0],
      [0, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
  G: [
    [
      [4, 1],
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
      [4, 3],
      [2, 3],
    ],
  ],
  H: [
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [4, 6],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ],
  I: [
    [
      [0, 0],
      [4, 0],
    ],
    [
      [2, 0],
      [2, 6],
    ],
    [
      [0, 6],
      [4, 6],
    ],
  ],
  J: [
    [
      [4, 0],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 4],
    ],
  ],
  K: [
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [0, 3],
      [4, 6],
    ],
  ],
  L: [
    [
      [0, 0],
      [0, 6],
      [4, 6],
    ],
  ],
  M: [
    [
      [0, 6],
      [0, 0],
      [2, 2],
      [4, 0],
      [4, 6],
    ],
  ],
  N: [
    [
      [0, 6],
      [0, 0],
      [4, 6],
      [4, 0],
    ],
  ],
  O: [
    [
      [0, 0],
      [4, 0],
      [4, 6],
      [0, 6],
      [0, 0],
    ],
  ],
  P: [
    [
      [0, 6],
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  ],
  Q: [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [2, 6],
      [0, 6],
      [0, 0],
    ],
    [
      [2, 4],
      [4, 6],
    ],
  ],
  R: [
    [
      [0, 6],
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    [
      [1, 3],
      [4, 6],
    ],
  ],
  S: [
    [
      [4, 0],
      [0, 0],
      [0, 3],
      [4, 3],
      [4, 6],
      [0, 6],
    ],
  ],
  T: [
    [
      [0, 0],
      [4, 0],
    ],
    [
      [2, 0],
      [2, 6],
    ],
  ],
  U: [
    [
      [0, 0],
      [0, 6],
      [4, 6],
      [4, 0],
    ],
  ],
  V: [
    [
      [0, 0],
      [2, 6],
      [4, 0],
    ],
  ],
  W: [
    [
      [0, 0],
      [0, 6],
      [2, 4],
      [4, 6],
      [4, 0],
    ],
  ],
  X: [
    [
      [0, 0],
      [4, 6],
    ],
    [
      [4, 0],
      [0, 6],
    ],
  ],
  Y: [
    [
      [0, 0],
      [2, 2],
      [4, 0],
    ],
    [
      [2, 2],
      [2, 6],
    ],
  ],
  Z: [
    [
      [0, 0],
      [4, 0],
      [0, 6],
      [4, 6],
    ],
  ],
  "0": [
    [
      [0, 0],
      [4, 0],
      [4, 6],
      [0, 6],
      [0, 0],
    ],
    [
      [4, 0],
      [0, 6],
    ],
  ],
  "1": [
    [
      [1, 1],
      [2, 0],
      [2, 6],
    ],
    [
      [1, 6],
      [3, 6],
    ],
  ],
  "2": [
    [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 6],
      [4, 6],
    ],
  ],
  "3": [
    [
      [0, 0],
      [4, 0],
      [4, 6],
      [0, 6],
    ],
    [
      [1, 3],
      [4, 3],
    ],
  ],
  "4": [
    [
      [0, 0],
      [0, 3],
      [4, 3],
    ],
    [
      [4, 0],
      [4, 6],
    ],
  ],
  "5": [
    [
      [4, 0],
      [0, 0],
      [0, 3],
      [4, 3],
      [4, 6],
      [0, 6],
    ],
  ],
  "6": [
    [
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
      [4, 3],
      [0, 3],
    ],
  ],
  "7": [
    [
      [0, 0],
      [4, 0],
      [4, 6],
    ],
  ],
  "8": [
    [
      [0, 0],
      [4, 0],
      [4, 6],
      [0, 6],
      [0, 0],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ],
  "9": [
    [
      [4, 3],
      [0, 3],
      [0, 0],
      [4, 0],
      [4, 6],
      [0, 6],
    ],
  ],
  "-": [
    [
      [1, 3],
      [3, 3],
    ],
  ],
  ".": [
    [
      [2, 5.6],
      [2, 6],
    ],
  ],
  ":": [
    [
      [2, 1.6],
      [2, 2],
    ],
    [
      [2, 4.6],
      [2, 5],
    ],
  ],
  "/": [
    [
      [0, 6],
      [4, 0],
    ],
  ],
  "+": [
    [
      [2, 1.5],
      [2, 4.5],
    ],
    [
      [0.5, 3],
      [3.5, 3],
    ],
  ],
  "·": [
    [
      [2, 2.8],
      [2, 3.2],
    ],
  ],
  " ": [],
};

/** Keep only characters the vector font can draw. */
export function cleanV(text: string): string {
  return [...text.toUpperCase()].map((c) => (VFONT[c] ? c : " ")).join("");
}

/** Width of a vector string in glyph units (glyph 4 wide, advance 6). */
export function widthV(text: string): number {
  const n = [...text].length;
  return n ? n * 6 - 2 : 0;
}

/**
 * Add a vector string to the current path. (x, y) is the top-left; `s` is the
 * size of one grid unit, so a glyph is 4s wide and 6s tall.
 */
export function pathV(c: Ctx2D, text: string, x: number, y: number, s: number): void {
  const chars = [...text.toUpperCase()];
  for (let i = 0; i < chars.length; i++) {
    const strokes = VFONT[chars[i]];
    if (!strokes) continue;
    const ox = x + i * 6 * s;
    for (const st of strokes) {
      c.moveTo(ox + st[0][0] * s, y + st[0][1] * s);
      for (let k = 1; k < st.length; k++) c.lineTo(ox + st[k][0] * s, y + st[k][1] * s);
    }
  }
}

// ── light ────────────────────────────────────────────────────────────────
/**
 * Cheap glow: shrink a layer, blur it small, and lay it back over the frame.
 * `down` is the shrink factor; `blur` is in small-buffer pixels.
 */
export function glow(
  ctx: Ctx2D,
  src: CanvasImageSource,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  down = 4,
  blur = 2,
  alpha = 0.8,
  op: GlobalCompositeOperation = "screen",
  pad = 0,
): void {
  // `pad` (destination px) leaves room around the source so the halo can spill past it.
  const p = Math.round(pad / down);
  const iw = Math.max(2, Math.round(w / down));
  const ih = Math.max(2, Math.round(h / down));
  const bw = iw + p * 2;
  const bh = ih + p * 2;
  const a = buffer(key + ":glow-a", bw, bh);
  const b = buffer(key + ":glow-b", bw, bh);
  a.ctx.globalCompositeOperation = "source-over";
  a.ctx.clearRect(0, 0, bw, bh);
  a.ctx.imageSmoothingEnabled = true;
  a.ctx.drawImage(src, p, p, iw, ih);
  b.ctx.clearRect(0, 0, bw, bh);
  b.ctx.filter = `blur(${blur.toFixed(2)}px)`;
  b.ctx.drawImage(a.canvas as CanvasImageSource, 0, 0);
  b.ctx.filter = "none";
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  const sx = w / iw;
  const sy = h / ih;
  ctx.drawImage(b.canvas as CanvasImageSource, x - p * sx, y - p * sy, bw * sx, bh * sy);
  ctx.restore();
}

/** Horizontal scanlines baked once per size: `period` px, dark line share `duty`. */
export function scanlines(
  ctx: Ctx2D,
  w: number,
  h: number,
  period: number,
  alpha: number,
  duty = 0.45,
  op: GlobalCompositeOperation = "source-over",
): void {
  const p = Math.max(2, period);
  const layer = bake(`s4-scan:${p.toFixed(2)}:${duty}`, w, h, (c, W, H) => {
    c.fillStyle = "#000";
    for (let y = 0; y < H; y += p) {
      // Soft-edged line: a solid core with half-alpha fringes, so it never beats.
      const core = Math.max(1, p * duty);
      c.globalAlpha = 1;
      c.fillRect(0, Math.round(y + p - core), W, Math.max(1, Math.round(core)));
      c.globalAlpha = 0.35;
      c.fillRect(0, Math.round(y + p - core) - 1, W, 1);
    }
    c.globalAlpha = 1;
  });
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(layer as CanvasImageSource, 0, 0);
  ctx.restore();
}

/**
 * Approximate CRT barrel warp: rows are squeezed toward the centre by
 * their height, then columns by their x, so the picture bows outward.
 * `kx`, `ky` ~0.03..0.08. Draws src (sw x sh) into dst at (dx, dy, dw, dh).
 */
export function barrel(
  dst: Ctx2D,
  src: AnyCanvas,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  kx: number,
  ky: number,
  key: string,
  rows = 72,
  cols = 96,
): void {
  const mid = buffer(key + ":barrel", Math.round(dw), Math.round(dh));
  const m = mid.ctx;
  m.globalCompositeOperation = "source-over";
  m.clearRect(0, 0, dw, dh);
  m.imageSmoothingEnabled = true;
  // Pass 1: each row strip narrows with distance from the middle row.
  for (let i = 0; i < rows; i++) {
    const y0 = (i / rows) * dh;
    const y1 = ((i + 1) / rows) * dh;
    const v = ((i + 0.5) / rows) * 2 - 1;
    const s = 1 - kx * v * v;
    const ww = dw * s;
    m.drawImage(
      src as CanvasImageSource,
      0,
      (i / rows) * sh,
      sw,
      sh / rows,
      (dw - ww) / 2,
      Math.floor(y0),
      ww,
      Math.ceil(y1) - Math.floor(y0),
    );
  }
  // Pass 2: each column strip shortens with distance from the middle column.
  for (let j = 0; j < cols; j++) {
    const x0 = (j / cols) * dw;
    const x1 = ((j + 1) / cols) * dw;
    const u = ((j + 0.5) / cols) * 2 - 1;
    const s = 1 - ky * u * u;
    const hh = dh * s;
    dst.drawImage(
      mid.canvas as CanvasImageSource,
      x0,
      0,
      x1 - x0,
      dh,
      dx + Math.floor(x0),
      dy + (dh - hh) / 2,
      Math.ceil(x1) - Math.floor(x0),
      hh,
    );
  }
}

// ── texture ──────────────────────────────────────────────────────────────
const snowTiles: AnyCanvas[] = [];
/** High-contrast TV snow, streaked horizontally. Three tiles; pick one per frame. */
export function snowTile(i: number): AnyCanvas {
  const k = ((i % 3) + 3) % 3;
  if (snowTiles[k]) return snowTiles[k];
  const W = 256;
  const H = 128;
  const c = makeCanvas(W, H);
  const g = context(c);
  const img = g.createImageData(W, H);
  const r = rng(0x5a0 + k * 977);
  for (let y = 0; y < H; y++) {
    let run = 0;
    let v = 0;
    for (let x = 0; x < W; x++) {
      if (run <= 0) {
        v = r();
        run = 1 + Math.floor(r() * 3);
      }
      run--;
      const c8 = Math.round(Math.pow(v, 1.6) * 255);
      const o = (y * W + x) * 4;
      img.data[o] = c8;
      img.data[o + 1] = c8;
      img.data[o + 2] = c8;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  snowTiles[k] = c;
  return c;
}

// ── monospace glyph atlas ────────────────────────────────────────────────
export interface Atlas {
  canvas: AnyCanvas;
  cw: number;
  ch: number;
  /** Source x/y of a character in colour row `tone`, or null. */
  at(char: string, tone: number): [number, number] | null;
}

/**
 * Pre-render every character of `chars` in every colour of `tones`, one cell
 * each. Draw with drawImage(atlas.canvas, sx, sy, cw, ch, dx, dy, cw, ch).
 */
export function atlas(
  key: string,
  chars: string,
  cw: number,
  ch: number,
  fontSpec: string,
  tones: string[],
  yAt = 0.78,
): Atlas {
  const list = [...chars];
  const W = Math.max(1, Math.ceil(cw)) * list.length;
  const H = Math.max(1, Math.ceil(ch)) * tones.length;
  const CW = Math.max(1, Math.ceil(cw));
  const CH = Math.max(1, Math.ceil(ch));
  const canvas = bake(`s4-atlas:${key}:${fontSpec}:${tones.join()}:${chars}`, W, H, (c) => {
    c.font = fontSpec;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    tones.forEach((tone, row) => {
      c.fillStyle = tone;
      list.forEach((glyph, i) => {
        if (glyph !== " ") c.fillText(glyph, i * CW + CW / 2, row * CH + CH * yAt);
      });
    });
  });
  const index = new Map<string, number>();
  list.forEach((g, i) => index.set(g, i));
  return {
    canvas,
    cw: CW,
    ch: CH,
    at(char: string, tone: number) {
      const i = index.get(char);
      if (i === undefined) return null;
      return [i * CW, tone * CH];
    },
  };
}

/** A dim rgba of a colour, cached (re-export for style files). */
export const tint = rgba;
