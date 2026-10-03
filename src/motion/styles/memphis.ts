import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  font,
  fract,
  frameOf,
  LOOP,
  light,
  once,
  rng,
  TAU,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { between, finish, fitBox, stock, tooth } from "./_s3-helpers";

const FAMILY = "Rubik Mono One";
const FALLBACK = '"Arial Black", "Helvetica Neue", sans-serif';

/** Squash-and-stretch hop: `n` hops per loop, offset `o` (0..1 of a hop). */
function hop(t: number, n: number, o: number) {
  const f = fract((t / LOOP) * n + o);
  const air = 0.5;
  let lift = 0;
  let sx = 1;
  let sy = 1;
  if (f < air) {
    const a = f / air;
    lift = 4 * a * (1 - a);
    const v = Math.abs(1 - 2 * a);
    sy = 1 + 0.14 * v * v;
    sx = 1 / Math.sqrt(sy);
  } else {
    const b = (f - air) / (1 - air);
    const land = Math.exp(-b * 8) * Math.cos(b * 20);
    const crouch = Math.pow(clamp((b - 0.7) / 0.3), 2);
    const sq = 0.2 * land + 0.12 * crouch;
    sy = 1 - sq;
    sx = 1 + sq * 0.85;
  }
  return { lift, sx, sy };
}

type Kind = "arch" | "column" | "pyramid" | "ring" | "ball" | "cube";

/** Colour slots: 0 pink, 1 teal, 2 yellow, 3 lilac, 4 cream. */
type Obj = { kind: Kind; color: number; size: number };
const CAST: Obj[] = [
  { kind: "column", color: 1, size: 1.25 },
  { kind: "arch", color: 0, size: 1.2 },
  { kind: "pyramid", color: 2, size: 1.05 },
  { kind: "ring", color: 3, size: 0.8 },
  { kind: "cube", color: 4, size: 0.62 },
  { kind: "ball", color: 1, size: 0.5 },
];

type Scene = {
  word: { x: number; y: number; w: number; hMax: number; align: "left" | "center" };
  disc: [number, number, number];
  panel: [number, number, number, number, number]; // cx, cy, w, h, angle
  shelves: { y: number; x0: number; x1: number; scale: number; items: [number, number][] }[]; // items: [cast index, x]
  zig: [number, number, number, number];
  squig: [number, number, number, number];
  unit: number;
};

function scene(w: number, h: number): Scene {
  const { u, portrait, square } = frameOf(w, h);
  if (portrait)
    return {
      word: { x: w / 2, y: h * 0.15, w: w * 0.86, hMax: u * 0.16, align: "center" },
      disc: [w * 0.7, h * 0.385, u * 0.27],
      panel: [w * 0.3, h * 0.37, u * 0.46, u * 0.3, -0.1],
      shelves: [
        {
          y: h * 0.58,
          x0: w * 0.06,
          x1: w * 0.94,
          scale: 1,
          items: [
            [0, 0.16],
            [1, 0.49],
            [2, 0.82],
          ],
        },
        {
          y: h * 0.88,
          x0: w * 0.06,
          x1: w * 0.94,
          scale: 1.25,
          items: [
            [3, 0.18],
            [4, 0.5],
            [5, 0.82],
          ],
        },
      ],
      zig: [w * 0.66, h * 0.66, u * 0.32, -0.12],
      squig: [w * 0.3, h * 0.68, u * 0.34, 0.08],
      unit: u * 0.26,
    };
  if (square)
    return {
      word: { x: w * 0.07, y: h * 0.2, w: w * 0.7, hMax: u * 0.13, align: "left" },
      disc: [w * 0.82, h * 0.24, u * 0.2],
      panel: [w * 0.34, h * 0.45, u * 0.52, u * 0.18, -0.08],
      shelves: [
        {
          y: h * 0.86,
          x0: w * 0.05,
          x1: w * 0.95,
          scale: 1,
          items: [
            [0, 0.09],
            [1, 0.3],
            [2, 0.52],
            [3, 0.72],
            [5, 0.9],
          ],
        },
      ],
      zig: [w * 0.78, h * 0.5, u * 0.22, -0.16],
      squig: [w * 0.72, h * 0.62, u * 0.2, 0.06],
      unit: u * 0.21,
    };
  return {
    word: { x: w * 0.065, y: h * 0.31, w: w * 0.52, hMax: u * 0.15, align: "left" },
    disc: [w * 0.83, h * 0.25, u * 0.25],
    panel: [w * 0.38, h * 0.53, u * 0.66, u * 0.2, -0.06],
    shelves: [
      {
        y: h * 0.84,
        x0: w * 0.04,
        x1: w * 0.96,
        scale: 1,
        items: [
          [0, 0.07],
          [1, 0.23],
          [2, 0.42],
          [3, 0.6],
          [4, 0.76],
          [5, 0.9],
        ],
      },
    ],
    zig: [w * 0.68, h * 0.5, u * 0.2, -0.16],
    squig: [w * 0.87, h * 0.58, u * 0.22, 0.1],
    unit: u * 0.26,
  };
}

function palette(theme: Theme) {
  return [
    theme.accent,
    theme.accent2,
    between(theme.accent, theme.accent2, 1, 0.88, 0.17),
    between(theme.accent, theme.accent2, 0, 0.72, 0.12),
    theme.ink,
  ];
}

/** Draw one form standing on y = 0 at the origin, size s. Patterns are cut in the ground colour. */
function form(c: Ctx2D, o: Obj, s: number, col: string, ink: string, bg: string, lw: number) {
  const off = s * 0.06;
  const outline = (path: () => void) => {
    c.save();
    c.translate(off, -off * 0.2);
    path();
    c.strokeStyle = ink;
    c.lineWidth = lw;
    c.stroke();
    c.restore();
  };
  const cut = (path: () => void, pattern: () => void) => {
    c.save();
    path();
    c.clip();
    c.fillStyle = bg;
    c.strokeStyle = bg;
    pattern();
    c.restore();
  };
  switch (o.kind) {
    case "arch": {
      const R = s * 0.5;
      const path = () => {
        c.beginPath();
        c.moveTo(-R, 0);
        c.arc(0, 0, R, Math.PI, 0);
        c.closePath();
      };
      outline(path);
      path();
      c.fillStyle = col;
      c.fill();
      cut(path, () => {
        const step = R * 0.19;
        for (let j = 0, y = -step * 0.5; y > -R; y -= step, j++)
          for (let x = -R + (j % 2 ? step / 2 : 0); x <= R; x += step) {
            c.beginPath();
            c.arc(x, y, step * 0.2, 0, TAU);
            c.fill();
          }
      });
      break;
    }
    case "column": {
      const cw = s * 0.34;
      const e = cw * 0.26;
      const path = () => {
        c.beginPath();
        c.moveTo(-cw / 2, -s + e);
        c.lineTo(-cw / 2, 0);
        c.ellipse(0, 0, cw / 2, e, 0, Math.PI, 0, true);
        c.lineTo(cw / 2, -s + e);
        c.ellipse(0, -s + e, cw / 2, e, 0, 0, Math.PI, true);
        c.closePath();
      };
      outline(path);
      path();
      c.fillStyle = col;
      c.fill();
      cut(path, () => {
        for (let y = -s + e * 2.6; y < -e * 0.2; y += s * 0.12)
          c.fillRect(-cw, y, cw * 2, s * 0.045);
      });
      c.beginPath();
      c.ellipse(0, -s + e, cw / 2, e, 0, 0, TAU);
      c.fillStyle = mix(col, ink, 0.5);
      c.fill();
      break;
    }
    case "pyramid": {
      const b = s * 0.5;
      const path = () => {
        c.beginPath();
        c.moveTo(-b, 0);
        c.lineTo(-b * 0.08, -s * 0.9);
        c.lineTo(b, 0);
        c.closePath();
      };
      outline(path);
      path();
      c.fillStyle = col;
      c.fill();
      cut(path, () => {
        c.lineWidth = s * 0.04;
        c.beginPath();
        for (let k = -9; k <= 9; k++) {
          const x = k * s * 0.11;
          c.moveTo(x - s, -s);
          c.lineTo(x + s, s);
        }
        c.stroke();
      });
      // The shaded face: a flat darker plane, like a folded card.
      c.save();
      path();
      c.clip();
      c.fillStyle = rgba("#000000", 0.18);
      c.beginPath();
      c.moveTo(-b * 0.08, -s * 0.9);
      c.lineTo(b, 0);
      c.lineTo(b * 0.25, 0);
      c.closePath();
      c.fill();
      c.restore();
      break;
    }
    case "ring": {
      const R = s * 0.5;
      const path = () => {
        c.beginPath();
        c.arc(0, -R, R, 0, TAU);
        c.arc(0, -R, R * 0.46, 0, TAU, true);
      };
      outline(path);
      path();
      c.fillStyle = col;
      c.fill("evenodd");
      break;
    }
    case "ball": {
      const R = s * 0.5;
      const path = () => {
        c.beginPath();
        c.arc(0, -R, R, 0, TAU);
      };
      outline(path);
      path();
      c.fillStyle = col;
      c.fill();
      cut(path, () => {
        c.lineWidth = s * 0.07;
        c.beginPath();
        c.arc(0, -R, R * 0.62, -2.4, -0.9);
        c.stroke();
      });
      break;
    }
    case "cube": {
      const q = s;
      const path = () => {
        c.beginPath();
        c.rect(-q / 2, -q, q, q);
      };
      outline(path);
      path();
      c.fillStyle = col;
      c.fill();
      c.fillStyle = bg;
      const n = 4;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if ((i + j) % 2)
            c.fillRect(-q / 2 + (i * q) / n, -q + (j * q) / n, q / n + 0.5, q / n + 0.5);
      break;
    }
  }
}

/** Bacterio-style squiggle pattern, baked once per size and colour pair. */
function bacterio(inkCol: string, u: number) {
  return (c: Ctx2D, w: number, h: number) => {
    const r = rng(33);
    c.strokeStyle = inkCol;
    c.fillStyle = inkCol;
    c.lineCap = "round";
    c.lineWidth = Math.max(1, u * 0.004);
    const n = Math.round((w * h) / (u * u * 0.0016));
    for (let i = 0; i < n; i++) {
      const x = r() * w;
      const y = r() * h;
      const s = u * (0.008 + r() * 0.012);
      const a = r() * TAU;
      c.beginPath();
      if (r() < 0.35) {
        c.arc(x, y, s * 0.28, 0, TAU);
        c.fill();
      } else {
        c.moveTo(x + Math.cos(a) * -s, y + Math.sin(a) * -s);
        c.quadraticCurveTo(x + Math.cos(a + 1.3) * s * 0.7, y + Math.sin(a + 1.3) * s * 0.7, x, y);
        c.quadraticCurveTo(
          x + Math.cos(a - 1.8) * s * 0.7,
          y + Math.sin(a - 1.8) * s * 0.7,
          x + Math.cos(a) * s,
          y + Math.sin(a) * s,
        );
        c.stroke();
      }
    }
  };
}

type Bit = {
  x: number;
  y: number;
  kind: number;
  color: number;
  size: number;
  rot: number;
  spin: number;
  ph: number;
};
const bitsFor = (seed: number) =>
  once(`memphis-bits:${seed}`, () => {
    const r = rng(seed);
    const out: Bit[] = [];
    for (let i = 0; i < 46; i++)
      out.push({
        x: r(),
        y: r(),
        kind: Math.floor(r() * 3),
        color: Math.floor(r() * 5),
        size: 0.012 + r() * 0.014,
        rot: r() * TAU,
        spin: r() < 0.5 ? -1 : 1,
        ph: r(),
      });
    return out;
  });

export const style: MotionStyle = {
  id: "memphis",
  name: "Memphis Milano",
  family: "Design Movements",
  tagline: "Pink, teal and squiggles",
  look: "80s Memphis Group: a shelf of pink, teal and yellow forms with dots, stripes and checks, squiggles and confetti.",
  move: "The forms hop in a wave along the shelf with squash and stretch, the squiggle wiggles, confetti flips; loud but choreographed.",
  rules: [
    "Four inks plus cream: pink, teal, yellow, lilac; patterns cut in the ground colour.",
    "Every solid form carries a pattern: dots, stripes, hatching or checks.",
    "Offset outlines in cream, a hair out of register, never soft shadows.",
    "Squash on landing, stretch in the air, a crouch before each take-off.",
    "Hops run as a wave along the shelf, never all at once.",
    "One chunky word with a hard offset shadow; confetti keeps off it.",
    "A big flat disc and a Bacterio-pattern panel hold the back plane.",
  ],
  prompt: `R — References
• The Memphis Group, Milan 1981: Ettore Sottsass furniture, Nathalie Du Pasquier and the Bacterio laminate (search: Memphis Milano 1981, Bacterio pattern).
• 80s Memphis-revival motion loops: bouncing primitives, squiggles, confetti.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a shelf of bold forms (a striped teal column, a dotted pink arch, a hatched yellow pyramid, a lilac ring, a checker cube, a ball) stands under the word "{{name}}", with a big disc and a squiggle-pattern panel behind.
• Middle (1.5–3.5 s): the forms hop in a wave along the shelf with squash and stretch; a squiggle wiggles; a zigzag rocks; confetti flips.
• End (3.5–5 s): the second wave rolls through and every form lands exactly where it started.

S — Style
Looks: {{bg}} ground; inks {{accent}}, {{accent2}}, a yellow and a lilac between them, {{ink}} cream; patterns cut in the ground colour; cream offset outlines; {{font}} (or Rubik Mono One) with a hard {{accent}} offset shadow.
Moves: two hops per loop per form, staggered as a wave; squash 20% on landing with a quick wobble, 14% stretch at speed, a small crouch before take-off.
Rules:
1. Every form has a pattern: dots, stripes, hatching or checks.
2. Offset outlines, not soft shadows.
3. Squash, stretch and anticipation on every hop.
4. The hops travel as a wave.
5. Confetti never covers the word.
6. Grain on the ground; flat, printed inks.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no form covers the word; squash reads on landing frames; the patterns stay crisp at tile size; the frame is busy but balanced. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Memphis_Group",
  theme: {
    bg: "#16121b",
    ink: "#fbf0e1",
    accent: "#ff5c9d",
    accent2: "#23c2b0",
    font: FAMILY,
  },
  fonts: ["Rubik Mono One"],
  tags: [
    "memphis",
    "80s",
    "retro",
    "squiggle",
    "confetti",
    "pattern",
    "bouncy",
    "playful",
    "shapes",
    "pop",
    "sottsass",
    "design movement",
  ],
  word: "Memphis",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const S = scene(w, h);
    ctx.drawImage(
      bake(
        `memphis-stock:${theme.bg}${theme.ink}`,
        w,
        h,
        stock(theme, 7, 0.8, 0.6),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.45, h * 0.35, Math.max(w, h) * 0.8, theme.accent, 0.06);
    const pal = palette(theme);
    const lw = Math.max(1, u * 0.0032);

    // Back plane: a big lilac disc, slowly turning stripes inside it.
    {
      const [x, y, r] = S.disc;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = pal[3];
      ctx.fill();
      ctx.clip();
      ctx.translate(x, y);
      ctx.rotate(-0.5);
      ctx.fillStyle = rgba(theme.bg, 0.22);
      // Stripes drift exactly one period per loop.
      const step = r * 0.18;
      const drift = step * (t / LOOP);
      for (let k = -9; k <= 8; k++) ctx.fillRect(-r * 1.2, k * step + drift, r * 2.4, step * 0.34);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x + r * 0.06, y - r * 0.02, r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    // Back plane: a tilted pink panel printed with the Bacterio squiggle.
    {
      const [x, y, pw, ph, a] = S.panel;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = mix(theme.accent, theme.bg, 0.12);
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      const tex = bake(`memphis-bact:${theme.bg}@${Math.round(u)}`, pw, ph, bacterio(theme.bg, u));
      ctx.globalAlpha = 0.85;
      ctx.drawImage(tex as CanvasImageSource, -pw / 2, -ph / 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = lw;
      ctx.strokeRect(-pw / 2 - u * 0.012, -ph / 2 + u * 0.012, pw, ph);
      ctx.restore();
    }

    // The word: cream with a hard pink offset shadow, letters hopping in turn.
    const word = wordFor(theme.name, "Memphis", 12).toUpperCase();
    const wt = theme.font === FAMILY ? 400 : 800;
    const size = fitBox(ctx, word, S.word.w, S.word.hMax, wt, theme.font, FALLBACK);
    ctx.font = font(wt, size, theme.font, FALLBACK);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const letters = [...word];
    const widths = letters.map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    const wx0 = S.word.align === "center" ? S.word.x - total / 2 : S.word.x;
    const box = {
      x0: wx0 - size * 0.3,
      x1: wx0 + total + size * 0.3,
      y0: S.word.y - size * 1.1,
      y1: S.word.y + size * 0.9,
    };

    // Confetti in the air, never over the word.
    const bits = bitsFor(19);
    for (const b of bits) {
      const x = b.x * w;
      const y = b.y * h * 0.8;
      if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) continue;
      const s = b.size * u;
      const flip = Math.cos(TAU * ((t / LOOP) * 2 + b.ph));
      ctx.save();
      ctx.translate(x, y + Math.sin(TAU * (t / LOOP + b.ph)) * u * 0.01);
      ctx.rotate(b.rot + b.spin * (TAU / 4) * Math.sin(TAU * (t / LOOP) + b.ph * 3));
      ctx.scale(1, 0.25 + 0.75 * Math.abs(flip));
      ctx.fillStyle = pal[b.color];
      ctx.strokeStyle = pal[b.color];
      if (b.kind === 0) ctx.fillRect(-s * 1.1, -s * 0.24, s * 2.2, s * 0.48);
      else if (b.kind === 1) {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.62);
        ctx.lineTo(s * 0.58, s * 0.42);
        ctx.lineTo(-s * 0.58, s * 0.42);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.lineWidth = s * 0.3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.quadraticCurveTo(-s * 0.5, -s * 0.8, 0, 0);
        ctx.quadraticCurveTo(s * 0.5, s * 0.8, s, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    let x = wx0;
    for (let i = 0; i < letters.length; i++) {
      const k = hop(t, 2, 0.62 - i * 0.045);
      const lift = size * 0.07 * k.lift;
      ctx.save();
      ctx.translate(x + widths[i] / 2, S.word.y - lift);
      ctx.scale(1 + (k.sx - 1) * 0.35, 1 + (k.sy - 1) * 0.35);
      ctx.fillStyle = theme.accent;
      ctx.fillText(letters[i], -widths[i] / 2 + size * 0.075, size * 0.075);
      ctx.fillStyle = theme.ink;
      ctx.fillText(letters[i], -widths[i] / 2, 0);
      ctx.restore();
      x += widths[i];
    }
    const cap = Math.max(7, size * 0.17);
    ctx.font = font(wt, cap, theme.font, FALLBACK);
    ctx.fillStyle = rgba(theme.ink, 0.72);
    ctx.textAlign = S.word.align === "center" ? "center" : "left";
    ctx.fillText(
      "MILANO 1981",
      S.word.align === "center" ? S.word.x : wx0 + size * 0.04,
      S.word.y + size * 0.62,
    );
    ctx.textAlign = "left";

    // Floating zigzag and squiggle.
    {
      const [zx, zy, zs, za] = S.zig;
      ctx.save();
      ctx.translate(zx, zy + Math.sin(TAU * (t / LOOP) * 2) * u * 0.012);
      ctx.rotate(za + Math.sin(TAU * (t / LOOP) * 2 + 1) * 0.08);
      const n = 6;
      const A = zs * 0.1;
      const zig = () => {
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const px = -zs / 2 + (i * zs) / n;
          const py = i % 2 ? -A : A;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      };
      ctx.lineJoin = "miter";
      ctx.save();
      ctx.translate(zs * 0.035, zs * 0.03);
      zig();
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
      zig();
      ctx.strokeStyle = pal[2];
      ctx.lineWidth = zs * 0.07;
      ctx.stroke();
      ctx.restore();
    }
    {
      const [qx, qy, qs, qa] = S.squig;
      ctx.save();
      ctx.translate(qx, qy);
      ctx.rotate(qa);
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const px = -qs / 2 + (i * qs) / 64;
        const py = Math.sin((i / 64) * TAU * 2 + TAU * (t / LOOP) * 2) * qs * 0.08;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = theme.ink;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = qs * 0.05;
      ctx.stroke();
      ctx.restore();
    }

    // Shelves: a cream edge over a checker band; forms hop in a wave.
    for (const shelf of S.shelves) {
      const band = u * 0.022;
      ctx.fillStyle = theme.ink;
      ctx.fillRect(shelf.x0, shelf.y, shelf.x1 - shelf.x0, u * 0.008);
      const cells = Math.floor((shelf.x1 - shelf.x0) / band);
      for (let i = 0; i < cells; i++)
        if (i % 2 === 0) ctx.fillRect(shelf.x0 + i * band, shelf.y + u * 0.008, band, band);
      for (const [ci, fx] of shelf.items) {
        const o = CAST[ci];
        const s = S.unit * o.size * shelf.scale;
        const px = shelf.x0 + (shelf.x1 - shelf.x0) * fx;
        const k = hop(t, 2, 0.5 - fx * 0.55);
        const jump = s * 0.3 * k.lift;
        ctx.save();
        ctx.fillStyle = rgba("#000000", 0.4);
        ctx.beginPath();
        ctx.ellipse(px, shelf.y - u * 0.002, s * 0.38 * (1 - k.lift * 0.3), u * 0.008, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(px, shelf.y - jump);
        ctx.scale(k.sx, k.sy);
        form(ctx, o, s, pal[o.color], theme.ink, theme.bg, lw);
        ctx.restore();
      }
    }

    const mark = tintedLogo(theme, theme.ink, u * 0.07, u * 0.07);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w - u * 0.12, u * 0.05);

    tooth(ctx, w, h, 0.4, 7);
    finish(ctx, w, h, t, 0.42, 0.3);
  },
};
