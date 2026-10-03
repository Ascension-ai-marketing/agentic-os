import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  context,
  fbm3,
  font,
  frameOf,
  grain,
  hash,
  LOOP,
  makeCanvas,
  noise3,
  once,
  rng,
  SANS,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

interface Scene {
  u: number;
  horizon: number;
  /** Ridge height (y) sampled across the width. */
  ridge: Float32Array;
  step: number;
  sky: Path2D;
  lake: Path2D;
  portrait: boolean;
}

function scene(w: number, h: number): Scene {
  return once(`aurora-scene:${w}x${h}`, () => {
    const { u, portrait, square } = frameOf(w, h);
    const horizon = h * (portrait ? 0.7 : square ? 0.71 : 0.72);
    const n = 160;
    const step = w / (n - 1);
    const ridge = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      // A far soft range and a near jagged one (ridged noise) with one clear peak.
      const far = fbm3(x * 2.6, 0.3, 1.7, 3) * 0.5 + 0.5;
      const jag = 1 - Math.abs(fbm3(x * 6.5 + 7, 0.8, 2.9, 4)) * 2.2;
      const peak = Math.exp(-(((x - (portrait ? 0.64 : 0.7)) / 0.11) ** 2));
      const hgt = u * (0.03 + 0.05 * far + 0.045 * Math.max(0, jag) + 0.09 * peak);
      ridge[i] = horizon - hgt;
    }
    const sky = new Path2D();
    sky.moveTo(0, -2);
    sky.lineTo(w, -2);
    for (let i = n - 1; i >= 0; i--) sky.lineTo(i * step, ridge[i] + 0.5);
    sky.closePath();
    const lake = new Path2D();
    lake.moveTo(0, h + 2);
    lake.lineTo(w, h + 2);
    for (let i = n - 1; i >= 0; i--) lake.lineTo(i * step, 2 * horizon - ridge[i] - 0.5);
    lake.closePath();
    return { u, horizon, ridge, step, sky, lake, portrait };
  });
}

/** Sky, stars, mountains, water and the mountains' reflection: everything that does not move. */
function land(theme: Theme, S: Scene) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u, horizon, ridge, step } = S;
    const sky = c.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, mix(theme.bg, "#000000", 0.35));
    sky.addColorStop(0.6, theme.bg);
    sky.addColorStop(1, mix(theme.bg, theme.accent, 0.08));
    c.fillStyle = sky;
    c.fillRect(0, 0, w, horizon + 2);
    // Stars: many faint, a few bright with a soft halo.
    const r = rng(2024);
    const count = Math.round((w * horizon) / 900);
    for (let i = 0; i < count; i++) {
      const x = r() * w;
      const y = r() * horizon * 0.95;
      const m = r();
      const b = m * m * m;
      const s = Math.max(0.45, u * (0.0006 + 0.0012 * b));
      c.fillStyle = rgba(mix(theme.ink, theme.accent2, r() * 0.3), 0.25 + 0.75 * b);
      c.beginPath();
      c.arc(x, y, s, 0, TAU);
      c.fill();
      if (b > 0.55) {
        const g = c.createRadialGradient(x, y, 0, x, y, s * 7);
        g.addColorStop(0, rgba(theme.ink, 0.22 * b));
        g.addColorStop(1, rgba(theme.ink, 0));
        c.fillStyle = g;
        c.fillRect(x - s * 7, y - s * 7, s * 14, s * 14);
      }
    }
    // Water: darker than the sky, a touch of its colour.
    const water = c.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, mix(theme.bg, theme.accent, 0.06));
    water.addColorStop(1, mix(theme.bg, "#000000", 0.45));
    c.fillStyle = water;
    c.fillRect(0, horizon, w, h - horizon);
    // Mountains and their mirror image.
    const rock = mix(theme.bg, "#000000", 0.55);
    c.fillStyle = rock;
    c.beginPath();
    c.moveTo(0, horizon + 1);
    for (let i = 0; i < ridge.length; i++) c.lineTo(i * step, ridge[i]);
    c.lineTo(w, horizon + 1);
    c.closePath();
    c.fill();
    // Rim light along the ridge, from the aurora behind.
    c.save();
    c.strokeStyle = rgba(theme.accent, 0.22);
    c.lineWidth = Math.max(1, u * 0.0022);
    c.filter = `blur(${(u * 0.0015).toFixed(2)}px)`;
    c.beginPath();
    for (let i = 0; i < ridge.length; i++) {
      if (i === 0) c.moveTo(0, ridge[0]);
      else c.lineTo(i * step, ridge[i]);
    }
    c.stroke();
    c.restore();
    c.save();
    c.globalAlpha = 0.92;
    c.filter = `blur(${(u * 0.003).toFixed(2)}px)`;
    c.fillStyle = mix(rock, theme.bg, 0.25);
    c.beginPath();
    c.moveTo(0, horizon - 1);
    for (let i = 0; i < ridge.length; i++) c.lineTo(i * step, 2 * horizon - ridge[i]);
    c.lineTo(w, horizon - 1);
    c.closePath();
    c.fill();
    c.restore();
    // A bright seam of water at the shoreline, and a few long ripple glints.
    c.fillStyle = rgba(theme.ink, 0.06);
    c.fillRect(0, horizon - 0.5, w, Math.max(1, u * 0.0016));
    const rr = rng(88);
    for (let i = 0; i < 26; i++) {
      const y = horizon + (h - horizon) * (0.1 + 0.9 * rr() ** 1.4);
      const x = rr() * w;
      const len = u * (0.05 + rr() * 0.22);
      c.fillStyle = rgba(theme.ink, 0.025 + rr() * 0.03);
      c.fillRect(x - len / 2, y, len, Math.max(0.6, u * 0.0012));
    }
  };
}

/** A single auroral ray: a sharp lower border, then light fading upward from the accent into accent2. */
function raySprite(theme: Theme) {
  return once(`aurora-ray:${theme.accent}${theme.accent2}${theme.ink}`, () => {
    const W = 16;
    const H = 256;
    const c = makeCanvas(W, H);
    const g = context(c);
    const img = g.createImageData(W, H);
    const lo = mix(theme.accent, theme.ink, 0.45);
    const mid = theme.accent;
    const hi = mix(theme.accent, theme.accent2, 0.75);
    const top = theme.accent2;
    const cols = [lo, mid, hi, top].map((cc) => {
      const v = parseInt(cc.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    });
    for (let y = 0; y < H; y++) {
      const v = 1 - y / (H - 1);
      // Colour ramp from the base upward.
      const k =
        v < 0.06 ? v / 0.06 : v < 0.45 ? 1 + (v - 0.06) / 0.39 : 2 + Math.min(1, (v - 0.45) / 0.4);
      const i0 = Math.min(3, Math.floor(k));
      const i1 = Math.min(3, i0 + 1);
      const f = k - i0;
      const cr = cols[i0][0] + (cols[i1][0] - cols[i0][0]) * f;
      const cg = cols[i0][1] + (cols[i1][1] - cols[i0][1]) * f;
      const cb = cols[i0][2] + (cols[i1][2] - cols[i0][2]) * f;
      const a =
        smoothstep(0, 0.025, v) *
        smoothstep(1, 0.55, v) *
        Math.exp(-v * 2.2) *
        (1 + 0.8 * Math.exp(-(((v - 0.03) / 0.025) ** 2)));
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5) / W - 0.5;
        const across = Math.exp(-dx * dx * 22);
        const o = (y * W + x) * 4;
        img.data[o] = cr;
        img.data[o + 1] = cg;
        img.data[o + 2] = cb;
        img.data[o + 3] = clamp(a * across) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  });
}

interface Curtain {
  y: number;
  amp: number;
  fold: number;
  rise: number;
  gain: number;
  seed: number;
  phase: number;
}

function curtains(portrait: boolean): Curtain[] {
  return [
    {
      y: portrait ? 0.4 : 0.38,
      amp: 0.05,
      fold: 0.07,
      rise: portrait ? 0.22 : 0.26,
      gain: 0.5,
      seed: 3,
      phase: 0.4,
    },
    {
      y: portrait ? 0.56 : 0.57,
      amp: 0.06,
      fold: 0.1,
      rise: portrait ? 0.34 : 0.4,
      gain: 1,
      seed: 7,
      phase: 0,
    },
  ];
}

export const style: MotionStyle = {
  id: "aurora",
  name: "Aurora",
  family: "Light & Material",
  tagline: "Aurora curtains over a still lake",
  look: "Curtains of aurora with fine vertical rays over a black mountain ridge, mirrored in a still lake under stars.",
  move: "The curtains fold and drift, a bright surge ripples along the lower border, then the sky settles back.",
  rules: [
    "Aurora is made of fine vertical rays, not a smooth gradient.",
    "The lower border is sharp and brightest; light fades upward into the second colour.",
    "Curtains fold over themselves: where they fold, the rays stack and glow brighter.",
    "A brightness surge travels along the curtain once per loop.",
    "The mountains are pure silhouette with a faint rim light from the sky.",
    "The lake mirrors the sky, softer and rippled.",
    "Stars stay put; one quiet caption, nothing else competes.",
  ],
  prompt: `R — References
• Aurora borealis photography over Lofoten or Iceland lakes (search: aurora curtain rays, aurora corona folds).
• Timelapses of auroral substorms: a bright surge running along the arc.

I — Idea
One arc of northern light, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): two ribbons of aurora hang over a black ridge; rays shimmer in place, folds drift sideways.
• Middle (1.5–3.5 s): a bright surge travels along the lower border; where the curtain folds, rays stack into bright pleats; the lake below mirrors it all.
• End (3.5–5 s): the surge fades and the curtains drift back into their opening shape.

S — Style
Looks: {{bg}} night sky with stars; aurora rays in {{accent}} at the sharp lower border fading upward into {{accent2}}; black mountains with a faint {{accent}} rim; a still lake reflecting the sky; one small caption "{{name}}" in {{font}}.
Moves: curtains fold and sway on whole-loop paths; ray brightness flickers along the arc; one surge per loop.
Rules:
1. Build the curtain from hundreds of thin vertical rays, added with light (additive blend).
2. Sharp, bright lower border; exponential fade upward.
3. Folds where the curtain doubles back; stacked rays glow brighter.
4. Silhouetted ridge with a rim light; mirrored, rippled lake.
5. Grain, vignette, stars; one small caption.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; individual rays are visible at full size; the lower border is the brightest part; the reflection sits only in the water, never over the mountains; the caption is crisp and not crowded. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Aurora",
  theme: {
    bg: "#050a10",
    ink: "#eef7f3",
    accent: "#3dffa0",
    accent2: "#b060ff",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..600"],
  tags: [
    "aurora",
    "northern lights",
    "sky",
    "night",
    "stars",
    "nature",
    "landscape",
    "glow",
    "calm",
    "ethereal",
    "lake",
  ],
  word: "Aurora",
  render(ctx, t, theme, w, h) {
    const S = scene(w, h);
    const { u, horizon, portrait } = S;
    ctx.drawImage(
      bake(
        `aurora-land:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
        w,
        h,
        land(theme, S),
      ) as CanvasImageSource,
      0,
      0,
    );

    const sprite = raySprite(theme);
    const qk = 0.25;
    const qw = Math.max(8, Math.round(w * qk));
    const qh = Math.max(8, Math.round(h * qk));
    const { canvas: qc, ctx: Q } = buffer("aurora-q", qw, qh);
    Q.globalCompositeOperation = "source-over";
    Q.clearRect(0, 0, qw, qh);
    Q.globalCompositeOperation = "lighter";

    const p = t / LOOP;
    // The surge: a travelling brightening along each curtain, wrapping so it loops.
    const surgeAt = 1 - p;
    ctx.save();
    ctx.clip(S.sky);
    ctx.globalCompositeOperation = "lighter";
    const rayW = Math.max(1.2, u * 0.0042);
    const count = Math.round(Math.min(360, Math.max(140, w / 3.2)));
    for (const cu of curtains(portrait)) {
      const spacing = (w * 1.24) / count;
      for (let i = 0; i < count; i++) {
        const s = i / (count - 1);
        const a = TAU * (2 * s + p + cu.phase);
        const foldAmp = w * cu.fold * (0.7 + 0.3 * Math.sin(TAU * (s + cu.phase)));
        const x =
          w * (-0.12 + 1.24 * s) +
          (hash(i, cu.seed, 1) - 0.5) * spacing * 1.6 +
          foldAmp * Math.sin(a) +
          w * 0.03 * noise3(s * 5 + cu.seed, 0.3, p * 2, 0, 0, 2);
        // Where the curtain folds back on itself, rays bunch up: dim each so the pleat glows, not blazes.
        const dxds = w * 1.24 + foldAmp * TAU * 2 * Math.cos(a);
        const bunch = Math.pow(clamp(Math.abs(dxds) / (w * 1.24), 0.22, 1), 0.8);
        const y =
          h * cu.y +
          h * cu.amp * Math.sin(TAU * (1.2 * s + p + cu.phase * 0.5)) +
          h * cu.amp * 0.45 * Math.sin(TAU * (2.6 * s - p) + 1.3) +
          h * 0.018 * noise3(s * 9, cu.seed + 0.5, p * 2 + 0.3, 0, 0, 2) +
          h * 0.005 * noise3(s * 40, cu.seed + 2.5, p * 3, 0, 0, 3);
        // Patchy brightness: big slow patches times fine flicker.
        const patch = 0.5 + 0.5 * noise3(s * 5.5, cu.seed * 1.7, p * 2 + 0.7, 0, 0, 2) * 1.6;
        const fine = 0.45 + 0.55 * hash(i, cu.seed);
        const flick = 0.6 + 0.4 * noise3(s * 26, cu.seed * 3.1, p * 3, 0, 0, 3);
        let ds = Math.abs(s - surgeAt);
        ds = Math.min(ds, 1 - ds);
        const surge = 1 + 0.9 * Math.exp(-((ds / 0.08) ** 2));
        const env = smoothstep(0, 0.12, s) * smoothstep(1, 0.86, s);
        const inten = clamp(
          cu.gain * clamp(patch, 0.08, 1.2) * fine * flick * env * surge * bunch * 0.55,
          0,
          0.9,
        );
        if (inten < 0.01) continue;
        const rise =
          h *
          cu.rise *
          (0.45 + 0.75 * (0.5 + 0.5 * noise3(s * 7, cu.seed + 9, p, 0, 0, 1))) *
          (0.8 + 0.4 * hash(i, cu.seed, 5));
        const rw = rayW * (0.7 + 0.8 * hash(i, cu.seed, 9));
        // Rays lean toward the magnetic zenith above the frame, like a wide-angle photo.
        const lean = (x - w * 0.5) / (h * 2.2);
        ctx.setTransform(1, 0, -lean, 1, x, y);
        Q.setTransform(1, 0, -lean, 1, x * qk, y * qk);
        ctx.globalAlpha = inten;
        ctx.drawImage(sprite as CanvasImageSource, -rw * 2, -rise, rw * 4, rise * 1.02);
        Q.globalAlpha = Math.min(1, inten * 0.8);
        Q.drawImage(
          sprite as CanvasImageSource,
          -rayW * 7 * qk,
          -rise * qk,
          rayW * 14 * qk,
          rise * 1.04 * qk,
        );
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    Q.setTransform(1, 0, 0, 1, 0, 0);
    // Soft glow from the same rays.
    ctx.globalAlpha = 1;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = `blur(${(u * 0.012).toFixed(1)}px)`;
    ctx.drawImage(qc as CanvasImageSource, 0, 0, w, h);
    ctx.filter = "none";
    ctx.restore();

    // The lake mirrors the sky, softer and rippled.
    ctx.save();
    ctx.clip(S.lake);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.62;
    const strips = 36;
    const top = horizon;
    const span = h - horizon;
    for (let j = 0; j < strips; j++) {
      const y0 = top + (span * j) / strips;
      const y1 = top + (span * (j + 1)) / strips;
      const depth = j / strips;
      const dx = Math.sin(TAU * (j * 0.37 + p * 2)) * u * (0.002 + 0.008 * depth);
      // Mirror: water row y shows sky row (2 * horizon - y).
      const sy0 = (2 * horizon - y1) * qk;
      const sy1 = (2 * horizon - y0) * qk;
      ctx.save();
      ctx.translate(dx, y1);
      ctx.scale(1, -1);
      ctx.drawImage(
        qc as CanvasImageSource,
        0,
        sy0,
        qw,
        Math.max(0.01, sy1 - sy0),
        0,
        0,
        w,
        y1 - y0,
      );
      ctx.restore();
    }
    ctx.restore();

    // Caption.
    const word = wordFor(theme.name, "Aurora", 14);
    const pad = u * 0.075;
    const size = u * (portrait ? 0.07 : 0.062);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = rgba(theme.ink, 0.92);
    ctx.font = font(500, size, theme.font, '"Newsreader", Georgia, serif');
    const mark = tintedLogo(theme, rgba(theme.ink, 0.9), size * 0.9, size * 0.9);
    let tx = pad;
    if (mark) {
      ctx.drawImage(mark as CanvasImageSource, pad, h - pad - size * 0.95);
      tx += size * 1.15;
    }
    ctx.fillText(word, tx, h - pad - size * 0.42);
    ctx.font = font(500, size * 0.31, "Inter", SANS);
    ctx.letterSpacing = `${(size * 0.045).toFixed(2)}px`;
    ctx.fillStyle = rgba(theme.ink, 0.55);
    ctx.fillText("69°38′ N   18°57′ E", tx + size * 0.03, h - pad + size * 0.02);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
