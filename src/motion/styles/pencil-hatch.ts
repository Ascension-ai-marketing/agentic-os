import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  noise3,
  once,
  rng,
  seg,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  fibres,
  handEllipse,
  handLine,
  headOf,
  mottle,
  speckleTile,
  strokePts,
  tileFill,
  tracePts,
  type Pt,
} from "./_s2-helpers";

/**
 * White graphite on black paper: a sphere and a cube built up in tonal
 * hatching layers (lighter tones get more layers), held, then scrubbed out
 * by an eraser that leaves the ghost the next drawing starts on.
 */
const BUILD_END = 3.05;
const ERASE_START = 4.0;
const ERASE_END = 4.86;

type Scene = {
  u: number;
  S: Pt;
  Rs: number;
  cube: { B: Pt; vl: Pt; vr: Pt; vu: Pt };
  gc: Pt;
  grx: number;
  gry: number;
  shadow: { c: Pt; rx: number; ry: number };
  cubeShadow: Pt[];
};

function scene(w: number, h: number): Scene {
  const { u, portrait, square } = frameOf(w, h);
  // Built at unit scale (sphere radius 1 at the origin), then fitted to the stage.
  const cs = 1.18;
  const compact = portrait || square;
  const Bu: Pt = compact ? [-0.75, -0.2] : [-1.25, 0.62];
  const vl0: Pt = [-cs * 0.78, -cs * 0.2];
  const vr0: Pt = [cs * 0.62, -cs * 0.26];
  const vu0: Pt = [0, -cs * 1.02];
  const gc0: Pt = compact ? [-0.2, 0.95] : [-0.35, 0.92];
  const grx0 = compact ? 1.75 : 2.9;
  const gry0 = compact ? 0.6 : 0.58;
  const xs = [Bu[0] + vl0[0], gc0[0] - grx0, 1.05, gc0[0] + grx0];
  const ys = [Bu[1] + vu0[1] + vr0[1], -1.05, gc0[1] + gry0 + 0.12];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const boxL = w * 0.08;
  const boxR = w * 0.92;
  const boxT = h * (portrait ? 0.14 : 0.11);
  const boxB = h * (portrait ? 0.82 : 0.84);
  const K = Math.min((boxR - boxL) / (x1 - x0), (boxB - boxT) / (y1 - y0));
  const ox = (boxL + boxR) / 2 - ((x0 + x1) / 2) * K;
  const oy = (boxT + boxB) / 2 - ((y0 + y1) / 2) * K;
  const P = (p: Pt): Pt => [ox + p[0] * K, oy + p[1] * K];
  const V = (p: Pt): Pt => [p[0] * K, p[1] * K];
  const S = P([0, 0]);
  const Rs = K;
  const B = P(Bu);
  const vl = V(vl0);
  const vr = V(vr0);
  const vu = V(vu0);
  const shadowC = P([0.62, 0.98]);
  const cubeShadow: Pt[] = [
    [B[0] + vr[0], B[1] + vr[1]],
    [B[0] + vr[0] + cs * 0.62 * K, B[1] + vr[1] + cs * 0.14 * K],
    [B[0] + cs * 0.7 * K, B[1] + cs * 0.2 * K],
    B,
  ];
  return {
    u,
    S,
    Rs,
    cube: { B, vl, vr, vu },
    gc: P(gc0),
    grx: grx0 * K,
    gry: gry0 * K,
    shadow: { c: shadowC, rx: 1.12 * K, ry: 0.3 * K },
    cubeShadow,
  };
}

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

function cubeFaces(sc: Scene) {
  const { B, vl, vr, vu } = sc.cube;
  const left: Pt[] = [B, add(B, vl), add(add(B, vl), vu), add(B, vu)];
  const right: Pt[] = [B, add(B, vr), add(add(B, vr), vu), add(B, vu)];
  const top: Pt[] = [
    add(B, vu),
    add(add(B, vl), vu),
    add(add(add(B, vl), vr), vu),
    add(add(B, vr), vu),
  ];
  return { left, right, top };
}

function inPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Light reaching (x, y), 0..1, and which object it is on (0 none, 1 sphere, 2 cube, 3 ground). */
function tone(
  sc: Scene,
  faces: ReturnType<typeof cubeFaces>,
  x: number,
  y: number,
): [number, number] {
  const dx = (x - sc.S[0]) / sc.Rs;
  const dy = (y - sc.S[1]) / sc.Rs;
  const r2 = dx * dx + dy * dy;
  if (r2 < 1) {
    const nz = Math.sqrt(1 - r2);
    const L = [-0.6, -0.64, 0.48];
    const lam = Math.max(0, dx * L[0] + dy * L[1] + nz * L[2]);
    // Reflected light: a thin rim on the shadow side, lit from the table.
    const bounce = 0.3 * Math.max(0, dy * 0.7 + dx * 0.3) * smoothstep(0.82, 0.99, Math.sqrt(r2));
    return [clamp(Math.pow(lam, 1.25) * 1.05 + bounce), 1];
  }
  const p: Pt = [x, y];
  if (inPoly(p, faces.top)) return [0.82, 2];
  if (inPoly(p, faces.left)) return [0.56, 2];
  if (inPoly(p, faces.right)) return [0.16, 2];
  const gx = (x - sc.gc[0]) / sc.grx;
  const gy = (y - sc.gc[1]) / sc.gry;
  const g2 = gx * gx + gy * gy;
  if (g2 < 1 && y > sc.S[1] + sc.Rs * 0.2) {
    const sx = (x - sc.shadow.c[0]) / sc.shadow.rx;
    const sy = (y - sc.shadow.c[1]) / sc.shadow.ry;
    const inShadow = sx * sx + sy * sy < 1 || inPoly(p, sc.cubeShadow);
    const falloff = 1 - smoothstep(0.35, 1, Math.sqrt(g2));
    return [inShadow ? 0.03 : 0.46 * falloff + 0.04, 3];
  }
  return [0, 0];
}

type Stroke = { a: Pt; b: Pt; w: number; t0: number; alpha: number };

const LAYERS: { ang: number; gap: number; thr: number; t0: number; t1: number }[] = [
  { ang: -0.95, gap: 0.0085, thr: 0.16, t0: 0.9, t1: 1.65 },
  { ang: -0.28, gap: 0.009, thr: 0.4, t0: 1.55, t1: 2.25 },
  { ang: -1.42, gap: 0.0095, thr: 0.62, t0: 2.1, t1: 2.7 },
  { ang: -0.55, gap: 0.006, thr: 0.82, t0: 2.6, t1: 2.95 },
];

/** Every hatch stroke, with the moment the hand lays it down. */
function strokes(w: number, h: number): Stroke[] {
  return once(`pencil-strokes:${Math.round(w)}x${Math.round(h)}`, () => {
    const sc = scene(w, h);
    const faces = cubeFaces(sc);
    const { u } = sc;
    const out: Stroke[] = [];
    const r = rng(9091);
    const bx0 = sc.gc[0] - sc.grx * 1.05;
    const bx1 = sc.gc[0] + sc.grx * 1.05;
    const by0 = sc.cube.B[1] + sc.cube.vu[1] + sc.cube.vr[1] - u * 0.02;
    const by1 = sc.gc[1] + sc.gry * 1.05;
    const cxs = (bx0 + bx1) / 2;
    const cys = (by0 + by1) / 2;
    const half = Math.hypot(bx1 - bx0, by1 - by0) / 2;
    LAYERS.forEach((layer, li) => {
      const dir: Pt = [Math.cos(layer.ang), Math.sin(layer.ang)];
      const nrm: Pt = [-dir[1], dir[0]];
      const gap = layer.gap * u;
      const step = u * 0.004;
      const lines = Math.ceil((half * 2) / gap);
      const list: { s: Stroke; order: number }[] = [];
      for (let i = 0; i < lines; i++) {
        const off = -half + i * gap + (r() - 0.5) * gap * 0.35;
        let run: Pt | null = null;
        let runObj = 0;
        const n = Math.ceil((half * 2) / step);
        for (let j = 0; j <= n + 1; j++) {
          const along = -half + j * step;
          const x = cxs + nrm[0] * off + dir[0] * along;
          const y = cys + nrm[1] * off + dir[1] * along;
          const [tn, obj] = j <= n ? tone(sc, faces, x, y) : [0, 0];
          const thr = layer.thr + 0.06 * noise3((x / u) * 9, (y / u) * 9, li);
          const on = tn > thr;
          if (on && !run) {
            run = [x, y];
            runObj = obj;
          }
          if ((!on || obj !== runObj) && run) {
            // Split long runs into hand-length strokes that overlap a little.
            const end: Pt = [x, y];
            const len = Math.hypot(end[0] - run[0], end[1] - run[1]);
            const pieces = Math.max(1, Math.round(len / (u * 0.11)));
            for (let q = 0; q < pieces; q++) {
              const k0 = q / pieces - (q ? 0.03 : 0);
              const k1 = (q + 1) / pieces + (q < pieces - 1 ? 0.02 : 0);
              const a: Pt = [
                run[0] + (end[0] - run[0]) * k0 + (r() - 0.5) * u * 0.004,
                run[1] + (end[1] - run[1]) * k0,
              ];
              const b: Pt = [
                run[0] + (end[0] - run[0]) * k1,
                run[1] + (end[1] - run[1]) * k1 + (r() - 0.5) * u * 0.004,
              ];
              // Hatch object by object: cube, sphere, then the ground.
              const region = runObj === 2 ? 0 : runObj === 1 ? 1 : 2;
              list.push({
                s: {
                  a,
                  b,
                  w: u * (0.0029 + r() * 0.0014),
                  t0: 0,
                  alpha: Math.min(1, 0.46 + li * 0.14 + r() * 0.22),
                },
                order: region * 10 + (off + half) / (half * 2) + r() * 0.05,
              });
            }
            run = on ? [x, y] : null;
            runObj = obj;
          }
        }
      }
      list.sort((p, q) => p.order - q.order);
      list.forEach((item, idx) => {
        item.s.t0 = layer.t0 + ((layer.t1 - layer.t0) * idx) / Math.max(1, list.length);
        out.push(item.s);
      });
    });
    return out;
  });
}

/** A pencil stroke: a thin spindle, pressure tapering at both ends, slightly bowed. */
function pencil(c: Ctx2D, s: Stroke, p: number) {
  const bx = s.a[0] + (s.b[0] - s.a[0]) * p;
  const by = s.a[1] + (s.b[1] - s.a[1]) * p;
  const dx = bx - s.a[0];
  const dy = by - s.a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * s.w * 0.5;
  const ny = (dx / L) * s.w * 0.5;
  const bow = L * 0.025;
  const mx = (s.a[0] + bx) / 2 + (-dy / L) * bow;
  const my = (s.a[1] + by) / 2 + (dx / L) * bow;
  c.globalAlpha = s.alpha;
  c.beginPath();
  c.moveTo(s.a[0], s.a[1]);
  c.quadraticCurveTo(mx + nx, my + ny, bx, by);
  c.quadraticCurveTo(mx - nx, my - ny, s.a[0], s.a[1]);
  c.fill();
}

/** The construction lines in non-photo blue, the light arrow in red pencil. */
function construction(c: Ctx2D, sc: Scene, theme: Theme, t: number, u: number) {
  const faces = cubeFaces(sc);
  const k = (a: number, b: number) => ease.inOutSine(seg(t, a, b));
  c.save();
  c.lineCap = "round";
  c.strokeStyle = rgba(theme.accent2, 0.36);
  c.lineWidth = Math.max(0.8, u * 0.0016);
  strokePts(
    c,
    handEllipse(sc.S[0], sc.S[1], sc.Rs * 1.01, sc.Rs * 1.01, 3, 0.012, 90, -2.3, 1.08),
    k(0.25, 0.62),
  );
  strokePts(
    c,
    handEllipse(sc.S[0], sc.S[1], sc.Rs * 0.99, sc.Rs * 0.99, 8, 0.015, 90, 0.8, 1.02),
    k(0.45, 0.78),
  );
  // Cube edges run a little past their corners, the way they are sketched.
  const edges: [Pt, Pt][] = [];
  for (const f of [faces.left, faces.right, faces.top])
    for (let i = 0; i < f.length; i++) edges.push([f[i], f[(i + 1) % f.length]]);
  edges.forEach(([a, b], i) => {
    const d: Pt = [b[0] - a[0], b[1] - a[1]];
    const aa: Pt = [a[0] - d[0] * 0.08, a[1] - d[1] * 0.08];
    const bb: Pt = [b[0] + d[0] * 0.08, b[1] + d[1] * 0.08];
    strokePts(c, handLine(aa, bb, i + 1, u * 0.002, 8, 0.01), k(0.3 + i * 0.03, 0.5 + i * 0.03));
  });
  // Axis and the ground ellipse.
  strokePts(
    c,
    handLine(
      [sc.S[0], sc.S[1] - sc.Rs * 1.25],
      [sc.S[0], sc.S[1] + sc.Rs * 1.2],
      41,
      u * 0.002,
      8,
      0.004,
    ),
    k(0.55, 0.8),
  );
  strokePts(
    c,
    handEllipse(sc.shadow.c[0], sc.shadow.c[1], sc.shadow.rx, sc.shadow.ry, 5, 0.02, 60, 0.5, 1.02),
    k(0.6, 0.9),
  );
  // The light: a red pencil arrow from the top left.
  c.strokeStyle = rgba(theme.accent, 0.85);
  c.lineWidth = Math.max(1, u * 0.0028);
  // Point at the lit corner of the cube's top face, starting inside the frame.
  const corner = faces.top[1];
  const lb: Pt = [corner[0] + sc.Rs * 0.12, corner[1] + sc.Rs * 0.06];
  const la: Pt = [
    Math.max(u * 0.06, lb[0] - sc.Rs * 0.85),
    Math.max(u * 0.07, lb[1] - sc.Rs * 0.6),
  ];
  const arrow = handLine(la, lb, 77, u * 0.002, 10, 0.02);
  strokePts(c, arrow, k(0.62, 0.86));
  if (t > 0.84) {
    const [hx, hy] = lb;
    const ang = Math.atan2(lb[1] - la[1], lb[0] - la[0]);
    const hl = u * 0.03;
    const p1: Pt = [hx + Math.cos(ang + 2.6) * hl, hy + Math.sin(ang + 2.6) * hl];
    const p2: Pt = [hx + Math.cos(ang - 2.6) * hl, hy + Math.sin(ang - 2.6) * hl];
    strokePts(c, [p1, lb, p2], k(0.84, 0.96));
  }
  c.restore();
}

/** The eraser's zigzag path across the drawing. */
function eraserPath(sc: Scene): Pt[] {
  const { u } = sc;
  const x0 = sc.gc[0] + sc.grx * 1.05;
  const x1 = sc.gc[0] - sc.grx * 1.05;
  const top = sc.cube.B[1] + sc.cube.vu[1] + sc.cube.vr[1] - u * 0.1;
  const bottom = sc.gc[1] + sc.gry * 1.1;
  const pts: Pt[] = [];
  const passes = 9;
  for (let i = 0; i <= passes; i++) {
    const k = i / passes;
    const x = x0 + (x1 - x0) * k;
    const y = i % 2 ? bottom : top;
    pts.push([x + (i % 2 ? -1 : 1) * u * 0.05, y]);
  }
  return pts;
}

function paper(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.008, 0.016, u * 0.3, u / 110, 2.2);
    fibres(c, w, h, u, theme.ink, 160, 3131, 0.025, 0.05);
  };
}

/** Ghost of the erased drawing: a faint image, smudge along the eraser path, crumbs. */
function ghost(theme: Theme, final: CanvasImageSource) {
  return (c: Ctx2D, w: number, h: number) => {
    const sc = scene(w, h);
    const { u } = sc;
    c.save();
    c.globalAlpha = 0.07;
    c.filter = `blur(${(u * 0.004).toFixed(1)}px)`;
    c.drawImage(final, 0, 0);
    c.restore();
    const path = eraserPath(sc);
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = rgba(theme.ink, 0.028);
    c.lineWidth = u * 0.1;
    c.filter = `blur(${(u * 0.012).toFixed(1)}px)`;
    c.beginPath();
    tracePts(c, path);
    c.stroke();
    c.restore();
    const r = rng(4747);
    for (let i = 0; i < 90; i++) {
      const s = Math.floor(r() * (path.length - 1));
      const k = r();
      const x = path[s][0] + (path[s + 1][0] - path[s][0]) * k + (r() - 0.5) * u * 0.1;
      const y = path[s][1] + (path[s + 1][1] - path[s][1]) * k + (r() - 0.5) * u * 0.1;
      c.fillStyle = rgba(theme.ink, 0.08 + r() * 0.12);
      c.beginPath();
      c.ellipse(x, y, u * (0.002 + r() * 0.004), u * (0.0015 + r() * 0.002), r() * TAU, 0, TAU);
      c.fill();
    }
  };
}

export const style: MotionStyle = {
  id: "pencil-hatch",
  name: "Pencil Hatch",
  family: "Paint & Draw",
  tagline: "A still life in graphite hatching",
  look: "A white graphite still life on black paper: a sphere and a cube built from tonal cross-hatching over non-photo-blue construction lines.",
  move: "Construction lines sketch in, hatch layers build the light one pass at a time, a caption is signed, then an eraser scrubs it back to a ghost.",
  rules: [
    "Tone is made only by hatching: lighter areas get more crossing layers.",
    "Each hatch layer has its own angle and lands object by object.",
    "Strokes taper at both ends and bow slightly, like a wrist.",
    "Construction lines in non-photo blue run past their corners.",
    "Cast shadows and the shadow side stay bare paper.",
    "The eraser scrubs in a zigzag and leaves smudges and crumbs.",
    "The loop starts and ends on the ghost the eraser left.",
  ],
  prompt: `R — References
• Academic cross-hatching studies of a sphere and cube (search: cross hatching sphere cube, white charcoal pencil on black paper).
• Non-photo blue construction lines; a kneaded or vinyl eraser's smudges and crumbs.

I — Idea
One drawing, 5 seconds, looping seamlessly:
• Beginning (0–0.9 s): on black paper holding the ghost of an erased study, non-photo-blue lines sketch a sphere, a cube and a shadow ellipse; a red pencil arrow marks the light.
• Middle (0.9–4 s): four hatch layers in white graphite build the light, each at its own angle, object by object; the brightest areas get the most layers; "{{name}}" is signed small.
• End (4–5 s): an eraser scrubs the drawing out in a zigzag, leaving smudges and crumbs, which is the ghost the loop began on.

S — Style
Looks: {{bg}} paper with fibres; {{ink}} graphite hatching; {{accent2}} construction lines; one {{accent}} arrow; bare paper for every shadow; the caption handwritten.
Moves: strokes appear in the order a hand would lay them, fast and in patches; each layer starts before the previous ends; the eraser eases in and out along its zigzag.
Rules:
1. Tone only from hatch density and crossing layers.
2. One angle per layer; object by object.
3. Tapered, slightly bowed strokes with paper tooth breaking them.
4. Construction lines overshoot their corners.
5. Shadows stay bare.
6. The eraser leaves smudges and crumbs, which are the first frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the sphere reads round from hatching alone; the cube's three faces read as three tones; the caption is legible and not clipped; the eraser leaves visible smudges. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Hatching",
  theme: {
    bg: "#111112",
    ink: "#e9e6df",
    accent: "#e2553c",
    accent2: "#6aa6d8",
    font: "Nanum Pen Script",
  },
  fonts: ["Nanum Pen Script"],
  tags: [
    "pencil",
    "graphite",
    "hatching",
    "crosshatch",
    "sketch",
    "drawing",
    "study",
    "eraser",
    "academic",
    "hand-drawn",
    "handdrawn",
  ],
  word: "Study",
  render(ctx, t, theme, w, h) {
    const sc = scene(w, h);
    const { u } = sc;
    const { portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const key = `${theme.bg}${theme.ink}`;
    ctx.drawImage(bake(`pencil-paper:${key}`, w, h, paper(theme)) as CanvasImageSource, 0, 0);
    light(ctx, sc.S[0] - sc.Rs * 1.6, sc.S[1] - sc.Rs * 1.6, u * 1.1, theme.ink, 0.05);

    const all = strokes(w, h);
    const word = wordFor(theme.name, "Study", 14);
    const capSize = u * 0.075;
    const capX = portrait ? w * 0.5 : sc.gc[0] + sc.grx * 0.62;
    const capY = portrait ? h * 0.9 : Math.min(h * 0.92, sc.gc[1] + sc.gry * 1.25);
    const drawCaption = (c: Ctx2D, p: number) => {
      if (p <= 0) return;
      c.save();
      c.font = font(400, capSize, "Nanum Pen Script", "cursive");
      c.textAlign = "center";
      c.textBaseline = "alphabetic";
      const tw = c.measureText(word).width;
      c.beginPath();
      c.rect(capX - tw / 2 - u * 0.02, capY - capSize * 1.2, (tw + u * 0.04) * p, capSize * 1.6);
      c.clip();
      c.fillStyle = rgba(theme.ink, 0.85);
      c.fillText(word, capX, capY);
      c.restore();
    };
    // The finished drawing, baked once (hatching, construction, caption).
    const finalKey = `pencil-final:${key}${theme.accent}${theme.accent2}${word}`;
    const final = bake(finalKey, w, h, (c) => {
      construction(c, sc, theme, 99, u);
      c.fillStyle = theme.ink;
      for (const s of all) pencil(c, s, 1);
      c.globalAlpha = 1;
      drawCaption(c, 1);
    });
    ctx.drawImage(
      bake(
        `pencil-ghost:${finalKey}`,
        w,
        h,
        ghost(theme, final as CanvasImageSource),
      ) as CanvasImageSource,
      0,
      0,
    );

    const { canvas: layerCanvas, ctx: L } = buffer("pencil-layer", w, h);
    L.save();
    L.clearRect(0, 0, w, h);
    if (t >= BUILD_END) L.drawImage(final as CanvasImageSource, 0, 0);
    else {
      construction(L, sc, theme, t, u);
      L.fillStyle = theme.ink;
      for (const s of all) {
        if (t <= s.t0) continue;
        pencil(L, s, clamp((t - s.t0) / 0.06));
      }
      L.globalAlpha = 1;
      drawCaption(L, ease.inOutSine(seg(t, 2.45, 2.8)));
    }
    L.globalAlpha = 1;
    // The eraser scrubs along its zigzag.
    const ep = ease.inOutSine(seg(t, ERASE_START, ERASE_END));
    const path = eraserPath(sc);
    if (ep > 0) {
      const done = headOf(path, ep);
      L.globalCompositeOperation = "destination-out";
      L.lineCap = "round";
      L.lineJoin = "round";
      L.strokeStyle = "rgba(0,0,0,0.55)";
      L.lineWidth = u * 0.14;
      L.beginPath();
      tracePts(L, done);
      L.stroke();
      L.strokeStyle = "#000";
      L.lineWidth = u * 0.1;
      L.stroke();
      if (ep >= 1) L.clearRect(0, 0, w, h);
    }
    L.restore();
    // Graphite breaks on the paper tooth.
    tileFill(
      L,
      speckleTile(1212, 256, 2600, 0.3, 0.9, 0.5, 1.4),
      w,
      h,
      Math.max(0.5, u / 800),
      0.3,
      "destination-out",
    );
    ctx.drawImage(layerCanvas as CanvasImageSource, 0, 0);

    // The eraser block itself while it works.
    if (ep > 0 && ep < 1) {
      const done = headOf(path, ep);
      const tip = done[done.length - 1];
      const prev = done[Math.max(0, done.length - 2)];
      const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
      const fade = smoothstep(0, 0.05, ep) * (1 - smoothstep(0.93, 1, ep));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(tip[0], tip[1]);
      ctx.rotate(ang * 0.15 - 0.5);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.roundRect(-u * 0.05 + u * 0.012, -u * 0.075 + u * 0.016, u * 0.1, u * 0.15, u * 0.012);
      ctx.fill();
      ctx.fillStyle = mix(theme.ink, theme.bg, 0.06);
      ctx.beginPath();
      ctx.roundRect(-u * 0.05, -u * 0.075, u * 0.1, u * 0.15, u * 0.012);
      ctx.fill();
      ctx.fillStyle = theme.accent2;
      ctx.fillRect(-u * 0.05, -u * 0.075 + u * 0.05, u * 0.1, u * 0.07);
      ctx.restore();
      // Crumbs rolling off behind it.
      for (let i = 0; i < 10; i++) {
        const q = ep - i * 0.012;
        if (q <= 0) continue;
        const pt = headOf(path, q);
        const [x, y] = pt[pt.length - 1];
        ctx.fillStyle = rgba(theme.ink, 0.5 * fade);
        ctx.beginPath();
        ctx.ellipse(
          x + (hash(i, 1) - 0.5) * u * 0.08,
          y + (hash(i, 2) - 0.5) * u * 0.08,
          u * 0.004,
          u * 0.0025,
          i,
          0,
          TAU,
        );
        ctx.fill();
      }
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
