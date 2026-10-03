import { mix, rgba } from "../engine/color";
import { bake, clamp, ease, frameOf, lerp, light, LOOP, rng, seg, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { finish, tooth, turn } from "./_s3-helpers";

/**
 * Van Doesburg-style block letters: every glyph is built from squares on a
 * 5 x 5 grid, horizontal and vertical strokes only.
 */
const GLYPHS: Record<string, string> = {
  A: "#####|#...#|#####|#...#|#...#",
  B: "####.|#..#.|#####|#...#|#####",
  C: "#####|#....|#....|#....|#####",
  D: "####.|#...#|#...#|#...#|####.",
  E: "#####|#....|####.|#....|#####",
  F: "#####|#....|####.|#....|#....",
  G: "#####|#....|#.###|#...#|#####",
  H: "#...#|#...#|#####|#...#|#...#",
  I: "#####|..#..|..#..|..#..|#####",
  J: "#####|...#.|...#.|#..#.|####.",
  K: "#..##|#..#.|####.|#...#|#...#",
  L: "#....|#....|#....|#....|#####",
  M: "#####|#.#.#|#.#.#|#.#.#|#.#.#",
  N: "####.|#...#|#...#|#...#|#...#",
  O: "#####|#...#|#...#|#...#|#####",
  P: "#####|#...#|#####|#....|#....",
  Q: "#####|#...#|#...#|#####|...##",
  R: "#####|#...#|#####|#..#.|#...#",
  S: "#####|#....|#####|....#|#####",
  T: "#####|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#####",
  V: "#...#|#...#|#...#|##.##|.###.",
  W: "#.#.#|#.#.#|#.#.#|#.#.#|#####",
  X: "#...#|##.##|.###.|##.##|#...#",
  Y: "#...#|#...#|#####|..#..|..#..",
  Z: "#####|...##|.###.|##...|#####",
  "0": "#####|#...#|#...#|#...#|#####",
  "1": ".##..|..#..|..#..|..#..|.###.",
  "2": "#####|....#|#####|#....|#####",
  "3": "#####|....#|.####|....#|#####",
  "4": "#...#|#...#|#####|....#|....#",
  "5": "#####|#....|#####|....#|#####",
  "6": "#####|#....|#####|#...#|#####",
  "7": "#####|....#|...##|..##.|..#..",
  "8": "#####|#...#|#####|#...#|#####",
  "9": "#####|#...#|#####|....#|#####",
  "-": ".....|.....|#####|.....|.....",
  ".": ".....|.....|.....|.....|..#..",
  " ": ".....|.....|.....|.....|.....",
};

function glyphsFor(text: string) {
  return [
    ...text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase(),
  ]
    .map((ch) => GLYPHS[ch] ?? GLYPHS[" "])
    .map((g) => g.split("|"));
}

/** Draw block letters with their top-left at (x, y); `cell` is one grid square. */
function blockText(c: Ctx2D, text: string, x: number, y: number, cell: number) {
  const gs = glyphsFor(text);
  let cx = x;
  for (const g of gs) {
    for (let r = 0; r < 5; r++)
      for (let k = 0; k < 5; k++)
        if (g[r][k] === "#") c.fillRect(cx + k * cell, y + r * cell, cell + 0.6, cell + 0.6);
    cx += cell * 6;
  }
}
const blockWidth = (text: string, cell: number) => Math.max(1, [...text].length * 6 - 1) * cell;

/** A line: its axis, its position per pose (0..1), and its span between other lines (-1 start edge, -2 end edge). */
type Line = { pos: number[]; from: number; to: number };
/** A block: bounded by vertical lines l, r and horizontal lines t, b (-1 / -2 = edges), a colour per pose. */
type Block = { l: number; r: number; t: number; b: number; col: number[]; wipe: 0 | 1 | 2 };
type Layout = { V: Line[]; H: Line[]; blocks: Block[]; title: [number, number, number, number] };

// Colours: 0 ground, 1 accent (red), 2 accent2 (blue), 3 yellow, 4 pale grey.
const WIDE: Layout = {
  V: [
    { pos: [0.19, 0.24, 0.3, 0.15], from: 1, to: -2 },
    { pos: [0.64, 0.56, 0.6, 0.7], from: -1, to: -2 },
    { pos: [0.87, 0.84, 0.8, 0.87], from: 1, to: -2 },
    { pos: [0.33, 0.27, 0.4, 0.36], from: -1, to: 0 },
  ],
  H: [
    { pos: [0.3, 0.36, 0.26, 0.33], from: -1, to: -2 },
    { pos: [0.7, 0.68, 0.64, 0.72], from: -1, to: -2 },
    { pos: [0.5, 0.53, 0.45, 0.55], from: 1, to: -2 },
    { pos: [0.86, 0.85, 0.83, 0.88], from: -1, to: 0 },
  ],
  blocks: [
    { l: 3, r: 1, t: -1, b: 0, col: [1, 1, 2, 2], wipe: 1 },
    { l: -1, r: 0, t: 1, b: 3, col: [2, 2, 1, 1], wipe: 0 },
    { l: 2, r: -2, t: 1, b: -2, col: [3, 0, 3, 3], wipe: 2 },
    { l: 1, r: -2, t: 0, b: 2, col: [4, 3, 4, 0], wipe: 1 },
    { l: -1, r: 3, t: -1, b: 0, col: [0, 4, 0, 4], wipe: 0 },
    { l: 1, r: -2, t: -1, b: 0, col: [0, 0, 3, 1], wipe: 2 },
    { l: 0, r: 1, t: 1, b: -2, col: [0, 0, 0, 0], wipe: 0 },
  ],
  // Always a ground field in every pose: left edge to V1, between H0 and H1.
  title: [0, 0.36, 0.56, 0.64],
};

const TALL: Layout = {
  V: [
    { pos: [0.3, 0.24, 0.36, 0.3], from: -1, to: -2 },
    { pos: [0.72, 0.66, 0.77, 0.8], from: 0, to: 1 },
  ],
  H: [
    { pos: [0.18, 0.24, 0.2, 0.14], from: -1, to: -2 },
    { pos: [0.58, 0.52, 0.62, 0.56], from: -1, to: -2 },
    { pos: [0.4, 0.36, 0.43, 0.44], from: 1, to: -2 },
    { pos: [0.8, 0.78, 0.74, 0.84], from: -1, to: 0 },
  ],
  blocks: [
    { l: 0, r: -2, t: -1, b: 0, col: [1, 1, 2, 2], wipe: 1 },
    { l: -1, r: 0, t: 1, b: 3, col: [2, 2, 1, 1], wipe: 0 },
    { l: 1, r: -2, t: 2, b: 1, col: [3, 0, 3, 3], wipe: 2 },
    { l: -1, r: 0, t: -1, b: 0, col: [4, 3, 4, 0], wipe: 1 },
    { l: 0, r: 1, t: 0, b: 1, col: [0, 4, 0, 1], wipe: 0 },
  ],
  title: [0.38, 0.64, 1, 1],
};

const BEAT = LOOP / 4;

/** Position of line i on its axis at time t (lines slide in turn, cubic in-out). */
function linePos(line: Line, i: number, t: number) {
  const n = line.pos.length;
  const local = t % BEAT;
  const beat = Math.floor(t / BEAT) % n;
  const from = line.pos[(beat + n - 1) % n];
  const to = line.pos[beat];
  const p = ease.inOutCubic(seg(local, 0.08 + i * 0.07, 0.62 + i * 0.07));
  return lerp(from, to, p);
}

function canvasTex(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    // Brush drag: short strokes, mostly horizontal, barely lighter than the ground.
    const r = rng(51);
    c.lineCap = "round";
    for (let i = 0; i < (w * h) / (u * u * 0.0009); i++) {
      const x = r() * w;
      const y = r() * h;
      const len = u * (0.03 + r() * 0.08);
      const vert = r() < 0.3;
      c.strokeStyle = rgba(theme.ink, 0.012 + r() * 0.018);
      c.lineWidth = u * (0.002 + r() * 0.004);
      c.beginPath();
      c.moveTo(x, y);
      if (vert) c.lineTo(x + (r() - 0.5) * u * 0.004, y + len);
      else c.lineTo(x + len, y + (r() - 0.5) * u * 0.004);
      c.stroke();
    }
  };
}

export const style: MotionStyle = {
  id: "de-stijl",
  name: "De Stijl Grid",
  family: "Design Movements",
  tagline: "Mondrian bars and primaries",
  look: "A Mondrian composition on a dark canvas: heavy cream bars, red, blue and yellow planes, van Doesburg block lettering.",
  move: "On each beat the bars slide in turn and the planes resize with them; colours swap between planes with a hard wipe.",
  rules: [
    "Only horizontals and verticals; no curves, no diagonals.",
    "Primary planes plus one pale grey; everything else is ground.",
    "Bars are heavy and equal in weight, and run off the canvas edge.",
    "Bars slide in turn, cubic in-out, 70 ms apart, then hold.",
    "Planes change colour by a hard wipe, never a cross-fade.",
    "Lettering is built from squares, like the De Stijl masthead.",
    "Painted texture in the ground; grain on everything.",
  ],
  prompt: `R — References
• Piet Mondrian, "Composition with Red, Blue and Yellow" (1930).
• Theo van Doesburg's De Stijl masthead and block alphabet (1917–1919).

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.25 s): a full-bleed Mondrian grid of heavy cream bars on a dark canvas, a red plane, a blue plane, a yellow plane; the word "{{name}}" in square block letters sits in one dark field.
• Middle (1.25–3.75 s): on each beat the bars slide in turn to new positions and the planes resize with them; red and blue swap places with a hard wipe; yellow jumps to another cell.
• End (3.75–5 s): the bars slide back and the colours return to their first cells, landing exactly on frame one.

S — Style
Looks: {{bg}} canvas with visible brush drag; {{ink}} bars about 2% of the frame thick; planes in {{accent}}, {{accent2}}, a yellow turned from {{accent}}, and a pale grey; block lettering in {{ink}}.
Moves: four compositions, one per 1.25 s beat; each bar slides with a cubic in-out, 70 ms after the one before; colour changes wipe across a plane in 0.4 s.
Rules:
1. Horizontals and verticals only.
2. Primary planes and one grey; the rest is ground.
3. Heavy bars that run off the edge.
4. Bars move in turn, then hold.
5. Hard wipes, never cross-fades.
6. Block lettering built from squares.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; bars always meet cleanly with no gaps or overshoots; no plane ever pokes past a bar; the lettering's field stays dark in every pose; the composition is balanced at every hold. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/De_Stijl",
  theme: {
    bg: "#101012",
    ink: "#efeadf",
    accent: "#e2301f",
    accent2: "#1f4fc4",
    font: "Inter",
  },
  tags: [
    "de stijl",
    "mondrian",
    "grid",
    "primary",
    "red",
    "blue",
    "yellow",
    "neoplasticism",
    "geometric",
    "blocks",
    "modernist",
    "design movement",
  ],
  word: "De Stijl",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const L = portrait ? TALL : WIDE;
    ctx.drawImage(
      bake(`stijl-canvas:${theme.bg}${theme.ink}`, w, h, canvasTex(theme)) as CanvasImageSource,
      0,
      0,
    );

    const T = Math.max(3, u * 0.024);
    const vx = L.V.map((ln, i) => linePos(ln, i, t) * w);
    const hy = L.H.map((ln, i) => linePos(ln, i + L.V.length, t) * h);
    const X = (ref: number) => (ref === -1 ? 0 : ref === -2 ? w : vx[ref]);
    const Y = (ref: number) => (ref === -1 ? 0 : ref === -2 ? h : hy[ref]);

    const yellow = turn(theme.accent, 62, 0.86, 0.17);
    const pale = mix(theme.ink, theme.bg, 0.12);
    const colours = [theme.bg, theme.accent, theme.accent2, yellow, pale];

    // Planes.
    const beat = Math.floor(t / BEAT) % 4;
    const local = t % BEAT;
    for (const b of L.blocks) {
      const x0 = X(b.l);
      const x1 = X(b.r);
      const y0 = Y(b.t);
      const y1 = Y(b.b);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const c0 = b.col[(beat + 3) % 4];
      const c1 = b.col[beat];
      const p = c0 === c1 ? 1 : ease.inOutCubic(seg(local, 0.3, 0.72));
      if (c0 !== 0 && p < 1) {
        ctx.fillStyle = colours[c0];
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (c1 !== 0 || c0 !== 0) {
        ctx.save();
        ctx.beginPath();
        if (b.wipe === 0) ctx.rect(x0, y1 - (y1 - y0) * p, x1 - x0, (y1 - y0) * p);
        else if (b.wipe === 1) ctx.rect(x0, y0, x1 - x0, (y1 - y0) * p);
        else {
          const cx = (x0 + x1) / 2;
          const half = ((x1 - x0) / 2) * p;
          ctx.rect(cx - half, y0, half * 2, y1 - y0);
        }
        ctx.clip();
        if (c1 === 0) {
          // Wiping back to ground: redraw the canvas texture inside the wipe.
          ctx.drawImage(
            bake(
              `stijl-canvas:${theme.bg}${theme.ink}`,
              w,
              h,
              canvasTex(theme),
            ) as CanvasImageSource,
            0,
            0,
          );
        } else {
          ctx.fillStyle = colours[c1];
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
        ctx.restore();
      }
    }
    light(ctx, w * 0.35, h * 0.25, Math.max(w, h) * 0.8, theme.ink, 0.05);

    // Bars, drawn over the planes so every join is clean.
    ctx.fillStyle = theme.ink;
    L.V.forEach((ln, i) => {
      const y0 = ln.from === -1 ? -T : Y(ln.from) - T / 2;
      const y1 = ln.to === -2 ? h + T : Y(ln.to) + T / 2;
      ctx.fillRect(vx[i] - T / 2, y0, T, y1 - y0);
    });
    L.H.forEach((ln, i) => {
      const x0 = ln.from === -1 ? -T : X(ln.from) - T / 2;
      const x1 = ln.to === -2 ? w + T : X(ln.to) + T / 2;
      ctx.fillRect(x0, hy[i] - T / 2, x1 - x0, T);
    });

    // Block lettering in its always-dark field.
    const word = wordFor(theme.name, "De Stijl", 10);
    const [fx0, fy0, fx1, fy1] = L.title;
    const bx0 = fx0 * w + T;
    const bx1 = fx1 * w - T;
    const by0 = fy0 * h + T;
    const by1 = fy1 * h;
    const mark = tintedLogo(theme, theme.ink, 64, 64) ? 1 : 0;
    const bw = (bx1 - bx0) * 0.8;
    const cell = Math.min(bw / (blockWidth(word, 1) + mark * 7), ((by1 - by0) * 0.34) / 5);
    const tw = blockWidth(word, cell);
    const group = tw + mark * cell * 7;
    const gx = bx0 + (bx1 - bx0 - group) / 2;
    const tx = gx + mark * cell * 7;
    const ty = by0 + (by1 - by0) * 0.5 - cell * 2.5;
    ctx.fillStyle = theme.ink;
    blockText(ctx, word, tx, ty, cell);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.fillRect(gx, ty + cell * 6.2, group, Math.max(1, cell * 0.35));
    if (mark) {
      const logo = tintedLogo(theme, theme.ink, cell * 5, cell * 5);
      if (logo) ctx.drawImage(logo as CanvasImageSource, gx, ty);
    }

    tooth(ctx, w, h, 0.5, 31);
    finish(ctx, w, h, t, 0.4, 0.3);
    void clamp;
  },
};
