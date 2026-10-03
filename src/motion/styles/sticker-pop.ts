import { mix, rgba } from "../engine/color";
import {
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkStock, inkOn, loopT, setType, widthOf } from "./_s8-helpers";

const FACE = '"Bricolage Grotesque", "Inter", sans-serif';

type Shape = "rect" | "circle" | "burst" | "pill" | "star" | "tag";
interface Sticker {
  shape: Shape;
  /** Centre in stage units (0..1). */
  x: number;
  y: number;
  /** Half-size in units of the short side. */
  rw: number;
  rh: number;
  rot: number;
  fill: "accent" | "accent2" | "ink" | "dark";
  lines: string[];
  /** Corner the peel starts from, as an angle (radians) from the centre. */
  peelAt: number;
  /** A corner that stays a little lifted while the sticker is down. */
  curl?: number;
}

const POP0 = 0.2;
const POP_GAP = 0.27;
const PEEL0 = 3.45;
const PEEL_GAP = 0.19;
const PEEL = 0.36;
const LIFT = 0.2;

function stickers(word: string, mode: "wide" | "square" | "portrait"): Sticker[] {
  const W = word.toUpperCase();
  if (mode === "portrait")
    return [
      {
        shape: "rect",
        x: 0.5,
        y: 0.5,
        rw: 0.4,
        rh: 0.17,
        rot: -0.07,
        fill: "accent",
        lines: [W],
        peelAt: -0.7,
      },
      {
        shape: "circle",
        x: 0.24,
        y: 0.2,
        rw: 0.17,
        rh: 0.17,
        rot: 0.18,
        fill: "ink",
        lines: ["NEW"],
        peelAt: -2.3,
        curl: 0.2,
      },
      {
        shape: "burst",
        x: 0.74,
        y: 0.28,
        rw: 0.21,
        rh: 0.21,
        rot: -0.12,
        fill: "accent2",
        lines: ["100%", "CODE"],
        peelAt: -0.8,
      },
      {
        shape: "pill",
        x: 0.36,
        y: 0.76,
        rw: 0.32,
        rh: 0.075,
        rot: 0.08,
        fill: "dark",
        lines: ["5-SEC LOOP"],
        peelAt: 2.6,
      },
      {
        shape: "star",
        x: 0.8,
        y: 0.7,
        rw: 0.13,
        rh: 0.13,
        rot: 0.26,
        fill: "ink",
        lines: [],
        peelAt: -1.2,
      },
      {
        shape: "tag",
        x: 0.62,
        y: 0.9,
        rw: 0.2,
        rh: 0.07,
        rot: -0.1,
        fill: "accent",
        lines: ["SEAMLESS"],
        peelAt: 0.4,
        curl: 0.16,
      },
    ];
  if (mode === "square")
    return [
      {
        shape: "rect",
        x: 0.5,
        y: 0.5,
        rw: 0.36,
        rh: 0.15,
        rot: -0.07,
        fill: "accent",
        lines: [W],
        peelAt: -0.6,
      },
      {
        shape: "circle",
        x: 0.13,
        y: 0.14,
        rw: 0.13,
        rh: 0.13,
        rot: 0.18,
        fill: "ink",
        lines: ["NEW"],
        peelAt: -2.3,
        curl: 0.2,
      },
      {
        shape: "burst",
        x: 0.86,
        y: 0.2,
        rw: 0.15,
        rh: 0.15,
        rot: -0.12,
        fill: "accent2",
        lines: ["100%", "CODE"],
        peelAt: -0.8,
      },
      {
        shape: "pill",
        x: 0.27,
        y: 0.86,
        rw: 0.24,
        rh: 0.062,
        rot: 0.08,
        fill: "dark",
        lines: ["5-SEC LOOP"],
        peelAt: 2.6,
      },
      {
        shape: "star",
        x: 0.87,
        y: 0.84,
        rw: 0.1,
        rh: 0.1,
        rot: 0.26,
        fill: "ink",
        lines: [],
        peelAt: -1.2,
      },
      {
        shape: "tag",
        x: 0.5,
        y: 0.1,
        rw: 0.14,
        rh: 0.052,
        rot: -0.1,
        fill: "accent",
        lines: ["SEAMLESS"],
        peelAt: 0.4,
        curl: 0.16,
      },
    ];
  return [
    {
      shape: "rect",
      x: 0.5,
      y: 0.53,
      rw: 0.44,
      rh: 0.19,
      rot: -0.07,
      fill: "accent",
      lines: [W],
      peelAt: -0.6,
    },
    {
      shape: "circle",
      x: 0.1,
      y: 0.27,
      rw: 0.15,
      rh: 0.15,
      rot: 0.18,
      fill: "ink",
      lines: ["NEW"],
      peelAt: -2.3,
      curl: 0.2,
    },
    {
      shape: "burst",
      x: 0.9,
      y: 0.3,
      rw: 0.19,
      rh: 0.19,
      rot: -0.12,
      fill: "accent2",
      lines: ["100%", "CODE"],
      peelAt: -0.8,
    },
    {
      shape: "pill",
      x: 0.17,
      y: 0.84,
      rw: 0.26,
      rh: 0.07,
      rot: 0.08,
      fill: "dark",
      lines: ["5-SEC LOOP"],
      peelAt: 2.6,
    },
    {
      shape: "star",
      x: 0.88,
      y: 0.83,
      rw: 0.12,
      rh: 0.12,
      rot: 0.26,
      fill: "ink",
      lines: [],
      peelAt: -1.2,
    },
    {
      shape: "tag",
      x: 0.55,
      y: 0.12,
      rw: 0.17,
      rh: 0.065,
      rot: -0.1,
      fill: "accent",
      lines: ["SEAMLESS"],
      peelAt: 0.4,
      curl: 0.16,
    },
  ];
}

/** The sticker's outline, centred at the origin (un-rotated). */
function shapePath(c: Ctx2D, s: Sticker, rw: number, rh: number) {
  c.beginPath();
  switch (s.shape) {
    case "rect":
      c.roundRect(-rw, -rh, rw * 2, rh * 2, Math.min(rw, rh) * 0.28);
      break;
    case "pill":
      c.roundRect(-rw, -rh, rw * 2, rh * 2, rh);
      break;
    case "tag": {
      // A luggage-tag: squared right end, pointed left end.
      const n = rh;
      c.moveTo(-rw, 0);
      c.lineTo(-rw + n, -rh);
      c.lineTo(rw, -rh);
      c.lineTo(rw, rh);
      c.lineTo(-rw + n, rh);
      c.closePath();
      break;
    }
    case "circle":
      c.arc(0, 0, rw, 0, TAU);
      break;
    case "burst": {
      const n = 16;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * TAU - Math.PI / 2;
        const r = i % 2 ? rw * 0.85 : rw;
        if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      break;
    }
    case "star": {
      const n = 5;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * TAU - Math.PI / 2;
        const r = i % 2 ? rw * 0.5 : rw;
        if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      break;
    }
  }
}

function fillOf(s: Sticker, theme: Theme) {
  return s.fill === "accent"
    ? theme.accent
    : s.fill === "accent2"
      ? theme.accent2
      : s.fill === "ink"
        ? mix(theme.ink, "#ffffff", 0.3)
        : mix(theme.bg, "#000000", 0.25);
}

/** Face of the sticker: die-cut white border, vinyl fill, gloss, type. */
function face(
  c: Ctx2D,
  s: Sticker,
  theme: Theme,
  rw: number,
  rh: number,
  border: number,
  family: string,
) {
  const vinyl = fillOf(s, theme);
  const edge = mix(theme.ink, "#ffffff", 0.45);
  shapePath(c, s, rw, rh);
  c.lineJoin = "round";
  c.lineWidth = border * 2;
  c.strokeStyle = edge;
  c.stroke();
  c.fillStyle = edge;
  c.fill();
  shapePath(c, s, rw, rh);
  c.fillStyle = vinyl;
  c.fill();
  // Gloss: a soft diagonal highlight on the vinyl.
  c.save();
  shapePath(c, s, rw, rh);
  c.clip();
  const g = c.createLinearGradient(-rw, -rh, rw * 0.3, rh * 0.6);
  g.addColorStop(0, rgba("#ffffff", 0.2));
  g.addColorStop(0.45, rgba("#ffffff", 0.04));
  g.addColorStop(1, rgba("#000000", 0.1));
  c.fillStyle = g;
  c.fillRect(-rw - border, -rh - border, (rw + border) * 2, (rh + border) * 2);
  c.restore();
  // Type.
  if (s.lines.length) {
    const ink = s.fill === "dark" ? mix(theme.ink, "#ffffff", 0.3) : inkOn(vinyl, theme);
    const boxW =
      (s.shape === "circle" || s.shape === "burst" ? rw * 1.25 : rw * 1.62) -
      (s.shape === "tag" ? rh : 0);
    const boxH =
      (s.shape === "circle" || s.shape === "burst" ? rw * 1.05 : rh * 1.35) / s.lines.length;
    setType(c, 800, 100, family, { fallback: FACE, tracking: 0.01 });
    const widest = Math.max(...s.lines.map((l) => widthOf(c, l)));
    const cap = (c.measureText("H").actualBoundingBoxAscent || 72) / 100;
    const size = Math.min((100 * boxW) / widest, (boxH * 0.86) / cap);
    setType(c, 800, size, family, { fallback: FACE, tracking: 0.01 });
    c.fillStyle = ink;
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    const lineH = size * cap * 1.28;
    const total = lineH * (s.lines.length - 1);
    const dx = s.shape === "tag" ? rh * 0.5 : 0;
    s.lines.forEach((l, i) => {
      const y = -total / 2 + i * lineH + (size * cap) / 2;
      c.fillText(l, dx - widthOf(c, l) / 2, y);
    });
    if (s.shape === "tag") {
      c.fillStyle = mix(theme.bg, "#000000", 0.2);
      c.beginPath();
      c.arc(-rw + rh * 0.95, 0, rh * 0.22, 0, TAU);
      c.fill();
    }
  }
}

/** Half-plane polygon: the side of the fold line (through F, normal d) where (q-F)·d >= 0. */
function halfPlane(
  c: Ctx2D,
  fx: number,
  fy: number,
  dx: number,
  dy: number,
  big: number,
  keep: boolean,
) {
  const ex = -dy;
  const ey = dx;
  const k = keep ? 1 : -1;
  c.beginPath();
  c.moveTo(fx + ex * big, fy + ey * big);
  c.lineTo(fx - ex * big, fy - ey * big);
  c.lineTo(fx - ex * big + dx * big * k, fy - ey * big + dy * big * k);
  c.lineTo(fx + ex * big + dx * big * k, fy + ey * big + dy * big * k);
  c.closePath();
}

/**
 * Draw a sticker peeled back by `p` (distance of the fold from its corner):
 * the flat part, the shadow of the lifted flap, then the flap mirrored over
 * the fold line showing the paper backing.
 */
function peeled(
  c: Ctx2D,
  s: Sticker,
  theme: Theme,
  rw: number,
  rh: number,
  border: number,
  family: string,
  p: number,
  u: number,
) {
  const R = Math.hypot(rw, rh) + border;
  const cxr = Math.cos(s.peelAt);
  const cyr = Math.sin(s.peelAt);
  const reach = s.shape === "rect" || s.shape === "pill" || s.shape === "tag" ? R : rw + border;
  const Cx = cxr * reach * 1.02;
  const Cy = cyr * reach * 1.02;
  const dx = -cxr;
  const dy = -cyr;
  const Fx = Cx + dx * p;
  const Fy = Cy + dy * p;
  const big = R * 4;
  // Flat part.
  c.save();
  halfPlane(c, Fx, Fy, dx, dy, big, true);
  c.clip();
  face(c, s, theme, rw, rh, border, family);
  c.restore();
  if (p <= 0.5) return;
  // Reflection over the fold line: q' = q - 2((q - F)·d) d.
  const a = 1 - 2 * dx * dx;
  const b = -2 * dx * dy;
  const d2 = 1 - 2 * dy * dy;
  const fd = Fx * dx + Fy * dy;
  const e = 2 * fd * dx;
  const f = 2 * fd * dy;
  // Shadow the lifted flap throws on the flat part.
  c.save();
  halfPlane(c, Fx, Fy, dx, dy, big, true);
  c.clip();
  c.save();
  c.transform(a, b, b, d2, e, f);
  halfPlane(c, Fx, Fy, dx, dy, big, false);
  c.clip();
  c.shadowColor = rgba("#000000", 0.55);
  c.shadowBlur = u * 0.02;
  c.shadowOffsetX = dx * u * 0.012;
  c.shadowOffsetY = dy * u * 0.012 + u * 0.006;
  shapePath(c, s, rw + border, rh + border);
  c.fillStyle = rgba("#000000", 0.4);
  c.fill();
  c.restore();
  c.restore();
  // The flap: paper backing, darker toward the fold where it curls.
  c.save();
  c.transform(a, b, b, d2, e, f);
  halfPlane(c, Fx, Fy, dx, dy, big, false);
  c.clip();
  shapePath(c, s, rw + border, rh + border);
  const g = c.createLinearGradient(Fx, Fy, Fx - dx * p, Fy - dy * p);
  g.addColorStop(0, mix(theme.ink, "#8a857c", 0.6));
  g.addColorStop(0.25, mix(theme.ink, "#ffffff", 0.2));
  g.addColorStop(1, mix(theme.ink, "#d9d3c7", 0.5));
  c.fillStyle = g;
  c.fill();
  // Release-liner grain lines.
  c.strokeStyle = rgba("#000000", 0.05);
  c.lineWidth = Math.max(1, u * 0.001);
  for (let i = -6; i <= 6; i++) {
    c.beginPath();
    c.moveTo(-R + (i * R) / 6, -R);
    c.lineTo(-R + (i * R) / 6 + R, R);
    c.stroke();
  }
  c.restore();
  // Highlight on the fold.
  c.save();
  shapePath(c, s, rw + border, rh + border);
  c.clip();
  c.strokeStyle = rgba("#ffffff", 0.5);
  c.lineWidth = Math.max(1, u * 0.0025);
  c.beginPath();
  c.moveTo(Fx - dy * big, Fy + dx * big);
  c.lineTo(Fx + dy * big, Fy - dx * big);
  c.stroke();
  c.restore();
}

export const style: MotionStyle = {
  id: "sticker-pop",
  name: "Sticker Pop",
  family: "Type & Editorial",
  tagline: "Die-cut vinyl stickers",
  look: "Die-cut vinyl stickers slapped on a dark matte surface: thick white borders, glossy colour, fat grotesque type, curled corners and real shadows.",
  move: "Stickers slap on one by one with a springy overshoot and a shadow that tightens as they land; then each peels back over its fold and lifts away.",
  rules: [
    "Every sticker has a die-cut white border and a glossy vinyl face.",
    "Slap on with a damped spring: overshoot, settle, never float.",
    "A lifted sticker casts a big soft shadow; a landed one a tight one.",
    "Peel is a real fold: the flap mirrors over the fold line, backing showing.",
    "A curled corner or two stays lifted while the stickers are down.",
    "One word per sticker, set fat and tight, centred in the vinyl.",
    "Colours come from the theme; the surface stays dark and matte.",
  ],
  prompt: `R — References
• Die-cut vinyl sticker bombs on laptops and flight cases (search: sticker bomb laptop, die cut vinyl stickers).
• Sticker peel animations: a flap folding back over itself, paper backing and a shadow under the lift.

I — Idea
Stickers, slapped on and peeled off, 5 seconds, looping seamlessly:
• Beginning (0–1.7 s): on a dark matte surface a big {{accent}} sticker reading "{{name}}" slaps on with a springy overshoot; five more follow — a NEW circle, a 100% CODE burst, a 5-SEC LOOP pill, a star and a SEAMLESS tag.
• Middle (1.7–3.4 s): they hold, one or two corners still curled up, shadows tight.
• End (3.4–5 s): one by one, last first, each peels back from a corner — the flap folds over its fold line, showing the paper backing — and lifts away, leaving the empty surface where the loop began.

S — Style
Looks: {{bg}} matte surface with soft light; stickers in {{accent}}, {{accent2}}, white and black vinyl, each with a thick white die-cut border, a diagonal gloss and a soft shadow; type in Bricolage Grotesque 800 (or {{font}}).
Moves: pop = damped spring (overshoot about 12%, settle in 0.4 s) with a small twist; shadows shrink as a sticker lands; peel = fold line sweeping from a corner over 0.36 s, then the sticker lifts off in 0.2 s.
Rules:
1. Die-cut white borders on every sticker.
2. Damped-spring slaps; nothing floats.
3. Shadows follow height: big and soft in the air, tight on the surface.
4. Peels are real folds with the backing showing.
5. One word per sticker; fat, tight, centred.
6. Grain and a light falloff on the surface.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no sticker text touches its border; the peel flap sits exactly on its fold line; shadows never look like a flat outline; stickers overlap a little but never hide the main word. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Sticker",
  theme: {
    bg: "#121114",
    ink: "#f4f1ea",
    accent: "#ff5c39",
    accent2: "#7c5cff",
    font: "Bricolage Grotesque",
  },
  fonts: ["Bricolage Grotesque:opsz,wght@12..96,200..800"],
  tags: [
    "sticker",
    "stickers",
    "vinyl",
    "pop",
    "peel",
    "badge",
    "label",
    "playful",
    "bold",
    "collage",
    "fun",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { u, portrait, square } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "sticker", w, h, 31, 1.4) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.35, h * 0.2, Math.max(w, h) * 0.8, theme.ink, 0.09);

    const word = wordFor(theme.name, "Motion", 12);
    const list = stickers(word, portrait ? "portrait" : square ? "square" : "wide");
    const family = theme.font;
    const mx = w * 0.08;
    const top = h * (portrait ? 0.07 : 0.1);
    const sw = w - mx * 2;
    const sh = h * (portrait ? 0.86 : 0.8);
    const border = u * 0.014;
    const n = list.length;

    list.forEach((s, i) => {
      const tPop = POP0 + i * POP_GAP;
      const tPeel = PEEL0 + (n - 1 - i) * PEEL_GAP;
      if (t < tPop || t > tPeel + PEEL + LIFT) return;
      const tau = t - tPop;
      // Damped spring for the slap.
      const spring = 1 - Math.exp(-9 * tau) * Math.cos(15 * tau);
      const air = Math.exp(-9 * tau);
      const sc = Math.max(0.001, spring * (1 + 0.35 * air));
      const rot = s.rot + (i % 2 ? 1 : -1) * 0.35 * air;
      const x = mx + s.x * sw;
      const y = top + s.y * sh;
      const rw = s.rw * u;
      const rh = s.rh * u;
      // Peel progress and lift-off.
      const pk = ease.inOutCubic(seg(t, tPeel, tPeel + PEEL));
      const lift = ease.inCubic(seg(t, tPeel + PEEL, tPeel + PEEL + LIFT));
      const R = Math.hypot(rw, rh);
      const rest = s.curl ? s.curl * Math.min(rw, rh) : 0;
      const p = lerp(rest, R * 1.15, pk);

      ctx.save();
      ctx.translate(x + lift * u * 0.04, y - lift * u * 0.14);
      ctx.rotate(rot + lift * 0.3);
      ctx.scale(sc * (1 + lift * 0.08), sc * (1 + lift * 0.08));
      ctx.globalAlpha = 1 - lift;
      // Contact shadow: large and soft in the air, tight on the surface.
      ctx.save();
      const hgt = clamp(air * 1.6 + lift);
      ctx.shadowColor = rgba("#000000", 0.55 - 0.2 * hgt);
      ctx.shadowBlur = u * (0.012 + 0.05 * hgt);
      ctx.shadowOffsetX = u * (0.004 + 0.02 * hgt);
      ctx.shadowOffsetY = u * (0.008 + 0.04 * hgt);
      shapePath(ctx, s, rw + border, rh + border);
      ctx.fillStyle = rgba("#000000", 0.5 * (1 - pk));
      ctx.fill();
      ctx.restore();
      if (p > 0.5) peeled(ctx, s, theme, rw, rh, border, family, p, u);
      else face(ctx, s, theme, rw, rh, border, family);
      ctx.restore();
    });

    // A dropped logo becomes one more small round sticker.
    const mark = tintedLogo(theme, mix(theme.bg, "#000000", 0.3), u * 0.07, u * 0.07);
    if (mark) {
      const tPop = POP0 + n * POP_GAP * 0.5;
      const tOff = PEEL0 - 0.1;
      if (t > tPop && t < tOff) {
        const tau = t - tPop;
        const sc = 1 - Math.exp(-9 * tau) * Math.cos(15 * tau);
        const x = mx + sw * (portrait ? 0.2 : 0.42);
        const y = top + sh * (portrait ? 0.63 : 0.82);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(Math.max(0.001, sc), Math.max(0.001, sc));
        ctx.fillStyle = mix(theme.ink, "#ffffff", 0.4);
        ctx.shadowColor = rgba("#000000", 0.5);
        ctx.shadowBlur = u * 0.015;
        ctx.shadowOffsetY = u * 0.008;
        ctx.beginPath();
        ctx.arc(0, 0, u * 0.065, 0, TAU);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.drawImage(mark as CanvasImageSource, -u * 0.035, -u * 0.035);
        ctx.restore();
      }
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
