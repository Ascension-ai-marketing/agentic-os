import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  clamp,
  context,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  makeCanvas,
  noise3,
  rng,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  fibres,
  fieldTile,
  frameIndex,
  mottle,
  noiseTile,
  ribbon,
  sampleField,
  type Pt,
} from "./_s2-helpers";

/**
 * Shan shui in silver ink on indigo-black paper: five ridges washed from a
 * dense crest into mist, a waterfall, pines, a lantern boat on the lake.
 * Mist veils drift, birds cross once, the lantern breathes.
 */
type Peak = [number, number, number, number]; // x (0..1), height (share of h), width (share of w), roundness
type Layer = {
  base: number;
  peaks: Peak[];
  tone: number;
  wash: number;
  rough: number;
  seed: number;
};

function layers(portrait: boolean): Layer[] {
  if (portrait)
    return [
      {
        base: 0.52,
        peaks: [
          [0.3, 0.1, 0.5, 0.6],
          [0.8, 0.12, 0.4, 0.5],
        ],
        tone: 0.18,
        wash: 0.1,
        rough: 0.012,
        seed: 1,
      },
      {
        base: 0.56,
        peaks: [
          [0.72, 0.3, 0.26, 0.7],
          [0.18, 0.2, 0.3, 0.6],
        ],
        tone: 0.3,
        wash: 0.12,
        rough: 0.015,
        seed: 2,
      },
      {
        base: 0.64,
        peaks: [
          [0.4, 0.46, 0.22, 0.85],
          [0.58, 0.36, 0.18, 0.8],
          [0.25, 0.28, 0.16, 0.7],
        ],
        tone: 0.5,
        wash: 0.16,
        rough: 0.02,
        seed: 3,
      },
      {
        base: 0.74,
        peaks: [
          [0.85, 0.3, 0.3, 0.7],
          [0.62, 0.18, 0.2, 0.6],
        ],
        tone: 0.66,
        wash: 0.1,
        rough: 0.02,
        seed: 4,
      },
      {
        base: 0.8,
        peaks: [
          [0.02, 0.38, 0.3, 0.75],
          [0.3, 0.14, 0.2, 0.6],
        ],
        tone: 0.88,
        wash: 0.09,
        rough: 0.025,
        seed: 5,
      },
    ];
  return [
    {
      base: 0.58,
      peaks: [
        [0.2, 0.08, 0.35, 0.6],
        [0.6, 0.1, 0.3, 0.5],
        [0.9, 0.07, 0.3, 0.5],
      ],
      tone: 0.18,
      wash: 0.12,
      rough: 0.01,
      seed: 1,
    },
    {
      base: 0.62,
      peaks: [
        [0.72, 0.36, 0.14, 0.7],
        [0.84, 0.26, 0.12, 0.6],
        [0.12, 0.18, 0.2, 0.6],
      ],
      tone: 0.3,
      wash: 0.14,
      rough: 0.014,
      seed: 2,
    },
    {
      base: 0.68,
      peaks: [
        [0.36, 0.56, 0.1, 0.85],
        [0.46, 0.44, 0.09, 0.8],
        [0.27, 0.36, 0.08, 0.75],
        [0.56, 0.3, 0.1, 0.7],
      ],
      tone: 0.52,
      wash: 0.2,
      rough: 0.02,
      seed: 3,
    },
    {
      base: 0.78,
      peaks: [
        [0.78, 0.36, 0.13, 0.75],
        [0.92, 0.26, 0.1, 0.7],
        [0.64, 0.16, 0.12, 0.6],
      ],
      tone: 0.66,
      wash: 0.12,
      rough: 0.02,
      seed: 4,
    },
    {
      base: 0.84,
      peaks: [
        [0.04, 0.5, 0.12, 0.8],
        [0.14, 0.3, 0.1, 0.7],
        [0.22, 0.14, 0.1, 0.6],
      ],
      tone: 0.9,
      wash: 0.1,
      rough: 0.025,
      seed: 5,
    },
  ];
}

/** Ridge height (canvas y) of a layer at canvas x. */
function ridge(L: Layer, x: number, w: number, h: number) {
  const k = x / w;
  let lift = 0;
  for (const [px, ph, pw, round] of L.peaks) {
    const d = (k - px) / pw;
    // A rounded crest with steep flanks: shan shui peaks, not triangles.
    const bump = Math.exp(-Math.pow(Math.abs(d), 1.6 + round) * 2.2);
    lift = Math.max(lift, ph * bump) + ph * bump * 0.08;
  }
  const rough = L.rough * (noise3(k * 9, L.seed, 0.3) + 0.5 * noise3(k * 31, L.seed, 1.7));
  // Rock: ledges and knuckles grow with the height of the peak.
  const rock =
    lift * (0.09 * noise3(k * 24, L.seed + 3, 2.2) + 0.05 * noise3(k * 60, L.seed + 7, 4.1));
  return h * (L.base - lift - rough - rock);
}

/** A ridge layer, baked: mist fill that hides what is behind, then the wash, bone line, texture strokes, moss dots. */
function drawLayer(c: Ctx2D, L: Layer, theme: Theme, w: number, h: number, li: number) {
  const { u } = frameOf(w, h);
  const colour = mix(mix(theme.accent2, theme.ink, 0.25), theme.ink, L.tone);
  const step = Math.max(1, Math.round(w / 480));
  const ys: number[] = [];
  for (let x = 0; x <= w + step; x += step) ys.push(ridge(L, x, w, h));
  // Mist: the layer's body is the paper colour, so nearer ridges hide farther ones.
  c.save();
  c.beginPath();
  c.moveTo(0, h);
  ys.forEach((y, i) => c.lineTo(i * step, y));
  c.lineTo(w, h);
  c.closePath();
  c.fillStyle = rgba(theme.bg, 0.94);
  c.fill();
  c.clip();
  // The wash: dense at the crest, dissolving downward, streaked by the brush.
  const bw = Math.max(8, Math.round(w / 2));
  const bh = Math.max(8, Math.round(h / 2));
  const img = c.createImageData(bw, bh);
  const [cr, cg, cb] = parse(colour);
  const tex = fieldTile(700 + li, 256, 8, 4);
  const washLen = h * L.wash;
  // Moonlight from the upper left: flanks facing it wash paler (brighter here).
  const lit = ys.map((_, i) => {
    const a = ys[Math.max(0, i - 3)];
    const b = ys[Math.min(ys.length - 1, i + 3)];
    const slope = (b - a) / (6 * step);
    return 0.5 - 0.5 * Math.tanh(slope * 2.2);
  });
  for (let j = 0; j < bh; j++)
    for (let i = 0; i < bw; i++) {
      const x = ((i + 0.5) * w) / bw;
      const y = ((j + 0.5) * h) / bh;
      const ci = Math.min(ys.length - 1, Math.round(x / step));
      const r = ys[ci];
      if (y < r - 2) continue;
      const depth = Math.max(0, y - r) / washLen;
      // The brush drags down the slope: vertical streaks, soft blots.
      const streak = 0.7 * sampleField(tex, 256, (x / u) * 300, (y / u) * 30);
      const blot = sampleField(tex, 256, (x / u) * 70 + 50, (y / u) * 70);
      const side = 0.35 + 0.9 * lit[ci];
      let d = Math.exp(-depth * (1.6 + 1.2 * (1 - lit[ci]))) * (0.62 + 0.45 * streak) * side;
      d += 0.22 * Math.exp(-depth * 10) * side;
      d *= 0.8 + 0.35 * blot;
      const a = clamp(d * (0.34 + 0.72 * L.tone));
      const o = (j * bw + i) * 4;
      img.data[o] = cr;
      img.data[o + 1] = cg;
      img.data[o + 2] = cb;
      img.data[o + 3] = Math.round(a * 255);
    }
  const cv = makeCanvas(bw, bh);
  context(cv).putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true;
  c.drawImage(cv as CanvasImageSource, 0, 0, w, h);
  c.restore();
  // Bone line: the crest in denser ink, thin, breaking up like a dry brush.
  c.save();
  const r = rng(90 + li);
  let start = 0;
  while (start < ys.length - 2) {
    const len = 10 + Math.floor(r() * 40);
    const end = Math.min(ys.length - 1, start + len);
    const pts: Pt[] = [];
    for (let i = start; i <= end; i++) pts.push([i * step, ys[i] + u * 0.0015]);
    const litHere =
      0.5 - 0.5 * Math.tanh(((ys[end] - ys[start]) / ((end - start) * step || 1)) * 2.2);
    c.fillStyle = rgba(colour, (0.25 + 0.5 * L.tone) * (0.4 + 0.6 * litHere));
    const wBase = u * (0.0012 + 0.003 * L.tone) * (0.5 + r() * 0.8);
    ribbon(c, pts, (k) => wBase * (0.2 + 0.8 * Math.sin(k * Math.PI)));
    start = end + 2 + Math.floor(r() * 14);
  }
  // Texture strokes (cun): short, curved hemp-fibre strokes on the lit flanks.
  if (L.tone > 0.45 && L.tone < 0.85) {
    c.lineCap = "round";
    const n = Math.round(70 * L.tone);
    for (let i = 0; i < n; i++) {
      const xi = Math.floor(r() * (ys.length - 7)) + 3;
      const slope = (ys[xi + 3] - ys[xi - 3]) / (6 * step);
      if (slope > 0.15 && r() < 0.7) continue;
      const x = xi * step;
      const y0 = ys[xi] + u * (0.008 + r() * 0.07);
      const len = u * (0.012 + r() * 0.024);
      const dir = Math.PI / 2 + Math.atan(slope) * 0.5 + (r() - 0.5) * 0.35;
      c.strokeStyle = rgba(colour, 0.1 + 0.2 * r());
      c.lineWidth = u * (0.0012 + r() * 0.0018);
      c.beginPath();
      c.moveTo(x, y0);
      c.quadraticCurveTo(
        x + Math.cos(dir) * len * 0.5 + u * 0.003,
        y0 + Math.sin(dir) * len * 0.5,
        x + Math.cos(dir) * len,
        y0 + Math.sin(dir) * len,
      );
      c.stroke();
    }
    for (let i = 0; i < 26 * L.tone; i++) {
      const xi = Math.floor(r() * (ys.length - 1));
      const x = xi * step + (r() - 0.5) * u * 0.01;
      const y = ys[xi] - u * 0.002 + r() * u * 0.008;
      c.fillStyle = rgba(colour, 0.35 + 0.4 * r());
      c.beginPath();
      c.ellipse(x, y, u * (0.0015 + r() * 0.0025), u * (0.001 + r() * 0.0015), r() * 3, 0, TAU);
      c.fill();
    }
  }
  c.restore();
}

/** Two pines on the near cliff: trunk and needle clusters in quick strokes. */
function pines(c: Ctx2D, theme: Theme, w: number, h: number, near: Layer) {
  const { u } = frameOf(w, h);
  const colour = theme.ink;
  const r = rng(515);
  for (const [px, s] of [
    [0.1, 1],
    [0.17, 0.75],
  ] as [number, number][]) {
    const x0 = w * px;
    const y0 = ridge(near, x0, w, h) + u * 0.005;
    const H = u * 0.2 * s;
    const trunk: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      trunk.push([x0 + Math.sin(k * 3.2) * u * 0.02 * s, y0 - H * k]);
    }
    c.fillStyle = rgba(colour, 0.85);
    ribbon(c, trunk, (k) => u * 0.009 * s * (1 - k * 0.7));
    for (let b = 0; b < 5; b++) {
      const k = 0.35 + b * 0.15;
      const [bx, by] = trunk[Math.round(k * 10)];
      const side = b % 2 ? 1 : -1;
      const L = u * (0.05 + r() * 0.04) * s * (1.2 - k * 0.6);
      c.strokeStyle = rgba(colour, 0.7);
      c.lineWidth = u * 0.003 * s;
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx + side * L, by - L * 0.15);
      c.stroke();
      // Needle cluster: a fan of short strokes radiating up from the branch tip.
      const fx = bx + side * L * 0.95;
      const fy = by - L * 0.18;
      for (let q = 0; q < 11; q++) {
        const a = -Math.PI + 0.25 + (q / 10) * (Math.PI - 0.5);
        const nl = u * (0.018 + r() * 0.008) * s;
        c.strokeStyle = rgba(colour, 0.55 + r() * 0.35);
        c.lineWidth = u * 0.0018 * s;
        c.beginPath();
        c.moveTo(fx, fy);
        c.lineTo(fx + Math.cos(a) * nl, fy + Math.sin(a) * nl * 0.7);
        c.stroke();
      }
    }
  }
}

function scene(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u, portrait } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.01, 0.02, u * 0.35, u / 110, 6.6);
    fibres(c, w, h, u, theme.ink, 220, 6262, 0.03, 0.05);
    // Moonlit sky wash at the top, very faint.
    const sky = c.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, rgba(mix(theme.accent2, theme.ink, 0.3), 0.06));
    sky.addColorStop(1, rgba(theme.accent2, 0));
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h * 0.6);
    const Ls = layers(portrait);
    Ls.forEach((L, i) => drawLayer(c, L, theme, w, h, i));
    pines(c, theme, w, h, Ls[4]);
    // The lake: faint horizontal ripple strokes.
    const lakeTop = h * (portrait ? 0.82 : 0.86);
    const r = rng(8181);
    c.lineCap = "round";
    for (let i = 0; i < 60; i++) {
      const y = lakeTop + (h - lakeTop) * Math.pow(r(), 0.8);
      const x = r() * w;
      const len = u * (0.04 + r() * 0.12);
      c.strokeStyle = rgba(theme.ink, 0.05 + r() * 0.08);
      c.lineWidth = Math.max(1, u * 0.0018);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + len, y);
      c.stroke();
    }
  };
}

export const style: MotionStyle = {
  id: "ink-wash-landscape",
  name: "Ink Wash Mountains",
  family: "Paint & Draw",
  tagline: "Misty ridges in silver ink",
  look: "Shan shui in silver ink on indigo-black: five ridges washed from dense crests into mist, a waterfall, pines, a lantern boat.",
  move: "Mist veils drift through the valleys, the waterfall runs, three birds cross once, the boat rocks and its lantern breathes on the water.",
  rules: [
    "Depth is ink density: far ridges pale and cool, near ridges dense and bright.",
    "Every ridge dissolves downward into mist; nothing has a hard bottom edge.",
    "Crests carry a bone line that breaks up like a dry brush.",
    "Near faces get texture strokes and moss dots; far ones stay washes.",
    "One warm light only: the lantern and its reflection.",
    "Motion is slow and small: mist, water, birds, a breath of light.",
    "Leave the sky and the valleys empty; the mist is the subject too.",
  ],
  prompt: `R — References
• Chinese shan shui scroll painting (search: shan shui ink painting, Guo Xi Early Spring, cun texture strokes).
• Gold or silver ink on indigo paper (konshi kindei) for the inverted palette.

I — Idea
One view, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): layered peaks rise out of mist above a still lake; a small boat with a lantern sits in the foreground.
• Middle (1.5–3.5 s): mist veils drift through the valleys, the waterfall runs, three birds cross the sky, the lantern's reflection shivers.
• End (3.5–5 s): the birds leave the frame and the mist settles back to where it began.

S — Style
Looks: {{bg}} paper with fibres; ridges in {{ink}} ink cooled toward {{accent2}} with distance; bone lines, texture strokes and moss dots on the near ridges; one {{accent}} lantern; "{{name}}" as a small vertical inscription in {{font}}.
Moves: two mist layers drift with a seamless crossfade; the waterfall texture scrolls one period per loop; birds cross once; the boat rocks on a slow sine; the lantern breathes.
Rules:
1. Density = depth.
2. Every ridge fades downward into mist.
3. Dry-brush bone lines on crests.
4. Texture strokes only on near faces.
5. One warm light.
6. Slow, small motion; generous empty sky.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the ridges read as five distinct depths; no ridge has a hard bottom edge; the lantern is the only warm colour; the inscription is crisp and not clipped. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Shan_shui",
  theme: {
    bg: "#0b0e15",
    ink: "#e9e5da",
    accent: "#f2a649",
    accent2: "#8aa0bb",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..700"],
  tags: [
    "ink",
    "wash",
    "shan shui",
    "chinese",
    "landscape",
    "mountains",
    "mist",
    "fog",
    "calm",
    "zen",
    "painting",
  ],
  word: "Mountains",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const key = `${theme.bg}${theme.ink}${theme.accent2}`;
    ctx.drawImage(bake(`inkwash-scene:${key}`, w, h, scene(theme)) as CanvasImageSource, 0, 0);
    const Ls = layers(portrait);
    const frame = frameIndex(t, 12);
    // Moonlight behind the peaks.
    light(
      ctx,
      w * (portrait ? 0.4 : 0.34),
      h * 0.16,
      u * 0.95,
      mix(theme.accent2, theme.ink, 0.4),
      0.13,
    );
    const ph = t / LOOP;

    // Waterfall down the fourth ridge: a pale thread with texture running down.
    const wfx = w * (portrait ? 0.78 : 0.8);
    const wfTop = ridge(Ls[3], wfx, w, h) + u * 0.02;
    const wfBottom = h * (portrait ? 0.82 : 0.86);
    ctx.save();
    const wfw = u * 0.016;
    const tile = noiseTile(911, 256, 16, 3, 1.3, 0.55, theme.ink);
    const pat = ctx.createPattern(tile as CanvasImageSource, "repeat");
    if (pat) {
      const scaleY = 6;
      const period = 256 * scaleY * (u / 900);
      if (typeof DOMMatrix !== "undefined")
        pat.setTransform(
          new DOMMatrix()
            .translateSelf(wfx, wfTop + period * ph)
            .scaleSelf(u / 900 / 2, scaleY * (u / 900)),
        );
      const g = ctx.createLinearGradient(0, wfTop, 0, wfBottom);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.15, "rgba(0,0,0,1)");
      g.addColorStop(0.85, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.5;
      ctx.filter = `blur(${(u * 0.0015).toFixed(2)}px)`;
      ctx.fillStyle = pat;
      ctx.fillRect(wfx - wfw / 2, wfTop, wfw, wfBottom - wfTop);
    }
    ctx.restore();
    light(ctx, wfx, (wfTop + wfBottom) / 2, u * 0.06, theme.ink, 0.07);
    // Spray where the fall meets the water, churning on twos.
    for (let i = 0; i < 14; i++) {
      const a = hash(i, frame, 21) * Math.PI;
      const d = u * 0.03 * hash(i, frame, 23);
      ctx.fillStyle = rgba(theme.ink, 0.25 * hash(i, 29));
      ctx.beginPath();
      ctx.arc(wfx + Math.cos(a) * d * 1.6, wfBottom - Math.sin(a) * d * 0.6, u * 0.003, 0, TAU);
      ctx.fill();
    }
    light(ctx, wfx, wfBottom, u * 0.09, theme.ink, 0.1);

    // Mist veils: two noise layers drifting with a seamless crossfade.
    const veil = noiseTile(933, 256, 3, 4, 1.4, 0.1, mix(theme.ink, theme.accent2, 0.4));
    for (const [yk, dir, alpha, drift] of [
      [0.5, 1, 0.3, 0.09],
      [0.7, -1, 0.34, 0.12],
    ] as [number, number, number, number][]) {
      const band = h * 0.2;
      const y0 = h * (portrait ? yk - 0.04 : yk) - band / 2;
      for (const off of [0, 0.5]) {
        const f = (ph + off) % 1;
        const weight = 1 - Math.abs(2 * f - 1);
        const p2 = ctx.createPattern(veil as CanvasImageSource, "repeat");
        if (!p2) continue;
        const sc = (u / 256) * 1.2;
        if (typeof DOMMatrix !== "undefined")
          p2.setTransform(
            new DOMMatrix()
              .translateSelf(dir * f * w * drift + off * 97, y0)
              .scaleSelf(sc * 1.8, sc * 0.5),
          );
        // Fade the band in and out vertically, strip by strip.
        const strips = 14;
        ctx.save();
        ctx.fillStyle = p2;
        for (let sI = 0; sI < strips; sI++) {
          const k = (sI + 0.5) / strips;
          ctx.globalAlpha = alpha * weight * Math.sin(k * Math.PI) ** 2;
          ctx.fillRect(0, y0 + (band * sI) / strips, w, band / strips + 1);
        }
        ctx.restore();
      }
    }

    // The boat and its lantern, rocking; the reflection shivers on twos.
    const bx = w * (portrait ? 0.56 : 0.6);
    const by = h * (portrait ? 0.9 : 0.915);
    const rock = Math.sin(TAU * ph) * 0.05;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(rock);
    const bs = u * 0.1;
    ctx.fillStyle = rgba(theme.ink, 0.9);
    const hull: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      hull.push([
        -bs + k * bs * 2,
        Math.sin(k * Math.PI) * bs * 0.1 - Math.pow(Math.abs(k - 0.5) * 2, 3) * bs * 0.12,
      ]);
    }
    ribbon(ctx, hull, (k) => bs * 0.07 * (0.4 + 0.6 * Math.sin(k * Math.PI)));
    // A sampan canopy arched over the middle of the hull.
    ctx.beginPath();
    ctx.moveTo(-bs * 0.42, -bs * 0.04);
    ctx.bezierCurveTo(-bs * 0.42, -bs * 0.34, bs * 0.3, -bs * 0.34, bs * 0.3, -bs * 0.04);
    ctx.lineTo(bs * 0.22, -bs * 0.04);
    ctx.bezierCurveTo(bs * 0.22, -bs * 0.25, -bs * 0.34, -bs * 0.25, -bs * 0.34, -bs * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(theme.ink, 0.35);
    ctx.beginPath();
    ctx.moveTo(-bs * 0.34, -bs * 0.04);
    ctx.bezierCurveTo(-bs * 0.34, -bs * 0.25, bs * 0.22, -bs * 0.25, bs * 0.22, -bs * 0.04);
    ctx.closePath();
    ctx.fill();
    // Pole and lantern.
    ctx.strokeStyle = rgba(theme.ink, 0.8);
    ctx.lineWidth = u * 0.0025;
    ctx.beginPath();
    ctx.moveTo(bs * 0.5, -bs * 0.03);
    ctx.lineTo(bs * 0.62, -bs * 0.5);
    ctx.stroke();
    ctx.restore();
    const lx = bx + Math.cos(rock) * bs * 0.62 + Math.sin(rock) * bs * 0.5;
    const ly = by - bs * 0.46 + Math.sin(rock) * bs * 0.62;
    const breath = 0.85 + 0.15 * Math.sin(TAU * 2 * ph);
    light(ctx, lx, ly, u * 0.14 * breath, theme.accent, 0.35);
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.ellipse(lx, ly, u * 0.007, u * 0.009, 0, 0, TAU);
    ctx.fill();
    // Reflection: broken amber streaks under the lantern.
    for (let i = 0; i < 9; i++) {
      const yy = by + u * 0.02 + i * u * 0.012;
      const jitter = (hash(i, frame, 3) - 0.5) * u * 0.02;
      const len = u * (0.03 - i * 0.0022) * (0.6 + 0.8 * hash(i, frame, 5));
      ctx.strokeStyle = rgba(theme.accent, (0.5 - i * 0.045) * breath);
      ctx.lineWidth = u * 0.004;
      ctx.beginPath();
      ctx.moveTo(lx - len / 2 + jitter, yy);
      ctx.lineTo(lx + len / 2 + jitter, yy);
      ctx.stroke();
    }

    // Birds: three quick strokes crossing once, off-frame at the seam.
    for (let i = 0; i < 3; i++) {
      const k = ((ph + i * 0.04) % 1) * 1.3 - 0.15;
      const x = w * (1.05 - k);
      const y = h * (0.2 + i * 0.03) + Math.sin(k * 7 + i) * u * 0.02;
      const flap = Math.sin(TAU * (ph * 10 + i * 0.3));
      const s = u * 0.016;
      ctx.strokeStyle = rgba(theme.ink, 0.85);
      ctx.lineWidth = u * 0.0028;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - s, y - s * 0.4 * flap);
      ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.5 * flap - s * 0.2, x, y);
      ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.5 * flap - s * 0.2, x + s, y - s * 0.4 * flap);
      ctx.stroke();
    }

    // The inscription: a vertical line of type in the empty sky.
    const word = wordFor(theme.name, "Mountains", 12);
    const size = u * 0.036;
    ctx.save();
    ctx.translate(w - u * (portrait ? 0.08 : 0.1), h * 0.09);
    ctx.rotate(Math.PI / 2);
    ctx.font = font(500, size, theme.font, '"Newsreader", Georgia, serif');
    const c2 = ctx as CanvasRenderingContext2D;
    if ("letterSpacing" in c2) c2.letterSpacing = `${(size * 0.3).toFixed(1)}px`;
    ctx.fillStyle = rgba(theme.ink, 0.78);
    ctx.textBaseline = "middle";
    ctx.fillText(word.toUpperCase(), 0, 0);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
