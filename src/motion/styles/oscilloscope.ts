import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  font,
  frameOf,
  fract,
  grain,
  ground,
  light,
  LOOP,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { glow, stepFrame } from "./_s4-helpers";

const FACE = '"Share Tech Mono", "SFMono-Regular", Menlo, monospace';
/** Frequency ratio X : Y. */
const FX = 3;
const FY = 2;
const SAMPLES = 900;
const BUCKETS = 14;

interface Grid {
  d: number;
  cols: number;
  rows: number;
  cx: number;
  cy: number;
  gw: number;
  gh: number;
}

function grid(w: number, h: number): Grid {
  const { portrait, square } = frameOf(w, h);
  let d: number;
  let cols: number;
  let rows: number;
  if (portrait) {
    cols = 8;
    d = (w * 0.88) / cols;
    rows = Math.max(8, 2 * Math.floor((h * 0.8) / d / 2));
  } else if (square) {
    cols = 8;
    rows = 8;
    d = (Math.min(w, h) * 0.84) / 8;
  } else {
    rows = 8;
    d = (h * 0.8) / rows;
    cols = Math.max(8, 2 * Math.floor((w * 0.9) / d / 2));
  }
  return { d, cols, rows, cx: w / 2, cy: h / 2, gw: cols * d, gh: rows * d };
}

/** The glass, the etched graticule and the bezel shadow: static, baked once per size. */
function face(theme: Theme, g: Grid) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    // Phosphor black is never flat: a faint green lift in the middle of the tube.
    const lift = c.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, Math.max(g.gw, g.gh) * 0.75);
    lift.addColorStop(0, rgba(theme.accent, 0.075));
    lift.addColorStop(0.6, rgba(theme.accent, 0.03));
    lift.addColorStop(1, rgba(theme.accent, 0));
    c.fillStyle = lift;
    c.fillRect(0, 0, w, h);
    const x0 = g.cx - g.gw / 2;
    const y0 = g.cy - g.gh / 2;
    const line = mix(theme.bg, theme.ink, 0.2);
    const k = Math.max(1, u / 1080);
    c.strokeStyle = line;
    c.lineWidth = Math.max(1, 1.1 * k);
    c.beginPath();
    for (let i = 0; i <= g.cols; i++) {
      const x = Math.round(x0 + i * g.d) + 0.5;
      c.moveTo(x, y0);
      c.lineTo(x, y0 + g.gh);
    }
    for (let j = 0; j <= g.rows; j++) {
      const y = Math.round(y0 + j * g.d) + 0.5;
      c.moveTo(x0, y);
      c.lineTo(x0 + g.gw, y);
    }
    c.stroke();
    // Minor ticks on the centre axes, five per division.
    c.strokeStyle = mix(theme.bg, theme.ink, 0.34);
    c.beginPath();
    const tick = g.d * 0.07;
    for (let i = 0; i <= g.cols * 5; i++) {
      const x = Math.round(x0 + (i * g.d) / 5) + 0.5;
      c.moveTo(x, g.cy - tick);
      c.lineTo(x, g.cy + tick);
    }
    for (let j = 0; j <= g.rows * 5; j++) {
      const y = Math.round(y0 + (j * g.d) / 5) + 0.5;
      c.moveTo(g.cx - tick, y);
      c.lineTo(g.cx + tick, y);
    }
    c.stroke();
    // The outer frame of the graticule, a touch brighter.
    c.strokeStyle = mix(theme.bg, theme.ink, 0.3);
    c.lineWidth = Math.max(1, 1.6 * k);
    c.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(g.gw), Math.round(g.gh));
  };
}

/** A point of the figure at parameter s, phase p. */
function at(s: number, p: number, ax: number, ay: number): [number, number] {
  return [Math.sin(FX * s + p) * ax, -Math.sin(FY * s) * ay];
}

/**
 * Stroke one Lissajous pass. Brightness follows dwell time (slow beam =
 * bright), bucketed so each brightness is one path.
 */
function trace(
  c: Ctx2D,
  g: Grid,
  p: number,
  gain: number,
  ax: number,
  ay: number,
  width: number,
  color: string,
) {
  // Runs of consecutive samples that share a brightness become one subpath,
  // so no joint is stroked twice (no bright beads along the line).
  const runs: number[][][] = Array.from({ length: BUCKETS }, () => []);
  const ds = TAU / SAMPLES;
  const mean = (ax * FX + ay * FY) * 0.7;
  let [px, py] = at(0, p, ax, ay);
  let run: number[] | null = null;
  let runB = -1;
  for (let i = 1; i <= SAMPLES; i++) {
    const s = i * ds;
    const [x, y] = at(s, p, ax, ay);
    const vx = FX * ax * Math.cos(FX * (s - ds / 2) + p);
    const vy = FY * ay * Math.cos(FY * (s - ds / 2));
    const speed = Math.hypot(vx, vy);
    const bright = clamp((0.34 * mean) / (speed + mean * 0.05), 0.12, 1) * gain;
    const b = Math.min(BUCKETS - 1, Math.floor(bright * BUCKETS));
    if (b !== runB || !run) {
      run = [px, py];
      runs[b].push(run);
      runB = b;
    }
    run.push(x, y);
    px = x;
    py = y;
  }
  c.lineCap = "butt";
  c.lineJoin = "round";
  c.lineWidth = width;
  c.strokeStyle = color;
  for (let b = 0; b < BUCKETS; b++) {
    if (!runs[b].length) continue;
    c.globalAlpha = (b + 0.5) / BUCKETS;
    c.beginPath();
    for (const r of runs[b]) {
      c.moveTo(g.cx + r[0], g.cy + r[1]);
      for (let i = 2; i < r.length; i += 2) c.lineTo(g.cx + r[i], g.cy + r[i + 1]);
    }
    c.stroke();
  }
  c.globalAlpha = 1;
}

export const style: MotionStyle = {
  id: "oscilloscope",
  name: "Phosphor Oscilloscope",
  family: "Retro Tech",
  tagline: "A phosphor Lissajous knot",
  look: "An analogue scope in X–Y mode: a green phosphor Lissajous knot over an etched graticule, hot white core, soft bloom.",
  move: "The 3:2 figure tumbles as the phase turns once a loop; the beam writes a brighter comet along it; the old trace lingers.",
  rules: [
    "Brightness follows the beam: slow turns glow hot, fast strokes stay thin and dim.",
    "A white-hot core inside a green halo; bloom, never a flat stroke.",
    "Whole-number frequencies and one full phase turn per loop, so it closes.",
    "Persistence: the last few passes linger and decay behind the figure.",
    "An etched graticule with minor ticks on the axes; readouts small, in a mono face.",
    "Phosphor black is dark green, lifted in the middle, never flat.",
  ],
  prompt: `R — References
• Analogue oscilloscopes in X–Y mode drawing Lissajous figures (search: Lissajous oscilloscope, Tektronix X-Y mode).
• Oscilloscope music and vector phosphor displays: bright slow turns, dim fast strokes, long persistence.

I — Idea
One figure, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a 3:2 Lissajous knot glows on the graticule; a brighter comet runs along the beam path.
• Middle (1.5–3.5 s): the phase turns, so the knot seems to tumble in 3D; old passes linger in the phosphor.
• End (3.5–5 s): the phase completes one full turn and the figure lands exactly on its first frame.

S — Style
Looks: {{bg}} tube, {{accent}} P31 phosphor with a white-hot {{ink}} core and a soft bloom, a graticule etched in dim {{ink}}, small readouts in Share Tech Mono in {{accent2}}, "{{name}}" as the channel label.
Moves: x = sin(3s + φ), y = sin(2s); φ turns once per loop; the comet runs the figure twice per loop; persistence ghosts 40 ms apart.
Rules:
1. Brightness ∝ 1 / beam speed; bucket it so each brightness is one path.
2. Two strokes per path: a wide halo and a thin hot core, added with "lighter".
3. Whole-number frequency ratio and one full phase turn per loop.
4. Three decaying persistence passes behind the live trace.
5. Graticule with minor ticks; readouts no more than three words each.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the turning points glow brighter than the fast strokes; the core stays thin and crisp; the graticule is visible but quiet; nothing clips at the screen edge. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Lissajous_curve",
  theme: {
    bg: "#020604",
    ink: "#e4fff0",
    accent: "#3dff8e",
    accent2: "#e3b45c",
    font: "Share Tech Mono",
  },
  fonts: ["Share Tech Mono"],
  tags: [
    "oscilloscope",
    "scope",
    "lissajous",
    "waveform",
    "signal",
    "vector",
    "phosphor",
    "green",
    "audio",
    "science",
    "retro",
    "lab",
  ],
  word: "CH1",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const g = grid(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `osc-face:${theme.bg}${theme.ink}${theme.accent}`,
        w,
        h,
        face(theme, g),
      ) as CanvasImageSource,
      0,
      0,
    );

    const phaseT = t / LOOP;
    const p = TAU * phaseT;
    // Channel gains fill the graticule in every aspect.
    const ax = (g.gw / 2) * 0.8;
    const ay = (g.gh / 2) * 0.8;
    const k = Math.max(0.6, u / 1080);

    const { canvas: layerC, ctx: layer } = buffer("osc-trace", w, h);
    layer.clearRect(0, 0, w, h);
    layer.save();
    layer.globalCompositeOperation = "lighter";
    // Persistence: older passes, dimmer and a touch wider (the spot spreads as it decays).
    for (let i = 3; i >= 1; i--) {
      const pp = p - i * 0.045 * TAU * 0.5;
      trace(layer, g, pp, 0.55 * Math.pow(0.5, i), ax, ay, 4.2 * k, theme.accent);
    }
    // The live trace: halo, then the white-hot core.
    trace(layer, g, p, 1, ax, ay, 4.4 * k, theme.accent);
    trace(layer, g, p, 0.95, ax, ay, 1.5 * k, mix(theme.accent, theme.ink, 0.8));

    // The writing beam: a comet that runs the figure twice per loop.
    const head = fract(phaseT * 2) * TAU;
    const tail = 0.55;
    const steps = 48;
    layer.lineCap = "butt";
    for (let i = 0; i < steps; i++) {
      const s0 = head - tail * (1 - i / steps);
      const s1 = head - tail * (1 - (i + 1) / steps);
      const [x0, y0] = at(s0, p, ax, ay);
      const [x1, y1] = at(s1, p, ax, ay);
      const a = Math.pow((i + 1) / steps, 2.2);
      layer.globalAlpha = a * 0.9;
      layer.strokeStyle = mix(theme.accent, theme.ink, 0.65);
      layer.lineWidth = (2.4 + 2.2 * a) * k;
      layer.beginPath();
      layer.moveTo(g.cx + x0, g.cy + y0);
      layer.lineTo(g.cx + x1, g.cy + y1);
      layer.stroke();
    }
    layer.globalAlpha = 1;
    const [hx, hy] = at(head, p, ax, ay);
    const spot = layer.createRadialGradient(g.cx + hx, g.cy + hy, 0, g.cx + hx, g.cy + hy, 16 * k);
    spot.addColorStop(0, rgba(theme.ink, 1));
    spot.addColorStop(0.25, rgba(theme.accent, 0.8));
    spot.addColorStop(1, rgba(theme.accent, 0));
    layer.fillStyle = spot;
    layer.fillRect(g.cx + hx - 16 * k, g.cy + hy - 16 * k, 32 * k, 32 * k);
    layer.restore();

    glow(ctx, layerC as CanvasImageSource, "osc-wide", 0, 0, w, h, 10, 5, 1, "screen");
    glow(ctx, layerC as CanvasImageSource, "osc", 0, 0, w, h, 4, 2.2, 1, "screen");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(layerC as CanvasImageSource, 0, 0);
    ctx.restore();

    // Readouts: small, mono, inside the graticule corners.
    const x0 = g.cx - g.gw / 2;
    const y0 = g.cy - g.gh / 2;
    const size = Math.max(9, g.d * 0.3);
    ctx.font = font(400, size, "Share Tech Mono", FACE);
    ctx.textBaseline = "alphabetic";
    const pad = g.d * 0.22;
    const label = wordFor(theme.name, "CH1", 12).toUpperCase();
    const deg = Math.round((stepFrame(t, 10) / (LOOP * 10)) * 360) % 360;
    ctx.fillStyle = rgba(theme.accent2, 0.92);
    ctx.textAlign = "left";
    ctx.fillText("X–Y", x0 + pad, y0 + pad + size);
    ctx.fillText(`${FX} : ${FY}`, x0 + pad, y0 + g.gh - pad);
    ctx.textAlign = "right";
    ctx.fillText(`Φ ${String(deg).padStart(3, "0")}°`, x0 + g.gw - pad, y0 + g.gh - pad);
    ctx.fillText(label, x0 + g.gw - pad, y0 + pad + size);
    const mark = tintedLogo(theme, theme.accent2, size * 1.3, size * 1.3);
    if (mark) {
      const lw = ctx.measureText(label).width;
      ctx.drawImage(
        mark as CanvasImageSource,
        x0 + g.gw - pad - lw - size * 1.8,
        y0 + pad - size * 0.08,
      );
    }
    ctx.textAlign = "left";

    // Glass: a soft reflection across the top-left of the tube.
    light(ctx, w * 0.24, h * 0.12, Math.max(w, h) * 0.5, theme.ink, 0.05);
    vignette(ctx, w, h, "#000000", 0.66);
    grain(ctx, w, h, t, 0.3);
  },
};
