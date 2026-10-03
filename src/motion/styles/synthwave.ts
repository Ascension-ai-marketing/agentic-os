import { mix, rgba } from "../engine/color";
import {
  buffer,
  clamp,
  fitSize,
  font,
  frameOf,
  fract,
  grain,
  ground,
  hash,
  light,
  LOOP,
  noise3,
  once,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { glow, scanlines } from "./_s4-helpers";

const CHROME = '"Kanit", "Arial Black", sans-serif';
const SCRIPT = '"Mr Dafoe", "Brush Script MT", cursive';
/** Grid rows that pass under the camera each loop. */
const ROWS_PER_LOOP = 4;
const STRIPES = 7;

/** Ridge lines for the two mountain ranges, in unit coordinates (x 0..1, height 0..1). */
const RIDGES = once("synth-ridges", () =>
  [0, 1].map((side) => {
    const pts: [number, number][] = [];
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      // Taller toward the outside edge, falling to nothing near the sun.
      const edge = side === 0 ? 1 - x : x;
      const base = Math.pow(edge, 1.3);
      const jag =
        0.55 + 0.45 * Math.abs(noise3(i * 0.55, side * 7.3, 0.4)) + 0.25 * hash(i, side, 9);
      pts.push([x, clamp(base * jag)]);
    }
    return pts;
  }),
);

function chromeWord(
  c: Ctx2D,
  theme: Theme,
  text: string,
  cx: number,
  cy: number,
  size: number,
  t: number,
) {
  const family = theme.font || "Kanit";
  c.save();
  c.font = font(900, size, family, CHROME);
  c.textAlign = "center";
  c.textBaseline = "alphabetic";
  const tw = c.measureText(text).width;
  const top = cy - size * 0.72;
  const base = cy + size * 0.02;
  // Slant it like a sports logo.
  c.translate(cx, cy);
  c.transform(1, 0, -0.2, 1, 0, 0);
  c.translate(-cx, -cy);
  // Extrusion: stacked copies stepping down and right, darkest furthest back.
  const depth = Math.max(3, Math.round(size * 0.1));
  for (let i = depth; i >= 1; i--) {
    c.fillStyle = mix(mix(theme.bg, theme.accent, 0.35), "#000000", (i / depth) * 0.55);
    c.fillText(text, cx + i * 0.45, base + i * 0.9);
  }
  // Chrome: sky above a hard horizon, warm ground below.
  const g = c.createLinearGradient(0, top, 0, base);
  g.addColorStop(0, theme.ink);
  g.addColorStop(0.3, mix(theme.ink, theme.accent2, 0.12));
  g.addColorStop(0.5, mix(theme.ink, theme.bg, 0.45));
  g.addColorStop(0.53, mix(theme.bg, "#000000", 0.2));
  g.addColorStop(0.58, mix(theme.accent, theme.bg, 0.35));
  g.addColorStop(0.8, mix(theme.accent, theme.accent2, 0.55));
  g.addColorStop(1, mix(theme.accent2, theme.ink, 0.45));
  c.fillStyle = g;
  c.fillText(text, cx, base);
  c.lineWidth = Math.max(1, size * 0.018);
  c.strokeStyle = rgba(theme.ink, 0.85);
  c.strokeText(text, cx, base);
  c.restore();
  // Glints: four-point stars that flare once a loop on two letter corners.
  for (let k = 0; k < 2; k++) {
    const at = k === 0 ? 1.1 : 3.3;
    const life = clamp(1 - Math.abs(t - at) / 0.45);
    if (life <= 0) continue;
    const gx = cx + (k === 0 ? -0.38 : 0.31) * tw;
    const gy = top + size * (k === 0 ? 0.08 : 0.3);
    const r = size * 0.42 * life;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.fillStyle = rgba(theme.ink, 0.95 * life);
    c.beginPath();
    c.moveTo(gx - r, gy);
    c.quadraticCurveTo(gx, gy, gx, gy - r);
    c.quadraticCurveTo(gx, gy, gx + r, gy);
    c.quadraticCurveTo(gx, gy, gx, gy + r);
    c.quadraticCurveTo(gx, gy, gx - r, gy);
    c.fill();
    light(c, gx, gy, r * 0.8, theme.ink, 0.6 * life, "lighter");
    c.restore();
  }
}

export const style: MotionStyle = {
  id: "synthwave",
  name: "Synthwave Horizon",
  family: "Retro Tech",
  tagline: "A striped sun on a neon grid",
  look: "Outrun night: a striped sun on a neon grid horizon, wireframe mountains, and slanted chrome type with a neon script.",
  move: "The grid rolls toward you, the sun's stripes sink, stars twinkle and a glint flares across the chrome.",
  rules: [
    "One vanishing point: every floor line meets at the horizon under the sun.",
    "The grid moves by whole rows per loop; lines fade into horizon haze.",
    "The sun is a vertical gradient with stripes that thicken and sink toward the horizon.",
    "Chrome = sky above a hard dark horizon line, warm ground below, a thin bright edge, stacked extrusion.",
    "Neon glows: lines and script carry a soft bloom, never a flat stroke.",
    "Scanlines and grain keep it from feeling like clean vector.",
  ],
  prompt: `R — References
• 1980s chrome logo type and Outrun / synthwave posters (search: 80s chrome text, synthwave sunset grid).
• Neon script signage (Mr Dafoe) and vector-grid horizons.

I — Idea
One endless drive, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a neon grid rolls toward us under a huge striped sun; "{{name}}" hangs over the sun in slanted chrome.
• Middle (1.5–3.5 s): the sun's stripes sink, stars twinkle, a four-point glint flares on the chrome.
• End (3.5–5 s): the grid has moved exactly four rows, the stripes one step: the frame matches the first.

S — Style
Looks: {{bg}} night sky with stars, a sun from {{accent2}} to {{accent}} with sky-coloured stripe cuts, dark wireframe mountains with neon ridges, a {{accent}} grid on a dark floor, chrome type in {{font}} (Kanit Black) slanted 11°, a {{accent}} neon script word in Mr Dafoe.
Moves: constant grid speed (whole rows per loop), stripes sink one step per loop, glints scale in and out over 0.9 s, stars twinkle at whole cycles.
Rules:
1. One vanishing point.
2. Whole-row grid motion; horizon haze.
3. Striped sun with a bloom.
4. Chrome gradient with a hard horizon line and extrusion.
5. Neon bloom on lines and script.
6. Scanlines and grain.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; all floor lines meet at one point; the chrome reads as metal (hard horizon line visible); the script never collides with the chrome word; no clipped letters. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Synthwave",
  theme: {
    bg: "#0d0420",
    ink: "#fbf6ff",
    accent: "#ff2e97",
    accent2: "#ffc23d",
    font: "Kanit",
  },
  fonts: ["Kanit:wght@700;800;900", "Mr Dafoe"],
  tags: [
    "synthwave",
    "outrun",
    "retrowave",
    "80s",
    "neon",
    "sunset",
    "grid",
    "chrome",
    "miami",
    "vaporwave",
    "retro",
    "night",
  ],
  word: "NEON",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const hy = h * (portrait ? 0.6 : 0.62);
    const cx = w / 2;
    ground(ctx, w, h, theme.bg);

    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, theme.bg);
    sky.addColorStop(0.55, mix(theme.bg, theme.accent, 0.16));
    sky.addColorStop(1, mix(theme.bg, theme.accent, 0.42));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hy);
    // Stars.
    for (let i = 0; i < 90; i++) {
      const x = hash(i, 1) * w;
      const y = Math.pow(hash(i, 2), 1.4) * hy * 0.8;
      const tw = 0.5 + 0.5 * Math.sin(TAU * ((t / LOOP) * (1 + (i % 3)) + hash(i, 3)));
      ctx.fillStyle = rgba(theme.ink, (0.15 + 0.55 * hash(i, 4)) * (0.35 + 0.65 * tw));
      const s = Math.max(1, u * (0.0016 + 0.002 * hash(i, 5)));
      ctx.fillRect(x, y, s, s);
    }

    // The sun: gradient disc, stripes cut from its lower half, sinking one step a loop.
    const R = Math.min(w * 0.3, h * (portrait ? 0.22 : 0.31));
    const sy = hy - R * 0.5;
    light(ctx, cx, sy, R * 2.6, theme.accent, 0.35);
    light(ctx, cx, sy - R * 0.3, R * 1.6, theme.accent2, 0.2);
    const { canvas: sunC, ctx: sun } = buffer("synth-sun", Math.ceil(R * 2), Math.ceil(R * 2));
    sun.globalCompositeOperation = "source-over";
    sun.clearRect(0, 0, R * 2, R * 2);
    const sg = sun.createLinearGradient(0, 0, 0, R * 2);
    sg.addColorStop(0, mix(theme.accent2, theme.ink, 0.25));
    sg.addColorStop(0.45, theme.accent2);
    sg.addColorStop(1, theme.accent);
    sun.fillStyle = sg;
    sun.beginPath();
    sun.arc(R, R, R, 0, TAU);
    sun.fill();
    sun.globalCompositeOperation = "destination-out";
    // Stripes run from just above the middle down past the horizon.
    const s0 = R * 0.72;
    const span = R * 1.55 - s0;
    const shift = fract(t / LOOP);
    for (let k = -1; k < STRIPES; k++) {
      const s = (k + shift) / STRIPES;
      if (s < 0) continue;
      const y = s0 + s * span;
      const th = R * (0.018 + 0.085 * s);
      sun.fillRect(0, y - th / 2, R * 2, th);
    }
    ctx.drawImage(sunC as CanvasImageSource, cx - R, sy - R);
    // Horizon haze.
    const haze = ctx.createLinearGradient(0, hy - h * 0.08, 0, hy + h * 0.02);
    haze.addColorStop(0, rgba(theme.accent, 0));
    haze.addColorStop(1, rgba(mix(theme.accent, theme.ink, 0.2), 0.35));
    ctx.fillStyle = haze;
    ctx.fillRect(0, hy - h * 0.08, w, h * 0.1);

    // Mountains: dark silhouettes with neon ridges, outside the sun.
    const { canvas: lineC, ctx: L } = buffer("synth-lines", w, h);
    L.clearRect(0, 0, w, h);
    const mh = h * (portrait ? 0.14 : 0.2);
    RIDGES.forEach((ridge, side) => {
      const x0 = side === 0 ? 0 : cx + R * 0.55;
      const x1 = side === 0 ? cx - R * 0.55 : w;
      const pts = ridge.map(([x, y]) => [x0 + x * (x1 - x0), hy - y * mh] as [number, number]);
      ctx.fillStyle = mix(theme.bg, "#000000", 0.25);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], hy);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], hy);
      ctx.fill();
      L.strokeStyle = theme.accent;
      L.lineWidth = Math.max(1, u * 0.0022);
      L.globalAlpha = 0.9;
      L.beginPath();
      pts.forEach(([x, y], i) => (i ? L.lineTo(x, y) : L.moveTo(x, y)));
      L.stroke();
      // Wireframe facets down each face.
      L.globalAlpha = 0.28;
      L.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        L.moveTo(pts[i][0], pts[i][1]);
        L.lineTo(pts[i][0] + (pts[Math.min(pts.length - 1, i + 1)][0] - pts[i][0]) * 0.5, hy);
      }
      L.stroke();
      L.globalAlpha = 1;
    });

    // Floor and grid: one vanishing point, rows rolling toward us.
    const floor = ctx.createLinearGradient(0, hy, 0, h);
    floor.addColorStop(0, mix(theme.bg, theme.accent, 0.22));
    floor.addColorStop(0.25, mix(theme.bg, "#000000", 0.1));
    floor.addColorStop(1, mix(theme.bg, theme.accent, 0.06));
    ctx.fillStyle = floor;
    ctx.fillRect(0, hy, w, h - hy);
    const camH = (h - hy) * 0.9;
    const lw = Math.max(1, u * 0.0028);
    L.strokeStyle = theme.accent;
    L.lineWidth = lw;
    L.lineCap = "round";
    const rows = 26;
    const move = fract(t / LOOP) * ROWS_PER_LOOP;
    for (let k = 0; k < rows; k++) {
      const z = 1 + (k - fract(move)) * 0.55;
      if (z <= 0.35) continue;
      const y = hy + camH / z;
      if (y > h + lw) continue;
      L.globalAlpha = clamp((y - hy) / (h * 0.12)) * 0.95;
      L.beginPath();
      L.moveTo(0, y);
      L.lineTo(w, y);
      L.stroke();
    }
    const cols = portrait ? 12 : 18;
    for (let i = -cols; i <= cols; i++) {
      const xb = cx + (i / cols) * w * 1.8;
      const g = L.createLinearGradient(0, hy, 0, h);
      g.addColorStop(0, rgba(theme.accent, 0));
      g.addColorStop(0.18, rgba(theme.accent, 0.8));
      g.addColorStop(1, rgba(theme.accent, 1));
      L.strokeStyle = g;
      L.globalAlpha = 1;
      L.beginPath();
      L.moveTo(cx + (xb - cx) * 0.02, hy);
      L.lineTo(xb, h);
      L.stroke();
    }
    L.globalAlpha = 1;
    glow(ctx, lineC as CanvasImageSource, "synth-glow", 0, 0, w, h, 5, 2.6, 1, "screen");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(lineC as CanvasImageSource, 0, 0);
    ctx.restore();

    // Type: chrome word over the sun, neon script crossing it.
    const word = wordFor(theme.name, "NEON", 12).toUpperCase();
    const tyC = portrait ? h * 0.31 : h * 0.33;
    const size = fitSize(
      ctx,
      word,
      w * (portrait ? 0.78 : 0.62),
      h * (portrait ? 0.13 : 0.24),
      900,
      theme.font || "Kanit",
      CHROME,
    );
    chromeWord(ctx, theme, word, cx, tyC, size, t);
    const { canvas: neonC, ctx: N } = buffer("synth-neon", w, h);
    N.clearRect(0, 0, w, h);
    N.save();
    const ss = size * 0.62;
    N.font = font(400, ss, "Mr Dafoe", SCRIPT);
    N.textAlign = "center";
    N.textBaseline = "alphabetic";
    N.translate(cx + size * 0.9, tyC + size * 0.5);
    N.rotate(-0.12);
    N.fillStyle = mix(theme.accent, theme.ink, 0.35);
    N.fillText("Nights", 0, 0);
    N.restore();
    glow(ctx, neonC as CanvasImageSource, "synth-neon-glow", 0, 0, w, h, 4, 3, 1, "screen");
    glow(ctx, neonC as CanvasImageSource, "synth-neon-wide", 0, 0, w, h, 10, 5, 0.8, "screen");
    ctx.drawImage(neonC as CanvasImageSource, 0, 0);
    const mark = tintedLogo(theme, theme.ink, size * 0.5, size * 0.5);
    if (mark) ctx.drawImage(mark as CanvasImageSource, cx - size * 0.25, tyC - size * 1.45);

    scanlines(ctx, w, h, Math.max(2, h / 300), 0.16);
    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
