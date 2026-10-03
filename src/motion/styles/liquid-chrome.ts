import { mix, parse } from "../engine/color";
import {
  buffer,
  frameOf,
  grain,
  ground,
  light,
  LOOP,
  smoothstep,
  TAU,
  vignette,
} from "../engine/kit";
import type { MotionStyle } from "../engine/types";

type Ball = { ax: number; ay: number; fx: number; fy: number; px: number; py: number; r: number };

const BALLS: Ball[] = [
  { ax: 0.34, ay: 0.12, fx: 1, fy: 2, px: 0.0, py: 0.3, r: 0.17 },
  { ax: 0.28, ay: 0.18, fx: 2, fy: 1, px: 0.5, py: 0.1, r: 0.13 },
  { ax: 0.22, ay: 0.2, fx: 1, fy: 1, px: 0.25, py: 0.6, r: 0.12 },
  { ax: 0.4, ay: 0.1, fx: 1, fy: 3, px: 0.7, py: 0.0, r: 0.1 },
  { ax: 0.18, ay: 0.24, fx: 3, fy: 2, px: 0.4, py: 0.8, r: 0.09 },
  { ax: 0.3, ay: 0.14, fx: 2, fy: 3, px: 0.9, py: 0.45, r: 0.11 },
];

export const style: MotionStyle = {
  id: "liquid-chrome",
  name: "Liquid Chrome",
  look: "Mirror-polished liquid metal blobs in a dark studio, reflecting softboxes, a hard horizon line and brand-tinted light.",
  move: "Blobs orbit on Lissajous paths, merge with a surface-tension neck, split again; reflections slide across every surface.",
  rules: [
    "Chrome is reflection, not colour: shade from a studio environment.",
    "A hard horizon line in the reflection sells the metal.",
    "Two softboxes give the specular streaks; nothing else is pure white.",
    "Blobs merge with a smooth neck (metaballs), never overlap as circles.",
    "Every path is a whole-number Lissajous, so the loop closes.",
    "Brand colour lives in the environment, tinting sky and floor.",
    "Edges are anti-aliased; the ground stays dark and grainy.",
  ],
  prompt: `R — References
• Liquid chrome / Y2K metal renders (search: liquid chrome 3D, mercury metaballs).
• Studio product lighting: softboxes and a dark cyclorama.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a few beads of liquid chrome drift toward each other in a dark studio.
• Middle (1.5–3.5 s): they merge into one mass with a stretched surface-tension neck; softbox reflections slide across the surface.
• End (3.5–5 s): the mass splits back into beads and they land exactly where they began.

S — Style
Looks: {{bg}} studio, chrome reflecting a sky tinted {{accent2}}, a floor tinted {{accent}}, a hard dark horizon band, two {{ink}} softboxes as specular streaks.
Moves: each bead on a whole-number Lissajous path (frequencies 1–3 per loop); merges via a metaball field; reflections follow the surface normal.
Rules:
1. Shade by reflection: normal → reflected ray → studio environment.
2. A hard horizon line in the environment.
3. Two softboxes; only they reach pure white.
4. Metaball field for merges; smooth necks.
5. Anti-aliased edges; dark, grainy ground.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; it reads as metal, not grey plastic; edges are smooth; necks form when beads merge; there is no banding in the ground. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Metaballs",
  theme: {
    bg: "#08080a",
    ink: "#eef2f7",
    accent: "#d6a877",
    accent2: "#5fc3e4",
    font: "Inter",
  },
  tags: [
    "chrome",
    "metal",
    "liquid",
    "3d",
    "y2k",
    "mercury",
    "blob",
    "fluid",
    "shiny",
    "futuristic",
    "abstract",
  ],
  word: "Motion",
  family: "Light & Material",
  tagline: "Mercury beads merge and split",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const floor = ctx.createLinearGradient(0, h * 0.55, 0, h);
    floor.addColorStop(0, theme.bg);
    floor.addColorStop(1, mix(theme.bg, theme.accent, 0.12));
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    light(ctx, w * 0.5, h * 0.42, u * 0.9, theme.accent2, 0.12);

    const bw = Math.max(160, Math.min(2000, Math.round(w / 1.7)));
    const bh = Math.max(90, Math.round((bw * h) / w));
    const sx = w / bw;
    const sy = h / bh;
    const { canvas, ctx: b } = buffer("chrome", bw, bh);
    const img = b.createImageData(bw, bh);
    const data = img.data;

    const phase = t / LOOP;
    const cx = w / 2;
    const cy = h * 0.5;
    const spanX = Math.min(w * 0.5, u * 0.85);
    const spanY = Math.min(h * 0.5, u * 0.8);
    const balls = BALLS.map((q) => ({
      x: cx + Math.sin(TAU * (q.fx * phase + q.px)) * q.ax * spanX * 1.6,
      y: cy + Math.sin(TAU * (q.fy * phase + q.py)) * q.ay * spanY * 1.6,
      r2: (q.r * u) ** 2,
    }));

    const sky = parse(mix(theme.ink, theme.accent2, 0.1));
    const zenith = parse(mix(theme.bg, theme.accent2, 0.42));
    const horizon = parse(mix(theme.bg, "#000000", 0.7));
    const floorLo = parse(mix(theme.bg, theme.accent, 0.26));
    const floorHi = parse(mix(theme.ink, theme.accent, 0.5));
    const white = parse(theme.ink);
    const R0 = u * 0.15;
    const lx = -0.45;
    const ly = -0.62;
    const lz = 0.64;

    for (let j = 0; j < bh; j++) {
      const y = (j + 0.5) * sy;
      for (let i = 0; i < bw; i++) {
        const x = (i + 0.5) * sx;
        // Cubic blend of the ball fields: domes keep their own curvature
        // (no flat plateaus) while necks still form where balls meet.
        let S3 = 0;
        let Gx = 0;
        let Gy = 0;
        for (let k = 0; k < balls.length; k++) {
          const dx = x - balls[k].x;
          const dy = y - balls[k].y;
          const d2 = dx * dx + dy * dy + 1;
          const q = balls[k].r2 / d2;
          const q3 = q * q * q;
          S3 += q3;
          const g = (-2 * q3) / d2;
          Gx += g * dx;
          Gy += g * dy;
        }
        const F = Math.cbrt(S3);
        if (F < 0.9) continue;
        const s23 = F * F;
        const Fx = Gx / s23;
        const Fy = Gy / s23;
        const alpha = smoothstep(0.92, 1.08, F);
        // Height sqrt(1 - 1/F) is an exact hemisphere for one ball and
        // blends smoothly where balls merge; its gradient gives the normal.
        const hgt = Math.sqrt(Math.max(1e-4, 1 - 1 / Math.max(F, 1.0001)));
        const inv = R0 / (2 * F * F * hgt);
        let nx = -Fx * inv;
        let ny = -Fy * inv;
        let nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl;
        ny /= nl;
        nz /= nl;
        // Perspective view ray, camera slightly above: the horizon curves.
        let vx = (x - cx) / (u * 1.6);
        let vy = (y - cy) / (u * 1.6) - 0.28;
        let vz = 1;
        const vl = Math.hypot(vx, vy, vz);
        vx /= vl;
        vy /= vl;
        vz /= vl;
        const dn = nx * vx + ny * vy + nz * vz;
        const rx = 2 * dn * nx - vx;
        const ry = 2 * dn * ny - vy;
        // Sky above the horizon, floor below, blended over a hair so the
        // horizon line stays sharp without stair-steps.
        const ks = Math.pow(smoothstep(-0.02, -0.95, ry), 0.6);
        const sr = sky[0] + (zenith[0] - sky[0]) * ks;
        const sg = sky[1] + (zenith[1] - sky[1]) * ks;
        const sb = sky[2] + (zenith[2] - sky[2]) * ks;
        const band = smoothstep(0.1, 0.0, ry);
        const kf = Math.pow(smoothstep(0.1, 0.92, ry), 1.35);
        let fr = floorLo[0] + (floorHi[0] - floorLo[0]) * kf;
        let fg = floorLo[1] + (floorHi[1] - floorLo[1]) * kf;
        let fb = floorLo[2] + (floorHi[2] - floorLo[2]) * kf;
        fr += (horizon[0] - fr) * band;
        fg += (horizon[1] - fg) * band;
        fb += (horizon[2] - fb) * band;
        const m = smoothstep(-0.018, 0.018, ry);
        let r = sr + (fr - sr) * m;
        let g = sg + (fg - sg) * m;
        let bl = sb + (fb - sb) * m;
        // Two softboxes: a wide panel overhead-right, a tall strip on the left.
        const box1 =
          smoothstep(0.05, 0, Math.abs(rx - 0.22) - 0.3) *
          smoothstep(0.05, 0, Math.abs(ry + 0.62) - 0.14) *
          0.92;
        const box2 =
          smoothstep(0.04, 0, Math.abs(rx + 0.72) - 0.07) *
          smoothstep(0.05, 0, Math.abs(ry + 0.25) - 0.32) *
          0.8;
        const spec = Math.pow(Math.max(0, nx * lx + ny * ly + nz * lz), 60);
        const lift = Math.min(1, box1 + box2 + spec);
        r += (white[0] - r) * lift;
        g += (white[1] - g) * lift;
        bl += (white[2] - bl) * lift;
        // Fresnel: grazing edges pick up the sky.
        const fres = Math.pow(1 - nz, 3) * 0.5;
        r += (sky[0] - r) * fres;
        g += (sky[1] - g) * fres;
        bl += (sky[2] - bl) * fres;
        const o = (j * bw + i) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = bl;
        data[o + 3] = alpha * 255;
      }
    }
    b.putImageData(img, 0, 0);
    // Soft contact shadow on the floor, then the metal.
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.filter = `blur(${(u * 0.03).toFixed(1)}px) brightness(0)`;
    ctx.drawImage(canvas as CanvasImageSource, 0, u * 0.05, w, h);
    ctx.restore();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas as CanvasImageSource, 0, 0, w, h);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.26);
  },
};
