import { rgba } from "../engine/color";
import {
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  light,
  once,
  rng,
  seg,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle } from "../engine/types";
import { glow, studio, tabular, unit } from "./_s6-helpers";

const WEEKS = 52;
const LO = 72;
const HI = 250;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DRAW_A = 0.25;
const DRAW_B = 2.65;
const OUT_A = 4.1;
const OUT_B = 4.72;

/** Made-up weekly index (Jan = 100): steady growth, an outage dip, a record week. */
const DATA = once("line-draw:data", () => {
  const r = rng(2026);
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < WEEKS; i++) {
    const s = i / (WEEKS - 1);
    let v = 100 + 92 * s * s * (3 - 2 * s) + 22 * s;
    v -= 27 * Math.exp(-((i - 20) ** 2) / 5);
    v += 19 * Math.exp(-((i - 46) ** 2) / 2.2);
    v += (r() - 0.5) * 7;
    a.push(i === 0 ? 100 : v);
    b.push(i === 0 ? 100 : 100 + 30 * s + 5 * Math.sin(s * 8.5) + (r() - 0.5) * 4);
  }
  let peak = 40;
  for (let i = 40; i < WEEKS; i++) if (a[i] > a[peak]) peak = i;
  return { a, b, dip: 20, peak };
});

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h) * (portrait ? 1.22 : 1);
  const L = Math.max(w * (portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
  const R = w - L;
  return {
    U,
    L,
    R,
    portrait,
    kickerY: h * (portrait ? 0.1 : square ? 0.1 : 0.14),
    headY: h * (portrait ? 0.1 : square ? 0.1 : 0.14) + (portrait ? 78 : 70) * U,
    lines: portrait ? ["Readers doubled", "in a year"] : ["Readers doubled in a year"],
    top: h * (portrait ? 0.32 : square ? 0.3 : 0.32),
    bottom: h * (portrait ? 0.82 : square ? 0.86 : 0.85),
    cx0: L,
    cx1: R - (portrait ? 70 : 84) * U,
  };
}

/** Point i (fractional) of a series in screen space. */
function pt(series: number[], f: number, x0: number, x1: number, y0: number, y1: number) {
  const i = Math.max(0, Math.min(WEEKS - 1, f));
  const a = Math.floor(i);
  const b = Math.min(WEEKS - 1, a + 1);
  const k = i - a;
  const v = series[a] + (series[b] - series[a]) * k;
  return {
    x: x0 + (i / (WEEKS - 1)) * (x1 - x0),
    y: y1 - ((v - LO) / (HI - LO)) * (y1 - y0),
    v,
  };
}

function linePath(
  ctx: Ctx2D,
  series: number[],
  f: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  ctx.beginPath();
  const n = Math.floor(f);
  for (let i = 0; i <= n; i++) {
    const p = pt(series, i, x0, x1, y0, y1);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  const head = pt(series, f, x0, x1, y0, y1);
  ctx.lineTo(head.x, head.y);
  return head;
}

export const style: MotionStyle = {
  id: "line-draw",
  name: "Editorial Line Chart",
  family: "Data & Diagrams",
  tagline: "One gold line tells the story",
  look: "A financial-page chart: warm black, a serif headline that states the finding, one gold line with a glowing head and two annotations.",
  move: "The line draws itself week by week with a value flag riding its head; callouts pop as it passes; it holds, then fades to the axes.",
  rules: [
    "The headline states the finding; the chart proves it.",
    "One gold line; the comparison line is a quiet bronze.",
    "The head carries a live value flag in tabular digits.",
    "Callouts pop only when the head reaches them, then stay.",
    "Weekly data keeps its texture: never smooth it into a spline.",
    "The index baseline (100) is the only strong rule; gridlines whisper.",
    "Reset by fading back to the empty axes, never by wiping.",
  ],
  prompt: `R — References
• Financial Times and Economist line charts (search: FT chart style, economist line chart annotation).
• Bloomberg terminal index charts: a baseline at 100, a live value flag.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): under the headline "Readers doubled in a year", a gold line starts drawing itself from the Jan = 100 baseline, a value flag riding its head; the big "+%" figure counts up.
• Middle (1.5–3.5 s): it dips at an outage (a callout pops), climbs to a record week (a second callout pops) and lands at the right edge; everything holds.
• End (3.5–5 s): the line, its area and callouts fade out, leaving the empty axes of the first frame.

S — Style
Looks: {{bg}} warm black with grain; {{ink}} type; the line and its flag in {{accent}} with a soft glow and a fading area beneath; a quiet {{accent2}} comparison line; headline in {{font}} 500, labels in Inter.
Moves: the draw runs 2.4 s inOutSine; callouts scale in with outBack in 0.35 s; the value flag counts in tabular digits; exit is a 0.6 s fade.
Rules:
1. The headline is the takeaway, one line where it fits.
2. One accent line; one quiet comparison.
3. Tabular digits on every number.
4. Annotations have a dot, a leader and two short lines of text.
5. Gridlines are hairlines; the 100 baseline is stronger.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the flag never leaves the frame; callouts never overlap the line or each other; month labels are crisp; the headline has no orphan word. Fix what fails and render again until every check passes.`,
  ref: "https://www.ft.com/chart-doctor",
  theme: {
    bg: "#0d0b09",
    ink: "#f1eadb",
    accent: "#f3c34a",
    accent2: "#8d7a5f",
    font: "Newsreader",
  },
  tags: [
    "line",
    "chart",
    "graph",
    "data",
    "finance",
    "stocks",
    "editorial",
    "annotation",
    "growth",
    "trend",
    "analytics",
  ],
  word: "Index",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U, L, R } = lay;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(studio(theme, "line", w, h, { lx: 0.2, ly: 0.1 }) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.72, h * 0.35, Math.max(w, h) * 0.55, theme.accent, 0.035);

    const { a, b, dip, peak } = DATA;
    const x0 = lay.cx0;
    const x1 = lay.cx1;
    const y0 = lay.top;
    const y1 = lay.bottom;
    const yOf = (v: number) => y1 - ((v - LO) / (HI - LO)) * (y1 - y0);

    // Headline band.
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = font(700, 17 * U, "Inter");
    ctx.letterSpacing = `${(2.6 * U).toFixed(2)}px`;
    ctx.fillStyle = theme.accent;
    ctx.fillText("INDEX, JAN = 100", L, lay.kickerY);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = theme.ink;
    ctx.font = font(500, (lay.portrait ? 64 : 62) * U, theme.font, "Georgia, serif");
    lay.lines.forEach((line, i) => ctx.fillText(line, L, lay.headY + i * 74 * U));

    // Axes: hairline gridlines, a stronger index baseline, labels on the right.
    for (const v of [100, 150, 200, 250]) {
      const y = yOf(v);
      ctx.fillStyle = rgba(theme.ink, v === 100 ? 0.34 : 0.09);
      ctx.fillRect(x0, y - 0.5 * U, R - x0, Math.max(1, (v === 100 ? 1.6 : 1) * U));
      ctx.fillStyle = rgba(theme.ink, 0.45);
      ctx.font = font(500, 19 * U, "Inter");
      ctx.textAlign = "right";
      tabular(ctx, String(v), R, y - 10 * U, "right");
    }

    const f = (WEEKS - 1) * ease.inOutSine(seg(t, DRAW_A, DRAW_B));
    const live = 1 - ease.inOutSine(seg(t, OUT_A, OUT_B));
    const shown = t > DRAW_A && t < OUT_B ? live : 0;
    const head = pt(a, f, x0, x1, y0, y1);

    // Month labels; the month under the head lights up.
    ctx.font = font(500, 18 * U, "Inter");
    ctx.textAlign = "center";
    const step = lay.portrait ? 2 : 1;
    for (let m = 0; m < 12; m += step) {
      const x = x0 + ((m * 4.33 + 1.5) / (WEEKS - 1)) * (x1 - x0);
      const near = shown > 0 ? clamp(1 - Math.abs(head.x - x) / (70 * U)) : 0;
      ctx.fillStyle = rgba(theme.ink, 0.38 + 0.55 * near * shown);
      ctx.fillText(MONTHS[m].toUpperCase(), x, y1 + 40 * U);
    }

    // The comparison series is context: always there, quiet, so the chart never starts empty.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(theme.accent2, 0.85);
    ctx.lineWidth = 2.2 * U;
    const hb = linePath(ctx, b, WEEKS - 1, x0, x1, y0, y1);
    ctx.stroke();
    ctx.fillStyle = rgba(theme.accent2, 1);
    ctx.font = font(500, 18 * U, "Inter");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Peers", hb.x + 12 * U, hb.y);
    ctx.textBaseline = "alphabetic";

    if (shown > 0.001) {
      ctx.save();
      ctx.globalAlpha = shown;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      if (f > 0.001) {
        // Area under the line, fading to nothing at the baseline.
        linePath(ctx, a, f, x0, x1, y0, y1);
        ctx.lineTo(head.x, yOf(LO));
        ctx.lineTo(x0, yOf(LO));
        ctx.closePath();
        const area = ctx.createLinearGradient(0, yOf(230), 0, yOf(LO));
        area.addColorStop(0, rgba(theme.accent, 0.2));
        area.addColorStop(1, rgba(theme.accent, 0));
        ctx.fillStyle = area;
        ctx.fill();

        // Glow pass, then the crisp line.
        ctx.strokeStyle = rgba(theme.accent, 0.14);
        ctx.lineWidth = 11 * U;
        linePath(ctx, a, f, x0, x1, y0, y1);
        ctx.stroke();
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 4 * U;
        linePath(ctx, a, f, x0, x1, y0, y1);
        ctx.stroke();

        // Crosshair from the head to the axis.
        ctx.strokeStyle = rgba(theme.ink, 0.22);
        ctx.lineWidth = Math.max(1, U);
        ctx.setLineDash([3 * U, 5 * U]);
        ctx.beginPath();
        ctx.moveTo(head.x, head.y + 12 * U);
        ctx.lineTo(head.x, y1 + 12 * U);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Callouts pop as the head passes them.
      const callouts = [
        { i: dip, title: "Outage", sub: "WEEK 21", up: true, left: false, reach: 118 },
        {
          i: peak,
          title: "Record week",
          sub: `${Math.round(a[peak])} POINTS`,
          up: true,
          left: false,
          reach: 92,
        },
      ];
      for (const c of callouts) {
        const k = seg(f, c.i - 0.2, c.i + 2.2);
        if (k <= 0) continue;
        const p = pt(a, c.i, x0, x1, y0, y1);
        const pop = ease.outBack(clamp(k * 1.3));
        const draw = ease.outCubic(seg(k, 0.15, 0.8));
        // Never let a callout climb into the headline band.
        const room = p.y - 12 * U - (lay.headY + (lay.lines.length - 1) * 74 * U + 132 * U);
        const reach = (c.up ? -1 : 1) * Math.max(36 * U, Math.min(c.reach * U, room));
        ctx.strokeStyle = rgba(theme.ink, 0.6);
        ctx.lineWidth = 1.4 * U;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + (c.up ? -12 : 12) * U);
        ctx.lineTo(p.x, p.y + (c.up ? -12 : 12) * U + reach * draw);
        ctx.stroke();
        ctx.fillStyle = theme.bg;
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 2 * U;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * U * pop, 0, TAU);
        ctx.fill();
        ctx.stroke();
        const text = ease.outCubic(seg(k, 0.45, 1));
        if (text > 0) {
          const ty = p.y + (c.up ? -12 : 12) * U + reach + (c.up ? -40 : 30) * U;
          ctx.globalAlpha = shown * text;
          ctx.textAlign = c.left ? "left" : "right";
          const tx = p.x + (c.left ? 12 : -12) * U;
          ctx.fillStyle = theme.ink;
          ctx.font = font(500, 30 * U, theme.font, "Georgia, serif");
          ctx.fillText(c.title, tx, ty + (1 - text) * 8 * U);
          ctx.fillStyle = rgba(theme.ink, 0.52);
          ctx.font = font(700, 15 * U, "Inter");
          ctx.letterSpacing = `${(1.8 * U).toFixed(2)}px`;
          ctx.fillText(c.sub, tx, ty + 26 * U + (1 - text) * 8 * U);
          ctx.letterSpacing = "0px";
          ctx.globalAlpha = shown;
        }
      }

      if (f > 0.001) {
        // The head: glow, ring, dot and a value flag.
        glow(ctx, head.x, head.y, 44 * U, theme.accent, 0.55);
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 6.5 * U, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(theme.accent, 0.45);
        ctx.lineWidth = 1.5 * U;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 14 * U, 0, TAU);
        ctx.stroke();

        ctx.font = font(700, 24 * U, "Inter");
        const label = String(Math.round(head.v));
        const tw = 3 * 15.5 * U;
        const fw = tw + 26 * U;
        const fh = 38 * U;
        const fx = Math.min(head.x - fw / 2, R - fw);
        const fy = head.y - fh - 26 * U;
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.roundRect(fx, fy, fw, fh, 6 * U);
        ctx.fill();
        ctx.fillStyle = theme.bg;
        ctx.textBaseline = "middle";
        tabular(ctx, label, fx + fw / 2, fy + fh / 2 + 1 * U, "center");
        ctx.textBaseline = "alphabetic";
      }
      ctx.restore();

      // The finding, counting with the head.
      const gain = Math.max(0, Math.round(head.v - 100));
      const bigAlpha = shown * ease.outCubic(seg(t, DRAW_A, DRAW_A + 0.4));
      ctx.save();
      ctx.globalAlpha = bigAlpha;
      ctx.fillStyle = theme.ink;
      ctx.font = font(500, (lay.portrait ? 118 : 128) * U, theme.font, "Georgia, serif");
      ctx.textAlign = "left";
      const bx = x0 + 4 * U;
      const by = yOf(214);
      const wv = tabular(ctx, `+${gain}`, bx, by, "left");
      ctx.font = font(500, (lay.portrait ? 64 : 70) * U, theme.font, "Georgia, serif");
      ctx.fillStyle = theme.accent;
      ctx.fillText("%", bx + wv + 6 * U, by);
      ctx.fillStyle = rgba(theme.ink, 0.5);
      ctx.font = font(500, 18 * U, "Inter");
      ctx.letterSpacing = `${(2.2 * U).toFixed(2)}px`;
      ctx.fillText("SINCE JANUARY", bx + 4 * U, by + 38 * U);
      ctx.letterSpacing = "0px";
      ctx.restore();
    }

    vignette(ctx, w, h, "#000000", 0.48);
    grain(ctx, w, h, t, 0.24);
  },
};
