import { mix, parse } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  hash,
  light,
  once,
  rng,
  seg,
  smoothstep,
  TAU,
  vignette,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { fieldTile, mottle, noiseTile, sampleField, tileFill } from "./_s2-helpers";

/**
 * The finished, dried painting is baked once at full resolution (rich
 * per-pixel detail); each frame only computes low-res reveal mattes from the
 * same arrival fields, so the wet fronts spread softly over the baked detail.
 */
type Bloom = {
  x: number;
  y: number;
  R: number;
  sx: number;
  rot: number;
  t0: number;
  dur: number;
  /** Layer: 0 = accent, 1 = accent2. */
  layer: 0 | 1;
  water: boolean;
  seed: number;
};

const MATTE = 4;
const FEATHER = 0.16;
const COVER_START = 4.12;

// [dx, dy, R, stretch, rot, t0, dur, layer, water] for 16:9, in short-side units.
const SPEC: [number, number, number, number, number, number, number, 0 | 1, boolean][] = [
  [-0.36, -0.03, 0.33, 1.2, 0.3, 0.1, 1.7, 0, false],
  [0.33, 0.05, 0.34, 1.12, -0.4, 0.36, 1.75, 1, false],
  [-0.03, -0.17, 0.2, 1.3, 0.1, 0.85, 1.3, 0, false],
  [-0.2, 0.27, 0.14, 1.4, -0.2, 1.05, 1.1, 1, false],
  [0.62, -0.25, 0.1, 1.2, 0.8, 1.25, 0.9, 0, false],
  [0.14, 0.29, 0.09, 1.5, 0.4, 1.45, 0.85, 0, false],
  [-0.68, 0.22, 0.06, 1.2, 0.2, 1.6, 0.7, 1, false],
  [0.28, -0.03, 0.15, 1.1, 0.5, 2.05, 1.0, 1, true],
  [-0.4, 0.06, 0.12, 1.15, -0.3, 2.4, 0.95, 0, true],
];

function blooms(w: number, h: number): Bloom[] {
  const { u, cx, cy, portrait, square } = frameOf(w, h);
  return SPEC.map(([dx, dy, R, sx, rot, t0, dur, layer, water], i) => {
    // Re-layout, never crop: portrait turns the spread vertical, square folds it in.
    const [ox, oy, k, r2] = portrait
      ? [dy * 1.1, dx * 1.05, 1.12, rot + Math.PI / 2]
      : square
        ? [dx * 0.6, dy * 1.22, 0.84, rot]
        : [dx, dy, 1, rot];
    return {
      x: cx + ox * u,
      y: cy + oy * u,
      R: R * u * k,
      sx,
      rot: r2,
      t0,
      dur,
      layer,
      water,
      seed: i,
    };
  });
}

type Tiles = ReturnType<typeof tiles>;
const tiles = () =>
  once("wc-tiles", () => ({
    big: fieldTile(401, 256, 4, 3),
    mid: fieldTile(402, 256, 8, 3),
    fine: fieldTile(403, 256, 16, 3),
    blot: fieldTile(404, 256, 5, 4),
    gran: fieldTile(406, 256, 64, 2),
  }));

/** Normalised arrival time of bloom b at (x, y): < 1 inside its final extent. */
function arrival(b: Bloom, x: number, y: number, T: Tiles, u: number) {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const px = (x - b.x) / b.R;
  const py = (y - b.y) / b.R;
  const ax = (px * c + py * s) / b.sx;
  const ay = -px * s + py * c;
  const r = Math.hypot(ax, ay);
  if (r > 1.9) return 9;
  const o = b.seed * 47.3;
  const fx = (x / u) * 80;
  const fy = (y / u) * 80;
  const lobes = sampleField(T.big, 256, ax * 38 + o, ay * 38 - o);
  if (b.water)
    return (
      r * (1 + 0.5 * lobes) +
      0.12 * sampleField(T.mid, 256, fx * 2.4 + o, fy * 2.4) +
      0.24 * Math.abs(sampleField(T.fine, 256, fx * 6, fy * 6 + o)) -
      0.07
    );
  return (
    r * (1 + 0.5 * lobes) +
    0.14 * sampleField(T.mid, 256, fx * 1.6 + o, fy * 1.6) +
    0.06 * sampleField(T.fine, 256, fx * 5, fy * 5 + o) +
    0.02 * sampleField(T.gran, 256, fx * 3, fy * 3)
  );
}

/**
 * The dried painting, per pixel: two pigment layers (with granulation, streaks,
 * pooling at the landing point), the tide-line rim, and the backrun layers.
 * Stored as theme-free densities so a re-brand only recolours.
 */
function painting(w: number, h: number) {
  const W = Math.round(w);
  const H = Math.round(h);
  return once(`wc-paint:${W}x${H}`, () => {
    const list = blooms(W, H);
    const T = tiles();
    const { u } = frameOf(W, H);
    const n = W * H;
    const dA = new Float32Array(n);
    const dB = new Float32Array(n);
    const rim = new Float32Array(n);
    const brDark = new Float32Array(n);
    const brRim = new Float32Array(n);
    const pig = list.filter((b) => !b.water);
    const wat = list.filter((b) => b.water);
    const Tk = new Float32Array(pig.length);
    const Fk = new Float32Array(pig.length);
    const gs = (u / 540) * 2.4;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let TU = 9;
        for (let k = 0; k < pig.length; k++) {
          Tk[k] = arrival(pig[k], x, y, T, u);
          if (Tk[k] < TU) TU = Tk[k];
        }
        if (TU > 1.02) continue;
        const p = y * W + x;
        const fx = (x / u) * 80;
        const fy = (y / u) * 80;
        const edge = smoothstep(1.0, 0.982, TU);
        // Soft shares where pigments met wet, fingering into each other.
        let TF = 9;
        for (let k = 0; k < pig.length; k++) {
          Fk[k] =
            Tk[k] +
            0.26 * sampleField(T.fine, 256, fx * 2.2 + k * 71, fy * 2.2 - k * 29) +
            0.1 * sampleField(T.mid, 256, fx * 5 - k * 13, fy * 5 + k * 7);
          if (Fk[k] < TF) TF = Fk[k];
        }
        let sa = 0;
        let sb = 0;
        let centre = 0;
        for (let k = 0; k < pig.length; k++) {
          const wk = Math.exp(-(Fk[k] - TF) / 0.19);
          if (wk < 0.01) continue;
          if (pig[k].layer === 0) sa += wk;
          else sb += wk;
          centre += wk * Math.exp(-Tk[k] / 0.26);
        }
        const sum = sa + sb || 1;
        sa /= sum;
        sb /= sum;
        centre /= sum;
        // Cloudy body at two scales, a softer flow texture, a feathered fringe.
        const cloud =
          0.75 * sampleField(T.blot, 256, fx * 1.2, fy * 1.2) +
          0.25 * sampleField(T.blot, 256, fx * 3.4 + 91, fy * 3.4 - 40);
        const flow = sampleField(T.mid, 256, fx * 3.1 + 17, fy * 3.1);
        const gran = sampleField(T.gran, 256, x / gs, y / gs);
        let d = 0.32 + 0.44 * cloud + 0.12 * flow + 0.52 * centre;
        // Coffee ring: pigment backs up in a band just inside the dried edge.
        d += 0.46 * Math.pow(smoothstep(0.6, 0.99, TU), 1.6);
        // Granulation: sandy clumps, strongest in thin passages.
        d *= 0.86 + 0.75 * gran * (1.2 - Math.min(1, d));
        d = clamp(d) * edge;
        dA[p] = d * sa;
        dB[p] = d * sb;
        rim[p] = Math.min(
          1,
          edge * Math.exp(-Math.max(0, 0.986 - TU) / 0.016) * (1.15 + 0.4 * gran),
        );
        for (const b of wat) {
          const tb = arrival(b, x, y, T, u);
          if (tb > 1.02) continue;
          const inside = smoothstep(1.0, 0.975, tb);
          brDark[p] = Math.max(brDark[p], inside * (0.46 + 0.3 * flow) * edge);
          brRim[p] = Math.max(
            brRim[p],
            inside * Math.exp(-Math.max(0, 0.985 - tb) / 0.012) * Math.min(1, 0.4 + d * 1.2) * edge,
          );
        }
      }
    return { W, H, dA, dB, rim, brDark, brRim, list, pig, wat };
  });
}

/** Colourise the baked densities for a theme (cached per theme and size). */
function layers(theme: Theme, w: number, h: number) {
  const P = painting(w, h);
  const key = `${theme.accent}${theme.accent2}${theme.ink}${theme.bg}`;
  const make = (name: string, fill: (data: Uint8ClampedArray) => void) =>
    bake(`wc-${name}:${key}`, P.W, P.H, (c) => {
      const img = c.createImageData(P.W, P.H);
      fill(img.data);
      c.putImageData(img, 0, 0);
    });
  const put = (data: Uint8ClampedArray, src: Float32Array, rgb: [number, number, number]) => {
    for (let p = 0; p < src.length; p++) {
      const a = src[p];
      if (a <= 0.003) continue;
      const o = p * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = Math.round(clamp(a) * 255);
    }
  };
  return {
    P,
    A: make("A", (d) => put(d, P.dA, parse(theme.accent))),
    B: make("B", (d) => put(d, P.dB, parse(theme.accent2))),
    rim: make("rim", (d) => {
      for (let p = 0; p < P.rim.length; p++) {
        const a = P.rim[p];
        if (a <= 0.003) continue;
        const share = P.dA[p] / (P.dA[p] + P.dB[p] || 1);
        const col = [
          parse(mix(theme.accent, theme.ink, 0.45)),
          parse(mix(theme.accent2, theme.ink, 0.45)),
        ];
        const o = p * 4;
        d[o] = col[1][0] + (col[0][0] - col[1][0]) * share;
        d[o + 1] = col[1][1] + (col[0][1] - col[1][1]) * share;
        d[o + 2] = col[1][2] + (col[0][2] - col[1][2]) * share;
        d[o + 3] = Math.round(clamp(a) * 255);
      }
    }),
    brDark: make("brd", (d) => put(d, P.brDark, parse(theme.bg))),
    brRim: make("brr", (d) =>
      put(d, P.brRim, parse(mix(mix(theme.accent, theme.accent2, 0.5), theme.ink, 0.35))),
    ),
  };
}

/** Low-res arrival fields for the per-frame mattes, plus the cover field. */
function matteFields(w: number, h: number) {
  const bw = Math.max(8, Math.round(w / MATTE));
  const bh = Math.max(8, Math.round(h / MATTE));
  return once(`wc-mf:${bw}x${bh}:${Math.round(w)}x${Math.round(h)}`, () => {
    const list = blooms(w, h);
    const T = tiles();
    const { u, cx, cy } = frameOf(w, h);
    const F = list.map(() => new Float32Array(bw * bh));
    const C = new Float32Array(bw * bh);
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) {
        const x = ((i + 0.5) * w) / bw;
        const y = ((j + 0.5) * h) / bh;
        const p = j * bw + i;
        list.forEach((b, k) => {
          F[k][p] = arrival(b, x, y, T, u);
        });
        const ex = Math.abs(x - cx) / (w / 2);
        const ey = Math.abs(y - cy) / (h / 2);
        C[p] =
          Math.pow(Math.pow(ex, 3) + Math.pow(ey, 3), 1 / 3) * 0.88 +
          0.12 * sampleField(T.mid, 256, (x / u) * 70, (y / u) * 70) +
          0.06 * sampleField(T.fine, 256, (x / u) * 170, (y / u) * 170);
      }
    return { bw, bh, F, C, list };
  });
}

/** Reused matte pixel buffers, one set per size (no per-frame allocation). */
const matteImages = new Map<string, ImageData[]>();

/** Per frame: one low-res matte per group (accent, accent2, backruns, union), cover applied. */
function mattes(t: number, w: number, h: number) {
  const { bw, bh, F, C, list } = matteFields(w, h);
  const cover = ease.inOutCubic(seg(t, COVER_START, 4.95));
  const coverAt = 1.12 - cover * 1.28;
  const nb = list.length;
  const fr = new Float32Array(nb);
  const group = new Int8Array(nb);
  list.forEach((b, k) => {
    fr[k] = ease.outCubic(seg(t, b.t0, b.t0 + b.dur)) * (1 + FEATHER);
    group[k] = b.water ? 2 : b.layer;
  });
  const out = [0, 1, 2, 3].map((g) => buffer(`wc-matte${g}`, bw, bh));
  const sizeKey = `${bw}x${bh}`;
  let imgs = matteImages.get(sizeKey);
  if (!imgs) {
    imgs = out.map((o) => o.ctx.createImageData(bw, bh));
    matteImages.set(sizeKey, imgs);
    if (matteImages.size > 8) matteImages.delete(matteImages.keys().next().value as string);
  }
  const d0 = imgs[0].data;
  const d1 = imgs[1].data;
  const d2 = imgs[2].data;
  const d3 = imgs[3].data;
  d0.fill(0);
  d1.fill(0);
  d2.fill(0);
  d3.fill(0);
  const n = bw * bh;
  for (let p = 0; p < n; p++) {
    const kept = cover > 0 ? 1 - smoothstep(coverAt - 0.03, coverAt + 0.03, C[p]) : 1;
    if (kept <= 0.001) continue;
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    for (let k = 0; k < nb; k++) {
      const f = fr[k];
      if (f <= 0) continue;
      const a = F[k][p];
      if (f <= a) continue;
      const v = f >= a + FEATHER ? 1 : smoothstep(a, a + FEATHER, f);
      const g = group[k];
      if (g === 0) {
        if (v > m0) m0 = v;
      } else if (g === 1) {
        if (v > m1) m1 = v;
      } else if (v > m2) m2 = v;
    }
    const o = p * 4 + 3;
    const s = kept * 255;
    if (m0 > 0) d0[o] = Math.round(m0 * s);
    if (m1 > 0) d1[o] = Math.round(m1 * s);
    if (m2 > 0) d2[o] = Math.round(m2 * s);
    const mu = m0 > m1 ? m0 : m1;
    if (mu > 0) d3[o] = Math.round(mu * s);
  }
  out.forEach((o, g) => o.ctx.putImageData((imgs as ImageData[])[g], 0, 0));
  return { m: out.map((o) => o.canvas), cover };
}

function paper(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.01, 0.02, u * 0.3, u / 110, 5.3);
    // Faint tide-line ghosts of earlier washes: the sheet has been worked before.
    const r = rng(808);
    c.lineCap = "round";
    for (let k = 0; k < 6; k++) {
      const x = r() * w;
      const y = r() * h;
      const R = u * (0.06 + r() * 0.14);
      c.strokeStyle = mix(theme.bg, mix(theme.ink, theme.accent2, 0.4), 0.05 + r() * 0.03);
      c.lineWidth = Math.max(1, u * 0.0022);
      c.beginPath();
      for (let a = 0; a <= 72; a++) {
        const ang = (a / 72) * TAU;
        const rr = R * (1 + 0.16 * Math.sin(ang * 3 + k) + 0.07 * Math.sin(ang * 7 + k * 2));
        const px = x + Math.cos(ang) * rr;
        const py = y + Math.sin(ang) * rr;
        if (a === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();
    }
  };
}

/** Draw `src` through an upscaled low-res matte into a scratch buffer, then onto ctx. */
function throughMatte(
  ctx: Ctx2D,
  src: CanvasImageSource,
  matte: CanvasImageSource,
  w: number,
  h: number,
  alpha = 1,
  op: GlobalCompositeOperation = "source-over",
) {
  if (alpha <= 0.002) return;
  const { canvas, ctx: s } = buffer("wc-scratch", w, h);
  s.save();
  s.globalCompositeOperation = "copy";
  s.drawImage(src, 0, 0, w, h);
  s.globalCompositeOperation = "destination-in";
  s.imageSmoothingEnabled = true;
  s.imageSmoothingQuality = "high";
  s.drawImage(matte, 0, 0, w, h);
  s.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(canvas as CanvasImageSource, 0, 0);
  ctx.restore();
}

export const style: MotionStyle = {
  id: "watercolor-bloom",
  name: "Watercolor Bloom",
  family: "Paint & Draw",
  tagline: "Wet-in-wet watercolour blooms",
  look: "Luminous pigment dropped wet-in-wet on dark cold-press paper: lobed blooms, feathered bleeds, bright tide lines, granulation.",
  move: "Drops land and bleed outward fast then stall, pigments mingle, clear water punches cauliflower backruns, a wash bleeds back in.",
  rules: [
    "Bloom edges are lobed and ragged at three scales, never a circle.",
    "Fronts feather while wet; the dried edge is hard with a tide line.",
    "No tide line where two pigments met wet: they finger into each other.",
    "Pigment pools where each drop landed and streaks outward from it.",
    "Granulation is fine and sandy, strongest in the thin passages.",
    "Clear-water drops push pigment into cauliflower backruns.",
    "Fast spread, slow stall: every front eases out.",
  ],
  prompt: `R — References
• Wet-in-wet watercolour, blooms and backruns (search: watercolor cauliflower bloom, wet in wet bleed, watercolor on black paper).
• Granulating pigments settling into cold-press paper; tide lines where a wash dried.

I — Idea
One wash, 5 seconds, looping seamlessly:
• Beginning (0–1.6 s): drops of {{accent}} and {{accent2}} land one after another on wet dark paper and bleed outward with soft, lobed fronts.
• Middle (1.6–4.1 s): the blooms meet and finger into each other; clear-water drops punch cauliflower backruns; the outer edges dry hard with bright tide lines.
• End (4.1–5 s): a wash the colour of the paper bleeds in from the frame edges with a ragged front and leaves the clean sheet the loop began on.

S — Style
Looks: {{bg}} cold-press paper with a hammered tooth; luminous {{accent}} and {{accent2}} pigment pooling where it landed and streaking outward; lighter tide lines; fine sandy granulation. No type: the paint is the subject.
Moves: bake the dried painting once at full resolution; each frame reveals it through soft mattes that follow noise-warped arrival fields with an ease-out; backruns spread fast then stall; the closing wash eases in and out.
Rules:
1. Lobed, ragged edges at three noise scales; never a circle.
2. Feathered while wet, hard and rimmed when dry.
3. Pigments finger into each other where they met; no rim between them.
4. Pooling at the landing point, radial streaks outward.
5. Fine granulation, strongest in thin passages.
6. Backruns: bare centre, lacy rim of displaced pigment.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; nothing reads as a circle, a Venn diagram or an airbrush blob; the tide line is visible; granulation reads as sand, not spots; mixes stay bright. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Watercolor_painting",
  theme: {
    bg: "#0d0e12",
    ink: "#f1ebe0",
    accent: "#ff5f7e",
    accent2: "#5b6cff",
    font: "Newsreader",
  },
  tags: [
    "watercolor",
    "watercolour",
    "paint",
    "bloom",
    "wet",
    "wash",
    "pigment",
    "bleed",
    "organic",
    "artistic",
    "soft",
  ],
  word: "Bloom",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `wc-paper:${theme.bg}${theme.ink}${theme.accent2}`,
        w,
        h,
        paper(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.32, h * 0.22, Math.max(w, h) * 0.9, theme.ink, 0.05);

    const Ls = layers(theme, w, h);
    const { m, cover } = mattes(t, w, h);
    const { canvas: paintCanvas, ctx: Pn } = buffer("wc-paint-layer", w, h);
    Pn.clearRect(0, 0, w, h);
    // Two pigments mixed additively: overlaps turn luminous, never muddy.
    throughMatte(Pn, Ls.A as CanvasImageSource, m[0] as CanvasImageSource, w, h, 1);
    throughMatte(Pn, Ls.B as CanvasImageSource, m[1] as CanvasImageSource, w, h, 1, "lighter");
    // Backruns: bare centres and lacy rims, revealed by their own fronts.
    throughMatte(
      Pn,
      Ls.brDark as CanvasImageSource,
      m[2] as CanvasImageSource,
      w,
      h,
      1,
      "destination-out",
    );
    throughMatte(Pn, Ls.brRim as CanvasImageSource, m[2] as CanvasImageSource, w, h, 1, "lighter");
    // Tide lines gather as the wash dries.
    const dry = 0.25 + 0.75 * ease.inOutSine(seg(t, 1.2, 3.0));
    throughMatte(Pn, Ls.rim as CanvasImageSource, m[3] as CanvasImageSource, w, h, dry, "lighter");

    // Spatter: a few droplets thrown off as the two big drops land.
    Ls.P.pig.slice(0, 2).forEach((d, k) => {
      const kk = seg(t, d.t0, d.t0 + 0.25);
      if (kk <= 0) return;
      const r = rng(900 + k * 31);
      Pn.fillStyle = k === 0 ? theme.accent : theme.accent2;
      for (let i = 0; i < 6; i++) {
        const a = r() * TAU;
        const dist = d.R * (1.05 + r() * 0.4);
        const s = u * (0.0025 + r() * r() * 0.008) * ease.outCubic(kk);
        Pn.globalAlpha = (0.55 + 0.35 * hash(i, k)) * (1 - cover);
        Pn.beginPath();
        Pn.arc(d.x + Math.cos(a) * dist, d.y + Math.sin(a) * dist, s, 0, TAU);
        Pn.fill();
      }
    });
    Pn.globalAlpha = 1;
    // A dropped logo is masking fluid: bare paper inside the first bloom.
    const d0 = Ls.P.pig[0];
    const box = d0.R * 0.4;
    const mark = tintedLogo(theme, "#000000", box, box);
    if (mark) {
      Pn.save();
      Pn.globalCompositeOperation = "destination-out";
      Pn.drawImage(mark as CanvasImageSource, d0.x - box / 2, d0.y - box / 2);
      Pn.restore();
    }

    // Luminous pigment: a faint glow under the crisp layer.
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.globalCompositeOperation = "screen";
    ctx.filter = `blur(${(u * 0.012).toFixed(1)}px)`;
    ctx.drawImage(paintCanvas as CanvasImageSource, 0, 0);
    ctx.restore();
    ctx.drawImage(paintCanvas as CanvasImageSource, 0, 0);

    // Paper relief over everything: the hammered cold-press tooth.
    const k = Math.max(0.5, u / 900);
    tileFill(
      ctx,
      noiseTile(612, 256, 24, 3, 0.9, 0.5, "#ffffff"),
      w,
      h,
      k * 1.4,
      0.1,
      "soft-light",
    );
    tileFill(ctx, noiseTile(613, 256, 24, 3, 0.9, 0.5), w, h, k * 1.4, 0.12, "soft-light", 37, 11);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
