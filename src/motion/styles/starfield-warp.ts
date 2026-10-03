import { mix, rgba } from "../engine/color";
import {
  bake,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  SANS,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, bump, fitTracked, glow, mottled, tracked } from "./_s7-helpers";

const STARS = 1100;
const DUST = 90;
/** Whole depth-wraps per loop: cruise (A) plus one surge (B). A + B must be whole. */
const A = 1;
const B = 2;
const Z_NEAR = 0.018;

/** Distance travelled (in depth wraps) by time t: slow, surge, slow. */
function travel(t: number) {
  const p = t / LOOP;
  return A * p + B * (p - Math.sin(TAU * p) / TAU);
}
/** Speed relative to cruise: 1 at the ends, 1 + 2B/A at the peak. */
function speed(t: number) {
  const p = t / LOOP;
  return (A + B * (1 - Math.cos(TAU * p))) / A;
}

function space(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    mottled(c, w, h, theme.bg, theme.accent2, 0.05, 21, 0.012);
    // A faint nebula wash off-centre.
    light(c, w * 0.3, h * 0.35, u * 0.9, theme.accent2, 0.1);
    light(c, w * 0.72, h * 0.7, u * 0.8, theme.accent, 0.06);
  };
}

export const style: MotionStyle = {
  id: "starfield-warp",
  name: "Hyperspace",
  family: "Nature",
  tagline: "Stars stretching into warp",
  look: "Deep space seen from a ship's bow: a star field that stretches into long blue-white streaks around a glowing vanishing point.",
  move: "Cruise, then the jump: stars stretch into warp streaks, the core flares, and the field eases back to cruise, one surge per loop.",
  rules: [
    "One vanishing point; every streak points at it.",
    "Streak length is speed times nearness: far stars stay points.",
    "Stars fade in from the depth, so nothing pops.",
    "The surge is one smooth acceleration and release, never a cut.",
    "Heads are white, tails cool toward the accent; dust lanes tint the tunnel.",
    "The core flares only at the peak of the jump.",
  ],
  prompt: `R — References
• The jump to lightspeed in film (search: hyperspace jump, warp speed star streaks).
• Long-exposure star trails for the look of each streak.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a calm star field drifts toward the viewer from a vanishing point, "{{name}}" small and still at its heart.
• Middle (1.5–3.5 s): the jump: stars stretch into long streaks, cool dust lanes smear into a tunnel, the core flares white.
• End (3.5–5 s): the field eases back to cruise, landing exactly on the first frame.

S — Style
Looks: {{bg}} deep space with a faint {{accent2}} nebula; {{ink}} star heads with tails cooling to {{accent}}; a few {{accent2}} dust lanes; the word in {{font}}, tracked wide.
Moves: stars live in a cylinder around the view axis and wrap in depth; distance travelled = A·p + B·(p − sin 2πp / 2π) with A + B whole, so speed surges once and the loop closes; streak length = speed × depth step; brightness rises as a star nears.
Rules:
1. One vanishing point.
2. Streak length = speed × nearness.
3. Fade in from depth; nothing pops.
4. Smooth surge and release.
5. White heads, cool tails; the flare only at the peak.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; at t = 0 stars are points, at t = 2.5 they are long streaks; streaks all converge on one point; no star appears suddenly; the word stays readable through the jump. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Hyperspace",
  theme: {
    bg: "#03040a",
    ink: "#eef3ff",
    accent: "#6fa8ff",
    accent2: "#9d7dff",
    font: "Inter",
  },
  tags: [
    "space",
    "stars",
    "warp",
    "hyperspace",
    "sci-fi",
    "speed",
    "tunnel",
    "galaxy",
    "cosmic",
    "launch",
    "futuristic",
  ],
  word: "Warp",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const f = u * 0.5;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `warp-space:${theme.bg}${theme.accent}${theme.accent2}`,
        w,
        h,
        space(theme),
      ) as CanvasImageSource,
      0,
      0,
    );

    const F = travel(t);
    const v = speed(t);
    const peak = (v - 1) / (2 * B);
    const roll = 0.06 * Math.sin(TAU * (t / LOOP));
    const reach = Math.hypot(w, h) * 0.5;

    // Core glow, flaring with speed.
    light(ctx, cx, cy, u * (0.35 + 0.4 * peak), theme.accent, 0.1 + 0.25 * peak);

    // Dust lanes: wide, faint, tinted.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < DUST; i++) {
      const z = (((hash(i, 91) - F / (A + B)) % 1) + 1) % 1;
      const d = Z_NEAR + z;
      const a = hash(i, 92) * TAU + roll;
      const rho = 0.4 + hash(i, 93) * 1.4;
      const r1 = (rho / d) * f;
      const r0 = (rho / (d + 0.02 + 0.28 * peak)) * f;
      if (r0 > reach) continue;
      const fade = (1 - z) ** 2 * Math.min(1, z * 8);
      ctx.strokeStyle = rgba(i % 3 ? theme.accent2 : theme.accent, 0.05 * fade * (0.3 + peak));
      ctx.lineWidth = u * (0.01 + 0.03 * (1 - z));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }

    // Stars: tails (cool) then heads (white), batched by brightness.
    const tails = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const heads = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const thin = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const tailLen = 0.006 + 0.3 * peak;
    for (let i = 0; i < STARS; i++) {
      const z = (((hash(i, 1) - F) % 1) + 1) % 1;
      const d = Z_NEAR + z;
      const a = hash(i, 2) * TAU + roll;
      const rho = 0.06 + Math.sqrt(hash(i, 3)) * 0.95;
      const r1 = (rho / d) * f;
      if (r1 < u * 0.004) continue;
      const r0 = (rho / (d + tailLen * (0.6 + 0.8 * hash(i, 4)))) * f;
      if (r0 > reach) continue;
      const mag = 0.35 + 0.65 * hash(i, 5) ** 2;
      const bright = Math.min(1, (1 - z) ** 1.6 * mag * 1.6) * Math.min(1, z * 12);
      if (bright < 0.03) continue;
      const bucket = Math.min(3, Math.floor(bright * 4));
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x1 = cx + ca * r1;
      const y1 = cy + sa * r1;
      const x0 = cx + ca * r0;
      const y0 = cy + sa * r0;
      const near = 1 - z;
      (near > 0.55 ? tails : thin)[bucket].moveTo(x0, y0);
      (near > 0.55 ? tails : thin)[bucket].lineTo(x1, y1);
      // The head: the last stretch of the streak, or a point at cruise.
      const hx = x1 - (x1 - x0) * 0.25;
      const hy = y1 - (y1 - y0) * 0.25;
      heads[bucket].moveTo(hx, hy);
      heads[bucket].lineTo(x1 + ca * 0.01, y1 + sa * 0.01);
    }
    const tailColor = mix(theme.accent, theme.ink, 0.25);
    // Chromatic fringe: the tails split into accent and accent2 as speed builds.
    if (peak > 0.02) {
      for (const [e, col] of [
        [0.014, theme.accent],
        [-0.014, theme.accent2],
      ] as [number, string][]) {
        const k = e * peak;
        ctx.setTransform(1 + k, 0, 0, 1 + k, -cx * k, -cy * k);
        ctx.strokeStyle = rgba(col, 0.28 * peak);
        ctx.lineWidth = Math.max(0.8, u * 0.003);
        for (let b = 1; b < 4; b++) ctx.stroke(tails[b]);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    for (let b = 0; b < 4; b++) {
      const al = (b + 0.6) / 4;
      ctx.strokeStyle = rgba(tailColor, al * 0.55);
      ctx.lineWidth = Math.max(0.8, u * 0.0028);
      ctx.stroke(tails[b]);
      ctx.strokeStyle = rgba(tailColor, al * 0.5);
      ctx.lineWidth = Math.max(0.6, u * 0.0014);
      ctx.stroke(thin[b]);
      ctx.strokeStyle = rgba(theme.ink, Math.min(1, al * 1.1));
      ctx.lineWidth = Math.max(0.9, u * (0.0022 + 0.0012 * b));
      ctx.stroke(heads[b]);
    }

    // The flare at the peak of the jump.
    const flare = bump(t / LOOP, 0.3, 0.7);
    blit(
      ctx,
      glow(mix(theme.accent, theme.ink, 0.5), 0.1, theme.ink),
      cx,
      cy,
      u * (0.2 + 0.3 * flare),
      0.3 + 0.45 * flare,
    );
    // Anamorphic streak through the core, only while the jump peaks.
    if (flare > 0.01) {
      const streak = glow(mix(theme.accent, theme.ink, 0.35), 0.08);
      ctx.globalAlpha = 0.5 * flare;
      ctx.drawImage(streak as CanvasImageSource, cx - w * 0.45, cy - u * 0.006, w * 0.9, u * 0.012);
      ctx.globalAlpha = 0.25 * flare;
      ctx.drawImage(streak as CanvasImageSource, cx - w * 0.3, cy - u * 0.02, w * 0.6, u * 0.04);
    }
    ctx.restore();

    // The word at the heart of the tunnel.
    const word = wordFor(theme.name, "Warp", 14).toUpperCase();
    const logo = tintedLogo(theme, theme.ink, u * 0.09, u * 0.09);
    const size = fitTracked(ctx, word, w * 0.5, u * 0.045, 600, theme.font, SANS, 0.6);
    ctx.save();
    ctx.fillStyle = rgba(theme.ink, 0.96);
    ctx.textBaseline = "middle";
    // A soft dark halo keeps the word readable through the flare.
    ctx.shadowColor = rgba(theme.bg, 0.85);
    ctx.shadowBlur = size * 0.9;
    if (logo)
      ctx.drawImage(logo as CanvasImageSource, cx - u * 0.045, cy - u * 0.12, u * 0.09, u * 0.09);
    tracked(ctx, word, cx, logo ? cy + u * 0.02 : cy, size, 600, theme.font, SANS, 0.6, "center");
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.22);
  },
};
