import { rgba } from "../engine/color";
import { bake, ease, font, frameOf, lerp, light, TAU, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { finish, fitBox, overprint, poseAt, settle, stock, tooth, turn } from "./_s3-helpers";

const FAMILY = "Jost";
const FALLBACK = '"Futura", "Century Gothic", "Avenir Next", sans-serif';

/** One composition: every form's place on a 5 x 4 module block (x right, y down). */
type Pose = {
  circle: [number, number, number]; // cx, cy, r
  square: [number, number, number, number]; // cx, cy, half side, angle
  tri: [number, number, number, number]; // cx, cy, half size, apex angle
  bar: [number, number, number, number]; // cx, cy, half length, angle
  dot: [number, number, number]; // cx, cy, r
};

const UP = -Math.PI / 2;
const POSES: Pose[] = [
  {
    circle: [1.55, 2.05, 1.5],
    square: [3.8, 1.2, 0.72, 0],
    tri: [3.95, 3.0, 1.0, UP],
    bar: [1.55, 3.86, 1.55, 0],
    dot: [4.72, 0.3, 0.16],
  },
  {
    circle: [3.55, 1.45, 1.05],
    square: [1.05, 2.0, 1.0, 0],
    tri: [3.1, 3.05, 0.95, Math.PI],
    bar: [2.28, 2.0, 1.98, Math.PI / 2],
    dot: [0.42, 0.42, 0.16],
  },
  {
    // A see-saw: circle and square rest on a bar that tips on the triangle.
    circle: [0.889, 1.635, 0.86],
    square: [3.995, 1.619, 0.66, -0.07],
    tri: [2.5, 3.27, 0.73, UP],
    bar: [2.5, 2.46, 2.42, -0.07],
    dot: [2.5, 0.62, 0.16],
  },
  {
    circle: [3.72, 2.78, 1.02],
    square: [1.98, 1.98, 1.7, 0],
    tri: [4.35, 0.72, 0.6, Math.PI / 2],
    bar: [1.98, 3.92, 1.7, 0],
    dot: [0.95, 3.0, 0.2],
  },
];

/** Portrait: the same compositions mirrored across the diagonal, except the see-saw, which stays level. */
const POSES_P: Pose[] = POSES.map((q, i) =>
  i === 2
    ? {
        circle: [0.925, 1.978, 0.9],
        square: [3.027, 1.91, 0.8, -0.08],
        tri: [2.0, 3.945, 1.0, UP],
        bar: [2.0, 2.87, 1.95, -0.08],
        dot: [2.0, 0.55, 0.2],
      }
    : {
        circle: [q.circle[1], q.circle[0], q.circle[2]],
        square: [q.square[1], q.square[0], q.square[2], -q.square[3]],
        tri: [q.tri[1], q.tri[0], q.tri[2], Math.PI / 2 - q.tri[3]],
        bar: [q.bar[1], q.bar[0], q.bar[2], Math.PI / 2 - q.bar[3]],
        dot: [q.dot[1], q.dot[0], q.dot[2]],
      },
);

const BEAT = 1.25;
const MOVE = 0.72;

type Layout = {
  m: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** Shape block origin (module units) and whether it is transposed. */
  bx: number;
  by: number;
  flip: boolean;
  /** Type box in px. */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  portrait: boolean;
  square: boolean;
};

function layout(w: number, h: number): Layout {
  const { portrait, square } = frameOf(w, h);
  const cols = portrait ? 4 : square ? 5 : 7;
  const rows = portrait ? 7 : square ? 5 : 4;
  const mx = w * (portrait ? 0.085 : square ? 0.085 : 0.075);
  const my = h * (portrait ? 0.07 : square ? 0.085 : 0.1);
  const m = Math.min((w - mx * 2) / cols, (h - my * 2) / rows);
  const x0 = (w - m * cols) / 2;
  const y0 = (h - m * rows) / 2;
  if (portrait)
    return {
      m,
      x0,
      y0,
      cols,
      rows,
      bx: 0,
      by: 0,
      flip: true,
      portrait,
      square,
      tx: x0,
      ty: y0 + m * 5.25,
      tw: m * 4,
      th: m * 1.75,
    };
  if (square)
    return {
      m,
      x0,
      y0,
      cols,
      rows,
      bx: 0,
      by: 0,
      flip: false,
      portrait,
      square,
      tx: x0,
      ty: y0 + m * 4.12,
      tw: m * 5,
      th: m * 0.88,
    };
  return {
    m,
    x0,
    y0,
    cols,
    rows,
    bx: 0,
    by: 0,
    flip: false,
    portrait,
    square,
    tx: x0 + m * 5.28,
    ty: y0,
    tw: m * 1.72,
    th: m * 4,
  };
}

/** Shortest-way angle blend. */
function angleLerp(a: number, b: number, p: number) {
  let d = ((b - a + Math.PI * 3) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * p;
}

/** Blend two poses; each form moves on its own slight delay. */
function blend(t: number, poses: Pose[]): Pose {
  const POSES = poses;
  const part = (k: number) => poseAt(t, POSES.length, BEAT, MOVE, k * 0.07, (x) => settle(x, 0.9));
  const c = part(0);
  const s = part(1);
  const tr = part(2);
  const b = part(3);
  const d = part(4);
  const L = (A: number[], B: number[], p: number) => A.map((v, i) => lerp(v, B[i], p));
  const triA = POSES[tr.from].tri;
  const triB = POSES[tr.to].tri;
  const barA = POSES[b.from].bar;
  const barB = POSES[b.to].bar;
  return {
    circle: L(POSES[c.from].circle, POSES[c.to].circle, c.p) as Pose["circle"],
    square: L(POSES[s.from].square, POSES[s.to].square, s.p) as Pose["square"],
    tri: [
      lerp(triA[0], triB[0], tr.p),
      lerp(triA[1], triB[1], tr.p),
      lerp(triA[2], triB[2], tr.p),
      angleLerp(triA[3], triB[3], ease.inOutCubic(Math.min(1, Math.max(0, tr.p)))),
    ],
    bar: [
      lerp(barA[0], barB[0], b.p),
      lerp(barA[1], barB[1], b.p),
      lerp(barA[2], barB[2], b.p),
      lerp(barA[3], barB[3], ease.inOutCubic(Math.min(1, Math.max(0, b.p)))),
    ],
    dot: L(POSES[d.from].dot, POSES[d.to].dot, d.p) as Pose["dot"],
  };
}

function ground(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    stock(theme, 3, 1, 0.8)(c, w, h);
    const g = layout(w, h);
    const k = Math.max(1, g.m / 220);
    // Module grid: hairlines plus small crosses where lines meet.
    c.strokeStyle = rgba(theme.ink, 0.075);
    c.lineWidth = Math.max(0.6, 1.1 * k);
    c.beginPath();
    for (let i = 0; i <= g.cols; i++) {
      const x = Math.round(g.x0 + i * g.m) + 0.5;
      c.moveTo(x, g.y0);
      c.lineTo(x, g.y0 + g.rows * g.m);
    }
    for (let j = 0; j <= g.rows; j++) {
      const y = Math.round(g.y0 + j * g.m) + 0.5;
      c.moveTo(g.x0, y);
      c.lineTo(g.x0 + g.cols * g.m, y);
    }
    c.stroke();
    c.strokeStyle = rgba(theme.ink, 0.28);
    c.lineWidth = Math.max(0.8, 1.4 * k);
    const arm = g.m * 0.045;
    c.beginPath();
    for (let i = 0; i <= g.cols; i++)
      for (let j = 0; j <= g.rows; j++) {
        const x = g.x0 + i * g.m;
        const y = g.y0 + j * g.m;
        c.moveTo(x - arm, y);
        c.lineTo(x + arm, y);
        c.moveTo(x, y - arm);
        c.lineTo(x, y + arm);
      }
    c.stroke();
    // Construction: the block's diagonals and a compass arc, very faint.
    const bw = (g.flip ? 4 : 5) * g.m;
    const bh = (g.flip ? 5 : 4) * g.m;
    c.strokeStyle = rgba(theme.ink, 0.06);
    c.lineWidth = Math.max(0.6, 1 * k);
    c.beginPath();
    c.moveTo(g.x0, g.y0 + bh);
    c.lineTo(g.x0 + bw, g.y0);
    c.moveTo(g.x0, g.y0);
    c.lineTo(g.x0 + bw, g.y0 + bh);
    c.stroke();
    c.beginPath();
    c.arc(g.x0 + bw / 2, g.y0 + bh / 2, Math.min(bw, bh) * 0.5, 0, TAU);
    c.stroke();
  };
}

export const style: MotionStyle = {
  id: "bauhaus",
  name: "Bauhaus Composition",
  family: "Design Movements",
  tagline: "Kandinsky's three forms on a grid",
  look: "Kandinsky's three forms in red, yellow and blue on a strict module grid, compass lines and lowercase type.",
  move: "On every beat the circle, square and triangle slide, turn and rescale into a new balanced composition, then hold.",
  rules: [
    "Three forms, three inks: blue circle, red square, yellow triangle.",
    "Every form snaps to the module grid; nothing floats off it.",
    "Where two inks overlap they overprint into a darker third.",
    "Moves anticipate and settle, staggered 70 ms, then hold still.",
    "Balance is asymmetric: one big form, one medium, one small.",
    "Type is lowercase geometric sans, one word, set small and calm.",
    "Faint construction lines and crosses show the grid underneath.",
  ],
  prompt: `R — References
• Kandinsky's 1923 Bauhaus questionnaire: yellow triangle, red square, blue circle.
• Bauhaus posters by Herbert Bayer and Joost Schmidt (search: Bauhaus exhibition poster 1923, Bayer universal alphabet).
• Match their grid discipline and asymmetric balance, not their layouts.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.25 s): a big blue circle, a red square and a yellow triangle sit balanced on a module grid; the lowercase word "{{name}}" rests beside them.
• Middle (1.25–3.75 s): on each beat the three forms slide, turn and rescale into a new composition: stacked, then a see-saw balanced on the triangle, then one huge square.
• End (3.75–5 s): they return to the first composition exactly, and hold.

S — Style
Looks: {{bg}} stock with faint grid hairlines and crosses; circle {{accent2}}, square {{accent}}, triangle a warm yellow turned from {{accent}}, bar and dot in {{ink}}; overlaps overprint darker. Type: {{font}} (or Jost), lowercase, one word.
Moves: four compositions, one per 1.25 s beat; each form moves in 0.7 s with a slight anticipation and settle, staggered 70 ms; triangles turn in 90° steps.
Rules:
1. Three forms, three inks; nothing else is coloured.
2. Everything lands on the module grid.
3. Overlaps overprint (multiply), never simply cover.
4. Stagger the moves; then hold completely still.
5. Asymmetric balance: one big, one medium, one small.
6. Grain and a printed tooth on every ink.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; every form sits on grid lines when it holds; overlaps show the overprint colour; the word never touches a form; each composition reads as balanced. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Bauhaus",
  theme: {
    bg: "#121110",
    ink: "#efe6d4",
    accent: "#e2412a",
    accent2: "#3563d6",
    font: FAMILY,
  },
  fonts: ["Jost:wght@300..700"],
  tags: [
    "bauhaus",
    "geometric",
    "shapes",
    "circle",
    "square",
    "triangle",
    "primary",
    "kandinsky",
    "grid",
    "modernist",
    "poster",
    "design movement",
  ],
  word: "bauhaus",
  render(ctx, t, theme, w, h) {
    const g = layout(w, h);
    ctx.drawImage(
      bake(`bauhaus-ground:${theme.bg}${theme.ink}`, w, h, ground(theme)) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.3, h * 0.2, Math.max(w, h) * 0.9, theme.ink, 0.06);

    const P = blend(t, g.flip ? POSES_P : POSES);
    const X = (x: number, _y: number) => g.x0 + x * g.m;
    const Y = (_x: number, y: number) => g.y0 + y * g.m;
    const flipAngle = (a: number) => a;

    const red = theme.accent;
    const blue = theme.accent2;
    const yellow = turn(theme.accent, 62, 0.84, 0.165);

    const circlePath = (c: Ctx2D) => {
      const [x, y, r] = P.circle;
      c.beginPath();
      c.arc(X(x, y), Y(x, y), r * g.m, 0, TAU);
    };
    const squarePath = (c: Ctx2D) => {
      const [x, y, a, ang] = P.square;
      const cx = X(x, y);
      const cy = Y(x, y);
      const s = a * g.m;
      const r = ang;
      const co = Math.cos(r);
      const si = Math.sin(r);
      c.beginPath();
      c.moveTo(cx + (-s * co - -s * si), cy + (-s * si + -s * co));
      c.lineTo(cx + (s * co - -s * si), cy + (s * si + -s * co));
      c.lineTo(cx + (s * co - s * si), cy + (s * si + s * co));
      c.lineTo(cx + (-s * co - s * si), cy + (-s * si + s * co));
      c.closePath();
    };
    const triPath = (c: Ctx2D) => {
      const [x, y, b, ang] = P.tri;
      const cx = X(x, y);
      const cy = Y(x, y);
      const a = flipAngle(ang);
      const s = b * g.m;
      // Isosceles triangle filling a 2b square cell, apex toward angle a.
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const px = -ay;
      const py = ax;
      c.beginPath();
      c.moveTo(cx + ax * s, cy + ay * s);
      c.lineTo(cx - ax * s + px * s, cy - ay * s + py * s);
      c.lineTo(cx - ax * s - px * s, cy - ay * s - py * s);
      c.closePath();
    };

    // Soft contact shadows under the forms (light from the top left).
    ctx.save();
    ctx.fillStyle = rgba("#000000", 0.28);
    ctx.translate(g.m * 0.05, g.m * 0.07);
    squarePath(ctx);
    ctx.fill();
    circlePath(ctx);
    ctx.fill();
    triPath(ctx);
    ctx.fill();
    ctx.restore();

    const forms: [(c: Ctx2D) => void, string][] = [
      [squarePath, red],
      [circlePath, blue],
      [triPath, yellow],
    ];
    for (const [path, color] of forms) {
      ctx.fillStyle = color;
      path(ctx);
      ctx.fill();
    }
    // Overprint: each pair's intersection in the multiplied ink.
    for (let i = 0; i < forms.length; i++)
      for (let j = i + 1; j < forms.length; j++) {
        ctx.save();
        forms[i][0](ctx);
        ctx.clip();
        forms[j][0](ctx);
        ctx.clip();
        ctx.fillStyle = overprint(forms[i][1], forms[j][1], 0.3);
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    ctx.save();
    for (const [path] of forms) {
      path(ctx);
      ctx.clip();
    }
    ctx.fillStyle = overprint(overprint(red, blue, 0.3), yellow, 0.3);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // A compass ring rides with the circle.
    {
      const [x, y, r] = P.circle;
      ctx.strokeStyle = rgba(theme.ink, 0.22);
      ctx.lineWidth = Math.max(0.8, g.m * 0.006);
      ctx.beginPath();
      ctx.arc(X(x, y), Y(x, y), (r + 0.13) * g.m, 0, TAU);
      ctx.stroke();
    }

    // The bar and the dot, in ink.
    {
      const [x, y, L, ang] = P.bar;
      const a = flipAngle(ang);
      ctx.save();
      ctx.translate(X(x, y), Y(x, y));
      ctx.rotate(a);
      ctx.fillStyle = theme.ink;
      const th = g.m * 0.075;
      ctx.fillRect(-L * g.m, -th, L * 2 * g.m, th * 2);
      ctx.restore();
      const [dx, dy, dr] = P.dot;
      ctx.beginPath();
      ctx.arc(X(dx, dy), Y(dx, dy), dr * g.m, 0, TAU);
      ctx.fill();
    }

    // Type: one lowercase word and the composition number.
    const word = wordFor(theme.name, "bauhaus", 12).toLowerCase();
    const now = poseAt(t, POSES.length, BEAT, MOVE);
    const beat = now.p > 0.5 ? now.to : now.from;
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    if (!g.portrait && !g.square) {
      // Landscape: a narrow column to the right of the block.
      const size = fitBox(ctx, word, g.tw * 0.98, g.m * 0.5, 500, theme.font, FALLBACK);
      ctx.font = font(500, size, theme.font, FALLBACK);
      ctx.fillText(word, g.tx, g.ty + g.th - g.m * 0.1);
      const cap = Math.max(7, g.m * 0.1);
      ctx.font = font(400, cap, theme.font, FALLBACK);
      ctx.fillStyle = rgba(theme.ink, 0.6);
      ctx.fillText("form · farbe · fläche", g.tx, g.ty + g.th - g.m * 0.1 - size * 1.02);
      const num = g.m * 0.62;
      ctx.font = font(300, num, theme.font, FALLBACK);
      ctx.fillStyle = rgba(theme.ink, 0.9);
      ctx.fillText(`0${beat + 1}`, g.tx - num * 0.04, g.ty + num * 0.86);
      const mark = tintedLogo(theme, theme.ink, g.m * 0.42, g.m * 0.42);
      if (mark)
        ctx.drawImage(mark as CanvasImageSource, g.tx + g.tw - g.m * 0.42, g.ty + g.m * 0.08);
    } else {
      const num = g.m * (g.square ? 0.52 : 0.62);
      ctx.font = font(300, num, theme.font, FALLBACK);
      const numW = ctx.measureText("04").width;
      const size = fitBox(
        ctx,
        word,
        Math.min(g.tw * 0.72, g.tw - numW - g.m * 0.35),
        g.th * (g.square ? 0.62 : 0.4),
        500,
        theme.font,
        FALLBACK,
      );
      ctx.font = font(500, size, theme.font, FALLBACK);
      const base = g.ty + g.th * (g.square ? 0.78 : 0.5);
      ctx.fillText(word, g.tx, base);
      ctx.font = font(300, num, theme.font, FALLBACK);
      ctx.textAlign = "right";
      ctx.fillStyle = rgba(theme.ink, 0.9);
      ctx.fillText(`0${beat + 1}`, g.tx + g.tw, base);
      const cap = Math.max(7, g.m * 0.1);
      ctx.font = font(400, cap, theme.font, FALLBACK);
      ctx.textAlign = "left";
      ctx.fillStyle = rgba(theme.ink, 0.6);
      ctx.fillText("form · farbe · fläche", g.tx, base + cap * 2.4);
      const mark = tintedLogo(theme, theme.ink, cap * 2.6, cap * 2.6);
      if (mark) ctx.drawImage(mark as CanvasImageSource, g.tx + g.tw - cap * 2.6, base + cap * 0.9);
    }

    tooth(ctx, w, h, 0.42, 3);
    finish(ctx, w, h, t, 0.45, 0.3);
  },
};
