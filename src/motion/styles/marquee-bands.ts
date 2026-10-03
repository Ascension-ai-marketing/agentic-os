import { mix, rgba } from "../engine/color";
import { frameOf, grain, ground, light, LOOP, once, TAU, vignette, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle } from "../engine/types";
import { darkStock, loopT, setType, widthOf } from "./_s8-helpers";

const DISPLAY = '"Archivo", "Arial Black", sans-serif';

type Look = "solid" | "knock" | "outline" | "accent" | "small" | "quiet";
interface BandSpec {
  /** Height in units of the frame's short side. */
  size: number;
  look: Look;
  stretch: CanvasFontStretch;
  weight: number;
  dir: 1 | -1;
  /** Whole repeats travelled per loop (keeps the loop seamless). */
  reps: number;
  phrase: number;
}

const SPECS: BandSpec[] = [
  { size: 0.06, look: "small", stretch: "semi-expanded", weight: 600, dir: -1, reps: 1, phrase: 4 },
  { size: 0.19, look: "knock", stretch: "expanded", weight: 900, dir: 1, reps: 1, phrase: 0 },
  { size: 0.17, look: "outline", stretch: "expanded", weight: 900, dir: -1, reps: 1, phrase: 1 },
  { size: 0.12, look: "accent", stretch: "condensed", weight: 800, dir: 1, reps: 2, phrase: 2 },
  { size: 0.19, look: "solid", stretch: "expanded", weight: 900, dir: -1, reps: 1, phrase: 0 },
  { size: 0.06, look: "quiet", stretch: "semi-expanded", weight: 600, dir: 1, reps: 1, phrase: 3 },
  { size: 0.15, look: "outline", stretch: "condensed", weight: 800, dir: 1, reps: 1, phrase: 3 },
];

const ANGLE = -0.085;

function phrases(word: string) {
  return [word.toUpperCase(), "IN MOTION", "DRAWN IN CODE", "EVERY FRAME", "FIVE SECONDS ON LOOP"];
}

/** Travel of a band at time t: whole repeats per loop, surging twice a loop. */
function offset(t: number, unit: number, spec: BandSpec, i: number) {
  const p = t / LOOP;
  const m = 2;
  const a = 0.72;
  const ph = i * 0.045;
  const base = p + (a * (Math.sin(TAU * (m * p - ph)) + Math.sin(TAU * ph))) / (TAU * m);
  return spec.dir * spec.reps * unit * base;
}

/** A four-point spark between phrases. */
function spark(c: Ctx2D, x: number, y: number, r: number) {
  c.beginPath();
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
  c.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
  c.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
  c.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
  c.closePath();
}

export const style: MotionStyle = {
  id: "marquee-bands",
  name: "Marquee Bands",
  family: "Type & Editorial",
  tagline: "Tilted bands of heavy type",
  look: "Tilted bands of heavy type stacked edge to edge: expanded black knockouts, outlines, a condensed accent tape, small tracked captions.",
  move: "Every band scrolls in the opposite direction to its neighbours and surges twice a loop, slowing almost to a stop so the words can be read.",
  rules: [
    "Bands touch edge to edge and overfill the frame; no ground shows at the corners.",
    "Neighbouring bands run in opposite directions.",
    "Each band travels a whole number of repeats per loop, so it never jumps.",
    "Speed surges and slows together (a wave), never a constant crawl.",
    "One family, many widths: expanded black for the heroes, condensed for tapes.",
    "Solid, knockout and outline alternate; one accent band only.",
    "Caps only, cap height centred in the band: nothing clips.",
  ],
  prompt: `R — References
• Fashion and streetwear campaign marquees, festival posters with stacked ticker bands (search: marquee text bands, kinetic ticker typography).
• Variable grotesques in their extreme widths (Archivo Expanded Black, condensed cuts).

I — Idea
A wall of moving words, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): tilted bands of type — "{{name}}", IN MOTION, DRAWN IN CODE, EVERY FRAME — sweep in alternating directions.
• Middle (1.2–3.7 s): the whole wall surges, slows almost to a stop so every band can be read, then surges again.
• End (3.7–5 s): each band lands exactly one or two repeats along from where it began.

S — Style
Looks: {{bg}} ground; a solid {{ink}} band with the name knocked out, outline bands, one {{accent}} tape with dark condensed type, small {{accent2}} captions. Archivo (or {{font}}) from condensed to expanded black, caps. Four-point sparks between phrases. Grain and a light falloff.
Moves: offset = repeats × unit × (t/5 + a·sin(4πt/5)/4π): whole repeats per loop, two surges a loop; neighbours run opposite ways; the stack is tilted about 5°.
Rules:
1. Edge-to-edge bands that overfill the tilted frame.
2. Opposite directions for neighbours.
3. Whole repeats per loop; speed modulated by a sine, never below zero.
4. One accent band.
5. Cap height centred in each band; nothing clipped.
6. Grain on every band so the solids never look flat.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no corner of the frame shows empty ground; the slow moment is readable; outlines stay crisp; letters never touch a band edge. Fix what fails and render again until every check passes.`,
  ref: "https://fonts.google.com/specimen/Archivo",
  theme: {
    bg: "#0d0d0e",
    ink: "#f1efe9",
    accent: "#ff4d2e",
    accent2: "#9aa3ad",
    font: "Archivo",
  },
  fonts: ["Archivo:wdth,wght@62..125,100..900"],
  tags: [
    "marquee",
    "ticker",
    "bands",
    "scrolling",
    "bold",
    "type",
    "typography",
    "loop",
    "poster",
    "streetwear",
    "kinetic",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "marq", w, h, 13) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.25, h * 0.15, Math.max(w, h) * 0.85, theme.ink, 0.08);

    const word = wordFor(theme.name, "Motion", 14);
    const list = phrases(word);
    const family = theme.font;
    // Cover the tilted frame: the band stack must span its rotated height.
    const diag = Math.hypot(w, h);
    const needH = h * Math.cos(ANGLE) + w * Math.abs(Math.sin(ANGLE)) + u * 0.1;
    const bands = once(`marq-bands:${w}x${h}`, () => {
      const out: (BandSpec & { y: number; hgt: number })[] = [];
      let total = 0;
      let i = 0;
      const scale = u * (w > h * 1.2 ? 1 : 0.92);
      while (total < needH) {
        const spec = SPECS[i % SPECS.length];
        const hgt = Math.round(spec.size * scale);
        out.push({ ...spec, dir: (i % 2 ? -1 : 1) as 1 | -1, y: total, hgt });
        total += hgt;
        i++;
      }
      return out.map((b) => ({ ...b, y: b.y - total / 2 }));
    });

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(ANGLE);
    const half = diag / 2 + u * 0.2;
    bands.forEach((b, i) => {
      const y = b.y;
      const H = b.hgt;
      // Band ground.
      if (b.look === "knock" || b.look === "accent") {
        ctx.fillStyle = b.look === "knock" ? theme.ink : theme.accent;
        ctx.fillRect(-half, y, half * 2, H + 0.5);
      }
      // Hairline seams between bands.
      ctx.fillStyle = rgba(theme.ink, 0.1);
      ctx.fillRect(-half, y, half * 2, Math.max(1, u * 0.0012));

      const small = b.look === "small" || b.look === "quiet";
      const size = H * (small ? 0.46 : 0.98);
      setType(ctx, b.weight, size, family, {
        fallback: DISPLAY,
        stretch: b.stretch,
        tracking: small ? 0.22 : b.stretch === "condensed" ? 0.01 : -0.01,
      });
      const cap = ctx.measureText("H").actualBoundingBoxAscent || size * 0.7;
      const baseline = y + H / 2 + cap / 2;
      const text = list[b.phrase % list.length];
      const tw = widthOf(ctx, text);
      const gap = small ? size * 1.6 : size * 0.62;
      const unit = tw + gap * 2 + (small ? 0 : size * 0.34);
      const off = offset(t, unit, b, i);
      const start = ((off % unit) + unit) % unit;
      const color =
        b.look === "knock"
          ? mix(theme.bg, "#000000", 0.2)
          : b.look === "accent"
            ? mix(theme.bg, "#000000", 0.3)
            : b.look === "quiet"
              ? rgba(theme.accent2, 0.9)
              : b.look === "small"
                ? rgba(theme.ink, 0.66)
                : theme.ink;
      ctx.textBaseline = "alphabetic";
      for (let x = -half - unit + start; x < half + unit; x += unit) {
        if (b.look === "outline") {
          ctx.strokeStyle = rgba(theme.ink, 0.82);
          ctx.lineWidth = Math.max(1, size * 0.018);
          ctx.lineJoin = "round";
          ctx.strokeText(text, x, baseline);
        } else {
          ctx.fillStyle = color;
          ctx.fillText(text, x, baseline);
        }
        // Spark between phrases.
        const sx = x + tw + gap + (small ? 0 : size * 0.17);
        const sy = y + H / 2;
        const r = small ? size * 0.28 : cap * 0.36;
        spark(ctx, sx, sy, r);
        ctx.fillStyle =
          b.look === "outline"
            ? theme.accent
            : b.look === "knock" || b.look === "accent"
              ? color
              : rgba(theme.accent, 0.9);
        ctx.fill();
      }
    });
    ctx.restore();

    // A dropped logo rides in a small plate at the corner.
    const mark = tintedLogo(theme, theme.ink, u * 0.07, u * 0.07);
    if (mark) {
      const s = u * 0.11;
      ctx.fillStyle = rgba(theme.bg, 0.9);
      ctx.fillRect(w - s - u * 0.05, u * 0.05, s, s);
      ctx.drawImage(
        mark as CanvasImageSource,
        w - s - u * 0.05 + (s - u * 0.07) / 2,
        u * 0.05 + (s - u * 0.07) / 2,
      );
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.32);
  },
};
