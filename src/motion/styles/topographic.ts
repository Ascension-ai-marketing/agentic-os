import { mix, parse, rgba } from "../engine/color";
import {
  buffer,
  fbm3,
  font,
  fract,
  frameOf,
  grain,
  ground,
  LOOP,
  MONO,
  SERIF,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle } from "../engine/types";

const LEVELS = 30;
const LO = -0.6;
const HI = 1.3;

/** Terrain height: morphing periodic noise plus two massifs. Units: short side = 1. */
function height(x: number, y: number, z: number) {
  const n = fbm3(x * 1.5 + 10, y * 1.5 + 4, z, 3, 0, 0, 1);
  const peakA = Math.exp(-((x - 0.28) ** 2 + (y + 0.06) ** 2) / 0.07) * 1.05;
  const peakB = Math.exp(-((x + 0.45) ** 2 + (y - 0.18) ** 2) / 0.05) * 0.5;
  return n * 0.75 + peakA + peakB - 0.12;
}

/** Marching squares for one level into a path. */
function contour(
  path: Path2D,
  field: Float32Array,
  gx: number,
  gy: number,
  cell: number,
  level: number,
  x0: number,
  y0: number,
) {
  const lerp = (a: number, b: number) => (level - a) / (b - a || 1e-9);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const k = j * (gx + 1) + i;
      const a = field[k];
      const b = field[k + 1];
      const c = field[k + gx + 2];
      const d = field[k + gx + 1];
      const idx =
        (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = x0 + i * cell;
      const y = y0 + j * cell;
      const top: [number, number] = [x + cell * lerp(a, b), y];
      const right: [number, number] = [x + cell, y + cell * lerp(b, c)];
      const bottom: [number, number] = [x + cell * lerp(d, c), y + cell];
      const left: [number, number] = [x, y + cell * lerp(a, d)];
      const seg = (p: [number, number], q: [number, number]) => {
        path.moveTo(p[0], p[1]);
        path.lineTo(q[0], q[1]);
      };
      switch (idx) {
        case 1:
        case 14:
          seg(left, bottom);
          break;
        case 2:
        case 13:
          seg(bottom, right);
          break;
        case 3:
        case 12:
          seg(left, right);
          break;
        case 4:
        case 11:
          seg(top, right);
          break;
        case 5:
          seg(left, top);
          seg(bottom, right);
          break;
        case 6:
        case 9:
          seg(top, bottom);
          break;
        case 7:
        case 8:
          seg(left, top);
          break;
        case 10:
          seg(left, bottom);
          seg(top, right);
          break;
      }
    }
  }
}

export const style: MotionStyle = {
  id: "topographic",
  name: "Topographic Lines",
  look: "A living contour map: fine sage isolines, heavier index lines, hillshade, a dashed amber route to a pulsing summit.",
  move: "The terrain slowly breathes and the contours flow with it; one glowing contour climbs from valley to peak, the route dashes march.",
  rules: [
    "Contours come from one height field (marching squares), never hand-placed curves.",
    "Every fourth line is an index contour: heavier and brighter.",
    "Hillshade underneath gives the relief, very quietly.",
    "The field morphs through periodic noise, so the loop closes.",
    "One accent: the route, the summit pin and a single climbing contour.",
    "Map furniture is small and sparse: title, north arrow, scale bar.",
    "Lines stay hairline-thin at every size.",
  ],
  prompt: `R — References
• USGS and Swisstopo topographic maps: index contours, hillshade, restrained labels.
• Generative contour art (search: marching squares contour lines animation).

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a quiet contour map of "{{name}}" breathes as the terrain shifts; a dashed route leads to a summit pin.
• Middle (1.5–3.5 s): one glowing contour climbs from the valleys to the peak, tracing every ridge on the way.
• End (3.5–5 s): the glow shrinks into the summit and fades as the terrain settles back to its first frame.

S — Style
Looks: {{bg}} ground with soft hillshade, {{accent2}} hairline contours, {{ink}} index contours every fourth level, an {{accent}} dashed route, summit pin and climbing contour; title in {{font}}, small labels in JetBrains Mono.
Moves: height = periodic fbm noise + two massifs, morphing one noise period per loop; contour lines re-traced every frame; route dashes march a whole number of dash lengths per loop; the summit pulses twice per loop.
Rules:
1. Marching squares on one height field.
2. Index contour every fourth level.
3. Quiet hillshade for relief.
4. One accent (route, pin, climbing contour).
5. Sparse map furniture; hairline weights.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; contours never cross; index lines are clearly heavier; the route ends at the pin; labels never sit on top of each other. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Contour_line",
  theme: {
    bg: "#0b0d0c",
    ink: "#dde6d8",
    accent: "#ff7a45",
    accent2: "#6fa58b",
    font: "Newsreader",
  },
  fonts: ["JetBrains Mono:wght@400;500", "Newsreader:opsz,wght@6..72,400..600"],
  tags: [
    "map",
    "topographic",
    "contour",
    "terrain",
    "mountain",
    "geography",
    "lines",
    "data",
    "outdoors",
    "travel",
    "route",
  ],
  word: "Motion Range",
  family: "Data & Diagrams",
  tagline: "A living contour map",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const z = t / LOOP;
    const rows = Math.max(60, Math.min(150, Math.round(u / 4)));
    const cell = h / rows;
    const gx = Math.ceil(w / cell);
    const gy = rows;
    const field = new Float32Array((gx + 1) * (gy + 1));
    const cx = w / 2;
    const cy = h / 2;
    for (let j = 0; j <= gy; j++)
      for (let i = 0; i <= gx; i++)
        field[j * (gx + 1) + i] = height((i * cell - cx) / u, (j * cell - cy) / u, z);

    // Hillshade on a grid-sized buffer, upscaled smooth.
    const { canvas, ctx: hs } = buffer("topo-shade", gx + 1, gy + 1);
    const img = hs.createImageData(gx + 1, gy + 1);
    const lit = parse(mix(theme.bg, theme.ink, 0.12));
    const dark = parse(mix(theme.bg, "#000000", 0.5));
    for (let j = 0; j <= gy; j++)
      for (let i = 0; i <= gx; i++) {
        const k = j * (gx + 1) + i;
        const dx = field[Math.min(k + 1, j * (gx + 1) + gx)] - field[Math.max(k - 1, j * (gx + 1))];
        const dy = field[Math.min(k + gx + 1, field.length - 1)] - field[Math.max(k - gx - 1, 0)];
        const s = Math.max(-1, Math.min(1, (-dx - dy) * 6));
        const c = s > 0 ? lit : dark;
        const o = k * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = Math.abs(s) * 200;
      }
    hs.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas as CanvasImageSource, 0, 0, (gx + 1) * cell, (gy + 1) * cell);
    ctx.restore();

    // Contours: minor and index.
    const minor = new Path2D();
    const index = new Path2D();
    for (let l = 0; l < LEVELS; l++) {
      const level = LO + ((HI - LO) * (l + 0.5)) / LEVELS;
      contour(l % 5 === 0 ? index : minor, field, gx, gy, cell, level, 0, 0);
    }
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(theme.accent2, 0.62);
    ctx.lineWidth = Math.max(0.7, u * 0.0014);
    ctx.stroke(minor);
    ctx.strokeStyle = rgba(theme.ink, 0.82);
    ctx.lineWidth = Math.max(1.1, u * 0.0028);
    ctx.stroke(index);

    // One contour climbs from the valleys to the summit each loop.
    const ph = fract(z);
    const climb = new Path2D();
    contour(climb, field, gx, gy, cell, LO + (HI + 0.1 - LO) * ph, 0, 0);
    const glow = smoothstep(0, 0.08, ph) * smoothstep(1, 0.9, ph);
    if (glow > 0) {
      ctx.strokeStyle = rgba(theme.accent, 0.25 * glow);
      ctx.lineWidth = u * 0.009;
      ctx.stroke(climb);
      ctx.strokeStyle = rgba(theme.accent, 0.95 * glow);
      ctx.lineWidth = Math.max(1.2, u * 0.0028);
      ctx.stroke(climb);
    }
    ctx.restore();

    // Route to the summit (massif A), dashes marching.
    const px = cx + 0.28 * u;
    const py = cy - 0.06 * u;
    const route: [number, number][] = [];
    const sx = portrait ? w * 0.18 : w * 0.12;
    const sy = h * (portrait ? 0.86 : 0.88);
    for (let i = 0; i <= 40; i++) {
      const k = i / 40;
      route.push([
        sx + (px - sx) * k + Math.sin(k * 7.5) * u * 0.05 * (1 - k),
        sy + (py - sy) * k + Math.cos(k * 5) * u * 0.03 * (1 - k),
      ]);
    }
    ctx.save();
    const dash = u * 0.018;
    ctx.setLineDash([dash, dash * 0.8]);
    ctx.lineDashOffset = -((dash * 1.8 * 4 * t) / LOOP);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = Math.max(1.2, u * 0.0035);
    ctx.lineCap = "round";
    ctx.beginPath();
    route.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    // Summit pin with two pulses per loop.
    for (let k = 0; k < 2; k++) {
      const a = fract((2 * t) / LOOP + k * 0.5);
      ctx.strokeStyle = rgba(theme.accent, 0.7 * (1 - a));
      ctx.lineWidth = Math.max(1, u * 0.002);
      ctx.beginPath();
      ctx.arc(px, py, u * (0.012 + a * 0.06), 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(px, py, u * 0.011, 0, TAU);
    ctx.fill();
    ctx.fillStyle = theme.bg;
    ctx.beginPath();
    ctx.arc(px, py, u * 0.004, 0, TAU);
    ctx.fill();

    // Map furniture.
    const m = u * 0.06;
    const title = wordFor(theme.name, "Motion Range", 20);
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = font(500, u * 0.06, theme.font, SERIF);
    ctx.fillText(title, m, m + u * 0.045);
    ctx.font = font(500, u * 0.02, "JetBrains Mono", MONO);
    ctx.fillStyle = rgba(theme.ink, 0.6);
    ctx.fillText("47°12′N  8°31′E  ·  1:25 000", m, m + u * 0.085);
    ctx.fillStyle = rgba(theme.ink, 0.9);
    ctx.fillText("SUMMIT 2410", px + u * 0.03, py - u * 0.02);
    // North arrow.
    const nx = w - m;
    const ny = m + u * 0.02;
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.moveTo(nx, ny - u * 0.03);
    ctx.lineTo(nx + u * 0.014, ny + u * 0.02);
    ctx.lineTo(nx, ny + u * 0.01);
    ctx.lineTo(nx - u * 0.014, ny + u * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillText("N", nx, ny + u * 0.055);
    // Scale bar.
    const bx = w - m - u * 0.22;
    const by = h - m;
    ctx.fillStyle = rgba(theme.ink, 0.85);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? rgba(theme.ink, 0.25) : rgba(theme.ink, 0.85);
      ctx.fillRect(bx + (u * 0.22 * i) / 4, by, (u * 0.22) / 4, u * 0.007);
    }
    ctx.fillStyle = rgba(theme.ink, 0.6);
    ctx.textAlign = "left";
    ctx.fillText("0", bx, by - u * 0.012);
    ctx.textAlign = "right";
    ctx.fillText("1 km", bx + u * 0.22, by - u * 0.012);
    ctx.textAlign = "left";

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
    void ({} as Ctx2D);
  },
};
