import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  font,
  frameOf,
  grain,
  ground,
  light,
  LOOP,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { atlas, glow, stepFrame } from "./_s4-helpers";

const MONO = '"JetBrains Mono", "SFMono-Regular", Menlo, monospace';
/** donut.c's twelve-step ramp, dark to bright. */
const RAMP = ".,-~:;=!*#$@";
const TONES = 6;
const R1 = 1;
const R2 = 2.05;
const K2 = 6.2;
/** Samples round the tube and round the ring (even, so the half-turn maps the grid onto itself). */
const NT = 110;
const NP = 300;

interface Grid {
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  size: number;
  x0: number;
  y0: number;
}

function gridFor(w: number, h: number): Grid {
  const { portrait } = frameOf(w, h);
  const rows = portrait ? 66 : 38;
  const size = h / rows;
  const cw = size * 0.6;
  const cols = Math.floor(w / cw);
  return { cols, rows, cw, ch: size, size, x0: (w - cols * cw) / 2, y0: 0 };
}

/** The empty terminal grid: a faint dot in every cell, baked once per size. */
function field(theme: Theme, g: Grid) {
  return (c: Ctx2D, w: number, h: number) => {
    c.fillStyle = mix(theme.bg, theme.ink, 0.11);
    const r = Math.max(0.6, g.size * 0.05);
    for (let j = 0; j < g.rows; j++)
      for (let i = 0; i < g.cols; i++)
        c.fillRect(g.x0 + (i + 0.5) * g.cw - r, (j + 0.62) * g.ch - r, r * 2, r * 2);
    void w;
    void h;
  };
}

export const style: MotionStyle = {
  id: "ascii-art",
  name: "ASCII Donut",
  family: "Retro Tech",
  tagline: "A torus made of characters",
  look: "A torus built from monospace characters on a dotted terminal grid, shaded from cool dim glyphs to hot bright ones.",
  move: "Tilted toward you, the donut precesses one full turn a loop with a slow nod; every cell re-picks its glyph from the light.",
  rules: [
    "Only characters on one monospace grid; brightness is the choice of glyph, never alpha alone.",
    "The twelve-step ramp from donut.c: . , - ~ : ; = ! * # $ @",
    "Colour follows light too: dim glyphs cool, lit glyphs ink, the hottest in the accent.",
    "Z-buffered per cell, so the near side of the ring hides the far side.",
    "One full precession and one nod per loop, so it closes; the hole always shows.",
    "Empty cells show a faint dot, so the grid is always felt.",
  ],
  prompt: `R — References
• Andy Sloane's donut.c (2006): a spinning ASCII torus in a terminal (search: donut.c ascii donut).
• ASCII shaders and text-mode demoscene art: brightness chosen by glyph density.

I — Idea
One object, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a torus made of characters leans toward us on a dotted grid; its lit side is dense (# $ @), its dark side sparse (. , -).
• Middle (1.5–3.5 s): it precesses like a spinning coin and nods; every cell re-picks its glyph as the light slides across it.
• End (3.5–5 s): one full precession and one nod bring it exactly back to its first frame.

S — Style
Looks: {{bg}} ground; a faint dot in every empty cell; glyphs in JetBrains Mono coloured from {{accent2}} (dim) through {{ink}} to {{accent}} (hottest); a soft glow; a small caption "{{name}}" in the corner.
Moves: tilt 58° ± 17° (one nod per loop), spin 360° about the view axis per loop at constant speed; per-cell z-buffer; luminance = normal · light, mapped onto the 12-step ramp.
Rules:
1. Glyph density carries brightness.
2. Colour ramps with the same luminance.
3. Per-cell z-buffer.
4. Seamless: one full precession per loop.
5. The grid stays visible in empty cells.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the torus reads as 3D at thumbnail size; no holes in the surface; characters sit exactly on the grid; the caption never touches the torus. Fix what fails and render again until every check passes.`,
  ref: "https://www.a1k0n.net/2011/07/20/donut-math.html",
  theme: {
    bg: "#09090b",
    ink: "#ece6da",
    accent: "#ff8a2a",
    accent2: "#5b7cff",
    font: "JetBrains Mono",
  },
  fonts: ["JetBrains Mono:wght@400..800"],
  tags: [
    "ascii",
    "text art",
    "characters",
    "donut",
    "torus",
    "terminal",
    "code",
    "typography",
    "3d",
    "hacker",
    "retro",
    "monospace",
  ],
  word: "donut.c",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    light(ctx, w * 0.5, h * 0.5, Math.max(w, h) * 0.7, theme.accent2, 0.06);
    const g = gridFor(w, h);
    ctx.drawImage(
      bake(
        `ascii-field:${theme.bg}${theme.ink}:${g.cols}x${g.rows}`,
        w,
        h,
        field(theme, g),
      ) as CanvasImageSource,
      0,
      0,
    );

    // Rotation: one full turn about X, a half turn about Z (a symmetry of the torus).
    // Tilted toward us and precessing: one full turn about the view axis per
    // loop, with a gentle nod, so the hole always shows.
    const A = 1.02 + 0.3 * Math.sin((TAU * t) / LOOP);
    const B = (TAU * t) / LOOP + 0.5;
    const cA = Math.cos(A);
    const sA = Math.sin(A);
    const cB = Math.cos(B);
    const sB = Math.sin(B);
    // Screen scale: the ring fills most of the stage.
    const reach = Math.min(h * (portrait ? 0.3 : 0.43), w * 0.42);
    const K1 = (reach * K2) / (R1 + R2) / 1.12;
    const n = g.cols * g.rows;
    const zbuf = new Float32Array(n);
    const lum = new Int8Array(n).fill(-1);
    const cx = w / 2;
    const cy = h / 2;
    // Light from above-left, toward the viewer.
    const lx = -0.36;
    const ly = 0.68;
    const lz = -0.64;
    for (let i = 0; i < NT; i++) {
      const th = (i / NT) * TAU;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      const cr = R2 + R1 * ct;
      const y0 = R1 * st;
      for (let j = 0; j < NP; j++) {
        const ph = (j / NP) * TAU;
        const cp = Math.cos(ph);
        const sp = Math.sin(ph);
        // Point and normal on the torus (ring round Y).
        const px = cr * cp;
        const pz = -cr * sp;
        const nx = ct * cp;
        const ny = st;
        const nz = -ct * sp;
        // Tilt about X by A, then spin about the view axis by B (precession).
        const y1 = y0 * cA - pz * sA;
        const z1 = y0 * sA + pz * cA;
        const x2 = px * cB - y1 * sB;
        const y2 = px * sB + y1 * cB;
        const ny1 = ny * cA - nz * sA;
        const nz1 = ny * sA + nz * cA;
        const nx2 = nx * cB - ny1 * sB;
        const ny2 = nx * sB + ny1 * cB;
        const ooz = 1 / (z1 + K2);
        const xs = cx + K1 * ooz * x2;
        const ys = cy - K1 * ooz * y2;
        const col = Math.floor((xs - g.x0) / g.cw);
        const row = Math.floor(ys / g.ch);
        if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) continue;
        const o = row * g.cols + col;
        if (ooz <= zbuf[o]) continue;
        zbuf[o] = ooz;
        const L = nx2 * lx + ny2 * ly + nz1 * lz;
        // A gamma on the light keeps the hottest glyphs (and the accent) for true highlights.
        lum[o] =
          L > 0
            ? Math.min(RAMP.length - 1, 1 + Math.floor(Math.pow(L, 1.45) * (RAMP.length - 1)))
            : 0;
      }
    }

    // Glyphs from a baked atlas: the ramp in six colours, dim-cool to hot.
    // Cool and visible in shadow, ink in the mid-tones, the accent only on the hottest glyphs.
    const tones = [
      mix(theme.accent2, theme.bg, 0.12),
      mix(theme.accent2, theme.ink, 0.3),
      mix(theme.accent2, theme.ink, 0.66),
      theme.ink,
      mix(theme.ink, theme.accent, 0.5),
      theme.accent,
    ];
    const at = atlas(
      `ascii`,
      RAMP,
      g.cw,
      g.ch,
      font(700, g.size * 0.94, "JetBrains Mono", MONO),
      tones,
      0.8,
    );
    const { canvas: layerC, ctx: L } = buffer("ascii-layer", w, h);
    L.clearRect(0, 0, w, h);
    const src = at.canvas as CanvasImageSource;
    for (let row = 0; row < g.rows; row++)
      for (let col = 0; col < g.cols; col++) {
        const k = lum[row * g.cols + col];
        if (k < 0) continue;
        const tone = Math.min(TONES - 1, Math.floor((k * TONES) / RAMP.length));
        const s = at.at(RAMP[k], tone);
        if (!s) continue;
        L.drawImage(
          src,
          s[0],
          s[1],
          at.cw,
          at.ch,
          Math.round(g.x0 + col * g.cw),
          Math.round(row * g.ch),
          at.cw,
          at.ch,
        );
      }
    glow(ctx, layerC as CanvasImageSource, "ascii", 0, 0, w, h, 6, 3, 0.7, "screen");
    ctx.drawImage(layerC as CanvasImageSource, 0, 0);

    // Caption and readout, set in the same mono on the grid.
    const cap = g.size * (portrait ? 1.3 : 1.15);
    ctx.font = font(600, cap, "JetBrains Mono", MONO);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.textAlign = "left";
    const name = wordFor(theme.name, "donut.c", 14);
    const mark = tintedLogo(theme, theme.ink, cap * 1.1, cap * 1.1);
    const left = g.x0 + g.cw * 3;
    const base = h - g.ch * 2.4;
    if (mark) ctx.drawImage(mark as CanvasImageSource, left, base - cap * 0.95);
    ctx.fillText(name, left + (mark ? cap * 1.6 : 0), base);
    ctx.textAlign = "right";
    ctx.fillStyle = mix(theme.ink, theme.bg, 0.45);
    const fr = stepFrame(t, 12) / 12;
    const a = 1.02 + 0.3 * Math.sin((TAU * fr) / LOOP);
    const b = ((TAU * fr) / LOOP + 0.5) % TAU;
    ctx.fillText(`A ${a.toFixed(2)}  B ${b.toFixed(2)}`, w - left, base);
    ctx.textAlign = "left";

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.26);
    void rgba;
    void u;
  },
};
