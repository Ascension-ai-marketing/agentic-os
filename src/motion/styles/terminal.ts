import { mix } from "../engine/color";
import {
  buffer,
  ease,
  font,
  frameOf,
  fract,
  grain,
  ground,
  hash,
  hashString,
  light,
  LOOP,
  once,
  seg,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { clean57, dots57, glow, scanlines, width57 } from "./_s4-helpers";

const FACE = '"VT323", "Courier New", monospace';
const PROMPT_PATH = "~/motion";
const PROMPT_SIGN = " $ ";
/** Typing starts here and the whole command fits in TYPE_MAX seconds. */
const TYPE_AT = 0.4;
const TYPE_MAX = 1.0;
const SCROLL_FOR = 0.95;
const BLINK = LOOP / 8;

interface Layout {
  cw: number;
  chh: number;
  x0: number;
  y0: number;
  cols: number;
  /** Rows per block (command row, blank, banner lines); the view shows one more. */
  period: number;
  lines: string[];
  size: number;
}

/** Per-character typing times: a human rhythm from a seeded hash, squeezed to fit the window. */
function typing(cmd: string) {
  return once(`term-typing:${cmd}`, () => {
    const seed = Math.floor(hashString(cmd) * 1e6);
    const gaps = [...cmd].map((c, i) => (c === " " ? 1.8 : 0.55 + 0.9 * hash(i, seed)));
    const total = gaps.reduce((a, b) => a + b, 0) || 1;
    const scale = Math.min(TYPE_MAX, cmd.length / 12) / total;
    let at = TYPE_AT;
    return gaps.map((g) => (at += g * scale));
  });
}

/** One banner line when it fits; split in two when the frame is narrow. */
function layout(ctx: Ctx2D, w: number, h: number, word: string, cmdLen: number): Layout {
  const { portrait } = frameOf(w, h);
  const stageW = w * (portrait ? 0.88 : 0.84);
  const stageH = h * (portrait ? 0.7 : 0.74);
  ctx.font = font(400, 100, "VT323", FACE);
  const adv = (ctx.measureText("M").width || 50) / 100;
  const promptLen = PROMPT_PATH.length + PROMPT_SIGN.length;
  const options: string[][] = [[word]];
  if (word.length >= 4) {
    const cut = Math.ceil(word.length / 2);
    options.push([word.slice(0, cut), word.slice(cut)]);
  }
  let best: Layout | null = null;
  for (const lines of options) {
    const bannerCols = Math.max(...lines.map((l) => width57(l) * 2)) + 1;
    const cols = Math.max(bannerCols + 2, promptLen + cmdLen + 3, 26);
    const period = 3 + lines.length * 8;
    // Cells are 1:2, like a real terminal; the view shows period + 1 rows.
    const cw = Math.min(stageW / cols, stageH / ((period + 1) * 2));
    if (!best || cw > best.cw * 1.04) {
      const chh = cw * 2;
      best = {
        cw,
        chh,
        cols,
        period,
        lines,
        x0: (w - cols * cw) / 2,
        y0: (h - (period + 1) * chh) / 2,
        size: cw / adv,
      };
    }
  }
  return best!;
}

/**
 * The ANSI-shadow banner: solid blocks, and the same shape's outline shifted
 * half a cell down-right, drawn as double box lines through the cell centres.
 */
function banner(
  c: Ctx2D,
  text: string,
  x: number,
  y: number,
  cw: number,
  chh: number,
  block: string,
  shade: string,
) {
  const cols = width57(text) * 2 + 2;
  const on = new Uint8Array(cols * 8);
  dots57(text, (px, py) => {
    on[py * cols + px * 2] = 1;
    on[py * cols + px * 2 + 1] = 1;
  });
  const lit = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < cols && j < 8 && on[j * cols + i] === 1;
  const ox = cw * 0.5;
  const oy = chh * 0.5;
  c.save();
  c.beginPath();
  for (let j = 0; j < 7; j++)
    for (let i = 0; i < cols; i++) {
      if (!lit(i, j)) continue;
      const x0 = x + i * cw + ox;
      const y0 = y + j * chh + oy;
      if (!lit(i + 1, j)) {
        c.moveTo(x0 + cw, y0);
        c.lineTo(x0 + cw, y0 + chh);
      }
      if (!lit(i, j + 1)) {
        c.moveTo(x0, y0 + chh);
        c.lineTo(x0 + cw, y0 + chh);
      }
      if (!lit(i - 1, j)) {
        c.moveTo(x0, y0);
        c.lineTo(x0, y0 + chh);
      }
      if (!lit(i, j - 1)) {
        c.moveTo(x0, y0);
        c.lineTo(x0 + cw, y0);
      }
    }
  const lw = Math.max(1.2, cw * 0.42);
  c.lineCap = "square";
  c.strokeStyle = shade;
  c.lineWidth = lw;
  c.stroke();
  // Hollow the stroke into a double line.
  c.globalCompositeOperation = "destination-out";
  c.lineWidth = lw * 0.36;
  c.stroke();
  c.restore();
  // Solid blocks on top hide the shadow wherever the letters are.
  c.fillStyle = block;
  for (let j = 0; j < 7; j++)
    for (let i = 0; i < cols; i++)
      if (lit(i, j)) c.fillRect(x + i * cw, y + j * chh, cw + 0.6, chh + 0.6);
}

/** Prompt at a row; returns the x where the command starts. */
function prompt(c: Ctx2D, L: Layout, theme: Theme, y: number): number {
  const base = y + L.chh * 0.74;
  c.fillStyle = theme.accent2;
  c.fillText(PROMPT_PATH, L.x0 + L.cw, base);
  c.fillStyle = mix(theme.accent, theme.bg, 0.4);
  c.fillText(PROMPT_SIGN, L.x0 + L.cw * (1 + PROMPT_PATH.length), base);
  return L.x0 + L.cw * (1 + PROMPT_PATH.length + PROMPT_SIGN.length);
}

/** One block of the session: the command row and the banner it printed. */
function block(
  c: Ctx2D,
  L: Layout,
  theme: Theme,
  cmd: string,
  typed: number,
  y: number,
  withBanner: boolean,
) {
  const cx = prompt(c, L, theme, y);
  c.fillStyle = mix(theme.accent, theme.ink, 0.55);
  c.fillText(cmd.slice(0, typed), cx, y + L.chh * 0.74);
  if (!withBanner) return cx + typed * L.cw;
  let row = 2;
  for (const line of L.lines) {
    banner(
      c,
      line,
      L.x0 + L.cw,
      y + row * L.chh,
      L.cw,
      L.chh,
      theme.accent,
      mix(theme.accent, theme.bg, 0.3),
    );
    row += 8;
  }
  return cx + typed * L.cw;
}

export const style: MotionStyle = {
  id: "terminal",
  name: "Amber Terminal",
  family: "Retro Tech",
  tagline: "An amber-phosphor terminal",
  look: "A retro amber-phosphor terminal: a typed command, a huge ANSI-shadow block banner, a blinking block cursor.",
  move: "Keys land in a human rhythm, Enter, the screen smooth-scrolls as the banner prints, then the cursor blinks.",
  rules: [
    "One monospace grid with 1:2 cells; every glyph, block and box line sits on it.",
    "Monochrome amber in three brightnesses, plus one quieter colour for the path.",
    "Typing has a human rhythm (seeded jitter, a pause at spaces), never a steady tick.",
    "The banner is solid blocks with a double-line box-drawn shadow half a cell down-right.",
    "The screen smooth-scrolls like a VT100; the cursor blinks only while the shell is idle.",
    "Phosphor: a soft glow on lit text, faint scanlines, grain and a vignette.",
    "Hold the finished banner at least 1.2 s.",
  ],
  prompt: `R — References
• DEC VT220 amber terminals and P3 phosphor glow (search: VT220 amber screen, amber monochrome monitor).
• FIGlet "ANSI Shadow" banners: solid █ blocks with a ═ ║ ╗ ╝ box-drawn shadow.
• The Unix banner command, and the VT100 smooth-scroll mode.

I — Idea
One terminal session, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): the last banner sits on screen; under it, "banner {{name}}" is typed at the prompt with a human rhythm.
• Middle (1.5–2.5 s): Enter; the screen smooth-scrolls up as a new ANSI-shadow banner of "{{name}}" prints row by row.
• End (2.5–5 s): the new banner holds in exactly the old one's place, a fresh prompt blinks below it, and the loop closes.

S — Style
Looks: {{bg}} tube black, {{accent}} amber phosphor in three brightnesses (typed text brightest, prompt dimmest), the path in {{accent2}}, VT323 on a strict 1:2 cell grid, a soft glow on lit text, faint scanlines, grain and a vignette.
Moves: typing at 10–15 characters a second with seeded jitter; the scroll eases over about 0.9 s; cursor blink 1.6 Hz only while idle.
Rules:
1. Everything snaps to the monospace grid.
2. Banner = solid blocks + a double-line shadow offset half a cell down-right.
3. The cursor is solid while typing, blinking while idle.
4. Glow on text, scanlines under 20% opacity, never a flat black screen.
5. Hold the finished banner at least 1.2 s.
6. Split the banner over two lines when the frame is narrow.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the banner reads at thumbnail size; blocks and shadow lines sit exactly on the cell grid; no text touches the frame edge; the glow is soft, not a blur of the letters. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/VT220",
  theme: {
    bg: "#0c0905",
    ink: "#fff1d6",
    accent: "#ffb21e",
    accent2: "#ff7a3d",
    font: "VT323",
  },
  fonts: ["VT323"],
  tags: [
    "terminal",
    "command",
    "cli",
    "shell",
    "console",
    "code",
    "typing",
    "cursor",
    "amber",
    "retro",
    "hacker",
    "banner",
  ],
  word: "HELLO",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    light(ctx, w * 0.5, h * 0.46, Math.max(w, h) * 0.75, theme.accent, 0.07);

    const name = wordFor(theme.name, "HELLO", 12);
    const word = clean57(name).trim() || "HELLO";
    const cmd = `banner ${name}`;
    const L = layout(ctx, w, h, word, cmd.length);
    const times = typing(cmd);
    const enter = times[times.length - 1] + 0.18;
    const scroll = ease.inOutSine(seg(t, enter + 0.08, enter + 0.08 + SCROLL_FOR));
    const v = scroll * L.period;
    let typed = 0;
    for (const at of times) if (t >= at) typed++;
    const idle = fract(t / BLINK) < 0.5;

    const { canvas: layerC, ctx: layer } = buffer("term-layer", w, h);
    layer.clearRect(0, 0, w, h);
    layer.font = font(400, L.size, "VT323", FACE);
    layer.textBaseline = "alphabetic";
    layer.textAlign = "left";
    // The session is a tape of identical blocks; the view scrolls one block per loop.
    const top = L.y0 - v * L.chh;
    block(layer, L, theme, cmd, cmd.length, top - L.period * L.chh, true);
    block(layer, L, theme, cmd, cmd.length, top, true);
    const endX = block(layer, L, theme, cmd, typed, top + L.period * L.chh, t >= enter);
    let cursorX = -1;
    let cursorY = 0;
    if (t < enter) {
      if (t >= TYPE_AT || idle) {
        cursorX = endX;
        cursorY = top + L.period * L.chh;
      }
    } else {
      // The shell prints its next prompt right after the banner; the scroll reveals it.
      const px = prompt(layer, L, theme, top + 2 * L.period * L.chh);
      if (scroll >= 1 && idle) {
        cursorX = px;
        cursorY = top + 2 * L.period * L.chh;
      }
    }
    if (cursorX >= 0) {
      layer.fillStyle = theme.accent;
      layer.fillRect(cursorX, cursorY + L.chh * 0.12, L.cw, L.chh * 0.8);
    }
    // Soft top and bottom edges of the view, so scrolling rows fade, never pop.
    const fadeH = L.chh * 0.9;
    const viewTop = L.y0 - L.chh * 0.35;
    const viewBottom = L.y0 + (L.period + 1) * L.chh + L.chh * 0.35;
    layer.save();
    layer.globalCompositeOperation = "destination-out";
    layer.fillStyle = "#000";
    layer.fillRect(0, 0, w, Math.max(0, viewTop - fadeH));
    layer.fillRect(0, viewBottom + fadeH, w, h);
    const gTop = layer.createLinearGradient(0, viewTop - fadeH, 0, viewTop);
    gTop.addColorStop(0, "rgba(0,0,0,1)");
    gTop.addColorStop(1, "rgba(0,0,0,0)");
    layer.fillStyle = gTop;
    layer.fillRect(0, viewTop - fadeH, w, fadeH);
    const gBot = layer.createLinearGradient(0, viewBottom, 0, viewBottom + fadeH);
    gBot.addColorStop(0, "rgba(0,0,0,0)");
    gBot.addColorStop(1, "rgba(0,0,0,1)");
    layer.fillStyle = gBot;
    layer.fillRect(0, viewBottom, w, fadeH);
    layer.restore();

    // Phosphor: a faint 30 Hz flicker, a tight and a wide glow, then the crisp text.
    const frame = Math.floor(fract(t / LOOP) * LOOP * 30 + 1e-6);
    const flicker = 0.97 + 0.03 * hash(frame, 91);
    glow(ctx, layerC as CanvasImageSource, "term", 0, 0, w, h, 6, 3.2, 0.9 * flicker, "screen");
    glow(ctx, layerC as CanvasImageSource, "term-wide", 0, 0, w, h, 14, 6, 0.5 * flicker, "screen");
    ctx.save();
    ctx.globalAlpha = flicker;
    ctx.drawImage(layerC as CanvasImageSource, 0, 0);
    ctx.restore();

    // A dropped logo sits in the corner of the tube like a bezel badge.
    const mark = tintedLogo(theme, mix(theme.accent, theme.bg, 0.45), u * 0.06, u * 0.06);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w - u * 0.1, u * 0.04);

    scanlines(ctx, w, h, Math.max(2, L.chh / 7), 0.2);
    vignette(ctx, w, h, "#000000", 0.62);
    grain(ctx, w, h, t, 0.3);
  },
};
