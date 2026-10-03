import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  font,
  frameOf,
  lerp,
  light,
  LOOP,
  once,
  seg,
  TAU,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle } from "../engine/types";
import { bezierPoints, finish, fitBox, partial, stock, taper, tooth, tracked } from "./_s3-helpers";

const FAMILY = "Federant";
const FALLBACK = '"Cormorant", Georgia, serif';

type P = [number, number];

/** A spiral curl appended to a path: turns `turns` times, shrinking to `end` of its start radius. */
function curl(from: P, heading: number, r0: number, turns: number, dir: 1 | -1, end = 0.18): P[] {
  const out: P[] = [];
  const n = Math.round(40 * turns);
  // Centre of the spiral sits to the side of the heading.
  const cx = from[0] + Math.cos(heading + (dir * Math.PI) / 2) * r0;
  const cy = from[1] + Math.sin(heading + (dir * Math.PI) / 2) * r0;
  const a0 = Math.atan2(from[1] - cy, from[0] - cx);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const r = r0 * Math.pow(end, k);
    const a = a0 + dir * k * turns * TAU;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

type Plant = {
  stem: P[];
  branches: { at: number; pts: P[]; flower: boolean; width: number }[];
  leaves: { at: number; side: 1 | -1; size: number; angle: number }[];
};

type Halo = { cx: number; cy: number; r: number };

function haloOf(w: number, h: number): Halo {
  const { u, portrait, square } = frameOf(w, h);
  return {
    cx: w / 2,
    cy: h * (portrait ? 0.43 : square ? 0.47 : 0.5),
    r: u * (portrait ? 0.31 : square ? 0.26 : 0.29),
  };
}

function pointAt(pts: P[], s: number) {
  const i = Math.min(pts.length - 2, Math.max(0, Math.floor(s * (pts.length - 1))));
  const a = pts[i];
  const b = pts[i + 1];
  return { x: a[0], y: a[1], dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/**
 * Left-hand strands in frame pixels (the right-hand ones are their mirror):
 * a bundle of whiplash lines rooted under the halo that flow up around it on
 * an oval, swaying like hair in water, each ending in a curl.
 */
type Strand = { pts: P[]; weight: number; end: P; endDir: number };
function strands(w: number, h: number, t: number): Strand[] {
  const { u, portrait, wide } = frameOf(w, h);
  const H = haloOf(w, h);
  const deg = Math.PI / 180;
  const sx = wide ? 1.8 : portrait ? 1.08 : 1.3;
  const sy = portrait ? 1.28 : 0.9;
  const root: P = [H.cx - H.r * 0.06, H.cy + H.r * (portrait ? 1.75 : 1.62)];
  const out: Strand[] = [];
  const N = 7;
  for (let k = 0; k < N; k++) {
    const pts: P[] = [];
    const t0 = 96 * deg;
    const t1 = (262 - k * 9) * deg;
    const base = 1.1 + k * 0.068;
    const phase = TAU * (t / LOOP) + k * 0.45;
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const th = t0 + (t1 - t0) * f;
      // Whiplash profile: out, in, out, plus a slow sway.
      const r =
        H.r *
        base *
        (1 + 0.075 * Math.sin((th - t0) * 2.1 + k * 0.25) + 0.028 * Math.sin(th * 3 + phase) * f);
      let x = H.cx + Math.cos(th) * r * sx;
      let y = H.cy + Math.sin(th) * r * sy;
      // The first stretch gathers every strand into the root.
      const g = 1 - smooth(f / 0.18);
      x = lerp(x, root[0], g);
      y = lerp(y, root[1], g);
      pts.push([x, y]);
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 3];
    const heading = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
    // Inner strands curl in toward the halo, outer ones curl outward.
    const dir: 1 | -1 = k < 3 ? 1 : -1;
    const rc = u * (0.018 + k * 0.006);
    const tail = curl(last, heading, rc, 1.15 + (k % 2) * 0.2, dir, 0.2);
    const all = [...pts, ...tail];
    const e = all[all.length - 1];
    const e2 = all[all.length - 4];
    out.push({
      pts: all,
      weight: 1.15 - k * 0.09,
      end: e,
      endDir: Math.atan2(e[1] - e2[1], e[0] - e2[0]),
    });
  }
  return out;
}

const smooth = (x: number) => {
  const k = clamp(x);
  return k * k * (3 - 2 * k);
};

/** A lanceolate leaf with a midrib. */
function leaf(
  c: Ctx2D,
  x: number,
  y: number,
  a: number,
  size: number,
  fill: string,
  vein: string,
  lw: number,
) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(size * 0.25, -size * 0.24, size * 0.72, -size * 0.2, size, size * 0.04);
  c.bezierCurveTo(size * 0.7, size * 0.16, size * 0.25, size * 0.18, 0, 0);
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = vein;
  c.lineWidth = lw;
  c.beginPath();
  c.moveTo(size * 0.04, 0);
  c.quadraticCurveTo(size * 0.5, -size * 0.03, size * 0.94, size * 0.035);
  c.stroke();
  c.restore();
}

/** A side-view lily: three recurved petals opening, long stamens. */
function flower(
  c: Ctx2D,
  x: number,
  y: number,
  a: number,
  size: number,
  open: number,
  petal: string,
  heart: string,
  ink: string,
  lw: number,
) {
  if (open <= 0.001) return;
  c.save();
  c.translate(x, y);
  c.rotate(a);
  // Calyx bud.
  c.fillStyle = ink;
  c.beginPath();
  c.ellipse(size * 0.08, 0, size * 0.12, size * 0.07, 0, 0, TAU);
  c.fill();
  const petalAt = (spread: number, len: number, curlBack: number) => {
    c.save();
    c.rotate(spread);
    c.beginPath();
    c.moveTo(size * 0.1, 0);
    c.bezierCurveTo(len * 0.35, -len * 0.2, len * 0.75, -len * 0.16, len, curlBack * len * 0.3);
    c.bezierCurveTo(len * 0.72, len * 0.1, len * 0.35, len * 0.16, size * 0.1, 0);
    c.fillStyle = petal;
    c.fill();
    c.strokeStyle = ink;
    c.lineWidth = lw;
    c.stroke();
    c.restore();
  };
  const L = size * (0.5 + 0.5 * open);
  const sp = lerp(0.08, 0.62, open);
  // Stamens first, so the front petal sits over them.
  c.strokeStyle = ink;
  c.fillStyle = heart;
  c.lineWidth = lw;
  for (let i = -1; i <= 1; i++) {
    const sa = i * 0.2 * open;
    const sl = size * (0.6 + 0.55 * open);
    c.beginPath();
    c.moveTo(size * 0.12, 0);
    c.quadraticCurveTo(sl * 0.6, sa * sl * 0.4, Math.cos(sa) * sl, Math.sin(sa) * sl);
    c.stroke();
    c.beginPath();
    c.ellipse(Math.cos(sa) * sl, Math.sin(sa) * sl, size * 0.07, size * 0.035, sa, 0, TAU);
    c.fill();
  }
  petalAt(-sp, L, -open);
  petalAt(sp, L, open);
  petalAt(0, L * 1.05, 0);
  c.restore();
}

export const style: MotionStyle = {
  id: "art-nouveau",
  name: "Art Nouveau Whiplash",
  family: "Design Movements",
  tagline: "Whiplash lines, a mosaic halo",
  look: "Mucha and Horta: bundles of ivory whiplash strands framing a mosaic halo, lilies at the tips, a Secession face.",
  move: "Hair-fine whiplash strands grow round the halo and curl, lilies open at their tips, the halo turns, then the strands draw back.",
  rules: [
    "Every line is a whiplash: an S with a tight curl at its end, never a plain arc.",
    "Stroke weight swells and thins like a pen, thick at the root.",
    "The two stems mirror each other; the halo keeps the centre.",
    "Growth eases in and out; leaves unfurl as the tip passes, lilies open last.",
    "The halo's mosaic turns one colour repeat per loop.",
    "Ivory line, sage leaves, rose flowers on a deep green-black ground.",
    "Lettering in a Secession face, centred in the halo.",
  ],
  prompt: `R — References
• Alphonse Mucha's posters: circular halos, mosaic rings, stylised flowers (search: Mucha halo poster).
• Hector Guimard's Paris Métro entrances and Victor Horta's whiplash lines (search: coup de fouet whiplash line).

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–2 s): two ivory stems whip up from the bottom corners in mirrored S-curves, curl at their tips and unfurl leaves as they pass.
• Middle (2–3.8 s): lilies open on the side branches; the mosaic halo behind the word "{{name}}" turns slowly; everything holds.
• End (3.8–5 s): the lilies close and the stems draw back into the corners, leaving the halo and the word as the loop began.

S — Style
Looks: {{bg}} ground with paper fibres; {{ink}} stems as tapered pen strokes; {{accent2}} leaves; {{accent}} lilies; a halo of fine rings and a mosaic of tesserae; lettering in {{font}} (or Federant).
Moves: growth along the stem by arc length with an in-out ease over 1.8 s; leaves scale up as the tip passes; petals swing open with an out-back ease; the halo turns one colour repeat of tesserae per loop.
Rules:
1. Whiplash curves with curls, never plain arcs.
2. Tapered, pen-like stroke weight.
3. Mirror symmetry for the stems.
4. Leaves before flowers; flowers last.
5. The halo turns exactly one colour repeat per loop.
6. Paper texture and grain.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the stems read as whiplash curves at tile size; stroke weight really varies; nothing crosses the word; the halo mosaic is crisp. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Art_Nouveau",
  theme: {
    bg: "#0d110e",
    ink: "#efe5cf",
    accent: "#d98a74",
    accent2: "#8fae8b",
    font: FAMILY,
  },
  fonts: ["Federant", "Cormorant:wght@500;600"],
  tags: [
    "art nouveau",
    "nouveau",
    "mucha",
    "floral",
    "organic",
    "whiplash",
    "botanical",
    "flowers",
    "ornament",
    "1900",
    "elegant",
    "design movement",
  ],
  word: "Nouveau",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ctx.drawImage(
      bake(
        `nouveau-stock:${theme.bg}${theme.ink}`,
        w,
        h,
        stock(theme, 23, 1.1, 1),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w / 2, h * 0.45, Math.max(w, h) * 0.6, theme.accent, 0.07);

    // The strands never vanish: they grow from half length to full and back.
    const grow = ease.inOutSine(seg(t, 0.1, 2.0));
    const recede = ease.inOutCubic(seg(t, 3.7, 4.95));
    const p = 0.5 + 0.5 * grow * (1 - recede);
    // Lilies open once the strands are full and close before they draw back.
    const bloom = ease.outBack(seg(t, 1.85, 2.6)) * (1 - ease.inCubic(seg(t, 3.1, 3.65)));

    // The halo.
    const HALO = haloOf(w, h);
    const hx = HALO.cx;
    const hy = HALO.cy;
    const hr = HALO.r;
    {
      const g = ctx.createRadialGradient(hx, hy, hr * 0.2, hx, hy, hr);
      g.addColorStop(0, rgba(theme.accent2, 0.1));
      g.addColorStop(1, rgba(theme.accent2, 0.03));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, TAU);
      ctx.fill();
      const lw = Math.max(1, u * 0.0022);
      ctx.strokeStyle = rgba(theme.ink, 0.55);
      ctx.lineWidth = lw * 1.4;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = lw;
      ctx.strokeStyle = rgba(theme.ink, 0.3);
      for (const k of [0.94, 0.8, 0.74]) {
        ctx.beginPath();
        ctx.arc(hx, hy, hr * k, 0, TAU);
        ctx.stroke();
      }
      // Mosaic ring: tesserae between 0.8 and 0.94; the colours repeat every three, so turn three per loop.
      const n = 60;
      const turn = ((3 * TAU) / n) * (t / LOOP);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + turn;
        const r = hr * 0.87;
        ctx.save();
        ctx.translate(hx + Math.cos(a) * r, hy + Math.sin(a) * r);
        ctx.rotate(a);
        ctx.fillStyle =
          i % 3 === 0
            ? rgba(theme.accent, 0.8)
            : i % 3 === 1
              ? rgba(theme.accent2, 0.65)
              : rgba(theme.ink, 0.4);
        const s = hr * 0.05;
        ctx.fillRect(-s * 0.9, -s * 0.9, s * 1.8, s * 1.8);
        ctx.restore();
      }
      // Twelve lobes on the inner ring, like a rose window.
      ctx.strokeStyle = rgba(theme.ink, 0.22);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU - (TAU / 12) * (t / LOOP);
        ctx.beginPath();
        ctx.arc(
          hx + Math.cos(a) * hr * 0.74,
          hy + Math.sin(a) * hr * 0.74,
          hr * 0.13,
          a + Math.PI * 0.5,
          a + Math.PI * 1.5,
        );
        ctx.stroke();
      }
    }

    // The word, centred in the halo.
    const word = wordFor(theme.name, "Nouveau", 12);
    const wt = theme.font === FAMILY ? 400 : 600;
    const size = fitBox(ctx, word, hr * 1.2, hr * 0.32, wt, theme.font, FALLBACK);
    ctx.font = font(wt, size, theme.font, FALLBACK);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.fillText(word, hx, hy + size * 0.28);
    const cap = Math.max(7, size * 0.24);
    ctx.font = font(600, cap, "Cormorant", FALLBACK);
    ctx.fillStyle = rgba(theme.accent, 0.95);
    tracked(ctx, "PARIS · 1900", hx, hy + size * 0.28 + cap * 2.1, cap * 0.35, "center");
    const mark = tintedLogo(theme, theme.ink, hr * 0.26, hr * 0.26);
    if (mark) ctx.drawImage(mark as CanvasImageSource, hx - hr * 0.13, hy - size * 0.72 - hr * 0.3);
    ctx.textAlign = "left";

    // The two bundles of strands, mirrored; lilies bloom at the outer tips.
    if (p > 0.002) {
      const S = strands(w, h, t);
      const lw = Math.max(1, u * 0.0018);
      const ink = theme.ink;
      const leafFill = mix(theme.accent2, theme.bg, 0.12);
      const vein = mix(theme.accent2, theme.bg, 0.6);
      for (const side of [1, -1]) {
        ctx.save();
        if (side === -1) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        // Leaves fan out of the root first.
        const root = S[0].pts[0];
        const leafGrow = ease.outBack(clamp(p / 0.25));
        const leaves: [number, number][] = [
          [-2.55, 0.15],
          [-3.05, 0.12],
          [-2.05, 0.1],
        ];
        for (const [a, sz] of leaves)
          leaf(ctx, root[0], root[1], a, u * sz * leafGrow, leafFill, vein, lw);
        ctx.fillStyle = ink;
        S.forEach((st, k) => {
          const q = clamp((p - k * 0.035) / (1 - 6 * 0.035));
          if (q <= 0.001) return;
          const pts = partial(st.pts, ease.inOutSine(q));
          taper(ctx, pts, (s0) => {
            const g = s0 * q;
            return (
              (u * 0.0095 * (1 - 0.82 * g) * (0.7 + 0.42 * Math.sin(g * Math.PI * 2.2)) +
                u * 0.0014) *
              st.weight
            );
          });
        });
        // Lilies at the tips of the two outermost strands, and a bud on a middle one.
        for (const k of [6, 4]) {
          const st = S[k];
          const q = clamp((p - k * 0.035) / (1 - 6 * 0.035));
          if (q < 0.98) continue;
          flower(
            ctx,
            st.end[0],
            st.end[1],
            st.endDir,
            u * (k === 6 ? 0.092 : 0.075),
            bloom,
            theme.accent,
            mix(theme.accent, theme.ink, 0.55),
            ink,
            lw,
          );
        }
        ctx.restore();
      }
    }

    tooth(ctx, w, h, 0.4, 23);
    finish(ctx, w, h, t, 0.5, 0.3);
  },
};
