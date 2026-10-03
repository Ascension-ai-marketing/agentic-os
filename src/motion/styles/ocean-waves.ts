import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  clamp,
  fbm3,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  once,
  rng,
  smoothstep,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, glow, mottled, pfbm, vgrad } from "./_s7-helpers";

/** Swells on the conveyor; each rolls from the horizon to the viewer once per loop. */
const N = 6;
/** Perspective: swells bunch up at the horizon and spread as they near. */
const P = 2.1;

interface Scene {
  u: number;
  H: number;
  B: number;
  cx: number;
  mx: number;
  my: number;
  mr: number;
}

function scene(w: number, h: number): Scene {
  const { u, portrait, square } = frameOf(w, h);
  const H = h * (portrait ? 0.3 : square ? 0.35 : 0.36);
  const mr = u * (portrait ? 0.085 : 0.075);
  return {
    u,
    H,
    B: h + u * 0.22,
    cx: w / 2,
    mx: portrait ? w * 0.5 : w * (square ? 0.6 : 0.63),
    my: H - mr * (portrait ? 1.9 : 1.75),
    mr,
  };
}

const depth = (s: number) => Math.pow(s, P);

/** Night sky, moon, halo and the far, flat water: everything that never moves. */
function sky(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const g = scene(w, h);
    mottled(c, w, h, theme.bg, theme.accent2, 0.035, 3, 0.02);
    vgrad(c, 0, 0, w, g.H, [
      [0, "#000000", 0.45],
      [0.55, theme.bg, 0],
      [1, mix(theme.bg, theme.accent2, 0.42), 0.9],
    ]);
    // A few faint stars, fewer near the moon.
    const r = rng(31);
    for (let i = 0; i < 90; i++) {
      const x = r() * w;
      const y = r() * g.H * 0.9;
      const d = Math.hypot(x - g.mx, y - g.my) / g.u;
      const a = (0.12 + r() * 0.4) * smoothstep(0.12, 0.45, d) * smoothstep(g.H, g.H * 0.55, y);
      c.fillStyle = rgba(theme.ink, a);
      const s = Math.max(0.6, g.u * (0.0012 + r() * r() * 0.0022));
      c.fillRect(x, y, s, s);
    }
    // Halo, then the moon with soft maria.
    light(c, g.mx, g.my, g.u * 0.75, theme.accent, 0.2);
    light(c, g.mx, g.my, g.mr * 3.2, theme.accent, 0.32);
    const disc = mix(theme.ink, theme.accent, 0.22);
    c.fillStyle = disc;
    c.beginPath();
    c.arc(g.mx, g.my, g.mr, 0, TAU);
    c.fill();
    c.save();
    c.beginPath();
    c.arc(g.mx, g.my, g.mr, 0, TAU);
    c.clip();
    const step = Math.max(1, Math.round(g.mr / 40));
    for (let y = g.my - g.mr; y < g.my + g.mr; y += step)
      for (let x = g.mx - g.mr; x < g.mx + g.mr; x += step) {
        const n = fbm3((x - g.mx) / (g.mr * 0.55), (y - g.my) / (g.mr * 0.55), 7.7, 3);
        if (n > 0.05) {
          c.fillStyle = rgba(theme.bg, Math.min(0.22, (n - 0.05) * 0.6));
          c.fillRect(x, y, step, step);
        }
      }
    // Limb darkening.
    const limb = c.createRadialGradient(
      g.mx - g.mr * 0.2,
      g.my - g.mr * 0.2,
      g.mr * 0.3,
      g.mx,
      g.my,
      g.mr,
    );
    limb.addColorStop(0, rgba(theme.bg, 0));
    limb.addColorStop(1, rgba(theme.bg, 0.28));
    c.fillStyle = limb;
    c.fillRect(g.mx - g.mr, g.my - g.mr, g.mr * 2, g.mr * 2);
    c.restore();
    // Far water: a dark sheet from the horizon down, fine glints under the moon.
    vgrad(c, 0, g.H, w, h, [
      [0, mix(theme.bg, theme.accent2, 0.34)],
      [0.08, mix(theme.bg, theme.accent2, 0.2)],
      [1, mix(theme.bg, "#000000", 0.3)],
    ]);
    const rr = rng(77);
    for (let i = 0; i < 700; i++) {
      const k = rr();
      const y = g.H + (h - g.H) * k * k * 0.5 + 1;
      const spread = g.u * (0.02 + k * 0.6);
      const x = g.mx + (rr() - 0.5) * 2 * spread * rr();
      const a = (0.1 + 0.5 * rr()) * (1 - Math.abs(x - g.mx) / spread);
      c.fillStyle = rgba(theme.accent, Math.max(0, a) * 0.7);
      c.fillRect(x, y, g.u * (0.003 + k * 0.012) * rr(), Math.max(0.6, g.u * 0.0011));
    }
    // A hair of haze on the horizon line itself.
    vgrad(c, 0, g.H - g.u * 0.02, w, g.H + g.u * 0.012, [
      [0, theme.accent2, 0],
      [0.62, mix(theme.accent2, theme.ink, 0.3), 0.3],
      [1, theme.accent2, 0],
    ]);
  };
}

/** Foam space: X repeats every SPAN world units; v runs 0 (crest) to 1 (foot of the foam). */
const SPAN = 8;
type Lace = { X: Float32Array; v: Float32Array; r: Float32Array; lod: Float32Array; n: number };

/**
 * Lace foam for swell i as bubbles: a dense whitecap band at the crest, then
 * bubbles strung along the edges of a stretched Voronoi mesh that drapes down
 * the face, broken into whitecap patches. Built once per swell.
 */
function lace(i: number): Lace {
  return once(`ocean-lace-${i}`, () => {
    const r = rng(1000 + i * 17);
    const cx = 0.13;
    const cv = 0.22;
    const gx = Math.round(SPAN / cx);
    const gv = Math.ceil(1.2 / cv) + 1;
    const sx = new Float32Array(gx * gv);
    const sv = new Float32Array(gx * gv);
    for (let j = 0; j < gv; j++)
      for (let k = 0; k < gx; k++) {
        sx[j * gx + k] = (k + 0.1 + 0.8 * r()) * (SPAN / gx);
        sv[j * gx + k] = (j - 0.5 + 0.1 + 0.8 * r()) * cv;
      }
    const X: number[] = [];
    const V: number[] = [];
    const R: number[] = [];
    const L: number[] = [];
    for (let c = 0; c < 11000; c++) {
      const x = r() * SPAN;
      const v = Math.pow(r(), 1.35) * 1.15 - 0.06;
      const patch = 0.5 + 0.5 * pfbm((x / SPAN) * 6, 6, i + 11, 2) * 1.6;
      const ci = Math.floor(x / (SPAN / gx));
      const cj = Math.floor((v + cv * 0.5) / cv);
      let f1 = 1e9;
      let f2 = 1e9;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        if (jj < 0 || jj >= gv) continue;
        for (let di = -1; di <= 1; di++) {
          const k = jj * gx + ((ci + di + gx) % gx);
          let dx = sx[k] - x;
          if (dx > SPAN / 2) dx -= SPAN;
          if (dx < -SPAN / 2) dx += SPAN;
          const dv = (sv[k] - v) * (cx / cv);
          const d = Math.sqrt(dx * dx + dv * dv);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const edge = f2 - f1;
      const cap = v < 0.1 + 0.12 * patch;
      const onLace = edge < 0.007 + 0.01 * (1 - v);
      const keep = cap ? r() < 0.7 : onLace && r() < patch * (1.2 - v);
      if (!keep) continue;
      X.push(x);
      V.push(v);
      R.push(cap ? 0.0028 + 0.0062 * r() ** 2.2 : 0.002 + 0.0042 * r() ** 2);
      L.push(r());
    }
    return {
      X: Float32Array.from(X),
      v: Float32Array.from(V),
      r: Float32Array.from(R),
      lod: Float32Array.from(L),
      n: X.length,
    };
  });
}

/** World-space crest profile of swell i at X (0..1 = crest peak). */
function profile(i: number, X: number) {
  const p1 = hash(i, 1) * TAU;
  const p2 = hash(i, 2) * TAU;
  const a = 0.5 + 0.5 * Math.sin(X * 1.9 + p1);
  const b = 0.5 + 0.5 * Math.sin(X * 4.3 + p2);
  const n = 0.5 + 0.5 * pfbm(X * 0.9 + i * 13.7, 64, i, 3);
  return Math.pow(0.45 * a + 0.25 * b + 0.3 * n, 1.7);
}

export const style: MotionStyle = {
  id: "ocean-waves",
  name: "Night Swell",
  family: "Nature",
  tagline: "A moonlit sea in swells",
  look: "A moonlit sea in stacked swells: dark layered water, lace foam on every crest, a glittering path under a low moon.",
  move: "Swells roll in from the horizon and grow as they near, foam thickening until each breaks out of frame and the next takes its place.",
  rules: [
    "Perspective does the work: swells bunch at the horizon and spread toward you.",
    "Every crest carries lace foam with holes, never a clean white line.",
    "The water is layered: each nearer swell covers the one behind it.",
    "Moonlight is the only warm colour: the moon, its halo and the glitter path.",
    "Foam thickens as a swell nears and breaks just before it leaves the frame.",
    "One swell every beat, each crossing the whole sea in one loop.",
    "No hard horizon: a hair of haze where sea meets sky.",
  ],
  prompt: `R — References
• Night seascape photography: a low moon laying a glitter path across rolling swells.
• Layered sea prints (search: Hiroshige waves, layered ocean illustration) for the stacked crests.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a dark sea under a low moon; small swells gather on the horizon.
• Middle (1.5–3.5 s): the swells roll toward the viewer, growing in perspective, lace foam thickening on every crest, moonlight glittering on their faces.
• End (3.5–5 s): the nearest swell breaks and rolls out of frame as a new one rises on the horizon, landing exactly on the first frame.

S — Style
Looks: {{bg}} night sky and water, swells shaded from {{accent2}} crests into near-black troughs, {{ink}} lace foam, a pale moon, halo and glitter path in {{accent}}.
Moves: six swells on a perspective conveyor (y = horizon + depth^2.1), each crossing the sea once per loop; foam is a lace strip warped along each crest; glitter flickers with the swell's travel.
Rules:
1. Perspective conveyor: whole swells per loop, so it wraps without a seam.
2. Painter's order: far swells first, nearer swells cover them.
3. Lace foam with holes, thicker as swells near and break.
4. One warm light: the moon and its path.
5. Grain and a soft vignette; never a flat fill.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; swells never pop in or out (they grow from the horizon and leave below the frame); foam has holes; the glitter sits under the moon; the horizon is soft. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Swell_(ocean)",
  theme: {
    bg: "#060a0f",
    ink: "#e8eef0",
    accent: "#f1d49c",
    accent2: "#3b6f8f",
    font: "Newsreader",
  },
  tags: [
    "ocean",
    "sea",
    "waves",
    "water",
    "moon",
    "night",
    "foam",
    "surf",
    "tide",
    "nature",
    "calm",
  ],
  word: "Tide",
  render(ctx, t, theme, w, h) {
    const g = scene(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `ocean-sky:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
        w,
        h,
        sky(theme),
      ) as CanvasImageSource,
      0,
      0,
    );

    const M = Math.max(48, Math.min(120, Math.round(w / 12)));
    const cols = Math.max(24, Math.min(72, Math.round(w / 22)));
    const rim = mix(theme.bg, mix(theme.accent2, theme.ink, 0.25), 0.85);
    const face = mix(theme.bg, theme.accent2, 0.42);
    const mid = mix(theme.bg, theme.accent2, 0.2);
    const trough = mix(theme.bg, "#000000", 0.25);
    const streak = mix(theme.accent2, theme.ink, 0.4);
    const xs = new Float32Array(M + 1);
    const ys = new Float32Array(M + 1);
    const amp = new Float32Array(M + 1);
    const margin = w * 0.04;
    const kOf = (x: number) => ((x + margin) / (w + margin * 2)) * M;

    // Far swells first.
    const order = Array.from({ length: N }, (_, i) => ({ i, s: (i / N + t / LOOP) % 1 }));
    order.sort((a, b) => a.s - b.s);

    for (const { i, s } of order) {
      if (s < 0.004) continue;
      const d = depth(s);
      const base = g.H + (g.B - g.H) * d;
      const A = g.u * (0.003 + 0.2 * d);
      const zoom = 0.14 + 1.9 * d;
      const next = g.H + (g.B - g.H) * depth(Math.min(1, s + 1 / N));
      const fadeIn = smoothstep(0.004, 0.08, s);
      const breaking = smoothstep(0.5, 0.92, s);
      const off = hash(i, 9) * 40;
      const drift = s * 0.9;

      for (let k = 0; k <= M; k++) {
        const x = -margin + ((w + margin * 2) * k) / M;
        const X = ((x - g.cx) / (g.u * zoom)) * 3.2 + off + drift;
        const p = profile(i, X);
        xs[k] = x;
        amp[k] = p;
        ys[k] = base - A * p * fadeIn;
      }

      // Body: a lit rim at the crest, a face, then a dark trough that hides the swells behind.
      const top = base - A;
      const bottom = Math.max(top + 2, next + A * 0.1);
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, rgba(rim, 1));
      grad.addColorStop(0.1, rgba(face, 1));
      grad.addColorStop(0.45, rgba(mid, 1));
      grad.addColorStop(1, rgba(trough, 1));
      ctx.globalAlpha = fadeIn;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let k = 1; k <= M; k++) ctx.lineTo(xs[k], ys[k]);
      ctx.lineTo(w + margin, h + 4);
      ctx.lineTo(-margin, h + 4);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // The moon reflected in this face: a soft patch, then glitter.
      const colW = g.u * (0.05 + 0.42 * d);
      const ky = sample(ys, kOf(g.mx));
      ctx.save();
      ctx.clip();
      ctx.globalCompositeOperation = "screen";
      ctx.translate(g.mx, ky + A * 0.35);
      ctx.scale(1, Math.max(0.08, (A * 1.3) / colW));
      const patch = ctx.createRadialGradient(0, 0, 0, 0, 0, colW);
      patch.addColorStop(0, rgba(theme.accent, 0.3 * fadeIn));
      patch.addColorStop(0.5, rgba(theme.accent, 0.1 * fadeIn));
      patch.addColorStop(1, rgba(theme.accent, 0));
      ctx.fillStyle = patch;
      ctx.fillRect(-colW, -colW, colW * 2, colW * 2);
      ctx.restore();

      // Ripple streaks riding on the face, parallel to the crest.
      ctx.lineWidth = Math.max(0.6, g.u * 0.0012 * (0.4 + d));
      for (let l = 1; l <= 3; l++) {
        const dd = A * (0.22 + l * 0.26) + g.u * 0.002 * l;
        ctx.strokeStyle = rgba(streak, (0.2 - l * 0.045) * fadeIn);
        ctx.beginPath();
        for (let k = 0; k <= M; k++) {
          const y = ys[k] + dd * (0.55 + 0.45 * amp[k]);
          if (k === 0) ctx.moveTo(xs[k], y);
          else ctx.lineTo(xs[k], y);
        }
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "lighter";
      for (let j = 0; j < 72; j++) {
        const x = g.mx + (hash(i, j, 3) - 0.5) * 2 * colW * Math.sqrt(hash(i, j, 4));
        const k = kOf(x);
        if (k < 0 || k > M) continue;
        const fall = 1 - Math.abs(x - g.mx) / colW;
        const flick = Math.pow(
          0.5 + 0.5 * Math.sin(TAU * (hash(i, j, 5) * 3 + s * (4 + Math.floor(hash(i, j, 6) * 5)))),
          2,
        );
        const a = fall * flick * fadeIn * (0.45 + 0.55 * d);
        if (a < 0.03) continue;
        const y = sample(ys, k) + A * (0.08 + 0.85 * hash(i, j, 7) ** 1.5);
        const len = g.u * (0.004 + 0.034 * d) * (0.35 + hash(i, j, 8));
        ctx.fillStyle = rgba(theme.accent, Math.min(1, a));
        ctx.fillRect(x - len / 2, y, len, Math.max(0.7, g.u * (0.001 + 0.0022 * d)));
      }
      ctx.globalCompositeOperation = "source-over";

      // Whitecap body: a soft band of light along the crest.
      const fh = (A * (0.34 + 1.25 * breaking) + g.u * 0.003) * fadeIn;
      ctx.lineJoin = "round";
      const band = new Path2D();
      for (let k = 0; k <= M; k++) {
        const y = ys[k] + fh * 0.16;
        if (k === 0) band.moveTo(xs[k], y);
        else band.lineTo(xs[k], y);
      }
      // Soft falloff down the face: thin offset strokes, fading as they go.
      const layers = 9;
      ctx.lineWidth = Math.max(1, (fh * 0.75) / layers + 0.5);
      for (let l = 0; l < layers; l++) {
        const k = l / (layers - 1);
        ctx.strokeStyle = rgba(theme.ink, (1 - k) ** 1.6 * 0.07 * (1 + 1.5 * breaking) * fadeIn);
        ctx.setTransform(1, 0, 0, 1, 0, fh * (k * 0.75 - 0.14));
        ctx.stroke(band);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Bright hairline on the crest itself.
      ctx.strokeStyle = rgba(theme.ink, 0.55 * fadeIn);
      ctx.lineWidth = Math.max(0.6, g.u * 0.0012 * (0.5 + d));
      ctx.beginPath();
      for (let k = 0; k <= M; k++) {
        if (k === 0) ctx.moveTo(xs[k], ys[k]);
        else ctx.lineTo(xs[k], ys[k]);
      }
      ctx.stroke();

      // Lace foam: bubbles strung along the mesh, dense at the crest.
      const L = lace(i);
      const pxPerX = (g.u * zoom) / 3.2;
      const X0 = ((0 - g.cx) / (g.u * zoom)) * 3.2 + off + drift;
      const X1 = ((w - g.cx) / (g.u * zoom)) * 3.2 + off + drift;
      const keep = clamp(0.85 * Math.pow(zoom, 1.4));
      const bright = new Path2D();
      const dim = new Path2D();
      // Bubbles just admitted by the level of detail fade in instead of popping.
      const fresh = new Path2D();
      for (let b = 0; b < L.n; b++) {
        if (L.lod[b] > keep) continue;
        const entering = L.lod[b] > keep - 0.06;
        const rr = Math.max(0.45, L.r[b] * pxPerX);
        const first = Math.ceil((X0 - L.X[b]) / SPAN);
        for (let copy = first; L.X[b] + copy * SPAN <= X1; copy++) {
          const Xw = L.X[b] + copy * SPAN;
          const x = g.cx + ((Xw - off - drift) / 3.2) * g.u * zoom;
          const y = sample(ys, kOf(x)) + L.v[b] * fh;
          const target = entering ? fresh : L.v[b] < 0.14 || L.lod[b] < 0.5 ? bright : dim;
          if (rr < 1.1) target.rect(x - rr, y - rr, rr * 2, rr * 2);
          else {
            target.moveTo(x + rr, y);
            target.arc(x, y, rr, 0, TAU);
          }
        }
      }
      ctx.fillStyle = rgba(theme.ink, 0.9 * fadeIn);
      ctx.fill(bright);
      ctx.fillStyle = rgba(theme.ink, 0.45 * fadeIn);
      ctx.fill(dim);
      ctx.fillStyle = rgba(theme.ink, 0.25 * fadeIn);
      ctx.fill(fresh);
    }

    // The moon path laid over the water, then the halo lifted by the lens.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.translate(g.mx, g.H);
    ctx.scale(0.3, 1);
    const R = (h - g.H) * 1.2;
    const path = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    path.addColorStop(0, rgba(theme.accent, 0.34));
    path.addColorStop(0.3, rgba(theme.accent, 0.1));
    path.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = path;
    ctx.fillRect(-R, 0, R * 2, h - g.H);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    blit(ctx, glow(theme.accent, 0.12), g.mx, g.my, g.mr * 6, 0.3);
    ctx.restore();
    ctx.globalAlpha = 1;

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};

function sample(arr: Float32Array, k: number) {
  const k0 = Math.max(0, Math.min(arr.length - 1, Math.floor(k)));
  const k1 = Math.min(arr.length - 1, k0 + 1);
  const f = k - k0;
  return arr[k0] + (arr[k1] - arr[k0]) * f;
}
