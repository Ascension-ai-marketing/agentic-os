import { mix, rgba } from "../engine/color";
import {
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  once,
  seg,
  TAU,
  vignette,
} from "../engine/kit";
import type { MotionStyle, Theme } from "../engine/types";
import { fmt, glow, studio, tabular, unit } from "./_s6-helpers";

const PLEX = '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace';
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STEP = 1.25;
/** Cursor stops: [day, hour]. */
const STOPS: [number, number][] = [
  [2, 14],
  [4, 10],
  [5, 20],
  [0, 9],
];
const PEAK = 2400;

/** Made-up sessions by weekday and hour: two working peaks, an evening bump, quiet weekends. */
const BASE = once("heatmap:base", () =>
  DAYS.map((_, d) =>
    Array.from({ length: 24 }, (_, hr) => {
      const weekend = d >= 5;
      const work = Math.exp(-((hr - 10.5) ** 2) / 5) + 0.9 * Math.exp(-((hr - 15) ** 2) / 6);
      const evening = Math.exp(-((hr - 20.5) ** 2) / 4);
      const night = hr < 6 ? 0.05 : 0;
      let v = weekend
        ? 0.25 * work + 0.75 * evening + 0.12
        : work * (0.9 + 0.1 * Math.sin(d)) + 0.45 * evening;
      v += night + (hash(d, hr, 7) - 0.5) * 0.14;
      return clamp(v * 0.95, 0.02, 1);
    }),
  ),
);

const ramps = new Map<string, string[]>();
/** A sequential ramp built only from theme colours: ground, second accent, accent, ink. */
function ramp(theme: Theme): string[] {
  const key = theme.bg + theme.ink + theme.accent + theme.accent2;
  let r = ramps.get(key);
  if (!r) {
    r = Array.from({ length: 64 }, (_, i) => {
      const v = i / 63;
      if (v < 0.4)
        return mix(mix(theme.bg, theme.ink, 0.07), mix(theme.bg, theme.accent2, 0.7), v / 0.4);
      if (v < 0.8) return mix(mix(theme.bg, theme.accent2, 0.7), theme.accent, (v - 0.4) / 0.4);
      return mix(theme.accent, theme.ink, ((v - 0.8) / 0.2) * 0.5);
    });
    ramps.set(key, r);
    if (ramps.size > 16) ramps.delete(ramps.keys().next().value as string);
  }
  return r;
}

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h) * (portrait ? 1.1 : 1);
  const L = Math.max(w * (portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
  const R = w - L;
  if (portrait) {
    // Transposed: days across, hours down.
    const gx = L + 90 * U;
    const cols = 7;
    const rows = 24;
    const cw = (R - gx) / cols;
    const ch = (h * 0.68) / rows;
    return {
      U,
      L,
      R,
      portrait,
      square,
      transposed: true,
      bins: 1,
      gx,
      gy: h * 0.2,
      cw,
      ch,
      cols,
      rows,
    };
  }
  const bins = square ? 2 : 1;
  const cols = 24 / bins;
  const gx = L + 76 * U;
  const cw = (R - gx) / cols;
  const ch = Math.min(cw * (square ? 1.1 : 1.25), (h * (square ? 0.5 : 0.52)) / 7);
  return {
    U,
    L,
    R,
    portrait,
    square,
    transposed: false,
    bins,
    gx,
    gy: h * (square ? 0.3 : 0.31),
    cw,
    ch,
    cols,
    rows: 7,
  };
}

export const style: MotionStyle = {
  id: "heatmap",
  name: "Activity Heatmap",
  family: "Data & Diagrams",
  tagline: "A week of activity in magma",
  look: "A week of activity as a grid of rounded cells in a magma ramp, mono labels, a crosshair cursor with a tooltip and a scale bar.",
  move: "A pulse wave rolls diagonally through the grid while a cursor steps to four cells; each landing sends a ripple out and the tooltip reads the value.",
  rules: [
    "The ramp is sequential and built from the theme: ground, second accent, accent.",
    "Cells breathe in size and heat with the wave, never jump.",
    "The cursor hops, lands with a ripple, and holds long enough to read.",
    "Only the tooltip shows numbers; the grid speaks in colour.",
    "Mono labels on the edges, every third hour, never inside the grid.",
    "A scale bar anchors the ramp so the colours mean something.",
    "Portrait turns the week sideways instead of shrinking it.",
  ],
  prompt: `R — References
• Calendar and punch-card heatmaps (search: activity heatmap hour weekday, github contribution graph dark).
• Scientific magma / inferno colour ramps.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a 24-hour by 7-day grid of rounded cells glows in a magma ramp; a pulse wave rolls diagonally through it; a cursor lands on Wednesday 14:00, a ripple spreads and the tooltip reads the sessions.
• Middle (1.5–3.5 s): the cursor hops to Friday morning and Saturday night, each landing with a ripple and a held tooltip.
• End (3.5–5 s): it hops to Monday morning and the wave rolls back to the frame it started on.

S — Style
Looks: {{bg}} ground; cells from a faint ground tint through {{accent2}} to {{accent}}, the hottest touched with {{ink}}; mono labels in {{font}}; a crosshair tint on the cursor's row and column; a scale bar under the grid.
Moves: the wave makes two whole passes per loop; cells scale 86–100% with their heat; the cursor eases between cells in 0.3 s and holds 0.95 s; each ripple runs out over 0.8 s.
Rules:
1. A sequential ramp from theme colours only.
2. Cells breathe with the wave.
3. Numbers only in the tooltip.
4. Labels outside the grid, every third hour.
5. A scale bar for the ramp.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the tooltip never leaves the frame or covers its own cell; weekends read cooler; labels are crisp; the scale bar matches the cells. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Heat_map",
  theme: {
    bg: "#09080b",
    ink: "#efe9e4",
    accent: "#ffb21e",
    accent2: "#b8327a",
    font: "IBM Plex Mono",
  },
  fonts: ["IBM Plex Mono:wght@400;500;700"],
  tags: [
    "heatmap",
    "grid",
    "calendar",
    "activity",
    "data",
    "matrix",
    "analytics",
    "usage",
    "cells",
    "temperature",
    "schedule",
  ],
  word: "Pulse",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U } = lay;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "heat", w, h, {
        lx: 0.55,
        ly: 0.5,
        tint: mix(theme.ink, theme.accent, 0.3),
        mottle: 0.7,
      }) as CanvasImageSource,
      0,
      0,
    );
    light(
      ctx,
      lay.gx + (lay.cw * lay.cols) / 2,
      lay.gy + (lay.ch * lay.rows) / 2,
      Math.max(w, h) * 0.5,
      theme.accent2,
      0.08,
    );

    const cols = ramp(theme);
    // The cursor runs on a clock offset from the loop, so every still catches a held tooltip.
    const clock = (((t - 0.6) % 5) + 5) % 5;
    const stop = Math.floor(clock / STEP + 1e-9) % 4;
    const local = clock - Math.floor(clock / STEP + 1e-9) * STEP;
    const prev = STOPS[(stop + 3) % 4];
    const cur = STOPS[stop];
    const move = ease.inOutCubic(seg(local, 0, 0.3));

    // Cell geometry for a (day, hour-bin) pair.
    const cell = (d: number, b: number) => {
      const c = lay.transposed ? d : b;
      const r = lay.transposed ? b : d;
      return { x: lay.gx + c * lay.cw, y: lay.gy + r * lay.ch };
    };
    const binOf = (hr: number) => Math.floor(hr / lay.bins);
    const curCell = cell(cur[0], binOf(cur[1]));
    const prevCell = cell(prev[0], binOf(prev[1]));
    const cx = prevCell.x + (curCell.x - prevCell.x) * move;
    const cy = prevCell.y + (curCell.y - prevCell.y) * move;

    // Crosshair tint on the cursor's row and column.
    ctx.fillStyle = rgba(theme.ink, 0.045);
    if (lay.transposed) {
      ctx.fillRect(lay.gx - 6 * U, cy, lay.cw * lay.cols + 12 * U, lay.ch);
      ctx.fillRect(cx, lay.gy - 6 * U, lay.cw, lay.ch * lay.rows + 12 * U);
    } else {
      ctx.fillRect(lay.gx - 6 * U, cy, lay.cw * lay.cols + 12 * U, lay.ch);
      ctx.fillRect(cx, lay.gy - 6 * U, lay.cw, lay.ch * lay.rows + 12 * U);
    }

    // Cells: heat = base shaped by a diagonal wave and the landing ripple.
    const landed = seg(local, 0.3, 1.1);
    const pad = Math.min(lay.cw, lay.ch) * 0.1;
    const hot: [number, number, number][] = [];
    for (let d = 0; d < 7; d++)
      for (let b = 0; b < 24 / lay.bins; b++) {
        let base = 0;
        for (let q = 0; q < lay.bins; q++) base += BASE[d][b * lay.bins + q];
        base /= lay.bins;
        const wave = Math.sin(TAU * ((2 * t) / 5 - (b * lay.bins) / 24 - d / 7));
        const cc = lay.transposed ? d : b;
        const rr = lay.transposed ? b : d;
        const cb = binOf(cur[1]);
        const dist = Math.hypot(
          (lay.transposed ? cur[0] : cb) - cc,
          (lay.transposed ? cb : cur[0]) - rr,
        );
        const ring =
          landed > 0 && landed < 1
            ? Math.exp(-((dist - landed * 7) ** 2) / 1.6) * (1 - landed) * 0.35
            : 0;
        const v = clamp(base * (0.82 + 0.18 * wave) + ring);
        const { x, y } = cell(d, b);
        const s = 0.86 + 0.14 * v;
        const cw = (lay.cw - pad) * s;
        const ch = (lay.ch - pad) * s;
        ctx.fillStyle = cols[Math.round(v * 63)];
        ctx.beginPath();
        ctx.roundRect(
          x + (lay.cw - cw) / 2,
          y + (lay.ch - ch) / 2,
          cw,
          ch,
          Math.min(cw, ch) * 0.18,
        );
        ctx.fill();
        if (v > 0.8) hot.push([x + lay.cw / 2, y + lay.ch / 2, v]);
      }
    for (const [x, y, v] of hot)
      glow(ctx, x, y, Math.max(lay.cw, lay.ch) * 0.9, theme.accent, (v - 0.8) * 0.9);

    // Edge labels: days and every third hour.
    ctx.font = font(500, 18 * U, theme.font, PLEX);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.textBaseline = "middle";
    for (let d = 0; d < 7; d++) {
      const { x, y } = cell(d, 0);
      if (lay.transposed) {
        ctx.textAlign = "center";
        ctx.fillText(DAYS[d].toUpperCase(), x + lay.cw / 2, lay.gy - 26 * U);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(DAYS[d].toUpperCase(), lay.L, y + lay.ch / 2);
      }
    }
    for (let hr = 0; hr < 24; hr += lay.bins > 1 ? 6 : 3) {
      const { x, y } = cell(0, binOf(hr));
      const label = String(hr).padStart(2, "0");
      if (lay.transposed) {
        ctx.textAlign = "left";
        ctx.fillText(`${label}:00`, lay.L, y + lay.ch / 2);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(label, x + 2 * U, lay.gy - 24 * U);
      }
    }

    // Cursor: outline, ripple ring, tooltip.
    const cwid = lay.cw;
    const chei = lay.ch;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = Math.max(1, 2.2 * U);
    ctx.beginPath();
    ctx.roundRect(cx - 2 * U, cy - 2 * U, cwid + 4 * U, chei + 4 * U, Math.min(cwid, chei) * 0.22);
    ctx.stroke();
    const value = Math.round((BASE[cur[0]][cur[1]] * PEAK) / 10) * 10;
    const tipA = ease.outCubic(seg(local, 0.18, 0.42));
    const label = `${DAYS[cur[0]]} ${String(cur[1]).padStart(2, "0")}:00`;
    ctx.font = font(500, 34 * U, theme.font, PLEX);
    const valueW = ctx.measureText(fmt(value)).width;
    ctx.font = font(500, 16 * U, theme.font, PLEX);
    const unitW = ctx.measureText("SESSIONS").width;
    ctx.font = font(500, 18 * U, theme.font, PLEX);
    const tw = Math.max(ctx.measureText(label).width, valueW + 10 * U + unitW) + 36 * U;
    const th = 88 * U;
    let tx = cx + cwid / 2 - tw / 2;
    let ty = cy - th - 18 * U;
    if (ty < lay.gy - th * 0.3) ty = cy + chei + 18 * U;
    tx = Math.max(lay.L, Math.min(lay.R - tw, tx));
    ctx.save();
    ctx.globalAlpha = tipA;
    ctx.fillStyle = rgba(mix(theme.bg, theme.ink, 0.1), 0.96);
    ctx.beginPath();
    ctx.roundRect(tx, ty + (1 - tipA) * 8 * U, tw, th, 10 * U);
    ctx.fill();
    ctx.strokeStyle = rgba(theme.ink, 0.18);
    ctx.lineWidth = Math.max(1, U);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = rgba(theme.ink, 0.6);
    ctx.fillText(label.toUpperCase(), tx + 18 * U, ty + 30 * U + (1 - tipA) * 8 * U);
    ctx.fillStyle = theme.ink;
    ctx.font = font(500, 34 * U, theme.font, PLEX);
    const vw = tabular(ctx, fmt(value), tx + 18 * U, ty + 70 * U + (1 - tipA) * 8 * U, "left");
    ctx.fillStyle = theme.accent;
    ctx.font = font(500, 16 * U, theme.font, PLEX);
    ctx.fillText("SESSIONS", tx + 26 * U + vw, ty + 70 * U + (1 - tipA) * 8 * U);
    ctx.restore();

    // Scale bar under the grid.
    const barY = lay.gy + lay.ch * lay.rows + (lay.transposed ? 40 : 56) * U;
    const barW = Math.min(420 * U, lay.cw * lay.cols * 0.5);
    const barX = lay.transposed ? lay.gx : lay.R - barW;
    for (let i = 0; i < 64; i++) {
      ctx.fillStyle = cols[i];
      ctx.fillRect(barX + (i / 64) * barW, barY, barW / 64 + 0.5, 10 * U);
    }
    ctx.font = font(500, 16 * U, theme.font, PLEX);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("0", barX, barY + 36 * U);
    ctx.textAlign = "right";
    ctx.fillText(fmt(PEAK), barX + barW, barY + 36 * U);

    // Title.
    const ty0 = h * (lay.portrait ? 0.08 : 0.13);
    ctx.textAlign = "left";
    ctx.fillStyle = theme.ink;
    ctx.font = font(500, 46 * U, theme.font, PLEX);
    ctx.letterSpacing = `${(-1 * U).toFixed(2)}px`;
    ctx.fillText("Sessions by hour", lay.L, ty0);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.font = font(400, 19 * U, theme.font, PLEX);
    ctx.fillText("Local time, one week", lay.L, ty0 + 34 * U);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.22);
  },
};
