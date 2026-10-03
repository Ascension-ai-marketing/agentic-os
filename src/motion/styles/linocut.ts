import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  rng,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  darkPaper,
  mottleTile,
  speckTile,
  stepped,
  tileOver,
  tintLayer,
  type Pt,
} from "./_s1-helpers";

const FPS = 10;
const PENCIL = '"Caveat", "Bradley Hand", cursive';

type Block = {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  R: number;
  L: number;
};

function blockOf(w: number, h: number): Block {
  const { portrait, square } = frameOf(w, h);
  const bw = w * (portrait ? 0.86 : square ? 0.84 : 0.8);
  const bh = h * (portrait ? 0.76 : square ? 0.78 : 0.76);
  const x = (w - bw) / 2;
  const y = h * (portrait ? 0.08 : square ? 0.07 : 0.08);
  const m = Math.min(bw, bh);
  return { x, y, w: bw, h: bh, cx: x + bw / 2, cy: y + bh / 2, R: m * 0.285, L: m * 0.52 };
}

/** Body half-width profile along the koi, s = 0 (nose) .. 1 (tail root). */
function profile(s: number) {
  if (s <= 0) return 0;
  const head = Math.sqrt(clamp(s / 0.1)) * 0.78;
  const body = Math.pow(Math.sin(Math.PI * Math.pow(clamp(s / 0.96), 0.6)), 0.85);
  return Math.max(0.12 * clamp((s - 0.4) / 0.2), s < 0.1 ? Math.min(head, body + 0.2) : body);
}

type Fish = {
  spine: { x: number; y: number; tx: number; ty: number; nx: number; ny: number; hw: number }[];
  L: number;
  W: number;
};

function fish(b: Block, heading: number, tq: number, beat: number): Fish {
  const n = 30;
  const spine: Fish["spine"] = [];
  const W = b.L * 0.22;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const a = heading + (s * b.L) / b.R;
    const sway = b.L * 0.045 * (0.2 + s * s) * Math.sin(TAU * (0.9 * s - (beat * tq) / LOOP));
    const r = b.R + sway;
    pts.push([b.cx + Math.cos(a) * r, b.cy + Math.sin(a) * r]);
  }
  for (let i = 0; i <= n; i++) {
    const p = pts[i];
    const q = pts[Math.min(n, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    let tx = o[0] - q[0];
    let ty = o[1] - q[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    spine.push({ x: p[0], y: p[1], tx, ty, nx: -ty, ny: tx, hw: (W / 2) * profile(i / n) });
  }
  return { spine, L: b.L, W };
}

/** Map body coordinates (s along, v across in half-widths) to the page. */
function bodyPt(f: Fish, s: number, v: number): Pt {
  const n = f.spine.length - 1;
  const k = clamp(s) * n;
  const i = Math.min(n - 1, Math.floor(k));
  const u = k - i;
  const a = f.spine[i];
  const c = f.spine[i + 1];
  const x = a.x + (c.x - a.x) * u;
  const y = a.y + (c.y - a.y) * u;
  const nx = a.nx + (c.nx - a.nx) * u;
  const ny = a.ny + (c.ny - a.ny) * u;
  const hw = a.hw + (c.hw - a.hw) * u;
  return [x + nx * hw * v, y + ny * hw * v];
}

function outline(c: Ctx2D, f: Fish) {
  const L = f.spine.map((p) => [p.x + p.nx * p.hw, p.y + p.ny * p.hw] as Pt);
  const R = f.spine.map((p) => [p.x - p.nx * p.hw, p.y - p.ny * p.hw] as Pt);
  const nose = f.spine[0];
  c.moveTo(L[1][0], L[1][1]);
  for (let i = 2; i < L.length; i++) c.lineTo(L[i][0], L[i][1]);
  for (let i = R.length - 1; i >= 1; i--) c.lineTo(R[i][0], R[i][1]);
  // Round nose.
  const r = f.spine[1].hw;
  c.quadraticCurveTo(
    nose.x + nose.tx * r * 1.1 - nose.nx * r,
    nose.y + nose.ty * r * 1.1 - nose.ny * r,
    nose.x + nose.tx * r * 0.9,
    nose.y + nose.ty * r * 0.9,
  );
  c.quadraticCurveTo(
    nose.x + nose.tx * r * 1.1 + nose.nx * r,
    nose.y + nose.ty * r * 1.1 + nose.ny * r,
    L[1][0],
    L[1][1],
  );
  c.closePath();
}

/** A fin as a leaf from root, pointing along angle a, length len, width wid. */
function fin(c: Ctx2D, x: number, y: number, a: number, len: number, wid: number) {
  const ex = x + Math.cos(a) * len;
  const ey = y + Math.sin(a) * len;
  const px = -Math.sin(a) * wid;
  const py = Math.cos(a) * wid;
  c.moveTo(x, y);
  c.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + px, y + Math.sin(a) * len * 0.5 + py, ex, ey);
  c.quadraticCurveTo(
    x + Math.cos(a) * len * 0.6 - px * 0.4,
    y + Math.sin(a) * len * 0.6 - py * 0.4,
    x,
    y,
  );
  c.closePath();
}

function tailFin(c: Ctx2D, f: Fish, spread: number) {
  const end = f.spine[f.spine.length - 1];
  const back = Math.atan2(-end.ty, -end.tx);
  const len = f.L * 0.3;
  for (const side of [-1, 1]) {
    const a = back + side * spread;
    const ex = end.x + Math.cos(a) * len;
    const ey = end.y + Math.sin(a) * len;
    const mx = end.x + Math.cos(back) * len * 0.55;
    const my = end.y + Math.sin(back) * len * 0.55;
    c.moveTo(end.x + end.nx * side * f.W * 0.05, end.y + end.ny * side * f.W * 0.05);
    c.quadraticCurveTo(
      end.x + Math.cos(a + side * 0.35) * len * 0.7,
      end.y + Math.sin(a + side * 0.35) * len * 0.7,
      ex,
      ey,
    );
    c.quadraticCurveTo(
      end.x + Math.cos(a - side * 0.2) * len * 0.75,
      end.y + Math.sin(a - side * 0.2) * len * 0.75,
      mx,
      my,
    );
    c.lineTo(end.x, end.y);
    c.closePath();
  }
}

function fins(c: Ctx2D, f: Fish, tq: number, phase: number, stroke = false) {
  const flap = Math.sin(TAU * ((4 * tq) / LOOP + phase)) * 0.22;
  c.beginPath();
  for (const [s, len, wid, spread] of [
    [0.24, 0.22, 0.07, 1.05],
    [0.56, 0.12, 0.045, 0.9],
  ] as const) {
    const p = f.spine[Math.round(s * (f.spine.length - 1))];
    const back = Math.atan2(-p.ty, -p.tx);
    for (const side of [-1, 1]) {
      const a = back - side * (spread + flap * side);
      const root = bodyPt(f, s, side * 0.8);
      fin(c, root[0], root[1], a, f.L * len, f.L * wid);
    }
  }
  tailFin(c, f, 0.42 + flap * 0.4);
  c.fill();
  if (stroke) c.stroke();
}

/** Carve (destination-out) the details a lino cutter would take out of the fish. */
function carveFish(c: Ctx2D, f: Fish) {
  const lw = Math.max(1, f.L * 0.012);
  c.lineCap = "round";
  c.lineWidth = lw;
  c.beginPath();
  // Form: short gouge strokes across the shadow flank, a few scallops along the back.
  for (let i = 0; i < 20; i++) {
    const s = 0.22 + i * 0.032;
    const len = 0.35 + 0.25 * Math.sin((i / 19) * Math.PI);
    const [x0, y0] = bodyPt(f, s, -1.02);
    const [x1, y1] = bodyPt(f, s + 0.012, -1.02 + len);
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
  }
  for (let row = 0; row < 5; row++) {
    const s = 0.3 + row * 0.1;
    const [x, y] = bodyPt(f, s, 0.42);
    const p = f.spine[Math.round(s * (f.spine.length - 1))];
    const back = Math.atan2(-p.ty, -p.tx);
    const r = f.L * 0.028 * (1 - row * 0.1);
    c.moveTo(x + Math.cos(back - 1.4) * r, y + Math.sin(back - 1.4) * r);
    c.arc(x, y, r, back - 1.4, back + 1.4);
  }
  // Gill plates: one short carved arc on each side of the head.
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 6; i++) {
      const v = side * (0.42 + (0.5 * i) / 6);
      const [x, y] = bodyPt(f, 0.19 - 0.05 * (Math.abs(v) - 0.42), v);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
  }
  c.stroke();
  // Fin rays and the dorsal ridge.
  c.lineWidth = lw * 0.8;
  c.beginPath();
  for (let i = 0; i <= 8; i++) {
    const [x, y] = bodyPt(f, 0.3 + i * 0.05, 0);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  const end = f.spine[f.spine.length - 1];
  const back = Math.atan2(-end.ty, -end.tx);
  for (let k = -3; k <= 3; k++) {
    if (k === 0) continue;
    const a = back + k * 0.13;
    c.moveTo(end.x + Math.cos(a) * f.L * 0.05, end.y + Math.sin(a) * f.L * 0.05);
    c.lineTo(end.x + Math.cos(a) * f.L * 0.22, end.y + Math.sin(a) * f.L * 0.22);
  }
  c.stroke();
  // Eyes: carved rings with a pupil left standing.
  for (const side of [-1, 1]) {
    const [x, y] = bodyPt(f, 0.075, side * 0.5);
    c.beginPath();
    c.arc(x, y, f.L * 0.022, 0, TAU);
    c.fill();
  }
}

/** Koi colour patches in body space (s, v, radius in half-widths). */
const PATCHES: [number, number, number][][] = [
  [
    [0.1, 0.1, 0.62],
    [0.4, -0.25, 0.75],
    [0.66, 0.2, 0.62],
  ],
  [
    [0.07, -0.05, 0.5],
    [0.33, 0.35, 0.55],
    [0.52, -0.3, 0.7],
    [0.76, 0.1, 0.45],
  ],
];

function patches(c: Ctx2D, f: Fish, which: number) {
  c.beginPath();
  for (const [s0, v0, r] of PATCHES[which]) {
    for (let i = 0; i <= 22; i++) {
      const a = (i / 22) * TAU;
      const wob = 1 + 0.18 * Math.sin(a * 3 + which + s0 * 9) + 0.08 * Math.sin(a * 7 + s0 * 3);
      const s = s0 + Math.cos(a) * r * 0.16 * wob;
      const v = v0 + Math.sin(a) * r * wob;
      const [x, y] = bodyPt(f, s, v);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }
  c.fill();
}

/** Concentric gouge rings around the pond: each ring is a run of tapered V-gouge marks. */
function whirl(c: Ctx2D, b: Block, tq: number) {
  const gap = Math.min(b.w, b.h) * 0.026;
  const rMax = Math.hypot(b.w, b.h) / 2;
  c.beginPath();
  for (let k = 0, r = gap * 1.2; r < rMax; k++, r += gap * (0.9 + 0.25 * hash(k, 3))) {
    const n = Math.max(3, Math.round((TAU * r) / (gap * 5.5)));
    // Whole-symmetry rotation: ring k turns 1/n of a revolution per loop (or none).
    const turn = ((k % 3 === 0 ? 0 : k % 2 === 0 ? 1 : -1) * (tq / LOOP) * TAU) / n;
    const thick = gap * (0.3 + 0.1 * hash(k, 9));
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * TAU + turn + hash(k, 21) * TAU;
      const span = (TAU / n) * (0.45 + 0.4 * hash(k, j % 5, 4));
      const am = a0 + span / 2;
      const mx = b.cx + Math.cos(am) * r;
      const my = b.cy + Math.sin(am) * r;
      const pad = gap * 3;
      if (mx < b.x - pad || mx > b.x + b.w + pad || my < b.y - pad || my > b.y + b.h + pad)
        continue;
      const steps = 4;
      const pts: Pt[] = [];
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const a = a0 + span * f;
        const taper = Math.sin(Math.PI * f) ** 0.7;
        const wob = r + Math.sin(a * 3 + k) * gap * 0.12;
        pts.push([
          b.cx + Math.cos(a) * (wob + thick * 0.5 * taper),
          b.cy + Math.sin(a) * (wob + thick * 0.5 * taper),
        ]);
      }
      for (let i = steps; i >= 0; i--) {
        const f = i / steps;
        const a = a0 + span * f;
        const taper = Math.sin(Math.PI * f) ** 0.7;
        const wob = r + Math.sin(a * 3 + k) * gap * 0.12;
        pts.push([
          b.cx + Math.cos(a) * (wob - thick * 0.5 * taper),
          b.cy + Math.sin(a) * (wob - thick * 0.5 * taper),
        ]);
      }
      c.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts) c.lineTo(x, y);
      c.closePath();
    }
  }
  c.fill();
}

function pads(b: Block) {
  const m = Math.min(b.w, b.h);
  const list: { x: number; y: number; r: number; a: number }[] = [];
  const r = rng(71);
  const spots: Pt[] = [
    [0.1, 0.16],
    [0.9, 0.82],
    [0.86, 0.14],
  ];
  for (const [fx, fy] of spots)
    list.push({ x: b.x + b.w * fx, y: b.y + b.h * fy, r: m * (0.07 + r() * 0.035), a: r() * TAU });
  return list;
}

function padShape(c: Ctx2D, x: number, y: number, r: number, a: number) {
  c.moveTo(x, y);
  c.arc(x, y, r, a + 0.28, a + TAU - 0.28);
  c.closePath();
}

export const style: MotionStyle = {
  id: "linocut",
  name: "Linocut Koi",
  family: "Print & Craft",
  tagline: "Carved koi, one orange block",
  look: "A hand-pulled linocut: two carved koi circling a whirlpool of gouge marks, chunky white ink plus one orange block, printed off.",
  move: "Printed frame by frame at 10 fps: the koi chase round the pond, gouge rings turn, the orange block shifts every pull.",
  rules: [
    "Everything is relief: ink where the lino stands, paper where it was cut.",
    "Every mark tapers like a gouge cut; no machine-even lines.",
    "Chunky ink: brayer mottle, speckled misses, a rough block edge.",
    "Two colours only: the key ink and one colour block.",
    "The colour block sits slightly off register and shifts per printed frame.",
    "Carve a clearing around each fish so it reads against the water.",
    "Animate on printed frames (10 fps), every frame a fresh pull.",
    "Sign it in pencil under the block.",
  ],
  prompt: `R — References
• Linocut prints of koi and water (search: koi linocut print, reduction linocut, V-gouge water texture).
• Japanese woodblock whirlpools (Hiroshige's Naruto) for the circling water.
• Printed stop-motion: every frame hand-pulled, the texture changing frame to frame.

I — Idea
Two koi chase each other around a carved whirlpool, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): the koi sit opposite each other on the ring, tails beating, gouge rings circling the pond.
• Middle (1.5–3.5 s): they swim half way round; the rings turn at different speeds; the orange block shifts a hair every pull.
• End (3.5–5 s): they complete the lap and land exactly where they began; "{{name}}" is signed in pencil under the block.

S — Style
Looks: {{bg}} black paper; key block in {{ink}} ink (fish bodies solid, water as tapered gouge rings, lily pads with carved veins, a rough block edge); one {{accent}} colour block for the koi patches; pencil type under the print.
Moves: stepped at 10 fps; the koi follow one circle, one lap per loop, bodies undulating with whole tail beats; each ring turns by whole symmetry steps so the loop closes.
Rules:
1. Relief logic: ink where the block stands, paper where it was cut.
2. Tapered gouge marks, never even lines.
3. Brayer mottle and speckle misses on every ink.
4. Two inks only; the colour block off register.
5. A carved clearing around each fish.
6. 10 fps printed frames with fresh texture per frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the koi read as fish at thumbnail size; scales and fin rays are carved, not drawn on; the orange sits visibly off the body; nothing looks vector-clean. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Linocut",
  theme: {
    bg: "#101211",
    ink: "#efe8d8",
    accent: "#ec6a2f",
    accent2: "#5d7f93",
    font: "Caveat",
  },
  fonts: ["Caveat:wght@500;600"],
  tags: [
    "linocut",
    "lino",
    "block print",
    "relief",
    "print",
    "koi",
    "fish",
    "japanese",
    "water",
    "handmade",
    "craft",
    "stop motion",
  ],
  word: "Koi",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const { frame, tq } = stepped(t, FPS);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `lino-paper:${theme.bg}${theme.ink}`,
        w,
        h,
        darkPaper(theme, 23, { fibres: 0.8 }),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.35, h * 0.3, Math.max(w, h) * 0.9, theme.ink, 0.05);

    const b = blockOf(w, h);
    const { canvas: kc, ctx: K } = buffer("lino-key", w, h);
    const { canvas: ac, ctx: A } = buffer("lino-colour", w, h);
    K.clearRect(0, 0, w, h);
    A.clearRect(0, 0, w, h);
    K.fillStyle = "#fff";
    A.fillStyle = "#fff";

    // The block: rough edge, then the water inside it.
    const edge = Math.max(2, u * 0.008);
    K.save();
    K.beginPath();
    K.rect(b.x, b.y, b.w, b.h);
    K.clip();
    whirl(K, b, tq);
    K.restore();
    K.lineWidth = edge;
    K.strokeStyle = "#fff";
    K.beginPath();
    const r = rng(5);
    const corners: Pt[] = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ];
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = corners[i];
      const [x1, y1] = corners[(i + 1) % 4];
      for (let k = 0; k <= 24; k++) {
        const f = k / 24;
        const j = (r() - 0.5) * edge * 0.5;
        const x = x0 + (x1 - x0) * f + (y1 === y0 ? 0 : j);
        const y = y0 + (y1 - y0) * f + (x1 === x0 ? 0 : j);
        if (i === 0 && k === 0) K.moveTo(x, y);
        else K.lineTo(x, y);
      }
    }
    K.closePath();
    K.stroke();

    // Lily pads: cleared ground, solid pad, carved veins; they turn a touch.
    const padList = pads(b);
    K.save();
    K.globalCompositeOperation = "destination-out";
    K.beginPath();
    for (const p of padList) {
      K.moveTo(p.x + p.r * 1.28, p.y);
      K.arc(p.x, p.y, p.r * 1.28, 0, TAU);
    }
    K.fill();
    K.restore();
    K.beginPath();
    for (const p of padList)
      padShape(K, p.x, p.y, p.r, p.a + Math.sin(TAU * (tq / LOOP) + p.a) * 0.06);
    K.fill();
    K.save();
    K.globalCompositeOperation = "destination-out";
    K.lineWidth = Math.max(1, u * 0.0035);
    K.lineCap = "round";
    K.beginPath();
    for (const p of padList) {
      const a0 = p.a + Math.sin(TAU * (tq / LOOP) + p.a) * 0.06;
      for (let k = 0; k < 9; k++) {
        const a = a0 + 0.5 + (k / 8) * (TAU - 1);
        K.moveTo(p.x + Math.cos(a) * p.r * 0.14, p.y + Math.sin(a) * p.r * 0.14);
        K.lineTo(p.x + Math.cos(a) * p.r * 0.84, p.y + Math.sin(a) * p.r * 0.84);
      }
    }
    K.stroke();
    K.restore();

    // The koi: one lap per loop, opposite each other, tails beating on whole cycles.
    const heading = -(tq / LOOP) * TAU;
    const koi = [fish(b, heading, tq, 3), fish(b, heading + Math.PI, tq, 3)];
    // Clearing around each fish so the water breaks.
    koi.forEach((f, i) => {
      K.save();
      K.globalCompositeOperation = "destination-out";
      K.lineJoin = "round";
      K.lineWidth = b.L * 0.085;
      K.beginPath();
      outline(K, f);
      K.fill();
      K.stroke();
      K.lineWidth = b.L * 0.05;
      fins(K, f, tq, i * 0.37, true);
      K.restore();
    });
    koi.forEach((f, i) => {
      K.beginPath();
      outline(K, f);
      K.fill();
      fins(K, f, tq, i * 0.37);
      K.save();
      K.globalCompositeOperation = "destination-out";
      K.strokeStyle = "#000";
      K.fillStyle = "#000";
      carveFish(K, f);
      K.restore();
      patches(A, f, i);
    });

    // Ink: brayer mottle and a fresh set of misses every printed frame.
    const k = Math.max(0.6, u / 700);
    tileOver(K, w, h, mottleTile(9, 6, 1.4), {
      alpha: 0.35,
      scale: k * 1.3,
      ox: hash(frame, 1) * 256 * k,
      oy: hash(frame, 2) * 256 * k,
    });
    tileOver(K, w, h, speckTile(41 + (frame % 3), 1800, 1.6, 1.5), {
      alpha: 0.7,
      scale: k,
      ox: hash(frame, 3) * 256,
      oy: hash(frame, 4) * 256,
    });
    tintLayer(K, w, h, theme.ink);
    tileOver(A, w, h, mottleTile(12, 5, 1.2), { alpha: 0.3, scale: k * 1.3 });
    tileOver(A, w, h, speckTile(57 + (frame % 3), 1300, 1.4, 1.3), {
      alpha: 0.6,
      scale: k,
      ox: hash(frame, 5) * 256,
      oy: hash(frame, 6) * 256,
    });
    tintLayer(A, w, h, theme.accent);

    ctx.drawImage(kc as CanvasImageSource, 0, 0);
    const jx = u * 0.006 + (hash(frame, 71) - 0.5) * u * 0.003;
    const jy = -u * 0.004 + (hash(frame, 73) - 0.5) * u * 0.003;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.drawImage(ac as CanvasImageSource, jx, jy);
    ctx.restore();

    // Pencil under the block: edition on the left, signature on the right.
    const py = b.y + b.h + (h - b.y - b.h) * 0.46;
    const size = Math.max(9, u * (portrait ? 0.034 : 0.04));
    ctx.save();
    ctx.fillStyle = rgba(mix(theme.ink, theme.bg, 0.35), 0.8);
    ctx.textBaseline = "middle";
    ctx.font = font(500, size, "Caveat", PENCIL);
    ctx.textAlign = "left";
    ctx.fillText("3/20", b.x + u * 0.01, py);
    ctx.textAlign = "right";
    const mark = tintedLogo(
      theme,
      rgba(mix(theme.ink, theme.bg, 0.35), 0.8),
      size * 1.3,
      size * 1.3,
    );
    const sig = wordFor(theme.name, "Koi", 16);
    ctx.fillText(sig, b.x + b.w - u * 0.01 - (mark ? size * 1.6 : 0), py);
    if (mark)
      ctx.drawImage(mark as CanvasImageSource, b.x + b.w - u * 0.01 - size * 1.3, py - size * 0.65);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
