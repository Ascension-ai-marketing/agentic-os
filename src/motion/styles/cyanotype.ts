import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  fbm3,
  font,
  fract,
  frameOf,
  grain,
  ground,
  hash,
  lerp,
  light,
  LOOP,
  rng,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { mottleTile, tileOver, type Pt } from "./_s1-helpers";

const HAND = '"Caveat", "Bradley Hand", cursive';

/** Coated sheet: Prussian blue with brush strokes, mottle and cotton fibres. */
function sheet(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    const deep = theme.bg;
    const mid = mix(theme.bg, theme.accent2, 0.62);
    c.fillStyle = mix(theme.bg, theme.accent2, 0.4);
    c.fillRect(0, 0, w, h);
    // Uneven exposure: big soft mottle.
    const step = Math.max(3, Math.round(u / 120));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.45), y / (u * 0.45), 7.7, 4);
        c.fillStyle =
          n > 0 ? rgba(deep, Math.min(0.8, n * 1.3)) : rgba(mid, Math.min(0.7, -n * 1.4));
        c.fillRect(x, y, step, step);
      }
    // Brush strokes of sensitiser: long diagonal bands of slightly different density.
    const r = rng(1842);
    c.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const x = r() * w * 1.4 - w * 0.2;
      const y = r() * h * 1.4 - h * 0.2;
      const len = u * (0.5 + r() * 0.9);
      const a = -0.5 + (r() - 0.5) * 0.25;
      c.strokeStyle = r() < 0.5 ? rgba(deep, 0.1 + r() * 0.12) : rgba(mid, 0.06 + r() * 0.08);
      c.lineWidth = u * (0.02 + r() * 0.07);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(
        x + Math.cos(a) * len * 0.5,
        y + Math.sin(a) * len * 0.5 + u * 0.02,
        x + Math.cos(a) * len,
        y + Math.sin(a) * len,
      );
      c.stroke();
      // Bristle lines inside the stroke.
      c.lineWidth = Math.max(0.6, u * 0.0012);
      for (let k = 0; k < 6; k++) {
        const o = (r() - 0.5) * u * 0.05;
        c.strokeStyle = rgba(r() < 0.5 ? deep : mid, 0.12);
        c.beginPath();
        c.moveTo(x - Math.sin(a) * o, y + Math.cos(a) * o);
        c.lineTo(x + Math.cos(a) * len - Math.sin(a) * o, y + Math.sin(a) * len + Math.cos(a) * o);
        c.stroke();
      }
    }
    // Cotton fibres, pale where the coating thinned over them.
    for (let i = 0; i < (w * h) / 1500; i++) {
      const x = r() * w;
      const y = r() * h;
      const len = u * (0.006 + r() * r() * 0.04);
      const a = r() * TAU;
      c.strokeStyle = r() < 0.55 ? rgba(theme.ink, 0.04 + r() * 0.06) : rgba(deep, 0.25);
      c.lineWidth = Math.max(0.5, u * 0.0007);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(
        x + Math.cos(a + 0.6) * len * 0.5,
        y + Math.sin(a + 0.6) * len * 0.5,
        x + Math.cos(a) * len,
        y + Math.sin(a) * len,
      );
      c.stroke();
    }
  };
}

type Sway = (x: number, y: number) => Pt;

/** Rotate points about a pivot by an angle that grows with distance up the plant. */
function swayer(px: number, py: number, angle: number, reach: number): Sway {
  return (x, y) => {
    const d = Math.hypot(x - px, y - py) / reach;
    const a = angle * Math.min(1.4, d * d);
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c];
  };
}

function leaflet(c: Ctx2D, x: number, y: number, a: number, len: number, wid: number) {
  const ex = x + Math.cos(a) * len;
  const ey = y + Math.sin(a) * len;
  const nx = -Math.sin(a) * wid;
  const ny = Math.cos(a) * wid;
  c.moveTo(x, y);
  c.bezierCurveTo(
    x + Math.cos(a) * len * 0.2 + nx,
    y + Math.sin(a) * len * 0.2 + ny,
    ex + nx * 0.5,
    ey + ny * 0.5,
    ex,
    ey,
  );
  c.bezierCurveTo(
    ex - nx * 0.5,
    ey - ny * 0.5,
    x + Math.cos(a) * len * 0.2 - nx,
    y + Math.sin(a) * len * 0.2 - ny,
    x,
    y,
  );
  c.closePath();
}

/** A fern frond: curved rachis, alternating pinnae of round pinnules. */
function fern(
  c: Ctx2D,
  base: Pt,
  tip: Pt,
  bend: number,
  size: number,
  sway: Sway,
  flutter: number,
  seed: number,
) {
  const ctrl: Pt = [
    (base[0] + tip[0]) / 2 + (tip[1] - base[1]) * bend,
    (base[1] + tip[1]) / 2 - (tip[0] - base[0]) * bend,
  ];
  const at = (s: number): Pt => {
    const q = 1 - s;
    return sway(
      q * q * base[0] + 2 * q * s * ctrl[0] + s * s * tip[0],
      q * q * base[1] + 2 * q * s * ctrl[1] + s * s * tip[1],
    );
  };
  // Rachis.
  c.lineWidth = Math.max(1, size * 0.012);
  c.lineCap = "round";
  c.beginPath();
  for (let i = 0; i <= 40; i++) {
    const [x, y] = at(i / 40);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  c.beginPath();
  const pinnae = 22;
  for (let k = 0; k < pinnae; k++) {
    const s = 0.14 + (k / pinnae) * 0.84;
    const [x, y] = at(s);
    const [x2, y2] = at(Math.min(1, s + 0.01));
    const dir = Math.atan2(y2 - y, x2 - x);
    const side = k % 2 === 0 ? 1 : -1;
    const lenP =
      size *
      0.34 *
      Math.pow(1 - s, 0.75) *
      (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, s * 1.6)));
    const fl = Math.sin(TAU * (flutter + k * 0.07)) * 0.08;
    const a = dir - side * (1.0 - 0.25 * s) + fl;
    const n = Math.max(3, Math.round(lenP / (size * 0.028)));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      const px = x + Math.cos(a) * lenP * f;
      const py = y + Math.sin(a) * lenP * f;
      const lw = size * 0.03 * (1 - f * 0.55) * (0.8 + 0.2 * hash(seed, k, j));
      for (const sd of [-1, 1]) {
        const b = a + sd * 1.05;
        leaflet(c, px, py, b, lw * 1.35, lw * 0.5);
      }
    }
    leaflet(c, x + Math.cos(a) * lenP, y + Math.sin(a) * lenP, a, size * 0.022, size * 0.009);
    // Pinna stalk.
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * lenP, y + Math.sin(a) * lenP);
    c.lineTo(x + Math.cos(a) * lenP + 0.5, y + Math.sin(a) * lenP + 0.5);
  }
  c.fill();
  c.lineWidth = Math.max(0.8, size * 0.005);
  c.stroke();
}

/** Queen Anne's lace: a stem opening into an umbel of tiny florets. */
function umbel(c: Ctx2D, base: Pt, top: Pt, r: number, sway: Sway, seed: number) {
  const [tx, ty] = sway(top[0], top[1]);
  c.lineWidth = Math.max(1, r * 0.035);
  c.beginPath();
  const [bx, by] = sway(base[0], base[1]);
  const [mx, my] = sway((base[0] + top[0]) / 2 + r * 0.2, (base[1] + top[1]) / 2);
  c.moveTo(bx, by);
  c.quadraticCurveTo(mx, my, tx, ty);
  c.stroke();
  const rays = 15;
  const g = rng(seed);
  c.lineWidth = Math.max(0.6, r * 0.012);
  c.beginPath();
  const heads: Pt[] = [];
  for (let i = 0; i < rays; i++) {
    const a = -Math.PI / 2 + (i / (rays - 1) - 0.5) * 2.5 + (g() - 0.5) * 0.12;
    const len = r * (0.8 + g() * 0.3) * (1 - 0.25 * Math.abs(i / (rays - 1) - 0.5));
    const hx = tx + Math.cos(a) * len;
    const hy = ty + Math.sin(a) * len * 0.8;
    c.moveTo(tx, ty);
    c.lineTo(hx, hy);
    heads.push([hx, hy]);
  }
  c.stroke();
  c.beginPath();
  for (const [hx, hy] of heads) {
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (k / 8 - 0.5) * 2.6;
      const d = r * (0.1 + g() * 0.08);
      const fx = hx + Math.cos(a) * d;
      const fy = hy + Math.sin(a) * d * 0.8;
      const fr = r * (0.028 + g() * 0.018);
      c.moveTo(fx + fr, fy);
      c.arc(fx, fy, fr, 0, TAU);
    }
  }
  c.fill();
}

/** Grass stem with an alternating seed head. */
function grass(c: Ctx2D, base: Pt, top: Pt, size: number, sway: Sway) {
  const pts: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    pts.push(
      sway(
        lerp(base[0], top[0], s) + Math.sin(s * Math.PI) * size * 0.08,
        lerp(base[1], top[1], s),
      ),
    );
  }
  c.lineWidth = Math.max(0.8, size * 0.008);
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.stroke();
  c.beginPath();
  for (let i = 12; i <= 24; i++) {
    const [x, y] = pts[i];
    const [x0, y0] = pts[i - 1];
    const dir = Math.atan2(y - y0, x - x0);
    const side = i % 2 ? 1 : -1;
    leaflet(c, x, y, dir + side * 0.45, size * 0.06 * (1 - (i - 12) / 16), size * 0.014);
  }
  c.fill();
}

function ginkgo(c: Ctx2D, x: number, y: number, a: number, s: number) {
  const pts = 20;
  c.moveTo(x, y);
  for (let i = 0; i <= pts; i++) {
    const f = i / pts;
    const ang = a - 0.95 + f * 1.9;
    const notch = 1 - 0.22 * Math.exp(-((f - 0.5) ** 2) / 0.002);
    const wav = 1 + 0.03 * Math.sin(f * 40);
    c.lineTo(x + Math.cos(ang) * s * notch * wav, y + Math.sin(ang) * s * notch * wav);
  }
  c.closePath();
  // Stalk.
  c.moveTo(x, y);
  c.lineTo(x - Math.cos(a) * s * 0.7, y - Math.sin(a) * s * 0.7);
  c.lineTo(x - Math.cos(a) * s * 0.7 + 1, y - Math.sin(a) * s * 0.7 + 1);
}

/** A dandelion seed: stalk and a radial tuft. */
function seedPuff(c: Ctx2D, x: number, y: number, a: number, s: number) {
  c.moveTo(x, y);
  const tx = x + Math.cos(a) * s;
  const ty = y + Math.sin(a) * s;
  c.lineTo(tx, ty);
  for (let k = 0; k < 14; k++) {
    const b = a - 1.3 + (k / 13) * 2.6;
    c.moveTo(tx, ty);
    c.lineTo(tx + Math.cos(b) * s * 0.6, ty + Math.sin(b) * s * 0.6);
  }
}

export const style: MotionStyle = {
  id: "cyanotype",
  name: "Cyanotype Botanicals",
  family: "Print & Craft",
  tagline: "A Prussian-blue sun print",
  look: "A Prussian-blue sun print: fern, lace flower, grasses and ginkgo in white silhouette on brushed, fibrous paper.",
  move: "The plants sway from their stems, pinnae flutter in a travelling wave, dandelion seeds drift through the light.",
  rules: [
    "Two tones only: Prussian blue and paper white; everything else is density.",
    "Silhouettes are shadows: crisp where the plant lies flat, soft where it lifts.",
    "The blue is never flat: brush strokes, mottle and cotton fibres.",
    "Plants move from their stems; tips move most.",
    "Seeds are lifted, so they print soft and pale.",
    "A hand-written specimen label in the corner.",
  ],
  prompt: `R — References
• Anna Atkins, Photographs of British Algae: Cyanotype Impressions (1843).
• Contemporary cyanotype botanicals (search: cyanotype fern print, sun print brushed edge, cyanotype Queen Anne's lace).

I — Idea
A living sun print, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a fern frond, a lace flower, grasses and ginkgo leaves lie in white silhouette on deep Prussian blue; the light passes slowly across the sheet.
• Middle (1.5–3.5 s): the plants sway from their stems, pinnae flutter in a wave up the frond, edges soften where leaves lift off the paper; dandelion seeds drift through.
• End (3.5–5 s): everything settles back to the opening pose; the seeds wrap round; a pencil label reads "{{name}}".

S — Style
Looks: {{bg}} to {{accent2}} Prussian blue with brush strokes and mottling, white {{ink}} silhouettes with a soft penumbra, cotton fibres everywhere; a faint warm {{accent}} light drifting over the sheet; handwriting in white.
Moves: slow sine sways (whole cycles per loop), a flutter wave travelling up each frond, seeds on straight drifting paths that wrap.
Rules:
1. Blue and white only; tone is exposure.
2. Crisp where flat, soft where lifted.
3. Never a flat blue: brushed, mottled, fibrous.
4. Motion grows from stem to tip.
5. Seeds print soft.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the silhouettes read as real plants at thumbnail size; the blue has visible brush texture; edges have a soft penumbra; nothing clips at the frame edge except stems. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Cyanotype",
  theme: {
    bg: "#071a31",
    ink: "#eef3f2",
    accent: "#f0cf8a",
    accent2: "#2f73ad",
    font: "Caveat",
  },
  fonts: ["Caveat:wght@500;600"],
  tags: [
    "cyanotype",
    "sun print",
    "blueprint",
    "botanical",
    "fern",
    "plants",
    "leaves",
    "photogram",
    "blue",
    "vintage",
    "nature",
  ],
  word: "Pteridium",
  render(ctx, t, theme, w, h) {
    const { u, portrait, square } = frameOf(w, h);
    const phase = t / LOOP;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `cyano-sheet:${theme.bg}${theme.accent2}${theme.ink}`,
        w,
        h,
        sheet(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    // A warm light crossing the table.
    light(
      ctx,
      w * (0.3 + 0.25 * Math.sin(TAU * phase)),
      h * (0.35 + 0.1 * Math.cos(TAU * phase)),
      Math.max(w, h) * 0.7,
      theme.accent,
      0.09,
    );

    const { canvas: pc, ctx: P } = buffer("cyano-plants", w, h);
    const { canvas: lc, ctx: L } = buffer("cyano-lifted", w, h);
    P.clearRect(0, 0, w, h);
    L.clearRect(0, 0, w, h);
    P.fillStyle = P.strokeStyle = "#fff";
    L.fillStyle = L.strokeStyle = "#fff";

    const S = Math.min(w, h * (portrait ? 0.62 : 1.25));
    const sw = (a: number, p: number) => Math.sin(TAU * (phase + p)) * a;
    // Layout in frame fractions, re-laid for each aspect.
    const fernA = portrait
      ? { base: [w * 0.12, h * 1.02] as Pt, tip: [w * 0.82, h * 0.2] as Pt }
      : square
        ? { base: [w * 0.08, h * 1.02] as Pt, tip: [w * 0.78, h * 0.18] as Pt }
        : { base: [w * 0.14, h * 1.04] as Pt, tip: [w * 0.66, h * 0.12] as Pt };
    const fernB = portrait
      ? { base: [w * 0.95, h * 1.02] as Pt, tip: [w * 0.4, h * 0.62] as Pt }
      : square
        ? { base: [w * 1.02, h * 0.95] as Pt, tip: [w * 0.55, h * 0.62] as Pt }
        : { base: [w * 0.98, h * 1.04] as Pt, tip: [w * 0.78, h * 0.42] as Pt };
    const umb = portrait
      ? { base: [w * 0.22, h * 1.02] as Pt, top: [w * 0.3, h * 0.34] as Pt, r: S * 0.2 }
      : square
        ? { base: [w * 0.2, h * 1.02] as Pt, top: [w * 0.24, h * 0.3] as Pt, r: S * 0.17 }
        : { base: [w * 0.33, h * 1.04] as Pt, top: [w * 0.2, h * 0.3] as Pt, r: S * 0.15 };

    // Grasses (lifted: soft), then the flat plants (crisp).
    const grassBases: [number, number, number][] = portrait
      ? [
          [0.58, 0.46, 0.1],
          [0.7, 0.5, 0.35],
        ]
      : [
          [0.5, 0.36, 0.1],
          [0.58, 0.28, 0.35],
          [0.9, 0.22, 0.6],
        ];
    for (const [gx, gtop, p] of grassBases) {
      const base: Pt = [w * gx, h * 1.03];
      const top: Pt = [w * (gx + 0.06), h * gtop];
      grass(L, base, top, S * 0.9, swayer(base[0], base[1], sw(0.05, p), h * 0.7));
    }
    const fs = S * (portrait ? 1.1 : 1);
    fern(
      P,
      fernA.base,
      fernA.tip,
      0.12,
      fs,
      swayer(fernA.base[0], fernA.base[1], sw(0.028, 0), fs),
      phase * 2,
      3,
    );
    fern(
      P,
      fernB.base,
      fernB.tip,
      -0.15,
      fs * 0.62,
      swayer(fernB.base[0], fernB.base[1], sw(0.04, 0.3), fs * 0.6),
      phase * 2 + 0.4,
      7,
    );
    umbel(
      P,
      umb.base,
      umb.top,
      umb.r,
      swayer(umb.base[0], umb.base[1], sw(0.035, 0.55), h * 0.7),
      11,
    );
    // Ginkgo leaves lying flat.
    P.beginPath();
    const leaves: [number, number, number, number][] = portrait
      ? [
          [0.62, 0.3, 2.2, 0.075],
          [0.12, 0.62, 0.7, 0.06],
        ]
      : square
        ? [
            [0.62, 0.16, 2.3, 0.07],
            [0.9, 0.5, 3.6, 0.055],
          ]
        : [
            [0.72, 0.26, 2.3, 0.07],
            [0.44, 0.12, 0.9, 0.055],
            [0.95, 0.58, 3.6, 0.05],
          ];
    for (const [lx, ly, la, ls] of leaves) ginkgo(P, w * lx, h * ly, la + sw(0.04, lx), S * ls);
    P.fill();
    P.lineWidth = Math.max(0.8, S * 0.004);
    P.stroke();

    // Seeds drift across and wrap.
    P.lineWidth = Math.max(0.8, S * 0.003);
    P.beginPath();
    for (let i = 0; i < 6; i++) {
      const p = fract(phase + hash(i, 5));
      const x = -w * 0.1 + p * w * 1.2;
      const y =
        h * (0.15 + 0.7 * hash(i, 9)) +
        Math.sin(TAU * (phase * 2 + hash(i, 3))) * h * 0.03 -
        p * h * 0.08;
      seedPuff(
        P,
        x,
        y,
        -Math.PI / 2 + Math.sin(TAU * (phase + hash(i, 7))) * 0.5,
        S * (0.03 + 0.015 * hash(i, 11)),
      );
    }
    P.stroke();

    // Print the shadows: soft penumbra, then the crisp contact edge; lifted things only soft.
    const blurA = Math.max(1, u * 0.006);
    ctx.save();
    ctx.filter = `blur(${(blurA * 1.6).toFixed(1)}px)`;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(lc as CanvasImageSource, 0, 0);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(pc as CanvasImageSource, 0, 0);
    ctx.filter = `blur(${(blurA * 0.5).toFixed(1)}px)`;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(lc as CanvasImageSource, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 0.92;
    ctx.drawImage(pc as CanvasImageSource, 0, 0);
    ctx.restore();
    // Paper texture shows inside the whites: knock a little blue back in.
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const { canvas: tc, ctx: T } = buffer("cyano-tex", w, h);
    T.clearRect(0, 0, w, h);
    tileOver(T, w, h, mottleTile(77, 6, 1.4), {
      op: "source-over",
      alpha: 1,
      scale: Math.max(0.6, u / 600),
    });
    T.globalCompositeOperation = "source-in";
    T.fillStyle = mix(theme.ink, theme.accent2, 0.35);
    T.fillRect(0, 0, w, h);
    T.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.35;
    ctx.drawImage(tc as CanvasImageSource, 0, 0);
    ctx.restore();

    // Specimen label, hand-written in white.
    const size = Math.max(10, u * (portrait ? 0.05 : 0.052));
    const label = wordFor(theme.name, "Pteridium", 16);
    ctx.save();
    ctx.font = font(600, size, "Caveat", HAND);
    ctx.fillStyle = rgba(theme.ink, 0.86);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    const lx = w * (portrait ? 0.92 : 0.93);
    const ly = h * (portrait ? 0.075 : 0.13);
    ctx.fillText(label, lx, ly);
    ctx.font = font(500, size * 0.62, "Caveat", HAND);
    ctx.fillStyle = rgba(theme.ink, 0.62);
    ctx.fillText("sun print · 12 min", lx, ly + size * 0.72);
    ctx.restore();
    const mark = tintedLogo(theme, rgba(theme.ink, 0.8), size * 1.2, size * 1.2);
    if (mark) {
      ctx.font = font(600, size, "Caveat", HAND);
      const tw = ctx.measureText(label).width;
      ctx.drawImage(mark as CanvasImageSource, lx - tw - size * 1.5, ly - size * 0.95);
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
