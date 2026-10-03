import { mix, rgba } from "../engine/color";
import {
  bake,
  context,
  frameOf,
  grain,
  ground,
  hash,
  light,
  makeCanvas,
  rng,
  TAU,
  vignette,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, bokeh, cyc, glow, mottled, pfbm, tnoise, turn, vgrad } from "./_s7-helpers";

/** Floor line (top of the reef) as a fraction of height. */
function floorOf(w: number, h: number) {
  const { portrait } = frameOf(w, h);
  return h * (portrait ? 0.66 : 0.64);
}

/** A branching coral (staghorn), recursive, drawn as tapered strokes. */
function staghorn(
  c: Ctx2D,
  x: number,
  y: number,
  len: number,
  a: number,
  width: number,
  depth: number,
  r: () => number,
) {
  const ex = x + Math.cos(a) * len;
  const ey = y + Math.sin(a) * len;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(x + Math.cos(a + 0.2) * len * 0.5, y + Math.sin(a + 0.2) * len * 0.5, ex, ey);
  c.stroke();
  if (depth <= 0) {
    c.beginPath();
    c.arc(ex, ey, width * 0.7, 0, TAU);
    c.fill();
    return;
  }
  const n = 2 + (r() < 0.4 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const na = a + (k - (n - 1) / 2) * (0.45 + r() * 0.25) + (r() - 0.5) * 0.2;
    staghorn(c, ex, ey, len * (0.62 + r() * 0.18), na, width * 0.72, depth - 1, r);
  }
}

/** A sea fan: a fan-shaped lattice of fine branches with a faint membrane. Built once as a sprite. */
const fans = new Map<string, AnyCanvas>();
function fanSprite(color: string, seed: number): AnyCanvas {
  const key = `${color}|${seed}`;
  let c = fans.get(key);
  if (c) return c;
  const S = 360;
  c = makeCanvas(S, S);
  const g = context(c);
  const r = rng(seed);
  const bx = S / 2;
  const by = S * 0.98;
  const R = S * 0.9;
  // Membrane.
  g.fillStyle = rgba(color, 0.14);
  g.beginPath();
  g.moveTo(bx, by);
  for (let i = 0; i <= 40; i++) {
    const a = -Math.PI / 2 - 1.05 + (2.1 * i) / 40;
    const rr = R * (0.86 + 0.1 * Math.sin(i * 1.7 + seed));
    g.lineTo(bx + Math.cos(a) * rr * 0.55, by + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  // Branches: fan out from the base, forking as they go.
  g.strokeStyle = color;
  g.lineCap = "round";
  const nodes: [number, number][] = [];
  const grow = (x: number, y: number, a: number, len: number, wd: number, d: number) => {
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    g.lineWidth = wd;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + Math.cos(a + 0.15) * len * 0.5,
      y + Math.sin(a + 0.15) * len * 0.5,
      ex,
      ey,
    );
    g.stroke();
    nodes.push([ex, ey]);
    if (d <= 0) return;
    const spread = 0.16 + r() * 0.12;
    grow(ex, ey, a - spread, len * 0.86, wd * 0.8, d - 1);
    grow(ex, ey, a + spread, len * 0.86, wd * 0.8, d - 1);
  };
  for (const a0 of [-0.45, 0, 0.45]) grow(bx, by, -Math.PI / 2 + a0, S * 0.1, S * 0.018, 6);
  // Cross-links between nearby branch tips: the lattice.
  g.lineWidth = S * 0.0035;
  g.globalAlpha = 0.8;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < Math.min(nodes.length, i + 9); j++) {
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d < S * 0.06 && r() < 0.5) {
        g.beginPath();
        g.moveTo(nodes[i][0], nodes[i][1]);
        g.lineTo(nodes[j][0], nodes[j][1]);
        g.stroke();
      }
    }
  fans.set(key, c);
  if (fans.size > 12) fans.delete(fans.keys().next().value as string);
  return c;
}

/** Water column, far reef and the sea floor: everything that holds still. */
function reef(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    const F = floorOf(w, h);
    mottled(c, w, h, theme.bg, theme.accent2, 0.04, 61, 0.012);
    vgrad(c, 0, 0, w, h, [
      [0, mix(theme.bg, theme.accent2, 0.5), 1],
      [0.45, mix(theme.bg, theme.accent2, 0.2), 1],
      [1, mix(theme.bg, "#000000", 0.35), 1],
    ]);
    light(c, w * 0.5, -h * 0.1, u * 1.2, mix(theme.accent2, theme.ink, 0.4), 0.25);
    // Far reef silhouettes, hazy with distance.
    const far = mix(theme.bg, theme.accent2, 0.3);
    c.fillStyle = far;
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w; x += Math.max(2, w / 300)) {
      const n = pfbm((x / w) * 6, 64, 3, 3);
      c.lineTo(x, F - u * 0.06 - (0.5 + n) * u * 0.12);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fill();
    const r = rng(12);
    // Mid reef: coral heads and staghorn thickets, colour dimmed by the water.
    const mid = mix(theme.bg, theme.accent2, 0.2);
    c.fillStyle = mid;
    c.strokeStyle = mid;
    c.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const x = r() * w;
      const rad = u * (0.05 + r() * 0.08);
      c.beginPath();
      c.ellipse(x, F + u * 0.02, rad * 1.3, rad * 0.8, 0, Math.PI, TAU);
      c.fill();
    }
    const horn = mix(mix(theme.accent2, theme.ink, 0.3), theme.bg, 0.35);
    c.fillStyle = horn;
    c.strokeStyle = horn;
    for (let i = 0; i < 6; i++) {
      staghorn(
        c,
        r() * w,
        F + u * 0.035,
        u * (0.045 + r() * 0.03),
        -Math.PI / 2 + (r() - 0.5) * 0.5,
        u * 0.014,
        4,
        r,
      );
    }
    // The floor: sand in the dark, lit from above.
    vgrad(c, 0, F, w, h, [
      [0, mix(theme.bg, theme.accent2, 0.24), 1],
      [1, mix(theme.bg, "#000000", 0.45), 1],
    ]);
    for (let i = 0; i < (w * (h - F)) / 500; i++) {
      c.fillStyle = rgba(theme.ink, 0.02 + r() * 0.05);
      c.fillRect(r() * w, F + r() * (h - F), u * 0.002, u * 0.002);
    }
    // Near coral heads framing the floor.
    const near = mix(theme.bg, "#000000", 0.4);
    c.fillStyle = near;
    for (let i = 0; i < 5; i++) {
      const x = (i / 4) * w + (r() - 0.5) * u * 0.2;
      const rad = u * (0.09 + r() * 0.08);
      c.beginPath();
      c.ellipse(x, h + rad * 0.2, rad * 1.4, rad, 0, Math.PI, TAU);
      c.fill();
    }
  };
}

interface Anemone {
  x: number;
  y: number;
  size: number;
  n: number;
  seed: number;
}

function anemones(w: number, h: number): Anemone[] {
  const { u, portrait } = frameOf(w, h);
  const F = floorOf(w, h);
  return portrait
    ? [
        { x: w * 0.16, y: F + (h - F) * 0.3, size: u * 0.2, n: 34, seed: 2 },
        { x: w * 0.86, y: F + (h - F) * 0.38, size: u * 0.24, n: 38, seed: 3 },
        { x: w * 0.5, y: F + (h - F) * 0.7, size: u * 0.5, n: 70, seed: 1 },
      ]
    : [
        { x: w * 0.76, y: F + (h - F) * 0.42, size: u * 0.24, n: 40, seed: 2 },
        { x: w * 0.1, y: F + (h - F) * 0.36, size: u * 0.17, n: 30, seed: 3 },
        { x: w * 0.4, y: F + (h - F) * 0.72, size: u * 0.46, n: 72, seed: 1 },
      ];
}

/** An anemone: soft tapered tentacles in two rows, bending with the surge, tips lit. */
function drawAnemone(ctx: Ctx2D, a: Anemone, t: number, theme: Theme, u: number) {
  const base = mix(theme.accent, theme.bg, 0.5);
  const mid = mix(theme.accent, theme.bg, 0.12);
  const tip = mix(theme.accent, theme.ink, 0.5);
  const tips: [number, number, number, number][] = [];
  const rows = [
    { n: Math.round(a.n * 0.55), back: true },
    { n: a.n, back: false },
  ];
  // Oral disc behind the tentacles.
  ctx.fillStyle = mix(theme.accent, theme.bg, 0.55);
  ctx.beginPath();
  ctx.ellipse(a.x, a.y - a.size * 0.02, a.size * 0.24, a.size * 0.07, 0, 0, TAU);
  ctx.fill();
  for (const row of rows) {
    for (let k = 0; k < row.n; k++) {
      const f = (k + 0.5) / row.n;
      const spread = (f - 0.5) * (row.back ? 2.2 : 2.9);
      const dir = -Math.PI / 2 + spread;
      const seed = k + (row.back ? 500 : 0);
      const len =
        a.size *
        (0.5 + 0.4 * hash(a.seed, seed, 1)) *
        (1 - Math.abs(f - 0.5) * 0.45) *
        (row.back ? 0.9 : 1);
      // One surge per loop washes across the anemone from left to right.
      const surge = Math.sin(turn(t, 1, -f * 0.3 + a.seed * 0.17));
      const flutter = Math.sin(turn(t, 2, hash(a.seed, seed, 2))) * 0.12;
      const bend = surge * 1.1 + flutter + (hash(a.seed, seed, 4) - 0.5) * 0.6;
      const ox = Math.cos(dir) * a.size * 0.2;
      const oy = Math.sin(dir) * a.size * 0.06 - (row.back ? a.size * 0.03 : 0);
      const seg = 12;
      const pts: [number, number][] = [];
      let x = a.x + ox;
      let y = a.y + oy;
      let ang = dir;
      for (let s = 0; s <= seg; s++) {
        pts.push([x, y]);
        const k2 = s / seg;
        ang += (bend * 1.6 * k2) / seg;
        x += Math.cos(ang) * (len / seg);
        y += Math.sin(ang) * (len / seg);
      }
      const w0 = a.size * 0.03;
      const w1 = a.size * 0.012;
      ctx.beginPath();
      for (let s = 0; s <= seg; s++) {
        const [px, py] = pts[s];
        const [qx, qy] = pts[Math.min(seg, s + 1)];
        const [rx, ry] = pts[Math.max(0, s - 1)];
        const d = Math.atan2(qy - ry, qx - rx) + Math.PI / 2;
        const wd = w0 + (w1 - w0) * (s / seg);
        const X = px + Math.cos(d) * wd;
        const Y = py + Math.sin(d) * wd;
        if (s === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      for (let s = seg; s >= 0; s--) {
        const [px, py] = pts[s];
        const [qx, qy] = pts[Math.min(seg, s + 1)];
        const [rx, ry] = pts[Math.max(0, s - 1)];
        const d = Math.atan2(qy - ry, qx - rx) - Math.PI / 2;
        const wd = w0 + (w1 - w0) * (s / seg);
        ctx.lineTo(px + Math.cos(d) * wd, py + Math.sin(d) * wd);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[seg][0], pts[seg][1]);
      g.addColorStop(0, row.back ? mix(base, theme.bg, 0.4) : base);
      g.addColorStop(0.6, row.back ? mix(mid, theme.bg, 0.35) : mid);
      g.addColorStop(1, row.back ? mix(tip, theme.bg, 0.3) : tip);
      ctx.fillStyle = g;
      ctx.globalAlpha = row.back ? 0.9 : 0.95;
      ctx.fill();
      // Rounded, lighter tip.
      ctx.fillStyle = row.back ? mix(tip, theme.bg, 0.3) : tip;
      ctx.beginPath();
      ctx.arc(pts[seg][0], pts[seg][1], w1 * 1.35, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!row.back) tips.push([pts[seg][0], pts[seg][1], hash(a.seed, seed, 3), w1]);
    }
  }
  // Glowing tips.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const tipGlow = glow(theme.accent, 0.25);
  for (const [x, y, hsh] of tips) {
    const pulse = 0.55 + 0.45 * Math.sin(turn(t, 2, hsh));
    blit(ctx, tipGlow, x, y, a.size * 0.09, 0.3 * pulse);
  }
  ctx.restore();
  void u;
}

export const style: MotionStyle = {
  id: "coral-reef",
  name: "Reef Sway",
  family: "Nature",
  tagline: "A reef in shafts of light",
  look: "A reef at depth: blue water cut by shafts of light, sea fans and staghorn coral, and pink anemones whose glowing tentacles sway in the surge.",
  move: "One slow surge washes across the reef each loop: tentacles bend and recover, fans rock, light rays shimmer and marine snow drifts up.",
  rules: [
    "Light comes from the surface only: rays fan down and fade with depth.",
    "The surge is one wave that travels across the tentacles, never lockstep.",
    "Anemone tentacles taper to a glowing tip; the glow is the one warm accent.",
    "Depth by haze: far reef pale and blue, near coral nearly black.",
    "Marine snow drifts slowly upward, near specks soft and out of focus.",
    "Sea fans rock on their base; they never stretch.",
  ],
  prompt: `R — References
• Reef footage from nature documentaries (search: anemone swaying current, sea fan gorgonian, god rays underwater).
• Underwater photography: blue haze with depth, marine snow bokeh.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): blue water over a reef; shafts of light shimmer down; anemones lean one way.
• Middle (1.5–3.5 s): a surge washes across: tentacles sweep over and back in a wave, sea fans rock, marine snow drifts through the rays.
• End (3.5–5 s): the water settles back to the first pose, landing exactly on the first frame.

S — Style
Looks: {{bg}} deep water rising to {{accent2}} near the surface; light rays in pale {{ink}}; far reef in hazy {{accent2}}; near coral near-black; anemones in {{accent}} with glowing tips.
Moves: tentacle bend = sin(2π(t/5 + x)) so the surge travels; fans rock by a few degrees about their base; rays shimmer on periodic noise; particles rise on whole-loop paths.
Rules:
1. Light from above only.
2. A travelling surge, not lockstep.
3. Tapered tentacles with glowing tips.
4. Depth by haze.
5. Slow marine snow with bokeh.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; tentacles taper and never kink; the surge visibly travels; rays fade with depth; the far reef is lighter than the near coral. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Sea_anemone",
  theme: {
    bg: "#03101a",
    ink: "#def5f1",
    accent: "#ff7485",
    accent2: "#2aa3a3",
    font: "Inter",
  },
  tags: [
    "ocean",
    "underwater",
    "reef",
    "coral",
    "anemone",
    "sea",
    "marine",
    "calm",
    "blue",
    "nature",
    "aquarium",
  ],
  word: "Reef",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const F = floorOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `reef-still:${theme.bg}${theme.ink}${theme.accent2}`,
        w,
        h,
        reef(theme),
      ) as CanvasImageSource,
      0,
      0,
    );

    // Light rays from the surface, fanning down and shimmering.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rays = 9;
    const src = [w * 0.46, -h * 0.35];
    for (let i = 0; i < rays; i++) {
      const a = Math.PI / 2 + ((i - (rays - 1) / 2) / rays) * 0.9 + (hash(i, 1) - 0.5) * 0.06;
      const wd = u * (0.03 + 0.05 * hash(i, 2));
      const shimmer = 0.5 + 0.5 * tnoise(i * 1.7, t, 5, 1 + (i % 2), 0.9);
      const len = h * 1.6;
      const x0 = src[0] + Math.cos(a) * h * 0.35;
      const y0 = src[1] + Math.sin(a) * h * 0.35;
      const x1 = src[0] + Math.cos(a) * len;
      const y1 = src[1] + Math.sin(a) * len;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, rgba(theme.ink, 0.16 * shimmer));
      g.addColorStop(0.5, rgba(theme.ink, 0.05 * shimmer));
      g.addColorStop(1, rgba(theme.ink, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0 - nx * wd * 0.4, y0 - ny * wd * 0.4);
      ctx.lineTo(x0 + nx * wd * 0.4, y0 + ny * wd * 0.4);
      ctx.lineTo(x1 + nx * wd * 2.2, y1 + ny * wd * 2.2);
      ctx.lineTo(x1 - nx * wd * 2.2, y1 - ny * wd * 2.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Sea fans rocking on their bases.
    const fanCol = mix(mix(theme.accent, theme.accent2, 0.45), theme.ink, 0.1);
    const fanList: [number, number, number, number][] = [
      [0.6, 0.0, 0.42, 11],
      [0.93, 0.04, 0.34, 12],
      [0.2, 0.03, 0.3, 13],
    ];
    for (const [fx, fy, fs, seed] of fanList) {
      const sprite = fanSprite(mix(fanCol, theme.bg, 0.3 + (seed - 11) * 0.1), seed);
      const S = fs * u;
      const rock = Math.sin(turn(t, 1, fx * 0.35 + 0.1)) * 0.07;
      ctx.save();
      ctx.translate(fx * w, F + fy * u);
      ctx.rotate(rock);
      ctx.drawImage(sprite as CanvasImageSource, -S / 2, -S * 0.98, S, S);
      ctx.restore();
    }

    for (const a of anemones(w, h)) drawAnemone(ctx, a, t, theme, u);

    // Marine snow: slow, upward, the near specks soft.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const speck = glow(theme.ink, 0.4);
    const soft = bokeh(mix(theme.ink, theme.accent2, 0.3), 0.3, 0.3);
    for (let i = 0; i < 150; i++) {
      const near = i < 12;
      const q = cyc(t, 1, hash(i, 11));
      const y = h * 1.05 - q * h * 1.1;
      const x = hash(i, 12) * w + Math.sin(turn(t, 1, hash(i, 13))) * u * 0.02 + q * u * 0.08;
      if (near) blit(ctx, soft, x, y, u * (0.03 + 0.03 * hash(i, 14)), 0.18);
      else blit(ctx, speck, x, y, u * (0.004 + 0.008 * hash(i, 14)), 0.25 + 0.4 * hash(i, 15));
    }
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.6);
    grain(ctx, w, h, t, 0.28);
  },
};
