import { mix, parse, rgba, hex } from "../engine/color";
import {
  bake,
  buffer,
  context,
  fbm3,
  frameOf,
  grain,
  ground,
  light,
  LOOP,
  makeCanvas,
  rng,
  TAU,
  vignette,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkPaper, speckTile, tileOver, tintLayer } from "./_s1-helpers";

type Flower = { x: number; y: number; r: number; ink: 0 | 1; turn: number; a0: number };

function areaOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const aw = w * (portrait ? 0.86 : square ? 0.84 : 0.84);
  const ah = h * (portrait ? 0.8 : square ? 0.8 : 0.8);
  return { x: (w - aw) / 2, y: (h - ah) / 2, w: aw, h: ah };
}

function flowers(w: number, h: number): Flower[] {
  const a = areaOf(w, h);
  const { portrait, square } = frameOf(w, h);
  const m = Math.min(a.w, a.h);
  const L = portrait
    ? [
        [0.46, 0.22, 0.36, 0, 1, 0.2],
        [0.38, 0.54, 0.33, 1, -1, 0.5],
        [0.74, 0.62, 0.27, 0, 2, 0.1],
        [0.5, 0.85, 0.22, 1, -1, 0.7],
      ]
    : square
      ? [
          [0.3, 0.32, 0.32, 0, 1, 0.2],
          [0.64, 0.52, 0.3, 1, -1, 0.5],
          [0.28, 0.78, 0.22, 1, 2, 0.1],
          [0.8, 0.18, 0.19, 0, -1, 0.7],
        ]
      : [
          [0.24, 0.44, 0.38, 0, 1, 0.2],
          [0.5, 0.6, 0.33, 1, -1, 0.5],
          [0.74, 0.35, 0.29, 0, 2, 0.1],
          [0.9, 0.78, 0.2, 1, -1, 0.7],
        ];
  return L.map(([fx, fy, fr, ink, turn, a0]) => ({
    x: a.x + a.w * fx,
    y: a.y + a.h * fy,
    r: m * fr * (portrait ? 1.05 : 1),
    ink: ink as 0 | 1,
    turn,
    a0: a0 * TAU,
  }));
}

/** Petal radius at angle within a petal (identical for all four, so a quarter turn loops). */
function petalEdge(a: number) {
  return 0.94 + 0.05 * Math.sin(a * 3 + 0.4) + 0.03 * Math.sin(a * 7 + 1.1);
}

function flowerPath(c: Ctx2D, f: Flower, rot: number) {
  const n = 40;
  for (let p = 0; p < 4; p++) {
    const th = rot + (p * TAU) / 4;
    const px = f.x + Math.cos(th) * f.r * 0.44;
    const py = f.y + Math.sin(th) * f.r * 0.44;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const e = petalEdge(a + p * 0) * (1 + 0.05 * Math.cos(a * 2));
      const ra = f.r * 0.56 * e;
      const rb = f.r * 0.5 * e;
      const lx = Math.cos(a) * ra;
      const ly = Math.sin(a) * rb;
      const x = px + lx * Math.cos(th) - ly * Math.sin(th);
      const y = py + lx * Math.sin(th) + ly * Math.cos(th);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }
}

/** The black key: centre, the grooves between petals and one shadow per petal. */
function keyPath(c: Ctx2D, f: Flower, rot: number) {
  c.beginPath();
  c.arc(f.x, f.y, f.r * 0.17, 0, TAU);
  c.fill();
  c.beginPath();
  for (let p = 0; p < 4; p++) {
    const a = rot + (p * TAU) / 4 + TAU / 8;
    // Groove between petals: a tapering wedge.
    const ex = f.x + Math.cos(a) * f.r * 0.72;
    const ey = f.y + Math.sin(a) * f.r * 0.72;
    const nx = -Math.sin(a) * f.r * 0.05;
    const ny = Math.cos(a) * f.r * 0.05;
    c.moveTo(f.x + nx, f.y + ny);
    c.quadraticCurveTo(
      f.x + Math.cos(a) * f.r * 0.4 + nx * 0.4,
      f.y + Math.sin(a) * f.r * 0.4 + ny * 0.4,
      ex,
      ey,
    );
    c.quadraticCurveTo(
      f.x + Math.cos(a) * f.r * 0.4 - nx * 0.4,
      f.y + Math.sin(a) * f.r * 0.4 - ny * 0.4,
      f.x - nx,
      f.y - ny,
    );
    c.closePath();
    // Shadow crescent inside each petal, near the centre.
    const b = rot + (p * TAU) / 4;
    const cx = f.x + Math.cos(b) * f.r * 0.36;
    const cy = f.y + Math.sin(b) * f.r * 0.36;
    c.moveTo(cx + Math.cos(b + 1.9) * f.r * 0.2, cy + Math.sin(b + 1.9) * f.r * 0.2);
    c.quadraticCurveTo(
      cx + Math.cos(b) * f.r * 0.1,
      cy + Math.sin(b) * f.r * 0.1,
      cx + Math.cos(b - 1.3) * f.r * 0.24,
      cy + Math.sin(b - 1.3) * f.r * 0.24,
    );
    c.quadraticCurveTo(
      cx - Math.cos(b) * f.r * 0.02,
      cy - Math.sin(b) * f.r * 0.02,
      cx + Math.cos(b + 1.9) * f.r * 0.2,
      cy + Math.sin(b + 1.9) * f.r * 0.2,
    );
    c.closePath();
    c.fill();
    c.beginPath();
  }
  // Stamens: a ring of dots around the centre.
  for (let i = 0; i < 8; i++) {
    const a = rot + TAU / 16 + (i / 8) * TAU;
    c.moveTo(f.x + Math.cos(a) * f.r * 0.27 + f.r * 0.035, f.y + Math.sin(a) * f.r * 0.27);
    c.arc(f.x + Math.cos(a) * f.r * 0.27, f.y + Math.sin(a) * f.r * 0.27, f.r * 0.035, 0, TAU);
  }
  c.fill();
}

/** Squeegee streaks: density varies across the pull, fixed to the paper. */
let streaks: AnyCanvas | null = null;
function streakTile(): AnyCanvas {
  if (streaks) return streaks;
  const W = 256;
  const H = 256;
  const c = makeCanvas(W, H);
  const g = context(c);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = fbm3((x / W) * 16, (y / H) * 1, 0.7, 3, 16, 1, 0);
      const a = Math.max(0, Math.min(1, 0.35 + n * 1.3));
      img.data[(y * W + x) * 4 + 3] = Math.round(a * 255);
    }
  g.putImageData(img, 0, 0);
  streaks = c;
  return c;
}

/** Grass: the background photo screen, a stochastic (grain) screen of a meadow, printed light. */
function grassScreen(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const a = areaOf(w, h);
    const { u } = frameOf(w, h);
    const tone = makeCanvas(w, h);
    const T = context(tone);
    T.fillStyle = "#000";
    T.fillRect(0, 0, w, h);
    const r = rng(1964);
    T.lineCap = "round";
    const count = Math.round(((a.w * a.h) / (u * u)) * 2600);
    for (let i = 0; i < count; i++) {
      const x = a.x + r() * a.w;
      const y = a.y + r() * (a.h + u * 0.05);
      const len = u * (0.03 + r() * 0.08);
      const lean = fbm3(x / (u * 0.35), y / (u * 0.35), 2.2, 2) * 1.4;
      const ang = -Math.PI / 2 + (r() - 0.5) * 0.9 + lean;
      const v = Math.round(255 * (0.18 + r() * r() * 0.75));
      T.strokeStyle = `rgba(${v},${v},${v},0.9)`;
      T.lineWidth = Math.max(0.8, u * (0.002 + r() * 0.004));
      T.beginPath();
      T.moveTo(x, y);
      T.quadraticCurveTo(
        x + Math.cos(ang + 0.35) * len * 0.5,
        y + Math.sin(ang + 0.35) * len * 0.5,
        x + Math.cos(ang) * len,
        y + Math.sin(ang) * len,
      );
      T.stroke();
    }
    const W = Math.round(w);
    const H = Math.round(h);
    const src = T.getImageData(0, 0, W, H).data;
    const out = c.createImageData(W, H);
    const d = out.data;
    const x0 = Math.floor(a.x);
    const x1 = Math.ceil(a.x + a.w);
    const y0 = Math.floor(a.y);
    const y1 = Math.ceil(a.y + a.h);
    const [ir, ig, ib] = parse(theme.ink);
    let seed = 0x1964;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        // Grain screen: threshold the tone against white noise (xorshift, seeded).
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const n = ((seed >>> 0) % 1000) / 1000;
        const tv = (src[o] / 255) * 0.62;
        if (tv > n) {
          d[o] = ir;
          d[o + 1] = ig;
          d[o + 2] = ib;
          d[o + 3] = 255;
        }
      }
    c.putImageData(out, 0, 0);
  };
}

/** Halftone shading around each flower's heart: radial tone, so it survives any rotation. */
function heartDots(c: Ctx2D, w: number, h: number) {
  c.fillStyle = "#fff";
  for (const f of flowers(w, h)) {
    const pitch = Math.max(2.5, f.r * 0.055);
    const reach = f.r * 0.62;
    const n = Math.ceil(reach / pitch) + 1;
    c.beginPath();
    for (let j = -n; j <= n; j++)
      for (let i = -n; i <= n; i++) {
        const gx = (i + j) * pitch * 0.7071;
        const gy = (j - i) * pitch * 0.7071;
        const d = Math.hypot(gx, gy);
        if (d > reach) continue;
        const tone = Math.max(0, Math.min(1, (reach - d) / (reach - f.r * 0.18))) * 0.62;
        if (tone < 0.03) continue;
        const r = pitch * 0.55 * Math.sqrt(tone);
        c.moveTo(f.x + gx + r, f.y + gy);
        c.arc(f.x + gx, f.y + gy, r, 0, TAU);
      }
    c.fill();
  }
}

function multiply(a: string, b: string) {
  const A = parse(a);
  const B = parse(b);
  return hex([(A[0] * B[0]) / 255, (A[1] * B[1]) / 255, (A[2] * B[2]) / 255]);
}

export const style: MotionStyle = {
  id: "screenprint",
  name: "Screenprint Flowers",
  family: "Print & Craft",
  tagline: "Pop flowers, off register",
  look: "Pop screenprint: four-petal flowers in two flat inks over a grass screen, a black key off register, overprints where they cross.",
  move: "Each flower turns a quarter or half turn, so the overprints reshape as petals slide over each other; the key drifts in register.",
  rules: [
    "Flat opaque inks, no gradients: tone only from which screens overlap.",
    "Where two inks cross they overprint into a third colour.",
    "The black key is its own screen and never quite sits in register.",
    "Squeegee streaks and pinholes are fixed to the paper, not the shapes.",
    "Four identical petals, so a quarter turn closes the loop.",
    "A background screen of grass printed light and sparse.",
  ],
  prompt: `R — References
• Andy Warhol, Flowers (1964): four-petal hibiscus in flat inks over a black grass screen.
• Hand-pulled screenprints: squeegee streaks, pinholes, misregistration, overprint (search: screen print misregistration overprint).

I — Idea
Four flat-ink flowers turn over a grass screen, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): pink and yellow flowers sit over the grass, where they cross the inks overprint into a hot third colour.
• Middle (1.5–3.5 s): the flowers rotate at different speeds and directions, so the overprint shapes grow, split and change.
• End (3.5–5 s): each has turned a whole quarter or half turn, landing on the first frame; the black key drifts back into near-register.

S — Style
Looks: {{bg}} stock; a grass screen printed in {{ink}} at low density; flowers in {{accent}} and {{accent2}}, opaque and flat; overprint = the two inks multiplied; a near-black key screen (centres, grooves, petal shadows) offset from the colour.
Moves: steady rotation (ease is not needed: it never stops); the key's offset circles once per loop; texture stays fixed to the paper while shapes move under it.
Rules:
1. Flat inks; tone only from overlap.
2. Overprint where inks cross.
3. The key sits off register.
4. Streaks and pinholes fixed to the paper.
5. Four identical petals: a quarter turn loops.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; there are at least two overprint areas; the key is visibly out of register; no gradient anywhere on the flowers; the flowers fill the print area. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Screen_printing",
  theme: {
    bg: "#141213",
    ink: "#efe8dc",
    accent: "#ff4f8a",
    accent2: "#ffc53b",
    font: "Inter",
  },
  tags: [
    "screenprint",
    "screen print",
    "silkscreen",
    "warhol",
    "pop art",
    "flowers",
    "overprint",
    "misregistration",
    "poster",
    "print",
    "flat colour",
  ],
  word: "Flowers",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `sp-paper:${theme.bg}${theme.ink}`,
        w,
        h,
        darkPaper(theme, 88, { fibres: 0.6, tone: 0.02 }),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.3, h * 0.2, Math.max(w, h) * 0.9, theme.ink, 0.05);
    const area = areaOf(w, h);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(
      bake(`sp-grass:${theme.ink}`, w, h, grassScreen(theme)) as CanvasImageSource,
      0,
      0,
    );
    ctx.restore();

    const phase = t / LOOP;
    const fl = flowers(w, h);
    const rotOf = (f: Flower) => f.a0 + (f.turn * phase * TAU) / 4;
    const { canvas: ac, ctx: A } = buffer("sp-a", w, h);
    const { canvas: bc, ctx: B } = buffer("sp-b", w, h);
    const { canvas: xc, ctx: X } = buffer("sp-x", w, h);
    const { canvas: kc, ctx: K } = buffer("sp-k", w, h);
    for (const L of [A, B, X, K]) {
      L.globalCompositeOperation = "source-over";
      L.globalAlpha = 1;
      L.clearRect(0, 0, w, h);
      L.fillStyle = "#fff";
    }
    A.beginPath();
    B.beginPath();
    for (const f of fl) flowerPath(f.ink === 0 ? A : B, f, rotOf(f));
    A.fill();
    B.fill();
    // Logo: knocked out of the biggest flower's centre when a brand is set.
    const mark = tintedLogo(theme, "#000000", fl[0].r * 0.3, fl[0].r * 0.3);

    // Overprint = A ∩ B.
    X.drawImage(ac as CanvasImageSource, 0, 0);
    X.globalCompositeOperation = "destination-in";
    X.drawImage(bc as CanvasImageSource, 0, 0);
    X.globalCompositeOperation = "source-over";

    // Paper-fixed ink texture on every colour screen.
    const k = Math.max(0.6, u / 700);
    const st = streakTile();
    for (const [L, seed] of [
      [A, 11],
      [B, 23],
      [X, 37],
    ] as const) {
      tileOver(L, w, h, st, { alpha: 0.32, scale: k * 1.5 });
      tileOver(L, w, h, speckTile(seed, 700, 1.5, 1), { alpha: 0.75, scale: k });
    }
    tintLayer(A, w, h, theme.accent);
    tintLayer(B, w, h, theme.accent2);
    tintLayer(X, w, h, multiply(theme.accent, theme.accent2));
    ctx.drawImage(ac as CanvasImageSource, 0, 0);
    ctx.drawImage(bc as CanvasImageSource, 0, 0);
    ctx.drawImage(xc as CanvasImageSource, 0, 0);

    // The black key, out of register and drifting on a circle.
    K.drawImage(bake("sp-dots", w, h, heartDots) as CanvasImageSource, 0, 0);
    for (const f of fl) keyPath(K, f, rotOf(f));
    if (mark) {
      K.save();
      K.globalCompositeOperation = "destination-out";
      K.drawImage(mark as CanvasImageSource, fl[0].x - fl[0].r * 0.15, fl[0].y - fl[0].r * 0.15);
      K.restore();
    }
    tileOver(K, w, h, speckTile(51, 900, 1.3, 1), { alpha: 0.6, scale: k });
    tintLayer(K, w, h, mix(theme.bg, "#000000", 0.55));
    const off = u * 0.009;
    ctx.save();
    ctx.globalAlpha = 0.93;
    ctx.drawImage(
      kc as CanvasImageSource,
      off * Math.cos(TAU * phase + 0.6) + u * 0.004,
      off * 0.7 * Math.sin(TAU * phase + 0.6) - u * 0.003,
    );
    ctx.restore();

    // A hairline where the printed area ends.
    ctx.strokeStyle = rgba(theme.ink, 0.12);
    ctx.lineWidth = Math.max(1, u * 0.0015);
    ctx.strokeRect(area.x, area.y, area.w, area.h);

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
