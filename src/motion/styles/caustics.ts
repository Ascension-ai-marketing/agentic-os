import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  context,
  frameOf,
  grain,
  hash,
  LOOP,
  makeCanvas,
  once,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { noiseTile } from "./_s5-helpers";

/**
 * Surface waves: whole wave numbers across the tile and whole cycles per loop,
 * so space and time both wrap. Slope falls off as 1/k, like a real sea state.
 */
const WAVES = [
  { kx: 1, ky: 2, a: 0.2, w: -1, p: 0.515 },
  { kx: 2, ky: 1, a: 0.2, w: -1, p: 0.054 },
  { kx: -2, ky: 3, a: 0.077, w: -1, p: 0.235 },
  { kx: 1, ky: -2, a: 0.2, w: 1, p: 0.974 },
  { kx: 2, ky: 2, a: 0.125, w: -1, p: 0.493 },
  { kx: -1, ky: 1, a: 0.5, w: 1, p: 0.061 },
  { kx: 3, ky: 0, a: 0.111, w: 2, p: 0.88 },
  { kx: -3, ky: -1, a: 0.1, w: 1, p: 0.87 },
];

const acc = new Map<number, Float32Array>();

/**
 * True caustics: a grid of light rays refracts through the moving surface and
 * lands on the floor; where rays bunch up, the floor is bright. Returns an
 * n x n tile (tileable, loopable) as alpha over the light colour.
 */
function causticTile(n: number, t: number, color: string) {
  const R = 2;
  const m = n * R;
  let A = acc.get(n);
  if (!A) {
    A = new Float32Array(n * n);
    acc.set(n, A);
  }
  A.fill(0);
  const ph = t / LOOP;
  // Separable phases: theta = a(x) + b(y), so each wave costs a few multiplies per ray.
  const nw = WAVES.length;
  const cc = new Float32Array(nw * m);
  const cs = new Float32Array(nw * m);
  const rc = new Float32Array(nw * m);
  const rs = new Float32Array(nw * m);
  for (let k = 0; k < nw; k++) {
    const wv = WAVES[k];
    for (let i = 0; i < m; i++) {
      const a = (TAU * wv.kx * (i + 0.5)) / m;
      cc[k * m + i] = Math.cos(a);
      cs[k * m + i] = Math.sin(a);
      const b = (TAU * wv.ky * (i + 0.5)) / m - TAU * (wv.w * ph + wv.p);
      rc[k * m + i] = Math.cos(b);
      rs[k * m + i] = Math.sin(b);
    }
  }
  // Displacement: how far refraction bends the light, in tile pixels (just past the fold point).
  const D = (0.6 * n) / TAU;
  const gxk = new Float32Array(WAVES.map((wv) => -wv.a * wv.kx * D));
  const gyk = new Float32Array(WAVES.map((wv) => -wv.a * wv.ky * D));
  const invR = 1 / R;
  const rcj = new Float32Array(nw);
  const rsj = new Float32Array(nw);
  for (let j = 0; j < m; j++) {
    const y = (j + 0.5) * invR;
    for (let k = 0; k < nw; k++) {
      rcj[k] = rc[k * m + j];
      rsj[k] = rs[k * m + j];
    }
    for (let i = 0; i < m; i++) {
      let gx = 0;
      let gy = 0;
      for (let k = 0, o = i; k < nw; k++, o += m) {
        // sin(a + b) gives the slope of cos-shaped waves.
        const sn = cs[o] * rcj[k] + cc[o] * rsj[k];
        gx += gxk[k] * sn;
        gy += gyk[k] * sn;
      }
      let x2 = (i + 0.5) * invR + gx - 0.5;
      let y2 = y + gy - 0.5;
      x2 -= Math.floor(x2 / n) * n;
      y2 -= Math.floor(y2 / n) * n;
      const x0 = x2 | 0;
      const y0 = y2 | 0;
      const fx = x2 - x0;
      const fy = y2 - y0;
      const x1 = x0 + 1 === n ? 0 : x0 + 1;
      const r0 = y0 * n;
      const r1 = (y0 + 1 === n ? 0 : y0 + 1) * n;
      const gx0 = 1 - fx;
      const gy0 = 1 - fy;
      A[r0 + x0] += gx0 * gy0;
      A[r0 + x1] += fx * gy0;
      A[r1 + x0] += gx0 * fy;
      A[r1 + x1] += fx * fy;
    }
  }
  const { canvas, ctx } = buffer("caustic-tile", n, n);
  const img = ctx.createImageData(n, n);
  const d = img.data;
  const [cr, cg, cb] = parse(color);
  const mean = R * R;
  for (let y = 0; y < n; y++) {
    const up = ((y + n - 1) % n) * n;
    const row = y * n;
    const dn = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const l = x === 0 ? n - 1 : x - 1;
      const r = x === n - 1 ? 0 : x + 1;
      // A small tent blur hides the ray grain.
      const v =
        (A[row + x] * 4 +
          A[row + l] * 2 +
          A[row + r] * 2 +
          A[up + x] * 2 +
          A[dn + x] * 2 +
          A[up + l] +
          A[up + r] +
          A[dn + l] +
          A[dn + r]) /
        16 /
        mean;
      // Soft shoulder: knots glow without clipping into flat blobs.
      const b = v > 1.15 ? 1 - Math.exp(-0.9 * Math.pow(v - 1.15, 1.25)) : 0;
      const o = (row + x) * 4;
      d[o] = cr;
      d[o + 1] = cg;
      d[o + 2] = cb;
      d[o + 3] = b * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Broad light and shade for the dappling pass: grey 0.5..1, tileable (built on first use: no DOM at import). */
const dapple = () =>
  once("caustic-dapple", () => {
    const S = 128;
    const N = noiseTile(612, S, 3, 3);
    const c = makeCanvas(S, S);
    const g = context(c);
    const img = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = (0.5 + 0.5 * smoothstep(0.2, 0.8, N.sample(i % S, (i / S) | 0))) * 255;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  });

interface Floor {
  u: number;
  tile: number;
  cols: number;
  rows: number;
  ox: number;
  oy: number;
}

function floorGrid(w: number, h: number, letters: number): Floor {
  const { u, portrait, square } = frameOf(w, h);
  // Tiles small enough that every letter gets two tiles per pixel of the 5x7 alphabet.
  const px = Math.max(1, letters * 6 - 1);
  const room = w * (portrait ? 0.86 : square ? 0.8 : 0.64);
  const tile = Math.min(u * (portrait ? 0.016 : square ? 0.0145 : 0.022), room / (px * 2 + 1));
  const cols = Math.ceil(w / tile) + 1;
  const rows = Math.ceil(h / tile) + 1;
  return { u, tile, cols, rows, ox: (w - cols * tile) / 2, oy: (h - rows * tile) / 2 };
}

/** A 5x7 mosaic alphabet: pool lettering is designed on the tile grid, one tile per pixel. */
const GLYPHS: Record<string, string> = {
  A: "01110100011000111111100011000110001",
  B: "11110100011000111110100011000111110",
  C: "01110100011000010000100001000101110",
  D: "11100100101000110001100011001011100",
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
  Y: "10001100011000101010001000010000100",
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
  ".": "00000000000000000000000000110001100",
  "-": "00000000000000011111000000000000000",
  "&": "01100100101010001000101011001001101",
  "!": "00100001000010000100001000000000100",
  "'": "00100001000100000000000000000000000",
  " ": "00000000000000000000000000000000000",
};

/** Which tiles spell the word: the pixel alphabet scaled to whole tiles, diagonals softened. */
function wordTiles(F: Floor, word: string, portrait: boolean): Uint8Array {
  const text = [...word].map((ch) => (GLYPHS[ch] ? ch : " ")).join("");
  const px = Math.max(1, text.length * 6 - 1);
  const room = F.cols * (portrait ? 0.86 : F.cols < F.rows * 1.2 ? 0.8 : 0.64);
  const s = Math.max(
    1,
    Math.min(Math.floor(room / px), Math.floor((F.rows * (portrait ? 0.2 : 0.34)) / 7)),
  );
  const bw = px * s;
  const bh = 7 * s;
  const x0 = Math.round((F.cols - bw) / 2);
  const y0 = Math.round(F.rows * (portrait ? 0.46 : 0.47) - bh / 2);
  const out = new Uint8Array(F.cols * F.rows);
  const on = (gx: number, gy: number) => {
    if (gy < 0 || gy >= 7 || gx < 0 || gx >= px) return false;
    const c = Math.floor(gx / 6);
    const cx = gx % 6;
    if (cx === 5) return false;
    return GLYPHS[text[c]][gy * 5 + cx] === "1";
  };
  const set = (tx: number, ty: number) => {
    if (tx >= 0 && tx < F.cols && ty >= 0 && ty < F.rows) out[ty * F.cols + tx] = 1;
  };
  for (let gy = 0; gy < 7; gy++)
    for (let gx = 0; gx < px; gx++) {
      // Bold: each pixel also claims one extra tile to its right, so strokes read at a distance.
      if (on(gx, gy))
        for (let j = 0; j < s; j++)
          for (let i = 0; i <= s - (s >= 2 ? 0 : 1); i++) set(x0 + gx * s + i, y0 + gy * s + j);
      // Soften diagonal steps: fill the inner corner tile where two pixels touch at a corner.
      if (s >= 2 && !on(gx, gy)) {
        const l = on(gx - 1, gy);
        const r = on(gx + 1, gy);
        const u = on(gx, gy - 1);
        const d = on(gx, gy + 1);
        const bx = x0 + gx * s;
        const by = y0 + gy * s;
        if (l && u) set(bx, by);
        if (r && u) set(bx + s - 1, by);
        if (l && d) set(bx, by + s - 1);
        if (r && d) set(bx + s - 1, by + s - 1);
      }
    }
  return out;
}

/** The pool floor: glazed mosaic tiles, grout, a tiled word and a deep end. */
function floor(theme: Theme, F: Floor, word: string, portrait: boolean) {
  return (c: Ctx2D, w: number, h: number) => {
    const marks = wordTiles(F, word, portrait);
    const lane = Math.round(F.rows * (portrait ? 0.8 : 0.84));
    const grout = mix(theme.bg, theme.accent2, 0.25);
    c.fillStyle = grout;
    c.fillRect(0, 0, w, h);
    const base = mix(theme.bg, theme.accent2, 0.5);
    const baseB = mix(theme.bg, theme.accent, 0.26);
    const mark = mix(theme.ink, theme.accent, 0.25);
    const gap = Math.max(1, F.tile * 0.075);
    for (let j = 0; j < F.rows; j++)
      for (let i = 0; i < F.cols; i++) {
        const x = F.ox + i * F.tile;
        const y = F.oy + j * F.tile;
        const isMark = marks[j * F.cols + i] === 1;
        // A one-tile dark keyline around the letters, like real pool lettering.
        let near = false;
        if (!isMark)
          for (let dj = -1; dj <= 1 && !near; dj++)
            for (let di = -1; di <= 1; di++) {
              const jj = j + dj;
              const ii = i + di;
              if (
                jj >= 0 &&
                jj < F.rows &&
                ii >= 0 &&
                ii < F.cols &&
                marks[jj * F.cols + ii] === 1
              ) {
                near = true;
                break;
              }
            }
        const isLane = j === lane || j === lane + 1;
        const v = hash(i, j, 3);
        const col = isMark
          ? mix(mark, theme.bg, 0.08 + 0.14 * v)
          : isLane || near
            ? mix(theme.bg, "#000000", 0.2 + 0.1 * v)
            : mix(base, baseB, v * 0.5);
        c.fillStyle = col;
        c.fillRect(x + gap / 2, y + gap / 2, F.tile - gap, F.tile - gap);
        // Glaze: a lit top-left edge and a soft sheen spot.
        c.fillStyle = rgba(theme.ink, 0.06 + 0.05 * hash(i, j, 5));
        c.fillRect(x + gap / 2, y + gap / 2, F.tile - gap, Math.max(0.6, F.tile * 0.06));
        c.fillRect(x + gap / 2, y + gap / 2, Math.max(0.6, F.tile * 0.06), F.tile - gap);
        c.fillStyle = "rgba(0,0,0,0.18)";
        c.fillRect(x + gap / 2, y + F.tile - gap / 2 - F.tile * 0.06, F.tile - gap, F.tile * 0.06);
      }
    // Deep end: the floor falls into shadow toward one corner.
    const deep = c.createLinearGradient(0, 0, w, h);
    deep.addColorStop(0, "rgba(0,0,0,0)");
    deep.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = deep;
    c.fillRect(0, 0, w, h);
  };
}

/** Grout lines sit in shadow even under the light: multiplied back over the caustics. */
function groutShade(F: Floor) {
  return (c: Ctx2D, w: number, h: number) => {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgb(165,165,165)";
    const gap = Math.max(1, F.tile * 0.075);
    for (let i = 0; i <= F.cols; i++) c.fillRect(F.ox + i * F.tile - gap / 2, 0, gap, h);
    for (let j = 0; j <= F.rows; j++) c.fillRect(0, F.oy + j * F.tile - gap / 2, w, gap);
  };
}

export const style: MotionStyle = {
  id: "caustics",
  name: "Pool Caustics",
  family: "Light & Material",
  tagline: "Pool light on mosaic tiles",
  look: "A night-swim pool floor: nets of refracted light dance over glazed mosaic tiles and a word laid in tile.",
  move: "The light net ripples and re-forms continuously as the surface waves pass; lines pinch bright, split and flow on.",
  rules: [
    "Caustics come from light refracted by moving waves, so the lines fold, pinch and brighten where they meet.",
    "Two scales of the same light overlap, so the pattern never visibly repeats.",
    "Light lands on the tiles, the grout stays in shadow.",
    "The word is laid in mosaic, one tile per pixel, like a pool depth marking.",
    "The floor falls away into a deep end; the light keeps its colour.",
    "Motion never stops but never jumps: every wave completes whole cycles in the loop.",
  ],
  prompt: `R — References
• Swimming-pool caustics filmed from above (search: pool floor caustics, underwater light patterns).
• Mosaic pool markings and lane tiles (search: pool depth marker tiles).

I — Idea
Light dancing on a pool floor, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a dark mosaic floor with "{{name}}" laid in pale tiles; a net of light ripples across it.
• Middle (1.5–3.5 s): the net keeps flowing: lines pinch into bright knots, split and re-form as waves pass overhead.
• End (3.5–5 s): the waves complete their cycles and the pattern returns exactly to its opening state.

S — Style
Looks: {{bg}} night water over tiles in {{accent2}}; "{{name}}" laid in pale {{ink}} tiles from a 5x7 mosaic alphabet with a dark keyline; caustic light in {{ink}} tinted {{accent}}; grout in shadow; a darker deep end.
Moves: continuous; surface waves with whole wave numbers and whole cycles per loop; the light net drifts gently.
Rules:
1. Compute caustics by refracting a grid of rays through the moving surface and adding where they land.
2. Overlay two scales of the pattern to hide repetition.
3. Light on tiles, grout in shadow.
4. Word laid in tiles, one tile per pixel.
5. Grain and vignette.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the light forms thin bright folded lines, not soft blobs; no visible tile repeat in the light; the mosaic word reads at a glance; grout lines stay dark under the light. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Caustic_(optics)",
  theme: {
    bg: "#03141b",
    ink: "#effcff",
    accent: "#43d9ff",
    accent2: "#1a78a0",
    font: "Inter",
  },
  tags: [
    "water",
    "pool",
    "caustics",
    "light",
    "summer",
    "swim",
    "underwater",
    "ripple",
    "mosaic",
    "tiles",
    "calm",
  ],
  word: "Swim",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const F = floorGrid(w, h, wordFor(theme.name, "Swim", 10).length);
    const word = wordFor(theme.name, "Swim", 10).toUpperCase();
    const key = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}|${word}`;
    ctx.drawImage(
      bake(`caustic-floor:${key}`, w, h, floor(theme, F, word, portrait)) as CanvasImageSource,
      0,
      0,
    );

    const n = Math.max(96, Math.min(384, Math.round((u * 0.2) / 8) * 8));
    const tile = causticTile(n, t, mix(theme.ink, theme.accent, 0.3));
    const p = t / LOOP;
    const layers = [
      { scale: (u * 0.62) / n, rot: 0.0, dx: 1, dy: 0, a: 0.85 },
      { scale: (u * 0.62 * 1.53) / n, rot: 0.52, dx: 0, dy: -1, a: 0.5 },
    ];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const L of layers) {
      const pat = ctx.createPattern(tile as CanvasImageSource, "repeat");
      if (!pat) continue;
      // Drift a whole tile per loop so the drift wraps.
      const span = n * L.scale;
      const m = new DOMMatrix()
        .translateSelf(w / 2, h / 2)
        .rotateSelf((L.rot * 180) / Math.PI)
        .translateSelf(L.dx * span * p, L.dy * span * p)
        .scaleSelf(L.scale);
      pat.setTransform(m);
      ctx.globalAlpha = L.a;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // Slow dappling: broad patches where the surface focuses more or less light.
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const dp = ctx.createPattern(dapple() as CanvasImageSource, "repeat");
    if (dp) {
      const ds = (u * 1.7) / 128;
      dp.setTransform(new DOMMatrix().translateSelf(-p * 128 * ds, p * 128 * ds).scaleSelf(ds));
      ctx.fillStyle = dp;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // Grout stays in shadow; the deep end swallows some light.
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(bake("caustic-grout", w, h, groutShade(F)) as CanvasImageSource, 0, 0);
    ctx.restore();
    const deep = ctx.createRadialGradient(
      w * 0.3,
      h * 0.25,
      0,
      w * 0.5,
      h * 0.5,
      Math.hypot(w, h) * 0.65,
    );
    deep.addColorStop(0, rgba(theme.accent, 0.06));
    deep.addColorStop(1, rgba(theme.bg, 0.4));
    ctx.fillStyle = deep;
    ctx.fillRect(0, 0, w, h);

    const mark = tintedLogo(theme, rgba(theme.ink, 0.8), u * 0.06, u * 0.06);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w - u * 0.11, h - u * 0.11);

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.26);
  },
};
