import { mix, rgba } from "../engine/color";
import {
  buffer,
  clamp,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  once,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle } from "../engine/types";
import { cleanV, glow, pathV, stepFrame, widthV } from "./_s4-helpers";

type V3 = [number, number, number];
type Mesh = { v: V3[]; e: [number, number][] };

const PHI = (1 + Math.sqrt(5)) / 2;

function norm(p: V3): V3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

/** Rotate p about unit axis a by angle th (Rodrigues). */
function rot(p: V3, a: V3, th: number): V3 {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const d = (a[0] * p[0] + a[1] * p[1] + a[2] * p[2]) * (1 - c);
  return [
    p[0] * c + (a[1] * p[2] - a[2] * p[1]) * s + a[0] * d,
    p[1] * c + (a[2] * p[0] - a[0] * p[2]) * s + a[1] * d,
    p[2] * c + (a[0] * p[1] - a[1] * p[0]) * s + a[2] * d,
  ];
}

/** Frequency-2 geodesic sphere: 42 vertices, 120 edges, icosahedral symmetry. */
const GEO = once("wire-geo", (): Mesh => {
  const base: V3[] = [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI],
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1],
  ].map((p) => norm(p as V3));
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const v = [...base];
  const mid = new Map<string, number>();
  const m = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let i = mid.get(key);
    if (i === undefined) {
      i = v.length;
      v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]));
      mid.set(key, i);
    }
    return i;
  };
  const edges = new Set<string>();
  const e: [number, number][] = [];
  const add = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edges.has(key)) return;
    edges.add(key);
    e.push([a, b]);
  };
  for (const [a, b, c] of faces) {
    const ab = m(a, b);
    const bc = m(b, c);
    const ca = m(c, a);
    for (const [p, q, r] of [
      [a, ab, ca],
      [b, bc, ab],
      [c, ca, bc],
      [ab, bc, ca],
    ]) {
      add(p, q);
      add(q, r);
      add(r, p);
    }
  }
  return { v, e };
});

const CUBE: Mesh = {
  v: [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ],
  e: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ],
};

const OCTA: Mesh = {
  v: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ],
  e: [
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [1, 2],
    [1, 3],
    [1, 4],
    [1, 5],
    [2, 4],
    [4, 3],
    [3, 5],
    [5, 2],
  ],
};

/** Axis through a vertex of the icosahedron: a 72° turn about it is a symmetry. */
const A5 = norm([-1, PHI, 0]);

interface Cam {
  cx: number;
  cy: number;
  f: number;
  dist: number;
}

function project(p: V3, cam: Cam): [number, number, number] {
  const z = p[2] + cam.dist;
  const k = cam.f / z;
  return [cam.cx + p[0] * k, cam.cy - p[1] * k, p[2]];
}

/** Fixed view tilt applied after the spin, so the spin axis leans toward us. */
function view(p: V3): V3 {
  let q = rot(p, [1, 0, 0], -0.42);
  q = rot(q, [0, 0, 1], 0.2);
  return q;
}

/**
 * Stroke a mesh: edges bucketed by depth so the far side is dim (the beam's
 * depth cue), plus bright dwell dots where the beam stops at each vertex.
 */
function drawMesh(
  c: Ctx2D,
  pts: [number, number, number][],
  edges: [number, number][],
  zMin: number,
  zMax: number,
  color: string,
  core: string,
  width: number,
  dot: number,
) {
  const B = 6;
  const buckets: number[][] = Array.from({ length: B }, () => []);
  for (const [a, b] of edges) {
    const z = (pts[a][2] + pts[b][2]) / 2;
    const near = clamp((zMax - z) / (zMax - zMin || 1));
    buckets[Math.min(B - 1, Math.floor(near * B))].push(a, b);
  }
  c.lineCap = "round";
  // Two passes: the coloured halo, then a thin white-hot core.
  for (const [stroke, lw, gain] of [
    [color, width, 1],
    [mix(color, core, 0.72), width * 0.38, 0.9],
  ] as [string, number, number][]) {
    c.strokeStyle = stroke;
    c.lineWidth = lw;
    for (let i = 0; i < B; i++) {
      const list = buckets[i];
      if (!list.length) continue;
      c.globalAlpha = (0.2 + 0.8 * Math.pow((i + 0.5) / B, 1.3)) * gain;
      c.beginPath();
      for (let k = 0; k < list.length; k += 2) {
        const p = pts[list[k]];
        const q = pts[list[k + 1]];
        c.moveTo(p[0], p[1]);
        c.lineTo(q[0], q[1]);
      }
      c.stroke();
    }
  }
  c.fillStyle = mix(color, core, 0.5);
  for (const p of pts) {
    const near = clamp((zMax - p[2]) / (zMax - zMin || 1));
    c.globalAlpha = 0.3 + 0.7 * near;
    c.beginPath();
    c.arc(p[0], p[1], dot * (0.7 + 0.5 * near), 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

export const style: MotionStyle = {
  id: "wireframe-3d",
  name: "Vector Wireframe",
  family: "Retro Tech",
  tagline: "A vector sphere in glowing lines",
  look: "A colour vector monitor: a geodesic sphere with a cube spinning inside it and a satellite on a dashed orbit, drawn in glowing lines.",
  move: "The sphere turns two symmetry steps, the cube counter-spins, the octahedron laps its orbit, vector mountains pan below.",
  rules: [
    "Lines only: no fills, no raster scanlines. It is a vector display.",
    "Depth cue by brightness: the far side of every object is dim, the near side hot.",
    "The beam dwells at vertices, so every corner is a brighter dot.",
    "A white-hot core inside a coloured halo, bloomed, never a flat stroke.",
    "Spins are whole symmetry steps (2 × 72° for the sphere, 2 × 90° for the cube), so the loop closes.",
    "Type is drawn in the same beam: an Asteroids-style stroke font.",
  ],
  prompt: `R — References
• Colour vector arcade monitors: Tempest, Star Wars (1983), Battlezone, the Vectrex (search: vector arcade display, vector monitor glow).
• Elite (1984) and early 3D wireframe graphics: depth-cued lines, no hidden-line removal.

I — Idea
One slow orbit, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a geodesic wireframe sphere turns on a leaning axis; a cube spins inside it; "{{name}}" is written above in beam strokes.
• Middle (1.5–3.5 s): a small octahedron sweeps around a dashed orbit, passing behind the sphere (dimmer) and in front (brighter); a Battlezone-style mountain line pans along the bottom.
• End (3.5–5 s): the sphere completes two 72° symmetry steps, the cube 180°, the satellite one lap, the mountains one period: the frame matches the first.

S — Style
Looks: {{bg}} tube black with a few faint stars; the sphere and mountain line in {{accent}}, the cube in {{accent2}}, the orbit and satellite in {{ink}}; white-hot cores, soft bloom, bright vertex dots; thin corner brackets; title in an Asteroids-style stroke font.
Moves: constant angular speeds (no easing on spins, like a real vector game), perspective projection, depth-cued brightness, a faint per-frame beam flicker.
Rules:
1. Lines only; no raster scanlines.
2. Far edges dim, near edges bright; vertices brighter still.
3. Halo + hot core per line, bloomed.
4. Spins are exact symmetry steps per loop.
5. Type drawn with vector strokes, not a font file.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the sphere reads as 3D (depth cue visible); vertex dots are brighter than the lines; the satellite never collides with the title; lines stay crisp under the glow. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Vector_monitor",
  theme: {
    bg: "#02030a",
    ink: "#eef4ff",
    accent: "#3fe3ff",
    accent2: "#ff4fd8",
    font: "Inter",
  },
  tags: [
    "wireframe",
    "3d",
    "vector",
    "geometry",
    "sphere",
    "cube",
    "polygon",
    "arcade",
    "space",
    "sci-fi",
    "retro",
    "lines",
  ],
  word: "VECTOR",
  render(ctx, t, theme, w, h) {
    const { u, portrait, cx } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    light(ctx, cx, h * 0.55, u * 0.9, theme.accent, 0.05);

    // A few faint stars, fixed (vector games drew them as dots).
    ctx.fillStyle = theme.ink;
    for (let i = 0; i < 70; i++) {
      const x = hash(i, 3) * w;
      const y = hash(i, 7) * h;
      const tw = 0.5 + 0.5 * Math.sin(TAU * ((t / LOOP) * (1 + (i % 3)) + hash(i, 11)));
      ctx.globalAlpha = (0.08 + 0.22 * hash(i, 5)) * (0.6 + 0.4 * tw);
      ctx.fillRect(x, y, Math.max(1, u * 0.0022), Math.max(1, u * 0.0022));
    }
    ctx.globalAlpha = 1;

    const k = Math.max(0.6, u / 1080);
    const title = cleanV(wordFor(theme.name, "VECTOR", 12));
    const titleSize = Math.min(u * (portrait ? 0.016 : 0.0135), (w * 0.8) / widthV(title));
    const titleY = portrait ? h * 0.12 : h * 0.085;
    const stageTop = titleY + titleSize * 6 + u * 0.04;
    const stageBottom = h - u * (portrait ? 0.1 : 0.12);
    // Portrait stands the orbit on end, so the sphere can grow into the height.
    const R = portrait
      ? Math.min((stageBottom - stageTop) * 0.3, w * 0.33)
      : Math.min((stageBottom - stageTop) * 0.42, w * 0.25);
    const cam: Cam = { cx, cy: (stageTop + stageBottom) / 2, f: R * 4.2, dist: 4.2 };
    const phase = t / LOOP;

    const { canvas: layerC, ctx: L } = buffer("wire-layer", w, h);
    L.clearRect(0, 0, w, h);
    L.save();
    L.globalCompositeOperation = "lighter";

    // The geodesic sphere: 144° a loop about a 5-fold axis (two symmetry steps).
    const spin = TAU * 0.4 * phase;
    const geo = GEO.v.map((p) => project(view(rot(p, A5, spin)), cam));
    drawMesh(L, geo, GEO.e, -1, 1, theme.accent, theme.ink, 3.2 * k, 2.8 * k);

    // The cube inside, counter-spinning 180° a loop about a 4-fold axis.
    const cubeSpin = -Math.PI * phase;
    const cube = CUBE.v.map((p) => {
      let q = rot([p[0] * 0.36, p[1] * 0.36, p[2] * 0.36], [0, 1, 0], cubeSpin);
      q = rot(q, [1, 0, 0], 0.62);
      q = rot(q, [0, 0, 1], 0.5);
      return project(q, cam);
    });
    drawMesh(L, cube, CUBE.e, -0.62, 0.62, theme.accent2, theme.ink, 3.4 * k, 3.2 * k);

    // The orbit: a tilted ring, dashed, dim behind the sphere.
    const tiltX = 0.3;
    const tiltZ = portrait ? -1.32 : -0.22;
    const orbitR = 1.62;
    const ring = (a: number): V3 => {
      let q: V3 = [Math.cos(a) * orbitR, 0, Math.sin(a) * orbitR];
      q = rot(q, [1, 0, 0], tiltX);
      q = rot(q, [0, 0, 1], tiltZ);
      return q;
    };
    L.strokeStyle = theme.ink;
    L.lineWidth = 1.4 * k;
    L.lineCap = "round";
    const N = 96;
    for (let i = 0; i < N; i += 2) {
      const a0 = (i / N) * TAU + phase * TAU * 0.25;
      const a1 = ((i + 1) / N) * TAU + phase * TAU * 0.25;
      const p0 = project(ring(a0), cam);
      const p1 = project(ring(a1), cam);
      L.globalAlpha = 0.12 + 0.3 * clamp((orbitR - (p0[2] + p1[2]) / 2) / (2 * orbitR));
      L.beginPath();
      L.moveTo(p0[0], p0[1]);
      L.lineTo(p1[0], p1[1]);
      L.stroke();
    }
    L.globalAlpha = 1;

    // The satellite: one lap per loop, spinning 90° about its own axis.
    const lap = TAU * phase + 0.6;
    const at = ring(lap);
    const sat = OCTA.v.map((p) => {
      let q = rot([p[0] * 0.2, p[1] * 0.2, p[2] * 0.2], [0, 1, 0], (TAU / 4) * phase * 2);
      q = rot(q, [1, 0, 0], 0.4);
      return project([q[0] + at[0], q[1] + at[1], q[2] + at[2]], cam);
    });
    const behind = at[2] > 0;
    drawMesh(
      L,
      sat,
      OCTA.e,
      at[2] - 0.2,
      at[2] + 0.2,
      mix(theme.ink, theme.accent, 0.25),
      theme.ink,
      (behind ? 1.6 : 2.2) * k,
      2 * k,
    );

    // A vector mountain range along the bottom, panning one period a loop (Battlezone's horizon).
    const baseY = h - u * 0.05;
    const period = w / 2;
    const pan = (t / LOOP) * period;
    const RANGE: [number, number][] = [
      [0, 0.12],
      [0.07, 0.5],
      [0.13, 0.22],
      [0.22, 0.95],
      [0.3, 0.3],
      [0.37, 0.58],
      [0.46, 0.14],
      [0.55, 0.72],
      [0.63, 0.28],
      [0.72, 1],
      [0.8, 0.36],
      [0.88, 0.62],
      [0.95, 0.2],
      [1, 0.12],
    ];
    L.strokeStyle = theme.accent;
    L.lineWidth = 1.8 * k;
    L.lineJoin = "miter";
    L.globalAlpha = 0.5;
    L.beginPath();
    let first = true;
    for (let p0 = -period - (pan % period); p0 < w + period; p0 += period)
      for (const [q, hq] of RANGE) {
        const x = p0 + q * period;
        const y = baseY - hq * u * 0.11;
        if (first) {
          L.moveTo(x, y);
          first = false;
        } else L.lineTo(x, y);
      }
    L.stroke();
    L.globalAlpha = 0.35;
    L.beginPath();
    L.moveTo(0, baseY);
    L.lineTo(w, baseY);
    L.stroke();
    L.globalAlpha = 1;

    // Playfield corners, like a vector game's frame.
    const inset = u * 0.045;
    const arm = u * 0.05;
    L.strokeStyle = theme.ink;
    L.lineWidth = 1.6 * k;
    L.globalAlpha = 0.35;
    L.beginPath();
    for (const [x, y, sx, sy] of [
      [inset, inset, 1, 1],
      [w - inset, inset, -1, 1],
      [inset, h - inset, 1, -1],
      [w - inset, h - inset, -1, -1],
    ]) {
      L.moveTo(x, y + sy * arm);
      L.lineTo(x, y);
      L.lineTo(x + sx * arm, y);
    }
    L.stroke();
    L.globalAlpha = 1;

    // Title, written in beam strokes.
    const tw = widthV(title) * titleSize;
    const tx = cx - tw / 2;
    L.strokeStyle = theme.ink;
    L.lineWidth = 3 * k;
    L.lineJoin = "round";
    L.globalAlpha = 0.95;
    L.beginPath();
    pathV(L, title, tx, titleY, titleSize);
    L.stroke();
    L.globalAlpha = 1;
    L.restore();

    // Beam flicker: vector monitors shimmer a little from frame to frame.
    const flick = 0.94 + 0.06 * hash(stepFrame(t, 30), 17);
    glow(ctx, layerC as CanvasImageSource, "wire-wide", 0, 0, w, h, 10, 5, flick, "screen");
    glow(ctx, layerC as CanvasImageSource, "wire", 0, 0, w, h, 4, 1.8, flick, "screen");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = flick;
    ctx.drawImage(layerC as CanvasImageSource, 0, 0);
    ctx.restore();

    // A dropped logo is lit by the same beam, left of the title.
    const mark = tintedLogo(theme, theme.ink, titleSize * 7, titleSize * 7);
    if (mark) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(mark as CanvasImageSource, tx - titleSize * 10, titleY - titleSize * 0.5);
      ctx.restore();
    }

    vignette(ctx, w, h, "#000000", 0.6);
    grain(ctx, w, h, t, 0.26);
    void rgba;
  },
};
