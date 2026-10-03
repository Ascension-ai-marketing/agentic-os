import { contrast, mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  lerp,
  light,
  LOOP,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  darkPaper,
  polyPath,
  scissorQuad,
  stepped,
  tornLine,
  withShadow,
  type Pt,
} from "./_s1-helpers";

const FPS = 12;
const FACES: [string, number, string][] = [
  ["Anton", 400, '"Anton", Impact, sans-serif'],
  ["Abril Fatface", 400, '"Abril Fatface", Didot, serif'],
  ["Archivo Black", 400, '"Archivo Black", "Arial Black", sans-serif'],
  ["Bodoni Moda", 800, '"Bodoni Moda", Didot, serif'],
  ["Space Mono", 700, '"Space Mono", Menlo, monospace'],
  ["IM Fell English SC", 400, '"IM Fell English SC", Georgia, serif'],
];

type Scrap = {
  ch: string;
  face: number;
  paper: string;
  ink: string;
  pattern: 0 | 1 | 2 | 3;
  w: number;
  h: number;
  ax: number;
  tape: boolean;
  seed: number;
};

function palette(theme: Theme) {
  return {
    papers: [
      theme.ink,
      theme.accent,
      theme.accent2,
      mix(theme.ink, theme.accent2, 0.22),
      mix(theme.bg, theme.ink, 0.22),
      mix(theme.ink, theme.accent, 0.3),
      mix(mix(theme.ink, theme.accent, 0.16), theme.accent2, 0.08),
    ],
  };
}

function inkFor(theme: Theme, paper: string, i: number) {
  // Prefer a colour ink, but only when it reads on this paper.
  const order =
    i % 3 === 0
      ? [theme.accent, theme.bg, theme.ink]
      : i % 3 === 1
        ? [theme.bg, theme.accent2, theme.ink]
        : [theme.accent2, theme.ink, theme.bg];
  for (const c of order) if (c !== paper && contrast(c, paper) >= 3) return c;
  return contrast(theme.bg, paper) > contrast(theme.ink, paper) ? theme.bg : theme.ink;
}

/** Cut the letters: fonts, papers and sizes chosen per letter, seeded. */
function scraps(c: Ctx2D, theme: Theme, word: string, H: number): Scrap[] {
  const pal = palette(theme);
  const out: Scrap[] = [];
  for (let i = 0; i < word.length; i++) {
    const raw = word[i];
    if (raw === " ") continue;
    const ch = hash(i, 91) < 0.42 ? raw.toUpperCase() : raw.toLowerCase();
    const face = Math.floor(hash(i, 17) * FACES.length);
    const [fam, wt, fb] = FACES[face];
    const size = H * (0.72 + 0.28 * hash(i, 5));
    c.font = font(wt, size, fam, fb);
    const m = c.measureText(ch);
    const gw = Math.max(
      size * 0.35,
      (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width),
    );
    const paper = pal.papers[Math.floor(hash(i, 31) * pal.papers.length)];
    out.push({
      ch,
      face,
      paper,
      ink: inkFor(theme, paper, i),
      pattern: Math.floor(hash(i, 41) * 4) as 0 | 1 | 2 | 3,
      w: gw + H * (0.26 + 0.18 * hash(i, 7)),
      h: H * (1.02 + 0.2 * hash(i, 9)),
      ax: 0,
      tape: hash(i, 43) < 0.3,
      seed: 100 + i * 13,
    });
  }
  let x = 0;
  for (const s of out) {
    s.ax = x;
    x += s.w + H * 0.2;
  }
  return out;
}

/** Paint one letter scrap at local origin (0, 0) .. (w, h). */
function paintScrap(c: Ctx2D, theme: Theme, s: Scrap, H: number) {
  const quad = scissorQuad(0, 0, s.w, s.h, s.seed, H * 0.035);
  // One edge torn instead of cut, now and then.
  const torn = hash(s.seed, 3) < 0.45;
  const pts: Pt[] = torn
    ? [quad[0], quad[1], ...tornLine(quad[1], quad[2], s.seed, H * 0.02, H * 0.02), quad[3]]
    : quad;
  c.save();
  polyPath(c, pts);
  c.fillStyle = s.paper;
  c.fill();
  c.clip();
  // Printed matter on the scrap: halftone, stripes, or body-copy lines.
  const lum = s.paper === theme.accent || s.paper === theme.accent2 ? theme.bg : theme.bg;
  if (s.pattern === 1) {
    c.fillStyle = rgba(lum, 0.16);
    const p = H * 0.07;
    for (let y = 0; y < s.h + p; y += p)
      for (let x = (Math.round(y / p) % 2) * p * 0.5; x < s.w + p; x += p) {
        c.beginPath();
        c.arc(x, y, p * 0.22 * (0.5 + y / s.h), 0, TAU);
        c.fill();
      }
  } else if (s.pattern === 2) {
    c.fillStyle = rgba(lum, 0.12);
    const p = H * 0.09;
    for (let x = -s.h; x < s.w + s.h; x += p) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + p * 0.45, 0);
      c.lineTo(x + p * 0.45 + s.h * 0.4, s.h);
      c.lineTo(x + s.h * 0.4, s.h);
      c.fill();
    }
  } else if (s.pattern === 3) {
    c.fillStyle = rgba(lum, 0.14);
    const p = H * 0.05;
    for (let y = p; y < s.h; y += p)
      c.fillRect(H * 0.05, y, s.w * (0.5 + 0.45 * hash(s.seed, y | 0)), p * 0.3);
  }
  // Paper grain.
  const r = rng(s.seed);
  for (let i = 0; i < 40; i++) {
    c.fillStyle = r() < 0.5 ? rgba("#000000", 0.05) : rgba("#ffffff", 0.06);
    c.fillRect(r() * s.w, r() * s.h, H * 0.01, H * 0.01);
  }
  // The letter, printed on the scrap.
  const [fam, wt, fb] = FACES[s.face];
  const size = H * (0.72 + 0.28 * hash(s.seed, 5));
  c.font = font(wt, size, fam, fb);
  const m = c.measureText(s.ch);
  const asc = m.actualBoundingBoxAscent || size * 0.7;
  const desc = m.actualBoundingBoxDescent || 0;
  const left = m.actualBoundingBoxLeft || 0;
  const right = m.actualBoundingBoxRight || m.width;
  c.fillStyle = s.ink;
  c.textBaseline = "alphabetic";
  c.fillText(s.ch, (s.w - (left + right)) / 2 + left, (s.h - (asc + desc)) / 2 + asc);
  c.restore();
  // Cut edge: a thin light rim where the scissors went through the paper.
  polyPath(c, pts);
  c.strokeStyle = rgba("#ffffff", 0.22);
  c.lineWidth = Math.max(0.6, H * 0.008);
  c.stroke();
}

function atlasOf(theme: Theme, word: string, H: number) {
  return (c: Ctx2D) => {
    const list = scraps(c, theme, word, H);
    for (const s of list) {
      c.save();
      c.translate(s.ax + H * 0.1, H * 0.1);
      paintScrap(c, theme, s, H);
      if (s.tape) {
        c.fillStyle = rgba(theme.ink, 0.42);
        c.translate(s.w * 0.5, 0);
        c.rotate((hash(s.seed, 8) - 0.5) * 0.5);
        c.fillRect(-H * 0.2, -H * 0.06, H * 0.4, H * 0.13);
      }
      c.restore();
    }
  };
}

/** Background magazine scraps, painted once. */
function backScraps(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u, portrait } = frameOf(w, h);
    const items: { x: number; y: number; w: number; h: number; a: number; kind: number }[] =
      portrait
        ? [
            { x: 0.04, y: 0.05, w: 0.62, h: 0.26, a: -0.06, kind: 0 },
            { x: 0.55, y: 0.14, w: 0.42, h: 0.2, a: 0.08, kind: 1 },
            { x: 0.06, y: 0.7, w: 0.44, h: 0.24, a: 0.05, kind: 2 },
            { x: 0.5, y: 0.74, w: 0.46, h: 0.22, a: -0.07, kind: 3 },
          ]
        : [
            { x: 0.03, y: 0.06, w: 0.36, h: 0.4, a: -0.05, kind: 0 },
            { x: 0.66, y: 0.04, w: 0.3, h: 0.3, a: 0.07, kind: 1 },
            { x: 0.05, y: 0.62, w: 0.3, h: 0.34, a: 0.06, kind: 2 },
            { x: 0.62, y: 0.6, w: 0.34, h: 0.36, a: -0.05, kind: 3 },
          ];
    for (const [i, it] of items.entries()) {
      const W = it.w * w;
      const Hh = it.h * h;
      c.save();
      c.translate(it.x * w + W / 2, it.y * h + Hh / 2);
      c.rotate(it.a);
      c.translate(-W / 2, -Hh / 2);
      const quad = scissorQuad(0, 0, W, Hh, 700 + i, u * 0.01);
      const pts: Pt[] = [
        quad[0],
        ...tornLine(quad[0], quad[1], 70 + i, u * 0.012, u * 0.01),
        quad[2],
        quad[3],
      ];
      withShadow(c, u * 0.03, u * 0.006, u * 0.012, "rgba(0,0,0,0.55)", () => {
        polyPath(c, pts);
        c.fillStyle =
          it.kind === 1
            ? mix(theme.accent2, theme.bg, 0.25)
            : it.kind === 3
              ? mix(theme.accent, theme.bg, 0.3)
              : mix(theme.ink, theme.bg, 0.12);
        c.fill();
      });
      c.save();
      polyPath(c, pts);
      c.clip();
      if (it.kind === 0) {
        // A halftone photo: a sun low over a horizon, in coarse dots.
        const p = u * 0.018;
        c.fillStyle = mix(theme.bg, "#000000", 0.2);
        for (let y = 0; y < Hh + p; y += p)
          for (let x = (Math.round(y / p) % 2) * p * 0.5; x < W + p; x += p) {
            const dx = (x - W * 0.6) / W;
            const dy = (y - Hh * 0.45) / Hh;
            const sun = Math.hypot(dx * 1.4, dy) < 0.22 ? 0.05 : 0;
            const tone =
              y > Hh * 0.62
                ? 0.75 - 0.2 * Math.sin(x * 0.05)
                : 0.18 + 0.5 * (y / Hh) + sun - (Math.hypot(dx * 1.4, dy) < 0.22 ? 0.3 : 0);
            const rr = p * 0.5 * Math.sqrt(clamp(tone));
            if (rr < 0.3) continue;
            c.beginPath();
            c.arc(x, y, rr, 0, TAU);
            c.fill();
          }
      } else if (it.kind === 1) {
        c.fillStyle = rgba(theme.ink, 0.28);
        const p = u * 0.03;
        for (let x = -Hh; x < W + Hh; x += p * 2) {
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x + p, 0);
          c.lineTo(x + p + Hh * 0.6, Hh);
          c.lineTo(x + Hh * 0.6, Hh);
          c.fill();
        }
      } else if (it.kind === 2) {
        // Body copy: columns of grey lines with a headline bar.
        c.fillStyle = rgba(theme.bg, 0.75);
        c.fillRect(W * 0.08, Hh * 0.1, W * 0.6, u * 0.03);
        c.fillStyle = rgba(theme.bg, 0.3);
        const lh = u * 0.014;
        for (let col = 0; col < 2; col++)
          for (let y = Hh * 0.26; y < Hh * 0.92; y += lh)
            c.fillRect(W * (0.08 + col * 0.46), y, W * (0.38 - 0.12 * hash(col, y | 0)), lh * 0.45);
      } else {
        // Graph paper.
        c.strokeStyle = rgba(theme.ink, 0.22);
        c.lineWidth = Math.max(0.5, u * 0.0012);
        const p = u * 0.022;
        c.beginPath();
        for (let x = 0; x < W; x += p) {
          c.moveTo(x, 0);
          c.lineTo(x, Hh);
        }
        for (let y = 0; y < Hh; y += p) {
          c.moveTo(0, y);
          c.lineTo(W, y);
        }
        c.stroke();
      }
      c.restore();
      // Torn edge rim: the white core of the paper.
      c.beginPath();
      const tl = tornLine(quad[0], quad[1], 70 + i, u * 0.012, u * 0.01);
      tl.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.strokeStyle = rgba(theme.ink, 0.55);
      c.lineWidth = Math.max(0.8, u * 0.003);
      c.stroke();
      c.restore();
    }
    // Masking tape over two corners.
    const tapes: [number, number, number][] = portrait
      ? [
          [0.62, 0.07, 0.5],
          [0.1, 0.72, -0.4],
        ]
      : [
          [0.36, 0.1, 0.6],
          [0.64, 0.63, -0.5],
        ];
    for (const [tx, ty, ta] of tapes) {
      c.save();
      c.translate(tx * w, ty * h);
      c.rotate(ta);
      c.fillStyle = rgba(mix(theme.ink, theme.accent, 0.2), 0.55);
      const tw = u * 0.14;
      const th = u * 0.045;
      const edge = tornLine([-tw / 2, -th / 2], [-tw / 2, th / 2], 5, th * 0.12, th * 0.15);
      const edge2 = tornLine([tw / 2, th / 2], [tw / 2, -th / 2], 6, th * 0.12, th * 0.15);
      polyPath(c, [...edge, ...edge2]);
      c.fill();
      c.restore();
    }
  };
}

export const style: MotionStyle = {
  id: "collage-cutout",
  name: "Collage Cut-out",
  family: "Print & Craft",
  tagline: "A ransom-note collage",
  look: "Ransom-note collage: every letter scissored from a different magazine, over torn halftone scraps, graph paper and masking tape.",
  move: "Stop-motion at 12 fps: the scattered letters hop one by one into the word, hold, then scatter again along new arcs.",
  rules: [
    "Every letter comes from a different page: its own face, paper and ink.",
    "Scissor cuts are straight but never square; some edges are torn with a white core.",
    "Pieces cast soft shadows; a lifted piece casts a wider one.",
    "Animate on twos (12 fps) with a hair of jitter, like hands moving paper.",
    "Letters leave on different arcs than they arrived on.",
    "Background scraps carry real print: halftone, stripes, body copy, graph paper.",
    "Hold the finished word at least 1.5 s.",
  ],
  prompt: `R — References
• Ransom-note and punk zine collage (search: ransom note letters collage, Jamie Reid Sex Pistols artwork).
• Terry Gilliam's cut-out animation: paper moved frame by frame, soft shadows, a slight jitter.

I — Idea
Cut letters assemble into a word, 5 seconds, looping seamlessly:
• Beginning (0–1.9 s): letters cut from magazines lie scattered and tilted; one by one they hop in an arc and slap down into "{{name}}".
• Middle (1.9–3.7 s): the word holds, each scrap a different face and paper, a strip of tape here and there.
• End (3.7–5 s): the letters flick away along new arcs back to their scattered spots, landing on the opening frame.

S — Style
Looks: {{bg}} board; scraps in newsprint {{ink}}, {{accent}}, {{accent2}} and greys; each letter in a different display face; halftone photo, stripes, body copy and graph paper in the background scraps; masking tape; soft drop shadows.
Moves: 12 fps stop-motion; each hop is an arc with a lift (bigger shadow) and a small rotation overshoot on landing; staggered 0.16 s apart.
Rules:
1. One face and paper per letter.
2. Scissor cuts slightly off square; some torn edges with a white core.
3. Soft shadows, wider when lifted.
4. 12 fps with slight jitter.
5. Different arcs in and out.
6. Hold the word 1.5 s or more.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word reads at 2.5 s; no letter is clipped inside its scrap; every scrap has a shadow; the frame is never empty. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Collage",
  theme: {
    bg: "#151311",
    ink: "#f0e9dc",
    accent: "#ff5a36",
    accent2: "#3a6fe2",
    font: "Anton",
  },
  fonts: [
    "Anton",
    "Abril Fatface",
    "Archivo Black",
    "Space Mono:wght@700",
    "IM Fell English SC",
    "Bodoni Moda:opsz,wght@6..96,400..900",
  ],
  tags: [
    "collage",
    "cutout",
    "cut-out",
    "ransom",
    "zine",
    "punk",
    "magazine",
    "paper",
    "scrapbook",
    "stop motion",
    "type",
    "handmade",
  ],
  word: "Collage",
  render(ctx, t, theme, w, h) {
    const { u, portrait, square } = frameOf(w, h);
    const { frame, tq } = stepped(t, FPS);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `col-board:${theme.bg}${theme.ink}`,
        w,
        h,
        darkPaper(theme, 3, { fibres: 0.4, tone: 0.02 }),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.5, h * 0.4, Math.max(w, h) * 0.8, theme.ink, 0.06);

    // Background scraps shuffle a little on their own (stop-motion rearranging).
    const back = bake(
      `col-back:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
      w,
      h,
      backScraps(theme),
    );
    const nudge = Math.sin(TAU * (tq / LOOP)) * u * 0.006;
    ctx.drawImage(back as CanvasImageSource, nudge, -nudge * 0.5);

    const word = wordFor(theme.name, "Collage", 10);
    const letters = word.replace(/\s+/g, "").length;
    // Break into two rows only between words (or for a very long single word in 9:16).
    const parts = word.trim().split(/\s+/);
    const wrap = parts.length > 1 && (portrait || square || letters > 9);
    const rows = wrap || (portrait && letters > 9) ? 2 : 1;
    const perRow = wrap
      ? parts.slice(0, Math.ceil(parts.length / 2)).join("").length
      : Math.ceil(letters / rows);
    // Letter height from the space available.
    const H0 = Math.min(
      h * (rows === 2 ? 0.2 : portrait ? 0.2 : 0.3),
      (w * 0.92) / (Math.max(perRow, letters - perRow) * 0.9),
    );
    const list = scraps(ctx, theme, word, H0);
    // Row layout.
    const rowsOf: Scrap[][] = [];
    for (let r = 0; r < rows; r++)
      rowsOf.push(r === 0 ? list.slice(0, perRow) : list.slice(perRow));
    const widthOf = (row: Scrap[]) =>
      row.reduce((a, s) => a + s.w, 0) + (row.length - 1) * H0 * 0.08;
    const maxW = Math.max(...rowsOf.map(widthOf));
    const k = Math.min(1, (w * 0.9) / maxW);
    const H = H0 * k;
    const L = scraps(ctx, theme, word, H);
    const last = L[L.length - 1];
    const atlasW = (last ? last.ax + last.w : 1) + H * 0.4;
    const atlas = bake(
      `col-atlas:${word}|${theme.ink}${theme.accent}${theme.accent2}${theme.bg}`,
      atlasW,
      H * 1.6,
      atlasOf(theme, word, H),
    );
    const rowH = H * 1.35;
    const y0 = h / 2 - ((rows - 1) * rowH) / 2 + h * 0.01;

    const logo = tintedLogo(theme, rgba(theme.ink, 0.9), u * 0.08, u * 0.08);
    if (logo) ctx.drawImage(logo as CanvasImageSource, w - u * 0.13, h - u * 0.13);

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row = r === 0 ? L.slice(0, perRow) : L.slice(perRow);
      const rw = row.reduce((a, s) => a + s.w, 0) + (row.length - 1) * H * 0.08;
      let x = w / 2 - rw / 2;
      for (const s of row) {
        const i = idx++;
        // Home in the word, with a small permanent tilt and offset.
        const hx = x + s.w / 2;
        const hy = y0 + r * rowH + (hash(i, 61) - 0.5) * H * 0.12;
        const ha = (hash(i, 67) - 0.5) * 0.12;
        x += s.w + H * 0.08;
        // Scattered spot around the edges.
        const side = i % 4;
        const sx =
          side === 0
            ? w * (0.08 + 0.2 * hash(i, 3))
            : side === 1
              ? w * (0.72 + 0.2 * hash(i, 3))
              : w * (0.2 + 0.6 * hash(i, 3));
        const sy =
          side === 2
            ? h * (0.1 + 0.08 * hash(i, 4))
            : side === 3
              ? h * (0.84 + 0.08 * hash(i, 4))
              : h * (0.2 + 0.6 * hash(i, 4));
        const sa = (hash(i, 71) - 0.5) * 1.1;
        // Timing: in with a stagger, hold, out with a quicker stagger.
        const tin = 0.25 + i * (1.45 / Math.max(1, letters));
        const tout = 3.75 + i * (0.8 / Math.max(1, letters));
        const pin = ease.inOutCubic(seg(tq, tin, tin + 0.42));
        const pout = ease.inOutCubic(seg(tq, tout, tout + 0.36));
        const p = pin * (1 - pout);
        const inbound = pout <= 0;
        const lift = Math.sin(Math.PI * (inbound ? pin : pout));
        const arc = (inbound ? -1 : 1) * lift * H * 0.9;
        const px = lerp(sx, hx, p);
        const py = lerp(sy, hy, p) + arc;
        const settle =
          inbound && pin >= 1
            ? Math.sin(clamp((tq - tin - 0.42) / 0.2) * Math.PI) *
              0.06 *
              (1 - clamp((tq - tin - 0.42) / 0.2))
            : 0;
        const ang = lerp(sa, ha, p) + (inbound ? 1 : -1) * lift * 0.5 + settle;
        const jit = (hash(frame, i, 5) - 0.5) * u * 0.002;
        const scale = 1 + lift * 0.14;
        ctx.save();
        ctx.translate(px + jit, py - jit);
        ctx.rotate(ang);
        ctx.scale(scale, scale);
        withShadow(
          ctx,
          u * (0.012 + lift * 0.035),
          u * (0.004 + lift * 0.02),
          u * (0.008 + lift * 0.035),
          `rgba(0,0,0,${(0.55 - lift * 0.15).toFixed(3)})`,
          () => {
            ctx.drawImage(
              atlas as CanvasImageSource,
              s.ax + H * 0.1 - H * 0.1,
              0,
              s.w + H * 0.2,
              H * 1.6,
              -s.w / 2 - H * 0.1,
              -s.h / 2 - H * 0.1,
              s.w + H * 0.2,
              H * 1.6,
            );
          },
        );
        ctx.restore();
      }
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
