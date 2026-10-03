import { mix, rgba } from "../engine/color";
import {
  bake,
  ease,
  fbm3,
  font,
  frameOf,
  grain,
  ground,
  light,
  MONO,
  once,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

type Pt = [number, number];
type Prim = {
  pts: Pt[];
  t0: number;
  t1: number;
  weight: "thick" | "thin";
  tone: "ink" | "accent" | "accent2";
  dash?: number[];
};
type Label = {
  text: string;
  x: number;
  y: number;
  t0: number;
  t1: number;
  size: number;
  rot?: number;
  tone?: "ink" | "accent";
  align?: CanvasTextAlign;
};

const circle = (cx: number, cy: number, r: number, n = 96, a0 = 0, sweep = TAU): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (sweep * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });

/** The drawing in its own units: a gear (front view) and its section (side view). */
function drawing() {
  return once("blueprint-drawing", () => {
    const prims: Prim[] = [];
    const labels: Label[] = [];
    // Front view centred at (0, 0).
    const teeth = 18;
    const Ro = 300;
    const Rr = 262;
    const gear: Pt[] = [];
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU - Math.PI / 2;
      const step = TAU / teeth;
      const pts: [number, number][] = [
        [a - step * 0.5, Rr],
        [a - step * 0.22, Rr],
        [a - step * 0.14, Ro],
        [a + step * 0.14, Ro],
        [a + step * 0.22, Rr],
      ];
      for (const [ang, r] of pts) gear.push([Math.cos(ang) * r, Math.sin(ang) * r]);
    }
    gear.push(gear[0]);
    prims.push({
      pts: [
        [-360, 0],
        [360, 0],
      ],
      t0: 0.15,
      t1: 0.6,
      weight: "thin",
      tone: "accent2",
      dash: [26, 8, 4, 8],
    });
    prims.push({
      pts: [
        [0, -360],
        [0, 360],
      ],
      t0: 0.2,
      t1: 0.65,
      weight: "thin",
      tone: "accent2",
      dash: [26, 8, 4, 8],
    });
    prims.push({ pts: gear, t0: 0.4, t1: 1.55, weight: "thick", tone: "ink" });
    prims.push({
      pts: circle(0, 0, 282, 120),
      t0: 0.7,
      t1: 1.3,
      weight: "thin",
      tone: "accent2",
      dash: [26, 8, 4, 8],
    });
    prims.push({
      pts: circle(0, 0, 215, 96, -Math.PI / 2),
      t0: 0.9,
      t1: 1.45,
      weight: "thick",
      tone: "ink",
    });
    prims.push({
      pts: circle(0, 0, 90, 64, -Math.PI / 2),
      t0: 1.1,
      t1: 1.5,
      weight: "thick",
      tone: "ink",
    });
    // Bore with keyway.
    const bore: Pt[] = [];
    const key = Math.asin(12 / 42);
    for (let i = 0; i <= 48; i++) {
      const a = -Math.PI / 2 + key + ((TAU - 2 * key) * i) / 48;
      bore.push([Math.cos(a) * 42, Math.sin(a) * 42]);
    }
    bore.push([-12, -54], [12, -54], bore[0]);
    prims.push({ pts: bore, t0: 1.25, t1: 1.65, weight: "thick", tone: "ink" });
    // Lightening holes.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2 + Math.PI / 6;
      prims.push({
        pts: circle(Math.cos(a) * 152, Math.sin(a) * 152, 38, 40, a),
        t0: 1.3 + i * 0.07,
        t1: 1.62 + i * 0.07,
        weight: "thick",
        tone: "ink",
      });
    }
    // Side view (section) to the right, centred at (560, 0).
    const sx = 560;
    const outline: Pt[] = [
      [sx - 45, -300],
      [sx + 45, -300],
      [sx + 45, -90],
      [sx + 75, -90],
      [sx + 75, 90],
      [sx + 45, 90],
      [sx + 45, 300],
      [sx - 45, 300],
      [sx - 45, 90],
      [sx - 75, 90],
      [sx - 75, -90],
      [sx - 45, -90],
      [sx - 45, -300],
    ];
    prims.push({ pts: outline, t0: 1.2, t1: 1.95, weight: "thick", tone: "ink" });
    prims.push({
      pts: [
        [sx - 110, 0],
        [sx + 110, 0],
      ],
      t0: 1.25,
      t1: 1.5,
      weight: "thin",
      tone: "accent2",
      dash: [26, 8, 4, 8],
    });
    prims.push({
      pts: [
        [sx - 75, -42],
        [sx + 75, -42],
      ],
      t0: 1.8,
      t1: 2.05,
      weight: "thin",
      tone: "ink",
      dash: [14, 9],
    });
    prims.push({
      pts: [
        [sx - 75, 42],
        [sx + 75, 42],
      ],
      t0: 1.85,
      t1: 2.1,
      weight: "thin",
      tone: "ink",
      dash: [14, 9],
    });
    // Section hatching (45°) in the rim areas.
    for (const [y0, y1] of [
      [-300, -215],
      [215, 300],
      [-90, -42],
      [42, 90],
    ]) {
      const x0 = y0 === -90 || y0 === 42 ? sx - 75 : sx - 45;
      const x1 = y0 === -90 || y0 === 42 ? sx + 75 : sx + 45;
      for (let k = x0 - (y1 - y0); k < x1; k += 16) {
        const a: Pt = [Math.max(x0, k), y0 + Math.max(0, x0 - k)];
        const bx = Math.min(x1, k + (y1 - y0));
        const b: Pt = [bx, y0 + (bx - k)];
        if (b[0] > a[0])
          prims.push({
            pts: [a, b],
            t0: 1.75 + ((k - x0) / 400) * 0.3,
            t1: 2.0 + ((k - x0) / 400) * 0.3,
            weight: "thin",
            tone: "ink",
          });
      }
    }
    // Dimensions: overall diameter (left of front view).
    const dx = -390;
    prims.push({
      pts: [
        [-300, -300],
        [dx - 18, -300],
      ],
      t0: 2.0,
      t1: 2.2,
      weight: "thin",
      tone: "ink",
    });
    prims.push({
      pts: [
        [-300, 300],
        [dx - 18, 300],
      ],
      t0: 2.02,
      t1: 2.22,
      weight: "thin",
      tone: "ink",
    });
    prims.push({
      pts: [
        [dx, -300],
        [dx, 300],
      ],
      t0: 2.1,
      t1: 2.45,
      weight: "thin",
      tone: "ink",
    });
    prims.push({
      pts: [
        [dx - 9, -272],
        [dx, -300],
        [dx + 9, -272],
      ],
      t0: 2.4,
      t1: 2.5,
      weight: "thin",
      tone: "ink",
    });
    prims.push({
      pts: [
        [dx - 9, 272],
        [dx, 300],
        [dx + 9, 272],
      ],
      t0: 2.4,
      t1: 2.5,
      weight: "thin",
      tone: "ink",
    });
    labels.push({
      text: "Ø 600",
      x: dx - 22,
      y: 0,
      t0: 2.35,
      t1: 2.65,
      size: 30,
      rot: -Math.PI / 2,
      align: "center",
    });
    // Thickness over the side view.
    prims.push({
      pts: [
        [sx - 45, -310],
        [sx - 45, -372],
      ],
      t0: 2.05,
      t1: 2.2,
      weight: "thin",
      tone: "ink",
    });
    prims.push({
      pts: [
        [sx + 45, -310],
        [sx + 45, -372],
      ],
      t0: 2.07,
      t1: 2.22,
      weight: "thin",
      tone: "ink",
    });
    prims.push({
      pts: [
        [sx - 45, -358],
        [sx + 45, -358],
      ],
      t0: 2.15,
      t1: 2.4,
      weight: "thin",
      tone: "ink",
    });
    labels.push({ text: "90", x: sx, y: -372, t0: 2.35, t1: 2.55, size: 30, align: "center" });
    // Bore callout leader.
    prims.push({
      pts: [
        [30, 30],
        [150, 250],
        [250, 250],
      ],
      t0: 2.2,
      t1: 2.5,
      weight: "thin",
      tone: "ink",
    });
    labels.push({ text: "Ø 84 H7", x: 160, y: 238, t0: 2.4, t1: 2.75, size: 26, align: "left" });
    // Accent: detail circle on one tooth.
    const ta = -Math.PI / 2 + (4 / teeth) * TAU;
    const dcx = Math.cos(ta) * 285;
    const dcy = Math.sin(ta) * 285;
    prims.push({
      pts: circle(dcx, dcy, 62, 64, ta),
      t0: 2.5,
      t1: 2.9,
      weight: "thick",
      tone: "accent",
    });
    prims.push({
      pts: [
        [dcx + 44, dcy - 44],
        [dcx + 110, dcy - 120],
        [dcx + 190, dcy - 120],
      ],
      t0: 2.75,
      t1: 2.95,
      weight: "thin",
      tone: "accent",
    });
    labels.push({
      text: "DETAIL A",
      x: dcx + 118,
      y: dcy - 132,
      t0: 2.85,
      t1: 3.15,
      size: 26,
      tone: "accent",
      align: "left",
    });
    return { prims, labels };
  });
}

const polyLength = (pts: Pt[]) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
};

/** Stroke the first `p` of a polyline; returns the pen tip. */
function strokePart(c: Ctx2D, pts: Pt[], p: number, map: (q: Pt) => Pt): Pt | null {
  if (p <= 0) return null;
  const total = polyLength(pts);
  let left = total * Math.min(1, p);
  c.beginPath();
  let [x, y] = map(pts[0]);
  c.moveTo(x, y);
  let tip: Pt = [x, y];
  for (let i = 1; i < pts.length && left > 0; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const k = Math.min(1, left / (seg || 1));
    const q: Pt = [
      pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k,
      pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k,
    ];
    [x, y] = map(q);
    c.lineTo(x, y);
    tip = [x, y];
    left -= seg;
  }
  c.stroke();
  return tip;
}

function paper(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const step = Math.max(4, Math.round(u / 100));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.3), y / (u * 0.3), 7.7, 3);
        c.fillStyle = n > 0 ? rgba(theme.accent2, 0.05 * n) : rgba("#000000", -0.12 * n);
        c.fillRect(x, y, step, step);
      }
    // Grid.
    const g = u / 36;
    c.lineWidth = Math.max(1, u * 0.0008);
    for (let i = 0, x = (w / 2) % g; x < w; x += g, i++) {
      c.strokeStyle = rgba(theme.accent2, i % 5 === Math.round((w / 2 / g) % 5) ? 0.2 : 0.09);
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, 0);
      c.lineTo(Math.round(x) + 0.5, h);
      c.stroke();
    }
    for (let i = 0, y = (h / 2) % g; y < h; y += g, i++) {
      c.strokeStyle = rgba(theme.accent2, i % 5 === Math.round((h / 2 / g) % 5) ? 0.2 : 0.09);
      c.beginPath();
      c.moveTo(0, Math.round(y) + 0.5);
      c.lineTo(w, Math.round(y) + 0.5);
      c.stroke();
    }
    // Sheet border with zone ticks.
    const m = u * 0.035;
    c.strokeStyle = rgba(theme.ink, 0.55);
    c.lineWidth = Math.max(1, u * 0.0016);
    c.strokeRect(m, m, w - m * 2, h - m * 2);
    c.lineWidth = Math.max(1, u * 0.0009);
    c.strokeRect(m * 0.55, m * 0.55, w - m * 1.1, h - m * 1.1);
    c.fillStyle = rgba(theme.ink, 0.5);
    c.font = font(500, Math.max(6, u * 0.016), "JetBrains Mono", MONO);
    c.textAlign = "center";
    c.textBaseline = "middle";
    const zones = 6;
    for (let i = 0; i < zones; i++) {
      const x = m + ((w - m * 2) * (i + 0.5)) / zones;
      c.fillText(String(i + 1), x, m * 0.78);
      c.fillText(String(i + 1), x, h - m * 0.78);
    }
    for (let i = 0; i < 4; i++) {
      const y = m + ((h - m * 2) * (i + 0.5)) / 4;
      c.fillText("ABCD"[i], m * 0.78, y);
      c.fillText("ABCD"[i], w - m * 0.78, y);
    }
    const r = rng(5);
    for (let i = 0; i < 180; i++) {
      c.fillStyle = rgba(theme.ink, 0.03 + r() * 0.05);
      c.fillRect(r() * w, r() * h, u * 0.002, u * 0.002);
    }
  };
}

export const style: MotionStyle = {
  id: "blueprint-draw",
  name: "Blueprint Draw-on",
  look: "A cyanotype engineering sheet: grid, zone border, a gear and its section drawn in chalk-white lines with dimensions.",
  move: "A plotter pen draws each line in order, dimensions extend and type on, one amber detail circle lands, then it all un-draws.",
  rules: [
    "Two line weights only: thick for the object, thin for centre, hidden and dimension lines.",
    "Centre lines are dash-dot, hidden lines dashed, section hatching at 45°.",
    "Draw in the order a drafter would: centre lines, outline, features, dimensions.",
    "A pen crosshair rides the tip of whatever is being drawn.",
    "Labels type on after their dimension line lands.",
    "One amber callout is the only colour.",
    "A faint underlay of the finished drawing is always visible.",
  ],
  prompt: `R — References
• Cyanotype engineering blueprints: white line on deep blue paper, grids, zone borders, title blocks.
• Technical drawing conventions (ISO 128): line weights, dash-dot centre lines, 45° section hatching, dimension arrows.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.6 s): on a gridded blue sheet, a plotter pen draws the centre lines and then the gear outline tooth by tooth.
• Middle (1.6–3.1 s): features, the section view and its hatching fill in; dimensions extend and type on; one amber "Detail A" circle lands.
• End (3.1–5 s): the drawing holds, then un-draws back to its faint underlay, ready to begin again.

S — Style
Looks: {{bg}} cyanotype paper with mottling, {{accent2}} grid and centre lines, {{ink}} chalk-white object lines with a faint glow, one {{accent}} callout, JetBrains Mono labels, a title block reading "{{name}}".
Moves: each line reveals along its length (ease in-out), staggered in drafting order; a crosshair rides the pen tip; labels type on; the un-draw runs the reveal backwards.
Rules:
1. Two line weights; thin for construction and dimensions.
2. Dash-dot centre lines, dashed hidden lines, 45° hatching.
3. Drafting order, never all at once.
4. Labels only after their dimension line exists.
5. One accent callout.
6. Paper texture, grain and a soft light falloff.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; dimension arrows touch their extension lines; no label overlaps a line; the gear teeth are even; line weights stay consistent at every size. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Blueprint",
  theme: {
    bg: "#0a2340",
    ink: "#e8f1fb",
    accent: "#ffc857",
    accent2: "#6ea8e0",
    font: "JetBrains Mono",
  },
  fonts: ["JetBrains Mono:wght@400;500;700"],
  tags: [
    "blueprint",
    "technical",
    "engineering",
    "drawing",
    "cad",
    "architecture",
    "line",
    "draw",
    "sketch",
    "plan",
    "diagram",
    "draws",
    "logo",
    "reveal",
    "outline",
  ],
  word: "Motion Library",
  family: "Data & Diagrams",
  tagline: "A gear plotted on cyanotype",
  render(ctx, t, theme, w, h) {
    const { u, portrait, square } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `blueprint:${theme.bg}${theme.ink}${theme.accent2}`,
        w,
        h,
        paper(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.35, h * 0.25, Math.max(w, h) * 0.9, theme.accent2, 0.1);

    const { prims, labels } = drawing();
    // Fit the drawing (units -470..660 x -400..330) into the frame.
    const spanX = portrait ? 780 : 1140;
    const spanY = portrait ? 1450 : 760;
    const s =
      Math.min((w * (portrait ? 0.86 : 0.8)) / spanX, (h * 0.78) / spanY) * (square ? 0.98 : 1);
    const ox = portrait ? w * 0.52 : w * 0.5 - 95 * s;
    const oy = portrait ? h * 0.36 : h * 0.48;
    // Portrait stacks the section view under the front view.
    const map = (q: Pt): Pt =>
      portrait && q[0] > 450
        ? [ox + (q[0] - 560) * s, oy + (q[1] + 700) * s]
        : [ox + q[0] * s, oy + q[1] * s];

    const erase = ease.inOutCubic(seg(t, 4.1, 4.85));
    const thick = Math.max(1.2, u * 0.0024);
    const thin = Math.max(0.8, u * 0.0012);
    const tone = (k: Prim["tone"]) =>
      k === "ink" ? theme.ink : k === "accent" ? theme.accent : theme.accent2;

    // Underlay: the finished drawing, faint.
    const under = bake(`blueprint-under:${theme.ink}${theme.accent2}`, w, h, (c) => {
      c.lineCap = "round";
      c.lineJoin = "round";
      for (const p of prims) {
        c.strokeStyle = rgba(tone(p.tone), 0.12);
        c.lineWidth = p.weight === "thick" ? thick : thin;
        c.setLineDash((p.dash || []).map((d) => d * s));
        strokePart(c, p.pts, 1, map);
      }
    });
    ctx.drawImage(under as CanvasImageSource, 0, 0);

    // Live drawing.
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let pen: Pt | null = null;
    let penTone = theme.ink;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const on = ease.inOutCubic(seg(t, p.t0, p.t1));
      const off = seg(erase, (i / prims.length) * 0.4, 0.6 + (i / prims.length) * 0.4);
      const shown = on * (1 - off);
      if (shown <= 0) continue;
      const color = tone(p.tone);
      ctx.setLineDash((p.dash || []).map((d) => d * s));
      // Glow pass, then the crisp line.
      ctx.strokeStyle = rgba(color, 0.14);
      ctx.lineWidth = (p.weight === "thick" ? thick : thin) * 3.2;
      strokePart(ctx, p.pts, shown, map);
      ctx.strokeStyle = rgba(color, p.tone === "accent2" ? 0.85 : 0.95);
      ctx.lineWidth = p.weight === "thick" ? thick : thin;
      const tip = strokePart(ctx, p.pts, shown, map);
      if (on > 0 && on < 1 && erase === 0 && tip) {
        pen = tip;
        penTone = color;
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Labels type on, and type off during the erase.
    ctx.save();
    for (const l of labels) {
      const n = Math.floor(l.text.length * seg(t, l.t0, l.t1) * (1 - seg(erase, 0.1, 0.7)));
      if (n <= 0) continue;
      const [x, y] = map([l.x, l.y]);
      ctx.save();
      ctx.translate(x, y);
      if (l.rot) ctx.rotate(l.rot);
      ctx.font = font(500, l.size * s, "JetBrains Mono", MONO);
      ctx.textAlign = l.align || "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = l.tone === "accent" ? theme.accent : theme.ink;
      ctx.fillText(l.text.slice(0, n), 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // Pen crosshair.
    if (pen) {
      const r = u * 0.014;
      ctx.save();
      ctx.strokeStyle = rgba(penTone, 0.9);
      ctx.lineWidth = Math.max(1, u * 0.0014);
      ctx.beginPath();
      ctx.moveTo(pen[0] - r * 1.8, pen[1]);
      ctx.lineTo(pen[0] + r * 1.8, pen[1]);
      ctx.moveTo(pen[0], pen[1] - r * 1.8);
      ctx.lineTo(pen[0], pen[1] + r * 1.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pen[0], pen[1], r * 0.7, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = rgba(theme.ink, 0.9);
      ctx.beginPath();
      ctx.arc(pen[0], pen[1], Math.max(1, u * 0.003), 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Title block, bottom right.
    const m = u * 0.035;
    const bw = Math.min(w * 0.36, u * 0.62);
    const bh = u * 0.13;
    const bx = w - m - bw;
    const by = h - m - bh;
    ctx.save();
    ctx.fillStyle = rgba(theme.bg, 0.86);
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = rgba(theme.ink, 0.6);
    ctx.lineWidth = Math.max(1, u * 0.0014);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.beginPath();
    ctx.moveTo(bx, by + bh * 0.58);
    ctx.lineTo(bx + bw, by + bh * 0.58);
    ctx.moveTo(bx + bw * 0.5, by + bh * 0.58);
    ctx.lineTo(bx + bw * 0.5, by + bh);
    ctx.stroke();
    const title = wordFor(theme.name, "Motion Library", 18).toUpperCase();
    const mark = tintedLogo(theme, theme.ink, bh * 0.42, bh * 0.42);
    const tx = bx + bw * 0.05 + (mark ? bh * 0.52 : 0);
    if (mark) ctx.drawImage(mark as CanvasImageSource, bx + bw * 0.05, by + bh * 0.09);
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = font(
      700,
      Math.min(bh * 0.3, (bx + bw * 0.95 - tx) / Math.max(6, title.length * 0.62)),
      "JetBrains Mono",
      MONO,
    );
    ctx.fillText(title, tx, by + bh * 0.3);
    ctx.font = font(500, bh * 0.16, "JetBrains Mono", MONO);
    ctx.fillStyle = rgba(theme.ink, 0.7);
    ctx.fillText("SHEET 04", bx + bw * 0.05, by + bh * 0.79);
    ctx.fillText("SCALE 1:2", bx + bw * 0.55, by + bh * 0.79);
    ctx.restore();

    vignette(ctx, w, h, mix(theme.bg, "#000000", 0.6), 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
