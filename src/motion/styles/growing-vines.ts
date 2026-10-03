import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  hash,
  light,
  once,
  seg,
  SERIF,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, fitTracked, glow, mottled, tracked } from "./_s7-helpers";

type Pt = [number, number];

interface Stem {
  pts: Pt[];
  /** Cumulative length at each point. */
  len: number[];
  total: number;
  w0: number;
  w1: number;
  t0: number;
  t1: number;
}

interface Leaf {
  stem: number;
  at: number;
  side: number;
  size: number;
  angle: number;
}

interface Tendril {
  stem: number;
  at: number;
  pts: Pt[];
  len: number[];
  total: number;
}

interface Ornament {
  stems: Stem[];
  leaves: Leaf[];
  tendrils: Tendril[];
  U: number;
  cx: number;
  cy: number;
  top: number;
  root: number;
  wordY: number;
  wordMax: number;
}

/** Cubic Bézier chain (each segment [c1, c2, p]) sampled into points, from p0. */
function chain(p0: Pt, segs: [Pt, Pt, Pt][], n = 40): Pt[] {
  const out: Pt[] = [p0];
  let a = p0;
  for (const [c1, c2, b] of segs) {
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const m = 1 - t;
      out.push([
        m * m * m * a[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * b[0],
        m * m * m * a[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * b[1],
      ]);
    }
    a = b;
  }
  return out;
}

/** Continue a path from its last tangent into a tightening spiral (curvature ramps up). */
function curl(pts: Pt[], length: number, turns: number, dir: number, n = 70): Pt[] {
  const [x1, y1] = pts[pts.length - 1];
  const [x0, y0] = pts[pts.length - 2];
  let th = Math.atan2(y1 - y0, x1 - x0);
  let x = x1;
  let y = y1;
  const ds = length / n;
  // Total turning = turns * TAU with curvature growing quadratically toward the eye.
  const k = (turns * TAU * 3) / length;
  const out = pts.slice();
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    th += dir * k * s * s * ds;
    x += Math.cos(th) * ds;
    y += Math.sin(th) * ds;
    out.push([x, y]);
  }
  return out;
}

function lengths(pts: Pt[]) {
  const len = [0];
  for (let i = 1; i < pts.length; i++)
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return len;
}

/** Point and tangent angle at arc length s along a sampled path. */
function along(pts: Pt[], len: number[], s: number): [number, number, number] {
  let i = 1;
  while (i < len.length - 1 && len[i] < s) i++;
  const f = clamp((s - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]));
  const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
  const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
  return [x, y, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])];
}

/** The whole ornament for a frame size: mirrored whiplash stems, their leaves and tendrils. */
function ornament(w: number, h: number): Ornament {
  return once(`vine-orn@${Math.round(w)}x${Math.round(h)}`, () => {
    const { u, portrait, square } = frameOf(w, h);
    const cx = w / 2;
    const cy = h * (portrait ? 0.52 : 0.53);
    const bw = portrait ? w * 0.43 : square ? w * 0.36 : Math.min(w * 0.34, h * 0.66);
    const bh = portrait ? h * 0.35 : square ? h * 0.34 : h * 0.34;
    const U = Math.min(bw, bh);
    const P = (x: number, y: number): Pt => [cx + x * bw, cy + y * bh];
    const stems: Stem[] = [];
    const mk = (pts: Pt[], w0: number, w1: number, t0: number, t1: number) => {
      const len = lengths(pts);
      stems.push({ pts, len, total: len[len.length - 1], w0: w0 * U, w1: w1 * U, t0, t1 });
    };
    for (const sgn of [1, -1]) {
      const S = (x: number, y: number) => P(sgn * x, y);
      // Main whiplash: out along the base, up the side, over the top, curling down toward the word.
      let main = chain(S(0.03, 1.0), [
        [S(0.32, 1.07), S(0.92, 1.02), S(0.99, 0.5)],
        [S(1.06, -0.02), S(1.0, -0.62), S(0.72, -0.9)],
        [S(0.5, -1.16), S(0.2, -1.12), S(0.16, -0.9)],
      ]);
      main = curl(main, U * 0.26, 1.35, -sgn);
      mk(main, 0.05, 0.01, 0.2, 2.7);
      // Inner stem: hugs the word and ends in a blossom.
      const inner = chain(S(0.03, 1.0), [
        [S(0.2, 0.86), S(0.56, 0.84), S(0.62, 0.5)],
        [S(0.68, 0.2), S(0.6, -0.02), S(0.66, -0.22)],
      ]);
      mk(inner, 0.034, 0.012, 0.45, 2.35);
      // Low flourish: sweeps out beyond the base and ends in a big curl.
      let low = chain(S(0.03, 1.0), [[S(0.45, 1.16), S(1.05, 1.16), S(1.24, 0.9)]]);
      low = curl(low, U * 0.36, 1.25, -sgn);
      mk(low, 0.032, 0.008, 0.6, 2.2);
    }
    // Leaves and tendrils at nodes along each stem, alternating sides.
    const leaves: Leaf[] = [];
    const tendrils: Tendril[] = [];
    stems.forEach((st, si) => {
      const count = si % 3 === 0 ? 8 : si % 3 === 1 ? 5 : 5;
      for (let k = 0; k < count; k++) {
        const f = 0.12 + (0.66 * (k + 0.5)) / count;
        const at = f * st.total;
        const side = k % 2 === 0 ? 1 : -1;
        leaves.push({
          stem: si,
          at,
          side,
          size: U * (0.17 + 0.07 * hash(si, k, 1)) * (1 - f * 0.3),
          angle: side * (0.75 + 0.35 * hash(si, k, 2)),
        });
        if (si % 3 !== 1 && (k % 2 === 1 || (si % 3 === 0 && k === count - 1))) {
          const [x, y, a] = along(st.pts, st.len, at + U * 0.02);
          const dir = -side;
          const base: Pt[] = [
            [x - Math.cos(a + dir * 0.9) * 2, y - Math.sin(a + dir * 0.9) * 2],
            [x, y],
          ];
          const pts = curl(
            base,
            U * (0.16 + 0.08 * hash(si, k, 3)),
            1.1 + 0.4 * hash(si, k, 4),
            dir,
            50,
          ).slice(1);
          const len = lengths(pts);
          tendrils.push({ stem: si, at, pts, len, total: len[len.length - 1] });
        }
      }
    });
    return {
      stems,
      leaves,
      tendrils,
      U,
      cx,
      cy,
      top: cy - bh * 1.02,
      root: cy + bh * 1.0,
      wordY: cy + bh * 0.02,
      wordMax: bw * (portrait ? 1.1 : 1.05),
    };
  });
}

/** A tapered stroke along pts up to arc length upto. */
function taper(ctx: Ctx2D, pts: Pt[], len: number[], upto: number, w0: number, w1: number) {
  if (upto <= 0) return;
  const total = len[len.length - 1];
  const left: Pt[] = [];
  const right: Pt[] = [];
  let tipX = pts[0][0];
  let tipY = pts[0][1];
  for (let i = 0; i < pts.length; i++) {
    const s = Math.min(len[i], upto);
    const j = Math.min(pts.length - 1, Math.max(1, i));
    const a = Math.atan2(pts[j][1] - pts[j - 1][1], pts[j][0] - pts[j - 1][0]);
    let x = pts[i][0];
    let y = pts[i][1];
    if (len[i] > upto) {
      const [px, py] = along(pts, len, upto);
      x = px;
      y = py;
    }
    const k = s / total;
    // Width follows the whole stem, and the growing tip always tapers to a point.
    const tip = clamp((upto - s) / (total * 0.08 + 1));
    const half = ((w0 + (w1 - w0) * Math.pow(k, 0.7)) * (0.35 + 0.65 * tip)) / 2;
    left.push([x + Math.cos(a - Math.PI / 2) * half, y + Math.sin(a - Math.PI / 2) * half]);
    right.push([x + Math.cos(a + Math.PI / 2) * half, y + Math.sin(a + Math.PI / 2) * half]);
    tipX = x;
    tipY = y;
    if (len[i] >= upto) break;
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  ctx.lineTo(tipX, tipY);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** A sinuous, pointed Art Nouveau leaf. open 0..1 unfolds it. */
function leafPath(len: number, open: number, bend: number) {
  const p = new Path2D();
  const n = 18;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const mx = s * len;
    const my = Math.sin(Math.PI * s) * bend * len * 0.16 + s * s * bend * len * 0.1;
    const wv = len * 0.26 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.9) * open;
    pts.push([mx, my - wv]);
  }
  for (let i = n; i >= 0; i--) {
    const s = i / n;
    const mx = s * len;
    const my = Math.sin(Math.PI * s) * bend * len * 0.16 + s * s * bend * len * 0.1;
    const wv = len * 0.2 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.9) * open;
    pts.push([mx, my + wv]);
  }
  p.moveTo(pts[0][0], pts[0][1]);
  for (const q of pts) p.lineTo(q[0], q[1]);
  p.closePath();
  return p;
}

/** Draw the ornament at growth time g (seconds into growth); 99 draws it whole. */
function drawOrnament(
  ctx: Ctx2D,
  o: Ornament,
  g: number,
  theme: Theme,
  gold: CanvasGradient | string,
) {
  const reach = (st: Stem) => ease.inOutSine(seg(g, st.t0, st.t1)) * st.total;
  const enamel = mix(theme.accent2, theme.bg, 0.2);
  const enamelLit = mix(theme.accent2, theme.ink, 0.18);
  // Leaves first so the gold line work sits on top of them.
  for (const lf of o.leaves) {
    const st = o.stems[lf.stem];
    const r = reach(st);
    const age = (r - lf.at) / (st.total * 0.12);
    if (age <= 0) continue;
    const open = ease.outBack(clamp(age));
    const unfold = ease.inOutSine(clamp(age * 0.9));
    const [x, y, a] = along(st.pts, st.len, lf.at);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + lf.angle * unfold);
    const L = lf.size * open;
    // Petiole.
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(0.8, o.U * 0.006);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(L * 0.14, 0);
    ctx.stroke();
    ctx.translate(L * 0.12, 0);
    const path = leafPath(L, 0.25 + 0.75 * unfold, lf.side * 0.8);
    const grad = ctx.createLinearGradient(0, -L * 0.25, 0, L * 0.25);
    grad.addColorStop(0, enamelLit);
    grad.addColorStop(1, enamel);
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(0.7, o.U * 0.0045);
    ctx.stroke(path);
    // Midrib.
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const mx = s * L * 0.92;
      const my = Math.sin(Math.PI * s) * lf.side * 0.8 * L * 0.16 + s * s * lf.side * 0.8 * L * 0.1;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.lineWidth = Math.max(0.6, o.U * 0.003);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = gold;
  for (const st of o.stems) taper(ctx, st.pts, st.len, reach(st), st.w0, st.w1);
  for (const td of o.tendrils) {
    const st = o.stems[td.stem];
    const age = (reach(st) - td.at) / (st.total * 0.2);
    if (age <= 0) continue;
    taper(ctx, td.pts, td.len, ease.outCubic(clamp(age)) * td.total, o.U * 0.014, o.U * 0.004);
  }
  // Blossoms open at the tips of the inner stems once they finish growing.
  for (const st of o.stems) {
    if (st.w1 < o.U * 0.011) continue;
    const bloom = seg(g, st.t1 - 0.05, st.t1 + 0.75);
    if (bloom <= 0) continue;
    const [x, y, a] = along(st.pts, st.len, st.total);
    blossom(ctx, x, y, a, o.U * 0.2, bloom, theme, gold);
  }
  // The crown: one larger blossom opens at the top once both main stems have arrived.
  const crown = seg(g, o.stems[0].t1 + 0.05, o.stems[0].t1 + 0.9);
  if (crown > 0) blossom(ctx, o.cx, o.top, -Math.PI / 2, o.U * 0.3, crown, theme, gold);
  // Gold beads at the eye of every curl.
  for (const st of o.stems) {
    if (st.w1 >= o.U * 0.011) continue;
    const r = reach(st);
    if (r < st.total * 0.995) continue;
    const [x, y] = st.pts[st.pts.length - 1];
    ctx.beginPath();
    ctx.arc(x, y, o.U * 0.012, 0, TAU);
    ctx.fill();
  }
}

/** A stylised Art Nouveau blossom: five cream petals fanning open around a gold heart. */
function blossom(
  ctx: Ctx2D,
  x: number,
  y: number,
  a: number,
  size: number,
  k: number,
  theme: Theme,
  gold: CanvasGradient | string,
) {
  const open = ease.outBack(clamp(k));
  const spread = ease.inOutSine(clamp(k * 1.1));
  const petal = mix(theme.ink, theme.accent, 0.18);
  const inner = mix(theme.ink, theme.bg, 0.25);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  for (let i = 0; i < 5; i++) {
    const f = i / 4 - 0.5;
    ctx.save();
    ctx.rotate(f * 2.3 * spread);
    const L = size * open * (1 - Math.abs(f) * 0.35);
    const path = leafPath(L, 0.9 + 0.5 * spread, f * 0.6);
    const grad = ctx.createLinearGradient(0, 0, L, 0);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, petal);
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(0.7, size * 0.022);
    ctx.stroke(path);
    ctx.restore();
  }
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.1 * open, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** The root: a gold drop where all six stems start. Always present. */
function rootDrop(ctx: Ctx2D, o: Ornament, gold: CanvasGradient | string) {
  ctx.fillStyle = gold;
  ctx.beginPath();
  const rs = o.U * 0.055;
  ctx.moveTo(o.cx, o.root + rs * 1.9);
  ctx.bezierCurveTo(
    o.cx + rs * 1.1,
    o.root + rs * 0.6,
    o.cx + rs * 0.9,
    o.root - rs * 0.6,
    o.cx,
    o.root - rs * 0.7,
  );
  ctx.bezierCurveTo(
    o.cx - rs * 0.9,
    o.root - rs * 0.6,
    o.cx - rs * 1.1,
    o.root + rs * 0.6,
    o.cx,
    o.root + rs * 1.9,
  );
  ctx.fill();
}

function goldOf(ctx: Ctx2D, w: number, h: number, theme: Theme) {
  const g = ctx.createLinearGradient(w * 0.15, 0, w * 0.85, h);
  const hi = mix(theme.accent, theme.ink, 0.45);
  const lo = mix(theme.accent, theme.bg, 0.35);
  g.addColorStop(0, lo);
  g.addColorStop(0.28, hi);
  g.addColorStop(0.46, theme.accent);
  g.addColorStop(0.62, lo);
  g.addColorStop(0.8, hi);
  g.addColorStop(1, theme.accent);
  return g;
}

export const style: MotionStyle = {
  id: "growing-vines",
  name: "Nouveau Vine",
  family: "Nature",
  tagline: "Gold vines on deep green",
  look: "Art Nouveau gold line work on deep green: whiplash stems, curling tendrils and jade enamel leaves framing one word.",
  move: "Mirrored vines grow from one root, sweep around the word and curl into spirals while leaves unfold; then the gold settles back to an engraved ghost.",
  rules: [
    "Whiplash curves: long S-bends that end in tightening spirals.",
    "Perfect mirror symmetry about the word, like a Mucha panel.",
    "Stems taper from root to tip; the growing tip is always a point.",
    "Leaves unfold after the stem passes, rotating out and opening wide.",
    "Gold is a metallic gradient, leaves are jade enamel outlined in gold.",
    "The word is set once in flared caps and never moves.",
    "The loop rests on a faint engraved ghost of the full ornament.",
  ],
  prompt: `R — References
• Art Nouveau ornament: Alphonse Mucha poster frames, Hector Guimard's Paris Métro, whiplash curves (search: art nouveau whiplash vine border).
• Gold leaf and cloisonné enamel.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): the word "{{name}}" in flared caps sits over a faint engraved ghost of an ornament; two gold vines sprout from one root below it.
• Middle (1.5–3.5 s): the vines sweep up around the word in mirrored whiplash curves, tendrils curl into spirals and jade leaves unfold along them.
• End (3.5–5 s): the finished ornament holds, a glint runs along the gold, then it settles back into the faint ghost it grew from.

S — Style
Looks: {{bg}} deep green ground with soft mottling; stems and tendrils in a metallic {{accent}} gradient; leaves in {{accent2}} enamel outlined in gold; the word in {{ink}}, {{font}} caps, tracked slightly.
Moves: every stem is a Bézier chain ending in a spiral whose curvature ramps up; growth eases in and out; leaves unfold 0.3 s after the stem passes (rotate out + open, slight overshoot); tendrils curl as they grow.
Rules:
1. Whiplash S-curves ending in spirals.
2. Mirror symmetry.
3. Tapered stems, pointed growing tips.
4. Leaves unfold after the stem passes.
5. Metallic gold + jade enamel.
6. The ghost of the ornament is the first and last frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the two halves mirror exactly; spirals are round, not stretched; no stem crosses the word; leaves never look like flat ovals. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Art_Nouveau",
  theme: {
    bg: "#09100d",
    ink: "#f1e8d2",
    accent: "#d4a95c",
    accent2: "#3e7d61",
    font: "Marcellus",
  },
  fonts: ["Marcellus"],
  tags: [
    "art nouveau",
    "vine",
    "vines",
    "botanical",
    "ornament",
    "gold",
    "frame",
    "floral",
    "growth",
    "elegant",
    "luxury",
    "nature",
  ],
  word: "Flora",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(`vine-ground:${theme.bg}${theme.accent2}`, w, h, (c, W, H) =>
        mottled(c, W, H, theme.bg, theme.accent2, 0.05, 8, 0.02),
      ) as CanvasImageSource,
      0,
      0,
    );
    const o = ornament(w, h);
    light(ctx, o.cx, o.cy, u * 0.95, theme.accent, 0.08);

    // The engraved ghost of the whole ornament: first and last frame.
    const ghost = bake(
      `vine-ghost:${theme.accent}${theme.accent2}${theme.bg}${theme.ink}`,
      w,
      h,
      (c, W, H) => drawOrnament(c, ornament(W, H), 99, theme, mix(theme.accent, theme.bg, 0.2)),
    );
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.drawImage(ghost as CanvasImageSource, 0, 0);
    ctx.restore();

    const gold = goldOf(ctx, w, h, theme);
    rootDrop(ctx, o, gold);
    const live = 1 - ease.inOutSine(seg(t, 4.05, 4.9));
    if (live > 0.001) {
      ctx.save();
      ctx.globalAlpha = live;
      drawOrnament(ctx, o, t, theme, gold);
      ctx.restore();
      // A glint runs out along each main stem while the ornament holds.
      const run = seg(t, 2.95, 3.95);
      if (run > 0 && run < 1) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const spark = glow(mix(theme.accent, theme.ink, 0.6), 0.14);
        for (const st of o.stems) {
          const [x, y] = along(st.pts, st.len, ease.inOutSine(run) * st.total);
          blit(ctx, spark, x, y, o.U * 0.16, Math.sin(Math.PI * run) * 0.85 * live);
        }
        ctx.restore();
      }
    }

    // The word: flared caps, still, centred in the frame the vines make.
    const word = wordFor(theme.name, "Flora", 12).toUpperCase();
    const size = fitTracked(ctx, word, o.wordMax, o.U * 0.46, 400, theme.font, SERIF, 0.08);
    const logo = tintedLogo(theme, theme.accent, o.U * 0.16, o.U * 0.16);
    if (logo)
      ctx.drawImage(
        logo as CanvasImageSource,
        o.cx - o.U * 0.08,
        o.wordY - size * 0.6 - o.U * 0.22,
        o.U * 0.16,
        o.U * 0.16,
      );
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "middle";
    tracked(ctx, word, o.cx, o.wordY, size, 400, theme.font, SERIF, 0.08, "center");

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.28);
  },
};
