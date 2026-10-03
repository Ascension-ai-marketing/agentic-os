import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  font,
  frameOf,
  grain,
  hash,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { logoFor, tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { addGlow, fitText, noiseTile, tnoise } from "./_s5-helpers";

const SCRIPT = "Neonderthaw";
const CAPS = "Tilt Neon";
const SCRIPT_FALLBACK = '"Brush Script MT", "Segoe Script", cursive';
const CAPS_FALLBACK = '"Arial Rounded MT Bold", "Helvetica Neue", sans-serif';
const SUB = "ON AIR";

interface Plan {
  u: number;
  outline: boolean;
  family: string;
  weight: number;
  word: string;
  size: number;
  /** Baseline origin of the word. */
  wx: number;
  wy: number;
  /** Ink box of the word. */
  box: { x: number; y: number; w: number; h: number };
  tube: number;
  subSize: number;
  spacing: number;
  sx: number;
  sy: number;
  subBox: { x: number; y: number; w: number; h: number };
  board: { x: number; y: number; w: number; h: number; r: number };
}

function plan(ctx: Ctx2D, theme: Theme, w: number, h: number): Plan {
  const { u, portrait, square } = frameOf(w, h);
  const outline = theme.font !== SCRIPT;
  const family = outline ? theme.font : SCRIPT;
  const weight = outline ? 600 : 400;
  const fallback = outline ? undefined : SCRIPT_FALLBACK;
  const word = wordFor(theme.name, "Motion", 12);
  const maxW = portrait ? w * 0.86 : square ? w * 0.72 : w * 0.54;
  const maxH = portrait ? h * 0.17 : square ? h * 0.28 : h * 0.33;
  ctx.letterSpacing = "0px";
  const fit = fitText(ctx, word, maxW, maxH, u * 0.5, weight, family, fallback);
  const size = fit.size;
  ctx.font = font(weight, size, family, fallback);
  const m = ctx.measureText(word);
  const L = m.actualBoundingBoxLeft;
  const R = m.actualBoundingBoxRight;
  const A = m.actualBoundingBoxAscent;
  const D = m.actualBoundingBoxDescent;

  const subSize = clamp(size * 0.2, u * (portrait ? 0.06 : 0.042), u * 0.075);
  const spacing = subSize * 0.42;
  ctx.font = font(400, subSize, CAPS, CAPS_FALLBACK);
  ctx.letterSpacing = `${spacing.toFixed(2)}px`;
  const sm = ctx.measureText(SUB);
  ctx.letterSpacing = "0px";
  // Tracking adds space after the last letter too: trim it when centring.
  const sL = sm.actualBoundingBoxLeft;
  const sR = sm.actualBoundingBoxRight - spacing;
  const sA = sm.actualBoundingBoxAscent;
  const sD = sm.actualBoundingBoxDescent;

  const gap = size * 0.2 + u * 0.02;
  const stackH = A + D + gap + sA + sD;
  const cy = h * (portrait ? 0.45 : 0.47);
  const cx = w * 0.5;
  const top = cy - stackH / 2;
  const wy = top + A;
  const wx = cx - (R - L) / 2;
  const sy = wy + D + gap + sA;
  const sx = cx - (sR - sL) / 2;
  const box = { x: wx - L, y: wy - A, w: L + R, h: A + D };
  const subBox = { x: sx - sL, y: sy - sA, w: sL + sR, h: sA + sD };
  const pad = u * 0.06;
  const bx0 = Math.min(box.x, subBox.x) - pad;
  const bx1 = Math.max(box.x + box.w, subBox.x + subBox.w) + pad;
  const by0 = box.y - pad;
  const by1 = subBox.y + subBox.h + pad;
  return {
    u,
    outline,
    family,
    weight,
    word,
    size,
    wx,
    wy,
    box,
    tube: outline ? size * 0.05 : size * 0.028,
    subSize,
    spacing,
    sx,
    sy,
    subBox,
    board: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, r: u * 0.022 },
  };
}

type Part = "main" | "sub";

/** Draw one element's tubes. `hot` = lit tube (colour rim + white core), else a flat fill in `color`. */
function tubes(c: Ctx2D, p: Plan, part: Part, color: string, hot: string | null) {
  c.save();
  c.lineJoin = "round";
  c.lineCap = "round";
  if (part === "main") {
    c.font = font(p.weight, p.size, p.family, p.outline ? undefined : SCRIPT_FALLBACK);
    c.letterSpacing = "0px";
    if (p.outline) {
      c.lineWidth = p.tube;
      c.strokeStyle = color;
      c.strokeText(p.word, p.wx, p.wy);
      if (hot) {
        c.lineWidth = p.tube * 0.42;
        c.strokeStyle = hot;
        c.strokeText(p.word, p.wx, p.wy);
      }
    } else {
      if (hot) {
        c.lineWidth = p.tube * 0.9;
        c.strokeStyle = color;
        c.strokeText(p.word, p.wx, p.wy);
      }
      c.fillStyle = hot ?? color;
      c.fillText(p.word, p.wx, p.wy);
    }
  } else {
    c.font = font(400, p.subSize, CAPS, CAPS_FALLBACK);
    c.letterSpacing = `${p.spacing.toFixed(2)}px`;
    if (hot) {
      c.lineWidth = p.subSize * 0.05;
      c.strokeStyle = color;
      c.strokeText(SUB, p.sx, p.sy);
    }
    c.fillStyle = hot ?? color;
    c.fillText(SUB, p.sx, p.sy);
  }
  c.restore();
}

/** The wall and everything on it that only reflects light: bricks, acrylic board, fixings, cable, unlit glass. */
function wallAlbedo(theme: Theme, p: Plan) {
  return (c: Ctx2D, w: number, h: number) => {
    const img = c.createImageData(w, h);
    const d = img.data;
    const u = p.u;
    const ch = u * 0.064;
    const bl = ch * 3.05;
    const m = ch * 0.15;
    const bev = m * 1.1;
    const face = noiseTile(31, 256, 8, 4);
    const chip = noiseTile(57, 256, 16, 3);
    const s1 = 256 / (u * 0.55);
    const s2 = 256 / (u * 0.22);
    const brickA = parse(mix(mix(theme.bg, theme.ink, 0.3), theme.accent, 0.07));
    const brickB = parse(mix(mix(theme.bg, theme.ink, 0.46), theme.accent2, 0.04));
    const mortar = parse(mix(theme.bg, theme.ink, 0.4));
    // The light sits in front of the sign's centre, a little off the wall.
    const lx = p.board.x + p.board.w / 2;
    const ly = p.board.y + p.board.h / 2;
    const lz = u * 0.32;
    for (let y = 0; y < h; y++) {
      const course = Math.floor(y / ch);
      const fy = y - course * ch;
      const off = course & 1 ? bl * 0.5 : 0;
      const shift = hash(course, 3) * 0.2 * bl;
      for (let x = 0; x < w; x++) {
        const xx = x + off + shift;
        const bx = Math.floor(xx / bl);
        const fx = xx - bx * bl;
        const n = face.sample(x * s1, y * s1);
        const nc = chip.sample(x * s2, y * s2);
        const dl = fx - m;
        const dr = bl - fx;
        const dt = fy - m;
        const db = ch - fy;
        // Chipped arrises: the edge eats into the brick where the noise says so.
        const e = Math.min(dl, dr, dt, db) - (nc - 0.45) * m * 1.5;
        let r: number;
        let g: number;
        let b: number;
        const o = (y * w + x) * 4;
        if (e < 0) {
          const ao = 0.5 + 0.35 * clamp(-e / m);
          const k = (0.62 + 0.5 * n) * ao;
          r = mortar[0] * k;
          g = mortar[1] * k;
          b = mortar[2] * k;
        } else {
          const tone = hash(bx, course, 7);
          const burnt = hash(bx, course, 11) > 0.84 ? 0.62 : 1;
          const kk = tone * 0.75;
          const br = brickA[0] + (brickB[0] - brickA[0]) * kk;
          const bg = brickA[1] + (brickB[1] - brickA[1]) * kk;
          const bb = brickA[2] + (brickB[2] - brickA[2]) * kk;
          // Bevelled faces: the normal tips toward each nearby edge.
          let nx = -smoothstep(bev, 0, dl) + smoothstep(bev, 0, dr);
          let ny = -smoothstep(bev, 0, dt) + smoothstep(bev, 0, db);
          nx += (n - 0.5) * 0.5;
          ny += (nc - 0.5) * 0.35;
          const vx = lx - x;
          const vy = ly - y;
          const vl = Math.hypot(vx, vy, lz);
          const nl = Math.hypot(nx, ny, 1);
          const facing = (nx * vx + ny * vy + lz) / (vl * nl) / (lz / vl);
          const shade = clamp(facing, 0.35, 1.7);
          const k = (0.55 + 0.75 * n) * burnt * shade * (0.92 + 0.16 * hash(x, y, 5));
          r = br * k;
          g = bg * k;
          b = bb * k;
        }
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);

    const B = p.board;
    // The acrylic board: a soft shadow on the wall, a faint sheen, polished edges.
    c.save();
    c.filter = `blur(${(u * 0.012).toFixed(1)}px)`;
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.beginPath();
    c.roundRect(B.x + u * 0.006, B.y + u * 0.018, B.w, B.h, B.r);
    c.fill();
    c.restore();
    c.save();
    c.fillStyle = rgba(theme.ink, 0.05);
    c.beginPath();
    c.roundRect(B.x, B.y, B.w, B.h, B.r);
    c.fill();
    c.lineWidth = Math.max(1, u * 0.0028);
    c.strokeStyle = rgba(theme.ink, 0.5);
    c.stroke();
    // A faint diagonal sheen across the acrylic.
    c.clip();
    const sheen = c.createLinearGradient(B.x, B.y, B.x + B.w * 0.6, B.y + B.h);
    sheen.addColorStop(0, rgba(theme.ink, 0));
    sheen.addColorStop(0.42, rgba(theme.ink, 0));
    sheen.addColorStop(0.5, rgba(theme.ink, 0.07));
    sheen.addColorStop(0.62, rgba(theme.ink, 0));
    c.fillStyle = sheen;
    c.fillRect(B.x, B.y, B.w, B.h);
    c.lineWidth = Math.max(1, u * 0.0014);
    c.strokeStyle = rgba(theme.ink, 0.85);
    c.beginPath();
    c.moveTo(B.x + B.r, B.y + u * 0.002);
    c.lineTo(B.x + B.w - B.r, B.y + u * 0.002);
    c.stroke();
    c.restore();
    // Stand-off fixings in the corners.
    const inset = u * 0.024;
    for (const [fx, fy] of [
      [B.x + inset, B.y + inset],
      [B.x + B.w - inset, B.y + inset],
      [B.x + inset, B.y + B.h - inset],
      [B.x + B.w - inset, B.y + B.h - inset],
    ]) {
      const rr = u * 0.0105;
      c.save();
      c.filter = `blur(${(u * 0.004).toFixed(1)}px)`;
      c.fillStyle = "rgba(0,0,0,0.6)";
      c.beginPath();
      c.arc(fx + rr * 0.5, fy + rr * 0.9, rr * 1.1, 0, TAU);
      c.fill();
      c.restore();
      const g = c.createRadialGradient(fx - rr * 0.4, fy - rr * 0.45, 0, fx, fy, rr);
      g.addColorStop(0, rgba(theme.ink, 1));
      g.addColorStop(0.35, rgba(mix(theme.ink, theme.bg, 0.35), 1));
      g.addColorStop(1, rgba(mix(theme.ink, theme.bg, 0.8), 1));
      c.fillStyle = g;
      c.beginPath();
      c.arc(fx, fy, rr, 0, TAU);
      c.fill();
    }
    // The power cable drops from the board to the floor.
    const cx0 = B.x + B.w * 0.78;
    const cy0 = B.y + B.h - u * 0.004;
    c.save();
    c.lineCap = "round";
    c.strokeStyle = rgba(mix(theme.bg, "#000000", 0.4), 1);
    c.lineWidth = u * 0.0065;
    c.beginPath();
    c.moveTo(cx0, cy0);
    c.bezierCurveTo(
      cx0 + u * 0.01,
      cy0 + u * 0.08,
      cx0 + u * 0.1,
      h * 0.92,
      cx0 + u * 0.08,
      h + u * 0.02,
    );
    c.stroke();
    c.strokeStyle = rgba(theme.ink, 0.28);
    c.lineWidth = u * 0.0016;
    c.beginPath();
    c.moveTo(cx0 - u * 0.0018, cy0);
    c.bezierCurveTo(
      cx0 + u * 0.008,
      cy0 + u * 0.08,
      cx0 + u * 0.098,
      h * 0.92,
      cx0 + u * 0.078,
      h + u * 0.02,
    );
    c.stroke();
    c.restore();
    // Unlit glass: a soft shadow on the board, then the tube body.
    c.save();
    c.filter = `blur(${(u * 0.006).toFixed(1)}px)`;
    c.translate(u * 0.004, u * 0.012);
    tubes(c, p, "main", "rgba(0,0,0,0.75)", null);
    tubes(c, p, "sub", "rgba(0,0,0,0.75)", null);
    c.restore();
    tubes(c, p, "main", mix(theme.ink, theme.accent, 0.45), null);
    tubes(c, p, "sub", mix(theme.ink, theme.accent2, 0.45), null);
    const mark = tintedLogo(theme, mix(theme.ink, theme.bg, 0.3), u * 0.05, u * 0.05);
    if (mark) c.drawImage(mark as CanvasImageSource, B.x + u * 0.045, B.y + B.h - u * 0.095);
  };
}

/** One element lit: a wide bloom, a tight halo and the white-hot tube. Composited with "lighter". */
function litLayer(theme: Theme, p: Plan, part: Part) {
  return (c: Ctx2D, w: number, h: number) => {
    const color = part === "main" ? theme.accent : theme.accent2;
    const hot = mix(theme.ink, color, part === "main" ? 0.22 : 0.5);
    const { ctx: g, canvas } = buffer("neon-src", w, h);
    g.clearRect(0, 0, w, h);
    tubes(g, p, part, color, null);
    const u = p.u;
    const boost = part === "main" ? 1 : 1.35;
    addGlow(c, canvas, w, h, u * 0.12, 0.55 * boost);
    addGlow(c, canvas, w, h, u * 0.035, 0.9 * boost);
    addGlow(c, canvas, w, h, u * 0.009, 1);
    tubes(c, p, part, color, hot);
  };
}

/** Tube intensities: the main word hums; ON AIR fails, stutters and re-strikes, then holds. */
function flicker(t: number) {
  const f = Math.floor(t * 30 + 1e-6);
  let sub = 1;
  const steps: [number, number][] = [
    [3.15, 0.12],
    [3.22, 1],
    [3.28, 0.04],
    [3.5, 0.85],
    [3.54, 0.08],
    [3.6, 0.02],
    [3.82, 1.25],
    [3.86, 0.3],
    [3.92, 1.12],
    [4.0, -1],
    [4.55, 1],
  ];
  if (t >= 3.15 && t < 4.55) {
    let i = 0;
    while (i + 1 < steps.length && t >= steps[i + 1][0]) i++;
    const v = steps[i][1];
    if (v < 0) sub = 0.82 + 0.18 * smoothstep(4.0, 4.55, t);
    else sub = v;
    // A failing tube buzzes even while it is on.
    if (sub > 0.5) sub *= 0.9 + 0.1 * hash(f, 17);
  }
  const main = (1 - 0.1 * clamp(1 - sub)) * (1 + 0.018 * tnoise(t, 3, 4));
  return { main, sub };
}

function lightPool(
  c: Ctx2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  hot: string,
  a: number,
) {
  if (a <= 0.001) return;
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(hot, Math.min(1, a)));
  g.addColorStop(0.18, rgba(color, Math.min(1, a * 0.95)));
  g.addColorStop(0.45, rgba(color, a * 0.42));
  g.addColorStop(0.75, rgba(color, a * 0.12));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(-rx, -rx, rx * 2, rx * 2);
  c.restore();
}

export const style: MotionStyle = {
  id: "neon-sign",
  name: "Neon Sign",
  family: "Light & Material",
  tagline: "Hand-bent neon on brick",
  look: "Hand-bent glass neon on a dark brick wall: white-hot tubes, a coloured halo and light bleeding across the bricks.",
  move: "The sign hums steady, the ON AIR tube stutters, drops out and re-strikes, and the light on the bricks flickers with it.",
  rules: [
    "Tubes burn white-hot at the core and saturated at the rim; the halo is the colour.",
    "The light bleeds onto the wall: bricks nearest the sign catch it, edges facing it glint.",
    "Mortar sits back in shadow; brick faces carry chips, tone shifts and grain.",
    "Unlit glass stays visible as pale tube when a letter drops out.",
    "Flicker is abrupt and irregular, like a failing electrode, never a smooth fade.",
    "When one tube dips, the shared transformer dims the other a touch.",
    "Real fixings: an acrylic board, four stand-offs and a cable to the floor.",
  ],
  prompt: `R — References
• Real neon signs on brick at night (search: neon sign brick wall photography, hand-bent glass neon).
• A failing neon tube re-striking (search: neon flicker footage).
• Neon shops' acrylic-backed signs with stand-off fixings and a trailing cable.

I — Idea
One sign, one failing tube, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): "{{name}}" in glass-tube script burns steady on a dark brick wall; a small ON AIR tube glows beneath it.
• Middle (1.5–3.1 s): the sign hums; its light lies warm on the bricks and the acrylic edges.
• End (3.1–5 s): the ON AIR tube stutters, drops out, buzzes and re-strikes with a flash, the wall light flickering with it and the main word dipping in sympathy, then it settles back to steady.

S — Style
Looks: {{bg}} brick wall with lighter mortar in shadow; the word in {{accent}} neon (a neon script, or {{font}} bent as outline tube), ON AIR in {{accent2}}; tube cores near {{ink}}. A clear acrylic board with four stand-offs and a black cable.
Moves: steady hum; an irregular, hard-cut flicker on one tube for about a second; the wall light follows each flick instantly.
Rules:
1. White-hot tube core, saturated rim, soft halo in the tube colour.
2. Light spills onto the bricks with falloff; brick edges facing the sign catch it.
3. Unlit glass still visible when a tube is off.
4. Flicker is abrupt and irregular; the other tube dips slightly with it.
5. Brick texture, chips, tone variation, vignette and grain.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the tubes read as glass with a hot core, not flat text with a blur; the bricks are lit by the sign and fall off into darkness; the unlit ON AIR tube is visible mid-flicker; the script is never clipped. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Neon_sign",
  theme: {
    bg: "#0e0b0d",
    ink: "#fff3f7",
    accent: "#ff3f8e",
    accent2: "#3fc6ff",
    font: SCRIPT,
  },
  fonts: [SCRIPT, CAPS],
  tags: [
    "neon",
    "sign",
    "glow",
    "brick",
    "bar",
    "night",
    "retro",
    "flicker",
    "tube",
    "light",
    "on air",
    "script",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    const p = plan(ctx, theme, w, h);
    const key = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}|${p.family}|${p.word}|${logoFor(theme) ? theme.logo?.length : 0}`;
    const albedo = bake(`neon-wall:${key}`, w, h, wallAlbedo(theme, p));
    const litMain = bake(`neon-main:${key}`, w, h, litLayer(theme, p, "main"));
    const litSub = bake(`neon-sub:${key}`, w, h, litLayer(theme, p, "sub"));
    const { main, sub } = flicker(t);
    const u = p.u;

    // Light on the wall: ambient plus a pool from each element, times the wall's colour.
    const { canvas: lc, ctx: L } = buffer("neon-light", w, h);
    L.save();
    L.globalCompositeOperation = "source-over";
    L.globalAlpha = 1;
    L.fillStyle = mix(theme.bg, theme.ink, 0.07);
    L.fillRect(0, 0, w, h);
    L.globalCompositeOperation = "lighter";
    const bx = p.box.x + p.box.w / 2;
    const by = p.box.y + p.box.h / 2;
    lightPool(
      L,
      bx,
      by,
      p.box.w * 0.62 + u * 0.24,
      p.box.h * 0.75 + u * 0.2,
      theme.accent,
      mix(theme.accent, theme.ink, 0.5),
      main * 1.15,
    );
    lightPool(
      L,
      bx,
      by,
      p.box.w * 1.1 + u * 0.45,
      p.box.h * 1.3 + u * 0.36,
      theme.accent,
      theme.accent,
      main * 0.2,
    );
    const sx = p.subBox.x + p.subBox.w / 2;
    const sy = p.subBox.y + p.subBox.h / 2;
    lightPool(
      L,
      sx,
      sy + u * 0.04,
      p.subBox.w * 1.1 + u * 0.3,
      p.subBox.h * 2.5 + u * 0.2,
      theme.accent2,
      mix(theme.accent2, theme.ink, 0.4),
      sub * 0.9,
    );
    L.globalCompositeOperation = "multiply";
    L.drawImage(albedo as CanvasImageSource, 0, 0);
    L.restore();
    ctx.drawImage(lc as CanvasImageSource, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp(main);
    ctx.drawImage(litMain as CanvasImageSource, 0, 0);
    if (sub > 0.01) {
      ctx.globalAlpha = clamp(sub);
      ctx.drawImage(litSub as CanvasImageSource, 0, 0);
      // An over-driven re-strike blooms past full.
      if (sub > 1) {
        ctx.globalAlpha = clamp(sub - 1);
        ctx.drawImage(litSub as CanvasImageSource, 0, 0);
      }
    }
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.62);
    grain(ctx, w, h, t, 0.3);
  },
};
