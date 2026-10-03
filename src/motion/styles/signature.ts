import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  light,
  MONO,
  once,
  SANS,
  seg,
  smoothstep,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkStock, loopT, setType, typeEpoch, widthOf, type Box } from "./_s8-helpers";

const SCRIPT_FAMILY = "Herr Von Muellerhoff";
const SCRIPT = `"${SCRIPT_FAMILY}", "Brush Script MT", cursive`;
const T0 = 0.32;
const T1 = 2.5;
const F0 = 2.46;
const F1 = 2.86;
const OUT0 = 4.2;
const OUT1 = 4.8;
const MASK_MAX = 640;

interface Sig {
  /** Signature box in frame pixels. */
  box: Box;
  size: number;
  /** Baseline of the last line (the signature line sits just under it). */
  baseline: number;
  lines: SigLine[];
  /** Mask resolution and the draw-order time of every mask pixel (0..1, 2 = no ink). */
  mw: number;
  mh: number;
  time: Float32Array;
  /** Skeleton points in draw order (frame pixels) for the pen tip. */
  tipX: Float32Array;
  tipY: Float32Array;
  tipT: Float32Array;
}

const N8 = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Remove short spurs thinning leaves on thick strokes (branches of at most
 * maxLen pixels that end in a tip), so the pen never doubles back into them.
 */
function prune(sk: Uint8Array, W: number, H: number, maxLen: number) {
  const nbrs = (p: number) => {
    const px = p % W;
    const py = (p - px) / W;
    const out: number[] = [];
    for (const [dx, dy] of N8) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && sk[ny * W + nx]) out.push(ny * W + nx);
    }
    return out;
  };
  for (let iter = 0; iter < 3; iter++) {
    const ends: number[] = [];
    for (let i = 0; i < W * H; i++) if (sk[i] && nbrs(i).length === 1) ends.push(i);
    let removed = 0;
    for (const e of ends) {
      if (!sk[e]) continue;
      const path = [e];
      let prev = -1;
      let cur = e;
      let junction = false;
      while (path.length <= maxLen) {
        const next = nbrs(cur).filter((n) => n !== prev && !path.includes(n));
        if (next.length !== 1) {
          junction = next.length > 1;
          break;
        }
        if (nbrs(next[0]).length >= 3) {
          junction = true;
          break;
        }
        prev = cur;
        cur = next[0];
        path.push(cur);
      }
      if (junction && path.length <= maxLen) {
        for (const q of path) sk[q] = 0;
        removed++;
      }
    }
    if (!removed) break;
  }
}

/** Zhang–Suen thinning of a binary image (1 = ink), in place. */
function thin(img: Uint8Array, W: number, H: number) {
  const del: number[] = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 60) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!img[i]) continue;
          const p2 = img[i - W];
          const p3 = img[i - W + 1];
          const p4 = img[i + 1];
          const p5 = img[i + W + 1];
          const p6 = img[i + W];
          const p7 = img[i + W - 1];
          const p8 = img[i - 1];
          const p9 = img[i - W - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A =
            (!p2 && p3 ? 1 : 0) +
            (!p3 && p4 ? 1 : 0) +
            (!p4 && p5 ? 1 : 0) +
            (!p5 && p6 ? 1 : 0) +
            (!p6 && p7 ? 1 : 0) +
            (!p7 && p8 ? 1 : 0) +
            (!p8 && p9 ? 1 : 0) +
            (!p9 && p2 ? 1 : 0);
          if (A !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          del.push(i);
        }
      for (const i of del) img[i] = 0;
      if (del.length) changed = true;
    }
  }
}

/**
 * Order the ink like a pen would: thin the glyphs to a skeleton, walk each
 * stroke left to right (continuing straight through junctions, retracing to
 * reach branches), dot the small marks last, then give every ink pixel the
 * time of its nearest skeleton pixel.
 */
function drawOrder(ink: Uint8Array, W: number, H: number, splitY = Infinity) {
  const sk = ink.slice();
  thin(sk, W, H);
  // Stroke width at mask scale sets how long a spur can be.
  let area = 0;
  let line = 0;
  for (let i = 0; i < W * H; i++) {
    area += ink[i];
    line += sk[i];
  }
  prune(sk, W, H, Math.max(4, Math.round((area / Math.max(1, line)) * 1.6)));
  const time = new Float32Array(W * H).fill(-1);
  const seen = new Uint8Array(W * H);
  // Components of the skeleton.
  const comps: number[][] = [];
  const cid = new Int32Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) {
    if (!sk[i] || cid[i] >= 0) continue;
    const list: number[] = [];
    const q = [i];
    cid[i] = comps.length;
    while (q.length) {
      const p = q.pop() as number;
      list.push(p);
      const px = p % W;
      const py = (p - px) / W;
      for (const [dx, dy] of N8) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (sk[n] && cid[n] < 0) {
          cid[n] = comps.length;
          q.push(n);
        }
      }
    }
    comps.push(list);
  }
  const minX = (l: number[]) => l.reduce((m, p) => Math.min(m, p % W), W);
  // Components belong to the line their centre sits on; order by line, then from the left.
  const lineOf = (l: number[]) => {
    let sy = 0;
    for (const p of l) sy += (p - (p % W)) / W;
    return sy / l.length > splitY ? 1 : 0;
  };
  const order = (a: number[], b: number[]) => lineOf(a) - lineOf(b) || minX(a) - minX(b);
  const big = comps.filter((l) => l.length >= 10).sort(order);
  const dots = comps.filter((l) => l.length < 10).sort(order);
  const degree = (p: number) => {
    const px = p % W;
    const py = (p - px) / W;
    let d = 0;
    for (const [dx, dy] of N8) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && sk[ny * W + nx]) d++;
    }
    return d;
  };
  const tips: number[] = [];
  let clock = 0;
  const walk = (list: number[]) => {
    const ends = list.filter((p) => degree(p) === 1);
    let cur = (ends.length ? ends : list).reduce((a, b) => (a % W <= b % W ? a : b));
    let dx = 1;
    let dy = 0;
    let left = list.length;
    while (left > 0) {
      seen[cur] = 1;
      time[cur] = clock;
      tips.push(cur);
      clock += 1;
      left--;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      let best = -1;
      let bestScore = -Infinity;
      for (const [ox, oy] of N8) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!sk[n] || seen[n]) continue;
        const len = Math.hypot(ox, oy);
        const score = (ox * dx + oy * dy) / len - (len > 1 ? 0.05 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }
      if (best >= 0) {
        const bx = best % W;
        const by = (best - bx) / W;
        const nx = bx - cx;
        const ny = by - cy;
        // A diagonal step must not skip the staircase pixels beside it.
        if (nx !== 0 && ny !== 0)
          for (const c of [cy * W + bx, by * W + cx])
            if (sk[c] && !seen[c]) {
              seen[c] = 1;
              time[c] = clock;
              left--;
            }
        const l = Math.hypot(nx, ny);
        dx = dx * 0.55 + (nx / l) * 0.45;
        dy = dy * 0.55 + (ny / l) * 0.45;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        cur = best;
        continue;
      }
      if (left <= 0) break;
      // Stuck: retrace along the skeleton to the nearest unvisited pixel.
      const dist = new Map<number, number>([[cur, 0]]);
      const q = [cur];
      let found = -1;
      for (let qi = 0; qi < q.length && found < 0; qi++) {
        const p = q[qi];
        const px = p % W;
        const py = (p - px) / W;
        for (const [ox, oy] of N8) {
          const nx = px + ox;
          const ny = py + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (!sk[n] || dist.has(n)) continue;
          dist.set(n, (dist.get(p) as number) + 1);
          if (!seen[n]) {
            found = n;
            break;
          }
          q.push(n);
        }
      }
      if (found < 0) break;
      clock += (dist.get(found) as number) * 0.5;
      cur = found;
    }
  };
  for (const l of big) {
    walk(l);
    clock += 6;
  }
  clock += 10;
  for (const l of dots) {
    walk(l);
    clock += 4;
  }
  const total = Math.max(1, clock);
  // Spread skeleton times to every ink pixel (multi-source BFS = nearest skeleton pixel).
  const q: number[] = [];
  for (let i = 0; i < W * H; i++) if (time[i] >= 0) q.push(i);
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    const px = p % W;
    const py = (p - px) / W;
    for (const [ox, oy] of N8) {
      const nx = px + ox;
      const ny = py + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!ink[n] || time[n] >= 0) continue;
      time[n] = time[p];
      q.push(n);
    }
  }
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = ink[i] ? (time[i] >= 0 ? time[i] / total : 1) : 2;
  return { time: out, tips: tips.map((p) => [p % W, (p - (p % W)) / W, time[p] / total] as const) };
}

interface SigLine {
  text: string;
  x: number;
  y: number;
}

function signature(w: number, h: number, name: string): Sig {
  const { portrait, square } = frameOf(w, h);
  const probe = once("sig-probe", () => {
    const cv =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(8, 8)
        : document.createElement("canvas");
    return cv.getContext("2d") as Ctx2D;
  });
  setType(probe, 400, 100, SCRIPT_FAMILY, { fallback: SCRIPT });
  // Tall frames sign a two-word name on two lines, the second set in, as autographs are.
  const words = name.split(/\s+/).filter(Boolean);
  const texts = portrait && words.length > 1 ? [words[0], words.slice(1).join(" ")] : [name];
  const ms100 = texts.map((t) => probe.measureText(t));
  const indent = texts.length > 1 ? 0.34 : 0;
  const lineGap = 0.78;
  const span = Math.max(
    ...ms100.map(
      (m, i) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight + (i ? indent * 100 : 0),
    ),
  );
  const asc = ms100[0].actualBoundingBoxAscent;
  const desc = ms100[ms100.length - 1].actualBoundingBoxDescent;
  const tall = asc + desc + (texts.length - 1) * lineGap * 100;
  const size = Math.min(
    (100 * w * (portrait ? 0.84 : square ? 0.8 : 0.76)) / span,
    (100 * h * (portrait ? 0.4 : 0.44)) / tall,
  );
  const k = size / 100;
  const pad = size * 0.08;
  const bw = span * k + pad * 2;
  const bh = tall * k + pad * 2;
  const bx = (w - bw) / 2;
  const baseline = h * (portrait ? 0.6 : square ? 0.56 : 0.6) - (texts.length - 1) * lineGap * size;
  const by = baseline - asc * k - pad;
  const lines: SigLine[] = texts.map((text, i) => ({
    text,
    x: bx + pad + ms100[i].actualBoundingBoxLeft * k + (i ? indent * size : 0),
    y: baseline + i * lineGap * size,
  }));
  // Mask at a bounded resolution.
  const ms = Math.min(1, MASK_MAX / bw);
  const mw = Math.max(8, Math.round(bw * ms));
  const mh = Math.max(8, Math.round(bh * ms));
  const cv =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(mw, mh)
      : Object.assign(document.createElement("canvas"), { width: mw, height: mh });
  const g = cv.getContext("2d") as Ctx2D;
  g.scale(ms, ms);
  for (const l of lines) inkText(g, l.text, size, l.x - bx, l.y - by, "#ffffff");
  const px = g.getImageData(0, 0, mw, mh).data;
  const ink = new Uint8Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) ink[i] = px[i * 4 + 3] > 90 ? 1 : 0;
  const split = lines.length > 1 ? (baseline + lineGap * size * 0.35 - by) * ms : Infinity;
  const { time, tips } = drawOrder(ink, mw, mh, split);
  return {
    box: { x: bx, y: by, w: bw, h: bh },
    size,
    baseline: lines[lines.length - 1].y,
    lines,
    mw,
    mh,
    time,
    tipX: Float32Array.from(tips, (p) => bx + (p[0] + 0.5) / ms),
    tipY: Float32Array.from(tips, (p) => by + (p[1] + 0.5) / ms),
    tipT: Float32Array.from(tips, (p) => p[2]),
  };
}

/** The signature as a pen would lay it: the script face, slightly swollen like gel ink. */
function inkText(c: Ctx2D, name: string, size: number, x: number, y: number, color: string) {
  setType(c, 400, size, SCRIPT_FAMILY, { fallback: SCRIPT });
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineWidth = size * 0.022;
  c.lineJoin = "round";
  c.textBaseline = "alphabetic";
  c.fillText(name, x, y);
  c.strokeText(name, x, y);
}

/** The pen's closing flourish: a fast underline swept back under the name. */
function flourish(c: Ctx2D, S: Sig, p: number, color: string) {
  if (p <= 0) return;
  const { x: bx, w: bw } = S.box;
  const base = S.baseline;
  const sz = S.size;
  const P = [
    [bx + bw * 0.94, base - sz * 0.06],
    [bx + bw * 0.66, base + sz * 0.16],
    [bx + bw * 0.3, base + sz * 0.12],
    [bx + bw * 0.07, base + sz * 0.02],
  ];
  const n = 60;
  const m = Math.max(2, Math.floor(n * p));
  const pts: [number, number][] = [];
  for (let i = 0; i <= m; i++) {
    const s = i / n;
    const a = (1 - s) ** 3;
    const b = 3 * (1 - s) ** 2 * s;
    const cc = 3 * (1 - s) * s * s;
    const d = s ** 3;
    pts.push([
      a * P[0][0] + b * P[1][0] + cc * P[2][0] + d * P[3][0],
      a * P[0][1] + b * P[1][1] + cc * P[2][1] + d * P[3][1],
    ]);
  }
  const W = S.size * 0.03;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [x2, y2] = pts[Math.min(pts.length - 1, i + 1)];
    const [x1, y1] = pts[Math.max(0, i - 1)];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l = Math.hypot(dx, dy) || 1;
    const s = i / n;
    const wv = W * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + s * 0.95))) * (1 - 0.7 * s);
    left.push([x - (dy / l) * wv, y + (dx / l) * wv]);
    right.push([x + (dy / l) * wv, y - (dx / l) * wv]);
  }
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) c.lineTo(x, y);
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
  c.fill();
}

export const style: MotionStyle = {
  id: "signature",
  name: "Signature",
  family: "Type & Editorial",
  tagline: "A gold gel-pen signature",
  look: "A gold gel-pen signature on a dark card, signed above a hairline with a small cross, the typed name and date beneath.",
  move: "The pen writes the name stroke by stroke in its real order, dots the i's last, whips an underline, the wet ink dries, then it fades.",
  rules: [
    "The pen follows the letters' own path: a skeleton walk, not a wipe.",
    "Strokes go left to right; small marks (dots, crosses) come last.",
    "A pen lift is a short pause, never a jump cut.",
    "Fresh ink is brighter and dries to the ink colour within a second.",
    "One accent: the ink. Everything else is quiet hairlines and captions.",
    "The closing flourish is fast and tapers to nothing.",
    "Hold the finished signature at least 1.2 s.",
  ],
  prompt: `R — References
• Real signatures written with a gel pen, filmed from above (search: signature writing close up, signing a contract).
• Stroke-order animations of handwriting; a signature line with a small cross, typed name and date.

I — Idea
A name signed live, 5 seconds, looping seamlessly:
• Beginning (0–0.3 s): an empty signature line, a small ×, the typed name and date beneath.
• Middle (0.3–2.9 s): a pen signs "{{name}}" in one fast gesture — strokes in their real order, a pen lift between words, the dots last — then whips an underline back under the name.
• End (2.9–5 s): the wet ink dries from bright to gold and holds 1.3 s, then the signature fades and the empty line waits, as at the start.

S — Style
Looks: {{bg}} card with grain and a warm light; the signature in {{accent}} gel ink (Herr Von Muellerhoff, swollen slightly like a pen); a hairline in {{ink}}; tiny tracked captions in {{font}}; the date in mono.
Moves: the reveal follows a thinned skeleton of the letters, left to right, continuing straight through junctions; small marks after; the flourish is a tapered cubic curve drawn in 0.4 s; wet ink is brighter for about 0.8 s behind the pen.
Rules:
1. Real stroke order from the letter skeleton, never a left-to-right wipe.
2. Dots and crosses last.
3. Wet ink behind the pen, drying.
4. One accent colour: the ink.
5. A tapered flourish.
6. Hold at least 1.2 s.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; mid-signature frames show whole strokes, not a vertical wipe edge; loops are drawn round, not filled at once; the flourish tapers; nothing clips at the frame edge. Fix what fails and render again until every check passes.`,
  ref: "https://fonts.google.com/specimen/Herr+Von+Muellerhoff",
  theme: {
    bg: "#0d0c0b",
    ink: "#efe9dd",
    accent: "#dcb872",
    accent2: "#7e786f",
    font: "Inter",
  },
  fonts: [SCRIPT_FAMILY, "Inter:wght@400..700", "JetBrains Mono:wght@400;500"],
  tags: [
    "signature",
    "handwriting",
    "script",
    "pen",
    "sign",
    "calligraphy",
    "autograph",
    "gold",
    "luxury",
    "editorial",
    "writing",
  ],
  word: "Motion Library",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "sig", w, h, 41) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.42, h * 0.3, Math.max(w, h) * 0.75, mix(theme.ink, theme.accent, 0.3), 0.08);

    const name = wordFor(theme.name, "Motion Library", 18);
    const S = once(`sig:${w}x${h}:${name}:${typeEpoch()}`, () => signature(w, h, name));
    const B = S.box;

    // Line, cross, typed name and date: always there.
    const lineY = S.baseline + S.size * 0.1;
    const lx0 = w * 0.12;
    const lx1 = w * 0.88;
    ctx.fillStyle = rgba(theme.ink, 0.42);
    ctx.fillRect(lx0, Math.round(lineY), lx1 - lx0, Math.max(1, u * 0.0014));
    const cap = Math.max(6, u * 0.02);
    ctx.strokeStyle = rgba(theme.ink, 0.6);
    ctx.lineWidth = Math.max(1, u * 0.002);
    const cx0 = lx0 + cap * 0.6;
    const cy0 = lineY - cap * 1.1;
    ctx.beginPath();
    ctx.moveTo(cx0 - cap * 0.4, cy0 - cap * 0.4);
    ctx.lineTo(cx0 + cap * 0.4, cy0 + cap * 0.4);
    ctx.moveTo(cx0 + cap * 0.4, cy0 - cap * 0.4);
    ctx.lineTo(cx0 - cap * 0.4, cy0 + cap * 0.4);
    ctx.stroke();
    setType(ctx, 600, cap, theme.font, { fallback: SANS, tracking: 0.2 });
    ctx.fillStyle = rgba(theme.ink, 0.7);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(name.toUpperCase(), lx0, lineY + cap * 2.2);
    setType(ctx, 500, cap * 0.92, "JetBrains Mono", { fallback: MONO, tracking: 0.08 });
    ctx.fillStyle = rgba(theme.ink, 0.45);
    ctx.textAlign = "right";
    ctx.fillText("24 · 09 · 2026", lx1, lineY + cap * 2.2);
    ctx.textAlign = "left";
    const mark = tintedLogo(theme, rgba(theme.ink, 0.5), cap * 3.2, cap * 1.8);
    if (mark) ctx.drawImage(mark as CanvasImageSource, lx1 - cap * 3.2, h * 0.1);

    // Pen progress: a little slower at the start and the end of the gesture.
    const p = ease.inOutSine(seg(t, T0, T1)) * 0.94 + seg(t, T0, T1) * 0.06;
    const fade = 1 - ease.inOutSine(seg(t, OUT0, OUT1));
    const dry = ease.outCubic(seg(t, T1, T1 + 0.9));
    if (p > 0 && fade > 0.001) {
      const { canvas: M, ctx: mc } = buffer("sig-mask", S.mw, S.mh);
      const { canvas: Wm, ctx: wc } = buffer("sig-wet", S.mw, S.mh);
      const [img, wet] = once(`sig-img:${S.mw}x${S.mh}`, () => [
        mc.createImageData(S.mw, S.mh),
        wc.createImageData(S.mw, S.mh),
      ]);
      img.data.fill(0);
      wet.data.fill(0);
      const soft = 0.006;
      const band = 0.09;
      const T = S.time;
      for (let i = 0; i < T.length; i++) {
        const v = T[i];
        if (v > 1.5) continue;
        const a = 1 - smoothstep(p - soft, p + soft, v);
        if (a <= 0) continue;
        img.data[i * 4 + 3] = a * 255;
        const fresh = (1 - clamp((p - v) / band)) * (1 - dry);
        if (fresh > 0) wet.data[i * 4 + 3] = a * fresh * 255;
      }
      mc.putImageData(img, 0, 0);
      wc.putImageData(wet, 0, 0);
      const inkKey = `${theme.accent}:${name}:${w}x${h}:${typeEpoch()}`;
      const draw = (color: string) => (c: Ctx2D) => {
        for (const l of S.lines) inkText(c, l.text, S.size, l.x - B.x, l.y - B.y, color);
      };
      const inkLayer = bake(`sig-ink:${inkKey}`, B.w, B.h, draw(theme.accent));
      const hiLayer = bake(`sig-hi:${inkKey}`, B.w, B.h, draw(mix(theme.accent, "#ffffff", 0.55)));
      const reveal = (layer: AnyCanvas, mask: AnyCanvas, key: string, alpha: number) => {
        const { canvas: A, ctx: ac } = buffer(key, B.w, B.h);
        ac.globalCompositeOperation = "source-over";
        ac.clearRect(0, 0, B.w, B.h);
        ac.drawImage(layer as CanvasImageSource, 0, 0);
        ac.globalCompositeOperation = "destination-in";
        ac.imageSmoothingEnabled = true;
        ac.drawImage(mask as CanvasImageSource, 0, 0, B.w, B.h);
        ac.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(A as CanvasImageSource, B.x, B.y);
        ctx.restore();
      };
      reveal(inkLayer, M, "sig-a", fade);
      if (dry < 1) reveal(hiLayer, Wm, "sig-b", fade * 0.75);
      // Flourish.
      const fp = ease.outCubic(seg(t, F0, F1));
      ctx.save();
      ctx.globalAlpha = fade;
      flourish(ctx, S, fp, theme.accent);
      ctx.restore();
      // Nib glint at the pen tip while writing.
      if (p < 1 && S.tipT.length) {
        let lo = 0;
        let hi = S.tipT.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (S.tipT[mid] <= p) lo = mid;
          else hi = mid - 1;
        }
        light(ctx, S.tipX[lo], S.tipY[lo], u * 0.03, mix(theme.accent, "#ffffff", 0.6), 0.5);
      }
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
