import { adjust, mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  frameOf,
  grain,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { fitText, fontOf, noiseTile, pulse, tnoise } from "./_s5-helpers";

const FAMILY = "Cormorant Garamond";
const SERIF_FALLBACK = '"Newsreader", Georgia, serif';

interface Plan {
  u: number;
  word: string;
  family: string;
  size: number;
  /** Letter origins (baseline) and centres, so each letter is lit from its own angle. */
  letters: { ch: string; x: number; cx: number }[];
  wy: number;
  wordCy: number;
  candleX: number;
  candleTop: number;
  candleW: number;
  tableY: number;
  flameH: number;
}

function plan(ctx: Ctx2D, theme: Theme, w: number, h: number): Plan {
  const { u, portrait } = frameOf(w, h);
  const word = wordFor(theme.name, "Midnight", 12);
  const family = theme.font || FAMILY;
  ctx.save();
  ctx.letterSpacing = "0px";
  const fit = fitText(
    ctx,
    word,
    portrait ? w * 0.84 : w * 0.66,
    h * (portrait ? 0.13 : 0.22),
    u * 0.3,
    600,
    family,
    SERIF_FALLBACK,
  );
  ctx.font = fontOf("", 600, fit.size, family, SERIF_FALLBACK);
  const full = ctx.measureText(word);
  const x0 = w / 2 - (full.actualBoundingBoxRight - full.actualBoundingBoxLeft) / 2;
  const wordCy = h * (portrait ? 0.4 : 0.33);
  const wy = wordCy + (full.actualBoundingBoxAscent - full.actualBoundingBoxDescent) / 2;
  const letters: Plan["letters"] = [];
  for (let i = 0; i < word.length; i++) {
    const pre = ctx.measureText(word.slice(0, i)).width;
    const me = ctx.measureText(word[i]).width;
    letters.push({ ch: word[i], x: x0 + pre, cx: x0 + pre + me / 2 });
  }
  ctx.restore();
  const tableY = h * (portrait ? 0.8 : 0.86);
  const candleW = u * (portrait ? 0.22 : 0.17);
  const candleTop = tableY - u * (portrait ? 0.34 : 0.26);
  return {
    u,
    word,
    family,
    size: fit.size,
    letters,
    wy,
    wordCy,
    candleX: w / 2,
    candleTop,
    candleW,
    tableY,
    flameH: u * 0.125,
  };
}

/** Plaster wall, the table top, and the word raised in plaster: all albedo, lit later. */
function wall(theme: Theme, p: Plan) {
  return (c: Ctx2D, w: number, h: number) => {
    const img = c.createImageData(w, h);
    const d = img.data;
    const A = noiseTile(71, 256, 6, 5);
    const B = noiseTile(19, 256, 24, 3);
    const s1 = 256 / (p.u * 1.1);
    const s2 = 256 / (p.u * 0.3);
    const plaster = parse(mix(theme.bg, theme.ink, 0.5));
    const wood = parse(mix(mix(theme.bg, theme.accent, 0.3), theme.ink, 0.18));
    for (let y = 0; y < h; y++) {
      const onTable = y >= p.tableY;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (onTable) {
          // Wood grain runs sideways.
          const g = B.sample(x * s2 * 0.15, y * s2 * 3);
          const k = 0.55 + 0.45 * g;
          d[o] = wood[0] * k;
          d[o + 1] = wood[1] * k;
          d[o + 2] = wood[2] * k;
        } else {
          const n = A.sample(x * s1, y * s1);
          const f = B.sample(x * s2, y * s2);
          const k = 0.72 + 0.3 * n + 0.1 * (f - 0.5);
          d[o] = plaster[0] * k;
          d[o + 1] = plaster[1] * k;
          d[o + 2] = plaster[2] * k;
        }
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // The table's front edge catches a thin line of light.
    c.fillStyle = rgba(theme.ink, 0.35);
    c.fillRect(0, p.tableY, w, Math.max(1, p.u * 0.003));
    // The raised word: a touch lighter than the wall it is cut from.
    c.save();
    c.font = fontOf("", 600, p.size, p.family, SERIF_FALLBACK);
    c.fillStyle = rgba(mix(theme.bg, theme.ink, 0.62), 1);
    for (const L of p.letters) c.fillText(L.ch, L.x, p.wy);
    c.restore();
  };
}

/** The word's soft shadow, blurred once. */
function shade(p: Plan) {
  return (c: Ctx2D) => {
    c.font = fontOf("", 600, p.size, p.family, SERIF_FALLBACK);
    c.fillStyle = "#000";
    c.filter = `blur(${(p.u * 0.006).toFixed(1)}px)`;
    for (const L of p.letters) c.fillText(L.ch, L.x, p.wy);
    c.filter = "none";
  };
}

interface Flame {
  x: number;
  base: number;
  h: number;
  lean: number;
  bright: number;
}

function flameAt(t: number, p: Plan): Flame {
  // A gust at ~3 s: the flame bows over, shrinks and gutters, then recovers.
  const gust = pulse(t, 2.8, 3.1, 3.35, 4.05);
  const sway = 0.5 * tnoise(t, 3, 1.3) + 0.25 * tnoise(t, 7, 2.1);
  const lean = sway * 0.35 + gust * 0.9;
  const breath = 1 + 0.06 * tnoise(t, 5, 3.7) + 0.035 * tnoise(t, 11, 5.2);
  const hgt = p.flameH * breath * (1 - 0.32 * gust);
  const flick = 1 + 0.06 * tnoise(t, 9, 7.9) + 0.035 * tnoise(t, 17, 8.3);
  const bright =
    flick * (1 - 0.35 * gust) + 0.12 * ease.outCubic(seg(t, 3.9, 4.2)) * (1 - seg(t, 4.2, 5));
  return { x: p.candleX, base: p.candleTop - p.u * 0.012, h: hgt, lean, bright };
}

function drawFlame(c: Ctx2D, f: Flame, theme: Theme, u: number) {
  const tipX = f.x + f.lean * f.h * 0.55;
  const tipY = f.base - f.h;
  const wid = f.h * 0.23;
  const shape = (scale: number, lift: number) => {
    const b = f.base - lift;
    const hh = f.h * scale;
    const ww = wid * scale;
    const tx = f.x + (tipX - f.x) * scale;
    const ty = b - hh;
    c.beginPath();
    c.moveTo(tx, ty);
    c.bezierCurveTo(
      f.x + ww * 0.45 + (tx - f.x) * 0.35,
      b - hh * 0.55,
      f.x + ww * 1.05,
      b - hh * 0.12,
      f.x,
      b + ww * 0.35,
    );
    c.bezierCurveTo(
      f.x - ww * 1.05,
      b - hh * 0.12,
      f.x - ww * 0.45 + (tx - f.x) * 0.35,
      b - hh * 0.55,
      tx,
      ty,
    );
    c.closePath();
  };
  c.save();
  c.globalCompositeOperation = "lighter";
  // Outer envelope: warm, soft.
  const deep = adjust(theme.accent, -0.08, 1.15, -28);
  const outer = c.createRadialGradient(
    f.x,
    f.base - f.h * 0.3,
    0,
    f.x,
    f.base - f.h * 0.4,
    f.h * 0.85,
  );
  outer.addColorStop(0, rgba(theme.accent, 0.9 * f.bright));
  outer.addColorStop(0.55, rgba(mix(theme.accent, deep, 0.35), 0.55 * f.bright));
  outer.addColorStop(1, rgba(deep, 0));
  c.fillStyle = outer;
  c.filter = `blur(${(u * 0.004).toFixed(1)}px)`;
  shape(1, 0);
  c.fill();
  // Bright core.
  const core = c.createLinearGradient(0, f.base, 0, f.base - f.h * 0.8);
  core.addColorStop(0, rgba(mix(theme.ink, theme.accent, 0.15), 0));
  core.addColorStop(0.2, rgba(mix(theme.ink, theme.accent, 0.1), 0.95 * f.bright));
  core.addColorStop(1, rgba(theme.accent, 0));
  c.fillStyle = core;
  shape(0.62, f.h * 0.04);
  c.fill();
  // Blue at the root.
  c.filter = `blur(${(u * 0.003).toFixed(1)}px)`;
  const blue = c.createRadialGradient(f.x, f.base, 0, f.x, f.base, f.h * 0.22);
  blue.addColorStop(0, rgba(theme.accent2, 0));
  blue.addColorStop(0.55, rgba(theme.accent2, 0.55 * f.bright));
  blue.addColorStop(1, rgba(theme.accent2, 0));
  c.fillStyle = blue;
  c.fillRect(f.x - f.h * 0.25, f.base - f.h * 0.25, f.h * 0.5, f.h * 0.35);
  c.filter = "none";
  c.restore();
  // The wick: a dark curl with a glowing tip.
  c.save();
  c.strokeStyle = rgba(mix(theme.bg, "#000000", 0.4), 1);
  c.lineWidth = Math.max(1, u * 0.004);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(f.x, f.base + u * 0.012);
  c.quadraticCurveTo(
    f.x + u * 0.001,
    f.base - u * 0.006,
    f.x + u * 0.006 + f.lean * u * 0.004,
    f.base - u * 0.012,
  );
  c.stroke();
  c.fillStyle = rgba(adjust(theme.accent, -0.05, 1.2, -32), 0.9);
  c.beginPath();
  c.arc(
    f.x + u * 0.006 + f.lean * u * 0.004,
    f.base - u * 0.012,
    Math.max(0.8, u * 0.0028),
    0,
    TAU,
  );
  c.fill();
  c.restore();
}

function drawCandle(c: Ctx2D, p: Plan, f: Flame, theme: Theme) {
  const { candleX: x, candleTop: top, candleW: cw, tableY, u } = p;
  const left = x - cw / 2;
  const wax = mix(mix(theme.ink, theme.accent, 0.22), theme.bg, 0.18);
  // Body: lit from above, warm translucent glow near the rim fading down.
  const body = c.createLinearGradient(0, top, 0, tableY);
  body.addColorStop(0, rgba(mix(wax, theme.accent, 0.4), 1));
  body.addColorStop(0.12, rgba(mix(mix(wax, theme.accent, 0.3), theme.bg, 0.3), 1));
  body.addColorStop(0.4, rgba(mix(wax, theme.bg, 0.62), 1));
  body.addColorStop(1, rgba(mix(wax, theme.bg, 0.9), 1));
  c.save();
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(left, top);
  c.lineTo(left, tableY);
  c.ellipse(x, tableY, cw / 2, cw * 0.09, 0, Math.PI, 0, true);
  c.lineTo(left + cw, top);
  c.closePath();
  c.fill();
  // Rounded shading across the cylinder.
  const across = c.createLinearGradient(left, 0, left + cw, 0);
  across.addColorStop(0, "rgba(0,0,0,0.7)");
  across.addColorStop(0.3, "rgba(0,0,0,0.1)");
  across.addColorStop(0.55, "rgba(0,0,0,0.05)");
  across.addColorStop(1, "rgba(0,0,0,0.75)");
  c.fillStyle = across;
  c.fill();
  // Subsurface glow: the wax near the flame lets light through.
  c.globalCompositeOperation = "lighter";
  const sss = c.createRadialGradient(x, top, 0, x, top + cw * 0.2, cw * 0.9);
  sss.addColorStop(0, rgba(theme.accent, 0.42 * f.bright));
  sss.addColorStop(1, rgba(theme.accent, 0));
  c.fillStyle = sss;
  c.fill();
  c.globalCompositeOperation = "source-over";
  // The melted top: a pool of wax with a lit rim.
  c.fillStyle = rgba(mix(wax, theme.accent, 0.45), 1);
  c.beginPath();
  c.ellipse(x, top, cw / 2, cw * 0.09, 0, 0, TAU);
  c.fill();
  c.fillStyle = rgba(mix(mix(wax, theme.accent, 0.6), theme.ink, 0.25 * f.bright), 1);
  c.beginPath();
  c.ellipse(x, top + cw * 0.005, cw * 0.42, cw * 0.065, 0, 0, TAU);
  c.fill();
  c.strokeStyle = rgba(mix(theme.ink, theme.accent, 0.3), 0.6 * f.bright);
  c.lineWidth = Math.max(1, u * 0.002);
  c.beginPath();
  c.ellipse(x, top, cw / 2, cw * 0.09, 0, Math.PI * 1.05, Math.PI * 1.95);
  c.stroke();
  c.restore();
  // A soft reflection of the flame on the table.
  c.save();
  c.globalCompositeOperation = "lighter";
  c.translate(x + f.lean * u * 0.02, tableY + u * 0.02);
  c.scale(1, 0.18);
  const refl = c.createRadialGradient(0, 0, 0, 0, 0, cw * 1.6);
  refl.addColorStop(0, rgba(theme.accent, 0.16 * f.bright));
  refl.addColorStop(1, rgba(theme.accent, 0));
  c.fillStyle = refl;
  c.fillRect(-cw * 1.6, -cw * 1.6, cw * 3.2, cw * 3.2);
  c.restore();
}

export const style: MotionStyle = {
  id: "candlelight",
  name: "Candlelight",
  family: "Light & Material",
  tagline: "One candle, a word in plaster",
  look: "One candle in a dark room: a living flame, warm light raking across a word raised in plaster, deep shadow beyond.",
  move: "The flame breathes and sways; the light and the letters' shadows swing with it, a gust bows it low, then it steadies.",
  rules: [
    "The flame is the only light: everything else is lit by it and falls off with distance.",
    "Letters are raised plaster, visible by their lit edges and cast shadows, not by colour.",
    "Each letter is lit from its own angle to the flame, so the shadows fan out.",
    "Flicker is layered noise, never a regular pulse; one gust makes it gutter once.",
    "The flame has a blue root, a white core and an amber envelope; the wick glows at its tip.",
    "The wax glows through near the flame and falls to shadow at its foot.",
  ],
  prompt: `R — References
• Chiaroscuro still lifes by candlelight (search: Georges de La Tour candle, candlelit still life photography).
• Macro footage of a candle flame flickering, with a gust.

I — Idea
One candle lights one word, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a candle burns on a table in a dark room; above it "{{name}}" stands raised in the plaster wall, lit from below.
• Middle (1.5–3.5 s): the flame breathes and sways; the lit edges and shadows of each letter swing with it; a gust bows the flame low and the room dims.
• End (3.5–5 s): the flame recovers, flares once and settles back into its opening shape.

S — Style
Looks: {{bg}} room; plaster wall and wooden table lit only by the flame, falling off to black; the word in {{font}}, raised in plaster, with {{ink}} edge light; the flame {{accent}} with a white core and a {{accent2}} root; cream wax.
Moves: flicker from layered noise; sway and height from noise; one gust at ~3 s; letter shadows follow the flame position.
Rules:
1. Single light source; inverse falloff; deep blacks.
2. Raised letters shown by edge light and cast shadow.
3. Per-letter light direction from the flame.
4. Layered-noise flicker, one gust.
5. Wax subsurface glow near the flame; grain and vignette.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the letters read as raised plaster lit from below; shadows move with the flame; the gust frame is visibly dimmer; the flame has a core, a root and a soft edge. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Chiaroscuro",
  theme: {
    bg: "#0b0806",
    ink: "#f7ead7",
    accent: "#ffae45",
    accent2: "#4f7dff",
    font: FAMILY,
  },
  fonts: ["Cormorant Garamond:wght@400..700"],
  tags: [
    "candle",
    "flame",
    "fire",
    "warm",
    "dark",
    "cozy",
    "chiaroscuro",
    "light",
    "serif",
    "moody",
    "flicker",
  ],
  word: "Midnight",
  render(ctx, t, theme, w, h) {
    const p = plan(ctx, theme, w, h);
    const u = p.u;
    const f = flameAt(t, p);
    const key = `${theme.bg}${theme.ink}${theme.accent}|${p.word}|${p.family}`;
    const albedo = bake(`candle-wall:${key}`, w, h, wall(theme, p));
    const shadow = bake(`candle-shadow:${p.word}|${p.family}`, w, h, shade(p));

    // Albedo for this frame: the wall plus each letter's lit edge and cast shadow.
    const { canvas: ac, ctx: A } = buffer("candle-albedo", w, h);
    A.globalCompositeOperation = "source-over";
    A.globalAlpha = 1;
    A.drawImage(albedo as CanvasImageSource, 0, 0);
    const fx = f.x + f.lean * f.h * 0.3;
    const fy = f.base - f.h * 0.45;
    // Shadows fall away from the flame; the whole word shares one soft shadow.
    const sdx = p.candleX - fx;
    const sdy = p.wordCy - fy;
    const sl = Math.hypot(sdx, sdy) || 1;
    A.save();
    A.globalAlpha = 0.85;
    A.drawImage(shadow as CanvasImageSource, (sdx / sl) * u * 0.02, (sdy / sl) * u * 0.02);
    A.restore();
    A.save();
    A.font = fontOf("", 600, p.size, p.family, SERIF_FALLBACK);
    A.fillStyle = rgba(mix(theme.bg, theme.ink, 0.62), 1);
    for (const L of p.letters) A.fillText(L.ch, L.x, p.wy);
    // Lit lower edges: each letter offset toward its own direction to the flame.
    A.globalCompositeOperation = "lighter";
    A.fillStyle = rgba(theme.ink, 0.5);
    for (const L of p.letters) {
      const dx = fx - L.cx;
      const dy = fy - p.wordCy;
      const l = Math.hypot(dx, dy) || 1;
      A.fillText(L.ch, L.x + (dx / l) * u * 0.0028, p.wy + (dy / l) * u * 0.0028);
    }
    A.globalCompositeOperation = "source-over";
    A.fillStyle = rgba(mix(theme.bg, theme.ink, 0.55), 1);
    for (const L of p.letters) {
      const dx = fx - L.cx;
      const dy = fy - p.wordCy;
      const l = Math.hypot(dx, dy) || 1;
      A.fillText(L.ch, L.x - (dx / l) * u * 0.0012, p.wy - (dy / l) * u * 0.0012);
    }
    A.restore();

    // Light: a warm pool centred on the flame, times the albedo.
    const { canvas: lc, ctx: L } = buffer("candle-light", w, h);
    L.save();
    L.globalCompositeOperation = "source-over";
    L.globalAlpha = 1;
    L.fillStyle = mix(theme.bg, "#000000", 0.2);
    L.fillRect(0, 0, w, h);
    L.globalCompositeOperation = "lighter";
    const reach = Math.max(w, h) * 0.62 * (0.92 + 0.08 * f.bright);
    const g = L.createRadialGradient(fx, fy, 0, fx, fy, reach);
    const warm = mix(theme.accent, theme.ink, 0.35);
    g.addColorStop(0, rgba(warm, clamp(f.bright)));
    g.addColorStop(0.12, rgba(warm, 0.85 * clamp(f.bright)));
    g.addColorStop(0.35, rgba(theme.accent, 0.42 * f.bright));
    g.addColorStop(0.65, rgba(theme.accent, 0.12 * f.bright));
    g.addColorStop(1, rgba(theme.accent, 0));
    L.fillStyle = g;
    L.fillRect(0, 0, w, h);
    L.globalCompositeOperation = "multiply";
    L.drawImage(ac as CanvasImageSource, 0, 0);
    L.restore();
    ctx.drawImage(lc as CanvasImageSource, 0, 0);

    drawCandle(ctx, p, f, theme);
    // Halo around the flame.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, u * 0.3);
    halo.addColorStop(0, rgba(theme.accent, 0.3 * f.bright));
    halo.addColorStop(0.3, rgba(theme.accent, 0.08 * f.bright));
    halo.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(fx - u * 0.3, fy - u * 0.3, u * 0.6, u * 0.6);
    ctx.restore();
    drawFlame(ctx, f, theme, u);

    const mark = tintedLogo(theme, rgba(mix(theme.bg, theme.ink, 0.3), 1), u * 0.05, u * 0.05);
    if (mark)
      ctx.drawImage(mark as CanvasImageSource, p.candleX - u * 0.025, p.candleTop + u * 0.09);

    vignette(ctx, w, h, "#000000", 0.6);
    grain(ctx, w, h, t, 0.3);
  },
};
