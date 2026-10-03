import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  fbm3,
  fitSize,
  font,
  frameOf,
  grain,
  ground,
  hash,
  lerp,
  LOOP,
  makeCanvas,
  context,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

type Pt = [number, number];
const HAND = '"Caveat Brush", "Comic Sans MS", cursive';

let toothTile: AnyCanvas | null = null;
/** Paper tooth: speckles that wax skips over. Static, so gaps never crawl. */
function tooth(): AnyCanvas {
  if (toothTile) return toothTile;
  const size = 256;
  const c = makeCanvas(size, size);
  const g = context(c);
  const r = rng(515);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,0,${(0.35 + r() * 0.65).toFixed(3)})`;
    const s = 0.6 + r() * r() * 2.6;
    g.fillRect(r() * size, r() * size, s, s * (0.6 + r()));
  }
  toothTile = c;
  return c;
}

function blackPaper(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const step = Math.max(2, Math.round(u / 220));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.02), y / (u * 0.02), 9.3, 2);
        c.fillStyle = n > 0 ? rgba(theme.ink, 0.025 * n) : rgba("#000000", -0.2 * n);
        c.fillRect(x, y, step, step);
      }
  };
}

/** Hand-drawn line boil: points shift a little 12 times a second. */
function boil(pts: Pt[], t: number, amp: number, seed: number): Pt[] {
  const frame = Math.floor((((t % LOOP) + LOOP) % LOOP) * 12 + 1e-6) % 60;
  return pts.map(([x, y], i) => [
    x + (hash(i, frame, seed) - 0.5) * amp,
    y + (hash(i, frame, seed + 7) - 0.5) * amp,
  ]);
}

function strokeUpTo(c: Ctx2D, pts: Pt[], p: number) {
  if (p <= 0 || pts.length < 2) return;
  const n = (pts.length - 1) * clamp(p);
  const whole = Math.floor(n);
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= whole; i++) c.lineTo(pts[i][0], pts[i][1]);
  if (whole < pts.length - 1) {
    const f = n - whole;
    const a = pts[whole];
    const b = pts[whole + 1];
    c.lineTo(lerp(a[0], b[0], f), lerp(a[1], b[1], f));
  }
  c.stroke();
}

export const style: MotionStyle = {
  id: "crayon-marker",
  name: "Crayon & Marker",
  look: "Waxy crayon and felt marker on black construction paper: a handwritten word, a scribbled loop, an arrow, sparkles.",
  move: "The word writes itself, a marker underline swipes, a crayon loop and arrow scribble in, sparkles pop, lines boil, an eraser wipes.",
  rules: [
    "Crayon is waxy: the paper's tooth shows through every stroke.",
    "Lines boil at 12 fps: small, constant hand-drawn jitter.",
    "Write, don't fade: every mark is drawn along its path.",
    "Marker is flat and bright with streaks; crayon is grainy.",
    "Three colours plus white, never more.",
    "A loose, overshooting loop, never a perfect ellipse.",
    "The loop ends with an eraser wipe that leaves a faint smudge.",
  ],
  prompt: `R — References
• Crayon and oil pastel on black construction paper (search: crayon texture black paper, chalk pastel doodles).
• Hand-drawn explainer annotations: circled words, scribbled arrows, marker underlines.

I — Idea
One image, drawn by hand, 5 seconds, looping seamlessly:
• Beginning (0–1.6 s): the word "{{name}}" writes itself in white crayon; a yellow marker underline swipes under it.
• Middle (1.6–4.2 s): a coral crayon loop scribbles around the word, a blue arrow curls in to point at it, three sparkles pop; the lines keep boiling.
• End (4.2–5 s): an eraser wipes left to right, leaving only a faint smudge, which is the first frame.

S — Style
Looks: {{bg}} construction paper with visible tooth; {{ink}} crayon handwriting (Caveat Brush); a {{accent}} marker underline; a {{accent2}} arrow; waxy gaps everywhere the paper's tooth is high.
Moves: writing speed on the word (wipe along the baseline), strokes revealed along their length with ease-out, sparkles pop with overshoot, line boil at 12 fps, eraser wipe with a soft edge.
Rules:
1. Every crayon stroke shows the paper's tooth.
2. 12 fps line boil on everything drawn.
3. Marks are drawn along their path; nothing fades in.
4. Overshooting loops; hand-made arrowheads.
5. Three colours plus white.
6. Grain and a soft light falloff on the paper.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the texture reads as wax, not noise; the word is legible at thumbnail size; the arrow points at the word; nothing is clipped at the frame edge. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Crayon",
  theme: {
    bg: "#131212",
    ink: "#f4efe4",
    accent: "#ffd23f",
    accent2: "#6cc6ff",
    font: "Caveat Brush",
  },
  fonts: ["Caveat Brush"],
  tags: [
    "crayon",
    "marker",
    "doodle",
    "hand-drawn",
    "handdrawn",
    "sketch",
    "kids",
    "playful",
    "scribble",
    "annotation",
    "handwriting",
    "write",
    "writes",
    "fun",
  ],
  word: "hello!",
  family: "Paint & Draw",
  tagline: "Wax and marker on black paper",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(`crayon-paper:${theme.bg}${theme.ink}`, w, h, blackPaper(theme)) as CanvasImageSource,
      0,
      0,
    );

    const word = wordFor(theme.name, "hello!", 12);
    const coral = mix(theme.accent, "#ff5a5f", 0.75);
    const cx = w * (portrait ? 0.5 : 0.47);
    const cy = h * (portrait ? 0.5 : 0.54);
    const size = (() => {
      ctx.font = font(400, 100, "Caveat Brush", HAND);
      const m = ctx.measureText(word).width;
      return Math.min(h * (portrait ? 0.17 : 0.38), (w * (portrait ? 0.74 : 0.6) * 100) / m);
    })();
    ctx.font = font(400, size, "Caveat Brush", HAND);
    const ww = ctx.measureText(word).width;
    const x0 = cx - ww / 2;
    const base = cy + size * 0.28;

    // Paths (in pixels), built fresh each frame from the layout.
    const rx = ww * 0.62 + size * 0.2;
    const ry = size * 0.72;
    const loop: Pt[] = [];
    for (let i = 0; i <= 90; i++) {
      const a = -2.6 + (i / 90) * (TAU + 0.9);
      const wob = 1 + 0.05 * Math.sin(a * 3 + 1) + 0.04 * (i / 90);
      loop.push([cx + Math.cos(a) * rx * wob, cy - size * 0.05 + Math.sin(a) * ry * wob]);
    }
    const underline: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      underline.push([
        x0 - size * 0.08 + k * (ww + size * 0.2),
        base + size * 0.2 + Math.sin(k * 3.2) * size * 0.03 - k * size * 0.06,
      ]);
    }
    const ax0: Pt = portrait ? [w * 0.8, h * 0.2] : [w * 0.86, h * 0.2];
    const ax1: Pt = [cx + rx * 0.72, cy - ry * 0.95];
    const arrow: Pt[] = [];
    for (let i = 0; i <= 30; i++) {
      const k = i / 30;
      const mxp = lerp(ax0[0], ax1[0], k);
      const myp = lerp(ax0[1], ax1[1], k) - Math.sin(k * Math.PI) * u * 0.08;
      arrow.push([mxp, myp]);
    }
    const [hx, hy] = arrow[arrow.length - 1];
    const [px, py] = arrow[arrow.length - 4];
    const ang = Math.atan2(hy - py, hx - px);
    const head = u * 0.045;
    const headPts: Pt[] = [
      [hx + Math.cos(ang + 2.55) * head, hy + Math.sin(ang + 2.55) * head],
      [hx, hy],
      [hx + Math.cos(ang - 2.55) * head, hy + Math.sin(ang - 2.55) * head],
    ];
    const sparkles: Pt[] = [
      [cx - rx * 1.02, cy - ry * 0.8],
      [cx + rx * 1.08, cy + ry * 0.55],
      [cx - rx * 0.62, cy + ry * 1.18],
    ];

    const erase = ease.inOutCubic(seg(t, 4.2, 4.9));
    const drawAll = (c: Ctx2D, full: boolean) => {
      const at = (a: number, b: number) => (full ? 1 : ease.outCubic(seg(t, a, b)));
      const tb = full ? 0.37 : t;
      c.lineCap = "round";
      c.lineJoin = "round";
      // Marker underline (flat, bright).
      c.strokeStyle = theme.accent;
      c.lineWidth = size * 0.13;
      strokeUpTo(c, boil(underline, tb, u * 0.004, 3), at(1.1, 1.6));
      // Handwritten word: a wipe along the baseline.
      const wipe = full ? 1 : ease.inOutSine(seg(t, 0.2, 1.2));
      if (wipe > 0) {
        c.save();
        c.beginPath();
        const xw = x0 - size * 0.2 + (ww + size * 0.4) * wipe;
        c.moveTo(x0 - size, base - size * 1.4);
        c.lineTo(xw + size * 0.25, base - size * 1.4);
        c.lineTo(xw - size * 0.1, base + size * 0.6);
        c.lineTo(x0 - size, base + size * 0.6);
        c.closePath();
        c.clip();
        c.fillStyle = theme.ink;
        c.font = font(400, size, "Caveat Brush", HAND);
        c.textBaseline = "alphabetic";
        const jitter = boil([[0, 0]], tb, u * 0.003, 9)[0];
        c.fillText(word, x0 + jitter[0], base + jitter[1]);
        c.restore();
      }
      // Crayon loop, arrow and sparkles.
      c.strokeStyle = coral;
      c.lineWidth = u * 0.012;
      strokeUpTo(c, boil(loop, tb, u * 0.005, 11), at(1.5, 2.3));
      c.strokeStyle = theme.accent2;
      c.lineWidth = u * 0.01;
      strokeUpTo(c, boil(arrow, tb, u * 0.005, 17), at(2.1, 2.55));
      strokeUpTo(c, boil(headPts, tb, u * 0.004, 19), at(2.5, 2.7));
      for (let i = 0; i < sparkles.length; i++) {
        const k = full ? 1 : ease.outBack(seg(t, 2.5 + i * 0.12, 2.8 + i * 0.12));
        if (k <= 0) continue;
        const [sx, sy] = sparkles[i];
        const s = u * 0.035 * k;
        c.strokeStyle = theme.accent;
        c.lineWidth = u * 0.008;
        const star = boil(
          [
            [sx - s, sy],
            [sx + s, sy],
            [sx, sy - s * 1.2],
            [sx, sy + s * 1.2],
          ],
          tb,
          u * 0.003,
          23 + i,
        );
        c.beginPath();
        c.moveTo(star[0][0], star[0][1]);
        c.lineTo(star[1][0], star[1][1]);
        c.moveTo(star[2][0], star[2][1]);
        c.lineTo(star[3][0], star[3][1]);
        c.stroke();
      }
      // Wax: the paper's tooth shows through.
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.globalAlpha = 0.78;
      const pat = c.createPattern(tooth() as CanvasImageSource, "repeat");
      if (pat) {
        const k = Math.max(0.6, u / 900);
        if (typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scaleSelf(k));
        c.fillStyle = pat;
        c.fillRect(0, 0, w, h);
      }
      c.restore();
    };

    // Faint smudge of a previous drawing: the eraser never gets everything.
    const ghost = bake(
      `crayon-ghost:${theme.ink}${theme.accent}${theme.accent2}${word}`,
      w,
      h,
      (c) => drawAll(c, true),
    );
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.filter = `blur(${Math.max(1, u * 0.004).toFixed(1)}px)`;
    ctx.drawImage(ghost as CanvasImageSource, 0, 0);
    ctx.restore();

    if (t < 4.9) {
      const { canvas, ctx: layer } = buffer("crayon-layer", w, h);
      layer.clearRect(0, 0, w, h);
      drawAll(layer, false);
      ctx.save();
      if (erase > 0) {
        const ex = -w * 0.15 + erase * w * 1.3;
        ctx.beginPath();
        ctx.rect(ex, 0, w - ex + 10, h);
        ctx.clip();
      }
      ctx.drawImage(canvas as CanvasImageSource, 0, 0);
      ctx.restore();
      if (erase > 0 && erase < 1) {
        const ex = -w * 0.15 + erase * w * 1.3;
        const band = ctx.createLinearGradient(ex - u * 0.25, 0, ex, 0);
        band.addColorStop(0, rgba(theme.ink, 0));
        band.addColorStop(1, rgba(theme.ink, 0.06));
        ctx.fillStyle = band;
        ctx.fillRect(ex - u * 0.25, 0, u * 0.25, h);
      }
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
