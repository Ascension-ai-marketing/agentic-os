import { mix, rgba } from "../engine/color";
import { bake, font, frameOf, LOOP, once, rng, TAU, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { finish, fitBox, tooth } from "./_s3-helpers";

const FAMILY = "Shrikhand";
const FALLBACK = '"Cooper Black", "Georgia", serif';

function bands(theme: Theme) {
  return [
    theme.accent,
    mix(theme.accent, theme.accent2, 0.5),
    theme.accent2,
    mix(theme.bg, theme.accent2, 0.25),
    theme.ink,
    mix(theme.accent, theme.ink, 0.35),
  ];
}

/** The word with its echo outlines, baked once per theme and size. */
function wordLayer(theme: Theme, word: string, size: number, wt: number) {
  return (c: Ctx2D, w: number, h: number) => {
    c.font = font(wt, size, theme.font, FALLBACK);
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.lineJoin = "round";
    const x = w / 2;
    const y = h * 0.66;
    const deep = mix(theme.bg, theme.accent2, 0.15);
    const rings: [number, string][] = [
      [0.34, deep],
      [0.26, theme.accent],
      [0.18, deep],
      [0.1, theme.accent2],
      [0.05, deep],
    ];
    for (const [k, col] of rings) {
      c.strokeStyle = col;
      c.lineWidth = size * k;
      c.strokeText(word, x, y);
    }
    c.fillStyle = theme.ink;
    c.fillText(word, x, y);
    // A hot inner highlight along the top of the letters.
    c.save();
    c.globalCompositeOperation = "source-atop";
    const g = c.createLinearGradient(0, y - size * 0.8, 0, y);
    g.addColorStop(0, rgba(theme.ink, 0));
    g.addColorStop(0.55, rgba(theme.ink, 0));
    g.addColorStop(1, rgba(mix(theme.accent, theme.ink, 0.6), 0.55));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.restore();
  };
}

type Drip = { x: number; a: number; s: number };
const dripsFor = (seed: number) =>
  once(`psy-drips:${seed}`, () => {
    const r = rng(seed);
    const out: Drip[] = [];
    for (let i = 0; i < 9; i++)
      out.push({ x: 0.06 + r() * 0.88, a: 0.35 + r() * 0.65, s: 0.014 + r() * 0.016 });
    return out;
  });

export const style: MotionStyle = {
  id: "psychedelic",
  name: "Psychedelic Poster",
  family: "Design Movements",
  tagline: "A melting 60s concert poster",
  look: "A 60s concert poster: concentric bands of orange, magenta and violet swirling round a melting word with echo outlines.",
  move: "The bands twist and flow outward forever; the word wobbles, sags into drips mid-loop, then pulls itself back together.",
  rules: [
    "Vibrating neighbours: warm bands sit against cool ones.",
    "Bands flow outward exactly one colour cycle per loop.",
    "Every band edge wobbles in lobes, and the lobes twist with depth.",
    "The word has echo outlines, dark and bright in turn.",
    "Melting grows from the letter bottoms; the tops stay readable.",
    "The melt peaks mid-loop and fully recovers by the end.",
    "Printed grain over everything; no smooth gradients in the bands.",
  ],
  prompt: `R — References
• 1960s San Francisco concert posters: Wes Wilson, Victor Moscoso, Bonnie MacLean (search: Wes Wilson poster lettering, Moscoso vibrating colour).
• Op-art swirls and melting lettering from the same era.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): concentric bands of orange, magenta, violet, plum and cream swirl out of the centre; the word "{{name}}" floats on top in fat lettering with echo outlines, gently wobbling.
• Middle (1.5–3.5 s): the letter bottoms sag and drip like hot wax while the bands keep flowing and twisting.
• End (3.5–5 s): the drips pull back up, the word is whole again, and the bands have flowed exactly one colour cycle.

S — Style
Looks: {{bg}} ground; bands in {{accent}}, a magenta between {{accent}} and {{accent2}}, {{accent2}}, deep plum, {{ink}} cream and a peach; the word in {{ink}} with alternating dark and bright echo outlines; {{font}} (or Shrikhand).
Moves: bands flow outward one full colour cycle per loop with three twisting lobes; the word rides a sine wave; the melt eases in to a peak at 2.5 s and back out.
Rules:
1. Warm and cool bands side by side.
2. One colour cycle of flow per loop.
3. Lobed, twisting band edges.
4. Echo outlines on the word.
5. Melt from the bottoms; tops stay readable.
6. Grain over everything.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word is readable in every frame; drips come from letter bottoms only; the bands never show a seam; the centre of the swirl never looks empty. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Psychedelic_art",
  theme: {
    bg: "#140a18",
    ink: "#fff0d4",
    accent: "#ff6a1a",
    accent2: "#9b4dff",
    font: FAMILY,
  },
  fonts: ["Shrikhand"],
  tags: [
    "psychedelic",
    "60s",
    "1960s",
    "hippie",
    "trippy",
    "swirl",
    "melting",
    "groovy",
    "concert poster",
    "colorful",
    "retro",
    "design movement",
  ],
  word: "Groovy",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Swirling bands, painted from the outside in.
    const pal = bands(theme);
    const P = pal.length;
    const cx = w / 2;
    const cy = h * (portrait ? 0.46 : 0.5);
    const spacing = u * 0.085;
    const flow = (P * t) / LOOP;
    const maxR = Math.hypot(w, h) * 0.62;
    const kMax = Math.ceil((maxR * 1.45) / spacing) + P;
    const spin = TAU * (t / LOOP);
    const steps = 120;
    for (let k = kMax; k >= 0; k--) {
      // Ring k sits at (k + flow - P) spacings, so the rings flow outward and
      // after one loop every ring has moved exactly one colour cycle.
      const base = (k + (flow % P) - P) * spacing;
      if (base <= spacing * 0.1) continue;
      const col = pal[((k % P) + P) % P];
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * TAU;
        const lobes =
          0.13 * Math.sin(3 * th + base / (spacing * 3.2) - spin) +
          0.05 * Math.sin(5 * th - base / (spacing * 1.7) + spin * 2);
        const r = base * (1 + lobes);
        const x = cx + Math.cos(th) * r * (portrait ? 0.85 : 1.15);
        const y = cy + Math.sin(th) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // The word: baked with echo outlines, drawn in slices that wave and melt.
    const word = wordFor(theme.name, "Groovy", 12);
    const wt = theme.font === FAMILY ? 400 : 900;
    const size = fitBox(
      ctx,
      word,
      w * (portrait ? 0.78 : 0.7),
      h * (portrait ? 0.16 : 0.3),
      wt,
      theme.font,
      FALLBACK,
      0.8,
    );
    ctx.font = font(wt, size, theme.font, FALLBACK);
    const tw = ctx.measureText(word).width;
    const LW = Math.ceil(tw + size * 0.8);
    const LH = Math.ceil(size * 1.5);
    const layer = bake(
      `psy-word:${theme.font}${theme.ink}${theme.accent}${theme.accent2}${theme.bg}|${word}|${Math.round(size)}|${wt}`,
      LW,
      LH,
      wordLayer(theme, word, size, wt),
    );
    const lx = cx - LW / 2;
    const ly = cy - LH * 0.62;
    const melt = Math.pow(Math.sin(Math.PI * (t / LOOP)), 2);
    const drips = dripsFor(41);
    const slice = Math.max(2, Math.round(w / 420));
    const split = LH * 0.56;
    // Soft shadow so the word lifts off the bands.
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.filter = `blur(${(u * 0.012).toFixed(1)}px) brightness(0)`;
    ctx.drawImage(layer as CanvasImageSource, lx + u * 0.01, ly + u * 0.02);
    ctx.restore();
    const stretchAt = (x: number) => {
      const f = x / LW;
      let drip = 0;
      for (const d of drips) {
        const q = (f - d.x) / d.s;
        drip += d.a * Math.exp(-q * q);
      }
      return 1 + melt * (0.1 + drip * 1.25);
    };
    const lower = LH - split;
    // Adaptive slices: 1 px where the melt changes fast (no stair-steps), wider elsewhere.
    for (let sx = 0; sx < LW; ) {
      const s0 = stretchAt(sx);
      let sw = slice + 1;
      if (Math.abs(stretchAt(sx + sw) - s0) * lower > 0.7) sw = 1;
      sw = Math.min(sw, LW - sx);
      const f = (sx + sw / 2) / LW;
      const wave = Math.sin(TAU * (f * 1.6) + TAU * (t / LOOP) * 2) * size * 0.05;
      const st = stretchAt(sx + sw / 2);
      ctx.drawImage(layer as CanvasImageSource, sx, 0, sw, split, lx + sx, ly + wave, sw, split);
      ctx.drawImage(
        layer as CanvasImageSource,
        sx,
        split,
        sw,
        lower,
        lx + sx,
        ly + wave + split,
        sw,
        lower * st,
      );
      sx += sw;
    }

    const mark = tintedLogo(theme, theme.ink, u * 0.08, u * 0.08);
    if (mark) ctx.drawImage(mark as CanvasImageSource, cx - u * 0.04, u * 0.05);

    tooth(ctx, w, h, 0.45, 43);
    finish(ctx, w, h, t, 0.5, 0.34);
  },
};
