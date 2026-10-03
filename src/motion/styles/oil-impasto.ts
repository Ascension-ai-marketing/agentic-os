import { mix, parse } from "../engine/color";
import {
  bake,
  clamp,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  noise3,
  rng,
  smoothstep,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { sprite } from "./_s2-helpers";

/**
 * Oil impasto. Every dab is a tiny lit height field: bristle ridges, a paint
 * load where the brush landed, a lip where it lifted, specular glints and a
 * cast shadow. Sprites are baked per colour, shape and orientation bin (the
 * light is fixed top-left), so a rotating dab keeps a physically lit ridge.
 */
const BINS = 24;
const SHAPES = 3;
/** Light from the top left, a little in front of the canvas. */
const LIGHT: [number, number, number] = (() => {
  const v = [-0.55, -0.62, 0.85];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/** Brush loads: a main colour and the colour streaked through it. */
function palette(theme: Theme): [string, string][] {
  const deep = mix(theme.accent2, theme.bg, 0.55);
  const blue = theme.accent2;
  const pale = mix(theme.accent2, theme.ink, 0.42);
  const white = theme.ink;
  const paleGold = mix(theme.accent, theme.ink, 0.35);
  const gold = theme.accent;
  const night = mix(theme.bg, theme.accent2, 0.22);
  const green = mix(theme.accent, theme.accent2, 0.55);
  const mid = mix(theme.accent2, theme.bg, 0.3);
  const light = mix(theme.accent2, theme.ink, 0.2);
  const lemon = mix(theme.accent, "#ffffff", 0.14);
  return [
    [deep, mid],
    [blue, pale],
    [pale, white],
    [white, paleGold],
    [paleGold, white],
    [gold, lemon],
    [night, deep],
    [green, blue],
    [mid, blue],
    [light, white],
    [lemon, white],
  ];
}

/** One dab sprite in local coordinates, lit for orientation bin `bin`. */
const BEND = [0.16, -0.12, 0.28];
const SLANT = [0.06, -0.08, 0.1];

function dabSprite(load: [string, string], shape: number, bin: number, len: number): AnyCanvas {
  const L = Math.max(6, Math.round(len));
  const W = Math.max(3, Math.round(len * (0.32 + shape * 0.05)));
  const pad = Math.ceil(W * 0.5) + 2;
  const cw = L + pad * 2;
  const ch = W + pad * 2;
  return sprite(`oil-dab:${load[0]}${load[1]}:${shape}:${bin}:${L}`, cw, ch, (g) => {
    const img = g.createImageData(cw, ch);
    const d = img.data;
    const [ar, ag, ab] = parse(load[0]);
    const [br, bg, bb] = parse(load[1]);
    const ang = (bin / BINS) * TAU;
    // Light in the sprite's local frame (the sprite is drawn rotated by ang).
    const lx = LIGHT[0] * Math.cos(-ang) - LIGHT[1] * Math.sin(-ang);
    const ly = LIGHT[0] * Math.sin(-ang) + LIGHT[1] * Math.cos(-ang);
    const lz = LIGHT[2];
    const seed = shape * 17 + 3;
    const H = new Float32Array(cw * ch);
    const M = new Float32Array(cw * ch);
    const C = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const u = (x - pad) / L;
        const v0 = (y - ch / 2) / (W / 2);
        // A curved stroke: the centre line arches.
        const v = v0 - BEND[shape] * (1 - (2 * u - 1) ** 2);
        const half = (1 - 0.18 * u) * (1 + 0.07 * noise3(u * 6, seed, 2.1));
        const startU = 0.04 + SLANT[shape] * (v + 1);
        const endU = 0.8 + 0.2 * (0.5 + 0.5 * noise3(v * 4.3, seed, 0.4));
        let inside = Math.min((half - Math.abs(v)) * 7, (endU - u) * 24, (u - startU) * 26);
        if (inside <= 0) continue;
        inside = Math.min(1, inside);
        const plateau = smoothstep(half, half * 0.6, Math.abs(v));
        const freq = 13 + 4 * noise3(u * 1.7, seed, 5.5);
        const groove = 0.5 + 0.5 * Math.sin(v * freq + noise3(v * 7, u * 1.4, seed) * 2.6);
        const depth = 0.32 + 0.22 * noise3(u * 3, v, seed + 9);
        let hgt = plateau * (0.55 + depth * groove) * (1 - 0.32 * u);
        hgt += 0.3 * Math.exp(-(((u - startU - 0.05) / 0.09) ** 2)) * plateau;
        hgt += 0.16 * Math.exp(-(((u - endU + 0.05) / 0.045) ** 2)) * plateau;
        H[y * cw + x] = hgt;
        // Paint runs thin toward the lift: grooves open onto the layer below.
        const thin = smoothstep(0.55, 0.95, u) * (1 - groove) * 0.8;
        M[y * cw + x] = inside * (1 - thin);
        // The second colour loaded on the brush streaks along the grooves.
        C[y * cw + x] = smoothstep(0.35, 0.75, noise3(v * 8.5, u * 0.6, seed + 31)) * 0.85;
      }
    const k = W * 0.1;
    // Cast shadow first: the dab's mask pushed away from the light.
    const sx = Math.round(-lx * W * 0.14);
    const sy = Math.round(-ly * W * 0.14);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const o = (y * cw + x) * 4;
        const m = M[y * cw + x];
        const xs = x - sx;
        const ys = y - sy;
        const ms = xs >= 0 && ys >= 0 && xs < cw && ys < ch ? M[ys * cw + xs] : 0;
        if (m <= 0.01) {
          if (ms > 0) d[o + 3] = Math.round(ms * 80);
          continue;
        }
        const hx = (H[y * cw + Math.min(cw - 1, x + 1)] - H[y * cw + Math.max(0, x - 1)]) * 0.5;
        const hy = (H[Math.min(ch - 1, y + 1) * cw + x] - H[Math.max(0, y - 1) * cw + x]) * 0.5;
        let nx = -hx * k;
        let ny = -hy * k;
        let nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const dif = Math.max(0, nx * lx + ny * ly + nz * lz);
        // Blinn highlight: small and bright, only on ridge tops facing the light.
        const hl = Math.hypot(lx, ly, lz + 1);
        const spec = Math.pow(Math.max(0, (nx * lx + ny * ly + nz * (lz + 1)) / hl), 60);
        const shade = 0.38 + 0.78 * dif;
        const s = spec * 0.85;
        const mixK = C[y * cw + x];
        const r0 = ar + (br - ar) * mixK;
        const g0 = ag + (bg - ag) * mixK;
        const b0 = ab + (bb - ab) * mixK;
        d[o] = clamp(r0 * shade + 255 * s, 0, 255);
        d[o + 1] = clamp(g0 * shade + 250 * s, 0, 255);
        d[o + 2] = clamp(b0 * shade + 235 * s, 0, 255);
        d[o + 3] = Math.round(Math.max(m, ms * 0.3) * 255);
      }
    g.putImageData(img, 0, 0);
  });
}

type Dab = { x: number; y: number; a: number; col: number; shape: number; len: number };

function drawDab(c: Ctx2D, pal: [string, string][], d: Dab, u: number) {
  const len = Math.max(6, Math.round(d.len * u));
  const angN = ((d.a % TAU) + TAU) % TAU;
  const bin = Math.round((angN / TAU) * BINS) % BINS;
  const spr = dabSprite(pal[d.col], d.shape, bin, len);
  const sw = (spr as { width: number }).width;
  const sh = (spr as { height: number }).height;
  const pad = Math.ceil(Math.max(3, Math.round(len * (0.32 + d.shape * 0.05))) * 0.5) + 2;
  const ca = Math.cos(d.a);
  const sa = Math.sin(d.a);
  c.setTransform(ca, sa, -sa, ca, d.x, d.y);
  c.drawImage(spr as CanvasImageSource, -pad - len * 0.45, -sh / 2, sw, sh);
}

type Geo = { ox: number; oy: number; R: number; u: number; w: number; h: number; horizon: number };

function geo(w: number, h: number): Geo {
  const { u, portrait, square } = frameOf(w, h);
  return {
    ox: portrait ? w * 0.52 : square ? w * 0.56 : w * 0.64,
    oy: portrait ? h * 0.34 : square ? h * 0.36 : h * 0.4,
    R: u * (portrait ? 0.15 : 0.14),
    u,
    w,
    h,
    horizon: h * (portrait ? 0.74 : 0.76),
  };
}

/** The flow of the sky: a vortex around the orb inside currents that run sideways. */
function flowAngle(g: Geo, x: number, y: number) {
  const dx = x - g.ox;
  const dy = y - g.oy;
  const r = Math.hypot(dx, dy);
  const swirl = Math.exp(-((r / (g.R * 3.4)) ** 2));
  const tang = Math.atan2(dy, dx) + Math.PI / 2;
  const wave =
    0.35 * Math.sin((x / g.u) * 3.2 + (y / g.u) * 1.5) + 0.25 * noise3(x / g.u, y / g.u, 1.7);
  const ax = Math.cos(tang) * swirl + Math.cos(wave) * (1 - swirl);
  const ay = Math.sin(tang) * swirl + Math.sin(wave) * (1 - swirl);
  return Math.atan2(ay, ax);
}

/** The static underpainting: the whole canvas covered in lit dabs along the flow. */
function underpainting(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const g = geo(w, h);
    const pal = palette(theme);
    const { u } = g;
    c.fillStyle = mix(theme.bg, theme.accent2, 0.12);
    c.fillRect(0, 0, w, h);
    const r = rng(7707);
    const step = u * 0.021;
    const cols = Math.ceil(w / step) + 2;
    const rows = Math.ceil(h / step) + 2;
    const dabs: Dab[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const x = (i + r() * 0.9 - 0.5) * step;
        const y = (j + r() * 0.9 - 0.5) * step;
        const hill =
          y > g.horizon + Math.sin((x / u) * 2.6) * u * 0.05 + noise3((x / u) * 2, 0, 3) * u * 0.05;
        const dr = Math.hypot(x - g.ox, y - g.oy) / g.R;
        let col: number;
        let a: number;
        if (hill) {
          a = Math.sin((x / u) * 2.6) * 0.25 + (r() - 0.5) * 0.5;
          col = r() < 0.5 ? 6 : r() < 0.55 ? 0 : r() < 0.7 ? 8 : 7;
        } else {
          a = flowAngle(g, x, y) + (r() - 0.5) * 0.3;
          const n = noise3((x / u) * 2.2, (y / u) * 2.2, 0.3);
          const q = r();
          col =
            dr < 1.7
              ? q < 0.5
                ? 4
                : 9
              : n > 0.2
                ? q < 0.6
                  ? 2
                  : 9
                : n > -0.05
                  ? q < 0.6
                    ? 1
                    : 8
                  : q < 0.6
                    ? 0
                    : 8;
          if (r() < 0.035) col = 3;
        }
        dabs.push({ x, y, a, col, shape: Math.floor(r() * SHAPES), len: 0.042 + r() * 0.03 });
      }
    c.save();
    for (const d of dabs) drawDab(c, pal, d, u);
    c.restore();
    c.setTransform(1, 0, 0, 1, 0, 0);
  };
}

/** The orb: a thick core of crossing strokes inside rings of short dabs. */
function orb(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const g = geo(w, h);
    const pal = palette(theme);
    const r = rng(311);
    c.save();
    // Core: loaded strokes laid across each other in a loose spiral.
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4 + r() * 0.4;
      const rr = g.R * (0.08 + r() * 0.22);
      drawDab(
        c,
        pal,
        {
          x: g.ox + Math.cos(a) * rr,
          y: g.oy + Math.sin(a) * rr,
          a: a + Math.PI / 2 + (r() - 0.5) * 0.6,
          col: i % 3 === 0 ? 10 : 3,
          shape: i % 3,
          len: 0.07 + r() * 0.03,
        },
        g.u,
      );
    }
    for (let ring = 0; ring < 3; ring++) {
      const rr = g.R * (0.46 + ring * 0.22);
      const n = Math.max(6, Math.round((TAU * rr) / (g.u * 0.034)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + ring * 0.5 + r() * 0.15;
        drawDab(
          c,
          pal,
          {
            x: g.ox + Math.cos(a) * rr * (1 + (r() - 0.5) * 0.08),
            y: g.oy + Math.sin(a) * rr * (1 + (r() - 0.5) * 0.08),
            a: a + Math.PI / 2 + (r() - 0.5) * 0.25,
            col: ring === 0 ? (r() < 0.5 ? 3 : 10) : ring === 1 ? (r() < 0.6 ? 4 : 10) : 5,
            shape: Math.floor(r() * SHAPES),
            len: 0.05 + r() * 0.02,
          },
          g.u,
        );
      }
    }
    c.restore();
    c.setTransform(1, 0, 0, 1, 0, 0);
  };
}

// Vortex rings: [radius / R, dabs, colours]. The pattern repeats every 3 dabs
// and each ring turns by exactly 3 slots per loop, so the loop is seamless.
const PERIOD = 3;
const RINGS: [number, number, number[]][] = [
  [1.12, 27, [5, 10, 4]],
  [1.3, 30, [4, 5, 3]],
  [1.48, 36, [10, 4, 5]],
  [1.67, 39, [4, 9, 3]],
  [1.86, 42, [2, 3, 9]],
  [2.06, 48, [9, 2, 1]],
  [2.27, 51, [1, 2, 8]],
  [2.49, 57, [8, 1, 9]],
  [2.72, 60, [1, 0, 2]],
];
// Currents: [y as a share of the horizon, dabs across, direction, colours] (period 2, 2 slots per loop).
const CURRENTS: [number, number, number, number[]][] = [
  [0.12, 30, -1, [2, 9]],
  [0.24, 32, 1, [1, 2]],
  [0.87, 34, 1, [9, 2]],
];

export const style: MotionStyle = {
  id: "oil-impasto",
  name: "Oil Impasto",
  family: "Paint & Draw",
  tagline: "A night sky in thick oil",
  look: "A night sky in thick oil paint: every stroke a lit ridge of bristle grooves and glints, a vortex turning around a glowing orb.",
  move: "Rings of paint strokes wheel around the orb at their own speeds while bands of sky flow past; the light stays put, so ridges glint as they turn.",
  rules: [
    "Every stroke has relief: bristle grooves, a paint load, a lifted lip.",
    "One fixed light: highlights sit on ridge tops facing it, shadows fall away.",
    "Strokes follow the flow: around the orb, then sideways through the sky.",
    "Nothing is a smooth gradient; colour changes stroke by stroke.",
    "Inner rings turn faster than outer ones, like a vortex.",
    "Rings move whole stroke slots per loop, so the loop is seamless.",
    "Thick paint casts a small shadow of its own.",
  ],
  prompt: `R — References
• Van Gogh's impasto skies (search: The Starry Night detail, impasto brushstroke close-up, raking light).
• Petros Vrellis' animated Starry Night: strokes flowing along the painting's own currents.

I — Idea
One image, one turn, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a glowing orb sits in a sky built from thick oil strokes; rings of strokes around it begin to wheel.
• Middle (1.5–3.5 s): the rings turn at different speeds, the inner ones fastest; bands of sky flow sideways; ridges catch the light as they rotate.
• End (3.5–5 s): each ring lands exactly a few stroke slots along, so the frame matches the first.

S — Style
Looks: {{bg}} night; strokes in {{accent2}}, a pale blue mixed toward {{ink}}, {{ink}} and {{accent}}; thick relief everywhere; dark hills at the foot; "{{name}}" signed small in the corner in {{accent}}, in a brush script.
Moves: each ring rotates by a whole number of stroke slots per loop (inner faster); currents slide a whole number of slots; the light never moves, so each stroke's highlight is recomputed for its angle.
Rules:
1. Stroke relief: bristle grooves, paint load at the start, a lip at the lift.
2. One fixed top-left light; specular glints only on ridge tops.
3. Strokes follow a flow field: vortex around the orb, currents elsewhere.
4. Colour changes stroke by stroke, never as a gradient.
5. Inner rings faster than outer rings.
6. Whole-slot motion for a seamless loop.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; strokes read as thick paint with relief, not flat dashes; the highlight stays on the lit side as strokes turn; no gaps of bare ground; the orb glows. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Impasto",
  theme: {
    bg: "#0b0e18",
    ink: "#f4ead0",
    accent: "#f2b53a",
    accent2: "#3b63c4",
    font: "Caveat",
  },
  fonts: ["Caveat:wght@400..700"],
  tags: [
    "oil",
    "impasto",
    "paint",
    "painting",
    "brushstroke",
    "van gogh",
    "starry",
    "texture",
    "thick",
    "swirl",
    "art",
  ],
  word: "Nocturne",
  render(ctx, t, theme, w, h) {
    const g = geo(w, h);
    const { u } = g;
    const pal = palette(theme);
    ground(ctx, w, h, theme.bg);
    const key = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`;
    ctx.drawImage(bake(`oil-under:${key}`, w, h, underpainting(theme)) as CanvasImageSource, 0, 0);
    // The orb's glow sits in the paint, under the rings.
    light(ctx, g.ox, g.oy, g.R * 3.2, theme.accent, 0.28);
    const ph = t / LOOP;

    ctx.save();
    // Currents: bands of strokes sliding sideways two slots per loop. Drawn in
    // x order, so the overlap only reorders off-screen where the band wraps.
    for (let b = 0; b < CURRENTS.length; b++) {
      const [yk, n, dir, cols] = CURRENTS[b];
      const span = w * 1.1;
      const stepX = span / n;
      const shift = dir * 2 * stepX * ph;
      const y0 = g.horizon * yk;
      const list: Dab[] = [];
      for (let i = 0; i < n; i++) {
        const x = ((((i * stepX + shift) % span) + span) % span) - w * 0.05;
        const y = y0 + Math.sin((x / u) * 3 + b) * u * 0.035;
        if (Math.hypot(x - g.ox, y - g.oy) < g.R * 2.8) continue;
        const a = Math.atan2(Math.cos((x / u) * 3 + b) * 0.105, 1);
        for (let row = 0; row < 2; row++) {
          const k = (i + row) % 2;
          list.push({
            x: x + row * stepX * 0.5,
            y: y + (row - 0.5) * u * 0.022,
            a: a + (k - 0.5) * 0.08,
            col: cols[k],
            shape: k + row,
            len: 0.085,
          });
        }
      }
      list.sort((p, q) => p.x - q.x);
      for (const d of list) drawDab(ctx, pal, d, u);
    }
    // Vortex rings: each turns by whole slots per loop, inner rings faster.
    // Drawn in angle order from a fixed seam, so t = 0 and t = 5 overlap alike.
    const seamAt = Math.PI * 0.62;
    for (let j = 0; j < RINGS.length; j++) {
      const [rk, n, cols] = RINGS[j];
      const rr = g.R * rk;
      const turn = (PERIOD * TAU * ph) / n;
      const list: (Dab & { rel: number })[] = [];
      for (let i = 0; i < n; i++) {
        const k = i % PERIOD;
        const a = (i / n) * TAU + turn + j * 0.37 + 0.03 * (k - 1);
        const wob = 1 + 0.03 * Math.sin(a * 3 + j) + 0.035 * (k - 1);
        const x = g.ox + Math.cos(a) * rr * wob;
        const y = g.oy + Math.sin(a) * rr * wob * 0.94;
        const rel = (((a - seamAt) % TAU) + TAU) % TAU;
        const len = ((TAU * rr) / n / u) * (1.45 + 0.2 * k);
        list.push({
          x,
          y,
          a: a + Math.PI / 2 + 0.1 + 0.1 * (k - 1),
          col: cols[k],
          shape: k,
          len,
          rel,
        });
      }
      list.sort((p, q) => p.rel - q.rel);
      for (const d of list) drawDab(ctx, pal, d, u);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bake(`oil-orb:${key}`, w, h, orb(theme)) as CanvasImageSource, 0, 0);
    light(ctx, g.ox, g.oy, g.R * 1.4, theme.ink, 0.22);

    // Signature, painted small in the corner.
    const word = wordFor(theme.name, "Nocturne", 12);
    const size = u * 0.075;
    ctx.save();
    ctx.font = font(700, size, "Caveat", "cursive");
    ctx.fillStyle = mix(theme.accent, theme.ink, 0.15);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowOffsetX = u * 0.002;
    ctx.shadowOffsetY = u * 0.003;
    ctx.fillText(word, w - u * 0.07, h - u * 0.06);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
  },
};
