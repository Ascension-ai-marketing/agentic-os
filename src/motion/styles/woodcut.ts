import { rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  fbm3,
  font,
  fract,
  frameOf,
  grain,
  ground,
  hash,
  lerp,
  light,
  LOOP,
  rng,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkPaper, tintLayer, type Pt } from "./_s1-helpers";

const CAPTION = '"IM Fell English SC", "IM Fell English", Georgia, serif';

type Plate = {
  x: number;
  y: number;
  w: number;
  h: number;
  horizon: number;
  sp: number;
  /** Tower geometry. */
  tx: number;
  base: number;
  top: number;
  wb: number;
  wt: number;
  lampX: number;
  lampY: number;
};

function plateOf(w: number, h: number): Plate {
  const { portrait, square } = frameOf(w, h);
  const pw = w * (portrait ? 0.86 : square ? 0.84 : 0.8);
  const ph = h * (portrait ? 0.78 : square ? 0.76 : 0.74);
  const x = (w - pw) / 2;
  const y = h * (portrait ? 0.07 : square ? 0.07 : 0.08);
  const horizon = y + ph * (portrait ? 0.66 : 0.64);
  const P = Math.min(ph, pw * 1.2);
  const tx = x + pw * (portrait ? 0.56 : square ? 0.6 : 0.64);
  const base = horizon - P * 0.02;
  const top = base - P * (portrait ? 0.44 : 0.4);
  const wb = P * 0.12;
  const wt = P * 0.078;
  return {
    x,
    y,
    w: pw,
    h: ph,
    horizon,
    sp: Math.max(2.2, Math.min(ph, pw * 1.1) * 0.0105),
    tx,
    base,
    top,
    wb,
    wt,
    lampX: tx,
    lampY: top - P * 0.07,
  };
}

// A periodic cloud field (tiles in x), sampled bilinearly: cheap per line sample.
const CW = 160;
const CH = 64;
let clouds: Float32Array | null = null;
function cloudField() {
  if (clouds) return clouds;
  clouds = new Float32Array(CW * CH);
  for (let j = 0; j < CH; j++)
    for (let i = 0; i < CW; i++) {
      const n = fbm3((i / CW) * 5, (j / CH) * 2.2, 1.7, 4, 5, 0, 0);
      clouds[j * CW + i] = n;
    }
  return clouds;
}
function cloudAt(fx: number, fy: number) {
  const f = cloudField();
  const x = fract(fx) * CW;
  const y = clamp(fy, 0, 0.9999) * (CH - 1);
  const x0 = Math.floor(x) % CW;
  const x1 = (x0 + 1) % CW;
  const y0 = Math.floor(y);
  const y1 = Math.min(CH - 1, y0 + 1);
  const u = x - Math.floor(x);
  const v = y - y0;
  const a = f[y0 * CW + x0] + (f[y0 * CW + x1] - f[y0 * CW + x0]) * u;
  const b = f[y1 * CW + x0] + (f[y1 * CW + x1] - f[y1 * CW + x0]) * u;
  return a + (b - a) * v;
}

/** Wood grain for the ink: long wavy streaks and a knot, as alpha (for destination-out). */
function woodGrain(c: Ctx2D, w: number, h: number) {
  const { u } = frameOf(w, h);
  const r = rng(314);
  c.lineCap = "round";
  const knotX = w * 0.3;
  const knotY = h * 0.42;
  for (let i = 0; i < 180; i++) {
    const y0 = r() * h;
    const amp = u * (0.004 + r() * 0.012);
    const freq = 0.6 + r() * 1.8;
    c.strokeStyle = `rgba(0,0,0,${(0.12 + r() * 0.5).toFixed(3)})`;
    c.lineWidth = Math.max(0.6, u * (0.0008 + r() * 0.0022));
    c.beginPath();
    for (let x = -10; x <= w + 10; x += Math.max(4, w / 90)) {
      const dx = x - knotX;
      const dy = y0 - knotY;
      const d = Math.hypot(dx, dy * 1.8);
      const bulge = u * 0.06 * Math.exp(-(d * d) / (u * u * 0.03)) * Math.sign(dy || 1);
      const y =
        y0 +
        Math.sin((x / w) * TAU * freq + i) * amp +
        fbm3(x / (u * 0.4), y0 / u, 3.3, 2) * u * 0.02 +
        bulge;
      if (x === -10) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  // The knot: tight rings.
  for (let k = 0; k < 7; k++) {
    c.strokeStyle = `rgba(0,0,0,${(0.3 + 0.08 * k).toFixed(3)})`;
    c.lineWidth = Math.max(0.6, u * 0.0016);
    c.beginPath();
    c.ellipse(knotX, knotY, u * (0.006 + k * 0.006), u * (0.003 + k * 0.0032), 0.1, 0, TAU);
    c.stroke();
  }
}

/** The beam: brightness at a point for a lamp turning once per loop. */
function beamAt(p: Plate, x: number, y: number, phi: number) {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const dx = x - p.lampX;
  const dy = y - p.lampY;
  const d = Math.hypot(dx, dy) + 1e-3;
  const dir = c >= 0 ? 1 : -1;
  const along = (dx * dir) / d;
  // Foreshortened: wide and short when it points at us, long and thin side-on.
  const fore = Math.max(0.14, Math.abs(c));
  const half = 0.11 / fore;
  const inside = 1 - smoothstep(half * 0.35, half, Math.abs(Math.atan2(dy + d * 0.05, dx * dir)));
  const reach = p.w * (0.3 + 0.9 * fore);
  const fall = Math.exp(-d / reach);
  const facing = 0.45 + 0.55 * Math.max(0, s);
  return inside * fall * facing * (along > 0 ? 1 : 0);
}

/** Tower outline (tapered) at height y: half width. */
function towerHalf(p: Plate, y: number) {
  const f = clamp((p.base - y) / (p.base - p.top));
  return lerp(p.wb, p.wt, Math.pow(f, 0.9)) / 2;
}

function rocksPath(c: Ctx2D, p: Plate) {
  const r = rng(92);
  const left = p.tx - p.wb * 2.4;
  const right = p.tx + p.wb * 2.1;
  const pts: Pt[] = [[left, p.horizon + p.sp * 3]];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = lerp(left, right, f);
    const hump = Math.sin(Math.PI * f) ** 0.7;
    const y = p.base + p.wb * 0.25 - hump * p.wb * 0.55 + (r() - 0.5) * p.wb * 0.22;
    pts.push([x, y]);
  }
  pts.push([right + p.wb * 0.3, p.horizon + p.sp * 4]);
  c.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts) c.lineTo(x, y);
  c.closePath();
  return pts;
}

function towerPath(c: Ctx2D, p: Plate) {
  const y0 = p.base + p.wb * 0.1;
  c.moveTo(p.tx - p.wb / 2, y0);
  c.lineTo(p.tx - p.wt / 2, p.top);
  c.lineTo(p.tx + p.wt / 2, p.top);
  c.lineTo(p.tx + p.wb / 2, y0);
  c.closePath();
}

export const style: MotionStyle = {
  id: "woodcut",
  name: "Woodcut Lighthouse",
  family: "Print & Craft",
  tagline: "A lighthouse cut in wood",
  look: "An old wood engraving: a striped lighthouse on rocks over a sea of swelling lines, its beam cut as merging strokes.",
  move: "The lamp turns once a loop: the beam swings out, flashes at us and passes behind the tower as the swell rolls in.",
  rules: [
    "Tone is line weight only: bright where lines swell and merge, dark where they thin.",
    "Sky lines run level; sea lines follow the swell; the tower is cut in verticals.",
    "Light is carved: the beam swells the lines it crosses, nothing is airbrushed.",
    "Wood grain shows through every solid of ink.",
    "One accent, only in the lamp and its glow.",
    "The lamp makes whole turns and the waves whole wavelengths, so it loops.",
    "An engraved double border and a small caption under the plate.",
  ],
  prompt: `R — References
• Nineteenth-century wood engravings of lighthouses and stormy seas (search: wood engraving lighthouse, Thomas Bewick, scraperboard lighthouse).
• Engraver's line work: tone from line weight, parallel sky lines, swelling sea lines.

I — Idea
A lighthouse turns its lamp once, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): the beam swings out to the right, carved as sky lines that swell into solid ink as it comes round toward us; the sea rolls in line by line.
• Middle (1.5–3.5 s): the lamp flashes straight at us, the glow flooding the lines round the lantern, then the beam sweeps out to the left.
• End (3.5–5 s): the beam passes behind the tower and comes round to where it started; the caption "{{name}}" sits under the plate.

S — Style
Looks: {{bg}} stock; everything cut in {{ink}} lines (scraperboard logic: thick = bright, thin = dark); the lamp and its glow in {{accent}}; wood grain streaking the ink; a double rule border; a small caps caption in an old-style serif.
Moves: the lamp turns at constant speed (one turn per loop); the beam foreshortens as it turns (long and thin side-on, wide and bright facing us); waves travel whole wavelengths per loop; gulls glide across.
Rules:
1. Tone only through line thickness.
2. Level sky lines, swelling sea lines, vertical tower lines.
3. The beam is carved light: lines thicken and merge inside it.
4. Wood grain through the ink.
5. One accent in the lamp.
6. Whole turns, whole wavelengths.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; it reads as an engraving at thumbnail size; the beam is made of lines, not a gradient; the tower reads as round; the grain shows in solid areas. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Wood_engraving",
  theme: {
    bg: "#0e0d0b",
    ink: "#ebdfc6",
    accent: "#f2b247",
    accent2: "#6f8a99",
    font: "IM Fell English SC",
  },
  fonts: ["IM Fell English SC"],
  tags: [
    "woodcut",
    "engraving",
    "wood engraving",
    "scraperboard",
    "etching",
    "lighthouse",
    "sea",
    "vintage",
    "victorian",
    "print",
    "line art",
  ],
  word: "Beacon",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `wood-paper:${theme.bg}${theme.ink}`,
        w,
        h,
        darkPaper(theme, 61, { fibres: 0.5 }),
      ) as CanvasImageSource,
      0,
      0,
    );

    const p = plateOf(w, h);
    const phase = t / LOOP;
    const phi = TAU * phase - 0.52;
    const flash = Math.pow(Math.max(0, Math.sin(phi)), 10);
    const { canvas: ic, ctx: I } = buffer("wood-ink", w, h);
    I.clearRect(0, 0, w, h);
    I.fillStyle = "#fff";

    // Sky: level lines whose weight follows cloud, halo and beam.
    I.beginPath();
    const N = Math.max(40, Math.round(p.w / 9));
    const dxs = p.w / N;
    const cloudShift = phase;
    const halo = p.h * (0.16 + 0.22 * flash);
    for (let k = 0, y = p.y + p.sp * 0.8; y < p.horizon - p.sp * 0.3; k++, y += p.sp) {
      const fy = (y - p.y) / (p.horizon - p.y);
      const top: Pt[] = [];
      const bot: Pt[] = [];
      for (let i = 0; i <= N; i++) {
        const x = p.x + i * dxs;
        const cl = cloudAt((x - p.x) / p.w + cloudShift, fy * 0.9);
        const cloud =
          smoothstep(0.08, 0.4, cl) * (0.12 + 0.14 * fy) + smoothstep(0.32, 0.42, cl) * 0.08;
        const base = 0.06 + 0.22 * fy * fy;
        const d = Math.hypot(x - p.lampX, y - p.lampY);
        const glow = Math.exp(-(d * d) / (halo * halo)) * (0.5 + 0.5 * flash);
        const beam = beamAt(p, x, y, phi) * 1.1;
        const B = clamp(base + cloud + glow + beam);
        const th = p.sp * (0.07 + 0.9 * B);
        const wob =
          (Math.sin(x * 0.021 + k * 1.7) * 0.08 + Math.sin(x * 0.0047 + k * 0.9) * 0.14) * p.sp;
        top.push([x, y + wob - th / 2]);
        bot.push([x, y + wob + th / 2]);
      }
      I.moveTo(top[0][0], top[0][1]);
      for (const [x, yy] of top) I.lineTo(x, yy);
      for (let i = bot.length - 1; i >= 0; i--) I.lineTo(bot[i][0], bot[i][1]);
      I.closePath();
    }
    I.fill();

    // Sea: swelling lines, spacing opening toward us; glitter under the lamp.
    I.beginPath();
    const seaH = p.y + p.h - p.horizon;
    let y = p.horizon + p.sp * 0.4;
    for (let k = 0; y < p.y + p.h - p.sp * 0.4; k++) {
      const f = (y - p.horizon) / seaH;
      const gap = p.sp * (0.75 + 1.3 * f);
      const amp = gap * (0.25 + 0.5 * f);
      const lam = p.w * (0.05 + 0.16 * f);
      const top: Pt[] = [];
      const bot: Pt[] = [];
      for (let i = 0; i <= N; i++) {
        const x = p.x + i * dxs;
        const ph1 = TAU * ((x - p.x) / lam - 2 * phase + k * 0.37);
        const ph2 = TAU * ((x - p.x) / (lam * 0.53) + phase + k * 0.61);
        const disp = amp * (Math.sin(ph1) * 0.75 + Math.sin(ph2) * 0.3);
        const slope = Math.cos(ph1) * 0.75 + Math.cos(ph2) * 0.55;
        const glitterCol = Math.exp(-(((x - p.lampX) / (p.w * (0.05 + 0.1 * f))) ** 2));
        const glint =
          glitterCol *
          (0.25 + 0.75 * flash + 0.3 * beamAt(p, x, p.horizon - (y - p.horizon), phi)) *
          smoothstep(0.1, 0.9, slope);
        const B = clamp(0.1 + 0.18 * smoothstep(-0.2, 1, slope) + glint * 0.9 + 0.08 * (1 - f));
        const th = gap * (0.06 + 0.62 * B);
        top.push([x, y + disp - th / 2]);
        bot.push([x, y + disp + th / 2]);
      }
      I.moveTo(top[0][0], top[0][1]);
      for (const [x, yy] of top) I.lineTo(x, yy);
      for (let i = bot.length - 1; i >= 0; i--) I.lineTo(bot[i][0], bot[i][1]);
      I.closePath();
      y += gap;
    }
    I.fill();

    // Clear the tower and rocks out of the sky and sea, then cut them in their own lines.
    I.save();
    I.globalCompositeOperation = "destination-out";
    I.beginPath();
    towerPath(I, p);
    I.fill();
    I.beginPath();
    const rocks = rocksPath(I, p);
    I.fill();
    I.lineWidth = p.sp * 1.2;
    I.stroke();
    // Gallery, lantern and dome silhouettes.
    const gw = p.wt * 1.5;
    const gy = p.top;
    I.fillRect(p.tx - gw / 2, gy - p.sp * 1.6, gw, p.sp * 2.4);
    I.fillRect(p.tx - p.wt * 0.42, p.lampY - p.wt * 0.55, p.wt * 0.84, gy - p.lampY + p.wt * 0.55);
    I.beginPath();
    I.arc(p.tx, p.lampY - p.wt * 0.52, p.wt * 0.46, Math.PI, TAU);
    I.fill();
    I.restore();

    // Tower: vertical cuts, heavier on the lit (left) side, three dark bands.
    I.save();
    I.beginPath();
    towerPath(I, p);
    I.clip();
    I.beginPath();
    const cols = 16;
    for (let i = 0; i < cols; i++) {
      const f = (i + 0.5) / cols;
      const a = Math.acos(1 - 2 * f);
      const lit = clamp(0.25 + 0.75 * Math.cos(a - 0.9));
      const pts: Pt[] = [];
      const pts2: Pt[] = [];
      const rows = 24;
      for (let j = 0; j <= rows; j++) {
        const yy = lerp(p.base + p.wb * 0.1, p.top, j / rows);
        const half = towerHalf(p, yy);
        const x = p.tx - half * Math.cos(a);
        const band = Math.floor(((p.base - yy) / (p.base - p.top)) * 6) % 2 === 1 ? 0.35 : 1;
        const colW = (half * 2 * Math.sin(a) * Math.PI) / (2 * cols);
        const th = Math.max(0.4, colW * (0.15 + 0.8 * lit * band));
        pts.push([x - th / 2, yy]);
        pts2.push([x + th / 2, yy]);
      }
      I.moveTo(pts[0][0], pts[0][1]);
      for (const [x, yy] of pts) I.lineTo(x, yy);
      for (let j = pts2.length - 1; j >= 0; j--) I.lineTo(pts2[j][0], pts2[j][1]);
      I.closePath();
    }
    I.fill();
    // Band edges read as rings round the drum.
    I.strokeStyle = "#fff";
    I.lineWidth = Math.max(0.6, p.sp * 0.28);
    I.beginPath();
    for (let b = 1; b < 6; b++) {
      const yy = p.base - ((p.base - p.top) * b) / 6;
      const half = towerHalf(p, yy);
      I.moveTo(p.tx - half, yy);
      I.quadraticCurveTo(p.tx, yy + half * 0.28, p.tx + half, yy);
    }
    I.stroke();
    I.restore();
    // Door and two windows, cut out.
    I.save();
    I.globalCompositeOperation = "destination-out";
    const dh = p.wb * 0.42;
    I.beginPath();
    I.moveTo(p.tx - p.wb * 0.1, p.base);
    I.lineTo(p.tx - p.wb * 0.1, p.base - dh * 0.7);
    I.arc(p.tx, p.base - dh * 0.7, p.wb * 0.1, Math.PI, TAU);
    I.lineTo(p.tx + p.wb * 0.1, p.base);
    I.closePath();
    for (const f of [0.38, 0.62]) {
      const yy = lerp(p.base, p.top, f);
      I.rect(p.tx - p.wb * 0.05, yy - p.wb * 0.08, p.wb * 0.1, p.wb * 0.16);
    }
    I.fill();
    I.restore();

    // Gallery with railing, lantern mullions, dome hatching.
    I.strokeStyle = "#fff";
    I.lineWidth = Math.max(0.8, p.sp * 0.35);
    I.beginPath();
    I.moveTo(p.tx - gw / 2, gy);
    I.lineTo(p.tx + gw / 2, gy);
    I.moveTo(p.tx - gw / 2, gy - p.sp * 1.5);
    I.lineTo(p.tx + gw / 2, gy - p.sp * 1.5);
    for (let i = 0; i <= 8; i++) {
      const x = p.tx - gw / 2 + (gw * i) / 8;
      I.moveTo(x, gy);
      I.lineTo(x, gy - p.sp * 1.5);
    }
    const lw = p.wt * 0.84;
    const lTop = p.lampY - p.wt * 0.55;
    I.rect(p.tx - lw / 2, lTop, lw, gy - p.sp * 1.5 - lTop);
    for (let i = 1; i < 4; i++) {
      I.moveTo(p.tx - lw / 2 + (lw * i) / 4, lTop);
      I.lineTo(p.tx - lw / 2 + (lw * i) / 4, gy - p.sp * 1.5);
    }
    I.stroke();
    I.save();
    I.beginPath();
    I.arc(p.tx, lTop + p.wt * 0.03, p.wt * 0.46, Math.PI, TAU);
    I.closePath();
    I.clip();
    I.beginPath();
    for (let i = -6; i <= 6; i++) {
      const x = p.tx + (i / 6) * p.wt * 0.46;
      I.moveTo(x, lTop - p.wt * 0.5);
      I.lineTo(x + p.wt * 0.1, lTop + p.wt * 0.05);
    }
    I.lineWidth = Math.max(0.6, p.sp * 0.3);
    I.stroke();
    I.restore();
    I.beginPath();
    I.moveTo(p.tx, lTop - p.wt * 0.43);
    I.lineTo(p.tx, lTop - p.wt * 0.75);
    I.stroke();

    // Rocks: cross-hatched masses, a lit top edge, foam where the sea breaks.
    I.save();
    I.beginPath();
    rocksPath(I, p);
    I.clip();
    I.lineWidth = Math.max(0.6, p.sp * 0.3);
    I.beginPath();
    const rx0 = rocks[0][0];
    const rx1 = rocks[rocks.length - 1][0];
    for (let x = rx0 - p.wb; x < rx1 + p.wb; x += p.sp * 1.3) {
      I.moveTo(x, p.base - p.wb);
      I.lineTo(x + p.wb * 0.9, p.horizon + p.sp * 4);
    }
    I.stroke();
    I.restore();
    I.lineWidth = Math.max(0.8, p.sp * 0.5);
    I.beginPath();
    for (let i = 1; i < rocks.length - 1; i++) {
      const [x, yy] = rocks[i];
      if (i === 1) I.moveTo(x, yy);
      else I.lineTo(x, yy);
    }
    I.stroke();
    // Foam: short broken strokes along the rock foot, breathing with the swell.
    I.beginPath();
    for (let i = 0; i < 26; i++) {
      const f = i / 25;
      const x = lerp(rx0, rx1, f) + Math.sin(TAU * (phase * 2 + f * 3)) * p.sp;
      const yy =
        p.horizon +
        p.sp * (1 + 2.2 * hash(i, 7)) +
        Math.sin(TAU * (phase + hash(i, 3))) * p.sp * 0.6;
      const len = p.sp * (1.5 + 3 * hash(i, 9));
      I.moveTo(x, yy);
      I.lineTo(x + len, yy - p.sp * 0.2);
    }
    I.lineWidth = Math.max(0.8, p.sp * 0.55);
    I.stroke();

    // Gulls glide across once per loop.
    I.lineWidth = Math.max(0.8, p.sp * 0.35);
    I.beginPath();
    for (let g = 0; g < 3; g++) {
      const gx = p.x + fract(phase + g * 0.37) * (p.w + p.sp * 20) - p.sp * 10;
      const gy2 = p.y + p.h * (0.16 + g * 0.07) + Math.sin(TAU * (phase * 2 + g)) * p.sp;
      const s = p.sp * (2.2 - g * 0.4);
      const flap = Math.sin(TAU * (phase * 5 + g * 0.3)) * 0.4;
      I.moveTo(gx - s, gy2 - s * (0.3 + flap));
      I.quadraticCurveTo(gx - s * 0.4, gy2 - s * 0.5, gx, gy2);
      I.quadraticCurveTo(gx + s * 0.4, gy2 - s * 0.5, gx + s, gy2 - s * (0.3 + flap));
    }
    I.stroke();

    // Keep the cut inside the plate, then the engraved double border.
    I.save();
    I.globalCompositeOperation = "destination-in";
    I.fillRect(p.x, p.y, p.w, p.h);
    I.restore();
    I.strokeStyle = "#fff";
    I.lineWidth = Math.max(1, p.sp * 0.55);
    I.strokeRect(p.x - p.sp * 1.1, p.y - p.sp * 1.1, p.w + p.sp * 2.2, p.h + p.sp * 2.2);
    I.lineWidth = Math.max(0.6, p.sp * 0.22);
    I.strokeRect(p.x - p.sp * 2.1, p.y - p.sp * 2.1, p.w + p.sp * 4.2, p.h + p.sp * 4.2);

    // Wood grain through the ink, then colour it.
    I.save();
    I.globalCompositeOperation = "destination-out";
    I.globalAlpha = 0.62;
    I.drawImage(bake("wood-grain", w, h, woodGrain) as CanvasImageSource, 0, 0);
    I.restore();
    tintLayer(I, w, h, theme.ink);
    ctx.drawImage(ic as CanvasImageSource, 0, 0);

    // The lamp: the only colour, glowing through the lantern glass.
    const glowR = p.wt * (1.2 + 3.2 * flash);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    light(ctx, p.lampX, p.lampY, glowR * 2.2, theme.accent, 0.28 + 0.4 * flash);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = rgba(theme.accent, 0.55 + 0.4 * flash);
    ctx.fillRect(p.tx - lw / 2 + 1, lTop + 1, lw - 2, gy - p.sp * 1.5 - lTop - 2);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    const beamTint = ctx.createRadialGradient(p.lampX, p.lampY, 0, p.lampX, p.lampY, p.w * 0.7);
    beamTint.addColorStop(0, rgba(theme.accent, 0.5));
    beamTint.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = beamTint;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.restore();
    ctx.restore();

    // Caption under the plate.
    const capY = p.y + p.h + (h - p.y - p.h) * 0.5;
    const cap = `FIG. VII · ${wordFor(theme.name, "Beacon", 16)}`;
    const size = Math.max(9, u * (portrait ? 0.03 : 0.034));
    ctx.save();
    ctx.fillStyle = rgba(theme.ink, 0.72);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(400, size, "IM Fell English SC", CAPTION);
    if ("letterSpacing" in ctx)
      (ctx as CanvasRenderingContext2D).letterSpacing = `${(size * 0.18).toFixed(1)}px`;
    ctx.fillText(cap.toUpperCase(), w / 2, capY);
    ctx.restore();
    const mark = tintedLogo(theme, rgba(theme.ink, 0.7), size * 1.4, size * 1.4);
    if (mark) ctx.drawImage(mark as CanvasImageSource, p.x, capY - size * 0.7);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
