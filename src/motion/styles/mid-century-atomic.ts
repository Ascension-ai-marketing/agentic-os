import { mix, rgba } from "../engine/color";
import { bake, font, frameOf, LOOP, TAU, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { finish, fitBox, sparklePath, stock, taper, tooth, tracked, turn } from "./_s3-helpers";

const SCRIPT = "Yellowtail";
const SCRIPT_FALLBACK = '"Brush Script MT", cursive';
const SANS = "Jost";

type Layout = {
  atom: [number, number, number];
  kidney: [number, number, number, number];
  word: [number, number, number, number]; // cx, baseline, max width, max height
  bursts: [number, number, number, number][]; // x, y, r, colour slot
  booms: [number, number, number, number, number][]; // x, y, size, angle, colour slot
  sparks: [number, number, number][];
};

function layout(w: number, h: number): Layout {
  const { u, portrait, square } = frameOf(w, h);
  const P = (x: number, y: number) => [x * w, y * h] as const;
  if (portrait)
    return {
      atom: [...P(0.5, 0.33), u * 0.36],
      kidney: [...P(0.5, 0.35), u * 0.46, -0.3],
      word: [...P(0.5, 0.72), w * 0.84, u * 0.26],
      bursts: [
        [...P(0.16, 0.1), u * 0.1, 2],
        [...P(0.86, 0.56), u * 0.075, 0],
        [...P(0.2, 0.9), u * 0.08, 1],
      ],
      booms: [
        [...P(0.84, 0.12), u * 0.1, 0.5, 0],
        [...P(0.12, 0.56), u * 0.09, -0.4, 1],
        [...P(0.8, 0.9), u * 0.1, 2.9, 2],
      ],
      sparks: [
        [0.5, 0.06, 0.03],
        [0.93, 0.34, 0.025],
        [0.07, 0.36, 0.022],
        [0.5, 0.93, 0.03],
      ],
    };
  if (square)
    return {
      atom: [...P(0.34, 0.4), u * 0.25],
      kidney: [...P(0.36, 0.42), u * 0.36, -0.2],
      word: [...P(0.64, 0.79), w * 0.56, u * 0.17],
      bursts: [
        [...P(0.84, 0.18), u * 0.1, 2],
        [...P(0.1, 0.84), u * 0.07, 0],
        [...P(0.68, 0.52), u * 0.05, 1],
      ],
      booms: [
        [...P(0.66, 0.14), u * 0.08, 0.4, 0],
        [...P(0.13, 0.12), u * 0.075, -0.5, 1],
        [...P(0.9, 0.6), u * 0.075, 2.8, 2],
      ],
      sparks: [
        [0.5, 0.08, 0.025],
        [0.93, 0.36, 0.02],
        [0.05, 0.5, 0.02],
        [0.36, 0.93, 0.025],
      ],
    };
  return {
    atom: [...P(0.33, 0.5), u * 0.3],
    kidney: [...P(0.34, 0.5), u * 0.42, -0.25],
    word: [...P(0.72, 0.58), w * 0.4, u * 0.22],
    bursts: [
      [...P(0.09, 0.18), u * 0.1, 2],
      [...P(0.9, 0.2), u * 0.08, 0],
      [...P(0.58, 0.86), u * 0.055, 1],
      [...P(0.95, 0.86), u * 0.05, 2],
    ],
    booms: [
      [...P(0.1, 0.82), u * 0.1, -0.5, 1],
      [...P(0.6, 0.15), u * 0.09, 0.45, 0],
      [...P(0.8, 0.86), u * 0.085, 2.9, 2],
    ],
    sparks: [
      [0.48, 0.1, 0.028],
      [0.72, 0.3, 0.022],
      [0.2, 0.92, 0.022],
      [0.97, 0.52, 0.02],
      [0.03, 0.5, 0.02],
    ],
  };
}

function palette(theme: Theme) {
  return [theme.accent, theme.accent2, turn(theme.accent, 45, 0.8, 0.14), theme.ink];
}

/** The 50s kidney (amoeba) shape. */
function kidney(c: Ctx2D, x: number, y: number, r: number, a: number) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.beginPath();
  c.moveTo(-r * 1.1, 0);
  c.bezierCurveTo(-r * 1.2, -r * 0.8, -r * 0.2, -r * 0.95, r * 0.25, -r * 0.55);
  c.bezierCurveTo(r * 0.6, -r * 0.3, r * 1.25, -r * 0.7, r * 1.2, r * 0.05);
  c.bezierCurveTo(r * 1.15, r * 0.75, r * 0.2, r * 0.85, -r * 0.3, r * 0.6);
  c.bezierCurveTo(-r * 0.8, r * 0.4, -r * 1.05, r * 0.55, -r * 1.1, 0);
  c.closePath();
  c.restore();
}

/** A Sputnik starburst: rays tipped with balls, long and short in turn. */
function burst(c: Ctx2D, x: number, y: number, r: number, rot: number, col: string, ink: string) {
  const n = 12;
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = Math.max(1, r * 0.065);
  c.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const L = r * (i % 2 ? 0.62 : 1);
    const ex = x + Math.cos(a) * L;
    const ey = y + Math.sin(a) * L;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.16);
    c.lineTo(ex, ey);
    c.stroke();
    c.beginPath();
    c.arc(ex, ey, r * (i % 2 ? 0.06 : 0.085), 0, TAU);
    c.fill();
  }
  c.fillStyle = ink;
  c.beginPath();
  c.arc(x, y, r * 0.16, 0, TAU);
  c.fill();
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, r * 0.08, 0, TAU);
  c.fill();
}

/** The Formica boomerang: a pointed elbow, two tapering arms (one longer), round tips. */
function boomerangPath(c: Ctx2D, s: number) {
  const l = 0.82; // the left arm is shorter
  c.beginPath();
  c.moveTo(-s * l, s * 0.3);
  c.quadraticCurveTo(-s * 0.46 * l, -s * 0.08, 0, -s * 0.38);
  c.quadraticCurveTo(s * 0.5, -s * 0.08, s, s * 0.32);
  c.quadraticCurveTo(s * 1.05, s * 0.48, s * 0.86, s * 0.47);
  c.quadraticCurveTo(s * 0.46, s * 0.2, 0, -s * 0.02);
  c.quadraticCurveTo(-s * 0.42 * l, s * 0.2, -s * 0.86 * l, s * 0.45);
  c.quadraticCurveTo(-s * 1.05 * l, s * 0.46, -s * l, s * 0.3);
  c.closePath();
}

function boomerang(
  c: Ctx2D,
  x: number,
  y: number,
  s: number,
  a: number,
  col: string,
  shade: string,
) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.fillStyle = rgba("#000000", 0.3);
  c.save();
  c.translate(s * 0.04, s * 0.06);
  boomerangPath(c, s);
  c.fill();
  c.restore();
  c.fillStyle = col;
  boomerangPath(c, s);
  c.fill();
  // The far arm sits in shade, like a folded laminate.
  c.save();
  boomerangPath(c, s);
  c.clip();
  c.fillStyle = shade;
  c.fillRect(0, -s, s * 1.2, s * 2);
  c.restore();
  c.restore();
}

export const style: MotionStyle = {
  id: "mid-century-atomic",
  name: "Atomic Age",
  family: "Design Movements",
  tagline: "Starbursts, boomerangs, an atom",
  look: "1950s atomic print: coral, turquoise and mustard starbursts, boomerangs and a whirling atom, with script type.",
  move: "Electrons whirl round their orbits at one, two and three turns a loop; starbursts turn and twinkle; boomerangs swing like a mobile.",
  rules: [
    "Coral, turquoise and mustard with cream, on a deep teal ground.",
    "Every orbit and spin is a whole number of turns per loop.",
    "Starbursts have ball-tipped rays, long and short in turn.",
    "Boomerangs and kidneys: soft, organic, asymmetric forms.",
    "The word is set in a 50s script with a tapering swoosh under it.",
    "Motion is sunny and smooth: sines, no snaps.",
    "A printed tooth and grain, like a laminate or a record sleeve.",
  ],
  prompt: `R — References
• 1950s atomic-age design: George Nelson's Ball clock, Formica boomerang laminate, Sputnik starbursts (search: atomic age pattern, boomerang formica, sputnik starburst).
• Googie signage script lettering.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): an atom sits on a soft kidney shape, electrons whirling round three orbits; starbursts and boomerangs float around it; the word "{{name}}" is set in script with a swoosh.
• Middle (1.5–3.5 s): starbursts turn and twinkle one after another; boomerangs swing like a mobile; the electrons trail light.
• End (3.5–5 s): every electron and burst completes a whole number of turns and lands where it began.

S — Style
Looks: {{bg}} ground with a paler kidney; {{accent}} coral, {{accent2}} turquoise and a mustard turned from {{accent}}; {{ink}} cream for orbits and the script word (Yellowtail); small tracked caps in Jost.
Moves: electrons at one, two and three turns per loop; bursts rotate one ray pair per loop and pulse; boomerangs swing ±15° on sines; the nucleus jiggles.
Rules:
1. Coral, turquoise, mustard and cream only.
2. Whole-number turns for every orbit and spin.
3. Ball-tipped starburst rays.
4. Organic boomerang and kidney shapes.
5. Script word with a swoosh.
6. Smooth sines; grain on everything.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; nothing overlaps the word; orbits read as ellipses around one nucleus; the script's descenders are not clipped; bursts read at tile size. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Atomic_Age_(design)",
  theme: {
    bg: "#101a1a",
    ink: "#f5ead2",
    accent: "#ff7150",
    accent2: "#38c6b4",
    font: SCRIPT,
  },
  fonts: ["Yellowtail", "Jost:wght@500..700"],
  tags: [
    "atomic",
    "mid-century",
    "1950s",
    "50s",
    "retro",
    "starburst",
    "boomerang",
    "googie",
    "space age",
    "sputnik",
    "vintage",
    "design movement",
  ],
  word: "Atomic",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const L = layout(w, h);
    ctx.drawImage(
      bake(
        `atomic-stock:${theme.bg}${theme.ink}`,
        w,
        h,
        stock(theme, 61, 0.9, 0.5),
      ) as CanvasImageSource,
      0,
      0,
    );
    const pal = palette(theme);
    const ph = TAU * (t / LOOP);

    // Kidney backdrop.
    {
      const [x, y, r, a] = L.kidney;
      kidney(ctx, x, y, r, a + Math.sin(ph) * 0.03);
      ctx.fillStyle = mix(theme.bg, theme.accent2, 0.14);
      ctx.fill();
      kidney(ctx, x + u * 0.012, y + u * 0.012, r, a + Math.sin(ph) * 0.03);
      ctx.strokeStyle = rgba(theme.ink, 0.35);
      ctx.lineWidth = Math.max(1, u * 0.0022);
      ctx.stroke();
    }

    // Boomerangs, swinging like a mobile.
    L.booms.forEach(([x, y, s, a, c], i) => {
      const swing = Math.sin(ph + i * 2.1) * 0.26;
      const bob = Math.sin(ph * 2 + i) * u * 0.008;
      boomerang(ctx, x, y + bob, s, a + swing, pal[c], mix(pal[c], theme.bg, 0.3));
    });

    // Starbursts: one ray pair per loop, twinkling in turn.
    L.bursts.forEach(([x, y, r, c], i) => {
      const pulse = 1 + 0.08 * Math.sin(ph * 2 + i * 1.7);
      burst(ctx, x, y, r * pulse, (TAU / 6) * (t / LOOP) + i * 0.3, pal[c], theme.ink);
    });

    // Sparkles.
    L.sparks.forEach(([sx, sy, ss], i) => {
      const k = 0.5 + 0.5 * Math.sin(ph + i * 1.9);
      ctx.fillStyle = mix(pal[2], theme.ink, 0.4 * k);
      sparklePath(ctx, sx * w, sy * h, ss * u * (0.6 + 0.6 * k), 0, 0.22);
      ctx.fill();
    });

    // The atom: three orbits, electrons at 1, 2 and 3 turns per loop, a jiggling nucleus.
    {
      const [x, y, R] = L.atom;
      const orbits = [0, Math.PI / 3, (2 * Math.PI) / 3];
      ctx.lineWidth = Math.max(1, u * 0.0035);
      for (const a of orbits) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.strokeStyle = rgba(theme.ink, 0.75);
        ctx.beginPath();
        ctx.ellipse(0, 0, R, R * 0.34, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      orbits.forEach((a, i) => {
        const speed = i + 1;
        const e = (s: number) => {
          const th = ph * speed + i * 2.2 - s;
          const ex = Math.cos(th) * R;
          const ey = Math.sin(th) * R * 0.34;
          return [
            x + ex * Math.cos(a) - ey * Math.sin(a),
            y + ex * Math.sin(a) + ey * Math.cos(a),
          ] as [number, number];
        };
        // A short comet trail.
        const trail: [number, number][] = [];
        for (let k = 12; k >= 0; k--) trail.push(e(k * 0.05 * (1 + i * 0.4)));
        ctx.fillStyle = rgba(pal[i], 0.55);
        taper(ctx, trail, (s) => u * 0.009 * s);
        const [px, py] = e(0);
        ctx.fillStyle = pal[i];
        ctx.beginPath();
        ctx.arc(px, py, u * 0.014, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(theme.ink, 0.9);
        ctx.beginPath();
        ctx.arc(px - u * 0.004, py - u * 0.004, u * 0.004, 0, TAU);
        ctx.fill();
      });
      const nuc: [number, number, number][] = [
        [0, 0, 0],
        [1, 0, 1],
        [-0.5, 0.87, 2],
        [-0.5, -0.87, 1],
        [0.5, 0.87, 0],
        [0.5, -0.87, 2],
        [-1, 0, 0],
      ];
      const nr = R * 0.07;
      nuc.forEach(([nx, ny, c], i) => {
        const j = Math.sin(ph * 3 + i * 1.3) * nr * 0.12;
        ctx.fillStyle = pal[c];
        ctx.beginPath();
        ctx.arc(x + nx * nr * 1.15 + j, y + ny * nr * 1.15 - j, nr, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(theme.ink, 0.5);
        ctx.beginPath();
        ctx.arc(
          x + nx * nr * 1.15 + j - nr * 0.3,
          y + ny * nr * 1.15 - j - nr * 0.3,
          nr * 0.28,
          0,
          TAU,
        );
        ctx.fill();
      });
    }

    // Script word with a tapering swoosh, and tracked caps under it.
    const [wx, wy, ww, wh] = L.word;
    const word = wordFor(theme.name, "Atomic", 12);
    const wt = theme.font === SCRIPT ? 400 : 600;
    const size = fitBox(ctx, word, ww, wh, wt, theme.font, SCRIPT_FALLBACK, 0.7);
    ctx.font = font(wt, size, theme.font, SCRIPT_FALLBACK);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const tw = ctx.measureText(word).width;
    ctx.fillStyle = rgba("#000000", 0.35);
    ctx.fillText(word, wx + size * 0.03, wy + size * 0.04);
    ctx.fillStyle = theme.ink;
    ctx.fillText(word, wx, wy);
    const sw: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      sw.push([
        wx - tw * 0.52 + tw * 1.05 * f,
        wy + size * 0.3 - Math.sin(f * Math.PI) * size * 0.1 + f * size * 0.02,
      ]);
    }
    ctx.fillStyle = theme.accent;
    taper(ctx, sw, (s) => size * 0.045 * Math.sin(Math.PI * Math.min(1, s * 1.15)) + size * 0.004);
    const cap = Math.max(7, size * 0.16);
    ctx.font = font(600, cap, SANS, SCRIPT_FALLBACK);
    ctx.fillStyle = theme.accent2;
    tracked(ctx, "EST. 1958", wx, wy + size * 0.62, cap * 0.4, "center");
    ctx.textAlign = "left";
    const mark = tintedLogo(theme, theme.ink, u * 0.07, u * 0.07);
    if (mark) ctx.drawImage(mark as CanvasImageSource, wx - u * 0.035, wy - size * 1.25);

    tooth(ctx, w, h, 0.42, 61);
    finish(ctx, w, h, t, 0.45, 0.3);
  },
};
