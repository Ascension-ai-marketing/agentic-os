import { adjust, mix, rgba } from "../engine/color";
import {
  bake,
  font,
  frameOf,
  grain,
  ground,
  hash,
  LOOP,
  makeCanvas,
  context,
  once,
  rng,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { fitFont, frameIndex, speckleTile, tileFill, type Pt } from "./_s2-helpers";

/**
 * A comic page on black gutters: a skyline panel with a caption box, a panel
 * of speed lines with a bolt zipping through, and the hero panel where an SFX
 * burst takes two hits per loop. Bold ink, Ben-Day dots, misregistered colour.
 */
const SFX = '"Bangers", "Impact", sans-serif';
const CAPTION = '"Comic Neue", "Comic Sans MS", sans-serif';
const IMPACTS: [number, number][] = [
  [0.32, 1],
  [2.82, 0.55],
];

type Rect = { x: number; y: number; w: number; h: number };

function panels(w: number, h: number): { A: Rect; B: Rect; C: Rect } {
  const { u, portrait, square } = frameOf(w, h);
  const g = u * 0.022;
  const m = u * 0.045;
  if (portrait) {
    const top = h * 0.07;
    const bottom = h * 0.93;
    const A: Rect = { x: m, y: top, w: w - m * 2, h: (bottom - top) * 0.28 };
    const B: Rect = { x: m, y: A.y + A.h + g, w: w - m * 2, h: (bottom - top) * 0.16 };
    const C: Rect = { x: m, y: B.y + B.h + g, w: w - m * 2, h: bottom - (B.y + B.h + g) };
    return { A, B, C };
  }
  if (square) {
    const top = h * 0.07;
    const bottom = h * 0.93;
    const A: Rect = { x: m, y: top, w: (w - m * 2 - g) * 0.42, h: (bottom - top) * 0.36 };
    const B: Rect = { x: A.x + A.w + g, y: top, w: w - m * 2 - g - A.w, h: A.h };
    const C: Rect = { x: m, y: top + A.h + g, w: w - m * 2, h: bottom - top - A.h - g };
    return { A, B, C };
  }
  const top = h * 0.08;
  const bottom = h * 0.92;
  const A: Rect = { x: m, y: top, w: (w - m * 2 - g) * 0.3, h: bottom - top };
  const B: Rect = { x: A.x + A.w + g, y: top, w: w - m * 2 - g - A.w, h: (bottom - top - g) * 0.3 };
  const C: Rect = { x: B.x, y: B.y + B.h + g, w: B.w, h: bottom - top - g - B.h };
  return { A, B, C };
}

/** Ben-Day dots: one colour, one size, on an offset grid (tiles seamlessly). */
function dotTile(color: string, cell: number, r: number): AnyCanvas {
  const C = Math.max(4, Math.round(cell));
  return once(`comic-dots:${color}:${C}:${r.toFixed(3)}`, () => {
    const c = makeCanvas(C, C);
    const g = context(c);
    g.fillStyle = color;
    for (const [x, y] of [
      [0, 0],
      [C, 0],
      [0, C],
      [C, C],
      [C / 2, C / 2],
    ]) {
      g.beginPath();
      g.arc(x, y, C * r, 0, TAU);
      g.fill();
    }
    return c;
  });
}

function dotsIn(c: Ctx2D, R: Rect, color: string, cell: number, r: number, alpha = 1) {
  const pat = c.createPattern(dotTile(color, cell, r) as CanvasImageSource, "repeat");
  if (!pat) return;
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = pat;
  c.fillRect(R.x, R.y, R.w, R.h);
  c.restore();
}

/** Impact envelope: 0 at rest, a damped kick after each hit. */
function kick(t: number) {
  let s = 0;
  for (const [t0, amp] of IMPACTS) {
    const d = t - t0;
    if (d < 0 || d > 1.2) continue;
    s += amp * Math.exp(-d * 7) * Math.cos(d * 26);
  }
  return s;
}

function burstPts(cx: number, cy: number, rx: number, ry: number, n: number, seed: number): Pt[] {
  const r = rng(seed);
  const out: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU - Math.PI / 2;
    const k = i % 2 === 0 ? 1 + r() * 0.16 : 0.66 + r() * 0.1;
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}

function poly(c: Ctx2D, pts: Pt[]) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}

/** The skyline panel: dotted night sky, black towers, lit windows, a caption box. */
function skyline(theme: Theme, pal: ReturnType<typeof colours>) {
  return (c: Ctx2D, w: number, h: number) => {
    const { A } = panels(w, h);
    const { u } = frameOf(w, h);
    c.save();
    c.beginPath();
    c.rect(A.x, A.y, A.w, A.h);
    c.clip();
    const sky = c.createLinearGradient(0, A.y, 0, A.y + A.h);
    sky.addColorStop(0, pal.blueDeep);
    sky.addColorStop(1, pal.blue);
    c.fillStyle = sky;
    c.fillRect(A.x, A.y, A.w, A.h);
    dotsIn(c, A, pal.blueDeep, u * 0.018, 0.3, 0.9);
    const r = rng(616);
    const base = A.y + A.h;
    let x = A.x - u * 0.02;
    while (x < A.x + A.w) {
      const bw = u * (0.06 + r() * 0.07);
      const bh = A.h * (0.25 + r() * 0.45);
      c.fillStyle = pal.black;
      c.fillRect(x + u * 0.003, base - bh + u * 0.002, bw, bh);
      c.fillRect(x, base - bh, bw, bh);
      if (r() < 0.4) c.fillRect(x + bw * 0.4, base - bh - u * 0.04, u * 0.006, u * 0.04);
      for (let wy = base - bh + u * 0.02; wy < base - u * 0.02; wy += u * 0.028)
        for (let wx = x + u * 0.012; wx < x + bw - u * 0.012; wx += u * 0.022)
          if (r() < 0.45) {
            c.fillStyle = pal.yellow;
            c.fillRect(wx, wy, u * 0.009, u * 0.013);
          }
      x += bw + u * 0.004;
    }
    c.restore();
  };
}

function colours(theme: Theme) {
  return {
    yellow: theme.accent,
    blue: theme.accent2,
    blueDeep: mix(theme.accent2, theme.bg, 0.55),
    red: adjust(theme.accent, -0.12, 1.15, -62),
    redDeep: adjust(theme.accent, -0.3, 1.1, -62),
    white: theme.ink,
    black: mix(theme.bg, "#000000", 0.6),
  };
}

export const style: MotionStyle = {
  id: "comic-ink",
  name: "Comic Ink",
  family: "Paint & Draw",
  tagline: "Bold ink, Ben-Day dots, an SFX",
  look: "A comic page on black gutters: bold ink, Ben-Day dots, a skyline caption panel, speed lines and an SFX burst in 3D lettering.",
  move: "Focus lines boil on twos, a bolt zips through the speed-line panel, and the SFX burst takes a hit: flash frame, shake, bounce, flying stars.",
  rules: [
    "Black ink outlines every shape, thick and even.",
    "Tone is Ben-Day dots: one size, one colour, never a smooth gradient.",
    "Colour prints slightly off register from the ink.",
    "Focus lines and speed lines redraw on twos, like printed animation.",
    "The SFX word is 3D lettered: fill, extrusion, heavy outline.",
    "Impacts get one inverted flash frame, a shake and a damped bounce.",
    "Few words: the SFX and one caption.",
  ],
  prompt: `R — References
• Silver Age comics and Roy Lichtenstein's panels (search: Ben-Day dots comic, comic SFX burst lettering, manga focus lines).
• Printed comics: black gutters, off-register colour, newsprint grain.

I — Idea
One page, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): three panels on black gutters: a dotted night skyline with a "MEANWHILE..." caption, a panel of speed lines, and the hero panel where an SFX burst reading "{{name}}!" takes a hit: one inverted flash frame, a shake, a bounce, stars flying out.
• Middle (1.5–3.5 s): focus lines boil, a bolt zips through the speed lines, windows flicker; a second, smaller hit lands.
• End (3.5–5 s): everything settles back to the resting page the loop began on.

S — Style
Looks: {{bg}} gutters; {{ink}} paper-white burst; {{accent}} yellow SFX fill with a red extrusion mixed from {{accent}}; {{accent2}} Ben-Day skies; thick black ink; Bangers lettering; a Comic Neue caption.
Moves: animate the lines on twos; each hit is a damped spring (overshoot then settle) plus a 2–3 frame shake; flash exactly one frame; the bolt crosses once per loop.
Rules:
1. Heavy black outlines everywhere.
2. Ben-Day dots for tone.
3. Colour off register from the ink.
4. Lines redraw on twos.
5. 3D SFX lettering.
6. One flash frame per hit, then a spring.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the SFX word is fully inside the burst and legible; the caption box text fits; dots read as dots at full size; panels keep their gutters at every aspect. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Ben-Day_process",
  theme: {
    bg: "#0c0c0f",
    ink: "#fff6e3",
    accent: "#ffd21f",
    accent2: "#1f97e0",
    font: "Bangers",
  },
  fonts: ["Bangers", "Comic Neue:wght@700"],
  tags: [
    "comic",
    "comics",
    "pop art",
    "lichtenstein",
    "ben-day",
    "halftone",
    "manga",
    "sfx",
    "pow",
    "ink",
    "superhero",
    "retro",
  ],
  word: "Pow",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const { A, B, C } = panels(w, h);
    const pal = colours(theme);
    const frame = frameIndex(t, 12);
    const reg = u * 0.0022;
    ground(ctx, w, h, theme.bg);

    // Panel A: the skyline, baked, with a few windows flickering on twos.
    ctx.drawImage(
      bake(
        `comic-sky:${theme.bg}${theme.accent}${theme.accent2}`,
        w,
        h,
        skyline(theme, pal),
      ) as CanvasImageSource,
      0,
      0,
    );
    for (let i = 0; i < 5; i++) {
      if (hash(i, frame >> 1, 17) < 0.5) continue;
      ctx.fillStyle = pal.black;
      ctx.fillRect(
        A.x + A.w * (0.1 + 0.18 * i),
        A.y + A.h * (0.62 + 0.06 * ((i * 3) % 4)),
        u * 0.009,
        u * 0.013,
      );
    }
    // Caption box.
    const cap = "MEANWHILE...";
    const capCss = (s: number) => font(700, s, "Comic Neue", CAPTION);
    const capSize = fitFont(ctx, cap, A.w * 0.72, u * 0.042, capCss);
    const cb: Rect = {
      x: A.x + u * 0.02,
      y: A.y + u * 0.02,
      w: Math.min(A.w - u * 0.04, capSize * 7.4),
      h: capSize * 1.9,
    };
    ctx.fillStyle = pal.yellow;
    ctx.fillRect(cb.x + reg, cb.y + reg, cb.w, cb.h);
    ctx.strokeStyle = pal.black;
    ctx.lineWidth = u * 0.005;
    ctx.strokeRect(cb.x, cb.y, cb.w, cb.h);
    ctx.fillStyle = pal.black;
    ctx.font = capCss(capSize);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(cap, cb.x + capSize * 0.45, cb.y + cb.h * 0.54);

    // Panel B: speed lines streaming left, a bolt zipping across once a loop.
    ctx.save();
    ctx.beginPath();
    ctx.rect(B.x, B.y, B.w, B.h);
    ctx.clip();
    ctx.fillStyle = pal.white;
    ctx.fillRect(B.x, B.y, B.w, B.h);
    dotsIn(ctx, B, mix(pal.yellow, pal.white, 0.2), u * 0.016, 0.28);
    const lines = 26;
    for (let i = 0; i < lines; i++) {
      const y = B.y + (B.h * (i + 0.5)) / lines + (hash(i, frame, 3) - 0.5) * u * 0.006;
      const len = B.w * (0.2 + 0.5 * hash(i, frame, 5));
      const x = B.x + B.w * hash(i, frame, 7) - len * 0.3;
      ctx.strokeStyle = pal.black;
      ctx.lineWidth = u * (0.002 + 0.004 * hash(i, 9));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
    // The bolt: crosses the panel once per loop, entering and leaving off-panel.
    const bx = B.x - B.w * 0.3 + (B.w * 1.6 * (t % LOOP)) / LOOP;
    const by = B.y + B.h * 0.5;
    const bs = Math.min(B.h * 0.44, u * 0.15);
    // Motion trail: heavy streaks behind the bolt.
    ctx.fillStyle = pal.black;
    for (let i = 0; i < 5; i++) {
      const ty = by + (i - 2) * bs * 0.32;
      const tl = bs * (2.2 + 1.4 * hash(i, 71));
      ctx.beginPath();
      ctx.moveTo(bx - bs * 0.2, ty - u * 0.004);
      ctx.lineTo(bx - bs * 0.2 - tl, ty);
      ctx.lineTo(bx - bs * 0.2, ty + u * 0.004);
      ctx.closePath();
      ctx.fill();
    }
    const bolt: Pt[] = [
      [bx + bs * 0.3, by - bs],
      [bx - bs * 0.35, by + bs * 0.1],
      [bx + bs * 0.05, by + bs * 0.1],
      [bx - bs * 0.3, by + bs],
      [bx + bs * 0.4, by - bs * 0.15],
      [bx, by - bs * 0.15],
    ];
    const logo = tintedLogo(theme, pal.black, bs * 1.6, bs * 1.6);
    ctx.fillStyle = pal.yellow;
    poly(
      ctx,
      bolt.map(([x, y]) => [x + reg, y + reg] as Pt),
    );
    ctx.fill();
    ctx.strokeStyle = pal.black;
    ctx.lineWidth = u * 0.006;
    ctx.lineJoin = "round";
    poly(ctx, bolt);
    ctx.stroke();
    if (logo)
      ctx.drawImage(logo as CanvasImageSource, bx + bs * 0.7, by - bs * 0.8, bs * 1.6, bs * 1.6);
    ctx.restore();

    // Panel C: focus lines, the burst, the SFX.
    const k = kick(t);
    const flash = IMPACTS.some(([t0]) => t >= t0 && t < t0 + 1 / 12);
    const shake = IMPACTS.reduce((s, [t0, amp]) => {
      const d = t - t0;
      return d >= 0 && d < 0.25 ? s + amp * (1 - d / 0.25) : s;
    }, 0);
    const sx = (hash(frame, 41) - 0.5) * u * 0.03 * shake;
    const sy = (hash(frame, 43) - 0.5) * u * 0.03 * shake;
    ctx.save();
    ctx.beginPath();
    ctx.rect(C.x, C.y, C.w, C.h);
    ctx.clip();
    ctx.translate(sx, sy);
    const bg = flash ? pal.black : pal.blue;
    ctx.fillStyle = bg;
    ctx.fillRect(C.x - u * 0.05, C.y - u * 0.05, C.w + u * 0.1, C.h + u * 0.1);
    if (!flash)
      dotsIn(
        ctx,
        { x: C.x - u * 0.05, y: C.y - u * 0.05, w: C.w + u * 0.1, h: C.h + u * 0.1 },
        pal.blueDeep,
        u * 0.02,
        0.32,
      );
    const cx = C.x + C.w * 0.5;
    const cy = C.y + C.h * 0.52;
    // Focus lines: wedges from the panel edge toward the burst, redrawn on twos.
    ctx.fillStyle = flash ? pal.white : pal.black;
    const R = Math.hypot(C.w, C.h);
    const nL = 64;
    for (let i = 0; i < nL; i++) {
      const a = (i / nL) * TAU + (hash(i, frame, 11) - 0.5) * 0.05;
      const inner = R * (0.24 + 0.12 * hash(i, frame, 13));
      const wid = 0.012 + 0.018 * hash(i, frame, 19);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a - wid) * R, cy + Math.sin(a - wid) * R);
      ctx.lineTo(cx + Math.cos(a + wid) * R, cy + Math.sin(a + wid) * R);
      ctx.closePath();
      ctx.fill();
    }
    // The burst: squash before the hit, spring after.
    const scale = 1 + 0.16 * k;
    const brx = Math.min(C.w * 0.4, C.h * 0.62) * scale;
    const bry = Math.min(C.h * 0.4, C.w * 0.3) * scale;
    const burst = burstPts(cx, cy, brx, bry, 14, 77);
    ctx.fillStyle = pal.black;
    poly(
      ctx,
      burst.map(([x, y]) => [x + u * 0.012, y + u * 0.014] as Pt),
    );
    ctx.fill();
    ctx.fillStyle = flash ? pal.black : pal.white;
    poly(
      ctx,
      burst.map(([x, y]) => [x + reg, y + reg] as Pt),
    );
    ctx.fill();
    ctx.strokeStyle = flash ? pal.white : pal.black;
    ctx.lineWidth = u * 0.008;
    ctx.lineJoin = "miter";
    poly(ctx, burst);
    ctx.stroke();
    // Stars flying out of each hit.
    for (const [t0, amp] of IMPACTS) {
      const d = t - t0;
      if (d < 0 || d > 1.1) continue;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + 0.4 + t0;
        const dist = brx * (0.9 + d * 1.6 * amp);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist * 0.75;
        const s = u * 0.018 * (1 - d / 1.1) * (0.7 + amp * 0.5);
        ctx.fillStyle = pal.yellow;
        ctx.strokeStyle = pal.black;
        ctx.lineWidth = u * 0.003;
        const star: Pt[] = [];
        for (let q = 0; q < 10; q++) {
          const b = (q / 10) * TAU - Math.PI / 2 + d * 3;
          const rr = q % 2 ? s * 0.45 : s;
          star.push([x + Math.cos(b) * rr, y + Math.sin(b) * rr]);
        }
        poly(ctx, star);
        ctx.fill();
        ctx.stroke();
      }
    }
    // The SFX: heavy outline, a red extrusion, a yellow face, tilted.
    const word = `${wordFor(theme.name, "Pow", 10).toUpperCase()}!`;
    const css = (s: number) => font(400, s, "Bangers", SFX);
    const size = fitFont(ctx, word, brx * 1.25, bry * 0.95, css);
    ctx.save();
    ctx.translate(cx, cy + size * 0.06);
    ctx.rotate(-0.1 + 0.04 * k);
    ctx.scale(1 + 0.08 * k, 1 - 0.05 * k);
    ctx.font = css(size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const depth = Math.max(2, Math.round(size * 0.1));
    ctx.lineJoin = "round";
    ctx.strokeStyle = pal.black;
    ctx.lineWidth = size * 0.16;
    for (let d = depth; d >= 0; d -= Math.max(1, depth / 8)) ctx.strokeText(word, d * 0.7, d);
    ctx.fillStyle = pal.redDeep;
    for (let d = depth; d > 0; d -= Math.max(1, depth / 8)) ctx.fillText(word, d * 0.7, d);
    ctx.fillStyle = flash ? pal.white : pal.yellow;
    ctx.fillText(word, reg, reg);
    ctx.lineWidth = size * 0.045;
    ctx.strokeText(word, 0, 0);
    ctx.restore();
    ctx.restore();

    // Ink keylines round the panels.
    ctx.strokeStyle = pal.black;
    ctx.lineWidth = u * 0.006;
    for (const P of [A, B, C]) ctx.strokeRect(P.x, P.y, P.w, P.h);
    ctx.strokeStyle = rgba(pal.white, 0.85);
    ctx.lineWidth = u * 0.0025;
    for (const P of [A, B, C])
      ctx.strokeRect(P.x - u * 0.004, P.y - u * 0.004, P.w + u * 0.008, P.h + u * 0.008);

    // Newsprint: tooth and a little ink dropout.
    tileFill(
      ctx,
      speckleTile(3434, 256, 1800, 0.05, 0.22, 0.5, 1.4),
      w,
      h,
      Math.max(0.5, u / 800),
      0.5,
    );
    vignette(ctx, w, h, "#000000", 0.35);
    grain(ctx, w, h, t, 0.24);
  },
};
