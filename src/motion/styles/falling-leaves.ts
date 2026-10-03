import { mix, rgba } from "../engine/color";
import {
  bake,
  context,
  fitSize,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  makeCanvas,
  rng,
  SERIF,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, cyc, glow, mottled, turn } from "./_s7-helpers";

/** Sprite size in px; leaves are drawn scaled from it. */
const S = 176;
const KINDS = ["maple", "oak", "ginkgo"] as const;
type Kind = (typeof KINDS)[number];
/** Scale and y-shift that fit each outline (with its stem) inside the sprite. */
const FIT: Record<Kind, [number, number]> = {
  maple: [0.76, 0.23],
  oak: [0.9, -0.05],
  ginkgo: [0.64, -0.09],
};
/** Where the stem leaves the blade. */
const STEM: Record<Kind, number> = { maple: 0.13, oak: 0.44, ginkgo: 0.42 };

/** A leaf outline in a unit box: stem at (0, 0.5), tip toward (0, -0.5). */
function outline(kind: Kind): Path2D {
  const p = new Path2D();
  if (kind === "maple") {
    const cx = 0;
    const cy = 0.08;
    const lobes: [number, number, number][] = [
      [0, 0.6, 11],
      [0.98, 0.55, 10],
      [-0.98, 0.55, 10],
      [1.95, 0.33, 9],
      [-1.95, 0.33, 9],
      [0.28, 0.14, 40],
      [-0.28, 0.14, 40],
      [0.7, 0.13, 40],
      [-0.7, 0.13, 40],
      [1.3, 0.12, 40],
      [-1.3, 0.12, 40],
    ];
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI + (TAU * i) / steps;
      let r = 0.13;
      for (const [at, amp, sharp] of lobes)
        r += amp * Math.pow(Math.max(0, Math.cos(a - at)), sharp);
      r *= 1 + 0.06 * Math.pow(Math.abs(Math.sin(a * 24)), 3);
      // Pinch at the stem.
      r *= 1 - 0.55 * Math.pow(Math.max(0, -Math.cos(a)), 6);
      const x = cx + Math.sin(a) * r;
      const y = cy - Math.cos(a) * r;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.closePath();
  } else if (kind === "oak") {
    const steps = 90;
    const side = (sgn: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        const y = 0.44 - s * 0.9;
        const lobe = Math.pow(
          Math.abs(Math.sin(Math.PI * (s * 4.5 + (sgn > 0 ? 0.1 : 0.3)))),
          0.55,
        );
        const wv =
          0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.75) * (0.5 + 0.5 * lobe);
        pts.push([sgn * wv, y]);
      }
      return pts;
    };
    const r = side(1);
    const l = side(-1);
    p.moveTo(0, 0.44);
    for (const [x, y] of r) p.lineTo(x, y);
    for (let i = l.length - 1; i >= 0; i--) p.lineTo(l[i][0], l[i][1]);
    p.closePath();
  } else {
    // Ginkgo fan, notched in the middle.
    const bx = 0;
    const by = 0.42;
    const steps = 120;
    p.moveTo(bx, by);
    for (let i = 0; i <= steps; i++) {
      const a = -1.12 + (2.24 * i) / steps;
      const notch = 1 - 0.3 * Math.exp(-((a / 0.07) ** 2));
      const r = 0.8 * notch * (1 + 0.025 * Math.sin(a * 30)) * (0.88 + 0.12 * Math.cos(a * 1.3));
      p.lineTo(bx + Math.sin(a) * r, by - Math.cos(a) * r);
    }
    p.closePath();
  }
  return p;
}

/** Veins as one path in the unit box. */
function veins(kind: Kind): Path2D {
  const p = new Path2D();
  if (kind === "maple") {
    for (const a of [0, 0.9, -0.9, 1.85, -1.85]) {
      const len = a === 0 ? 0.6 : Math.abs(a) < 1 ? 0.58 : 0.4;
      p.moveTo(0, 0.12);
      p.quadraticCurveTo(
        Math.sin(a) * len * 0.45,
        0.12 - Math.cos(a) * len * 0.5,
        Math.sin(a) * len,
        0.08 - Math.cos(a) * len,
      );
      for (let k = 1; k <= 3; k++) {
        const f = k / 4;
        const x = Math.sin(a) * len * f;
        const y = 0.1 - Math.cos(a) * len * f;
        p.moveTo(x, y);
        p.lineTo(x + Math.sin(a + 0.7) * 0.08, y - Math.cos(a + 0.7) * 0.08);
        p.moveTo(x, y);
        p.lineTo(x + Math.sin(a - 0.7) * 0.08, y - Math.cos(a - 0.7) * 0.08);
      }
    }
  } else if (kind === "oak") {
    p.moveTo(0, 0.46);
    p.lineTo(0, -0.43);
    for (let k = 0; k < 5; k++) {
      const y = 0.3 - k * 0.17;
      p.moveTo(0, y);
      p.quadraticCurveTo(0.08, y - 0.04, 0.2, y - 0.1);
      p.moveTo(0, y + 0.05);
      p.quadraticCurveTo(-0.08, y + 0.01, -0.2, y - 0.06);
    }
  } else {
    for (let k = 0; k <= 14; k++) {
      const a = -1.05 + (2.1 * k) / 14;
      p.moveTo(0, 0.42);
      p.lineTo(Math.sin(a) * 0.74, 0.42 - Math.cos(a) * 0.74);
    }
  }
  return p;
}

const sprites = new Map<string, AnyCanvas>();
/** One leaf, lit or from behind, optionally out of focus. Built once per theme. */
function sprite(kind: Kind, color: string, theme: Theme, back: boolean, blur: number): AnyCanvas {
  const key = `${kind}|${color}|${theme.ink}|${theme.bg}|${back}|${blur}`;
  let c = sprites.get(key);
  if (c) return c;
  c = makeCanvas(S, S);
  const g = context(c);
  const pad = blur > 0 ? S * 0.12 : S * 0.04;
  const k = S - pad * 2;
  g.save();
  if (blur > 0) g.filter = `blur(${blur.toFixed(1)}px)`;
  g.translate(S / 2, S / 2);
  g.scale(k, k);
  g.scale(FIT[kind][0], FIT[kind][0]);
  g.translate(0, FIT[kind][1]);
  const shape = outline(kind);
  const face = back ? mix(mix(color, theme.ink, 0.22), theme.bg, 0.32) : color;
  const grad = g.createRadialGradient(0, 0.12, 0.02, 0, 0, 0.62);
  grad.addColorStop(0, mix(face, theme.ink, back ? 0.08 : 0.2));
  grad.addColorStop(0.55, face);
  grad.addColorStop(1, mix(face, theme.bg, 0.35));
  g.fillStyle = grad;
  g.fill(shape);
  g.save();
  g.clip(shape);
  // Blemishes and speckle.
  const r = rng(KINDS.indexOf(kind) * 91 + (back ? 7 : 0) + 3);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = rgba(mix(face, theme.bg, 0.55), 0.08 + r() * 0.22);
    g.beginPath();
    g.arc(r() - 0.5, r() - 0.5, 0.004 + r() * r() * 0.03, 0, TAU);
    g.fill();
  }
  g.restore();
  g.lineCap = "round";
  g.strokeStyle = rgba(
    back ? mix(face, theme.ink, 0.3) : mix(face, theme.ink, 0.42),
    back ? 0.55 : 0.5,
  );
  g.lineWidth = kind === "ginkgo" ? 0.004 : 0.009;
  g.stroke(veins(kind));
  g.strokeStyle = rgba(mix(face, theme.bg, 0.5), 0.8);
  g.lineWidth = 0.008;
  g.stroke(shape);
  // Stem.
  g.strokeStyle = mix(face, theme.bg, 0.3);
  g.lineWidth = 0.014;
  g.beginPath();
  g.moveTo(0, STEM[kind]);
  g.quadraticCurveTo(0.02, STEM[kind] + 0.07, 0.05, STEM[kind] + 0.14);
  g.stroke();
  g.restore();
  sprites.set(key, c);
  if (sprites.size > 90) sprites.delete(sprites.keys().next().value as string);
  return c;
}

interface Leaf {
  kind: Kind;
  tone: number;
  layer: 0 | 1 | 2;
  x: number;
  y: number;
  size: number;
  fall: number;
  sway: number;
  swayK: number;
  spin: number;
  flipK: number;
  seed: number;
}

/** The cast: far, middle and near leaves, from seeded hashes. */
const LEAVES: Leaf[] = (() => {
  const out: Leaf[] = [];
  const add = (n: number, layer: 0 | 1 | 2, base: number) => {
    for (let i = 0; i < n; i++) {
      const s = base + i;
      out.push({
        kind: KINDS[Math.floor(hash(s, 1) * 3)],
        tone: Math.floor(hash(s, 2) * 3),
        layer,
        x: (i + 0.2 + 0.6 * hash(s, 3)) / n,
        y: hash(s, 4),
        size:
          layer === 0
            ? 0.07 + 0.03 * hash(s, 5)
            : layer === 1
              ? 0.15 + 0.08 * hash(s, 5)
              : 0.34 + 0.08 * hash(s, 5),
        fall: layer === 2 ? 2 : 1,
        sway: 0.03 + 0.05 * hash(s, 6),
        swayK: 1 + Math.floor(hash(s, 7) * 3),
        spin: Math.floor(hash(s, 8) * 3) - 1,
        flipK: 1 + Math.floor(hash(s, 9) * 2),
        seed: s,
      });
    }
  };
  add(10, 0, 100);
  add(11, 1, 200);
  add(2, 2, 300);
  return out;
})();

function drawLeaf(
  ctx: Ctx2D,
  leaf: Leaf,
  t: number,
  theme: Theme,
  w: number,
  h: number,
  u: number,
) {
  const size = leaf.size * u;
  const m = size * 0.8;
  const q = cyc(t, leaf.fall, leaf.y);
  const y = -m + (h + m * 2) * q;
  const swing = turn(t, leaf.swayK, hash(leaf.seed, 10));
  const x = leaf.x * w + Math.sin(swing) * leaf.sway * u * (leaf.layer === 2 ? 2.2 : 1.4);
  // The leaf banks into each swing, spins whole turns, and tumbles over.
  const bank = Math.cos(swing) * 0.55;
  const rot = bank + turn(t, leaf.spin, hash(leaf.seed, 11)) + hash(leaf.seed, 12) * TAU;
  const flip = Math.cos(turn(t, leaf.flipK, hash(leaf.seed, 13)));
  const back = flip < 0;
  const tones = [theme.accent, theme.accent2, mix(theme.accent, theme.accent2, 0.5)];
  const blur = leaf.layer === 2 ? Math.round(S * 0.05) : leaf.layer === 0 ? 2 : 0;
  const img = sprite(leaf.kind, tones[leaf.tone], theme, back, blur);
  if (leaf.layer === 1) {
    // Warm light glowing through the leaf.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    blit(ctx, glow(tones[leaf.tone], 0.25), x, y, size * 2.2, 0.16);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(Math.max(0.08, Math.abs(flip)), 0.82 + 0.18 * Math.abs(Math.sin(swing)));
  ctx.globalAlpha = leaf.layer === 0 ? 0.42 : leaf.layer === 2 ? 0.88 : 1;
  ctx.drawImage(img as CanvasImageSource, -size / 2, -size / 2, size, size);
  ctx.restore();
}

export const style: MotionStyle = {
  id: "falling-leaves",
  name: "Autumn Fall",
  family: "Nature",
  tagline: "Leaves tumbling through window light",
  look: "Maple, oak and ginkgo leaves tumbling through warm window light around one quiet serif word, near leaves soft with depth.",
  move: "Every leaf falls in a lazy pendulum, banking into each swing and flipping to show its paler back; near leaves sweep past out of focus.",
  rules: [
    "Real leaf shapes with veins and blemishes: maple, oak, ginkgo.",
    "Falling leaves swing like pendulums and bank into the swing.",
    "A flip shows the paler back of the leaf, never a mirror of the front.",
    "Three depths: small dim leaves behind the word, sharp ones around it, soft ones in front.",
    "One warm light pool; the ground stays near black.",
    "The word is set once, large and still; leaves pass in front and behind.",
  ],
  prompt: `R — References
• Autumn still-life photography: backlit maple, oak and ginkgo leaves against black.
• Editorial type covers where objects pass in front of and behind a serif headline.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): the word "{{name}}" sits large in {{font}} in a pool of warm light; small leaves drift down behind it.
• Middle (1.5–3.5 s): leaves tumble past the word, swinging side to side and flipping to show their paler backs; two big out-of-focus leaves sweep across the front.
• End (3.5–5 s): the last leaves fall out of the frame as new ones enter from the top, landing exactly on the first frame.

S — Style
Looks: {{bg}} ground with a warm light pool; leaves in {{accent}}, {{accent2}} and a blend of both, with veins, blemishes and a darker edge; the word in {{ink}}.
Moves: each leaf falls a whole number of frame heights per loop; the sway, spin and flip are whole-cycle sines; near leaves blurred, far leaves small and dim.
Rules:
1. Real leaf silhouettes with veins.
2. Pendulum fall that banks into the swing.
3. Flips show the paler back.
4. Three depths: behind, around and in front of the word.
5. One warm light; near-black ground; grain.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the leaf shapes are recognisable at tile size; no leaf covers the whole word for long; the word's descenders are not clipped; the near leaves are soft, not jagged. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Autumn_leaf_color",
  theme: {
    bg: "#0d0a08",
    ink: "#f3e9dc",
    accent: "#dc5a2a",
    accent2: "#d9a23c",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..600"],
  tags: [
    "autumn",
    "fall",
    "leaves",
    "leaf",
    "maple",
    "seasonal",
    "warm",
    "nature",
    "editorial",
    "cosy",
  ],
  word: "Autumn",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(`leaf-ground:${theme.bg}${theme.accent}`, w, h, (c, W, H) =>
        mottled(c, W, H, theme.bg, theme.accent, 0.03, 5, 0.018),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.32, h * 0.18, u * 1.1, theme.accent2, 0.11);
    light(ctx, w * 0.5, h * 0.5, u * 0.6, theme.accent, 0.05);

    for (const leaf of LEAVES) if (leaf.layer === 0) drawLeaf(ctx, leaf, t, theme, w, h, u);

    // The word, large and still.
    const word = wordFor(theme.name, "Autumn", 12);
    const size = fitSize(
      ctx,
      word,
      w * (portrait ? 0.8 : 0.6),
      u * (portrait ? 0.26 : 0.3),
      500,
      theme.font,
      SERIF,
    );
    ctx.font = font(500, size, theme.font, SERIF);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(theme.ink, 0.94);
    ctx.fillText(word, w / 2, h * (portrait ? 0.46 : 0.5));
    const mark = tintedLogo(theme, rgba(theme.ink, 0.9), u * 0.07, u * 0.07);
    if (mark)
      ctx.drawImage(
        mark as CanvasImageSource,
        w / 2 - u * 0.035,
        h * (portrait ? 0.46 : 0.5) + size * 0.62,
        u * 0.07,
        u * 0.07,
      );

    for (const leaf of LEAVES) if (leaf.layer === 1) drawLeaf(ctx, leaf, t, theme, w, h, u);
    for (const leaf of LEAVES) if (leaf.layer === 2) drawLeaf(ctx, leaf, t, theme, w, h, u);

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
