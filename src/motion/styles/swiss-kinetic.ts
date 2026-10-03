import { mix, rgba } from "../engine/color";
import {
  ease,
  fitSize,
  font,
  frameOf,
  grain,
  ground,
  light,
  lerp,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";

const WORD = "Motion";

export const style: MotionStyle = {
  id: "swiss-kinetic",
  name: "Swiss Poster Kinetic Type",
  look: "International Typographic Style: one huge grotesque word on a strict grid, a red disc, hairline rules.",
  move: "Letters rise out of a baseline mask, their weights ripple in a travelling wave, the disc steps across the grid on the beat.",
  rules: [
    "Everything snaps to a 12-column grid; nothing floats.",
    "One huge word, set tight (-2% tracking), flush left on the baseline.",
    "One red disc is the only colour; everything else is ink.",
    "Letters enter from a baseline mask, staggered 60 ms, quint-out.",
    "Weight is the motion: a wave of 260 to 860 travels through the word.",
    "The disc moves on the beat (every 1.25 s) and settles; no drift.",
    "Captions are tiny, set in the same family, never more than three words.",
  ],
  prompt: `R — References
• Josef Müller-Brockmann and the International Typographic Style: strict grids, asymmetric balance, one bold colour.
• Variable-font "weight wave" type animations (search: variable font kinetic typography).
• Match their discipline, not their layouts.

I — Idea
One image, told in 5 seconds, looping seamlessly:
• Beginning (0–1.3 s): an empty grid with a red disc; the word "{{name}}" rises letter by letter out of a mask on the baseline.
• Middle (1.3–3.9 s): the word holds while a weight wave travels through its letters; the disc steps to a new grid position on each beat.
• End (3.9–5 s): the letters lift out through the top of the mask, the rule retracts, and the frame is back where it began.

S — Style
Looks: {{bg}} ground, {{ink}} type and hairlines, one {{accent}} disc. {{font}}, heavy, tracking -2%, flush left on a 12-column grid with generous margins. Tiny captions in the same family.
Moves: quint-out entrances staggered 60 ms, a sine weight wave (260 to 860, two waves per loop), beat-locked disc moves of 0.7 s. Ease in and out, never linear.
Rules:
1. Every element sits on the grid: columns, baseline, margins.
2. One huge word; it fills about 85% of the grid width.
3. The disc is the only colour.
4. Letters enter from a baseline mask, staggered; they exit the same way, upward.
5. The weight wave is the motion; positions only change on entrances and exits.
6. Grain and a soft light falloff so the ground is never flat.
7. Hold the full word at least 1.2 s.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word fits with no clipped letters; the disc lands exactly on grid points; captions never collide with the word; the weight wave reads as one smooth wave. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/International_Typographic_Style",
  theme: { bg: "#0f0f0e", ink: "#f1eee7", accent: "#ff3b1f", accent2: "#7d7a73", font: "Inter" },
  fonts: ["Inter:wght@100..900"],
  tags: [
    "swiss",
    "type",
    "typography",
    "kinetic",
    "grid",
    "poster",
    "bold",
    "minimal",
    "words",
    "text",
    "tagline",
    "headline",
    "title",
    "brand",
  ],
  word: WORD,
  family: "Design Movements",
  tagline: "A grid, one word, a red disc",
  render(ctx, t, theme, w, h) {
    const { portrait, k } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    light(ctx, w * 0.2, h * 0.1, Math.max(w, h) * 0.9, theme.ink, 0.07);

    const mx = w * (portrait ? 0.08 : 0.06);
    const my = h * (portrait ? 0.07 : 0.1);
    const gw = w - mx * 2;
    const col = gw / 12;

    // Grid: faint column hairlines, always present.
    ctx.save();
    ctx.strokeStyle = rgba(theme.ink, 0.055);
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const x = Math.round(mx + i * col) + 0.5;
      ctx.moveTo(x, my);
      ctx.lineTo(x, h - my);
    }
    ctx.stroke();
    ctx.restore();

    // Top rule: draws on, holds, retracts to the right.
    const ruleY = my + h * 0.05;
    const on = ease.outQuint(seg(t, 0.3, 1.1));
    const off = ease.inOutCubic(seg(t, 4.3, 4.95));
    const x0 = mx + gw * off;
    const x1 = mx + gw * on;
    if (x1 > x0) {
      ctx.fillStyle = theme.ink;
      ctx.fillRect(x0, ruleY, x1 - x0, Math.max(1, h * 0.0028));
    }

    // Captions (tiny, same family).
    const cap = Math.max(7, h * (portrait ? 0.017 : 0.022));
    ctx.font = font(600, cap, theme.font);
    ctx.fillStyle = rgba(theme.ink, 0.86);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const mark = tintedLogo(theme, theme.ink, cap * 3.2, cap * 1.6);
    if (mark) ctx.drawImage(mark as CanvasImageSource, mx, ruleY - cap * 2.3);
    else ctx.fillText("Nº 08", mx, ruleY - cap * 0.7);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.fillText("Kinetic Type", mx + col * 3, ruleY - cap * 0.7);
    ctx.textAlign = "right";
    ctx.fillText("Grid 12 / 8", mx + gw, ruleY - cap * 0.7);
    ctx.textAlign = "left";

    // The disc steps across four grid points, one move per beat.
    const pts = portrait
      ? [
          [mx + col * 7.5, h * 0.4],
          [mx + col * 8.5, h * 0.3],
          [mx + col * 6.5, h * 0.52],
          [mx + col * 8, h * 0.64],
        ]
      : [
          [mx + col * 9, h * 0.42],
          [mx + col * 10.5, h * 0.33],
          [mx + col * 8, h * 0.3],
          [mx + col * 10, h * 0.5],
        ];
    const beat = 1.25;
    const b = Math.floor(t / beat) % 4;
    const from = pts[(b + 3) % 4];
    const to = pts[b];
    const local = t - Math.floor(t / beat) * beat;
    const m = ease.inOutQuint(seg(local, 0, 0.7));
    const cx = lerp(from[0], to[0], m);
    const cy = lerp(from[1], to[1], m);
    const R = Math.min(w, h) * (portrait ? 0.26 : 0.2);
    // Flat print colour with the faintest press shading: no gloss, no sphere.
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    const press = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
    press.addColorStop(0, rgba("#000000", 0));
    press.addColorStop(1, rgba("#000000", 0.08));
    ctx.fillStyle = press;
    ctx.fill();

    // The word: weight wave + baseline mask entrance and exit.
    // Portrait sets it vertically up the left margin, as Swiss posters do.
    const word = wordFor(theme.name, WORD, 12);
    const letters = [...word];
    ctx.save();
    if (portrait) {
      ctx.translate(mx + col * 0.2, h - my);
      ctx.rotate(-Math.PI / 2);
    }
    const run = portrait ? h - my * 2 : gw;
    const maxW = run * (portrait ? 0.96 : 0.9);
    const size = fitSize(ctx, word, maxW, portrait ? w * 0.62 : h * 0.62, 860, theme.font);
    const ox = portrait ? 0 : mx;
    const baseline = portrait ? size * 0.74 : h - my - size * 0.04;
    const weightAt = (i: number) => 560 + 300 * Math.sin((TAU * 2 * t) / 5 - i * 0.55);
    // Lay out with each letter's own weight so the wave breathes.
    const widths = letters.map((ch, i) => {
      ctx.font = font(Math.round(weightAt(i)), size, theme.font);
      return ctx.measureText(ch).width - size * 0.02;
    });
    ctx.beginPath();
    ctx.rect(portrait ? -10 : 0, baseline - size * 1.02, portrait ? h : w, size * 1.3);
    ctx.clip();
    let x = ox;
    ctx.fillStyle = theme.ink;
    for (let i = 0; i < letters.length; i++) {
      const enter = ease.outQuint(seg(t, 0.25 + i * 0.06, 1.0 + i * 0.06));
      const exit = ease.inCubic(seg(t, 3.9 + i * 0.05, 4.5 + i * 0.05));
      const dy = (1 - enter) * size * 1.05 - exit * size * 1.1;
      if (enter > 0 && exit < 1) {
        ctx.font = font(Math.round(weightAt(i)), size, theme.font);
        ctx.fillText(letters[i], x, baseline + dy);
      }
      x += widths[i];
    }
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.42);
    grain(ctx, w, h, t, 0.3);
  },
};
