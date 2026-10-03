import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  context,
  fbm3,
  font,
  fract,
  frameOf,
  grain,
  ground,
  hash,
  LOOP,
  makeCanvas,
  rng,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

const FPS = 12;
const DISPLAY = '"Anton", "Impact", "Arial Narrow", sans-serif';

const dropouts: AnyCanvas[] = [];
/** Ink dropout speckles: where the drum missed. Three tiles, picked per printed frame. */
function dropout(i: number): AnyCanvas {
  if (dropouts[i]) return dropouts[i];
  const size = 256;
  const c = makeCanvas(size, size);
  const g = context(c);
  const r = rng(700 + i * 31);
  for (let k = 0; k < 2400; k++) {
    g.fillStyle = `rgba(0,0,0,${(0.25 + r() * 0.6).toFixed(3)})`;
    const s = 0.6 + r() * r() * 1.8;
    g.beginPath();
    g.arc(r() * size, r() * size, s, 0, TAU);
    g.fill();
  }
  dropouts[i] = c;
  return c;
}

/** Large, soft variation in ink density across the sheet. */
function density(c: Ctx2D, w: number, h: number) {
  const { u } = frameOf(w, h);
  const step = Math.max(4, Math.round(u / 60));
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const n = fbm3(x / (u * 0.25), y / (u * 0.25), 4.4, 3);
      c.fillStyle = `rgba(0,0,0,${Math.max(0, 0.08 + n * 0.35).toFixed(3)})`;
      c.fillRect(x, y, step, step);
    }
}

function stock(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const r = rng(12);
    for (let i = 0; i < (w * h) / 500; i++) {
      c.fillStyle = rgba(theme.ink, 0.015 + r() * 0.04);
      c.fillRect(r() * w, r() * h, u * 0.0016, u * 0.0016);
    }
  };
}

/** Apply dropout + density to an ink layer so it prints, not paints. */
function print(layer: Ctx2D, w: number, h: number, frame: number, u: number) {
  layer.save();
  layer.globalCompositeOperation = "destination-out";
  const tile = dropout(frame % 3);
  const pat = layer.createPattern(tile as CanvasImageSource, "repeat");
  if (pat) {
    const k = Math.max(0.6, u / 800);
    if (typeof DOMMatrix !== "undefined")
      pat.setTransform(
        new DOMMatrix()
          .translateSelf(hash(frame, 3) * 256 * k, hash(frame, 5) * 256 * k)
          .scaleSelf(k),
      );
    layer.globalAlpha = 0.7;
    layer.fillStyle = pat;
    layer.fillRect(0, 0, w, h);
  }
  layer.globalAlpha = 1;
  layer.drawImage(bake("riso-density", w, h, density) as CanvasImageSource, 0, 0);
  layer.restore();
}

function registration(c: Ctx2D, x: number, y: number, r: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = Math.max(1, r * 0.12);
  c.beginPath();
  c.arc(x, y, r * 0.55, 0, TAU);
  c.moveTo(x - r, y);
  c.lineTo(x + r, y);
  c.moveTo(x, y - r);
  c.lineTo(x, y + r);
  c.stroke();
}

function marquee(
  c: Ctx2D,
  text: string,
  y: number,
  size: number,
  w: number,
  offset: number,
  color: string,
) {
  c.font = font(400, size, "Anton", DISPLAY);
  c.textBaseline = "alphabetic";
  const tw = c.measureText(text).width;
  const gap = size * 0.55;
  const unit = tw + gap;
  const start = -unit + (((offset % unit) + unit) % unit);
  c.fillStyle = color;
  for (let x = start - unit; x < w + unit; x += unit) {
    c.fillText(text, x, y);
    c.beginPath();
    c.arc(x + tw + gap / 2, y - size * 0.36, size * 0.09, 0, TAU);
    c.fill();
  }
  return unit;
}

export const style: MotionStyle = {
  id: "risograph",
  name: "Risograph Two-colour",
  look: "Two fluorescent spot inks on black stock: a striped sun, a giant condensed marquee, grain, dropout and misregistration.",
  move: "Printed at 12 frames a second: the sun rises and sets, marquees slide in opposite directions, the plates jitter out of register.",
  rules: [
    "Exactly two inks; overlaps screen into a third colour.",
    "Every ink layer prints: dropout speckles and uneven density.",
    "The two plates sit slightly out of register and jitter per frame.",
    "Animate on twos: 12 printed frames a second, fresh grain each frame.",
    "One huge condensed word, repeated as a marquee.",
    "Registration marks in the corners, in both inks.",
    "Gradients are grain or stripes, never smooth.",
  ],
  prompt: `R — References
• Risograph prints and zines (search: risograph two colour print, fluorescent pink riso).
• Riso stop-motion animations: each frame printed, grain changing frame to frame.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a striped sun sits low in the frame; a giant condensed marquee reading "{{name}}" starts sliding across it.
• Middle (1.5–3.5 s): the sun rises through the marquee; where the inks overlap they screen into a third colour; a small second marquee runs the other way.
• End (3.5–5 s): the sun sets back to where it began and both marquees land exactly one repeat along.

S — Style
Looks: {{bg}} black stock with fibres; ink one {{accent}}, ink two {{accent2}}; Anton (or {{font}}) set huge and condensed; registration marks at the corners.
Moves: everything steps at 12 fps; marquees move exactly one repeat per loop; the plates jitter out of register by a fraction of a percent each printed frame.
Rules:
1. Two inks only, blended with screen on the dark stock.
2. Dropout speckles and uneven density on every ink layer.
3. Misregistration: one plate offset and jittering.
4. 12 fps stepped motion; new grain per frame.
5. Stripes or grain for gradients.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; exactly two inks plus their overlap; the grain is visible at full size; the marquee wraps without a jump; the misregistration is subtle, not broken. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Risograph",
  theme: {
    bg: "#111111",
    ink: "#f1ede4",
    accent: "#ff48b0",
    accent2: "#1f9bd1",
    font: "Anton",
  },
  fonts: ["Anton"],
  tags: [
    "riso",
    "risograph",
    "print",
    "zine",
    "screenprint",
    "grain",
    "poster",
    "retro",
    "fluorescent",
    "two colour",
    "duotone",
  ],
  word: "Print",
  family: "Print & Craft",
  tagline: "Two fluoro inks, off register",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const frame = Math.floor(fract(t / LOOP) * LOOP * FPS + 1e-6);
    const tq = frame / FPS;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(`riso-stock:${theme.bg}${theme.ink}`, w, h, stock(theme)) as CanvasImageSource,
      0,
      0,
    );

    const word = wordFor(theme.name, "Print", 14).toUpperCase();
    const { canvas: aCanvas, ctx: A } = buffer("riso-a", w, h);
    const { canvas: bCanvas, ctx: B } = buffer("riso-b", w, h);
    A.clearRect(0, 0, w, h);
    B.clearRect(0, 0, w, h);

    // Plate B: striped sun that rises and sets, a small counter-marquee, marks.
    const sunR = u * (portrait ? 0.3 : 0.32);
    const sx = portrait ? w * 0.5 : w * 0.62;
    const sy = h * (portrait ? 0.42 : 0.5) + Math.cos(TAU * (tq / LOOP)) * h * 0.09;
    B.fillStyle = "#ffffff";
    B.beginPath();
    B.arc(sx, sy, sunR, 0, TAU);
    B.fill();
    B.save();
    B.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 7; i++) {
      const y = sy + sunR * (0.12 + i * 0.14);
      B.fillRect(sx - sunR, y, sunR * 2, sunR * (0.02 + i * 0.012));
    }
    B.restore();
    // Grain gradient band at the foot of the sheet.
    const r = rng(90);
    B.fillStyle = "#ffffff";
    const bandTop = h * 0.78;
    for (let i = 0; i < (w * h) / 420; i++) {
      const y = bandTop + (h - bandTop) * Math.sqrt(r());
      const x = r() * w;
      if (r() < (y - bandTop) / (h - bandTop)) B.fillRect(x, y, u * 0.004, u * 0.004);
    }
    const small = u * 0.075;
    B.font = font(400, small, "Anton", DISPLAY);
    const smallUnit = B.measureText(word).width + small * 0.55;
    marquee(B, word, h * (portrait ? 0.9 : 0.95), small, w, (tq / LOOP) * smallUnit, "#ffffff");

    // Plate A: the giant marquee through the middle, labels and marks.
    const big = u * (portrait ? 0.3 : 0.42);
    ctx.font = font(400, big, "Anton", DISPLAY);
    const unit = ctx.measureText(word).width + big * 0.55;
    marquee(A, word, h * (portrait ? 0.66 : 0.66), big, w, -(tq / LOOP) * unit, "#ffffff");
    A.font = font(400, u * 0.035, "Anton", DISPLAY);
    A.fillStyle = "#ffffff";
    A.textBaseline = "top";
    // A dropped logo prints on the pink plate in place of the issue number.
    const mark = tintedLogo(theme, "#ffffff", u * 0.1, u * 0.1);
    if (mark) A.drawImage(mark as CanvasImageSource, u * 0.07, u * 0.05);
    else A.fillText("NO. 07", u * 0.07, u * 0.06);
    A.textAlign = "right";
    A.fillText("TWO COLOUR", w - u * 0.07, u * 0.06);
    A.textAlign = "left";
    for (const [x, y] of [
      [u * 0.04, u * 0.04],
      [w - u * 0.04, h - u * 0.04],
    ])
      registration(A, x, y, u * 0.022, "#ffffff");
    for (const [x, y] of [
      [w - u * 0.04, u * 0.04],
      [u * 0.04, h - u * 0.04],
    ])
      registration(B, x, y, u * 0.022, "#ffffff");

    print(A, w, h, frame, u);
    print(B, w, h, frame + 17, u);

    // Tint each plate with its ink, then screen onto the stock, out of register.
    const tint = (layer: Ctx2D, color: string) => {
      layer.save();
      layer.globalCompositeOperation = "source-in";
      layer.fillStyle = color;
      layer.fillRect(0, 0, w, h);
      layer.restore();
    };
    tint(A, theme.accent);
    tint(B, theme.accent2);
    const jx = (hash(frame, 71) - 0.5) * u * 0.006;
    const jy = (hash(frame, 73) - 0.5) * u * 0.006;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(bCanvas as CanvasImageSource, u * 0.004 + jx, -u * 0.003 + jy);
    ctx.drawImage(aCanvas as CanvasImageSource, 0, 0);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.4);
    grain(ctx, w, h, t, 0.34);
    void mix;
  },
};
