import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  rng,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, bokeh, cyc, glow, mottled, pfbm, turn, vgrad } from "./_s7-helpers";

const FLIES = 66;

function horizonOf(w: number, h: number) {
  const { portrait } = frameOf(w, h);
  return h * (portrait ? 0.56 : 0.6);
}

/** Dusk sky, first stars, the far tree line and the dark meadow floor. */
function dusk(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    const H = horizonOf(w, h);
    mottled(c, w, h, theme.bg, theme.accent2, 0.03, 41, 0.01);
    const glowCol = mix(mix(theme.accent2, theme.ink, 0.4), theme.accent, 0.12);
    vgrad(c, 0, 0, w, H, [
      [0, mix(theme.bg, "#000000", 0.3), 1],
      [0.4, mix(theme.bg, theme.accent2, 0.3), 1],
      [0.8, mix(theme.accent2, theme.ink, 0.12), 1],
      [1, glowCol, 1],
    ]);
    light(c, w * 0.58, H, u * 1.1, glowCol, 0.3);
    const r = rng(7);
    for (let i = 0; i < 80; i++) {
      const y = r() * H * 0.55;
      c.fillStyle = rgba(theme.ink, (0.15 + r() * 0.55) * (1 - y / (H * 0.55)));
      const d = Math.max(0.6, u * (0.001 + r() * r() * 0.0025));
      c.fillRect(r() * w, y, d, d);
    }
    // Far tree line: overlapping rounded crowns, hazy with distance.
    c.fillStyle = mix(glowCol, theme.bg, 0.55);
    c.fillRect(0, H - u * 0.03, w, u * 0.05);
    const tr = rng(19);
    for (let x = -u * 0.03; x < w + u * 0.03; x += u * (0.012 + tr() * 0.02)) {
      const n = pfbm((x / w) * 4, 64, 2, 3);
      const rad = u * (0.015 + tr() * 0.022) * (0.8 + 0.6 * (0.5 + n));
      c.beginPath();
      c.arc(x, H - u * 0.03 - (0.5 + n) * u * 0.035, rad, 0, TAU);
      c.fill();
    }
    // Meadow floor: haze at the horizon falling into near-black.
    vgrad(c, 0, H - u * 0.02, w, h, [
      [0, mix(glowCol, theme.bg, 0.45), 1],
      [0.12, mix(theme.bg, theme.accent2, 0.14), 1],
      [1, mix(theme.bg, "#000000", 0.4), 1],
    ]);
    // Short grass texture across the floor.
    c.lineWidth = Math.max(0.6, u * 0.0018);
    const n = Math.round(w / (u * 0.0025));
    for (let i = 0; i < n; i++) {
      const x = r() * w;
      const y = H + u * 0.01 + r() ** 1.6 * (h - H);
      const k = (y - H) / (h - H);
      const hgt = u * (0.015 + r() * 0.03) * (0.6 + k * 1.4);
      c.strokeStyle = rgba(mix(theme.bg, "#000000", 0.3), 0.5 + 0.5 * k);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(
        x + (r() - 0.5) * hgt * 0.4,
        y - hgt * 0.6,
        x + (r() - 0.5) * hgt * 0.7,
        y - hgt,
      );
      c.stroke();
    }
  };
}

interface Blade {
  x: number;
  hgt: number;
  lean: number;
  width: number;
  seed: number;
  head: boolean;
}

function blades(count: number, seed: number, minH: number, maxH: number, heads: number): Blade[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    x: r(),
    hgt: minH + (maxH - minH) * r() ** 1.5,
    lean: (r() - 0.5) * 0.5,
    width: 0.6 + r() * 0.8,
    seed: seed * 1000 + i,
    head: r() < heads,
  }));
}
const MID = blades(170, 11, 0.1, 0.32, 0.05);
const FRONT = blades(80, 23, 0.25, 0.62, 0.04);

/** Grass swaying in a slow wave that travels across the meadow. */
function meadow(
  ctx: Ctx2D,
  list: Blade[],
  base: number,
  t: number,
  w: number,
  u: number,
  color: string,
  headColor: string,
  amp: number,
) {
  const path = new Path2D();
  const heads: [number, number, number][] = [];
  for (const b of list) {
    const x = b.x * w;
    const H = b.hgt * u;
    const sway =
      b.lean +
      amp *
        Math.sin(turn(t, 1, b.x * 1.3 + hash(b.seed, 1) * 0.15)) *
        (0.6 + 0.4 * hash(b.seed, 2));
    const tx = x + Math.sin(sway) * H;
    const ty = base - Math.cos(sway) * H;
    const cx = x + Math.sin(sway * 0.4) * H * 0.55;
    const cy = base - H * 0.55;
    const bw = u * 0.0045 * b.width;
    path.moveTo(x - bw, base);
    path.quadraticCurveTo(cx - bw * 0.5, cy, tx, ty);
    path.quadraticCurveTo(cx + bw * 0.5, cy, x + bw, base);
    path.closePath();
    if (b.head) heads.push([tx, ty, sway]);
  }
  ctx.fillStyle = color;
  ctx.fill(path);
  // Umbels (wild carrot, yarrow): flat-topped clusters on the tallest stems.
  ctx.strokeStyle = headColor;
  ctx.lineWidth = Math.max(0.5, u * 0.0012);
  for (const [x, y, sway] of heads) {
    const R = u * 0.028;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway * 0.8);
    ctx.beginPath();
    for (let k = 0; k < 9; k++) {
      const fx = (k - 4) / 4;
      ctx.moveTo(0, 0);
      ctx.lineTo(fx * R, -R * 0.55 - R * 0.28 * (1 - fx * fx));
    }
    ctx.stroke();
    for (let k = 0; k < 30; k++) {
      const fx = (hash(k, 3) - 0.5) * 2;
      const px = fx * R * 1.05;
      const py = -R * 0.55 - R * 0.28 * (1 - fx * fx) + (hash(k, 4) - 0.5) * R * 0.12;
      ctx.beginPath();
      ctx.arc(px, py, u * (0.0022 + 0.0022 * hash(k, 5)), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** A firefly's flash at loop phase p: fast rise, short hold, slow fade. */
function flash(p: number, at: number) {
  let d = p - at;
  d -= Math.floor(d);
  if (d < 0.02) return d / 0.02;
  if (d < 0.05) return 1;
  if (d < 0.2) return 1 - (d - 0.05) / 0.15;
  return 0;
}

export const style: MotionStyle = {
  id: "fireflies",
  name: "Dusk Meadow",
  family: "Nature",
  tagline: "Fireflies over a dusk meadow",
  look: "A meadow at the last blue of dusk: violet sky, tall grass silhouettes, and fireflies drawing little J-shaped strokes of light.",
  move: "Grass sways in a slow travelling wave while fireflies drift and flash on their own rhythms, each flash swooping up in a J.",
  rules: [
    "Fireflies flash, they do not glow constantly: quick rise, short hold, slow fade.",
    "Each flash draws a short J as the firefly swoops upward.",
    "Three depths: far flies small behind the grass, near flies soft and large in front.",
    "Grass sways as one wave travelling across the meadow, never in unison.",
    "The sky carries the only gradient: indigo overhead to violet at the horizon.",
    "Firefly light is the one accent; everything else is silhouette.",
  ],
  prompt: `R — References
• Long-exposure firefly photography over meadows (search: fireflies meadow long exposure).
• Studio Ghibli dusk skies for the palette.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a meadow in the last blue of dusk; tall grass silhouettes sway; the first fireflies flash low in the grass.
• Middle (1.5–3.5 s): dozens flash on their own rhythms, each flash swooping up in a small J of light; near ones drift soft and large past the lens.
• End (3.5–5 s): the flashes thin out as the grass settles, landing exactly on the first frame.

S — Style
Looks: {{bg}} night rising to an {{accent2}} dusk band at the horizon, a hazy tree line, grass and seed heads in near-black silhouette; fireflies in {{accent}} with soft halos; a few {{ink}} stars.
Moves: each firefly drifts on a whole-number Lissajous path and flashes one to three times per loop (rise 0.1 s, hold 0.15 s, fade 0.75 s), rising as it flashes to draw a J; grass sway is a sine wave travelling across x, one cycle per loop.
Rules:
1. Flashes, not constant glows.
2. J-shaped flash strokes.
3. Three depths of fireflies.
4. A travelling sway wave through the grass.
5. One accent: the firefly light.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; at any moment only some fireflies are lit; the J strokes curve upward; grass never moves in lockstep; the sky gradient has no banding. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Firefly",
  theme: {
    bg: "#090a14",
    ink: "#f2efe2",
    accent: "#d8f46b",
    accent2: "#7a5fb0",
    font: "Newsreader",
  },
  tags: [
    "fireflies",
    "dusk",
    "meadow",
    "summer",
    "night",
    "magic",
    "glow",
    "grass",
    "calm",
    "nature",
    "ghibli",
  ],
  word: "Dusk",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const H = horizonOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `fly-dusk:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
        w,
        h,
        dusk(theme),
      ) as CanvasImageSource,
      0,
      0,
    );

    const p = t / LOOP;
    const hot = glow(theme.accent, 0.12, theme.ink);
    const halo = glow(theme.accent, 0.3);
    const soft = bokeh(theme.accent, 0.35, 0.3);

    const drawFlies = (layer: number) => {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < FLIES; i++) {
        const depth = i % 6 === 5 ? 2 : i % 2;
        if (depth !== layer) continue;
        const fx = 1 + Math.floor(hash(i, 1) * 2);
        const fy = 1 + Math.floor(hash(i, 2) * 2);
        const scale = depth === 0 ? 0.6 : depth === 1 ? 1.25 : 1.9;
        const bx = hash(i, 3) * w;
        const by =
          depth === 0
            ? H + u * 0.03 + hash(i, 4) * u * 0.08
            : depth === 1
              ? H + u * 0.04 + hash(i, 4) * (h - H) * 0.75
              : H + u * 0.08 + hash(i, 4) * (h - H - u * 0.08);
        const pos = (q: number) => [
          bx + Math.sin(TAU * (fx * q + hash(i, 5))) * u * 0.06 * scale,
          by + Math.sin(TAU * (fy * q + hash(i, 6))) * u * 0.025 * scale,
        ];
        const flashes = 2 + Math.floor(hash(i, 7) * 3);
        let lit = 0;
        let since = 1;
        for (let k = 0; k < flashes; k++) {
          const at = (hash(i, 10 + k) + k) / flashes;
          const f = flash(p, at);
          if (f > lit) {
            lit = f;
            let d = p - at;
            d -= Math.floor(d);
            since = d;
          }
        }
        const [x, y] = pos(p);
        // The rise while flashing turns the flash into a J.
        const lift = u * 0.03 * scale * clamp(since / 0.2);
        const yy = y - lift;
        // Dim body glow even when dark, so the eye can follow.
        blit(ctx, halo, x, yy, u * 0.02 * scale, 0.06);
        if (lit <= 0.01) continue;
        if (depth === 2) {
          blit(ctx, soft, x, yy, u * 0.04 * scale, lit * 0.32);
          blit(ctx, halo, x, yy, u * 0.12 * scale, lit * 0.2);
          continue;
        }
        // The J stroke: the path drawn during the flash so far.
        ctx.strokeStyle = rgba(mix(theme.accent, theme.ink, 0.3), 0.55 * lit);
        ctx.lineWidth = Math.max(0.8, u * 0.003 * scale);
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let s = 0; s <= 8; s++) {
          const back = (since * s) / 8;
          const [sx, sy] = pos(p - back);
          const l = u * 0.03 * scale * clamp((since - back) / 0.2);
          if (s === 0) ctx.moveTo(sx, sy - l);
          else ctx.lineTo(sx, sy - l);
        }
        ctx.stroke();
        blit(ctx, halo, x, yy, u * 0.14 * scale, 0.55 * lit);
        blit(ctx, hot, x, yy, u * 0.036 * scale, lit);
      }
      ctx.restore();
    };

    drawFlies(0);
    meadow(
      ctx,
      MID,
      H + u * 0.07,
      t,
      w,
      u,
      mix(theme.bg, theme.accent2, 0.08),
      mix(theme.bg, theme.accent2, 0.08),
      0.1,
    );
    drawFlies(1);
    meadow(
      ctx,
      FRONT,
      h + u * 0.02,
      t,
      w,
      u,
      mix(theme.bg, "#000000", 0.4),
      mix(theme.bg, "#000000", 0.4),
      0.14,
    );
    drawFlies(2);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
