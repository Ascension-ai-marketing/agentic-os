import { mix, rgba } from "../engine/color";
import {
  bake,
  ease,
  font,
  frameOf,
  hash,
  lerp,
  light,
  LOOP,
  once,
  seg,
  TAU,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";
import { finish, stock, tooth, tracked, trackedWidth } from "./_s3-helpers";

const FAMILY = "Big Shoulders Display";
const FALLBACK = '"Oswald", "Arial Narrow", Impact, sans-serif';

/** The wedge strikes twice a loop: drive in hard, hold, pull back slowly. */
function strike(t: number) {
  const local = t % (LOOP / 2);
  const drive = ease.outExpo(seg(local, 0.2, 0.52));
  const back = ease.inOutCubic(seg(local, 1.7, 2.42));
  const hit = local - 0.3;
  const decay = hit > 0 ? Math.exp(-hit * 8) : 0;
  return { reach: drive * (1 - back), decay, local };
}

type Geo = {
  u: number;
  circle: [number, number, number];
  wedgeAngle: number;
  wedgeHalf: number;
  band: { x: number; y: number; a: number; half: number };
  rays: { x: number; y: number; a0: number; a1: number };
  portrait: boolean;
};

function geo(w: number, h: number): Geo {
  const { u, portrait, square } = frameOf(w, h);
  if (portrait)
    return {
      u,
      circle: [w * 0.66, h * 0.27, u * 0.28],
      wedgeAngle: -0.16,
      wedgeHalf: u * 0.1,
      band: { x: w * 0.5, y: h * 0.76, a: -0.36, half: u * 0.13 },
      rays: { x: 0, y: h * 0.62, a0: -1.45, a1: -0.42 },
      portrait,
    };
  if (square)
    return {
      u,
      circle: [w * 0.7, h * 0.3, u * 0.2],
      wedgeAngle: -0.14,
      wedgeHalf: u * 0.08,
      band: { x: w * 0.52, y: h * 0.77, a: -0.36, half: u * 0.105 },
      rays: { x: 0, y: h * 0.86, a0: -1.45, a1: -0.5 },
      portrait,
    };
  return {
    u,
    circle: [w * 0.76, h * 0.31, u * 0.25],
    wedgeAngle: -0.13,
    wedgeHalf: u * 0.1,
    band: { x: w * 0.55, y: h * 0.79, a: -0.33, half: u * 0.12 },
    rays: { x: 0, y: h * 0.98, a0: -1.46, a1: -0.62 },
    portrait,
  };
}

/** The stretch of the band's centre line whose text box stays inside the frame. */
function span(w: number, h: number, G: Geo, capH: number) {
  return once(`constr-span:${Math.round(w)}x${Math.round(h)}:${Math.round(capH)}`, () => {
    const { x, y, a } = G.band;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = G.u * 0.05;
    const inside = (d: number) => {
      for (const n of [-capH * 0.62, capH * 0.62]) {
        const px = x + c * d - s * n;
        const py = y + s * d + c * n;
        if (px < m || px > w - m || py < m || py > h - m) return false;
      }
      return true;
    };
    let lo = 0;
    let hi = 0;
    const stepD = Math.max(w, h) / 400;
    while (inside(lo - stepD) && lo > -2 * Math.max(w, h)) lo -= stepD;
    while (inside(hi + stepD) && hi < 2 * Math.max(w, h)) hi += stepD;
    return [lo, hi] as [number, number];
  });
}

export const style: MotionStyle = {
  id: "constructivist",
  name: "Constructivist Poster",
  family: "Design Movements",
  tagline: "A red wedge, a loudhailer",
  look: "Soviet avant-garde poster: a red wedge driving into a cream circle, loudhailer rays, condensed type on a red diagonal.",
  move: "The wedge drives into the circle with a jolt and pulls back slowly; the rays turn out of the corner; the headline holds.",
  rules: [
    "One steep diagonal carries the headline; nothing important sits level.",
    "Red, cream and black; bright red only for the wedge and the band.",
    "The wedge drives in fast (expo) and pulls back slowly (cubic).",
    "Each hit gives the circle a recoil and the frame a short jolt.",
    "Rays are muted, turn exactly one pattern repeat per loop, clipped to their fan.",
    "Type is heavy, condensed, upper case, tracked a little, on the band.",
    "Printed tooth and grain; edges stay hard.",
  ],
  prompt: `R — References
• El Lissitzky, "Beat the Whites with the Red Wedge" (1919).
• Rodchenko's 1924 "Books" poster: type on diagonals, a loudhailer of rays (search: Rodchenko Lengiz poster).
• Gustav Klutsis and the Stenberg brothers: hard diagonals, heavy condensed caps.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): a red wedge drives into a cream circle; the circle recoils and the frame jolts; muted rays turn out of the corner.
• Middle (1.2–2.5 s): the headline "{{name}}" holds on its red diagonal band while the wedge pulls slowly back.
• End (2.5–5 s): a second strike, a second jolt, then the wedge pulls back to exactly where the loop began.

S — Style
Looks: {{bg}} ground with printed tooth; {{accent}} wedge and band; rays in muted red and cream; {{ink}} circle and type; {{font}} (or Big Shoulders Display 900), upper case, condensed, tracked +4%.
Moves: the wedge strikes twice per loop with an expo drive in 0.3 s and a cubic pull-back; the circle recoils and settles; the jolt decays in 0.3 s; the rays turn one repeat per loop inside a fixed fan.
Rules:
1. One diagonal governs the layout.
2. Three colours: red, cream, black.
3. Strikes are fast, returns are slow.
4. Recoil and jolt on every hit.
5. Type sits on the band, never floating.
6. Hard edges, printed texture.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the headline is never clipped on its diagonal; the wedge reads apart from the rays; the jolt is short and small; the circle and wedge read at tile size. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Beat_the_Whites_with_the_Red_Wedge",
  theme: {
    bg: "#100e0d",
    ink: "#efe3cc",
    accent: "#d8281d",
    accent2: "#8a8174",
    font: FAMILY,
  },
  fonts: ["Big Shoulders Display:wght@600..900"],
  tags: [
    "constructivist",
    "constructivism",
    "soviet",
    "russian",
    "avant-garde",
    "propaganda",
    "poster",
    "diagonal",
    "red",
    "rays",
    "lissitzky",
    "rodchenko",
    "design movement",
  ],
  word: "Avant-Garde",
  render(ctx, t, theme, w, h) {
    const G = geo(w, h);
    const { u } = G;
    ctx.drawImage(
      bake(
        `constr-stock:${theme.bg}${theme.ink}`,
        w,
        h,
        stock(theme, 11, 1, 0.8),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.75, h * 0.28, Math.max(w, h) * 0.7, theme.ink, 0.07);

    const S = strike(t);
    const shake = S.decay * u * 0.008;
    const f = Math.floor(S.local * 60);
    ctx.save();
    ctx.translate(shake * (hash(f, 3) * 2 - 1), shake * (hash(f, 7) * 2 - 1));

    // Rays: a muted fan out of the left edge, turning one repeat per loop.
    {
      const { x: ox, y: oy, a0, a1 } = G.rays;
      const n = 14;
      const step = (a1 - a0) / n;
      const turn = 4 * step * (t / LOOP);
      const R = Math.hypot(w, h) * 1.3;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, R, a0, a1);
      ctx.closePath();
      ctx.clip();
      const deep = mix(theme.accent, theme.bg, 0.62);
      const pale = mix(theme.ink, theme.bg, 0.8);
      for (let i = -4; i < n + 1; i += 2) {
        const s0 = a0 + i * step + turn;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.arc(ox, oy, R, s0, s0 + step * 0.9);
        ctx.closePath();
        ctx.fillStyle = ((i % 4) + 4) % 4 === 0 ? deep : pale;
        ctx.fill();
      }
      ctx.restore();
    }

    // Hairline construction rules parallel to the band.
    const bc = Math.cos(G.band.a);
    const bs = Math.sin(G.band.a);
    ctx.strokeStyle = rgba(theme.ink, 0.35);
    ctx.lineWidth = Math.max(1, u * 0.002);
    ctx.beginPath();
    for (const off of [-G.band.half * 1.7, G.band.half * 1.45]) {
      const px = G.band.x - bs * off;
      const py = G.band.y + bc * off;
      ctx.moveTo(px - bc * w * 2, py - bs * w * 2);
      ctx.lineTo(px + bc * w * 2, py + bs * w * 2);
    }
    ctx.stroke();

    // The cream circle, recoiling along the wedge on each hit.
    const [cx0, cy0, cr] = G.circle;
    const wc = Math.cos(G.wedgeAngle);
    const ws = Math.sin(G.wedgeAngle);
    const recoil = S.decay * cr * 0.07;
    const cx = cx0 + wc * recoil;
    const cy = cy0 + ws * recoil;
    ctx.fillStyle = rgba("#000000", 0.35);
    ctx.beginPath();
    ctx.arc(cx + u * 0.012, cy + u * 0.016, cr, 0, TAU);
    ctx.fill();
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, TAU);
    ctx.fill();
    // A black bar across the circle, square to the band.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, TAU);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(G.band.a + Math.PI / 2);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(-cr, cr * 0.48, cr * 2, cr * 0.13);
    ctx.restore();

    // The wedge: from off-frame left, tip driving into the circle.
    {
      const along = lerp(-cr * 1.12, cr * 0.1, S.reach);
      const tx = cx0 + wc * along;
      const ty = cy0 + ws * along;
      const back = Math.hypot(w, h);
      const bx = tx - wc * back;
      const by = ty - ws * back;
      const half = G.wedgeHalf;
      ctx.fillStyle = rgba("#000000", 0.35);
      ctx.beginPath();
      ctx.moveTo(tx + u * 0.01, ty + u * 0.014);
      ctx.lineTo(bx - ws * half + u * 0.01, by + wc * half + u * 0.014);
      ctx.lineTo(bx + ws * half + u * 0.01, by - wc * half + u * 0.014);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx - ws * half, by + wc * half);
      ctx.lineTo(bx + ws * half, by - wc * half);
      ctx.closePath();
      ctx.fill();
    }

    // The band and the headline on it.
    const word = wordFor(theme.name, "Avant-Garde", 14).toUpperCase();
    const half = G.band.half;
    const capH = half * 1.12;
    const [lo, hi] = span(w, h, G, capH);
    ctx.save();
    ctx.translate(G.band.x, G.band.y);
    ctx.rotate(G.band.a);
    ctx.fillStyle = rgba("#000000", 0.35);
    ctx.fillRect(-w * 2, -half + u * 0.014, w * 4, half * 2);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(-w * 2, -half, w * 4, half * 2);
    const track = 0.04;
    ctx.font = font(900, 100, theme.font, FALLBACK);
    const w100 = trackedWidth(ctx, word, 100 * track);
    const room = (hi - lo) * 0.9;
    const size = Math.max(8, Math.min((100 * room) / w100, capH / 0.72));
    ctx.font = font(900, size, theme.font, FALLBACK);
    const tw = trackedWidth(ctx, word, size * track);
    const x0 = (lo + hi) / 2 - tw / 2;
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "alphabetic";
    tracked(ctx, word, x0, size * 0.36, size * track);
    // Caption under the band.
    const cap = Math.max(7, u * 0.024);
    ctx.font = font(800, cap, theme.font, FALLBACK);
    ctx.fillStyle = rgba(theme.ink, 0.88);
    tracked(ctx, "No. 1 — 1919", x0, half + cap * 1.6, cap * 0.14);
    ctx.fillStyle = theme.accent;
    tracked(ctx, "→", x0 + tw, half + cap * 1.6, 0, "right");
    ctx.restore();

    ctx.restore();

    const mark = tintedLogo(theme, theme.ink, u * 0.075, u * 0.075);
    if (mark) ctx.drawImage(mark as CanvasImageSource, u * 0.05, u * 0.05);

    tooth(ctx, w, h, 0.5, 11);
    finish(ctx, w, h, t, 0.45, 0.32);
  },
};
