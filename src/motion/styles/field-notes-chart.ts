import { mix, rgba } from "../engine/color";
import { ease, grain, lerp, seg, TAU, vignette, wordFor } from "../engine/kit";
import type { MotionStyle } from "../engine/types";
import { collage, fnFrame, fnGround, fnPalette, fnPaperTile, nib, serif } from "./field-notes/kit";

const BARS = [0.3, 0.45, 0.38, 0.58, 0.72, 0.95];

export const style: MotionStyle = {
  id: "field-notes-chart",
  name: "Field Notes · Chart",
  look: "An ivory slide floating on night: a serif title, ink bars, one clay bar, torn ochre paper and the dawn rim below.",
  move: "Pencil bars ink up one by one from the baseline, a nib draws the trend line through the tops, then the bars settle home.",
  rules: [
    "The slide is real paper: ivory tooth, soft shadow, light falling across it.",
    "Bars ink up from the baseline one at a time, eased out, never all at once.",
    "One clay bar, the last and tallest; every other bar is ink.",
    "The trend line draws after the bars land, with round dots on each top.",
    "Title in Newsreader 500 at opsz 36, a short clay rule above it.",
    "Corners carry the torn-paper collage; the dawn rim glows at the foot.",
    "Bars settle back in a stagger so the loop closes on an empty chart.",
  ],
  prompt: `R — References
• Editorial chart slides: one idea, one highlighted bar, generous margins.
• The Horizon Strike look: night ground, dawn planet rim, ivory paper, torn ochre collage, one clay accent.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.8 s): an ivory slide titled "{{name}}" floats on night; its bars are pencil outlines, and each one fills with ink from the baseline up, one after another.
• Middle (1.8–3.9 s): an ink trend line draws through the bar tops, a clay nib resting on the last, tallest bar.
• End (3.9–5 s): the bars settle back to the baseline in a stagger and the slide waits for the next sweep.

S — Style
Looks: {{bg}} night with a dawn rim at the foot; an ivory paper slide with a soft shadow; ink bars in the ground colour; the tallest bar in {{accent}}; a {{accent2}} torn scrap with an ink compass sketch in the corner; {{font}} 500 title at opsz 36.
Moves: each bar inks up in 0.75 s (ease-out), 0.2 s apart; a clay nib rides the tip of the trend line as it draws; settle staggered 60 ms per bar.
Rules:
1. Paper texture, shadow and light falloff on the slide.
2. Pencil outlines first; bars ink up one at a time. No sweeping light.
3. One clay bar; everything else is ink.
4. Dots on the trend line, drawn after the bars land.
5. Grain and vignette over everything.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the bars ink up in order; the trend line meets every bar top; the title never clips; the slide never touches the frame edge. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Bar_chart",
  theme: {
    bg: "#07080c",
    ink: "#f4f1ea",
    accent: "#d97757",
    accent2: "#e3b23c",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..700"],
  tags: [
    "chart",
    "slides",
    "presentation",
    "data",
    "bars",
    "growth",
    "graph",
    "numbers",
    "deck",
    "field notes",
    "paper",
  ],
  word: "Numbers that move",
  family: "Field Notes",
  tagline: "An ivory slide, bars inked in",
  render(ctx, t, theme, w, h) {
    const f = fnFrame(w, h);
    const P = fnPalette(theme);
    fnGround(ctx, f, theme, t / 5);
    collage(ctx, theme, f, t);

    // The slide (design 1152 x 648, or 700 x 900 in portrait).
    const SW = f.portrait ? 700 : 1152;
    const SH = f.portrait ? 900 : 648;
    const k = Math.min(
      (w * (f.portrait ? 0.84 : 0.62)) / SW,
      (h * (f.portrait ? 0.58 : 0.64)) / SH,
    );
    const ox = f.cx - (SW * k) / 2;
    const oy = h * (f.portrait ? 0.45 : 0.47) - (SH * k) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 50 * k;
    ctx.shadowOffsetY = 26 * k;
    ctx.beginPath();
    ctx.roundRect(0, 0, SW, SH, 12);
    const tile = fnPaperTile(P.ivory, 3);
    const pat = ctx.createPattern(tile as CanvasImageSource, "repeat");
    ctx.fillStyle = pat ?? P.ivory;
    ctx.fill();
    ctx.restore();
    const fall = ctx.createLinearGradient(0, 0, SW * 0.4, SH * 1.1);
    fall.addColorStop(0, "rgba(255,255,255,0.05)");
    fall.addColorStop(1, "rgba(40,28,16,0.16)");
    ctx.fillStyle = fall;
    ctx.beginPath();
    ctx.roundRect(0, 0, SW, SH, 12);
    ctx.fill();

    // Title with a short clay rule above it.
    const inkOnPaper = mix(P.night, "#141413", 0.5);
    const pad = f.portrait ? 64 : 104;
    ctx.fillStyle = P.clay;
    ctx.fillRect(pad, 70, 34, 3);
    const title = wordFor(theme.name, "Numbers that move", 22);
    serif(ctx, theme.font, title, pad, 132, f.portrait ? 50 : 54, { color: inkOnPaper });

    // Chart geometry.
    const x0 = pad;
    const x1 = SW - pad;
    const base = SH - (f.portrait ? 120 : 88);
    const top = f.portrait ? 250 : 210;
    const slot = (x1 - x0) / BARS.length;
    const bw = slot * 0.56;
    const bx = (i: number) => x0 + slot * (i + 0.5);
    // Pencil outlines are always there; each bar inks up from the baseline in turn.
    ctx.fillStyle = rgba(inkOnPaper, 0.55);
    ctx.fillRect(x0 - 10, base, x1 - x0 + 20, 2);
    const inkAt = (i: number) => 0.3 + i * 0.2;
    const heights = BARS.map((b, i) => {
      const up = ease.outCubic(seg(t, inkAt(i), inkAt(i) + 0.75));
      const down = ease.inOutCubic(seg(t, 3.9 + i * 0.06, 4.45 + i * 0.06));
      return b * up * (1 - down);
    });
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(inkOnPaper, 0.28);
    ctx.lineWidth = 1.2;
    BARS.forEach((b, i) => {
      const H = (base - top) * b;
      ctx.beginPath();
      ctx.roundRect(bx(i) - bw / 2, base - H, bw, H, [6, 6, 0, 0]);
      ctx.stroke();
    });
    ctx.restore();
    heights.forEach((hgt, i) => {
      if (hgt <= 0.001) return;
      const H = (base - top) * hgt;
      const clay = i === BARS.length - 1;
      ctx.fillStyle = clay ? P.clay : inkOnPaper;
      ctx.beginPath();
      ctx.roundRect(bx(i) - bw / 2, base - H, bw, H, [6, 6, 0, 0]);
      ctx.fill();
      // A wet ink edge at the rising top.
      const rising = seg(t, inkAt(i), inkAt(i) + 0.75);
      if (rising > 0 && rising < 1) {
        ctx.fillStyle = rgba(
          clay ? mix(P.clay, "#ffffff", 0.35) : mix(inkOnPaper, "#ffffff", 0.35),
          0.5 * (1 - rising),
        );
        ctx.fillRect(bx(i) - bw / 2, base - H, bw, 3);
      }
    });
    // Trend line through the tops, drawn after the bars land; the nib rides its tip.
    const line = ease.outCubic(seg(t, 1.95, 2.8)) * (1 - ease.inOutCubic(seg(t, 3.8, 4.2)));
    if (line > 0) {
      const pts = heights.map(
        (_hgt, i) => [bx(i), base - (base - top) * BARS[i] - 28] as [number, number],
      );
      ctx.save();
      ctx.strokeStyle = rgba(inkOnPaper, 0.85);
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      const n = (pts.length - 1) * line;
      let tipX = pts[0][0];
      let tipY = pts[0][1];
      pts.forEach(([x, y], i) => {
        if (i > Math.ceil(n)) return;
        const f2 = Math.min(1, n - (i - 1));
        if (i === 0) ctx.moveTo(x, y);
        else {
          tipX = lerp(pts[i - 1][0], x, f2);
          tipY = lerp(pts[i - 1][1], y, f2);
          ctx.lineTo(tipX, tipY);
        }
      });
      ctx.stroke();
      ctx.fillStyle = inkOnPaper;
      pts.forEach(([x, y], i) => {
        if (i > n) return;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, TAU);
        ctx.fill();
      });
      ctx.restore();
      nib(ctx, theme, tipX, tipY, line, 7);
    }
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
