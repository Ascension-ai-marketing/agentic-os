import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  LOOP,
  TAU,
  vignette,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";
import { darkPaper } from "./_s1-helpers";

type V3 = [number, number, number];

/** Pleats in the accordion strip. Even, so the rosette closes mountain-to-valley. */
const PLEATS = 44;

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const style: MotionStyle = {
  id: "origami-fold",
  name: "Origami Fan Fold",
  family: "Print & Craft",
  tagline: "A paper fan opens to a rosette",
  look: "An accordion-pleated sheet in a dark studio: a folded fan that opens into a full paper rosette, lit warm and cool.",
  move: "The fan swings open along its creases until the pleats meet in a full circle, holds as a rosette, then folds shut.",
  rules: [
    "The strip is rigid between creases: pleats only rotate and flatten, never bend.",
    "Light draws the shape: each pleat turns warm toward the key, cool toward the fill.",
    "Ridges carry a hairline highlight, valleys a hairline shadow.",
    "Pleat depth follows geometry: tall when closed, shallow when fully open.",
    "One accent: the paper medallion that pins the centre.",
    "Ease in and out and hold the full rosette at least a second.",
    "A soft contact shadow ties the paper to the table.",
  ],
  prompt: `R — References
• Paper rosettes and folding fans from one accordion-pleated sheet (search: paper rosette fan fold, accordion fold medallion).
• Studio product photography of paper craft: dark sweep, soft key light, crisp edges.

I — Idea
A pleated sheet folds into a shape, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): a folded paper fan lies on a dark table, its pleats deep and tight, and starts to swing open.
• Middle (1.2–3 s): it opens along its creases, the pleats flattening as they spread, until the two ends meet in a full rosette pinned by a small medallion; hold.
• End (3–5 s): it folds back into the fan and lands on the opening frame.

S — Style
Looks: {{bg}} studio with a soft pool of light; paper in {{ink}}; a warm key tinted {{accent}} from the upper left and a cool fill tinted {{accent2}} from the right; a small {{accent}} medallion at the centre; hairline ridge highlights and valley shadows; grain.
Moves: the opening angle eases in-out from about 150° to 360° and back; pleat depth is computed from the fixed pleat width, so it flattens as it opens; the framing eases with it so the shape fills the stage.
Rules:
1. Rigid pleats: rotate and flatten only.
2. Warm key, cool fill, per pleat.
3. Ridge highlights, valley shadows.
4. One accent in the medallion.
5. Hold the rosette a second or more.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the rosette is a clean circle at 2.5 s; pleats alternate light and dark; no pleat pokes through another; the shape fills the stage in every frame. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Hand_fan",
  theme: {
    bg: "#0e0f12",
    ink: "#f3efe7",
    accent: "#e8623e",
    accent2: "#6f8fbf",
    font: "Inter",
  },
  tags: [
    "origami",
    "paper",
    "fold",
    "folding",
    "fan",
    "rosette",
    "pleats",
    "3d",
    "studio",
    "minimal",
    "craft",
  ],
  word: "Fold",
  render(ctx, t, theme, w, h) {
    const { u, portrait, square } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `ori-table:${theme.bg}${theme.ink}`,
        w,
        h,
        darkPaper(theme, 44, { fibres: 0.15, mottle: 0.6 }),
      ) as CanvasImageSource,
      0,
      0,
    );

    // Open (fan -> rosette), hold, close: a cosine in time with flat holds at both ends.
    const wave01 = (1 - Math.cos(TAU * (t / LOOP))) / 2;
    const open = ease.inOutCubic(clamp(wave01 * 1.18 - 0.09));
    const minSpan = (150 * Math.PI) / 180;
    const span = lerp(minSpan, TAU, open);
    const R = 1;
    const delta = span / PLEATS;
    // Pleat width is fixed: sized so the full rosette keeps a shallow zigzag.
    const wp = 2 * R * Math.sin(Math.PI / PLEATS) * 1.32;
    const chord = 2 * R * Math.sin(delta / 2);
    const depth = Math.sqrt(Math.max(0, wp * wp - chord * chord));
    const axis = -Math.PI / 2;
    const a0 = axis - span / 2;

    // Framing: the pivot sits low for the fan and rises to centre for the rosette.
    const frame01 = ease.inOutSine(open);
    const Rpx =
      Math.min(w, h) *
      lerp(portrait ? 0.46 : square ? 0.5 : 0.56, portrait ? 0.42 : square ? 0.4 : 0.41, frame01);
    const pivotY = lerp(h * (portrait ? 0.66 : square ? 0.74 : 0.8), h * 0.5, frame01);
    const elev = (64 * Math.PI) / 180;
    const se = Math.sin(elev);
    const ce = Math.cos(elev);
    const proj = (p: V3): [number, number] => [
      w / 2 + p[0] * Rpx,
      pivotY + (p[1] * se - p[2] * ce * 0.9) * Rpx,
    ];

    light(ctx, w / 2, pivotY - Rpx * 0.1, Rpx * 2.4, mix(theme.ink, theme.accent, 0.35), 0.1);

    // Rim points alternate valley (z = 0) and ridge (z = depth).
    const rim: V3[] = [];
    for (let k = 0; k <= PLEATS; k++) {
      const a = a0 + k * delta;
      rim.push([Math.cos(a) * R, Math.sin(a) * R, k % 2 ? depth : 0]);
    }
    const hub: V3 = [0, 0, depth * 0.5];

    // Contact shadow.
    ctx.save();
    ctx.filter = `blur(${(u * 0.025).toFixed(1)}px)`;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    const [sx, sy] = proj([0.03, 0.05, 0]);
    ctx.moveTo(sx, sy);
    for (const p of rim) {
      const [x, y] = proj([p[0] * 1.02 + 0.03, p[1] * 1.02 + 0.06, 0]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Pleats, far to near (larger y is nearer the camera).
    const key = norm([-0.7, -0.45, 0.55]);
    const fill = norm([0.75, 0.2, 0.5]);
    const warm = mix(theme.ink, theme.accent, 0.22);
    const cool = mix(mix(theme.bg, theme.accent2, 0.55), theme.ink, 0.14);
    const order = Array.from({ length: PLEATS }, (_, k) => k).sort(
      (A, B) => rim[A][1] + rim[A + 1][1] - (rim[B][1] + rim[B + 1][1]),
    );
    const lw = Math.max(0.6, u * 0.0016);
    const [xh, yh] = proj(hub);
    for (const k of order) {
      const p0 = rim[k];
      const p1 = rim[k + 1];
      let n = norm(
        cross(
          [p0[0] - hub[0], p0[1] - hub[1], p0[2] - hub[2]],
          [p1[0] - hub[0], p1[1] - hub[1], p1[2] - hub[2]],
        ),
      );
      if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
      const kd = clamp(dot(n, key));
      const fd = clamp(dot(n, fill));
      const base = mix(cool, warm, clamp(0.1 + kd * 1.05));
      const shade = mix(
        mix(base, theme.ink, clamp(kd * kd * 0.45)),
        cool,
        clamp(0.3 - fd * 0.35 - kd * 0.3),
      );
      const [x0, y0] = proj(p0);
      const [x1, y1] = proj(p1);
      const g = ctx.createLinearGradient(xh, yh, (x0 + x1) / 2, (y0 + y1) / 2);
      g.addColorStop(0, mix(shade, theme.bg, 0.28));
      g.addColorStop(0.35, shade);
      g.addColorStop(1, mix(shade, theme.ink, 0.1));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(xh, yh);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shade;
      ctx.lineWidth = lw * 0.8;
      ctx.stroke();
      // Crease lines: ridge highlight on the raised edge, valley shadow on the low one.
      const [rx, ry] = proj(k % 2 ? p0 : p1);
      const [vx, vy] = proj(k % 2 ? p1 : p0);
      ctx.lineWidth = lw;
      ctx.strokeStyle = rgba(theme.ink, 0.55);
      ctx.beginPath();
      ctx.moveTo(xh, yh);
      ctx.lineTo(rx, ry);
      ctx.stroke();
      ctx.strokeStyle = rgba("#000000", 0.3);
      ctx.beginPath();
      ctx.moveTo(xh, yh);
      ctx.lineTo(vx, vy);
      ctx.stroke();
      // Paper edge along the rim.
      ctx.strokeStyle = rgba(theme.ink, 0.4);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // The medallion that pins the centre: the one accent (and the logo when branded).
    const mr = Rpx * 0.12;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = u * 0.02;
    ctx.shadowOffsetY = u * 0.006;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.ellipse(xh, yh, mr, mr * se, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    const mg = ctx.createRadialGradient(xh - mr * 0.4, yh - mr * 0.4, 0, xh, yh, mr);
    mg.addColorStop(0, rgba(theme.ink, 0.28));
    mg.addColorStop(1, rgba("#000000", 0.2));
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.ellipse(xh, yh, mr, mr * se, 0, 0, TAU);
    ctx.fill();
    // Scalloped paper rim on the medallion.
    ctx.strokeStyle = rgba(theme.ink, 0.35);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU;
      const rr = mr * (0.84 + 0.04 * Math.cos(a * 12));
      const x = xh + Math.cos(a) * rr;
      const y = yh + Math.sin(a) * rr * se;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const mark = tintedLogo(theme, rgba(theme.ink, 0.92), mr * 1.1, mr * 1.1 * se);
    if (mark) ctx.drawImage(mark as CanvasImageSource, xh - mr * 0.55, yh - mr * 0.55 * se);

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.26);
  },
};
