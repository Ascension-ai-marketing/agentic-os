import { mix, rgba } from "../engine/color";
import { font, frameOf, grain, ground, light, vignette } from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { envelope, studio, tabular, unit } from "./_s6-helpers";

const SERIF = '"Instrument Serif", Georgia, serif';
/** Three columns of made-up visitor flow (thousands of sessions). */
const COLS = [
  ["Search", "Social", "Direct"],
  ["Pricing", "Docs", "Blog"],
  ["Trial", "Leave"],
];
/** Flows between column 0 and 1, and between 1 and 2, in two states. */
const A01 = [
  [18, 22, 6],
  [6, 4, 14],
  [12, 8, 2],
];
const B01 = [
  [8, 30, 8],
  [14, 0, 10],
  [16, 4, 2],
];
const A12 = [
  [22, 14],
  [20, 14],
  [6, 16],
];
const B12 = [
  [30, 8],
  [14, 20],
  [0, 20],
];
const TOTAL = 92;

type Band = {
  c: number;
  i: number;
  j: number;
  v: number;
  u0: number;
  u1: number;
  a0: number;
  b0: number;
  colour: string;
};

function colours(theme: Theme) {
  return [theme.accent, theme.accent2, mix(theme.ink, theme.accent2, 0.35)];
}

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h) * (portrait ? 1.1 : 1);
  // u runs along the flow, v across it; portrait flows top to bottom.
  if (portrait)
    return {
      U,
      portrait,
      square,
      us: [h * 0.25, h * 0.55, h * 0.84],
      v0: w * 0.1,
      v1: w * 0.9,
      gap: w * 0.05,
      node: 12 * U,
      map: (u: number, v: number): [number, number] => [v, u],
    };
  const L = Math.max(w * 0.074, (w - 1560 * unit(w, h)) / 2);
  return {
    U,
    portrait,
    square,
    us: square ? [w * 0.24, w * 0.52, w * 0.8] : [L + 190 * U, w * 0.5, w - L - 190 * U],
    v0: h * (square ? 0.3 : 0.29),
    v1: h * (square ? 0.9 : 0.88),
    gap: h * 0.045,
    node: 12 * U,
    map: (u: number, v: number): [number, number] => [u, v],
  };
}

export const style: MotionStyle = {
  id: "sankey-flow",
  name: "Sankey Flow",
  family: "Data & Diagrams",
  tagline: "Ribbons of flow, engraved",
  look: "A classic Sankey in the dark: translucent ribbons from three sources, fine engraved streamlines flowing inside them, serif labels.",
  move: "Streamlines stream through every ribbon; the flows re-split and merge into a second state, one ribbon thins to nothing, then everything flows back.",
  rules: [
    "Width is the data: every ribbon is exactly its flow, nodes add up.",
    "Ribbons are translucent and coloured by source; overlaps stay legible.",
    "Movement lives inside the ribbons: fine dashed streamlines, constant speed.",
    "States change by re-splitting ribbons, never by fading them.",
    "Hold each state long enough to read the node totals.",
    "Serif for names, tabular sans for numbers, nothing bold.",
    "Portrait turns the flow top to bottom instead of squeezing it.",
  ],
  prompt: `R — References
• Sankey diagrams in the tradition of Minard and the data desks of the FT and NYT (search: sankey diagram elegant, alluvial flow chart).
• Engraved hairline shading: many fine lines instead of flat fills.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): visitors flow from three sources through three pages to two outcomes; fine streamlines stream through every ribbon; the node totals hold.
• Middle (1.5–3.5 s): the flows re-split: search pours into Docs, social swings to Pricing, one ribbon thins to nothing and another merges wider; the totals tick and hold in the new state.
• End (3.5–5 s): the ribbons ease back into the first state while the streamlines keep flowing.

S — Style
Looks: {{bg}} ground with grain; ribbons in {{accent}}, {{accent2}} and a pale blend at about 40% opacity with lighter dashed streamlines inside; thin {{ink}} node bars; names in {{font}}, numbers in Inter with tabular digits.
Moves: streamlines move at constant speed (a whole number of dash lengths per loop); state changes are 0.8 s inOutCubic with the ribbons re-splitting in place; holds are at least 1.5 s.
Rules:
1. Ribbon width equals the flow; node heights equal their totals.
2. Colour by source; translucent overlaps.
3. Motion inside the ribbons, constant speed.
4. Re-split to change state; never fade ribbons in or out.
5. Serif names, tabular numbers.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; flows in equal flows out at every middle node; no label overlaps a ribbon's end or another label; streamlines never leave their ribbon; the totals are readable during each hold. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Sankey_diagram",
  theme: {
    bg: "#0b0a10",
    ink: "#ece8f5",
    accent: "#8b7bff",
    accent2: "#3fd0c9",
    font: "Instrument Serif",
  },
  fonts: ["Instrument Serif"],
  tags: [
    "sankey",
    "flow",
    "alluvial",
    "funnel",
    "data",
    "chart",
    "conversion",
    "journey",
    "budget",
    "energy",
    "streams",
  ],
  word: "Flow",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U, map } = lay;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "sankey", w, h, {
        lx: 0.5,
        ly: 0.4,
        tint: mix(theme.ink, theme.accent, 0.4),
        mottle: 0.8,
      }) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.5, h * 0.55, Math.max(w, h) * 0.5, theme.accent, 0.05);

    // State mix: A at rest, B in the middle of the loop.
    const s = envelope(t, 1.05, 1.85, 3.3, 4.1);
    const f01 = A01.map((row, i) => row.map((a, j) => a + (B01[i][j] - a) * s));
    const f12 = A12.map((row, i) => row.map((a, j) => a + (B12[i][j] - a) * s));
    const nodeTotals = [
      f01.map((row) => row.reduce((p, q) => p + q, 0)),
      [0, 1, 2].map((j) => f01.reduce((p, row) => p + row[j], 0)),
      [0, 1].map((j) => f12.reduce((p, row) => p + row[j], 0)),
    ];
    const span = lay.v1 - lay.v0;
    const k = (span - lay.gap * 2) / TOTAL;
    // Node positions across the flow: stacked with gaps, centred.
    const nodeV = nodeTotals.map((col) => {
      const used = col.reduce((p, q) => p + q, 0) * k + lay.gap * (col.length - 1);
      let v = lay.v0 + (span - used) / 2;
      return col.map((tot) => {
        const a = v;
        v += tot * k + lay.gap;
        return a;
      });
    });

    // Bands: outgoing stacked by target, incoming stacked by source.
    const bands: Band[] = [];
    const outC = nodeV.map((col) => col.map((v) => v));
    const inC = nodeV.map((col) => col.map((v) => v));
    const cols = colours(theme);
    // The second stage takes each middle node's blend of its sources, so colours never pop.
    const blend12 = [0, 1, 2].map((j) => {
      const a = f01[0][j];
      const b = f01[1][j];
      const c = f01[2][j];
      const ab = a + b;
      const first = ab > 0 ? mix(cols[0], cols[1], b / ab) : cols[0];
      return mix(first, cols[2], ab + c > 0 ? c / (ab + c) : 0);
    });
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const v = f01[i][j];
        bands.push({
          c: 0,
          i,
          j,
          v,
          u0: lay.us[0],
          u1: lay.us[1],
          a0: outC[0][i],
          b0: inC[1][j],
          colour: cols[i],
        });
        outC[0][i] += v * k;
        inC[1][j] += v * k;
      }
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        const v = f12[i][j];
        bands.push({
          c: 1,
          i,
          j,
          v,
          u0: lay.us[1],
          u1: lay.us[2],
          a0: outC[1][i],
          b0: inC[2][j],
          colour: blend12[i],
        });
        outC[1][i] += v * k;
        inC[2][j] += v * k;
      }

    const half = lay.node / 2;
    const ribbon = (c: Ctx2D, b: Band, f0: number, f1: number) => {
      // The band between fractions f0..f1 of its width, as a cubic ribbon.
      const wv = b.v * k;
      const ua = b.u0 + half;
      const ub = b.u1 - half;
      const um = (ua + ub) / 2;
      const a0 = b.a0 + wv * f0;
      const a1 = b.a0 + wv * f1;
      const b0 = b.b0 + wv * f0;
      const b1 = b.b0 + wv * f1;
      c.beginPath();
      c.moveTo(...map(ua, a0));
      c.bezierCurveTo(...map(um, a0), ...map(um, b0), ...map(ub, b0));
      c.lineTo(...map(ub, b1));
      c.bezierCurveTo(...map(um, b1), ...map(um, a1), ...map(ua, a1));
      c.closePath();
    };
    const centreline = (c: Ctx2D, b: Band, f: number) => {
      const wv = b.v * k;
      const ua = b.u0 + half;
      const ub = b.u1 - half;
      const um = (ua + ub) / 2;
      const a = b.a0 + wv * f;
      const bb = b.b0 + wv * f;
      c.beginPath();
      c.moveTo(...map(ua, a));
      c.bezierCurveTo(...map(um, a), ...map(um, bb), ...map(ub, bb));
    };

    // Ribbon fills.
    for (const b of bands) {
      if (b.v * k < 0.6) continue;
      const cA = b.colour;
      const [x0, y0] = map(b.u0, 0);
      const [x1, y1] = map(b.u1, 0);
      const g = lay.portrait
        ? ctx.createLinearGradient(0, y0, 0, y1)
        : ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, rgba(cA, 0.55));
      g.addColorStop(1, rgba(mix(cA, theme.ink, 0.2), 0.32));
      ctx.fillStyle = g;
      ribbon(ctx, b, 0, 1);
      ctx.fill();
    }
    // Engraved streamlines flowing inside each ribbon (a whole number of dash periods per loop).
    ctx.lineCap = "round";
    const dash = 26 * U;
    const gapD = 30 * U;
    const period = dash + gapD;
    for (const b of bands) {
      const wv = b.v * k;
      if (wv < 3 * U) continue;
      const lines = Math.max(1, Math.min(9, Math.round(wv / (11 * U))));
      ctx.strokeStyle = rgba(mix(b.colour, theme.ink, 0.6), 0.6);
      ctx.lineWidth = Math.max(1, 1.2 * U);
      for (let q = 0; q < lines; q++) {
        const f = (q + 0.5) / lines;
        const phase = ((b.i * 7 + b.j * 3 + q * 5) % 11) / 11;
        const on = dash * (0.5 + (0.5 * ((q * 7) % 5)) / 4);
        ctx.setLineDash([on, period - on]);
        ctx.lineDashOffset = -((t / 5) * 4 + phase) * period;
        centreline(ctx, b, f);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Node bars.
    nodeV.forEach((col, ci) =>
      col.forEach((v, ni) => {
        const tot = nodeTotals[ci][ni];
        const [x, y] = map(lay.us[ci] - half, v);
        const [x2, y2] = map(lay.us[ci] + half, v + tot * k);
        ctx.fillStyle = ci === 0 ? cols[ni] : theme.ink;
        ctx.fillRect(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y));
      }),
    );

    // Labels: names in serif, totals in tabular sans.
    const nameSize = 34 * U;
    const numSize = 21 * U;
    nodeV.forEach((col, ci) =>
      col.forEach((v, ni) => {
        const tot = nodeTotals[ci][ni];
        const mid = v + (tot * k) / 2;
        const name = COLS[ci][ni];
        const value = String(Math.round(tot));
        ctx.textBaseline = "alphabetic";
        let x: number;
        let y: number;
        let align: "left" | "right" | "center";
        if (lay.portrait) {
          // Flow runs down: labels sit above the first row, below the last, right of the middle.
          [x, y] = map(lay.us[ci], mid);
          align = "center";
          y = ci === 0 ? y - 44 * U : ci === 2 ? y + 50 * U : y - 16 * U;
        } else {
          [x, y] = map(lay.us[ci], mid);
          align = ci === 0 ? "right" : ci === 2 ? "left" : "center";
          if (ci === 0) x -= half + 18 * U;
          if (ci === 2) x += half + 18 * U;
          if (ci === 1) {
            y = v - 12 * U;
          } else y += 4 * U;
        }
        ctx.textAlign = align;
        const middle = ci === 1;
        ctx.font = font(400, middle ? nameSize * 0.85 : nameSize, theme.font, SERIF);
        const nameW = ctx.measureText(name).width;
        if (middle) {
          // Middle labels sit in the gap between nodes, haloed against the ribbons.
          ctx.lineJoin = "round";
          ctx.strokeStyle = rgba(theme.bg, 0.72);
          ctx.lineWidth = 6 * U;
          ctx.strokeText(name, x, y);
        }
        ctx.fillStyle = theme.ink;
        ctx.fillText(name, x, y);
        ctx.fillStyle = rgba(theme.ink, 0.6);
        ctx.font = font(500, numSize, "Inter");
        const ny = y + 26 * U;
        if (lay.portrait && ci === 1) {
          const vw = ctx.measureText(value + "k").width;
          ctx.fillStyle = rgba(theme.bg, 0.8);
          ctx.beginPath();
          ctx.roundRect(
            x - vw / 2 - 8 * U,
            y + 48 * U - numSize * 0.95,
            vw + 16 * U,
            numSize * 1.3,
            6 * U,
          );
          ctx.fill();
          ctx.fillStyle = rgba(theme.ink, 0.72);
          tabular(ctx, value + "k", x, y + 48 * U, "center");
        } else if (!lay.portrait && ci === 1) {
          ctx.textAlign = "left";
          const vx = x + nameW / 2 + 10 * U;
          ctx.fillStyle = rgba(theme.bg, 0.85);
          const vw = ctx.measureText(value + "k").width;
          ctx.fillRect(vx - 4 * U, y - numSize * 0.85, vw + 8 * U, numSize * 1.1);
          ctx.fillStyle = rgba(theme.ink, 0.65);
          tabular(ctx, value + "k", vx, y, "left");
        } else tabular(ctx, value + "k", x, ny, align);
      }),
    );

    // Title.
    const L = Math.max(w * (lay.portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
    const ty = h * (lay.portrait ? 0.09 : 0.13);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(400, 66 * U, theme.font, SERIF);
    ctx.fillText("Where visitors go", L, ty);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.font = font(500, 20 * U, "Inter");
    ctx.fillText("Sessions in thousands, one week", L, ty + 36 * U);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.24);
  },
};
