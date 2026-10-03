import { rgba } from "../engine/color";
import { ease, font, frameOf, lerp, LOOP, MONO, seg, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { finish, tooth } from "./_s3-helpers";

const WIDE_FAMILY = "Archivo";
const WIDE_FALLBACK = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const MONO_FAMILY = "JetBrains Mono";
const STRETCH = [
  "extra-condensed",
  "condensed",
  "semi-condensed",
  "normal",
  "semi-expanded",
  "expanded",
];

/** Eight states, one per 0.625 s beat: a width pattern, an inverted block, an accent cell. */
type State = { pattern: number; inv: [number, number]; acc: [number, number] };
const STATES: State[] = [
  { pattern: 3, inv: [0, 3], acc: [10, 0] },
  { pattern: 0, inv: [7, 4], acc: [2, 0] },
  { pattern: 5, inv: [3, 2], acc: [11, 5] },
  { pattern: 6, inv: [9, 3], acc: [0, 5] },
  { pattern: 1, inv: [1, 5], acc: [8, 0] },
  { pattern: 7, inv: [5, 3], acc: [4, 5] },
  { pattern: 2, inv: [8, 4], acc: [0, 0] },
  { pattern: 8, inv: [2, 2], acc: [6, 5] },
];
const BEAT = LOOP / STATES.length;

function stretches(pattern: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const r = n > 1 ? i / (n - 1) : 0;
    switch (pattern) {
      case 0:
        return 0;
      case 1:
        return 1;
      case 2:
        return 2;
      case 3:
        return 3;
      case 5:
        return 5;
      case 6:
        return i % 2 ? 5 : 0;
      case 7:
        return Math.round(r * 5);
      case 8:
        return Math.round((1 - r) * 5);
      default:
        return 3;
    }
  });
}

function letterFont(k: number, size: number) {
  return `${STRETCH[k]} 900 ${Math.max(1, size).toFixed(2)}px "${WIDE_FAMILY}", ${WIDE_FALLBACK}`;
}

/** The poster, drawn in a local landscape frame of W x H (portrait turns it on its side). */
function poster(
  ctx: Ctx2D,
  t: number,
  theme: Theme,
  W: number,
  H: number,
  cols: number,
  rows: number,
) {
  const { u } = frameOf(W, H);
  const m = u * 0.045;
  const gx0 = m;
  const gy0 = m;
  const cw = (W - m * 2) / cols;
  const rh = (H - m * 2) / rows;
  const lw = Math.max(1, u * 0.0016);

  // State and a hard snap into it (80 ms, expo out).
  const tt = ((t % LOOP) + LOOP) % LOOP;
  const bi = Math.floor(tt / BEAT) % STATES.length;
  const snap = ease.outExpo(seg(tt - bi * BEAT, 0, 0.09));
  const cur = STATES[bi];
  const prev = STATES[(bi + STATES.length - 1) % STATES.length];

  // Grid: hairlines, heavy frame, crosshairs.
  ctx.strokeStyle = rgba(theme.ink, 0.16);
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let i = 1; i < cols; i++) {
    const x = Math.round(gx0 + i * cw) + 0.5;
    ctx.moveTo(x, gy0);
    ctx.lineTo(x, H - m);
  }
  for (let j = 1; j < rows; j++) {
    const y = Math.round(gy0 + j * rh) + 0.5;
    ctx.moveTo(gx0, y);
    ctx.lineTo(W - m, y);
  }
  ctx.stroke();
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = Math.max(2, u * 0.0045);
  ctx.strokeRect(gx0, gy0, W - m * 2, H - m * 2);
  ctx.lineWidth = Math.max(1, u * 0.0022);
  ctx.beginPath();
  const arm = u * 0.012;
  for (let i = 1; i < cols; i += 2)
    for (let j = 1; j < rows; j += 2) {
      const x = gx0 + i * cw;
      const y = gy0 + j * rh;
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
    }
  ctx.stroke();

  // Header labels (row 0) and footer marquee (last row).
  const lab = Math.max(7, rh * 0.2);
  ctx.font = font(700, lab, MONO_FAMILY, MONO);
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.ink;
  const midHead = gy0 + rh * 0.5;
  ctx.textAlign = "left";
  // A brand mark, when there is one, leads the header row.
  const mark = tintedLogo(theme, theme.ink, rh * 0.5, rh * 0.5);
  let lx = gx0 + cw * 0.18;
  if (mark) {
    ctx.drawImage(mark as CanvasImageSource, lx, midHead - rh * 0.25);
    lx += rh * 0.7;
  }
  ctx.fillText("FIG.0" + (bi + 1) + " / RAW TYPE", lx, midHead);
  const f = Math.floor(tt * 30);
  const tc = `00:00:0${Math.floor(tt)}:${String(f % 30).padStart(2, "0")}`;
  ctx.textAlign = "right";
  ctx.fillText(tc, W - m - cw * 0.18, midHead);
  ctx.textAlign = "left";
  ctx.fillStyle = rgba(theme.ink, 0.6);
  ctx.fillText(
    `WDTH ${["62", "75", "87", "100", "112", "125", "62/125", "62→125", "125→62"][cur.pattern]}`,
    gx0 + cw * 4.18,
    midHead,
  );

  // The word: letters at their own widths, sized to span the grid, baseline on the last word row.
  const word = wordFor(theme.name, "Brutal", 12).toUpperCase();
  const letters = [...word];
  const ks = stretches(cur.pattern, letters.length);
  const zoneTop = gy0 + rh;
  const zoneBot = gy0 + rh * (rows - 1);
  let w100 = 0;
  for (let i = 0; i < letters.length; i++) {
    ctx.font = letterFont(ks[i], 100);
    w100 += ctx.measureText(letters[i]).width;
  }
  const span = W - m * 2 - cw * 0.3;
  const capMax = (zoneBot - zoneTop) * 0.86;
  const size = Math.min((100 * span) / w100, capMax / 0.72);
  const base = zoneBot - rh * 0.14;
  const x0 = gx0 + cw * 0.15;
  // A ghost of the previous state, outlined, stacked above when there is room.
  const ksPrev = stretches(prev.pattern, letters.length);
  let wPrev = 0;
  for (let i = 0; i < letters.length; i++) {
    ctx.font = letterFont(ksPrev[i], 100);
    wPrev += ctx.measureText(letters[i]).width;
  }
  const ghostBase = base - size * 0.72 - rh * 0.16;
  const size2 = Math.min((100 * span) / wPrev, (ghostBase - (zoneTop + rh * 0.14)) / 0.72);
  const ghost = size2 * 0.72 > rh * 0.7;
  const drawWord = (color: string) => {
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    let x = x0;
    for (let i = 0; i < letters.length; i++) {
      ctx.font = letterFont(ks[i], size);
      ctx.fillText(letters[i], x, base);
      x += ctx.measureText(letters[i]).width;
    }
    if (ghost) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, u * 0.0035);
      ctx.lineJoin = "miter";
      let gx = x0;
      for (let i = 0; i < letters.length; i++) {
        ctx.font = letterFont(ksPrev[i], size2);
        ctx.strokeText(letters[i], gx, ghostBase);
        gx += ctx.measureText(letters[i]).width;
      }
    }
  };
  drawWord(theme.ink);

  // Inverted block: snaps to its new cells, the word knocked out inside it.
  const ic0 = lerp(prev.inv[0], cur.inv[0], snap);
  const icn = lerp(prev.inv[1], cur.inv[1], snap);
  const bx = gx0 + ic0 * cw;
  const bw = icn * cw;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, zoneTop, bw, zoneBot - zoneTop);
  ctx.clip();
  ctx.fillStyle = theme.ink;
  ctx.fillRect(bx, zoneTop, bw, zoneBot - zoneTop);
  drawWord(theme.bg);
  ctx.restore();

  // Accent cell with an arrow, snapping between header and footer cells.
  const ax = lerp(prev.acc[0], cur.acc[0], snap);
  const ay = lerp(prev.acc[1], cur.acc[1], snap);
  const accX = gx0 + ax * cw;
  const accY = gy0 + ay * rh;
  ctx.fillStyle = theme.accent;
  ctx.fillRect(accX, accY, cw, rh);
  ctx.fillStyle = theme.ink;
  ctx.font = font(700, rh * 0.5, MONO_FAMILY, MONO);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("↗", accX + cw / 2, accY + rh * 0.52);

  // Footer marquee: raw web type, one repeat per loop.
  const footY = gy0 + rh * (rows - 0.5);
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx0, gy0 + rh * (rows - 1), W - m * 2, rh);
  ctx.clip();
  ctx.font = font(700, lab * 1.25, MONO_FAMILY, MONO);
  ctx.textAlign = "left";
  const unitText = `${word} ↗ NO GRID IS NEUTRAL ↗ `;
  const unit = ctx.measureText(unitText).width;
  const off = -unit * (tt / LOOP);
  ctx.fillStyle = rgba(theme.ink, 0.85);
  for (let x = gx0 + off; x < W; x += unit) ctx.fillText(unitText, x, footY);
  ctx.restore();

  return { u, m };
}

export const style: MotionStyle = {
  id: "brutalist-type",
  name: "Brutalist Type",
  family: "Design Movements",
  tagline: "One huge grotesque on a raw grid",
  look: "Raw typographic brutalism: one huge black grotesque on a visible grid, stark black and white, one signal cell.",
  move: "Hard cuts on the beat: letters jump between condensed and expanded widths while an inverted block snaps across the grid.",
  rules: [
    "Black and white only, plus one signal colour for a single cell.",
    "The grid is visible and the frame is heavy; nothing hides the structure.",
    "One word, as big as the grid allows, flush left on a hard baseline.",
    "Motion is cuts, not glides: 80 ms snaps on a 0.625 s beat.",
    "Letter widths change on the real width axis, never by scaling.",
    "An inverted block knocks the word out wherever it lands.",
    "Labels are monospaced, upper case and literal: figure, width, timecode.",
  ],
  prompt: `R — References
• Typographic brutalism: raw grids, oversized grotesques, default-looking type (search: brutalist typography poster, brutalist web design).
• Variable-width grotesques animated on their width axis (search: variable font width animation).

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.25 s): a heavy frame and a visible 12 x 6 grid; the word "{{name}}" fills the grid in a black-weight grotesque; an inverted block and a signal cell sit on grid cells.
• Middle (1.25–3.75 s): on every 0.625 s beat the letters cut to new widths (all condensed, all expanded, alternating, ramps), the word re-fits the grid, and the inverted block and signal cell snap to new cells.
• End (3.75–5 s): the eighth state cuts back to the first; a monospaced marquee has run exactly one repeat along the footer.

S — Style
Looks: {{bg}} ground, {{ink}} type, grid and frame; one {{accent}} cell with an arrow; Archivo 900 on its width axis for the word (or {{font}} if it has a width axis); JetBrains Mono labels.
Moves: 8 states per loop; 80 ms expo snaps; the marquee moves one repeat per loop; nothing else moves.
Rules:
1. Black and white plus one signal colour.
2. A visible grid and a heavy frame.
3. One huge word, flush left.
4. Cuts, not glides.
5. Real width-axis changes only.
6. Monospaced literal labels.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word never crosses the frame or the header row; the inverted block always shows the word knocked out; the labels stay crisp; the timecode is frame-accurate. Fix what fails and render again until every check passes.`,
  ref: "https://brutalistwebsites.com/",
  theme: {
    bg: "#0a0a0a",
    ink: "#f2f1ec",
    accent: "#2f4dff",
    accent2: "#8c8c86",
    font: WIDE_FAMILY,
  },
  fonts: ["Archivo:wdth,wght@62..125,100..900", "JetBrains Mono:wght@400;700"],
  tags: [
    "brutalist",
    "brutalism",
    "typography",
    "type",
    "grid",
    "raw",
    "bold",
    "black and white",
    "variable font",
    "editorial",
    "stark",
    "design movement",
  ],
  word: "Brutal",
  render(ctx, t, theme, w, h) {
    const { portrait, square } = frameOf(w, h);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    if (portrait) {
      // The poster turns on its side: the word runs up the long edge.
      ctx.translate(0, h);
      ctx.rotate(-Math.PI / 2);
      poster(ctx, t, theme, h, w, 12, 6);
    } else if (square) poster(ctx, t, theme, w, h, 8, 7);
    else poster(ctx, t, theme, w, h, 12, 6);
    ctx.restore();

    tooth(ctx, w, h, 0.25, 53);
    finish(ctx, w, h, t, 0.35, 0.28);
  },
};
