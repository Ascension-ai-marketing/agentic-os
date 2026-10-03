import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  fitSize,
  font,
  frameOf,
  grain,
  ground,
  hash,
  LOOP,
  rng,
  SANS,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, bokeh, cyc, glow, pnoise, vgrad } from "./_s7-helpers";

const RUNNERS = 8;

/** The city behind the glass: bokeh lights, street glow and a neon word, all out of focus. */
function city(theme: Theme, word: string, mark: AnyCanvas | null = null) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u, portrait } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    vgrad(c, 0, 0, w, h, [
      [0, "#000000", 0.4],
      [0.55, mix(theme.bg, theme.accent2, 0.12), 0.9],
      [1, mix(theme.bg, theme.accent2, 0.3), 1],
    ]);
    const warm = mix(mix(theme.accent, theme.accent2, 0.35), theme.ink, 0.4);
    const cols = [theme.accent, theme.accent2, warm, mix(theme.ink, warm, 0.35)];
    const r = rng(2024);
    c.globalCompositeOperation = "lighter";
    // Street lights: many, low in the frame; windows: fewer, higher.
    for (let i = 0; i < 70; i++) {
      const low = i < 52;
      const x = r() * w;
      const y = low ? h * (0.5 + r() * 0.5) : h * (0.05 + r() * 0.4);
      const d = u * (low ? 0.04 + r() * r() * 0.16 : 0.02 + r() * 0.05);
      const col = cols[Math.floor(r() * cols.length)];
      blit(c, bokeh(col, 0.4, 0.14), x, y, d, 0.18 + r() * 0.5);
      if (low && r() < 0.35) {
        // Its reflection streaks down the wet street.
        c.globalAlpha = 0.1 + r() * 0.12;
        c.drawImage(glow(col, 0.25) as CanvasImageSource, x - d * 0.18, y, d * 0.36, d * 3.4);
      }
    }
    c.globalAlpha = 1;
    // The neon word, softened by the distance and the wet glass.
    const size = fitSize(
      c,
      word,
      w * (portrait ? 0.8 : 0.56),
      u * (portrait ? 0.2 : 0.24),
      400,
      theme.font,
      SANS,
    );
    const y = h * (portrait ? 0.34 : 0.38) + (mark ? size * 0.42 : 0);
    c.font = font(400, size, theme.font, SANS);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.filter = `blur(${Math.max(0.5, u * 0.0035).toFixed(1)}px)`;
    c.shadowColor = rgba(theme.accent, 0.95);
    c.shadowBlur = size * 0.5;
    c.strokeStyle = rgba(theme.accent, 0.9);
    c.lineWidth = size * 0.07;
    c.strokeText(word, w / 2, y);
    c.shadowBlur = size * 0.15;
    c.fillStyle = rgba(mix(theme.accent, theme.ink, 0.5), 1);
    c.fillText(word, w / 2, y);
    c.shadowBlur = 0;
    c.filter = "none";
    blit(c, glow(theme.accent, 0.2), w / 2, y, size * 4.2, 0.18);
    c.globalAlpha = 1;
    if (mark) {
      const m = size * 0.72;
      c.filter = `blur(${Math.max(0.5, u * 0.0035).toFixed(1)}px)`;
      c.shadowColor = rgba(theme.accent, 0.95);
      c.shadowBlur = m * 0.35;
      c.drawImage(mark as CanvasImageSource, w / 2 - m / 2, y - size * 0.62 - m, m, m);
      c.shadowBlur = 0;
      c.filter = "none";
    }
    c.globalCompositeOperation = "source-over";
  };
}

/** Draw a drop: the city seen through it upside down and minified, a dark rim, a highlight. */
function drop(
  ctx: Ctx2D,
  bg: AnyCanvas,
  x: number,
  y: number,
  rx: number,
  ry: number,
  w: number,
  h: number,
  theme: Theme,
) {
  ctx.save();
  ctx.beginPath();
  // Teardrop: fuller at the bottom.
  ctx.moveTo(x, y - ry * 1.08);
  ctx.bezierCurveTo(x + rx * 0.75, y - ry * 0.95, x + rx * 1.05, y + ry * 0.25, x, y + ry);
  ctx.bezierCurveTo(x - rx * 1.05, y + ry * 0.25, x - rx * 0.75, y - ry * 0.95, x, y - ry * 1.08);
  ctx.closePath();
  ctx.clip();
  const view = Math.max(rx, ry) * 5;
  const sx = clamp(x - view, 0, w - view * 2);
  const sy = clamp(y - view, 0, h - view * 2);
  ctx.translate(x, y);
  ctx.scale(1.15, -1.15);
  ctx.drawImage(bg as CanvasImageSource, sx, sy, view * 2, view * 2, -rx, -ry, rx * 2, ry * 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rim = ctx.createRadialGradient(
    x - rx * 0.2,
    y - ry * 0.3,
    Math.min(rx, ry) * 0.2,
    x,
    y,
    Math.max(rx, ry) * 1.1,
  );
  rim.addColorStop(0, rgba("#000000", 0));
  rim.addColorStop(0.72, rgba("#000000", 0.08));
  rim.addColorStop(1, rgba("#000000", 0.5));
  ctx.fillStyle = rim;
  ctx.fillRect(x - rx * 1.2, y - ry * 1.2, rx * 2.4, ry * 2.4);
  ctx.restore();
  // Specular highlight and a caustic at the foot.
  ctx.fillStyle = rgba(theme.ink, 0.85);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.3, y - ry * 0.42, rx * 0.24, ry * 0.14, -0.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(theme.ink, 0.18);
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.1, y + ry * 0.62, rx * 0.4, ry * 0.12, 0, 0, TAU);
  ctx.fill();
}

/** Fine mist and a scatter of small beads, each a tiny lens. White mist, refracted beads. */
function glass(theme: Theme, bg: AnyCanvas) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    // Condensation: the city seen through fog is blurrier and paler.
    c.filter = `blur(${Math.max(1, u * 0.009).toFixed(1)}px)`;
    c.drawImage(bg as CanvasImageSource, 0, 0);
    c.filter = "none";
    c.fillStyle = rgba(mix(theme.ink, theme.accent2, 0.3), 0.12);
    c.fillRect(0, 0, w, h);
    const r = rng(99);
    const mist = Math.round((w * h) / 260);
    for (let i = 0; i < mist; i++) {
      c.fillStyle = rgba(theme.ink, 0.03 + r() * 0.08);
      const d = Math.max(0.6, u * (0.001 + r() * 0.0025));
      c.fillRect(r() * w, r() * h, d, d);
    }
    const beads = Math.round((w * h) / (u * u * 0.0026));
    for (let i = 0; i < beads; i++) {
      const rr = u * (0.0025 + r() ** 3 * 0.012);
      drop(c, bg, r() * w, r() * h, rr, rr * (1 + r() * 0.15), w, h, theme);
    }
  };
}

/** Each runner's path down the glass: x as a function of y, fixed for the whole loop. */
function pathX(k: number, y: number, w: number, u: number) {
  return (
    (0.06 + 0.88 * ((k + 0.5 + (hash(k, 1) - 0.5) * 0.6) / RUNNERS)) * w +
    u * 0.035 * pnoise(y / (u * 0.16) + k * 7.1, 64, k)
  );
}

export const style: MotionStyle = {
  id: "rain-on-glass",
  name: "Rain on Glass",
  family: "Nature",
  tagline: "Rain on a window at night",
  look: "A rainy window at night: blurred city bokeh and a soft neon word behind misted glass, every drop a tiny upside-down lens.",
  move: "Drops gather weight, slip, stall and run down the glass in stick-slip bursts, clearing a wet trail that slowly fogs over again.",
  rules: [
    "The city stays out of focus; only the drops are sharp.",
    "Every drop refracts the scene behind it, upside down and minified.",
    "Runners move stick-slip: pause, slide, pause, never at a steady speed.",
    "A runner clears the mist behind it and leaves small beads in its trail.",
    "The neon word glows but stays soft, like it sits across the street.",
    "Two light colours only, plus a pale tint mixed from them.",
  ],
  prompt: `R — References
• Rain on a window at night with city bokeh (search: rain window bokeh night, wet glass macro).
• Wong Kar-wai night palettes: neon through wet glass.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a misted window at night; behind it, out of focus, city lights and a neon sign reading "{{name}}"; still beads cover the glass.
• Middle (1.5–3.5 s): heavy drops break loose and run down in stick-slip bursts, each one a tiny upside-down lens, clearing a wet trail and leaving beads behind.
• End (3.5–5 s): the trails fog over again as new drops start from the top, landing exactly on the first frame.

S — Style
Looks: {{bg}} night; bokeh discs in {{accent}}, {{accent2}} and a pale tint mixed from them; the word as a soft {{accent}} neon in {{font}}; pale {{ink}} mist and highlights on the glass.
Moves: each runner follows a fixed wiggly path x(y); its height y(p) = p − 0.8·sin(2πnp)/(2πn) gives stall-and-slide; p wraps once per loop and the runner plus its trail leave the frame before it re-enters; the trail erases the mist and fades with distance.
Rules:
1. Background out of focus, drops sharp.
2. Refraction: inverted, minified scene inside every drop.
3. Stick-slip runners.
4. Trails clear the mist and leave beads.
5. Soft neon; two light colours plus a pale tint.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the neon word is readable but soft; drops show the city upside down; no trail appears or vanishes on screen; runners visibly stall and slide. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Bokeh",
  theme: {
    bg: "#06070a",
    ink: "#eaf0f6",
    accent: "#ff4f6d",
    accent2: "#36b5c9",
    font: "Tilt Neon",
  },
  fonts: ["Tilt Neon"],
  tags: [
    "rain",
    "window",
    "glass",
    "drops",
    "night",
    "city",
    "bokeh",
    "neon",
    "moody",
    "cinematic",
    "noir",
  ],
  word: "Open",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const word = wordFor(theme.name, "Open", 12);
    ground(ctx, w, h, theme.bg);
    // A dropped logo hangs in the sign above the word, behind the glass like the rest of the city.
    const mark = tintedLogo(theme, mix(theme.accent, theme.ink, 0.55), u * 0.12, u * 0.12);
    const logoKey = mark && theme.logo ? `L${theme.logo.length}${theme.logo.slice(-24)}` : "";
    const bg = bake(
      `rain-city:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}${theme.font}${word}${logoKey}`,
      w,
      h,
      city(theme, word, mark),
    );
    ctx.drawImage(bg as CanvasImageSource, 0, 0);
    const fogged = bake(
      `rain-glass:${theme.ink}${theme.accent2}${theme.bg}${theme.accent}${theme.font}${word}${logoKey}`,
      w,
      h,
      glass(theme, bg),
    );

    // Runner positions: stick-slip down a fixed wiggly path, one pass per loop.
    const T = u * 0.42;
    const runners = Array.from({ length: RUNNERS }, (_, k) => {
      const p = cyc(t, 1, hash(k, 2));
      const n = 3 + Math.floor(hash(k, 3) * 3);
      const q = p - (0.8 * Math.sin(TAU * n * p)) / (TAU * n);
      const r = u * (0.016 + 0.01 * hash(k, 4));
      const y = -r * 2 + (h + r * 4 + T) * q;
      return { k, y, r, x: pathX(k, y, w, u) };
    });

    // The glass: mist and beads, with each runner's trail wiped clear (it fogs back with distance).
    const { canvas: gb, ctx: G } = buffer("rain-glass-live", w, h);
    G.globalCompositeOperation = "copy";
    G.drawImage(fogged as CanvasImageSource, 0, 0);
    G.globalCompositeOperation = "destination-out";
    G.lineCap = "round";
    for (const rn of runners) {
      const steps = 14;
      for (let s = 0; s < steps; s++) {
        const y0 = rn.y - (T * s) / steps;
        const y1 = rn.y - (T * (s + 1)) / steps;
        G.strokeStyle = `rgba(0,0,0,${(1 - s / steps) ** 1.4})`;
        G.lineWidth = rn.r * (1.5 - (0.7 * s) / steps);
        G.beginPath();
        G.moveTo(pathX(rn.k, y0, w, u), y0);
        G.lineTo(pathX(rn.k, y1, w, u), y1);
        G.stroke();
      }
    }
    G.globalCompositeOperation = "source-over";
    ctx.drawImage(gb as CanvasImageSource, 0, 0);

    // Beads left behind in each trail, fixed to the glass, fading as the trail fogs.
    for (const rn of runners) {
      const spacing = u * 0.05;
      const j0 = Math.floor((rn.y - T) / spacing);
      for (let j = j0; j <= Math.floor(rn.y / spacing); j++) {
        const yb = (j + hash(rn.k, j, 5)) * spacing;
        if (yb > rn.y - rn.r * 2 || yb < rn.y - T || hash(rn.k, j, 6) < 0.3) continue;
        const fade = 1 - (rn.y - yb) / T;
        const rb = rn.r * (0.25 + 0.3 * hash(rn.k, j, 7)) * (0.5 + 0.5 * fade);
        const xb = pathX(rn.k, yb, w, u) + (hash(rn.k, j, 8) - 0.5) * rn.r;
        ctx.save();
        ctx.globalAlpha = Math.min(1, fade * 1.6);
        drop(ctx, bg, xb, yb, rb, rb * 1.1, w, h, theme);
        ctx.restore();
      }
    }
    // The runners themselves, stretched a little as they slide.
    for (const rn of runners) {
      if (rn.y < -rn.r * 3 || rn.y > h + rn.r * 3) continue;
      drop(ctx, bg, rn.x, rn.y, rn.r, rn.r * 1.25, w, h, theme);
    }

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
    void LOOP;
  },
};
