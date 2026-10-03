import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  frameOf,
  fract,
  grain,
  ground,
  hash,
  light,
  LOOP,
  rng,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { clean57, dots57, glow, stepFrame, width57 } from "./_s4-helpers";

/** A ">" chevron, 4 wide, 7 tall. */
const CHEVRON = ["1000", "0100", "0010", "0001", "0010", "0100", "1000"];
const CHEV_PERIOD = 8;

interface Board {
  cols: number;
  rows: number;
  pitch: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
  scale: number;
  mainY: number;
  subY: number;
  hold: boolean;
  word: string;
  wordW: number;
}

function boardFor(w: number, h: number, word: string): Board {
  const { portrait, square } = frameOf(w, h);
  const scale = portrait ? 3 : 2;
  const wordW = width57(word) * scale;
  const rows = 1 + 7 + 2 + 7 * scale + 2 + 7 + 1;
  let cols = portrait ? 34 : square ? Math.max(wordW + 8, 62) : Math.max(wordW + 16, 80);
  let hold = !portrait;
  // Very long names scroll through as a ticker instead of pausing.
  if (!portrait && cols > 120) {
    cols = 96;
    hold = false;
  }
  const pitch = Math.min((w * (portrait ? 0.9 : 0.9)) / cols, (h * (portrait ? 0.72 : 0.7)) / rows);
  const bw = cols * pitch;
  const bh = rows * pitch;
  return {
    cols,
    rows,
    pitch,
    bw,
    bh,
    bx: (w - bw) / 2,
    by: (h - bh) / 2,
    scale,
    mainY: 1 + 7 + 2,
    subY: 1 + 7 + 2 + 7 * scale + 2,
    hold,
    word,
    wordW,
  };
}

/** Unlit LEDs, the black panel and the housing: baked once per size. */
function panel(theme: Theme, B: Board) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    const frame = B.pitch * 1.4;
    // Soft shadow of the sign on the wall.
    c.save();
    c.shadowColor = "rgba(0,0,0,0.75)";
    c.shadowBlur = u * 0.05;
    c.shadowOffsetY = u * 0.02;
    c.fillStyle = mix(theme.bg, "#000000", 0.5);
    c.beginPath();
    c.roundRect(B.bx - frame, B.by - frame, B.bw + frame * 2, B.bh + frame * 2, frame * 0.8);
    c.fill();
    c.restore();
    // Housing: dark anodised metal with a lit top edge.
    const metal = c.createLinearGradient(0, B.by - frame, 0, B.by + B.bh + frame);
    metal.addColorStop(0, mix(theme.bg, theme.ink, 0.2));
    metal.addColorStop(0.04, mix(theme.bg, theme.ink, 0.1));
    metal.addColorStop(0.5, mix(theme.bg, "#000000", 0.2));
    metal.addColorStop(1, mix(theme.bg, "#000000", 0.45));
    c.fillStyle = metal;
    c.beginPath();
    c.roundRect(B.bx - frame, B.by - frame, B.bw + frame * 2, B.bh + frame * 2, frame * 0.8);
    c.fill();
    // Screws in the corners.
    for (const [sx, sy] of [
      [B.bx - frame / 2, B.by - frame / 2],
      [B.bx + B.bw + frame / 2, B.by - frame / 2],
      [B.bx - frame / 2, B.by + B.bh + frame / 2],
      [B.bx + B.bw + frame / 2, B.by + B.bh + frame / 2],
    ]) {
      const r = frame * 0.2;
      const sg = c.createRadialGradient(sx - r * 0.3, sy - r * 0.3, 0, sx, sy, r);
      sg.addColorStop(0, mix(theme.bg, theme.ink, 0.35));
      sg.addColorStop(1, mix(theme.bg, "#000000", 0.4));
      c.fillStyle = sg;
      c.beginPath();
      c.arc(sx, sy, r, 0, TAU);
      c.fill();
      c.strokeStyle = mix(theme.bg, "#000000", 0.6);
      c.lineWidth = Math.max(1, r * 0.25);
      c.beginPath();
      c.moveTo(sx - r * 0.6, sy);
      c.lineTo(sx + r * 0.6, sy);
      c.stroke();
    }
    // The black panel.
    c.fillStyle = mix(theme.bg, "#000000", 0.7);
    c.fillRect(B.bx, B.by, B.bw, B.bh);
    // Unlit LEDs: dark lenses with a pin of reflected light.
    const r = B.pitch * 0.36;
    const lens = mix(theme.bg, theme.accent, 0.1);
    const rim = mix(theme.bg, "#000000", 0.2);
    for (let j = 0; j < B.rows; j++)
      for (let i = 0; i < B.cols; i++) {
        const x = B.bx + (i + 0.5) * B.pitch;
        const y = B.by + (j + 0.5) * B.pitch;
        c.fillStyle = rim;
        c.beginPath();
        c.arc(x, y, r * 1.08, 0, TAU);
        c.fill();
        c.fillStyle = lens;
        c.beginPath();
        c.arc(x, y, r * 0.86, 0, TAU);
        c.fill();
        c.fillStyle = rgba(theme.ink, 0.1);
        c.fillRect(x - r * 0.45, y - r * 0.5, Math.max(1, r * 0.3), Math.max(1, r * 0.3));
      }
  };
}

/** Alpha mask of every LED's lit body (with a little unit-to-unit variation), board-sized. */
function ledMask(B: Board, core: boolean) {
  return (c: Ctx2D) => {
    const r = B.pitch * (core ? 0.17 : 0.38);
    const vary = rng(core ? 23 : 17);
    for (let j = 0; j < B.rows; j++)
      for (let i = 0; i < B.cols; i++) {
        const x = (i + 0.5) * B.pitch;
        const y = (j + 0.5) * B.pitch;
        const a = 0.8 + 0.2 * vary();
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${a.toFixed(3)})`);
        g.addColorStop(core ? 0.3 : 0.62, `rgba(0,0,0,${(a * (core ? 0.9 : 0.92)).toFixed(3)})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }
  };
}

export const style: MotionStyle = {
  id: "led-board",
  name: "LED Dot Board",
  family: "Retro Tech",
  tagline: "A sign of real LEDs",
  look: "A sign of real LEDs in a dark metal housing: round lenses, hot centres, spill light on the wall, a big dot-matrix word.",
  move: "The word steps in from the right one column at a time, holds centred, steps out; chevrons crawl underneath, the live dot blinks.",
  rules: [
    "Every light is one round LED on a fixed grid; unlit LEDs stay faintly visible.",
    "Text is a 5×7 dot font, doubled for the headline; nothing between the dots.",
    "Scroll in whole-column steps, like the real controller, never a smooth slide.",
    "Lit LEDs have a hot centre, a coloured body and a halo that spills onto the housing.",
    "Hold the headline centred at least 1.2 s.",
    "Two colours only: the headline in the accent, the chevrons in the second.",
    "Units vary a little in brightness, like a real board.",
  ],
  prompt: `R — References
• LED dot-matrix signs: shop scrollers, station boards, stadium tickers (search: LED dot matrix sign close up, red LED scrolling sign).
• Close-up photography of LED panels: round lenses, hot centres, colour spill on the frame.

I — Idea
One message, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): "{{name}}" steps in from the right edge, one LED column at a time.
• Middle (1.2–3.5 s): it holds centred; a "LIVE" dot blinks top left and chevrons crawl along the bottom line.
• End (3.5–5 s): the word steps out to the left and the board is dark again, ready to repeat.

S — Style
Looks: {{bg}} wall, a dark metal housing with screws, a black panel of round LED lenses; lit LEDs in {{accent}} (headline) and {{accent2}} (chevrons) with near-white centres and a soft halo; small top line in dim {{ink}}.
Moves: whole-column steps at a constant rate; the hold is dead still; the chevrons crawl one period at a time and loop exactly.
Rules:
1. One round LED per grid point; unlit lenses faintly visible.
2. 5×7 font, headline doubled (2×2 LEDs per font pixel).
3. Integer-column scrolling only.
4. Hot centre + coloured body + halo + spill light.
5. Hold the centred word at least 1.2 s.
6. Slight unit-to-unit brightness variation.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word reads at thumbnail size; every lit dot sits exactly on an LED; the glow never smears letters together; the chevrons loop without a jump. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Dot-matrix_display",
  theme: {
    bg: "#0b0807",
    ink: "#fff4ea",
    accent: "#ff3b24",
    accent2: "#ffae1a",
    font: "Inter",
  },
  tags: [
    "led",
    "sign",
    "dot matrix",
    "ticker",
    "scrolling",
    "marquee",
    "billboard",
    "display",
    "board",
    "lights",
    "retro",
    "text",
  ],
  word: "OPEN",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const word = clean57(wordFor(theme.name, "OPEN", 14)).trim() || "OPEN";
    const B = boardFor(w, h, word);
    light(ctx, w * 0.5, B.by + B.bh * 0.5, Math.max(w, h) * 0.8, theme.accent, 0.1);
    ctx.drawImage(
      bake(
        `led-panel:${theme.bg}${theme.ink}${theme.accent}:${B.cols}x${B.rows}`,
        w,
        h,
        panel(theme, B),
      ) as CanvasImageSource,
      0,
      0,
    );

    // The frame buffer: one pixel per LED.
    const { canvas: mC, ctx: m } = buffer("led-m", B.cols, B.rows);
    const img = m.createImageData(B.cols, B.rows);
    const d = img.data;
    const put = (x: number, y: number, rgb: number[], a = 1) => {
      if (x < 0 || y < 0 || x >= B.cols || y >= B.rows) return;
      const o = (y * B.cols + x) * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = Math.round(255 * a);
    };
    const main = parse(theme.accent);
    const chev = parse(theme.accent2);
    const dim = parse(mix(theme.ink, theme.accent2, 0.35));

    // Headline: step in, hold centred, step out (or a steady ticker when it cannot fit).
    let x0: number;
    if (B.hold) {
      const centre = Math.round((B.cols - B.wordW) / 2);
      const inAt = 0.05;
      const inEnd = 1.15;
      const outAt = 3.5;
      const outEnd = 4.62;
      const travelIn = B.cols - centre;
      const travelOut = centre + B.wordW;
      if (t < inAt) x0 = B.cols;
      else if (t < inEnd) x0 = B.cols - Math.floor(((t - inAt) / (inEnd - inAt)) * travelIn);
      else if (t < outAt) x0 = centre;
      else if (t < outEnd) x0 = centre - Math.floor(((t - outAt) / (outEnd - outAt)) * travelOut);
      else x0 = -B.wordW - 1;
    } else {
      const span = B.cols + B.wordW + 6;
      x0 = B.cols - Math.floor(fract(t / LOOP) * span);
    }
    dots57(B.word, (px, py) => {
      for (let a = 0; a < B.scale; a++)
        for (let b = 0; b < B.scale; b++)
          put(x0 + px * B.scale + a, B.mainY + py * B.scale + b, main);
    });

    // Chevrons crawl one period per half second (exactly ten periods a loop).
    const crawl = Math.floor(fract(t / LOOP) * CHEV_PERIOD * 10);
    for (let x = -CHEV_PERIOD; x < B.cols + CHEV_PERIOD; x += CHEV_PERIOD)
      for (let j = 0; j < 7; j++)
        for (let i = 0; i < 4; i++)
          if (CHEVRON[j][i] === "1") put(x + i + (crawl % CHEV_PERIOD), B.subY + j, chev, 0.9);

    // Top line: a blinking live dot (or the brand's logo) and a quiet label.
    const blinkOn = fract(t / (LOOP / 4)) < 0.6;
    const logo = tintedLogo(theme, "#ffffff", 7, 7);
    if (logo) {
      const lc = buffer("led-logo", 7, 7);
      lc.ctx.clearRect(0, 0, 7, 7);
      lc.ctx.drawImage(logo as CanvasImageSource, 0, 0);
      const px = lc.ctx.getImageData(0, 0, 7, 7).data;
      for (let j = 0; j < 7; j++)
        for (let i = 0; i < 7; i++) if (px[(j * 7 + i) * 4 + 3] > 110) put(2 + i, 1 + j, dim);
    } else if (blinkOn) {
      for (let j = 0; j < 5; j++)
        for (let i = 0; i < 5; i++) if ((i - 2) ** 2 + (j - 2) ** 2 <= 5) put(2 + i, 2 + j, main);
    }
    dots57("LIVE", (px, py) => put(10 + px, 1 + py, dim, 0.85));
    const clock = "09:41";
    if (B.cols >= 10 + width57("LIVE") + width57(clock) + 10)
      dots57(clock, (px, py) => put(B.cols - 2 - width57(clock) + px, 1 + py, dim, 0.85));
    m.putImageData(img, 0, 0);

    // Light the LEDs: the frame buffer blown up, cut to round lenses, added on.
    const { canvas: lC, ctx: l } = buffer("led-lit", B.bw, B.bh);
    l.globalCompositeOperation = "source-over";
    l.clearRect(0, 0, B.bw, B.bh);
    l.imageSmoothingEnabled = false;
    l.drawImage(mC as CanvasImageSource, 0, 0, B.bw, B.bh);
    l.globalCompositeOperation = "destination-in";
    l.drawImage(
      bake(`led-body:${B.cols}x${B.rows}`, B.bw, B.bh, ledMask(B, false)) as CanvasImageSource,
      0,
      0,
    );
    // Hot centres: the same pattern, whitened, through a smaller mask.
    const { canvas: cC, ctx: cc } = buffer("led-core", B.bw, B.bh);
    cc.globalCompositeOperation = "source-over";
    cc.clearRect(0, 0, B.bw, B.bh);
    cc.imageSmoothingEnabled = false;
    cc.drawImage(mC as CanvasImageSource, 0, 0, B.bw, B.bh);
    cc.globalCompositeOperation = "source-atop";
    cc.fillStyle = rgba(theme.ink, 0.7);
    cc.fillRect(0, 0, B.bw, B.bh);
    cc.globalCompositeOperation = "destination-in";
    cc.drawImage(
      bake(`led-core:${B.cols}x${B.rows}`, B.bw, B.bh, ledMask(B, true)) as CanvasImageSource,
      0,
      0,
    );

    // Multiplex shimmer: the whole board breathes a percent or two, frame to frame.
    const shimmer = 0.97 + 0.03 * hash(stepFrame(t, 30), 5);
    // Spill: the lit pattern, blurred wide, washing over the housing and the wall.
    glow(
      ctx,
      mC as CanvasImageSource,
      "led-spill",
      B.bx,
      B.by,
      B.bw,
      B.bh,
      B.pitch / 2,
      3,
      0.6 * shimmer,
      "screen",
      B.pitch * 4,
    );
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = shimmer;
    ctx.drawImage(lC as CanvasImageSource, B.bx, B.by);
    ctx.drawImage(cC as CanvasImageSource, B.bx, B.by);
    ctx.restore();
    glow(
      ctx,
      lC as CanvasImageSource,
      "led-halo",
      B.bx,
      B.by,
      B.bw,
      B.bh,
      Math.max(1, B.pitch / 4),
      1.6,
      0.8 * shimmer,
      "screen",
    );

    // A faint sheen on the cover glass.
    const sheen = ctx.createLinearGradient(B.bx, B.by, B.bx + B.bw * 0.4, B.by + B.bh);
    sheen.addColorStop(0, rgba(theme.ink, 0.05));
    sheen.addColorStop(0.5, rgba(theme.ink, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(B.bx, B.by, B.bw, B.bh);

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.28);
    void u;
  },
};
