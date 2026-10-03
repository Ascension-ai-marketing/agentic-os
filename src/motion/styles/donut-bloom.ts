import { mix, rgba } from "../engine/color";
import {
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  seg,
  TAU,
  vignette,
} from "../engine/kit";
import type { MotionStyle, Theme } from "../engine/types";
import { envelope, glow, studio, tabular, unit } from "./_s6-helpers";

const SERIF = '"Fraunces", Georgia, serif';
/** Made-up split of a 40-hour week. */
const SLICES = [
  { label: "Deep work", value: 38 },
  { label: "Meetings", value: 22 },
  { label: "Review", value: 16 },
  { label: "Learning", value: 14 },
  { label: "Rest", value: 10 },
];
const START = -Math.PI / 2;

function colours(theme: Theme) {
  return [
    theme.accent,
    mix(theme.accent, theme.accent2, 0.5),
    theme.accent2,
    mix(theme.accent2, theme.ink, 0.5),
    mix(theme.accent, theme.bg, 0.42),
  ];
}

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h) * (portrait ? 1.18 : 1);
  if (portrait)
    return {
      U,
      portrait,
      cx: w * 0.5,
      cy: h * 0.44,
      Ro: w * 0.36,
      titleX: w * 0.09,
      titleY: h * 0.12,
      legX: w * 0.09,
      legY: h * 0.68,
      legW: w * 0.82,
      rowH: 84 * U,
    };
  const lw = square ? w * 0.36 : w * 0.3;
  return {
    U,
    portrait,
    cx: square ? w * 0.34 : w * 0.34,
    cy: h * (square ? 0.56 : 0.54),
    Ro: Math.min(h * (square ? 0.31 : 0.36), w * 0.26),
    titleX: square ? w * 0.07 : w * 0.6,
    titleY: square ? h * 0.12 : h * 0.3,
    legX: square ? w * 0.6 : w * 0.6,
    legY: square ? h * 0.36 : h * 0.43,
    legW: lw,
    rowH: (square ? 92 : 88) * U,
  };
}

export const style: MotionStyle = {
  id: "donut-bloom",
  name: "Donut Bloom",
  family: "Data & Diagrams",
  tagline: "A soft editorial donut chart",
  look: "A soft editorial donut: rounded petal segments in rose and peach on plum-black, a serif centre figure and a ruled legend.",
  move: "The segments bloom out of a bud like petals, overshoot and settle; the biggest one lifts out while the centre retells it; then it closes.",
  rules: [
    "Segments are petals: rounded ends, clean gaps, a light outer edge.",
    "Bloom in a stagger, each petal rotating and swelling into place.",
    "One segment lifts at a time; the legend row and the centre follow it.",
    "The centre figure is serif and large; its label is small and quiet.",
    "Every colour is a blend of the two accents, never a rainbow.",
    "The legend is ruled and aligned; percentages share one right edge.",
    "Close back into the bud so the loop starts where it ended.",
  ],
  prompt: `R — References
• Editorial donut charts in annual reports and Apple-style health summaries (search: donut chart rounded segments, petal chart).
• A flower opening in time-lapse: the timing of the bloom.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a tight bud of five petals opens into a donut chart titled "Where the week goes", each segment swelling and rotating into place with a slight overshoot; the centre reads "40 h".
• Middle (1.5–3.5 s): the largest segment lifts outward; its legend row lights up and the centre retells it as "38%".
• End (3.5–5 s): the segment settles and the petals fold back into the bud of the first frame.

S — Style
Looks: {{bg}} plum-black ground with grain and a soft glow behind the chart; petals from {{accent}} through {{accent2}} blends, each with a lighter outer edge; centre figure and title in {{font}}; legend in Inter with hairline rules.
Moves: petals bloom 0.9 s each with a 0.08 s stagger (outBack); the lift is 0.4 s inOutCubic; the centre crossfades; the close is 0.8 s inOutCubic.
Rules:
1. Rounded petal ends and a clean angular gap between segments.
2. Colours are blends of the two accents only.
3. One lifted segment at a time, mirrored in the legend and the centre.
4. Serif centre figure, tabular digits in the legend.
5. The bud of the last frame equals the first.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the percentages add to 100; no petal overlaps its neighbour at rest; the centre text fits inside the hole; the legend never collides with the donut. Fix what fails and render again until every check passes.`,
  ref: "https://datavizproject.com/data-type/donut-chart/",
  theme: {
    bg: "#110b12",
    ink: "#f7eef2",
    accent: "#ff6f9f",
    accent2: "#ffb38a",
    font: "Fraunces",
  },
  fonts: ["Fraunces:opsz,wght@9..144,100..900"],
  tags: [
    "donut",
    "pie",
    "chart",
    "data",
    "percentage",
    "share",
    "breakdown",
    "infographic",
    "flower",
    "soft",
    "elegant",
  ],
  word: "Week",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U, cx, cy, Ro } = lay;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "donut", w, h, {
        lx: 0.3,
        ly: 0.2,
        tint: mix(theme.ink, theme.accent, 0.3),
      }) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, cx, cy, Ro * 2.4, theme.accent, 0.07);

    const cols = colours(theme);
    const total = SLICES.reduce((s, x) => s + x.value, 0);
    const thick = Ro * 0.3;
    const Rm = Ro - thick / 2;

    // Timeline: open at rest, lift the biggest petal, fold into a bud, bloom again.
    const close = ease.inOutCubic(seg(t, 2.7, 3.3));
    const lift = envelope(t, 0.95, 1.3, 2.45, 2.75);
    const petalK = (i: number) =>
      t < 2.7 ? 1 : t < 3.3 ? 1 - close : ease.outBack(seg(t, 3.3 + i * 0.08, 4.2 + i * 0.08));

    // Guide ring with ticks at the segment edges.
    const guide = t < 2.7 ? 1 : t < 3.3 ? 1 - close : ease.outCubic(seg(t, 3.6, 4.4));
    if (guide > 0.01) {
      ctx.strokeStyle = rgba(theme.ink, 0.1 * guide);
      ctx.lineWidth = Math.max(1, U);
      ctx.beginPath();
      ctx.arc(cx, cy, Ro + 24 * U, 0, TAU);
      ctx.stroke();
    }

    let acc = 0;
    const petals = SLICES.map((s, i) => {
      const a0 = START + (acc / total) * TAU;
      acc += s.value;
      const a1 = START + (acc / total) * TAU;
      return { a0, a1, i };
    });

    // Soft shadow under the ring.
    glow(ctx, cx, cy + Ro * 0.08, Ro * 1.35, "#000000", 0.5, "source-over");

    const gapPx = 8 * U;
    for (const p of petals) {
      const i = p.i;
      const k = Math.max(0, petalK(i));
      const kc = clamp(k);
      const mid = (p.a0 + p.a1) / 2;
      const rot = -1.1 * (1 - kc);
      const r = lerp(Ro * 0.22, Rm, Math.min(k, 1.05));
      const th = lerp(thick * 0.42, thick, Math.min(k, 1.04));
      const half = ((p.a1 - p.a0) / 2) * Math.min(k, 1.05);
      const lifted = i === 0 ? lift : 0;
      const ox = Math.cos(mid) * lifted * 24 * U;
      const oy = Math.sin(mid) * lifted * 24 * U;
      const x = cx + ox;
      const y = cy + oy;
      const rc = Math.min(10 * U, th * 0.3);
      const ro = r + th / 2 - rc;
      const ri = Math.max(1, r - th / 2 + rc);
      const gOut = Math.asin(Math.min(0.99, (gapPx / 2 + rc) / ro));
      const gIn = Math.asin(Math.min(0.99, (gapPx / 2 + rc) / ri));
      const a0 = mid + rot - half;
      const a1 = mid + rot + half;
      const c = cols[i];
      const g = ctx.createRadialGradient(x, y, Math.max(0, ri - rc), x, y, ro + rc);
      g.addColorStop(0, mix(c, theme.bg, 0.34));
      g.addColorStop(0.6, c);
      g.addColorStop(1, mix(c, theme.ink, 0.3));
      ctx.fillStyle = g;
      ctx.strokeStyle = g;
      ctx.globalAlpha = clamp(0.45 + kc * 0.55);
      ctx.beginPath();
      if (a1 - gOut > a0 + gOut) {
        // Inset sector, then a round-joined stroke of 2rc: exact rounded corners.
        ctx.arc(x, y, ro, a0 + gOut, a1 - gOut);
        if (a1 - gIn > a0 + gIn) ctx.arc(x, y, ri, a1 - gIn, a0 + gIn, true);
        else ctx.lineTo(x + Math.cos(mid + rot) * ri, y + Math.sin(mid + rot) * ri);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = rc * 2;
        ctx.lineJoin = "round";
        ctx.stroke();
        if (kc > 0.2) {
          ctx.strokeStyle = rgba(theme.ink, 0.26 * kc);
          ctx.lineWidth = Math.max(1, 1.3 * U);
          ctx.beginPath();
          ctx.arc(x, y, ro + rc - 2.5 * U, a0 + gOut + 0.02, a1 - gOut - 0.02);
          ctx.stroke();
        }
      } else {
        ctx.arc(x + Math.cos(mid + rot) * r, y + Math.sin(mid + rot) * r, th * 0.42, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (lifted > 0.01)
        glow(
          ctx,
          cx + Math.cos(mid) * (r + 30 * U),
          cy + Math.sin(mid) * (r + 30 * U),
          Ro * 0.7,
          c,
          0.16 * lifted,
        );
    }

    // Guide ticks at each boundary.
    if (guide > 0.01) {
      ctx.strokeStyle = rgba(theme.ink, 0.35 * guide);
      ctx.lineWidth = Math.max(1, 1.4 * U);
      for (const p of petals) {
        const a = p.a0;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (Ro + 17 * U), cy + Math.sin(a) * (Ro + 17 * U));
        ctx.lineTo(cx + Math.cos(a) * (Ro + 31 * U), cy + Math.sin(a) * (Ro + 31 * U));
        ctx.stroke();
      }
    }

    // Centre: "40 h" then the lifted petal's share.
    const inner = Rm - thick / 2;
    const cA = t < 2 ? 1 - ease.inOutCubic(seg(t, 0.95, 1.2)) : ease.inOutCubic(seg(t, 4.0, 4.35));
    const cB = envelope(t, 1.1, 1.35, 2.55, 2.75);
    const drawCentre = (
      big: string,
      unitText: string,
      sub: string,
      alpha: number,
      colour: string,
    ) => {
      if (alpha <= 0.01) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = theme.ink;
      const size = inner * 0.78;
      ctx.font = font(400, size, theme.font, SERIF);
      ctx.textAlign = "left";
      const bw = ctx.measureText(big).width;
      ctx.font = font(400, size * 0.42, theme.font, SERIF);
      const uw = ctx.measureText(unitText).width;
      const x = cx - (bw + uw + size * 0.04) / 2;
      const y = cy + size * 0.22 + (1 - alpha) * 6 * U;
      ctx.font = font(400, size, theme.font, SERIF);
      ctx.fillText(big, x, y);
      ctx.fillStyle = colour;
      ctx.font = font(400, size * 0.42, theme.font, SERIF);
      ctx.fillText(unitText, x + bw + size * 0.04, y);
      ctx.fillStyle = rgba(theme.ink, 0.55);
      ctx.font = font(500, Math.max(9, size * 0.13), "Inter");
      ctx.letterSpacing = `${(size * 0.02).toFixed(2)}px`;
      ctx.textAlign = "center";
      ctx.fillText(sub, cx, y + size * 0.3);
      ctx.letterSpacing = "0px";
      ctx.restore();
    };
    drawCentre("40", "h", "A WEEK", cA, theme.accent);
    drawCentre("38", "%", "DEEP WORK", cB, theme.accent);

    // Title and ruled legend.
    const L = lay.legX;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(500, (lay.portrait ? 60 : 56) * U, theme.font, SERIF);
    ctx.fillText("Where the week goes", lay.titleX, lay.titleY);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.font = font(500, 22 * U, "Inter");
    ctx.fillText("Share of a 40-hour week", lay.titleX, lay.titleY + 40 * U);

    for (let i = 0; i < SLICES.length; i++) {
      const on = clamp(petalK(i));
      const y = lay.legY + i * lay.rowH;
      const hi = i === 0 ? lift : 0;
      const a = 0.35 + 0.65 * on;
      ctx.fillStyle = rgba(theme.ink, 0.12 + 0.1 * hi);
      ctx.fillRect(L, y + lay.rowH * 0.5, lay.legW, Math.max(1, U));
      ctx.fillStyle = cols[i];
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.roundRect(L, y - 12 * U, 30 * U * (0.4 + 0.6 * on), 12 * U, 6 * U);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(theme.ink, 0.62 + 0.28 * on + 0.1 * hi);
      ctx.font = font(500, 26 * U, "Inter");
      ctx.fillText(SLICES[i].label, L + 48 * U + hi * 6 * U, y);
      ctx.fillStyle = rgba(theme.ink, 0.75 + 0.25 * on);
      ctx.font = font(400, 38 * U, theme.font, SERIF);
      ctx.textAlign = "right";
      const pct = SLICES[i].value;
      tabular(ctx, String(pct), L + lay.legW - 22 * U, y + 2 * U, "right");
      ctx.font = font(400, 22 * U, theme.font, SERIF);
      ctx.fillStyle = hi > 0.01 ? mix(theme.ink, theme.accent, hi) : rgba(theme.ink, 0.5);
      ctx.fillText("%", L + lay.legW, y + 2 * U);
      ctx.textAlign = "left";
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.24);
  },
};
