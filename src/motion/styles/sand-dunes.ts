import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  fbm3,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  once,
  SANS,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, cyc, fitTracked, glow, pnoise, tracked } from "./_s7-helpers";

/** Where the crest sits in each dune period (windward rise, then the slip face). */
const CREST = 0.78;
/** Dune height relative to wavelength. */
const AMP = 0.3;
/** Wind blows along (3, 1): whole-pixel steps along it keep the ripple loop exact. */
const DX = 3 / Math.sqrt(10);
const DY = 1 / Math.sqrt(10);
/** Sun: low, from the windward side and a little above. */
const LX = -0.82;
const LY = -0.5;
const LZ = 0.38;
const LN = Math.hypot(LX, LY, LZ);

interface Field {
  /** Coarse grid step in pixels. */
  step: number;
  gw: number;
  gh: number;
  /** Warp (in wavelengths), dune amplitude, and their world-space gradients per node. */
  W: Float32Array;
  WX: Float32Array;
  WY: Float32Array;
  A: Float32Array;
  AX: Float32Array;
  AY: Float32Array;
  /** Where ripples show strongly (0..1), in patches. */
  P: Float32Array;
  /** Dune wavelength in pixels. */
  lambda: number;
}

function layout(w: number, h: number) {
  const { u, portrait } = frameOf(w, h);
  return { u, lambda: u * (portrait ? 0.3 : 0.31) };
}

/** The warp that bends straight dunes into sinuous crests, and the amplitude that lets them fade into flats. */
function field(w: number, h: number): Field {
  return once(`dune-field@${Math.round(w)}x${Math.round(h)}`, () => {
    const { u, lambda } = layout(w, h);
    const step = Math.max(3, Math.round(u / 150));
    const gw = Math.ceil(w / step) + 2;
    const gh = Math.ceil(h / step) + 2;
    const W = new Float32Array(gw * gh);
    const A = new Float32Array(gw * gh);
    const Pt = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const x = (i * step) / lambda;
        const y = (j * step) / lambda;
        // Across-wind coordinate drives the sinuosity; along-wind adds slow drift.
        const a = x * DX + y * DY;
        const b = -x * DY + y * DX;
        W[j * gw + i] =
          0.55 * fbm3(a * 0.28 + 3.1, b * 0.9 + 1.7, 0.21, 3) +
          0.3 * fbm3(a * 0.55 + 5.9, b * 0.3 + 8.2, 0.9, 2) +
          0.14 * fbm3(a * 0.9 + 7.3, b * 2.1, 1.9, 2);
        A[j * gw + i] = smoothstep(-0.32, 0.3, fbm3(a * 0.35 + 11.2, b * 0.55 + 4.4, 2.7, 3));
        Pt[j * gw + i] = 0.45 + 0.55 * smoothstep(-0.2, 0.25, fbm3(x * 2, y * 2, 5.5, 2));
      }
    const WX = new Float32Array(gw * gh);
    const WY = new Float32Array(gw * gh);
    const AX = new Float32Array(gw * gh);
    const AY = new Float32Array(gw * gh);
    const k = lambda / step;
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const o = j * gw + i;
        const il = j * gw + Math.max(0, i - 1);
        const ir = j * gw + Math.min(gw - 1, i + 1);
        const jt = Math.max(0, j - 1) * gw + i;
        const jb = Math.min(gh - 1, j + 1) * gw + i;
        WX[o] = ((W[ir] - W[il]) / 2) * k;
        WY[o] = ((W[jb] - W[jt]) / 2) * k;
        AX[o] = ((A[ir] - A[il]) / 2) * k;
        AY[o] = ((A[jb] - A[jt]) / 2) * k;
      }
    return { step, gw, gh, W, WX, WY, A, AX, AY, P: Pt, lambda };
  });
}

/** Bilinear sample of a grid array at pixel (x, y). */
function at(f: Field, arr: Float32Array, x: number, y: number) {
  const gx = x / f.step;
  const gy = y / f.step;
  const i = Math.min(f.gw - 2, Math.max(0, Math.floor(gx)));
  const j = Math.min(f.gh - 2, Math.max(0, Math.floor(gy)));
  const fx = gx - i;
  const fy = gy - j;
  const o = j * f.gw + i;
  const a = arr[o] + (arr[o + 1] - arr[o]) * fx;
  const b = arr[o + f.gw] + (arr[o + f.gw + 1] - arr[o + f.gw]) * fx;
  return a + (b - a) * fy;
}

/** Phase of the dune pattern at a pixel (wavelength units, along the wind). */
function phaseAt(f: Field, x: number, y: number) {
  return (x * DX + y * DY) / f.lambda + at(f, f.W, x, y);
}

/** The lit dune field: per-pixel Lambert light on the analytic profile. Baked once per size. */
function dunes(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const f = field(w, h);
    const { u } = layout(w, h);
    const img = c.createImageData(w, h);
    const shadow = parse(mix(theme.bg, theme.accent2, 0.34));
    const deep = parse(mix(theme.bg, "#000000", 0.3));
    const mid = parse(mix(theme.accent, theme.bg, 0.45));
    const lit = parse(theme.accent);
    const hot = parse(mix(theme.accent, theme.ink, 0.5));
    const pale = parse(mix(mix(theme.accent, theme.ink, 0.25), theme.bg, 0.25));
    const d = img.data;
    let seed = 1234567;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // One set of bilinear weights serves every grid array at this pixel.
        const gx = x / f.step;
        const gy = y / f.step;
        const i0 = Math.min(f.gw - 2, Math.floor(gx));
        const j0 = Math.min(f.gh - 2, Math.floor(gy));
        const fx = gx - i0;
        const fy = gy - j0;
        const o = j0 * f.gw + i0;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const o1 = o + 1;
        const o2 = o + f.gw;
        const o3 = o2 + 1;
        const W = f.W[o] * w00 + f.W[o1] * w10 + f.W[o2] * w01 + f.W[o3] * w11;
        const A = f.A[o] * w00 + f.A[o1] * w10 + f.A[o2] * w01 + f.A[o3] * w11;
        const WX = f.WX[o] * w00 + f.WX[o1] * w10 + f.WX[o2] * w01 + f.WX[o3] * w11;
        const WY = f.WY[o] * w00 + f.WY[o1] * w10 + f.WY[o2] * w01 + f.WY[o3] * w11;
        const AX = f.AX[o] * w00 + f.AX[o1] * w10 + f.AX[o2] * w01 + f.AX[o3] * w11;
        const AY = f.AY[o] * w00 + f.AY[o1] * w10 + f.AY[o2] * w01 + f.AY[o3] * w11;
        const s = (x * DX + y * DY) / f.lambda + W;
        const p = s - Math.floor(s);
        // Dune profile along the wind: a long windward rise to a sharp crest, then a steep slip face.
        let fh: number;
        let slope: number;
        if (p < CREST) {
          const k = p / CREST;
          const k6 = Math.pow(k, 0.6);
          fh = k * k6;
          slope = (1.6 * k6) / CREST;
        } else {
          const k = (p - CREST) / (1 - CREST);
          fh = 1 - Math.pow(k, 0.72);
          slope = (-0.72 * Math.pow(Math.max(k, 0.02), -0.28)) / (1 - CREST);
        }
        const sx = AMP * (A * slope * (DX + WX) + fh * AX);
        const sy = AMP * (A * slope * (DY + WY) + fh * AY);
        const nl = Math.hypot(sx, sy, 1);
        const b = (-sx * LX - sy * LY + LZ) / (nl * LN);
        // Ambient occlusion at the foot of each slip face.
        const foot = p < 0.12 ? 0.7 + 0.3 * (p / 0.12) : 1;
        const l01 = Math.max(0, b) * (0.35 + 0.65 * foot);
        let r: number, g: number, bl: number;
        if (b <= 0.02) {
          const k = Math.min(1, Math.max(0, (b + 0.55) / 0.57));
          r = deep[0] + (shadow[0] - deep[0]) * k;
          g = deep[1] + (shadow[1] - deep[1]) * k;
          bl = deep[2] + (shadow[2] - deep[2]) * k;
        } else if (l01 < 0.42) {
          const k = l01 / 0.42;
          r = shadow[0] + (mid[0] - shadow[0]) * k;
          g = shadow[1] + (mid[1] - shadow[1]) * k;
          bl = shadow[2] + (mid[2] - shadow[2]) * k;
        } else if (l01 < 0.7) {
          const k = (l01 - 0.42) / 0.28;
          r = mid[0] + (lit[0] - mid[0]) * k;
          g = mid[1] + (lit[1] - mid[1]) * k;
          bl = mid[2] + (lit[2] - mid[2]) * k;
        } else {
          const k = Math.min(1, (l01 - 0.7) / 0.2);
          r = lit[0] + (hot[0] - lit[0]) * k;
          g = lit[1] + (hot[1] - lit[1]) * k;
          bl = lit[2] + (hot[2] - lit[2]) * k;
        }
        // Interdune flats read paler and duller than the dune bodies.
        const flat = (1 - A) * 0.45;
        r += (pale[0] - r) * flat;
        g += (pale[1] - g) * flat;
        bl += (pale[2] - bl) * flat;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const n = 1 + ((seed >>> 8) / 16777216 - 0.5) * 0.08;
        const q = (y * w + x) * 4;
        d[q] = r * n;
        d[q + 1] = g * n;
        d[q + 2] = bl * n;
        d[q + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // Warm light falling off from the sun's side; cool air on the far side.
    light(c, w * 0.08, h * 0.02, Math.hypot(w, h) * 0.75, theme.accent, 0.16);
    const cool = c.createLinearGradient(w, h, w * 0.4, h * 0.3);
    cool.addColorStop(0, rgba(theme.accent2, 0.16));
    cool.addColorStop(1, rgba(theme.accent2, 0));
    c.fillStyle = cool;
    c.fillRect(0, 0, w, h);
    void u;
  };
}

/** Where ripples show: the open windward slopes, in patches. White = ripples. */
function rippleMask(c: Ctx2D, w: number, h: number) {
  const f = field(w, h);
  const img = c.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = phaseAt(f, x, y);
      const p = s - Math.floor(s);
      const A = at(f, f.A, x, y);
      const patch = at(f, f.P, x, y);
      const m =
        smoothstep(0.04, 0.22, p) * (1 - smoothstep(0.58, 0.75, p)) * (0.35 + 0.65 * A) * patch;
      const o = (y * w + x) * 4;
      d[o] = 255;
      d[o + 1] = 255;
      d[o + 2] = 255;
      d[o + 3] = m * 255;
    }
  c.putImageData(img, 0, 0);
}

/**
 * Ripple stripes across the wind, sinuous along their length. Periodic along
 * the wind with period P = |(3k, k)| px, so sliding by (3k, k) whole pixels
 * lands exactly on itself. Grey = neutral under overlay.
 */
function ripples(k: number, u: number) {
  const P = Math.sqrt(10) * k;
  return (c: Ctx2D, w: number, h: number) => {
    const img = c.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const a = x * DX + y * DY;
        const b = -x * DY + y * DX;
        const wob =
          u * 0.02 * pnoise(b / (u * 0.11), 64, 3) + u * 0.005 * pnoise(b / (u * 0.027), 64, 5);
        let q = (a + wob) / P;
        q -= Math.floor(q);
        // Gentle stoss side catches the sun, steep lee side falls dark.
        const v = q < 0.7 ? smoothstep(0, 0.7, q) * 0.8 - 0.1 : 0.7 - smoothstep(0.7, 1, q) * 1.7;
        const g = 128 + v * 62;
        const o = (y * w + x) * 4;
        d[o] = g;
        d[o + 1] = g;
        d[o + 2] = g;
        d[o + 3] = 255;
      }
    c.putImageData(img, 0, 0);
  };
}

/** Points along every crest line (for the sand blown off them). */
function crests(w: number, h: number) {
  return once(`dune-crest@${Math.round(w)}x${Math.round(h)}`, () => {
    const f = field(w, h);
    const { u } = layout(w, h);
    const out: number[] = [];
    const dy = Math.max(2, u / 120);
    for (let y = -h * 0.05; y < h * 1.05; y += dy) {
      const yy = Math.max(0, Math.min(h - 1, y));
      let prev = phaseAt(f, 0, yy);
      for (let x = 1; x < w; x += 1) {
        const s = phaseAt(f, x, yy);
        if (Math.floor(prev - CREST) !== Math.floor(s - CREST) && at(f, f.A, x, yy) > 0.35)
          out.push(x, y, at(f, f.A, x, yy));
        prev = s;
      }
    }
    return Float32Array.from(out);
  });
}

export const style: MotionStyle = {
  id: "sand-dunes",
  name: "Dune Light",
  family: "Nature",
  tagline: "A dune sea at last light",
  look: "An aerial dune sea at the last hour of sun: sharp sinuous crests, warm windward slopes, deep cool slip faces, fine ripples.",
  move: "The dunes hold still while the wind works: ripples march across every slope and sand streams off the crests in fine wisps.",
  rules: [
    "The light is low and from one side, so every crest splits warm from cool.",
    "Crest lines stay razor sharp; the slip face is always the dark side.",
    "Ripples are fine, sinuous and only on the open windward slopes.",
    "Ripples move exactly two wavelengths per loop, so they never jump.",
    "Sand leaves the crests downwind in thin wisps, brightest over shadow.",
    "One word, widely tracked, sits quietly in a shadow.",
    "No sky, no horizon: the dune field fills the frame edge to edge.",
  ],
  prompt: `R — References
• Aerial photography of the Namib and Sahara dune seas at golden hour (search: aerial dunes sidelight).
• Wind-blown sand off a dune crest, and migrating sand ripples.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): seen from straight above, sinuous dune crests split every slope into warm light and cool shadow; the word "{{name}}" sits tracked wide in a shadow.
• Middle (1.5–3.5 s): a gust: ripples march across the windward slopes and fine sand streams off every crest over the dark slip faces.
• End (3.5–5 s): the wind settles; the ripples land exactly two wavelengths along, identical to the first frame.

S — Style
Looks: windward slopes in {{accent}} rising to near-{{ink}} highlights at the crest, slip faces in deep {{accent2}}-tinted shadow on a {{bg}} base; sand grain on every pixel; the word in {{font}}, uppercase, tracked 0.5 em.
Moves: dunes are a height field (sawtooth profile bent by smooth noise) lit per pixel from a low sun; ripples are a periodic stripe texture sliding downwind two whole periods per loop, masked to the windward slopes; wisps are particles leaving the crests on whole-loop lifetimes.
Rules:
1. Low side light: warm lit side, cool dark side, sharp crest.
2. Ripples fine and sinuous, only on windward slopes.
3. Ripple travel = whole wavelengths per loop.
4. Wisps brightest over the shadow.
5. The field fills the frame; one tracked word.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; crests are crisp, not blurred; ripples never cross into shadow; the wisps read as sand, not smoke; the word never touches a crest. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Namib_Sand_Sea",
  theme: {
    bg: "#0c0907",
    ink: "#f5e9d6",
    accent: "#e0975a",
    accent2: "#46577a",
    font: "Inter",
  },
  tags: [
    "desert",
    "dune",
    "dunes",
    "sand",
    "wind",
    "aerial",
    "golden hour",
    "landscape",
    "warm",
    "nature",
    "minimal",
  ],
  word: "Namib",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `dune-lit:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
        w,
        h,
        dunes(theme),
      ) as CanvasImageSource,
      0,
      0,
    );

    // Ripples: slide downwind two whole periods per loop, masked to the windward slopes.
    // Period is |(3k, k)| px, so the slide is (6k, 2k) whole pixels: the loop closes exactly.
    const k = Math.max(1, Math.round((u * 0.012) / Math.sqrt(10)));
    const tex = bake(`dune-ripple-tex:${k}`, w + 8 * k, h + 4 * k, ripples(k, u));
    const mask = bake("dune-ripple-mask", w, h, rippleMask);
    const q = t / LOOP;
    const { canvas: rb, ctx: R } = buffer("dune-ripples", w, h);
    R.globalCompositeOperation = "copy";
    R.drawImage(tex as CanvasImageSource, -6 * k + 6 * k * q, -2 * k + 2 * k * q);
    R.globalCompositeOperation = "destination-in";
    R.drawImage(mask as CanvasImageSource, 0, 0);
    R.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(rb as CanvasImageSource, 0, 0);
    ctx.restore();

    // Sand streaming off the crests downwind, each grain drawn as a fading curved trail.
    const pts = crests(w, h);
    const n = pts.length / 3;
    if (n > 0) {
      const sand = mix(theme.accent, theme.ink, 0.6);
      const gusts = 0.7 + 0.3 * Math.sin(TAU * q - 0.6);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.lineCap = "round";
      const count = Math.min(170, n);
      for (let p = 0; p < count; p++) {
        const c = Math.floor(hash(p, 1) * n);
        const x0 = pts[c * 3];
        const y0 = pts[c * 3 + 1];
        const amp = pts[c * 3 + 2];
        const life = cyc(t, 1 + Math.floor(hash(p, 2) * 2), hash(p, 3));
        const reach = u * (0.04 + 0.1 * hash(p, 4)) * gusts * amp;
        const lift = u * 0.02 * (hash(p, 5) - 0.3);
        const curl = hash(p, 6) * TAU;
        const a = Math.sin(Math.PI * life) ** 1.6 * (0.1 + 0.25 * hash(p, 7)) * amp;
        if (a < 0.015) continue;
        ctx.lineWidth = Math.max(0.5, u * (0.0007 + 0.0009 * hash(p, 9)));
        // Trail: a few points back along its path, fading.
        let px = 0;
        let py = 0;
        for (let s = 0; s < 5; s++) {
          const l = Math.max(0, life - s * 0.035);
          const x = x0 + l * reach * DX * 1.05 - l * lift * DY;
          const y = y0 + l * reach * DY + l * lift * DX + Math.sin(curl + l * 5) * u * 0.003 * l;
          if (s > 0) {
            ctx.strokeStyle = rgba(sand, a * (1 - s / 5));
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
          px = x;
          py = y;
        }
      }
      // Veils of fine sand lifting off the crests and thinning out over the slip faces.
      const veil = glow(sand, 0.35);
      const ang = Math.atan2(DY, DX);
      const veils = Math.min(280, n);
      for (let p = 0; p < veils; p++) {
        const c = Math.floor(hash(p, 21) * n);
        const amp = pts[c * 3 + 2];
        const life = cyc(t, 1, hash(p, 22));
        const reach = u * (0.06 + 0.1 * hash(p, 23)) * gusts;
        const x = pts[c * 3] + life * reach * DX;
        const y = pts[c * 3 + 1] + life * reach * DY;
        const a = Math.sin(Math.PI * life) ** 2 * (0.1 + 0.16 * hash(p, 24)) * gusts * amp;
        if (a < 0.01) continue;
        const len = u * (0.04 + 0.1 * life) * (0.6 + hash(p, 25));
        const thick = u * (0.008 + 0.02 * life);
        ctx.globalAlpha = a;
        ctx.setTransform(Math.cos(ang), Math.sin(ang), -Math.sin(ang), Math.cos(ang), x, y);
        ctx.drawImage(veil as CanvasImageSource, -len * 0.3, -thick / 2, len, thick);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.restore();
      void blit;
    }

    // One word, tracked wide, in the quiet lower corner.
    const word = wordFor(theme.name, "Namib", 14).toUpperCase();
    const size = fitTracked(ctx, word, w * 0.5, u * 0.05, 500, theme.font, SANS, 0.55);
    ctx.fillStyle = rgba(theme.ink, 0.94);
    ctx.textBaseline = "alphabetic";
    const mx = u * 0.08;
    const wx = portrait ? w / 2 : w - mx;
    const width = tracked(
      ctx,
      word,
      wx,
      h - mx,
      size,
      500,
      theme.font,
      SANS,
      0.55,
      portrait ? "center" : "right",
    );
    // A dropped logo sits just before the word.
    const mark = tintedLogo(theme, theme.ink, size * 1.3, size * 1.3);
    if (mark) {
      const left = portrait ? wx - width / 2 : wx - width;
      ctx.drawImage(
        mark as CanvasImageSource,
        left - size * 1.9,
        h - mx - size * 1.05,
        size * 1.3,
        size * 1.3,
      );
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.28);
  },
};
