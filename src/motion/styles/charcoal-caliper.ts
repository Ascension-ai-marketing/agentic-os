import { rgba } from "../engine/color";
import {
  bake,
  ease,
  font,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

const CUT = 4.8;

/** Charcoal chalkboard: smudged swirls and dust, never a flat colour. */
function board(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const r = rng(1311);
    c.save();
    c.filter = `blur(${Math.max(3, u * 0.02).toFixed(1)}px)`;
    c.lineCap = "round";
    // Eraser wipes: long, shallow arcs of half-cleaned chalk.
    for (let i = 0; i < 16; i++) {
      const x = -w * 0.1 + r() * w * 1.1;
      const y = r() * h;
      const len = w * (0.35 + r() * 0.5);
      const bow = (r() - 0.5) * h * 0.35;
      c.strokeStyle = rgba(theme.ink, 0.01 + r() * 0.016);
      c.lineWidth = u * (0.06 + r() * 0.12);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + len * 0.5, y + bow, x + len, y + (r() - 0.5) * h * 0.1);
      c.stroke();
    }
    c.restore();
    // Chalk dust.
    for (let i = 0; i < Math.round((w * h) / 900); i++) {
      c.fillStyle = rgba(theme.ink, 0.03 + r() * 0.09);
      const s = Math.max(0.6, u * 0.0012 * (0.5 + r()));
      c.fillRect(r() * w, r() * h, s, s);
    }
  };
}

/** A tapered brush stroke along sampled points (width peaks in the middle). */
function swash(c: Ctx2D, pts: [number, number][], p: number, width: number, color: string) {
  const n = Math.max(2, Math.floor(pts.length * p));
  if (n < 2) return;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    const [x2, y2] = pts[Math.min(pts.length - 1, i + 1)];
    const [x1, y1] = pts[Math.max(0, i - 1)];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const s = i / (pts.length - 1);
    const wv = width * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, s * 1.1)));
    left.push([x - (dy / len) * wv, y + (dx / len) * wv]);
    right.push([x + (dy / len) * wv, y - (dx / len) * wv]);
  }
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) c.lineTo(x, y);
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
  c.fill();
}

function bezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  n: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const d = t ** 3;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
  return out;
}

export const style: MotionStyle = {
  id: "charcoal-caliper",
  name: "Charcoal Caliper",
  look: "Documentary explainer: a smudged charcoal chalkboard, heavy white grotesque, yellow caliper stats, one orange swash.",
  move: "Bars build one beat at a time, a yellow caliper measures the tallest, the stat pops, a swash underlines one word, hard cut.",
  rules: [
    "Two type sizes only: a label size and a stat 2.6 times bigger.",
    "Title Case, heavy grotesque, white; never all caps, never coloured type.",
    "The caliper spans the full height it claims and draws before its stat pops.",
    "The stat pops 80 ms after the bracket: 0.85 to 1, no fade.",
    "Orange only as strokes: one cursive swash under one title word, once.",
    "One build per beat, then freeze; only the chalk plate slowly pushes in.",
    "No rings, no circles, no fills in the accents; end on a dead hold, then a hard cut.",
  ],
  prompt: `R — References
• Vox-school documentary explainers: a charcoal chalkboard field, white heavy grotesque type, yellow measurement brackets.
• Field-guide plates: one subject, one measured fact.
• Take the grammar, never any network's marks.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping on a hard cut:
• Beginning (0–1.4 s): the title "{{name}} In Motion" sits on a smudged charcoal board; a baseline draws and three bars rise, one beat each.
• Middle (1.4–3.1 s): a yellow caliper measures the tallest bar, then the stat "3×" pops beside it; an orange cursive swash underlines one title word.
• End (3.1–5 s): a dead hold of at least 1.5 s, then a single-frame hard cut back to the title alone.

S — Style
Looks: {{bg}} charcoal board with chalk smudges and dust, {{ink}} {{font}} ExtraBold in Title Case, bars as translucent {{ink}} fills with a 2 px {{ink}} outline, a {{accent}} caliper, one {{accent2}} swash.
Moves: every build is 300–450 ms quint-out, one per beat, then frozen. The caliper draws in 400 ms, the stat pops 80 ms later (0.85 to 1, outBack, no fade). The swash draws in 450 ms. The plate pushes in to 1.05 over the scene.
Rules:
1. Two type sizes only; the stat is 2.6 times the label.
2. The caliper spans exactly the bar's full height, ticks toward the bar, tab toward the stat.
3. Accents are strokes only, under 0.5% of the frame each, never more than two.
4. No rings, circles or ellipses anywhere.
5. The board is never flat: luminance varies a little everywhere.
6. Dead hold at the end, then a hard cut (no crossfade).

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; only two type sizes; the bracket ends exactly at the bar's top and baseline; the stat sits mid-cap on the tab; the swash is under one word only; the board is not flat. Fix what fails and render again until every check passes.`,
  ref: "https://www.youtube.com/@Vox/videos",
  theme: {
    bg: "#0d0d0d",
    ink: "#f4f1ea",
    accent: "#f5e918",
    accent2: "#f0862b",
    font: "Plus Jakarta Sans",
  },
  fonts: ["Plus Jakarta Sans:wght@700;800"],
  tags: [
    "explainer",
    "documentary",
    "vox",
    "chalk",
    "chalkboard",
    "stat",
    "data",
    "chart",
    "measure",
    "numbers",
    "news",
  ],
  word: "Design",
  family: "Data & Diagrams",
  tagline: "Chalkboard stats, yellow calipers",
  render(ctx, t, theme, w, h) {
    const { portrait, u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);

    // The plate pushes in until the cut, then snaps back (hidden by the cut).
    const push = t < CUT ? 1 + 0.05 * (t / CUT) : 1;
    const plate = bake(`caliper:${theme.bg}${theme.ink}`, w, h, board(theme));
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(push, push);
    ctx.drawImage(plate as CanvasImageSource, -w / 2, -h / 2);
    ctx.restore();
    light(ctx, w * 0.5, h * 0.08, Math.max(w, h) * 0.8, theme.ink, 0.05);

    const built = t < CUT;
    const L = Math.max(8, h * (portrait ? 0.036 : 0.06));
    const S = L * 2.6;
    const sw = Math.max(1.2, h * 0.0065);
    const outline = Math.max(1, h * 0.0019);

    // Title (persistent): "<Name> In Motion"; the swash lands under "Motion".
    const lead = `${wordFor(theme.name, "Design", 16)} In `;
    const hero = "Motion";
    ctx.font = font(800, L, theme.font);
    ctx.letterSpacing = `${(-0.018 * L).toFixed(2)}px`;
    let tw = ctx.measureText(lead + hero).width;
    let size = L;
    if (tw > w * 0.84) {
      size = (L * w * 0.84) / tw;
      ctx.font = font(800, size, theme.font);
      tw = ctx.measureText(lead + hero).width;
    }
    const ty = h * (portrait ? 0.14 : 0.16);
    const tx = (w - tw) / 2;
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText(lead + hero, tx, ty);
    const heroX0 = tx + ctx.measureText(lead).width;
    const heroX1 = tx + tw;

    if (built) {
      // Chart geometry.
      const base = h * (portrait ? 0.74 : 0.82);
      const barW = portrait ? w * 0.13 : w * 0.085;
      const gap = portrait ? w * 0.05 : w * 0.042;
      const left = portrait ? w * 0.14 : w * 0.3;
      const heights = portrait ? [0.16, 0.25, 0.38] : [0.22, 0.34, 0.52];
      const barsRight = left + barW * 3 + gap * 2;

      // Baseline.
      const bl = ease.outQuint(seg(t, 0.2, 0.55));
      ctx.fillStyle = rgba(theme.ink, 0.7);
      ctx.fillRect(left - barW * 0.35, base, (barsRight - left + barW * 0.7) * bl, outline);

      // Bars: translucent fill + 2 px outline, one beat each.
      for (let i = 0; i < 3; i++) {
        const grow = ease.outQuint(seg(t, 0.35 + i * 0.3, 0.75 + i * 0.3));
        if (grow <= 0) continue;
        const bh = heights[i] * h * grow;
        const x = left + i * (barW + gap);
        ctx.fillStyle = rgba(theme.ink, 0.1);
        ctx.fillRect(x, base - bh, barW, bh);
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = outline;
        ctx.strokeRect(x + outline / 2, base - bh + outline / 2, barW - outline, bh - outline);
      }

      // Caliper on the tallest bar: tab first, then the arms grow out to the ends.
      const top = base - heights[2] * h;
      const xc = barsRight + (portrait ? w * 0.045 : w * 0.028);
      const mid = (top + base) / 2;
      const cal = ease.outQuint(seg(t, 1.55, 1.95));
      if (cal > 0) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = sw;
        ctx.lineCap = "butt";
        const tick = sw * 3;
        const tab = sw * 3.5;
        ctx.beginPath();
        ctx.moveTo(xc, mid);
        ctx.lineTo(xc + tab * Math.min(1, cal * 3), mid);
        const half = ((base - top) / 2) * cal;
        ctx.moveTo(xc, mid - half);
        ctx.lineTo(xc, mid + half);
        if (cal > 0.96) {
          ctx.moveTo(xc + sw / 2, top + sw / 2);
          ctx.lineTo(xc - tick, top + sw / 2);
          ctx.moveTo(xc + sw / 2, base - sw / 2);
          ctx.lineTo(xc - tick, base - sw / 2);
        }
        ctx.stroke();
      }

      // The stat pops 80 ms after the bracket completes.
      const pop = seg(t, 2.03, 2.25);
      if (pop > 0) {
        const k = lerp(0.85, 1, ease.outBack(pop));
        ctx.save();
        ctx.font = font(800, S, theme.font);
        ctx.letterSpacing = `${(-0.018 * S).toFixed(2)}px`;
        const sx = xc + sw * 3.5 + S * 0.22;
        const cap = S * 0.72;
        ctx.translate(sx, mid);
        ctx.scale(k, k);
        ctx.fillStyle = theme.ink;
        ctx.fillText("3×", 0, cap / 2);
        ctx.restore();
      }

      // One cursive swash under one title word: lead-in, dip, rising tail.
      const sp = ease.outCubic(seg(t, 2.6, 3.05));
      if (sp > 0) {
        const wv = heroX1 - heroX0;
        const yb = ty + size * 0.3;
        const a = bezier(
          [heroX0 - wv * 0.18, yb + size * 0.05],
          [heroX0 - wv * 0.02, yb + size * 0.55],
          [heroX0 + wv * 0.35, yb + size * 0.42],
          [heroX0 + wv * 0.62, yb + size * 0.28],
          40,
        );
        const b = bezier(
          [heroX0 + wv * 0.62, yb + size * 0.28],
          [heroX0 + wv * 0.9, yb + size * 0.16],
          [heroX1 + wv * 0.02, yb + size * 0.05],
          [heroX1 + wv * 0.16, yb - size * 0.42],
          30,
        );
        swash(ctx, [...a, ...b.slice(1)], sp, Math.max(1, h * 0.0025), theme.accent2);
      }
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
    void u;
  },
};
