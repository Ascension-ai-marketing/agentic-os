import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  light,
  seg,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { fmt, glow, studio, tabular, unit } from "./_s6-helpers";

const SAIRA = '"Saira", "Helvetica Neue", Arial, sans-serif';
const A0 = Math.PI * 0.75;
const SPAN = Math.PI * 1.5;

type Dial = {
  key: string;
  min: number;
  max: number;
  major: number;
  minor: number;
  label: string;
  red?: number;
  fmt: (v: number) => string;
};

/** Made-up instrument cluster. */
const MAIN: Dial = {
  key: "rpm",
  min: 0,
  max: 8,
  major: 1,
  minor: 0.2,
  label: "RPM ×1000",
  red: 6.5,
  fmt: (v) => String(Math.round(v)),
};
const LEFT: Dial = {
  key: "boost",
  min: 0,
  max: 2,
  major: 0.5,
  minor: 0.1,
  label: "BOOST BAR",
  fmt: (v) => v.toFixed(1),
};
const RIGHT: Dial = {
  key: "oil",
  min: 50,
  max: 150,
  major: 25,
  minor: 5,
  label: "OIL °C",
  red: 130,
  fmt: (v) => String(Math.round(v)),
};

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h) * (portrait ? 1.1 : 1);
  if (portrait)
    return {
      U,
      portrait,
      main: { x: w * 0.5, y: h * 0.4, r: w * 0.4 },
      left: { x: w * 0.28, y: h * 0.74, r: w * 0.19 },
      right: { x: w * 0.72, y: h * 0.74, r: w * 0.19 },
    };
  if (square)
    return {
      U,
      portrait,
      main: { x: w * 0.5, y: h * 0.47, r: h * 0.29 },
      left: { x: w * 0.16, y: h * 0.84, r: h * 0.12 },
      right: { x: w * 0.84, y: h * 0.84, r: h * 0.12 },
    };
  return {
    U,
    portrait,
    main: { x: w * 0.5, y: h * 0.56, r: h * 0.35 },
    left: { x: w * 0.2, y: h * 0.62, r: h * 0.21 },
    right: { x: w * 0.8, y: h * 0.62, r: h * 0.21 },
  };
}

const angleOf = (d: Dial, v: number) => A0 + SPAN * clamp((v - d.min) / (d.max - d.min));

/** The dial face: bezel, sunburst, ticks, numerals, redline and label. `lit` bakes the glowing version. */
function face(theme: Theme, d: Dial, lit: boolean) {
  return (c: Ctx2D, W: number, H: number) => {
    const r = W / 2 - 2;
    const x = W / 2;
    const y = H / 2;
    const u = r / 300;
    if (!lit) {
      // Bezel: a brushed metal ring.
      const bez = c.createConicGradient ? c.createConicGradient(-0.6, x, y) : null;
      if (bez) {
        for (let i = 0; i <= 8; i++)
          bez.addColorStop(i / 8, mix(theme.bg, theme.ink, i % 2 ? 0.34 : 0.1));
        c.fillStyle = bez;
      } else c.fillStyle = mix(theme.bg, theme.ink, 0.2);
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
      // Face: graphite with a sunburst brush.
      const f = c.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r * 0.95);
      f.addColorStop(0, mix(theme.bg, theme.ink, 0.1));
      f.addColorStop(1, mix(theme.bg, "#000000", 0.35));
      c.fillStyle = f;
      c.beginPath();
      c.arc(x, y, r * 0.94, 0, TAU);
      c.fill();
      c.save();
      c.beginPath();
      c.arc(x, y, r * 0.94, 0, TAU);
      c.clip();
      for (let i = 0; i < 360; i++) {
        const a = (i / 360) * TAU;
        c.strokeStyle = rgba(
          i % 2 ? theme.ink : "#000000",
          0.02 + 0.02 * Math.abs(Math.sin(a * 2)),
        );
        c.lineWidth = Math.max(1, u);
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        c.stroke();
      }
      c.restore();
      // Inner shadow at the rim.
      const rim = c.createRadialGradient(x, y, r * 0.8, x, y, r * 0.94);
      rim.addColorStop(0, rgba("#000000", 0));
      rim.addColorStop(1, rgba("#000000", 0.45));
      c.fillStyle = rim;
      c.beginPath();
      c.arc(x, y, r * 0.94, 0, TAU);
      c.fill();
    }
    // Redline band.
    if (d.red !== undefined) {
      c.strokeStyle = rgba(theme.accent, lit ? 0.9 : 0.35);
      c.lineWidth = r * 0.05;
      c.beginPath();
      c.arc(x, y, r * 0.8, angleOf(d, d.red), angleOf(d, d.max));
      c.stroke();
    }
    // Ticks and numerals.
    const ink = lit ? theme.ink : mix(theme.ink, theme.bg, 0.55);
    for (let v = d.min; v <= d.max + 1e-6; v += d.minor) {
      const isMajor = Math.abs(v / d.major - Math.round(v / d.major)) < 1e-6;
      const a = angleOf(d, v);
      const r0 = r * (isMajor ? 0.72 : 0.77);
      const r1 = r * 0.86;
      c.strokeStyle =
        d.red !== undefined && v >= d.red - 1e-6 ? rgba(theme.accent, lit ? 1 : 0.5) : ink;
      c.lineWidth = isMajor ? r * 0.018 : r * 0.008;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      c.stroke();
      if (isMajor) {
        c.fillStyle =
          d.red !== undefined && v >= d.red - 1e-6 ? rgba(theme.accent, lit ? 1 : 0.55) : ink;
        c.font = font(500, r * 0.14, theme.font, SAIRA);
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(d.fmt(v), x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58);
      }
    }
    c.fillStyle = lit ? rgba(theme.ink, 0.75) : rgba(theme.ink, 0.3);
    c.font = font(500, r * 0.075, theme.font, SAIRA);
    c.letterSpacing = `${(r * 0.012).toFixed(2)}px`;
    c.textAlign = "center";
    c.fillText(d.label, x, y - r * 0.3);
    c.letterSpacing = "0px";
  };
}

/** One dial at value v with illumination `on` (0..1). */
function drawDial(
  ctx: Ctx2D,
  theme: Theme,
  d: Dial,
  g: { x: number; y: number; r: number },
  v: number,
  on: number,
  readout: number | null,
) {
  const size = Math.round(g.r * 2 + 4);
  const baseFace = bake(
    `gauge-face:${d.key}:${theme.bg}${theme.ink}${theme.accent}${theme.font}`,
    size,
    size,
    face(theme, d, false),
  );
  const litFace = bake(
    `gauge-lit:${d.key}:${theme.bg}${theme.ink}${theme.accent}${theme.font}`,
    size,
    size,
    face(theme, d, true),
  );
  // Drop shadow under the dial.
  glow(ctx, g.x, g.y + g.r * 0.08, g.r * 1.25, "#000000", 0.7, "source-over");
  ctx.drawImage(baseFace as CanvasImageSource, g.x - size / 2, g.y - size / 2);
  if (on > 0.01) {
    ctx.save();
    ctx.globalAlpha = on;
    ctx.drawImage(litFace as CanvasImageSource, g.x - size / 2, g.y - size / 2);
    ctx.restore();
  }
  const a = angleOf(d, v);
  // The sweep arc: a lit trail from the stop to the needle.
  if (on > 0.01 && a > A0 + 0.002) {
    ctx.save();
    ctx.lineCap = "butt";
    ctx.strokeStyle = rgba(theme.accent2, 0.9 * on);
    ctx.lineWidth = g.r * 0.035;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r * 0.9, A0, a);
    ctx.stroke();
    ctx.restore();
    glow(
      ctx,
      g.x + Math.cos(a) * g.r * 0.9,
      g.y + Math.sin(a) * g.r * 0.9,
      g.r * 0.22,
      theme.accent2,
      0.6 * on,
    );
  }
  // Digital readout.
  if (readout !== null) {
    // A recessed display window, so the digits never read as part of the scale.
    const wx = g.x - g.r * 0.27;
    const wy = g.y + g.r * 0.26;
    const ww = g.r * 0.54;
    const wh = g.r * 0.26;
    ctx.save();
    ctx.fillStyle = mix(theme.bg, "#000000", 0.5);
    ctx.beginPath();
    ctx.roundRect(wx, wy, ww, wh, g.r * 0.04);
    ctx.fill();
    ctx.strokeStyle = rgba(theme.ink, 0.12);
    ctx.lineWidth = Math.max(1, g.r * 0.005);
    ctx.stroke();
    ctx.globalAlpha = 0.2 + 0.8 * on;
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "alphabetic";
    ctx.font = font(500, g.r * 0.15, theme.font, SAIRA);
    tabular(ctx, fmt(Math.round((readout * 1000) / 10) * 10), g.x, wy + wh * 0.62, "center");
    ctx.fillStyle = rgba(theme.accent2, 0.9);
    ctx.font = font(500, g.r * 0.05, theme.font, SAIRA);
    ctx.letterSpacing = `${(g.r * 0.01).toFixed(2)}px`;
    ctx.textAlign = "center";
    ctx.fillText("RPM", g.x, wy + wh * 0.88);
    ctx.letterSpacing = "0px";
    ctx.restore();
  }
  // Needle: a tapered blade with a counterweight, red tip, drop shadow.
  const blade = (dx: number, dy: number, fill: string) => {
    ctx.save();
    ctx.translate(g.x + dx, g.y + dy);
    ctx.rotate(a);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-g.r * 0.2, -g.r * 0.028);
    ctx.lineTo(g.r * 0.84, -g.r * 0.006);
    ctx.lineTo(g.r * 0.86, 0);
    ctx.lineTo(g.r * 0.84, g.r * 0.006);
    ctx.lineTo(-g.r * 0.2, g.r * 0.028);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  blade(g.r * 0.02, g.r * 0.03, rgba("#000000", 0.5));
  blade(0, 0, mix(theme.ink, theme.bg, 0.08));
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(a);
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.moveTo(g.r * 0.52, -g.r * 0.014);
  ctx.lineTo(g.r * 0.84, -g.r * 0.006);
  ctx.lineTo(g.r * 0.86, 0);
  ctx.lineTo(g.r * 0.84, g.r * 0.006);
  ctx.lineTo(g.r * 0.52, g.r * 0.014);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Hub cap.
  const hub = ctx.createRadialGradient(g.x - g.r * 0.03, g.y - g.r * 0.03, 0, g.x, g.y, g.r * 0.09);
  hub.addColorStop(0, mix(theme.ink, theme.bg, 0.3));
  hub.addColorStop(1, mix(theme.bg, "#000000", 0.4));
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r * 0.085, 0, TAU);
  ctx.fill();
  // Glass: one soft specular crescent.
  ctx.save();
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r * 0.94, 0, TAU);
  ctx.clip();
  const spec = ctx.createLinearGradient(g.x - g.r, g.y - g.r, g.x + g.r * 0.2, g.y + g.r * 0.2);
  spec.addColorStop(0, rgba(theme.ink, 0.09));
  spec.addColorStop(0.5, rgba(theme.ink, 0.02));
  spec.addColorStop(0.51, rgba(theme.ink, 0));
  ctx.fillStyle = spec;
  ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
  ctx.restore();
}

export const style: MotionStyle = {
  id: "gauge-dial",
  name: "Gauge Cluster",
  family: "Data & Diagrams",
  tagline: "A sports-car instrument cluster",
  look: "A sports-car instrument cluster: brushed graphite dials, crisp applied numerals, a red-tipped needle, an amber sweep arc and a redline.",
  move: "Ignition sweep to full scale and back, a settle at idle, a hard rev into the redline with the readout counting, then the cluster powers down.",
  rules: [
    "Needles move like mass: ease out, overshoot a hair, settle, tremble at idle.",
    "Numerals and ticks are crisp and light up with the cluster, never glow blobs.",
    "Only the needle tip and the redline carry the red accent.",
    "The amber sweep arc follows the needle along the rim.",
    "One big digital readout in tabular digits; the small dials stay analogue.",
    "Brushed sunburst faces and a single glass reflection sell the material.",
    "Powered down (needles at rest, dials dark) is the first and last frame.",
  ],
  prompt: `R — References
• Sports-car instrument clusters and chronograph dials (search: car gauge cluster startup sweep, tachometer redline).
• Watch dials: sunburst brushing, applied indices, one reflection on the crystal.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a dark three-dial cluster powers up; all needles do the ignition sweep to full scale and back, the numerals lighting as they pass.
• Middle (1.5–3.5 s): idle for a beat, then a hard rev: the main needle climbs into the redline with an amber sweep arc behind it while the readout counts to 7,240; the side dials rise with it.
• End (3.5–5 s): the rev falls back, then the cluster powers down to the dark, resting first frame.

S — Style
Looks: {{bg}} graphite ground; brushed dials with a metal bezel; {{ink}} ticks and numerals in {{font}}; needle tips and the redline in {{accent}}; the sweep arc in {{accent2}}; a single soft reflection on the glass.
Moves: the ignition sweep is 0.5 s up and 0.5 s down (inOutCubic); the rev is outCubic with a 2% overshoot; idle trembles on a whole-number sine; power-down eases the needles to their stops as the lights fade.
Rules:
1. Needles have mass: overshoot and settle.
2. Numerals light with the cluster; no bloom blobs.
3. Red only on needle tips and the redline.
4. One digital readout, tabular digits.
5. Powered down is the first and last frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; numerals are crisp and upright; the needle never passes its stops; the readout matches the needle; dials never overlap. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Tachometer",
  theme: {
    bg: "#0b0b0c",
    ink: "#eeeeea",
    accent: "#ff3b30",
    accent2: "#ffb020",
    font: "Saira",
  },
  fonts: ["Saira:wght@100..900"],
  tags: [
    "gauge",
    "dial",
    "dashboard",
    "speedometer",
    "meter",
    "car",
    "performance",
    "speed",
    "kpi",
    "instrument",
    "metrics",
  ],
  word: "Drive",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U } = lay;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "gauge", w, h, { lx: 0.5, ly: 0.1, mottle: 0.8 }) as CanvasImageSource,
      0,
      0,
    );

    // Timeline: ignition sweep, idle, rev, fall, power down.
    const on = ease.inOutCubic(seg(t, 0.1, 0.5)) * (1 - ease.inOutCubic(seg(t, 4.35, 4.9)));
    const sweep = ease.inOutCubic(seg(t, 0.25, 0.8)) - ease.inOutCubic(seg(t, 0.85, 1.4));
    const idle = ease.outCubic(seg(t, 1.45, 1.8)) * (1 - ease.inOutCubic(seg(t, 4.3, 4.85)));
    const rev = ease.outCubic(seg(t, 2.0, 2.65)) * (1 - ease.inOutCubic(seg(t, 3.7, 4.2)));
    const over = 0.02 * Math.sin(Math.PI * seg(t, 2.45, 2.95)) * (t < 2.95 ? 1 : 0);
    const tremble = 0.012 * Math.sin((TAU * 23 * t) / 5) + 0.006 * Math.sin((TAU * 37 * t) / 5);
    const rpmSteady = clamp(sweep * 8 + idle * 0.9 + rev * 6.34 + over * 8, 0, 8);
    const rpm = clamp(rpmSteady + idle * tremble * 8, 0, 8);
    const boost = clamp(sweep * 2 + idle * 0.1 + rev * 1.45, 0, 2);
    const oil = 50 + clamp(sweep + idle * 0.3 + rev * 0.42 + idle * rev * 0.1, 0, 1) * 100;

    light(
      ctx,
      lay.main.x,
      lay.main.y,
      lay.main.r * 2.4,
      theme.accent2,
      0.05 + 0.05 * on + 0.05 * rev,
    );
    drawDial(ctx, theme, LEFT, lay.left, boost, on, null);
    drawDial(ctx, theme, RIGHT, lay.right, oil, on, null);
    drawDial(ctx, theme, MAIN, lay.main, rpm, on, rpmSteady);
    if (rev > 0.5 && rpm > 6.5) {
      // Redline warning lamp.
      const lamp = clamp((rpm - 6.5) / 0.4) * (0.6 + 0.4 * Math.sin((TAU * 20 * t) / 5));
      glow(ctx, lay.main.x, lay.main.y - lay.main.r * 0.62, lay.main.r * 0.18, theme.accent, lamp);
    }

    // Title.
    const L = Math.max(w * (lay.portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
    const ty = h * (lay.portrait ? 0.09 : 0.13);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(500, 50 * U, theme.font, SAIRA);
    ctx.letterSpacing = `${(0.5 * U).toFixed(2)}px`;
    ctx.fillText("Launch control", L, ty);
    ctx.letterSpacing = `${(2.4 * U).toFixed(2)}px`;
    ctx.fillStyle = rgba(theme.ink, 0.45);
    ctx.font = font(500, 17 * U, theme.font, SAIRA);
    ctx.fillText("CLUSTER TEST · IGNITION TO REDLINE", L, ty + 34 * U);
    ctx.letterSpacing = "0px";

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.22);
  },
};
