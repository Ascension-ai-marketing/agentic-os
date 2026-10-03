import { mix, rgba } from "../engine/color";
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
  LOOP,
  noise3,
  rng,
  smoothstep,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { frameIndex, mottle, speckleTile, stepTime, tileFill, type Pt } from "./_s2-helpers";

/**
 * Soft pastel on dark paper, animated on twos like a hand-drawn film: two koi
 * circle each other, every stroke redrawn each frame with a small boil, the
 * chalk breaking over the paper's tooth, dust at every edge.
 */
const FPS = 12;
const BEATS = 5;

type Fish = {
  phase: number;
  body: string;
  patch: string;
  shade: string;
  seed: number;
  patches: [number, number, number, number][];
};

type Frame = { x: number; y: number; tx: number; ty: number; nx: number; ny: number };

/** The fish's spine at stepped time ts: head at k = 0, tail root at k = 1. */
function spine(
  cx: number,
  cy: number,
  Rp: number,
  len: number,
  ph: number,
  ts: number,
  n = 28,
): Frame[] {
  const out: Frame[] = [];
  const head = TAU * (ts / LOOP + ph);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const a = head - (k * len) / Rp;
    const amp = len * (0.012 + 0.075 * k * k);
    const lat = amp * Math.sin(TAU * (1.1 * k - (BEATS * ts) / LOOP) + ph * 7);
    const r = Rp + lat;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n, i + 1)];
    let tx = a[0] - b[0];
    let ty = a[1] - b[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    out.push({ x: pts[i][0], y: pts[i][1], tx, ty, nx: -ty, ny: tx });
  }
  return out;
}

const widthAt = (k: number) =>
  Math.sqrt(clamp(k / 0.13)) * (1 - 0.72 * smoothstep(0.3, 0.9, k)) * (1 + 0.04 * Math.sin(k * 9));

/** Body space (k along, v across -1..1) to canvas space. */
function toWorld(sp: Frame[], k: number, v: number, W: number): Pt {
  const f = clamp(k) * (sp.length - 1);
  const i = Math.min(sp.length - 2, Math.floor(f));
  const t = f - i;
  const a = sp[i];
  const b = sp[i + 1];
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const nx = a.nx + (b.nx - a.nx) * t;
  const ny = a.ny + (b.ny - a.ny) * t;
  const hw = widthAt(k) * W * v;
  return [x + nx * hw, y + ny * hw];
}

/** Is (k, v) inside one of the fish's colour patches (noisy edges)? */
function inPatch(f: Fish, k: number, v: number) {
  for (const [k0, k1, v0, v1] of f.patches) {
    const e = 0.035 * noise3(k * 9, v * 3, f.seed);
    if (k > k0 + e && k < k1 - e && v > v0 + e * 3 && v < v1 - e * 3) return true;
  }
  return false;
}

/** One chalk stroke: a tapered, slightly bowed line with a soft doubled edge. */
function chalk(c: Ctx2D, a: Pt, b: Pt, width: number, color: string, alpha: number) {
  c.strokeStyle = rgba(color, alpha * 0.35);
  c.lineWidth = width * 1.9;
  c.beginPath();
  c.moveTo(a[0], a[1]);
  c.lineTo(b[0], b[1]);
  c.stroke();
  c.strokeStyle = rgba(color, alpha);
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(a[0], a[1]);
  c.lineTo(b[0], b[1]);
  c.stroke();
}

function drawFish(c: Ctx2D, f: Fish, sp: Frame[], W: number, u: number, frame: number) {
  const r = (i: number, j: number) => hash(i, j, f.seed * 131 + frame);
  c.lineCap = "round";
  // Tail: long flowing strokes fanning from the root, lagging the body.
  const root = sp[sp.length - 1];
  const prev = sp[sp.length - 5];
  const dirX = root.x - prev.x;
  const dirY = root.y - prev.y;
  const dl = Math.hypot(dirX, dirY) || 1;
  const swing = Math.sin((TAU * BEATS * frame) / (LOOP * FPS) + f.phase * 7 - 1.4);
  for (let i = 0; i < 18; i++) {
    const q = i / 17 - 0.5;
    const spread = q * 1.35 + swing * 0.3;
    const len = W * (2.0 + 1.3 * Math.abs(q) * 2) * (0.9 + 0.2 * r(i, 1));
    const ca = Math.cos(spread);
    const sa = Math.sin(spread);
    const dx = (dirX / dl) * ca - (dirY / dl) * sa;
    const dy = (dirX / dl) * sa + (dirY / dl) * ca;
    const x0 = root.x + (r(i, 2) - 0.5) * W * 0.3;
    const y0 = root.y + (r(i, 3) - 0.5) * W * 0.3;
    // The fin trails the swing: each ray bows against its motion.
    const bow = -swing * len * 0.28;
    const mx = x0 + dx * len * 0.5 - dy * bow;
    const my = y0 + dy * len * 0.5 + dx * bow;
    c.strokeStyle = rgba(i % 5 === 0 ? f.patch : f.body, 0.3 + 0.25 * r(i, 4));
    c.lineWidth = u * (0.006 + 0.004 * r(i, 5));
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo(mx, my, x0 + dx * len - dy * bow * 0.6, y0 + dy * len + dx * bow * 0.6);
    c.stroke();
  }
  // Pectoral fins: a soft fan with a few rays, sweeping back.
  for (const side of [-1, 1]) {
    const base = toWorld(sp, 0.24, side * 0.8, W);
    const at = sp[Math.round(0.24 * (sp.length - 1))];
    const flap = 0.22 * Math.sin((TAU * BEATS * frame) / (LOOP * FPS) + side + f.phase * 5);
    for (let i = 0; i < 7; i++) {
      const ang = 0.55 + i * 0.14 + flap;
      const bx = -at.tx * Math.cos(ang) + side * at.nx * Math.sin(ang) * 1.3;
      const by = -at.ty * Math.cos(ang) + side * at.ny * Math.sin(ang) * 1.3;
      const bl = Math.hypot(bx, by) || 1;
      const len = W * (1.25 + 0.3 * r(i, 10 + side));
      const end: Pt = [base[0] + (bx / bl) * len, base[1] + (by / bl) * len];
      chalk(
        c,
        base,
        end,
        u * (i % 2 ? 0.012 : 0.005),
        f.body,
        i % 2 ? 0.16 : 0.38 + 0.2 * r(i, 12),
      );
    }
  }
  // Body: hatching along the fish, pale sides, coloured patches, a lit back.
  const rows = 7;
  const cols = 12;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const v = -0.92 + (1.84 * (j + 0.5)) / rows + (r(i + 40, j) - 0.5) * 0.12;
      const k0 = 0.02 + (0.94 * i) / cols + (r(i, j + 20) - 0.5) * 0.03;
      const k1 = k0 + 0.13 + 0.07 * r(i, j + 30);
      if (k0 > 0.97) continue;
      const mid = (k0 + k1) / 2;
      const edge = Math.abs(v);
      let col = inPatch(f, mid, v) ? f.patch : f.body;
      if (edge > 0.7) col = mix(col, f.shade, 0.55);
      const a = toWorld(sp, k0, v, W);
      const b = toWorld(sp, Math.min(0.99, k1), v * (1 - 0.05), W);
      chalk(c, a, b, u * (0.013 + 0.006 * r(i, j + 50)), col, 0.62 + 0.3 * r(i, j + 60));
    }
  // Highlight strokes down the spine and a crisp eye.
  for (let i = 0; i < 5; i++) {
    const k0 = 0.1 + i * 0.12;
    chalk(
      c,
      toWorld(sp, k0, -0.15, W),
      toWorld(sp, k0 + 0.11, -0.1, W),
      u * 0.007,
      mix(f.body, "#ffffff", 0.55),
      0.6,
    );
  }
  for (const side of [-1, 1]) {
    const e = toWorld(sp, 0.08, side * 0.55, W);
    c.fillStyle = rgba("#0a0a0a", 0.8);
    c.beginPath();
    c.arc(e[0], e[1], u * 0.006, 0, TAU);
    c.fill();
  }
}

/** Dark pastel paper: mottled, with the honeycomb tooth of the textured side. */
function paper(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.012, 0.018, u * 0.25, u / 120, 7.7);
    // Honeycomb tooth: a jittered grid of tiny pits and rims.
    const cell = Math.max(2.2, u * 0.0065);
    const r = rng(5151);
    for (let y = 0; y < h + cell; y += cell * 0.87) {
      const row = Math.round(y / (cell * 0.87));
      for (let x = (row % 2) * cell * 0.5; x < w + cell; x += cell) {
        c.fillStyle = rgba(theme.ink, 0.018 + r() * 0.02);
        c.fillRect(x + (r() - 0.5) * cell * 0.3, y, cell * 0.45, cell * 0.3);
      }
    }
    // Lily pads at the corners: dark green pastel, hatched, with a lit rim.
    const pads: [number, number, number, number][] =
      w > h * 1.2
        ? [
            [0.1, 0.18, 0.2, 0.3],
            [0.92, 0.82, 0.24, 2.4],
            [0.86, 0.12, 0.12, 4.1],
          ]
        : [
            [0.14, 0.1, 0.2, 0.3],
            [0.88, 0.9, 0.24, 2.4],
            [0.9, 0.3, 0.1, 4.1],
          ];
    for (const [px, py, pr, rot] of pads) {
      const x0 = px * w;
      const y0 = py * h;
      const R = pr * u;
      c.save();
      c.translate(x0, y0);
      c.rotate(rot);
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, R, 0.22, TAU - 0.06);
      c.closePath();
      c.fillStyle = mix(theme.accent2, theme.bg, 0.78);
      c.fill();
      c.clip();
      c.lineCap = "round";
      // Side-of-the-stick strokes along the veins, lighter toward the rim.
      for (let i = 0; i < 46; i++) {
        const a = 0.25 + r() * (TAU - 0.35);
        const d0 = R * (0.1 + r() * 0.5);
        const d1 = d0 + R * (0.25 + r() * 0.35);
        c.strokeStyle = rgba(mix(theme.accent2, theme.bg, 0.52 + r() * 0.2), 0.25 + r() * 0.25);
        c.lineWidth = u * (0.012 + r() * 0.01);
        c.beginPath();
        c.moveTo(Math.cos(a) * d0, Math.sin(a) * d0);
        c.lineTo(Math.cos(a + 0.05) * d1, Math.sin(a + 0.05) * d1);
        c.stroke();
      }
      for (let i = 0; i < 11; i++) {
        const a = 0.3 + (i / 10) * (TAU - 0.45);
        c.strokeStyle = rgba(mix(theme.accent2, theme.bg, 0.55), 0.22);
        c.lineWidth = u * 0.0028;
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(
          Math.cos(a - 0.1) * R * 0.5,
          Math.sin(a - 0.1) * R * 0.5,
          Math.cos(a) * R * 0.97,
          Math.sin(a) * R * 0.97,
        );
        c.stroke();
      }
      c.restore();
      // A lit rim where the pad catches the light.
      c.save();
      c.translate(x0, y0);
      c.rotate(rot);
      c.strokeStyle = rgba(mix(theme.accent2, theme.ink, 0.1), 0.28);
      c.lineWidth = u * 0.005;
      c.beginPath();
      c.arc(0, 0, R * 0.985, 0.9, 2.6);
      c.stroke();
      c.restore();
    }
    // Old dust ground into the paper.
    for (let i = 0; i < (w * h) / 900; i++) {
      c.fillStyle = rgba(r() < 0.5 ? theme.accent : theme.accent2, 0.02 + r() * 0.04);
      const s = u * (0.001 + r() * 0.002);
      c.fillRect(r() * w, r() * h, s, s);
    }
  };
}

export const style: MotionStyle = {
  id: "pastel-chalk",
  name: "Pastel Koi",
  family: "Paint & Draw",
  tagline: "Koi in soft chalk pastel",
  look: "Two koi in soft pastel on dark paper: hatched chalk strokes breaking over the tooth, smudged glow, dusty edges, chalk ripples.",
  move: "The koi circle each other once, animated on twos; every stroke boils as it is redrawn, tails sway, ripples ring out and fade.",
  rules: [
    "Everything is a stroke: bodies are hatched along the fish, fins are fans.",
    "Chalk breaks over the paper tooth; nothing is a clean fill.",
    "A soft smudged glow sits under the crisp strokes.",
    "Animate on twos: 12 drawings a second, a small boil on every redraw.",
    "Pale sides and a lit back give the body its roundness.",
    "Dust gathers at every edge and drifts down slowly.",
    "The koi make one whole turn per loop, so the loop closes.",
  ],
  prompt: `R — References
• Soft pastel on dark Canson paper (search: pastel koi black paper, soft pastel hatching).
• Hand-drawn animation on twos, where every drawing boils slightly (Frédéric Back, "The Man Who Planted Trees").

I — Idea
One image, one turn, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): two koi circle each other on a dark pond, one {{ink}} with {{accent}} patches, one {{accent2}} with {{accent}} sides.
• Middle (1.5–3.5 s): they chase round, tails sweeping, fins fanning; chalk ripples ring out where they turn.
• End (3.5–5 s): they complete exactly one circle and meet the pose they started in.

S — Style
Looks: {{bg}} pastel paper with a honeycomb tooth; bodies hatched in short chalk strokes along the fish; pale sides, a lit back; a soft smudged glow under the strokes; dust at the edges; {{accent2}} ripples.
Moves: the whole drawing steps at 12 fps; each redraw shifts every stroke by a hair (boil); the body undulates in 5 whole beats per loop; ripples expand and fade inside the loop.
Rules:
1. Strokes only: hatching along the body, fans for fins.
2. The tooth breaks every stroke.
3. A soft glow under crisp strokes.
4. On twos, with boil.
5. Pale sides, lit back.
6. Whole turns and whole beats for a seamless loop.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the koi read as fish at thumbnail size; strokes show the paper tooth; the boil is visible but calm; nothing looks like a vector fill. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Pastel",
  theme: {
    bg: "#14161b",
    ink: "#f3ede3",
    accent: "#ff7a45",
    accent2: "#6fb9cf",
    font: "Newsreader",
  },
  tags: [
    "pastel",
    "chalk",
    "koi",
    "fish",
    "soft",
    "hand-drawn",
    "handdrawn",
    "texture",
    "japanese",
    "pond",
    "illustration",
  ],
  word: "Koi",
  render(ctx, t, theme, w, h) {
    const { u, cx, cy, portrait } = frameOf(w, h);
    const ts = stepTime(t, FPS);
    const frame = frameIndex(t, FPS);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `pastel-paper:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`,
        w,
        h,
        paper(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, cx, cy, u * 0.8, theme.accent2, 0.08);

    const Rp = u * (portrait ? 0.28 : 0.27);
    const len = u * (portrait ? 0.58 : 0.56);
    const W = len * 0.13;
    const fishes: Fish[] = [
      {
        phase: 0,
        body: theme.ink,
        patch: theme.accent,
        shade: mix(theme.ink, theme.accent2, 0.45),
        seed: 3,
        patches: [
          [0.04, 0.2, -0.7, 0.75],
          [0.32, 0.56, -0.95, 0.55],
          [0.64, 0.84, -0.3, 0.95],
        ],
      },
      {
        phase: 0.5,
        body: mix(theme.accent2, theme.ink, 0.25),
        patch: theme.accent,
        shade: mix(theme.accent2, theme.bg, 0.35),
        seed: 9,
        patches: [
          [0.18, 0.9, 0.62, 1.2],
          [0.18, 0.9, -1.2, -0.62],
        ],
      },
    ];

    const { canvas: layerCanvas, ctx: L } = buffer("pastel-layer", w, h);
    L.save();
    L.clearRect(0, 0, w, h);

    // Chalk ripples: each rings out and fades inside the loop.
    for (let i = 0; i < 3; i++) {
      const t0 = i * (LOOP / 3);
      const age = (((ts - t0) % LOOP) + LOOP) % LOOP;
      const k = age / 2.4;
      if (k >= 1) continue;
      const a = TAU * (t0 / LOOP) + 0.8;
      const px = cx + Math.cos(a) * Rp * 1.05;
      const py = cy + Math.sin(a) * Rp * 1.05;
      const rr = u * (0.03 + 0.26 * ease.outCubic(k));
      L.lineCap = "round";
      for (let ring = 0; ring < 2; ring++) {
        const R2 = rr * (1 - ring * 0.3);
        const al = (1 - k) * (0.42 - ring * 0.12);
        L.strokeStyle = rgba(theme.accent2, al);
        L.lineWidth = u * (0.009 - ring * 0.003);
        for (let s = 0; s < 40; s++) {
          // Pressure varies along the chalk line as it drags over the tooth.
          const press =
            0.35 +
            0.65 * smoothstep(-0.4, 0.4, noise3(s * 0.35, ring * 3.1, i * 1.7 + frame * 0.2));
          const b0 = (s / 40) * TAU;
          const b1 = ((s + 1.05) / 40) * TAU;
          const j = 1 + 0.03 * noise3(s * 0.4, frame * 0.7, i + ring);
          L.strokeStyle = rgba(theme.accent2, al * press);
          L.beginPath();
          L.moveTo(px + Math.cos(b0) * R2 * j, py + Math.sin(b0) * R2 * 0.6 * j);
          L.lineTo(px + Math.cos(b1) * R2 * j, py + Math.sin(b1) * R2 * 0.6 * j);
          L.stroke();
        }
      }
    }

    // Shadows on the pond floor, then the fish.
    const spines = fishes.map((f) => spine(cx, cy, Rp, len, f.phase, ts));
    fishes.forEach((f, i) => drawFish(L, f, spines[i], W, u, frame));
    L.restore();

    // The tooth breaks every stroke.
    tileFill(
      L,
      speckleTile(771, 256, 3200, 0.35, 1, 0.6, 2.2),
      w,
      h,
      Math.max(0.5, u / 700),
      0.62,
      "destination-out",
    );

    // Soft smudge under the strokes, a shadow beneath, then the crisp chalk.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.filter = `blur(${(u * 0.012).toFixed(1)}px) brightness(0.2)`;
    ctx.drawImage(layerCanvas as CanvasImageSource, u * 0.02, u * 0.03);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.globalCompositeOperation = "screen";
    ctx.filter = `blur(${(u * 0.01).toFixed(1)}px)`;
    ctx.drawImage(layerCanvas as CanvasImageSource, 0, 0);
    ctx.restore();
    ctx.drawImage(layerCanvas as CanvasImageSource, 0, 0);

    // Dust: specks shaken off the strokes, drifting down a fixed distance per loop.
    const r = rng(333);
    for (let i = 0; i < 70; i++) {
      const a = r() * TAU;
      const d = Rp * (0.6 + r() * 0.9);
      const fall = u * 0.08 * ((t / LOOP + r()) % 1);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d + fall - u * 0.04;
      const al = Math.sin(Math.PI * ((t / LOOP + r()) % 1)) * 0.5;
      ctx.fillStyle = rgba(r() < 0.5 ? theme.accent : theme.ink, al);
      const s = u * (0.0015 + r() * 0.0025);
      ctx.fillRect(x, y, s, s);
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.32);
  },
};
