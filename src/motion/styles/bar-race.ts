import { tintedLogo } from "../engine/assets";
import { mix, rgba } from "../engine/color";
import { ease, font, frameOf, grain, ground, light, vignette, wordFor } from "../engine/kit";
import type { MotionStyle, Theme } from "../engine/types";
import { glow, studio, tabular, unit } from "./_s6-helpers";

const COND = '"Sofia Sans Condensed", "Arial Narrow", sans-serif';
/** The period numeral: a secondary, variable family, so any weight is loaded. */
const NUMERAL = "Sofia Sans Extra Condensed";
const SLOT = 1.25;
const HOLD = 0.45;
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
/** Made-up weekly active users (millions) per quarter. Index 0 is the brand's bar. */
const NAMES = ["", "Northwind", "Juniper", "Kestrel", "Meridian", "Solace"];
const KEYS = [
  [31.0, 48.2, 42.7, 36.4, 27.5, 22.1],
  [38.5, 43.0, 46.4, 33.0, 30.2, 24.8],
  [52.4, 43.8, 39.6, 35.1, 27.4, 30.7],
  [47.9, 50.6, 36.2, 41.3, 26.4, 29.5],
];

/** Values, quarter index and transition progress at t. */
function state(t: number) {
  const kk = Math.floor(t / SLOT + 1e-9);
  const local = t - kk * SLOT;
  const k = ((kk % 4) + 4) % 4;
  const p = local < HOLD ? 0 : ease.inOutCubic((local - HOLD) / (SLOT - HOLD));
  const a = KEYS[k];
  const b = KEYS[(k + 1) % 4];
  return { values: a.map((v, i) => v + (b[i] - v) * p), k, local };
}

/** Continuous rank: bars slide past each other as their values cross. */
function softRanks(values: number[], eps = 0.45): number[] {
  return values.map((v, i) => {
    let r = 0;
    for (let j = 0; j < values.length; j++)
      if (j !== i) r += 1 / (1 + Math.exp(-(values[j] - v) / eps));
    return r;
  });
}

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h);
  const L = Math.max(w * (portrait ? 0.083 : 0.074), (w - 1560 * U) / 2);
  const R = w - L;
  if (portrait)
    return {
      U: U * 1.28,
      L,
      R,
      portrait,
      titleY: h * 0.13,
      chartTop: h * 0.265,
      chartBottom: h * 0.79,
      x0: L,
      qSize: 330 * U,
      qY: h * 0.935,
    };
  return {
    U,
    L,
    R,
    portrait,
    titleY: h * (square ? 0.13 : 0.165),
    chartTop: h * (square ? 0.29 : 0.3),
    chartBottom: h * (square ? 0.9 : 0.885),
    x0: L + (square ? 250 : 290) * U,
    qSize: (square ? 200 : 240) * U,
    qY: h * (square ? 0.9 : 0.885),
  };
}

function drawBadge(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  r: number,
  fill: string,
  letter: string,
  isBrand: boolean,
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const mark = isBrand ? tintedLogo(theme, theme.ink, r * 1.25, r * 1.25) : null;
  if (mark) {
    ctx.drawImage(mark as CanvasImageSource, x - r * 0.625, y - r * 0.625, r * 1.25, r * 1.25);
    return;
  }
  ctx.fillStyle = theme.ink;
  ctx.font = font(700, r * 1.08, theme.font, COND);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, x, y + r * 0.04);
}

export const style: MotionStyle = {
  id: "bar-race",
  name: "Bar Chart Race",
  family: "Data & Diagrams",
  tagline: "A broadcast bar race",
  look: "A broadcast data desk: condensed labels, steel bars on blue-black, one accent bar climbing, a huge quarter numeral.",
  move: "Values tick between quarters; bars slide past each other as they overtake; the axis rescales; the quarter rolls over.",
  rules: [
    "One accent bar (the brand); every other bar is the same quiet steel.",
    "Bars swap places by sliding past each other, never by jumping.",
    "Numbers use tabular digits so ticking values never shimmy.",
    "Hold each quarter before the next move so values can be read.",
    "The axis rescales with the leader; gridlines slide, never pop.",
    "The period numeral is huge and light, parked where the short bars leave room.",
    "Condensed type for names, one weight for values, nothing in all caps but the axis.",
  ],
  prompt: `R — References
• Flourish bar chart races and FT / Bloomberg data-desk graphics (search: bar chart race, flourish racing bars).
• Broadcast sports tables: condensed type, tabular numbers, one highlighted team.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): six horizontal bars ranked by weekly active users; "{{name}}" sits fourth in the accent colour; a huge "Q1" sits bottom right.
• Middle (1.5–3.5 s): quarter by quarter the values tick, bars slide past each other as they overtake, and "{{name}}" climbs to first in Q3; the axis rescales as the leader grows.
• End (3.5–5 s): Q4 reshuffles and the values ease back to the Q1 standings, landing exactly on the first frame.

S — Style
Looks: {{bg}} blue-black ground with a soft key light; bars in a quiet steel ({{accent2}}); the brand bar in {{accent}} with a small glow at its tip; names and values in {{font}} condensed; thin vertical gridlines with axis numbers along the top.
Moves: 0.45 s hold then a 0.8 s inOutCubic move per quarter; ranks are continuous (bars glide past each other); the quarter numeral rolls up as the period changes.
Rules:
1. One accent bar only; every other bar shares one colour.
2. Tabular digits for every number.
3. Bars never jump rank; they slide.
4. Gridlines slide with the rescaling axis and fade at the edge.
5. The quarter numeral is huge, light and never collides with a bar.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no two bars overlap at a hold; every value is readable and sits clear of its bar; the quarter numeral never touches a bar; names never clip. Fix what fails and render again until every check passes.`,
  ref: "https://flourish.studio/visualisations/bar-chart-race/",
  theme: {
    bg: "#0b0d12",
    ink: "#eef1f6",
    accent: "#ff4f64",
    accent2: "#7d8aa3",
    font: "Sofia Sans Condensed",
  },
  fonts: ["Sofia Sans Condensed:wght@100..900", "Sofia Sans Extra Condensed:wght@100..900"],
  tags: [
    "bar",
    "race",
    "chart",
    "data",
    "ranking",
    "leaderboard",
    "statistics",
    "infographic",
    "broadcast",
    "numbers",
    "growth",
  ],
  word: "Orbit",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U, L, R, portrait } = lay;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(studio(theme, "bars", w, h, { lx: 0.18, ly: 0.05 }) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.78, h * 0.62, Math.max(w, h) * 0.6, theme.accent2, 0.06);

    const { values, k, local } = state(t);
    // A lagging ghost of each bar shows what it just gained or lost.
    const lagged = state((((t - 0.32) % 5) + 5) % 5).values;
    const ranks = softRanks(values);
    const brand = wordFor(theme.name, "Orbit", 12);
    const names = NAMES.map((n, i) => (i === 0 ? brand : n));

    // Title.
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = theme.ink;
    ctx.font = font(700, 60 * U, theme.font, COND);
    ctx.letterSpacing = `${(0.2 * U).toFixed(2)}px`;
    ctx.fillText("Weekly active users", L, lay.titleY);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.ink, 0.52);
    ctx.font = font(400, 24 * U, "Inter");
    ctx.fillText("Millions, by quarter", L, lay.titleY + 40 * U);

    // Axis: rescales with the leader, gridlines slide and fade at the edge.
    const top = Math.max(...values);
    const scaleMax = top * 1.12;
    const valueRoom = 104 * U;
    const maxW = R - lay.x0 - valueRoom;
    const xOf = (v: number) => lay.x0 + (v / scaleMax) * maxW;
    const rowH = (lay.chartBottom - lay.chartTop) / 6;
    ctx.font = font(500, 19 * U, "Inter");
    ctx.textAlign = "center";
    for (let g = 0; g <= 7; g++) {
      const v = g * 10;
      const x = xOf(v);
      if (x > R - 20 * U) break;
      const fade = Math.min(1, (R - valueRoom * 0.4 - x) / (140 * U));
      if (fade <= 0) continue;
      ctx.fillStyle = rgba(theme.ink, (g === 0 ? 0.22 : 0.075) * fade);
      ctx.fillRect(
        x - 0.5 * U,
        lay.chartTop - 6 * U,
        Math.max(1, U),
        lay.chartBottom - lay.chartTop + 6 * U,
      );
      ctx.fillStyle = rgba(theme.ink, 0.42 * fade);
      tabular(ctx, String(v), x, lay.chartTop - 18 * U, "center");
    }

    // Row numbers are fixed; bars slide through them.
    if (!portrait) {
      ctx.font = font(500, 22 * U, theme.font, COND);
      ctx.textAlign = "left";
      ctx.fillStyle = rgba(theme.ink, 0.3);
      for (let r = 0; r < 6; r++)
        tabular(
          ctx,
          String(r + 1).padStart(2, "0"),
          L,
          lay.chartTop + rowH * (r + 0.5) + 8 * U,
          "left",
        );
    }

    // Bars, drawn top rank last so an overtaking bar passes over the other.
    const order = values.map((_, i) => i).sort((a, b) => ranks[b] - ranks[a]);
    const steel = mix(theme.accent2, theme.ink, 0.08);
    const barH = rowH * (portrait ? 0.4 : 0.64);
    for (const i of order) {
      const isBrand = i === 0;
      const col = isBrand ? theme.accent : steel;
      const rowY = lay.chartTop + rowH * ranks[i];
      const y = portrait ? rowY + rowH * 0.44 : rowY + (rowH - barH) / 2;
      const x1 = xOf(values[i]);
      const len = x1 - lay.x0;
      const xg = xOf(lagged[i]);
      if (Math.abs(xg - x1) > 1) {
        ctx.fillStyle = xg > x1 ? rgba(theme.ink, 0.09) : rgba(mix(col, theme.ink, 0.4), 0.55);
        ctx.fillRect(Math.min(x1, xg), y, Math.abs(xg - x1), barH);
      }
      const gr = ctx.createLinearGradient(lay.x0, 0, x1, 0);
      gr.addColorStop(0, mix(theme.bg, col, isBrand ? 0.42 : 0.2));
      gr.addColorStop(1, mix(theme.bg, col, isBrand ? 1 : 0.62));
      ctx.fillStyle = gr;
      ctx.fillRect(lay.x0, y, len, barH);
      // Top edge catches the light; the tip is a brighter cap.
      ctx.fillStyle = rgba(theme.ink, isBrand ? 0.28 : 0.12);
      ctx.fillRect(lay.x0, y, len, Math.max(1, 1.5 * U));
      ctx.fillStyle = isBrand ? mix(col, theme.ink, 0.45) : mix(theme.bg, col, 0.9);
      ctx.fillRect(x1 - 3 * U, y, 3 * U, barH);
      if (isBrand) glow(ctx, x1, y + barH / 2, barH * 1.5, theme.accent, 0.3);

      // The brand bar carries a badge at its tip: the logo when there is one, else an initial.
      const br = barH * (portrait ? 0.4 : 0.34);
      if (isBrand && len > br * 3.2)
        drawBadge(
          ctx,
          theme,
          x1 - br - 10 * U,
          y + barH / 2,
          br,
          mix(theme.accent, theme.bg, 0.45),
          names[i].charAt(0).toUpperCase(),
          isBrand,
        );

      // Value at the tip.
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = font(700, 36 * U, theme.font, COND);
      ctx.fillStyle = isBrand ? mix(theme.accent, theme.ink, 0.25) : rgba(theme.ink, 0.9);
      tabular(ctx, values[i].toFixed(1), x1 + 14 * U, y + barH / 2 + 1 * U, "left");

      // Name: left of the bar, or above it in portrait.
      ctx.font = font(500, 38 * U, theme.font, COND);
      ctx.fillStyle = isBrand ? theme.ink : rgba(theme.ink, 0.84);
      ctx.letterSpacing = `${(0.3 * U).toFixed(2)}px`;
      if (portrait) {
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(names[i], lay.x0, y - 14 * U);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(names[i], lay.x0 - 20 * U, y + barH / 2 + 1 * U);
      }
      ctx.letterSpacing = "0px";
    }

    // The quarter numeral rolls up as the period changes.
    const roll = ease.inOutCubic(Math.max(0, Math.min(1, (local - (SLOT - 0.3)) / 0.26)));
    const qx = R;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.save();
    ctx.beginPath();
    ctx.rect(qx - lay.qSize * 1.6, lay.qY - lay.qSize * 0.84, lay.qSize * 1.62, lay.qSize * 0.98);
    ctx.clip();
    ctx.font = font(200, lay.qSize, NUMERAL, COND);
    ctx.letterSpacing = `${(-2 * U).toFixed(2)}px`;
    const shift = lay.qSize * 0.82 * roll;
    ctx.fillStyle = rgba(theme.ink, 0.9 * (1 - roll));
    ctx.fillText(QUARTERS[k], qx, lay.qY - shift);
    if (roll > 0) {
      ctx.fillStyle = rgba(theme.ink, 0.9 * roll);
      ctx.fillText(QUARTERS[(k + 1) % 4], qx, lay.qY + lay.qSize * 0.82 - shift);
    }
    ctx.restore();
    ctx.letterSpacing = "0px";
    ctx.font = font(500, 22 * U, "Inter");
    ctx.fillStyle = rgba(theme.ink, 0.45);
    ctx.letterSpacing = `${(3 * U).toFixed(2)}px`;
    ctx.fillText("FY 2026", qx, lay.qY - lay.qSize * 0.8);
    ctx.letterSpacing = "0px";

    vignette(ctx, w, h, "#000000", 0.42);
    grain(ctx, w, h, t, 0.2);
  },
};
