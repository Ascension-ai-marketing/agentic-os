import { mix, rgba } from "../engine/color";
import { bake, font, frameOf, LOOP, TAU, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { finish, fitBox, sparklePath } from "./_s3-helpers";

const FAMILY = "Titan One";
const FALLBACK = '"Arial Rounded MT Bold", "Helvetica Neue", sans-serif';

/** A bubble: home (fractions of the frame), size (u), orbit, kind (0 soap film, 1 candy gel), colour slot. */
type Bubble = {
  x: number;
  y: number;
  r: number;
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  ph: number;
  kind: 0 | 1;
  col: number;
};
const BUBBLES: Bubble[] = [
  { x: 0.24, y: 0.3, r: 0.2, ax: 0.03, ay: 0.04, fx: 1, fy: 1, ph: 0.1, kind: 0, col: 0 },
  { x: 0.8, y: 0.66, r: 0.16, ax: 0.03, ay: 0.03, fx: 1, fy: 2, ph: 0.6, kind: 1, col: 0 },
  { x: 0.78, y: 0.22, r: 0.09, ax: 0.025, ay: 0.03, fx: 2, fy: 1, ph: 0.3, kind: 1, col: 1 },
  { x: 0.13, y: 0.76, r: 0.11, ax: 0.02, ay: 0.03, fx: 1, fy: 1, ph: 0.8, kind: 1, col: 2 },
  { x: 0.62, y: 0.86, r: 0.07, ax: 0.03, ay: 0.02, fx: 2, fy: 1, ph: 0.45, kind: 0, col: 1 },
  { x: 0.93, y: 0.44, r: 0.06, ax: 0.02, ay: 0.03, fx: 1, fy: 2, ph: 0.15, kind: 0, col: 2 },
  { x: 0.4, y: 0.12, r: 0.05, ax: 0.02, ay: 0.02, fx: 1, fy: 1, ph: 0.7, kind: 1, col: 0 },
  { x: 0.05, y: 0.45, r: 0.045, ax: 0.015, ay: 0.03, fx: 2, fy: 1, ph: 0.9, kind: 0, col: 0 },
];

const SPARKS: [number, number, number, number][] = [
  // x, y, size (u), phase
  [0.68, 0.28, 0.06, 0.0],
  [0.31, 0.68, 0.045, 0.35],
  [0.87, 0.38, 0.035, 0.6],
  [0.15, 0.16, 0.04, 0.8],
  [0.53, 0.16, 0.03, 0.2],
  [0.9, 0.86, 0.035, 0.5],
  [0.46, 0.82, 0.028, 0.7],
  [0.06, 0.6, 0.028, 0.1],
];

function colours(theme: Theme) {
  return [theme.accent, theme.accent2, mix(theme.accent, theme.accent2, 0.5)];
}

/** Soap film: clear body, iridescent rim, window highlight. */
function soap(c: Ctx2D, x: number, y: number, r: number, spin: number, theme: Theme, tint: string) {
  const body = c.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
  body.addColorStop(0, rgba(tint, 0.04));
  body.addColorStop(0.72, rgba(tint, 0.1));
  body.addColorStop(0.93, rgba(tint, 0.42));
  body.addColorStop(1, rgba(theme.ink, 0.65));
  c.fillStyle = body;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  // Iridescent rim: the hues slide round the edge.
  if (typeof c.createConicGradient === "function") {
    const cone = c.createConicGradient(spin, x, y);
    cone.addColorStop(0, rgba(theme.accent, 0.55));
    cone.addColorStop(0.33, rgba(theme.accent2, 0.55));
    cone.addColorStop(0.66, rgba(mix(theme.accent, theme.ink, 0.5), 0.5));
    cone.addColorStop(1, rgba(theme.accent, 0.55));
    c.strokeStyle = cone;
    c.lineWidth = r * 0.07;
    c.beginPath();
    c.arc(x, y, r * 0.95, 0, TAU);
    c.stroke();
  }
  highlight(c, x, y, r, theme.ink, 0.85);
}

/** Candy gel: saturated body, deep edge, bright top lobe. */
function candy(c: Ctx2D, x: number, y: number, r: number, theme: Theme, col: string) {
  const body = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r * 1.02);
  body.addColorStop(0, mix(col, theme.ink, 0.55));
  body.addColorStop(0.45, col);
  body.addColorStop(1, mix(col, theme.bg, 0.55));
  c.fillStyle = body;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  // Bounce light on the lower edge.
  const bounce = c.createRadialGradient(
    x + r * 0.2,
    y + r * 0.75,
    0,
    x + r * 0.2,
    y + r * 0.75,
    r * 0.6,
  );
  bounce.addColorStop(0, rgba(mix(col, theme.ink, 0.35), 0.55));
  bounce.addColorStop(1, rgba(col, 0));
  c.fillStyle = bounce;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  highlight(c, x, y, r, theme.ink, 1);
}

function highlight(c: Ctx2D, x: number, y: number, r: number, ink: string, a: number) {
  // The window: a soft oval up and to the left, plus a small hard glint.
  c.save();
  c.translate(x - r * 0.36, y - r * 0.42);
  c.rotate(-0.6);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.4);
  g.addColorStop(0, rgba(ink, 0.9 * a));
  g.addColorStop(0.55, rgba(ink, 0.35 * a));
  g.addColorStop(1, rgba(ink, 0));
  c.fillStyle = g;
  c.scale(1, 0.55);
  c.beginPath();
  c.arc(0, 0, r * 0.4, 0, TAU);
  c.fill();
  c.restore();
  c.fillStyle = rgba(ink, 0.95 * a);
  c.beginPath();
  c.arc(x + r * 0.42, y + r * 0.38, r * 0.06, 0, TAU);
  c.fill();
}

/** Gel lettering, baked once: soft glow, white sticker outline, candy gradient, a hard-edged gloss band. */
function gelWord(theme: Theme, word: string, size: number, wt: number) {
  return (c: Ctx2D, w: number, h: number) => {
    c.font = font(wt, size, theme.font, FALLBACK);
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.lineJoin = "round";
    const x = w / 2;
    const y = h * 0.68;
    const top = y - size * 0.74;
    // Coloured drop shadow and a faint glow.
    c.save();
    c.shadowColor = rgba(theme.accent, 0.55);
    c.shadowBlur = size * 0.22;
    c.fillStyle = mix(theme.accent2, theme.bg, 0.35);
    c.lineWidth = size * 0.2;
    c.strokeStyle = mix(theme.accent2, theme.bg, 0.35);
    c.strokeText(word, x + size * 0.04, y + size * 0.07);
    c.restore();
    // White sticker outline.
    c.strokeStyle = theme.ink;
    c.lineWidth = size * 0.16;
    c.strokeText(word, x, y);
    // Candy body.
    const g = c.createLinearGradient(0, top, 0, y + size * 0.04);
    g.addColorStop(0, mix(theme.accent, theme.ink, 0.35));
    g.addColorStop(0.45, theme.accent);
    g.addColorStop(1, mix(theme.accent, theme.accent2, 0.55));
    c.fillStyle = g;
    c.fillText(word, x, y);
    // Gloss band over the upper 45% of every letter, with a crisp lower edge.
    c.save();
    c.globalCompositeOperation = "source-atop";
    const band = size * 0.34;
    const gloss = c.createLinearGradient(0, top, 0, top + band);
    gloss.addColorStop(0, rgba(theme.ink, 0.8));
    gloss.addColorStop(1, rgba(theme.ink, 0.18));
    c.fillStyle = gloss;
    c.beginPath();
    c.moveTo(0, top - size * 0.2);
    c.lineTo(w, top - size * 0.2);
    c.lineTo(w, top + band);
    c.quadraticCurveTo(w / 2, top + band * 1.25, 0, top + band);
    c.closePath();
    c.fill();
    // Bounce light along the bottom.
    const low = c.createLinearGradient(0, y - size * 0.2, 0, y);
    low.addColorStop(0, rgba(theme.accent2, 0));
    low.addColorStop(1, rgba(theme.accent2, 0.45));
    c.fillStyle = low;
    c.fillRect(0, y - size * 0.2, w, size * 0.25);
    c.restore();
  };
}

export const style: MotionStyle = {
  id: "y2k-bubble",
  name: "Y2K Bubble",
  family: "Design Movements",
  tagline: "Candy gel and soap bubbles",
  look: "Millennium gloss: candy gel spheres and soap bubbles in pink and ice aqua, sticker gel lettering, four-point sparkles.",
  move: "Bubbles drift on slow orbits and wobble, iridescent rims turn, the word bobs, sparkles twinkle in turn; nothing snaps.",
  rules: [
    "Two kinds of bubble: clear soap film with an iridescent rim, and saturated candy gel.",
    "One light source, top left: every highlight sits in the same place.",
    "The gel word has a deep outline, a candy gradient and a glossy top band.",
    "Sparkles are four-point stars with concave sides, twinkling one at a time.",
    "Every path is a whole number of slow orbits per loop; no snaps.",
    "Soft gradient glows in the ground, never hard edges behind the bubbles.",
  ],
  prompt: `R — References
• Y2K design, around 2000: Aqua interface gel, iMac candy plastic, bubble lettering (search: Y2K aesthetic bubble, aqua gel button, 2000s sparkle graphics).
• Soap-bubble iridescence photography for the rims.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): glossy candy spheres and clear soap bubbles drift around the gel word "{{name}}" over soft pink and aqua light.
• Middle (1.5–3.5 s): the bubbles wobble past each other on slow orbits, their iridescent rims turning; sparkles twinkle one after another; the word bobs.
• End (3.5–5 s): every bubble completes its orbit and lands exactly where it began.

S — Style
Looks: {{bg}} ground with soft {{accent}} and {{accent2}} glows; candy spheres in {{accent}}, {{accent2}} and a lilac between; soap films with {{ink}} window highlights; gel lettering in {{font}} (or Titan One) with a deep outline and a glossy band.
Moves: bubbles on whole-number Lissajous orbits with a small squash wobble; rims turn once per loop; sparkles scale in and out with a quarter turn; the word bobs on a slow sine.
Rules:
1. Soap films and candy gels, both glossy.
2. One light, top left, for every highlight.
3. Gel lettering with a glossy band.
4. Concave four-point sparkles.
5. Whole orbits per loop; no snaps.
6. Soft glows, grain, no flat fills.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; highlights all agree on one light; the word never hides behind a bubble; the soap films read as clear, the candies as solid; nothing looks flat. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Y2K_aesthetic",
  theme: {
    bg: "#0e0a1f",
    ink: "#f8f4ff",
    accent: "#ff6fd2",
    accent2: "#62dcff",
    font: FAMILY,
  },
  fonts: ["Titan One"],
  tags: [
    "y2k",
    "2000s",
    "bubble",
    "glossy",
    "gel",
    "sparkle",
    "iridescent",
    "candy",
    "pastel",
    "aqua",
    "cute",
    "design movement",
  ],
  word: "Bubble",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    const ph = TAU * (t / LOOP);

    // Soft gradient light drifting behind everything.
    const glow = (x: number, y: number, r: number, col: string, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(0.5, rgba(col, a * 0.4));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    glow(
      w * (0.3 + 0.05 * Math.cos(ph)),
      h * (0.35 + 0.05 * Math.sin(ph)),
      u * 0.9,
      theme.accent,
      0.22,
    );
    glow(
      w * (0.72 + 0.05 * Math.sin(ph)),
      h * (0.65 + 0.05 * Math.cos(ph)),
      u * 0.85,
      theme.accent2,
      0.2,
    );
    glow(w * 0.5, h * 0.5, u * 0.5, mix(theme.accent, theme.accent2, 0.5), 0.12);

    const cols = colours(theme);
    const place = (b: Bubble) => {
      const bx = portrait ? b.y : b.x;
      const by = portrait ? 1 - b.x : b.y;
      return {
        x: w * bx + Math.sin(TAU * b.fx * (t / LOOP) + b.ph * TAU) * b.ax * u,
        y: h * by + Math.sin(TAU * b.fy * (t / LOOP) + b.ph * TAU + 1.3) * b.ay * u,
        r: b.r * u * (portrait ? 1.1 : 1),
      };
    };
    const drawBubble = (b: Bubble) => {
      const p = place(b);
      const wob = 0.035 * Math.sin(2 * ph + b.ph * TAU);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1 + wob, 1 - wob);
      if (b.kind === 0) soap(ctx, 0, 0, p.r, ph + b.ph * TAU, theme, cols[b.col]);
      else candy(ctx, 0, 0, p.r, theme, cols[b.col]);
      ctx.restore();
    };
    // Big bubbles behind the word, small ones in front.
    for (const b of BUBBLES) if (b.r >= 0.1) drawBubble(b);

    // The gel word, bobbing.
    const word = wordFor(theme.name, "Bubble", 12);
    const wt = theme.font === FAMILY ? 400 : 900;
    const size = fitBox(
      ctx,
      word,
      w * (portrait ? 0.8 : 0.6),
      h * (portrait ? 0.14 : 0.24),
      wt,
      theme.font,
      FALLBACK,
      0.72,
    );
    ctx.font = font(wt, size, theme.font, FALLBACK);
    const tw = ctx.measureText(word).width;
    const LW = Math.ceil(tw + size * 1.2);
    const LH = Math.ceil(size * 1.7);
    const layer = bake(
      `y2k-word:${theme.font}${theme.accent}${theme.accent2}${theme.ink}${theme.bg}|${word}|${Math.round(size)}|${wt}`,
      LW,
      LH,
      gelWord(theme, word, size, wt),
    );
    const bob = Math.sin(ph) * u * 0.015;
    ctx.save();
    ctx.translate(w / 2, h * 0.5 + bob);
    ctx.rotate(Math.sin(ph + 0.8) * 0.02);
    ctx.drawImage(layer as CanvasImageSource, -LW / 2, -LH * 0.68 + size * 0.36);
    ctx.restore();

    for (const b of BUBBLES) if (b.r < 0.1) drawBubble(b);

    // Sparkles, one after another.
    for (const [sx, sy, ss, sp] of SPARKS) {
      const x = w * (portrait ? sy : sx);
      const y = h * (portrait ? 1 - sx : sy);
      const k = Math.pow(Math.max(0, Math.sin(TAU * (t / LOOP + sp))), 3);
      if (k < 0.02) continue;
      const r = ss * u * (0.4 + k * 0.8);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
      g.addColorStop(0, rgba(theme.ink, 0.45 * k));
      g.addColorStop(1, rgba(theme.accent2, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 1.8, y - r * 1.8, r * 3.6, r * 3.6);
      ctx.fillStyle = rgba(theme.ink, Math.min(1, 0.3 + k));
      sparklePath(ctx, x, y, r, (Math.PI / 4) * k * 0.5, 0.14);
      ctx.fill();
    }

    const mark = tintedLogo(theme, theme.ink, u * 0.07, u * 0.07);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w / 2 - u * 0.035, h * 0.5 + size * 0.55);

    finish(ctx, w, h, t, 0.45, 0.22);
  },
};
