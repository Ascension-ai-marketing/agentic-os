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
  light,
  once,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  fitFont,
  handEllipse,
  handLine,
  headOf,
  mottle,
  speckleTile,
  tileFill,
  tracePts,
  type Pt,
} from "./_s2-helpers";

/**
 * Paint-marker sketchnotes on a black dot-grid page: a highlighted title
 * banner, three boxed icons joined by arrows, grey shadows, hand labels.
 * The loop opens on the finished page scrolling up to a fresh one.
 */
const TITLE = '"Permanent Marker", "Marker Felt", cursive';
const LABEL = '"Kalam", "Comic Sans MS", cursive';
const SCROLL = [0.05, 0.6];

type Mark = {
  pts: Pt[];
  t0: number;
  t1: number;
  width: number;
  /** 0 ink marker, 1 accent highlighter, 2 accent2, 3 grey shadow marker. */
  col: 0 | 1 | 2 | 3;
};

type Box = { x: number; y: number; w: number; h: number };

function layout(w: number, h: number) {
  const { u, portrait, square } = frameOf(w, h);
  const bannerW = w * (portrait ? 0.8 : square ? 0.74 : 0.5);
  const bannerH = u * (portrait ? 0.13 : 0.14);
  const banner: Box = {
    x: w / 2 - bannerW / 2,
    y: h * (portrait ? 0.08 : 0.1),
    w: bannerW,
    h: bannerH,
  };
  const boxes: Box[] = [];
  if (portrait) {
    const bw = w * 0.42;
    const bh = h * 0.16;
    for (let i = 0; i < 3; i++) boxes.push({ x: w * 0.1, y: h * (0.3 + i * 0.22), w: bw, h: bh });
  } else {
    const bw = w * (square ? 0.25 : 0.2);
    const bh = h * (square ? 0.27 : 0.32);
    const gap = w * (square ? 0.07 : 0.1);
    const x0 = w / 2 - (bw * 3 + gap * 2) / 2;
    for (let i = 0; i < 3; i++)
      boxes.push({ x: x0 + i * (bw + gap), y: h * (square ? 0.4 : 0.42), w: bw, h: bh });
  }
  return { u, banner, boxes, portrait, square };
}

function roundBox(b: Box, seed: number, u: number): Pt[] {
  const r = Math.min(b.w, b.h) * 0.14;
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(b.x + b.w - r, b.y + r, -Math.PI / 2);
  corner(b.x + b.w - r, b.y + b.h - r, 0);
  corner(b.x + r, b.y + b.h - r, Math.PI / 2);
  corner(b.x + r, b.y + r, Math.PI);
  // Close past the start, like a real marker loop, with a little wobble.
  pts.push([pts[0][0] + u * 0.012, pts[0][1] - u * 0.002]);
  return pts.map(
    ([x, y], i) =>
      [x + Math.sin(i * 0.9 + seed) * u * 0.0018, y + Math.cos(i * 1.3 + seed) * u * 0.0018] as Pt,
  );
}

function bulb(cx: number, cy: number, s: number): Pt[][] {
  const glass = handEllipse(cx, cy - s * 0.12, s * 0.34, s * 0.36, 11, 0.02, 60, 2.2, 0.86);
  const neckL = handLine(
    [cx - s * 0.16, cy + s * 0.2],
    [cx - s * 0.14, cy + s * 0.34],
    3,
    s * 0.004,
    4,
    0,
  );
  const neckR = handLine(
    [cx + s * 0.16, cy + s * 0.2],
    [cx + s * 0.14, cy + s * 0.34],
    4,
    s * 0.004,
    4,
    0,
  );
  const base = [0, 1, 2].map((i) =>
    handLine(
      [cx - s * 0.14, cy + s * (0.36 + i * 0.06)],
      [cx + s * 0.14, cy + s * (0.36 + i * 0.06)],
      5 + i,
      s * 0.004,
      4,
      0,
    ),
  );
  const fil: Pt[] = [];
  for (let i = 0; i <= 8; i++)
    fil.push([cx - s * 0.1 + (s * 0.2 * i) / 8, cy - s * 0.05 + (i % 2 ? -1 : 1) * s * 0.05]);
  const rays = [0, 1, 2, 3, 4].map((i) => {
    const a = -Math.PI + 0.35 + i * 0.6;
    return [
      [cx + Math.cos(a) * s * 0.48, cy - s * 0.12 + Math.sin(a) * s * 0.48],
      [cx + Math.cos(a) * s * 0.62, cy - s * 0.12 + Math.sin(a) * s * 0.62],
    ] as Pt[];
  });
  return [glass, neckL, neckR, ...base, fil, ...rays];
}

function gear(cx: number, cy: number, s: number): Pt[][] {
  const outer: Pt[] = [];
  const teeth = 9;
  for (let i = 0; i <= teeth * 4; i++) {
    const k = i / (teeth * 4);
    const a = k * TAU - Math.PI / 2;
    const q = i % 4;
    const r = q === 1 || q === 2 ? s * 0.42 : s * 0.33;
    outer.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const inner = handEllipse(cx, cy, s * 0.13, s * 0.13, 21, 0.02, 32, 0, 1.05);
  return [outer, inner];
}

function rocket(cx: number, cy: number, s: number): Pt[][] {
  const body: Pt[] = [];
  for (let i = 0; i <= 30; i++) {
    const a = (i / 30) * TAU;
    const x = Math.cos(a) * s * 0.16;
    const y = Math.sin(a) * s * 0.38;
    const pinch = y < 0 ? 1 - Math.pow(-y / (s * 0.38), 3) * 0.55 : 1;
    body.push([cx + x * pinch, cy + y]);
  }
  const win = handEllipse(cx, cy - s * 0.1, s * 0.065, s * 0.065, 31, 0.02, 24, 0, 1.05);
  const finL: Pt[] = [
    [cx - s * 0.14, cy + s * 0.12],
    [cx - s * 0.3, cy + s * 0.36],
    [cx - s * 0.12, cy + s * 0.3],
  ];
  const finR: Pt[] = finL.map(([x, y]) => [2 * cx - x, y] as Pt);
  const flame: Pt[] = [];
  for (let i = 0; i <= 8; i++)
    flame.push([cx - s * 0.08 + (s * 0.16 * i) / 8, cy + s * 0.42 + (i % 2 ? s * 0.16 : 0)]);
  return [body, win, finL, finR, flame];
}

function arrow(a: Pt, b: Pt, bend: number, u: number): Pt[][] {
  const pts: Pt[] = [];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const cx = mx - (dy / L) * bend;
  const cy = my + (dx / L) * bend;
  for (let i = 0; i <= 20; i++) {
    const k = i / 20;
    pts.push([
      (1 - k) * (1 - k) * a[0] + 2 * (1 - k) * k * cx + k * k * b[0],
      (1 - k) * (1 - k) * a[1] + 2 * (1 - k) * k * cy + k * k * b[1],
    ]);
  }
  const e = pts[20];
  const p = pts[17];
  const ang = Math.atan2(e[1] - p[1], e[0] - p[0]);
  const hl = u * 0.03;
  const head: Pt[] = [
    [e[0] + Math.cos(ang + 2.55) * hl, e[1] + Math.sin(ang + 2.55) * hl],
    e,
    [e[0] + Math.cos(ang - 2.55) * hl, e[1] + Math.sin(ang - 2.55) * hl],
  ];
  return [pts, head];
}

/** Every mark on the page with its moment, cached per size. */
function marks(w: number, h: number): Mark[] {
  return once(`sketch-marks:${Math.round(w)}x${Math.round(h)}`, () => {
    const L = layout(w, h);
    const { u, banner: B, boxes, portrait } = L;
    const out: Mark[] = [];
    const mw = u * 0.0065;
    const add = (pts: Pt[], t0: number, t1: number, col: 0 | 1 | 2 | 3 = 0, width = mw) =>
      out.push({ pts, t0, t1, width, col });
    // Banner: grey shadow, outline with folded tails.
    const tail = B.h * 0.55;
    const off = u * 0.012;
    const bannerPts: Pt[] = [
      [B.x, B.y],
      [B.x + B.w, B.y],
      [B.x + B.w, B.y + B.h],
      [B.x, B.y + B.h],
      [B.x, B.y],
    ];
    add(
      bannerPts.map(([x, y]) => [x + off, y + off] as Pt),
      1.0,
      1.25,
      3,
      u * 0.014,
    );
    add(bannerPts, 0.62, 0.95);
    add(
      [
        [B.x, B.y + B.h * 0.3],
        [B.x - tail, B.y + B.h * 0.3],
        [B.x - tail * 0.6, B.y + B.h * 0.8],
        [B.x - tail, B.y + B.h * 1.3],
        [B.x + tail * 0.4, B.y + B.h * 1.3],
        [B.x + tail * 0.4, B.y + B.h],
      ],
      0.9,
      1.1,
    );
    add(
      [
        [B.x + B.w, B.y + B.h * 0.3],
        [B.x + B.w + tail, B.y + B.h * 0.3],
        [B.x + B.w + tail * 0.6, B.y + B.h * 0.8],
        [B.x + B.w + tail, B.y + B.h * 1.3],
        [B.x + B.w - tail * 0.4, B.y + B.h * 1.3],
        [B.x + B.w - tail * 0.4, B.y + B.h],
      ],
      1.0,
      1.2,
    );
    // Boxes, icons, arrows.
    const starts = [1.25, 1.95, 2.65];
    boxes.forEach((b, i) => {
      const t0 = starts[i];
      add(
        roundBox({ x: b.x + off, y: b.y + off, w: b.w, h: b.h }, i * 3 + 1, u),
        t0 + 0.4,
        t0 + 0.6,
        3,
        u * 0.016,
      );
      add(roundBox(b, i * 3, u), t0, t0 + 0.28);
      const s = Math.min(b.w, b.h) * 0.8;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const icon = i === 0 ? bulb(cx, cy, s) : i === 1 ? gear(cx, cy, s) : rocket(cx, cy, s);
      const span = 0.32;
      icon.forEach((p, j) =>
        add(p, t0 + 0.26 + (span * j) / icon.length, t0 + 0.26 + (span * (j + 1)) / icon.length),
      );
      if (i < 2) {
        const nb = boxes[i + 1];
        const a: Pt = portrait
          ? [b.x + b.w * 0.75, b.y + b.h + u * 0.02]
          : [b.x + b.w + u * 0.015, b.y + b.h * 0.3];
        const e: Pt = portrait
          ? [nb.x + nb.w * 0.75, nb.y - u * 0.02]
          : [nb.x - u * 0.015, nb.y + nb.h * 0.3];
        const [shaft, head] = arrow(a, e, portrait ? -u * 0.05 : -u * 0.06, u);
        add(shaft, t0 + 0.55, t0 + 0.72, 2);
        add(head, t0 + 0.72, t0 + 0.78, 2);
      }
    });
    // Sparkles by the bulb.
    const b0 = boxes[0];
    for (let i = 0; i < 2; i++) {
      const sx = b0.x + b0.w * (i ? 0.92 : 0.1);
      const sy = b0.y + b0.h * (i ? 0.12 : 0.18);
      const ss = u * 0.018;
      add(
        [
          [sx - ss, sy],
          [sx + ss, sy],
        ],
        3.2 + i * 0.08,
        3.26 + i * 0.08,
        1,
        u * 0.005,
      );
      add(
        [
          [sx, sy - ss],
          [sx, sy + ss],
        ],
        3.26 + i * 0.08,
        3.32 + i * 0.08,
        1,
        u * 0.005,
      );
    }
    return out;
  });
}

/** A paint-marker line: opaque, even, round-ended, a faint streak inside. */
function markerLine(c: Ctx2D, pts: Pt[], width: number, colour: string) {
  if (pts.length < 2) return;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = colour;
  c.lineWidth = width;
  c.beginPath();
  tracePts(c, pts);
  c.stroke();
  c.strokeStyle = rgba("#ffffff", 0.12);
  c.lineWidth = width * 0.3;
  c.beginPath();
  tracePts(
    c,
    pts.map(([x, y]) => [x - width * 0.12, y - width * 0.12] as Pt),
  );
  c.stroke();
}

function pageSheet(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.008, 0.012, u * 0.3, u / 120, 3.3);
    // Dot grid, spaced to divide the page height so a scroll of one page lands on the grid.
    const rows = Math.max(8, Math.round(h / (u * 0.045)));
    const s = h / rows;
    c.fillStyle = rgba(theme.ink, 0.13);
    for (let y = s / 2; y < h; y += s)
      for (let x = (w % s) / 2 + s / 2; x < w; x += s) {
        c.beginPath();
        c.arc(x, y, Math.max(0.6, u * 0.0016), 0, TAU);
        c.fill();
      }
  };
}

export const style: MotionStyle = {
  id: "sketchnote",
  name: "Sketchnote",
  family: "Paint & Draw",
  tagline: "Paint-marker sketchnotes",
  look: "Paint-marker sketchnotes on a black dot-grid page: a highlighted title banner, three boxed icons, curvy arrows, grey shadows, hand labels.",
  move: "The finished page scrolls away; the marker draws the banner, writes the title, then boxes, icons and arrows in reading order, and highlights land last.",
  rules: [
    "Draw in reading order: banner, title, then each box, icon and arrow.",
    "Paint marker: opaque, even width, round ends; never a fade-in.",
    "Grey marker shadows sit offset under banner and boxes.",
    "Highlighter fills are streaky strokes, not flat fills.",
    "One accent for highlights, one for arrows; everything else white.",
    "Hand lettering: a marker face for the title, a pen face for labels.",
    "The loop opens on the finished page scrolling up to a fresh one.",
  ],
  prompt: `R — References
• Sketchnotes by Mike Rohde (The Sketchnote Handbook): containers, arrows, icons, drop shadows.
• Paint markers on black dot-grid notebooks; highlighter fills that show their strokes.

I — Idea
One page of notes, 5 seconds, looping seamlessly:
• Beginning (0–0.6 s): the finished page scrolls up and away; a fresh dot-grid page arrives.
• Middle (0.6–3.4 s): the marker draws a banner and writes "{{name}}" on a {{accent}} highlighter fill, then three boxes with a bulb, a gear and a rocket, joined by {{accent2}} arrows; labels IDEA, BUILD, SHIP; grey shadows and highlights land last.
• End (3.4–5 s): the finished page holds, the same page that scrolls away at the start.

S — Style
Looks: {{bg}} dot-grid paper; {{ink}} paint-marker lines; {{accent}} highlighter; {{accent2}} arrows; grey shadow marker; Permanent Marker title, Kalam labels.
Moves: every line is drawn along its path at marker speed with an ease; the title is written left to right; the page scroll eases in and out and lands exactly one page on.
Rules:
1. Reading order.
2. Opaque, even marker lines; never fade in.
3. Offset grey shadows.
4. Streaky highlighter fills.
5. Two accents only.
6. Open on the finished page.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the title and labels are legible at thumbnail size; icons read as a bulb, a gear and a rocket; arrows point at the next box; nothing touches the frame edge. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Sketchnoting",
  theme: {
    bg: "#121315",
    ink: "#f6f3ec",
    accent: "#ffcf3a",
    accent2: "#56adff",
    font: "Permanent Marker",
  },
  fonts: ["Permanent Marker", "Kalam:wght@700"],
  tags: [
    "sketchnote",
    "marker",
    "notes",
    "whiteboard",
    "icons",
    "arrows",
    "explainer",
    "diagram",
    "doodle",
    "hand-drawn",
    "handdrawn",
  ],
  word: "Big Idea",
  render(ctx, t, theme, w, h) {
    const L = layout(w, h);
    const { u, banner: B, boxes, portrait } = L;
    const all = marks(w, h);
    const cols = [theme.ink, theme.accent, theme.accent2, mix(theme.bg, theme.ink, 0.28)];
    const word = wordFor(theme.name, "Big Idea", 14);
    const labels = ["IDEA", "BUILD", "SHIP"];
    const key = `${theme.bg}${theme.ink}`;
    const sheet = bake(`sketch-sheet:${key}`, w, h, pageSheet(theme));
    const titleCss = (s: number) => font(400, s, "Permanent Marker", TITLE);
    const labelCss = (s: number) => font(700, s, "Kalam", LABEL);

    /** Everything on the page up to time tt. */
    const drawPage = (c: Ctx2D, tt: number) => {
      // Highlighter fill in the banner: streaky strokes, under the ink.
      const hf = clamp((tt - 0.95) / 0.3);
      if (hf > 0) {
        c.save();
        c.beginPath();
        c.rect(B.x + u * 0.006, B.y + u * 0.006, B.w - u * 0.012, B.h - u * 0.012);
        c.clip();
        const rows = 5;
        for (let i = 0; i < rows; i++) {
          const k = clamp(hf * rows - i);
          if (k <= 0) continue;
          const y = B.y + (B.h * (i + 0.5)) / rows;
          c.strokeStyle = rgba(theme.accent, 0.92);
          c.lineWidth = B.h / rows + u * 0.01;
          c.lineCap = "round";
          c.beginPath();
          const dir = i % 2 ? -1 : 1;
          const x0 = dir > 0 ? B.x - u * 0.02 : B.x + B.w + u * 0.02;
          c.moveTo(x0, y);
          c.lineTo(x0 + dir * (B.w + u * 0.04) * k, y + u * 0.003 * dir);
          c.stroke();
        }
        c.restore();
      }
      // Ink lines, shadows and arrows.
      for (const m of all) {
        const k = ease.inOutSine(clamp((tt - m.t0) / (m.t1 - m.t0)));
        if (k <= 0) continue;
        markerLine(c, headOf(m.pts, k), m.width, cols[m.col]);
      }
      // The title, written left to right in the banner.
      const tp = clamp((tt - 1.15) / 0.5);
      if (tp > 0) {
        const size = fitFont(c, word, B.w * 0.84, B.h * 0.62, titleCss);
        c.save();
        c.font = titleCss(size);
        const tw = c.measureText(word).width;
        c.beginPath();
        c.rect(
          B.x + B.w / 2 - tw / 2 - u * 0.02,
          B.y - u * 0.02,
          (tw + u * 0.04) * tp,
          B.h + u * 0.04,
        );
        c.clip();
        c.fillStyle = theme.bg;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(word, B.x + B.w / 2, B.y + B.h * 0.54);
        c.restore();
      }
      // Highlights inside the icons: streaky diagonal strokes clipped to each shape, under the ink.
      boxes.forEach((b, i) => {
        const k = clamp((tt - (3.0 + i * 0.1)) / 0.25);
        if (k <= 0) return;
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const s = Math.min(b.w, b.h) * 0.8;
        c.save();
        c.beginPath();
        if (i === 0) c.ellipse(cx, cy - s * 0.12, s * 0.33, s * 0.35, 0, 0, TAU);
        else if (i === 1) {
          c.arc(cx, cy, s * 0.37, 0, TAU);
          c.moveTo(cx + s * 0.13, cy);
          c.arc(cx, cy, s * 0.13, 0, TAU, true);
        } else c.ellipse(cx, cy, s * 0.15, s * 0.37, 0, 0, TAU);
        c.clip("evenodd");
        c.globalCompositeOperation = "destination-over";
        c.strokeStyle = rgba(i === 1 ? theme.accent2 : theme.accent, 0.5);
        c.lineWidth = s * 0.16;
        c.lineCap = "round";
        const n = 9;
        for (let q = 0; q < n; q++) {
          const kq = clamp(k * n - q);
          if (kq <= 0) continue;
          const off = (q - (n - 1) / 2) * s * 0.095;
          const x0 = cx - s * 0.45 + off;
          const y0 = cy + s * 0.45 + off;
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x0 + s * 0.9 * kq, y0 - s * 0.9 * kq);
          c.stroke();
        }
        c.restore();
      });
      // Labels under (or beside) each box.
      boxes.forEach((b, i) => {
        const k = clamp((tt - (3.05 + i * 0.12)) / 0.25);
        if (k <= 0) return;
        const size = u * (portrait ? 0.06 : 0.055);
        c.save();
        c.font = labelCss(size);
        const lx = portrait ? b.x + b.w + u * 0.07 : b.x + b.w / 2;
        const ly = portrait ? b.y + b.h * 0.55 : b.y + b.h + u * 0.075;
        c.textAlign = portrait ? "left" : "center";
        c.textBaseline = "middle";
        const tw = c.measureText(labels[i]).width;
        const left = portrait ? lx : lx - tw / 2;
        c.beginPath();
        c.rect(left - u * 0.01, ly - size, (tw + u * 0.02) * k, size * 2);
        c.clip();
        c.fillStyle = theme.ink;
        c.fillText(labels[i], lx, ly);
        c.restore();
      });
      const logo = tintedLogo(theme, theme.ink, u * 0.07, u * 0.07);
      if (logo && tt > 3.3) {
        const b = boxes[2];
        c.drawImage(
          logo as CanvasImageSource,
          b.x + b.w - u * 0.085,
          b.y + u * 0.015,
          u * 0.07,
          u * 0.07,
        );
      }
    };

    const finalKey = `sketch-final:${key}${theme.accent}${theme.accent2}:${word}:${theme.logo ? theme.logo.length : 0}`;
    const finished = bake(finalKey, w, h, (c) => {
      drawPage(c, 99);
      tileFill(
        c,
        speckleTile(8080, 256, 900, 0.1, 0.35, 0.5, 1.2),
        w,
        h,
        Math.max(0.5, u / 800),
        0.3,
        "destination-out",
      );
    });

    ground(ctx, w, h, theme.bg);
    const scroll = ease.inOutCubic(seg(t, SCROLL[0], SCROLL[1]));
    if (scroll < 1) {
      // The finished page scrolls up and away; the fresh page follows it in.
      ctx.save();
      ctx.translate(0, -h * scroll);
      ctx.drawImage(sheet as CanvasImageSource, 0, 0);
      ctx.drawImage(finished as CanvasImageSource, 0, 0);
      ctx.drawImage(sheet as CanvasImageSource, 0, h);
      ctx.restore();
    } else {
      ctx.drawImage(sheet as CanvasImageSource, 0, 0);
      if (t >= 3.6) ctx.drawImage(finished as CanvasImageSource, 0, 0);
      else {
        const { canvas: lc, ctx: P } = buffer("sketch-live", w, h);
        P.clearRect(0, 0, w, h);
        drawPage(P, t);
        tileFill(
          P,
          speckleTile(8080, 256, 900, 0.1, 0.35, 0.5, 1.2),
          w,
          h,
          Math.max(0.5, u / 800),
          0.3,
          "destination-out",
        );
        ctx.drawImage(lc as CanvasImageSource, 0, 0);
        // The marker nib, a bright point where it draws.
        for (const m of all) {
          if (t > m.t0 && t < m.t1) {
            const pts = headOf(m.pts, ease.inOutSine((t - m.t0) / (m.t1 - m.t0)));
            const [x, y] = pts[pts.length - 1];
            ctx.fillStyle = rgba(cols[m.col], 1);
            ctx.beginPath();
            ctx.arc(x, y, m.width * 0.8, 0, TAU);
            ctx.fill();
            break;
          }
        }
      }
    }
    light(ctx, w * 0.3, h * 0.2, Math.max(w, h) * 0.8, theme.ink, 0.06);
    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
