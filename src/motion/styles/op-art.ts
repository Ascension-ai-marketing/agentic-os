import { mix } from "../engine/color";
import { frameOf, LOOP, TAU } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";
import { finish } from "./_s3-helpers";

export const style: MotionStyle = {
  id: "op-art",
  name: "Op Art Current",
  family: "Design Movements",
  tagline: "Riley stripes that bend",
  look: "Bridget Riley black and white: a field of wavy stripes that bends around a drifting disc of concentric rings.",
  move: "A wave runs down every stripe; the disc drifts on a figure-eight, parting the stripes, while its rings flow outward.",
  rules: [
    "Two tones do all the work; the one colour lives only inside the disc.",
    "Stripes stay exactly half light, half dark; only their paths move.",
    "The wave travels down the stripes a whole number of times per loop.",
    "The disc bends the stripes around it like a lens as it passes.",
    "Rings inside the disc flow outward one ring per loop.",
    "No outline anywhere: every edge is made by the pattern changing.",
  ],
  prompt: `R — References
• Bridget Riley, "Current" (1964) and "Blaze" (1962–64): wavy stripes, concentric zigzags.
• The Ouchi illusion: a disc of one pattern floating on a field of another.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a full-frame field of fine vertical stripes, each carrying a slow wave; a disc of concentric rings sits in the field and the stripes bend around it.
• Middle (1.5–3.5 s): the disc drifts on a figure-eight, parting the stripes like a lens; its rings flow outward; the wave keeps running down the field.
• End (3.5–5 s): the disc returns to its first place and the wave and rings land exactly where they began.

S — Style
Looks: {{bg}} and {{ink}} stripes in equal measure, full bleed; the disc's rings in {{accent}} and {{bg}}; nothing else.
Moves: the stripe wave travels two whole cycles per loop; the disc follows a 1:2 Lissajous; the lens bend follows the disc; the rings flow outward one ring per loop.
Rules:
1. Two tones in the field, one colour in the disc.
2. Stripes stay half light, half dark.
3. Whole-number cycles for every wave.
4. The disc bends the field as it passes.
5. No outlines.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no stripe ever crosses its neighbour; the stripes read cleanly at tile size with no ugly moiré; the disc edge is crisp with no outline; the motion feels like it keeps shimmering. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Op_art",
  theme: {
    bg: "#0b0b0b",
    ink: "#f1efe9",
    accent: "#e8412c",
    accent2: "#2a8f86",
    font: "Inter",
  },
  tags: [
    "op art",
    "optical",
    "illusion",
    "bridget riley",
    "stripes",
    "waves",
    "black and white",
    "hypnotic",
    "moire",
    "circles",
    "60s",
    "design movement",
  ],
  word: "Current",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    const ph = TAU * (t / LOOP);

    // The disc: a slow 1:2 figure-eight.
    const R = u * (portrait ? 0.3 : 0.27);
    const dx = w / 2 + Math.sin(ph) * w * (portrait ? 0.14 : 0.2);
    const dy = h / 2 + Math.sin(ph * 2) * h * (portrait ? 0.12 : 0.1);

    // Stripe field: vertical stripes with a travelling wave, bent around the disc.
    const period = u * 0.042;
    const n = Math.ceil(w / period) + 4;
    const step = Math.max(2, u * 0.012);
    const amp = period * 0.34;
    const lens = R * 1.7;
    const edge = (x0: number, y: number) => {
      const wave =
        Math.sin(y / (u * 0.09) - ph * 2 + x0 / (u * 0.35)) *
        amp *
        (0.55 + 0.45 * Math.sin(x0 / (u * 0.6) + y / (u * 0.8)));
      const ex = x0 - dx;
      const ey = y - dy;
      const k = Math.exp(-(ex * ex + ey * ey) / (lens * lens));
      return x0 + wave + ex * k * 0.55;
    };
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    for (let i = -2; i < n; i++) {
      const xa = i * period;
      const xb = xa + period / 2;
      ctx.moveTo(edge(xa, -step), -step);
      for (let y = 0; y <= h + step; y += step) ctx.lineTo(edge(xa, y), y);
      for (let y = Math.ceil((h + step) / step) * step; y >= -step; y -= step)
        ctx.lineTo(edge(xb, y), y);
      ctx.closePath();
    }
    ctx.fill();

    // The disc: concentric rings flowing outward, with a gentle zigzag.
    ctx.save();
    ctx.beginPath();
    ctx.arc(dx, dy, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(dx - R, dy - R, R * 2, R * 2);
    const ring = R / 7;
    const flow = (t / LOOP) * ring;
    const ringCol = mix(theme.accent, theme.bg, 0.02);
    ctx.fillStyle = ringCol;
    ctx.beginPath();
    const spokes = 64;
    for (let k = 9; k >= -1; k--) {
      const r0 = k * ring + flow;
      const r1 = r0 + ring / 2;
      if (r1 <= 0) continue;
      const zig = (a: number, r: number) => r + Math.sin(a * 12 + ph) * ring * 0.14;
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * TAU;
        const rr = zig(a, r1);
        if (i === 0) ctx.moveTo(dx + Math.cos(a) * rr, dy + Math.sin(a) * rr);
        else ctx.lineTo(dx + Math.cos(a) * rr, dy + Math.sin(a) * rr);
      }
      ctx.closePath();
      for (let i = spokes; i >= 0; i--) {
        const a = (i / spokes) * TAU;
        const rr = Math.max(0, zig(a, r0));
        if (i === spokes) ctx.moveTo(dx + Math.cos(a) * rr, dy + Math.sin(a) * rr);
        else ctx.lineTo(dx + Math.cos(a) * rr, dy + Math.sin(a) * rr);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();

    const mark = tintedLogo(theme, theme.ink, R * 0.34, R * 0.34);
    if (mark) {
      ctx.fillStyle = theme.bg;
      ctx.beginPath();
      ctx.arc(dx, dy, R * 0.24, 0, TAU);
      ctx.fill();
      ctx.drawImage(mark as CanvasImageSource, dx - R * 0.17, dy - R * 0.17);
    }

    finish(ctx, w, h, t, 0.5, 0.24);
  },
};
