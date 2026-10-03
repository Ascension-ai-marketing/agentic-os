import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  fbm3,
  frameOf,
  grain,
  ground,
  light,
  LOOP,
  once,
  rng,
  smoothstep,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { mottled, pfbm, vgrad } from "./_s7-helpers";

/** Cloud texture size (tiles in both axes). */
const TEX = 512;
/** Texture periods travelled toward the viewer per loop. */
const RUSH = 1;

function horizonOf(w: number, h: number) {
  const { portrait } = frameOf(w, h);
  return h * (portrait ? 0.74 : 0.78);
}

/**
 * A tiling cloud deck: cauliflower cumulus from warped fractal noise. Thin
 * edges are lit warm, thick cores sit in cool shadow. Alpha = coverage.
 */
function cloudTex(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const n = cloudField(w, h);
    const img = c.createImageData(w, h);
    const d = img.data;
    const lit = parse(mix(theme.accent, theme.ink, 0.5));
    const warm = parse(mix(theme.accent, theme.accent2, 0.25));
    const shade = parse(mix(theme.accent2, theme.bg, 0.25));
    for (let i = 0; i < w * h; i++) {
      const v = n[i];
      const cover = smoothstep(-0.04, 0.16, v);
      if (cover <= 0) continue;
      // Light from below: thin parts glow, the body is warm, only dense cores turn cool.
      const k = Math.min(1, smoothstep(0.02, 0.45, v) * 1.25);
      const a = k < 0.5 ? k * 2 : 1;
      const b2 = k < 0.5 ? 0 : (k - 0.5) * 2;
      const o = i * 4;
      d[o] = lit[0] + (warm[0] - lit[0]) * a + (shade[0] - warm[0]) * b2 * 0.8;
      d[o + 1] = lit[1] + (warm[1] - lit[1]) * a + (shade[1] - warm[1]) * b2 * 0.8;
      d[o + 2] = lit[2] + (warm[2] - lit[2]) * a + (shade[2] - warm[2]) * b2 * 0.8;
      d[o + 3] = cover * 255;
    }
    c.putImageData(img, 0, 0);
  };
}

/** The cloud density field (theme-free), computed once: warped fractal noise that tiles. */
function cloudField(w: number, h: number): Float32Array {
  return once(`cloud-field@${w}x${h}`, () => {
    const out = new Float32Array(w * h);
    const P = 4;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const X = (x / w) * P;
        const Y = (y / h) * P;
        const wx = fbm3(X + 5.2, Y + 1.3, 0.7, 2, P, P, 0) * 0.45;
        const wy = fbm3(X + 1.7, Y + 9.2, 2.1, 2, P, P, 0) * 0.45;
        out[y * w + x] = fbm3(X + wx, Y + wy, 3.3, 5, P, P, 0);
      }
    return out;
  });
}

/** Sky, afterglow, the land and a lone tree: everything that holds still. */
function scenery(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u, portrait } = frameOf(w, h);
    const H = horizonOf(w, h);
    mottled(c, w, h, theme.bg, theme.accent2, 0.03, 51, 0.01);
    vgrad(c, 0, 0, w, H, [
      [0, mix(theme.bg, theme.accent2, 0.35), 1],
      [0.55, mix(theme.accent2, theme.bg, 0.25), 1],
      [0.85, mix(theme.accent2, theme.accent, 0.45), 1],
      [1, mix(theme.accent, theme.ink, 0.35), 1],
    ]);
    const sx = portrait ? w * 0.5 : w * 0.38;
    light(c, sx, H, u * 1.2, theme.accent, 0.4);
    light(c, sx, H, u * 0.3, mix(theme.accent, theme.ink, 0.5), 0.5);
  };
}

/** The land and the lone tree: drawn over the clouds. */
function land(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u, portrait } = frameOf(w, h);
    const H = horizonOf(w, h);
    // Land: far range lit on its rim, then the dark plain.
    c.fillStyle = mix(theme.bg, theme.accent2, 0.2);
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w; x += Math.max(2, w / 300)) {
      const n = pfbm((x / w) * 3, 64, 4, 4);
      c.lineTo(x, H - u * 0.012 - Math.max(0, n + 0.1) * u * 0.07);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fill();
    vgrad(c, 0, H - u * 0.01, w, h, [
      [0, mix(theme.bg, theme.accent, 0.12), 1],
      [0.25, mix(theme.bg, "#000000", 0.2), 1],
      [1, mix(theme.bg, "#000000", 0.5), 1],
    ]);
    // A lone umbrella acacia on the plain: a forked trunk under a flat, layered crown.
    const tx = portrait ? w * 0.72 : w * 0.75;
    const ty = H + u * 0.018;
    const th = u * (portrait ? 0.24 : 0.22);
    const dark = mix(theme.bg, "#000000", 0.5);
    c.fillStyle = dark;
    c.strokeStyle = dark;
    c.lineCap = "round";
    const r = rng(8);
    // Trunk, then limbs fanning up into the canopy.
    c.lineWidth = th * 0.05;
    c.beginPath();
    c.moveTo(tx, ty);
    c.quadraticCurveTo(tx + th * 0.02, ty - th * 0.25, tx - th * 0.01, ty - th * 0.38);
    c.stroke();
    const limbs: [number, number][] = [
      [-0.34, 0.9],
      [-0.14, 1],
      [0.1, 0.95],
      [0.3, 0.85],
      [0.46, 0.7],
    ];
    const crownY = ty - th * 0.74;
    for (const [dx, k] of limbs) {
      c.lineWidth = th * 0.028 * k;
      c.beginPath();
      c.moveTo(tx - th * 0.01, ty - th * 0.37);
      c.quadraticCurveTo(
        tx + dx * th * 0.25,
        ty - th * 0.55,
        tx + dx * th * 0.95,
        crownY + th * 0.04,
      );
      c.stroke();
    }
    // Canopy: three flat clumps with gaps, each built from many small leaf clusters.
    const clumps: [number, number, number][] = [
      [-0.3, 0.02, 0.26],
      [0.12, -0.02, 0.34],
      [0.5, 0.03, 0.2],
    ];
    for (const [cxk, cyk, half] of clumps) {
      const cx = tx + cxk * th;
      const cy = crownY + cyk * th;
      for (let k = 0; k < 70; k++) {
        const f = r() * 2 - 1;
        const x = cx + f * half * th;
        const y =
          cy - (1 - f * f) * th * 0.035 + (r() - 0.35) * th * 0.06 * (1 - Math.abs(f) * 0.6);
        c.beginPath();
        c.ellipse(x, y, th * (0.02 + r() * 0.025), th * (0.012 + r() * 0.014), 0, 0, TAU);
        c.fill();
      }
    }
  };
}

export const style: MotionStyle = {
  id: "cloud-timelapse",
  name: "Time-lapse Sky",
  family: "Nature",
  tagline: "Clouds racing in at sunset",
  look: "A sunset time-lapse over an open plain: a deck of cumulus racing in from the glowing horizon, lit warm underneath, a lone tree holding still.",
  move: "Hours pass in five seconds: clouds pour out of the horizon, swell as they near and sweep overhead, while the land and the tree never move.",
  rules: [
    "Clouds ride one perspective plane: small and slow at the horizon, huge and fast overhead.",
    "Thin cloud edges catch the sunset; thick cores sit in cool shadow.",
    "The deck travels exactly one texture tile per loop, so it never jumps.",
    "The land and the tree are dead still; only the sky is in time-lapse.",
    "Haze swallows the clouds at the horizon, where the glow is brightest.",
    "Two colours carry it: the warm afterglow and the cool evening sky.",
  ],
  prompt: `R — References
• Sunset cloud time-lapses over open landscapes (search: cumulus time-lapse sunset plains).
• Classic mode-7 / perspective ground planes, used here for the sky.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): an open plain at sunset, a lone tree on the right, the horizon glowing; a deck of clouds starts to stream out of the glow.
• Middle (1.5–3.5 s): in time-lapse the clouds race toward the viewer, swelling and speeding up as they come overhead, edges lit warm, cores cool.
• End (3.5–5 s): the deck has moved exactly one tile, landing on the first frame while the land never moves.

S — Style
Looks: {{bg}} night-blue zenith falling to an {{accent}} afterglow at the horizon; cumulus with {{accent}}-lit edges and {{accent2}} shadowed cores; the land and tree as near-black silhouettes with a faint rim.
Moves: a tiling cloud texture mapped onto a ceiling plane in perspective (thin horizontal bands, each with its own scale); the plane scrolls one tile per loop toward the camera; clouds fade into haze near the horizon.
Rules:
1. One perspective plane for all clouds.
2. Warm thin edges, cool thick cores.
3. Whole-tile travel per loop.
4. Still land, time-lapse sky.
5. Haze at the horizon.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no shimmer or moiré near the horizon; clouds overhead are large and soft, near the horizon small and dense; the tree never moves; no banding in the sky. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Time-lapse_photography",
  theme: {
    bg: "#0a0d18",
    ink: "#fbefe4",
    accent: "#ff8a4c",
    accent2: "#445c93",
    font: "Inter",
  },
  tags: [
    "clouds",
    "sky",
    "timelapse",
    "sunset",
    "weather",
    "landscape",
    "horizon",
    "golden hour",
    "calm",
    "nature",
    "time",
  ],
  word: "Horizon",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const H = horizonOf(w, h);
    ground(ctx, w, h, theme.bg);
    const still = bake(
      `cloud-scene:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
      w,
      h,
      scenery(theme),
    );
    ctx.drawImage(still as CanvasImageSource, 0, 0);
    const tex = bake(
      `cloud-tex:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
      TEX,
      TEX,
      cloudTex(theme),
    );

    // The ceiling plane: distance d(y) = K / (H' - y) for rows above the horizon.
    const { canvas: cb, ctx: C } = buffer("cloud-deck", w, Math.ceil(H));
    C.setTransform(1, 0, 0, 1, 0, 0);
    C.globalCompositeOperation = "source-over";
    C.clearRect(0, 0, w, Math.ceil(H));
    const pat = C.createPattern(tex as CanvasImageSource, "repeat");
    const Hv = H + u * 0.012;
    const K = u * 0.55;
    const F = u * 0.9;
    // One tile toward the camera and one tile across per loop: a diagonal rush.
    const scroll = (RUSH * TEX * t) / LOOP;
    const drift = -(TEX * t) / LOOP;
    if (pat && typeof DOMMatrix !== "undefined") {
      C.fillStyle = pat;
      const band = Math.max(1, Math.round(u / 360));
      for (let y = 0; y < H; y += band) {
        const yc = y + band / 2;
        const gap = Hv - yc;
        if (gap <= u * 0.004) break;
        const dist = K / gap;
        // Texture px per world unit: TEX covers 1.6 world units across.
        const tpu = TEX / 2.6;
        const v = dist * tpu + scroll;
        const sx = F / (dist * tpu);
        const dvdy = (K / (gap * gap)) * tpu;
        const sy = 1 / dvdy;
        pat.setTransform(
          new DOMMatrix([sx, 0, 0, sy, w / 2 - (drift + TEX * 0.31) * sx, yc - v * sy]),
        );
        C.fillRect(0, y, w, band);
      }
    }
    // Warm the clouds near the glow, cool them overhead; then haze them into the horizon.
    C.globalCompositeOperation = "source-atop";
    const tint = C.createLinearGradient(0, 0, 0, H);
    tint.addColorStop(0, rgba(theme.bg, 0.45));
    tint.addColorStop(0.55, rgba(theme.accent2, 0.12));
    tint.addColorStop(1, rgba(theme.accent, 0.35));
    C.fillStyle = tint;
    C.fillRect(0, 0, w, H);
    C.globalCompositeOperation = "destination-out";
    const haze = C.createLinearGradient(0, H * 0.5, 0, H);
    haze.addColorStop(0, "rgba(0,0,0,0)");
    haze.addColorStop(0.55, "rgba(0,0,0,0.55)");
    haze.addColorStop(1, "rgba(0,0,0,1)");
    C.fillStyle = haze;
    C.fillRect(0, H * 0.5, w, H * 0.5 + 1);
    C.globalCompositeOperation = "source-over";
    ctx.drawImage(cb as CanvasImageSource, 0, 0);
    ctx.drawImage(
      bake(
        `cloud-land:${theme.bg}${theme.accent}${theme.accent2}`,
        w,
        h,
        land(theme),
      ) as CanvasImageSource,
      0,
      0,
    );

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
    void clamp;
  },
};
