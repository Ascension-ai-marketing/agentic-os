import { mix, rgba } from "../engine/color";
import {
  fbm3,
  fract,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  once,
  smoothstep,
  TAU,
  vignette,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";

const COUNT = 1150;
const STEPS = 120;
const TRAIL = 22;
const DISC = 0.2;

type Paths = { xs: Float32Array; ys: Float32Array; tone: Uint8Array; phase: Float32Array };

/** Streamlines around a disc through curl noise, in units of the short side, centred. */
function paths(aspect: number): Paths {
  return once(`flow-paths:${aspect.toFixed(3)}`, () => {
    const W = aspect >= 1 ? aspect : 1;
    const H = aspect >= 1 ? 1 : 1 / aspect;
    // Sample the velocity field on a grid once.
    const G = 160;
    const gx = Math.ceil(G * (W + 0.8));
    const gy = Math.ceil(G * (H + 0.8));
    const vx = new Float32Array(gx * gy);
    const vy = new Float32Array(gx * gy);
    const e = 0.004;
    const psi = (x: number, y: number) => fbm3(x * 1.6 + 3, y * 1.6, 0.5, 2);
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        const x = i / G - (W + 0.8) / 2;
        const y = j / G - (H + 0.8) / 2;
        // Potential flow around a cylinder, drifting right.
        const r2 = x * x + y * y;
        const R2 = DISC * DISC;
        const inv = R2 / Math.max(r2, R2 * 0.8);
        const cos2 = (x * x - y * y) / Math.max(r2, 1e-6);
        const sin2 = (2 * x * y) / Math.max(r2, 1e-6);
        let ux = 1 - inv * cos2;
        let uy = -inv * sin2;
        // Curl noise swirls, damped near the disc so streams hug it.
        const damp = smoothstep(DISC * 1.05, DISC * 2.2, Math.sqrt(r2));
        const cx = (psi(x, y + e) - psi(x, y - e)) / (2 * e);
        const cy = -(psi(x + e, y) - psi(x - e, y)) / (2 * e);
        ux += cx * 0.22 * damp;
        uy += cy * 0.22 * damp;
        const k = j * gx + i;
        vx[k] = ux;
        vy[k] = uy;
      }
    const at = (x: number, y: number): [number, number] => {
      const fx = (x + (W + 0.8) / 2) * G;
      const fy = (y + (H + 0.8) / 2) * G;
      const i = Math.max(0, Math.min(gx - 2, Math.floor(fx)));
      const j = Math.max(0, Math.min(gy - 2, Math.floor(fy)));
      const tx = Math.max(0, Math.min(1, fx - i));
      const ty = Math.max(0, Math.min(1, fy - j));
      const k = j * gx + i;
      const a = vx[k] + (vx[k + 1] - vx[k]) * tx;
      const b = vx[k + gx] + (vx[k + gx + 1] - vx[k + gx]) * tx;
      const c = vy[k] + (vy[k + 1] - vy[k]) * tx;
      const d = vy[k + gx] + (vy[k + gx + 1] - vy[k + gx]) * tx;
      return [a + (b - a) * ty, c + (d - c) * ty];
    };
    const xs = new Float32Array(COUNT * STEPS);
    const ys = new Float32Array(COUNT * STEPS);
    const tone = new Uint8Array(COUNT);
    const phase = new Float32Array(COUNT);
    const h = 0.011;
    for (let p = 0; p < COUNT; p++) {
      let x = -W / 2 - 0.25 + hash(p, 1) * (W + 0.1);
      let y = (hash(p, 2) - 0.5) * (H + 0.2);
      if (x * x + y * y < DISC * DISC * 1.2) y += y < 0 ? -DISC : DISC;
      for (let s = 0; s < STEPS; s++) {
        xs[p * STEPS + s] = x;
        ys[p * STEPS + s] = y;
        const [ax, ay] = at(x, y);
        const [bx, by] = at(x + ax * h * 0.5, y + ay * h * 0.5);
        const m = Math.hypot(bx, by) || 1;
        x += (bx / m) * h;
        y += (by / m) * h;
        const r = Math.hypot(x, y);
        if (r < DISC * 1.02) {
          x = (x / r) * DISC * 1.02;
          y = (y / r) * DISC * 1.02;
        }
      }
      const pick = hash(p, 9);
      tone[p] = pick < 0.13 ? 1 : pick < 0.25 ? 2 : 0;
      phase[p] = hash(p, 4);
    }
    return { xs, ys, tone, phase };
  });
}

export const style: MotionStyle = {
  id: "flow-field",
  name: "Particle Flow Field",
  look: "Fourteen hundred luminous streaks tracing wind around a dark planet: long-exposure light in ink, amber and blue.",
  move: "Particles stream along a still vector field, bending around the disc; each one is born, flows its whole path and fades once per loop.",
  rules: [
    "The field never moves; the particles do. That is what makes it calm.",
    "Streams are divergence-free (curl noise) plus flow around one disc.",
    "Every trail tapers: bright head, fading tail.",
    "Particles fade in and out at the ends of their path; nothing pops.",
    "Additive light on a dark ground: overlaps glow.",
    "Two accents at about one particle in eight each; the rest is ink.",
    "The disc is implied by the flow, only faintly lit.",
  ],
  prompt: `R — References
• Generative flow fields and curl noise (search: Tyler Hobbs flow fields, curl noise particles).
• Long-exposure light trails; wind maps (earth.nullschool.net).

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): streams of light pour in from the left through a quiet dark field.
• Middle (1.5–3.5 s): they part and wrap around an unseen planet, braiding into amber and blue currents.
• End (3.5–5 s): the streams keep flowing; each particle completes exactly one journey per loop, so the last frame is the first.

S — Style
Looks: {{bg}} ground with a soft light pool, {{ink}} streaks, one in eight {{accent}}, one in eight {{accent2}}, additive blending, a faintly lit dark disc.
Moves: a static field (potential flow around a cylinder + curl noise); precomputed streamlines; each particle's head travels its path once per loop with a tapered trail; fade in and out at path ends.
Rules:
1. Static field, moving particles.
2. Divergence-free swirls plus flow around one disc.
3. Tapered trails, additive light.
4. No popping: fade at both ends of every path.
5. Two accents, one in eight particles each.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the disc reads as negative space; no particle crosses the disc; the frame is evenly filled (no empty corners); trails taper. Fix what fails and render again until every check passes.`,
  ref: "https://tylerxhobbs.com/words/flow-fields",
  theme: {
    bg: "#07080c",
    ink: "#dce3f0",
    accent: "#ffb547",
    accent2: "#5b7cfa",
    font: "Inter",
  },
  tags: [
    "particles",
    "flow",
    "field",
    "generative",
    "wind",
    "data",
    "abstract",
    "light",
    "trails",
    "space",
    "calm",
    "science",
    "wave",
    "sound",
    "voice",
    "audio",
    "signal",
  ],
  word: "Motion",
  family: "Light & Material",
  tagline: "Light streams round a planet",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    light(ctx, w * 0.5, h * 0.5, Math.max(w, h) * 0.7, theme.accent2, 0.1);

    const P = paths(w / h);
    const cx = w / 2;
    const cy = h / 2;
    // The planet: a dark disc with a faint rim light.
    const R = DISC * u;
    const planet = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    planet.addColorStop(0, mix(theme.bg, theme.accent2, 0.16));
    planet.addColorStop(1, mix(theme.bg, "#000000", 0.4));
    ctx.fillStyle = planet;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(theme.accent2, 0.18);
    ctx.lineWidth = Math.max(1, u * 0.002);
    ctx.stroke();
    // A dropped logo sits in the planet; the streams flow around it.
    const mark = tintedLogo(theme, theme.ink, R * 1.05, R * 1.05);
    if (mark) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(mark as CanvasImageSource, cx - R * 0.525, cy - R * 0.525);
      ctx.restore();
    }

    const colors = [theme.ink, theme.accent, theme.accent2];
    const LEVELS = 6;
    const chunks = [0.22, 0.5, 1];
    const paths2d = Array.from({ length: 3 * chunks.length * LEVELS }, () => new Path2D());
    const used = new Uint8Array(paths2d.length);
    for (let p = 0; p < COUNT; p++) {
      const head = fract(P.phase[p] + t / LOOP) * (STEPS - 1);
      const life = head / (STEPS - 1);
      const fade = smoothstep(0, 0.12, life) * smoothstep(1, 0.86, life);
      if (fade <= 0.02) continue;
      const level = Math.min(LEVELS - 1, Math.floor(fade * LEVELS));
      const h0 = Math.max(0, head - TRAIL);
      const span = head - h0;
      for (let c = 0; c < chunks.length; c++) {
        const a = h0 + (span * c) / chunks.length;
        const b = h0 + (span * (c + 1)) / chunks.length;
        const idx = (P.tone[p] * chunks.length + c) * LEVELS + level;
        const path = paths2d[idx];
        used[idx] = 1;
        const i0 = Math.floor(a);
        const pt = (s: number): [number, number] => {
          const i = Math.min(STEPS - 2, Math.floor(s));
          const f = s - i;
          const k = p * STEPS + i;
          const x = P.xs[k] + (P.xs[k + 1] - P.xs[k]) * f;
          const y = P.ys[k] + (P.ys[k + 1] - P.ys[k]) * f;
          return [cx + x * u, cy + y * u];
        };
        const [sx, sy] = pt(a);
        path.moveTo(sx, sy);
        for (let i = i0 + 1; i < b; i++) {
          const [x, y] = pt(i);
          path.lineTo(x, y);
        }
        const [ex, ey] = pt(b);
        path.lineTo(ex, ey);
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let tone = 0; tone < 3; tone++)
      for (let c = 0; c < chunks.length; c++)
        for (let level = 0; level < LEVELS; level++) {
          const idx = (tone * chunks.length + c) * LEVELS + level;
          if (!used[idx]) continue;
          ctx.strokeStyle = rgba(
            colors[tone],
            chunks[c] * ((level + 0.5) / LEVELS) * (tone ? 0.95 : 0.62),
          );
          ctx.lineWidth = Math.max(0.7, u * (0.0016 + c * 0.0005));
          ctx.stroke(paths2d[idx]);
        }
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
  },
};
