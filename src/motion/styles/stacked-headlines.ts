import { mix, rgba } from "../engine/color";
import {
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  LOOP,
  SANS,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";
import {
  darkStock,
  faceReady,
  glyphXs,
  loopT,
  preloadFaces,
  setType,
  widthOf,
} from "./_s8-helpers";

const SERIF = '"Instrument Serif", "Newsreader", Georgia, serif';
const ITALIC_FACE = 'italic 400 48px "Instrument Serif"';
preloadFaces("Instrument Serif:ital@1", [ITALIC_FACE]);

/** Four short lines; the third word of each pair set in italic where marked. */
const LINES: { text: string; italic?: [number, number] }[] = [
  { text: "Set the type." },
  { text: "Find the beat.", italic: [9, 13] },
  { text: "Let it move." },
  { text: "Land it." },
];

const BEATS = 8;
const BEAT = LOOP / BEATS;
const MOVE = 0.46;
const LAG = 0.0045;
/** Lines that move on each beat: pairs answer each other, then the stack holds two beats. */
const PLAN: number[][] = [[0, 2], [1, 3], [], [], [0, 2], [1, 3], [], []];

/** Where a line sits (0 = flush left, 1 = flush right) at time t, delayed by lag. */
function side(line: number, t: number, lag = 0): number {
  let s = line % 2;
  for (let b = 0; b < BEATS; b++) {
    if (!PLAN[b].includes(line)) continue;
    const t0 = b * BEAT + lag;
    if (t < t0) break;
    const k = ease.inOutQuint(clamp((t - t0) / MOVE));
    if (k < 1) return lerp(s, 1 - s, k);
    s = 1 - s;
  }
  return s;
}

/** Kerned glyph positions for a line whose marked span is set in italic. */
function setLine(
  ctx: Parameters<typeof widthOf>[0],
  L: (typeof LINES)[number],
  F: number,
  family: string,
  italicOk: boolean,
) {
  const spans: { text: string; italic: boolean }[] = L.italic
    ? [
        { text: L.text.slice(0, L.italic[0]), italic: false },
        { text: L.text.slice(L.italic[0], L.italic[1]), italic: true },
        { text: L.text.slice(L.italic[1]), italic: false },
      ]
    : [{ text: L.text, italic: false }];
  const out: { c: string; x: number; italic: boolean }[] = [];
  let x = 0;
  for (const sp of spans) {
    if (!sp.text) continue;
    setType(ctx, 400, F, family, {
      fallback: SERIF,
      tracking: -0.005,
      italic: sp.italic && italicOk,
    });
    const xs = glyphXs(ctx, sp.text);
    [...sp.text].forEach((c, i) => out.push({ c, x: x + xs[i], italic: sp.italic }));
    x += xs[xs.length - 1];
  }
  return { glyphs: out, width: x - F * 0.005 };
}

export const style: MotionStyle = {
  id: "stacked-headlines",
  name: "Stacked Headlines",
  family: "Type & Editorial",
  tagline: "Four headlines, stacked like a cover",
  look: "A stack of four short headlines in a tall condensed serif, hairline rules between them, numbered in the margins like a magazine cover.",
  move: "On an eight-beat bar the lines slide one at a time between flush left and flush right, letters trailing like a rope, then the stack holds.",
  rules: [
    "Four short lines, two or three words each; never one word alone.",
    "Each line owns a band between hairline rules; nothing crosses a rule.",
    "Moves land on the beat: 0.46 s, quint in-out, lines in answering pairs.",
    "Letters trail the leading edge by 4.5 ms each: a line opens in flight, closes as it lands.",
    "Kerning stays intact: letters are placed from the shaped string.",
    "One italic word and one accent; a fixed gutter carries the line numbers.",
    "The whole stack holds for two beats, twice a loop, so it can be read.",
  ],
  prompt: `R — References
• Magazine covers and editorial posters with stacked, ragged headlines (search: stacked serif headline poster, editorial cover typography).
• Instrument Serif, Didone and condensed display serifs at large sizes.
• Kinetic type that moves on a musical grid (search: beat synced kinetic typography).

I — Idea
Four short lines — "Set the type. / Find the beat. / Let it move. / Land it." — sliding on an eight-beat bar, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): lines alternate flush left and flush right, numbered in the margins. On beat 1 lines one and three slide across; on beat 2 lines two and four answer, letters trailing like a rope.
• Middle (1.2–2.5 s): the mirrored stack holds for two beats so it can be read.
• End (2.5–5 s): the same two moves in reverse, then the stack holds again, exactly where it began.

S — Style
Looks: {{bg}} ground with soft light, {{ink}} type in Instrument Serif (or {{font}}) set large, one italic word in {{accent}}, hairline rules, tiny numbers and a label in Inter.
Moves: 0.625 s beats; each move 0.46 s inOutQuint; per-letter stagger 4.5 ms from the leading edge, so a line opens up in flight and closes as it lands.
Rules:
1. Two or three words per line; line bands at least 1.12 × the type size so descenders never clip.
2. Two lines move per beat, in pairs that answer each other; the stack holds whole for two beats.
3. Letter positions come from the kerned string, never a fixed advance.
4. One accent colour, on the italic word.
5. Hairlines and a numbered gutter keep the grid visible; numbers never move.
6. Grain and a light falloff; the ground is never flat.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no descender or ascender clipped by its band; no line collides with its number; every move lands on a beat; kerning looks even at full size. Fix what fails and render again until every check passes.`,
  ref: "https://fonts.google.com/specimen/Instrument+Serif",
  theme: {
    bg: "#0f0e0d",
    ink: "#f3eee5",
    accent: "#ff6a3d",
    accent2: "#8c8a86",
    font: "Instrument Serif",
  },
  fonts: ["Instrument Serif", "Inter:wght@400..700"],
  tags: [
    "stacked",
    "headline",
    "headlines",
    "editorial",
    "magazine",
    "serif",
    "kinetic",
    "type",
    "typography",
    "rhythm",
    "beat",
    "poster",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { portrait, square, u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "stack", w, h, 3) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.3, h * 0.2, Math.max(w, h) * 0.8, theme.ink, 0.07);

    const mx = w * (portrait ? 0.07 : 0.085);
    const top = h * (portrait ? 0.2 : square ? 0.17 : 0.17);
    const bottom = h * (portrait ? 0.84 : square ? 0.87 : 0.87);
    const numSize = Math.max(6, u * (portrait ? 0.022 : 0.02));
    // A fixed gutter on the left carries the line numbers; type travels to its right.
    const gutter = numSize * 3.2;
    const W = w - mx * 2 - gutter;
    const tx = mx + gutter;
    const family = theme.font;
    const italicOk = family === "Instrument Serif" ? faceReady(ITALIC_FACE) : true;

    // Size: the longest line takes a set share of the width; bands fill the height.
    setType(ctx, 400, 100, family, { fallback: SERIF, tracking: -0.005 });
    const longest = Math.max(...LINES.map((l) => widthOf(ctx, l.text)));
    const share = portrait ? 0.84 : square ? 0.76 : 0.6;
    const band = (bottom - top) / LINES.length;
    const F = Math.min((100 * W * share) / longest, band / 1.16);

    // Hairline rules.
    ctx.fillStyle = rgba(theme.ink, 0.14);
    const hair = Math.max(1, u * 0.0014);
    for (let i = 0; i <= LINES.length; i++)
      ctx.fillRect(mx, Math.round(top + i * band), W + gutter, hair);

    // Label band.
    setType(ctx, 600, numSize, "Inter", { fallback: SANS, tracking: 0.16 });
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = rgba(theme.ink, 0.62);
    const labelY = top - numSize * 1.4;
    const mark = tintedLogo(theme, rgba(theme.ink, 0.8), numSize * 3.2, numSize * 1.6);
    if (mark) ctx.drawImage(mark as CanvasImageSource, mx, labelY - numSize * 1.25);
    else ctx.fillText(wordFor(theme.name, "Motion", 14).toUpperCase(), mx, labelY);
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(theme.ink, 0.4);
    ctx.fillText("FOUR LINES · EIGHT BEATS", tx + W, labelY);
    ctx.textAlign = "left";

    // Beat ticks along the foot.
    const beatNow = Math.floor(t / BEAT) % BEATS;
    const tickW = (W + gutter) / BEATS;
    for (let b = 0; b < BEATS; b++) {
      const on = b === beatNow;
      ctx.fillStyle = on ? theme.accent : rgba(theme.ink, 0.18);
      ctx.fillRect(
        mx + b * tickW,
        bottom + numSize * 1.2,
        tickW - numSize * 0.6,
        Math.max(1, u * (on ? 0.004 : 0.002)),
      );
    }

    // The lines.
    for (let i = 0; i < LINES.length; i++) {
      const y0 = top + i * band;
      const baseline = y0 + band * 0.5 + F * 0.3;
      const { glyphs, width: lw } = setLine(ctx, LINES[i], F, family, italicOk);
      const travel = W - lw;
      const s0 = side(i, t);
      const moving = s0 > 0.0005 && s0 < 0.9995;
      // The leading edge moves first: letters trail it like a rope.
      const toRight = side(i, t + 0.02) > side(i, t - 0.02) || (!moving && s0 < 0.5);
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx - F * 0.3, y0 + hair, W + F * 0.6, band - hair);
      ctx.clip();
      for (const italic of [false, true]) {
        setType(ctx, 400, F, family, {
          fallback: SERIF,
          tracking: -0.005,
          italic: italic && italicOk,
        });
        ctx.fillStyle = italic ? theme.accent : theme.ink;
        for (let c = 0; c < glyphs.length; c++) {
          const g = glyphs[c];
          if (g.italic !== italic || g.c === " ") continue;
          const order = toRight ? glyphs.length - 1 - c : c;
          const s = side(i, t, order * LAG);
          ctx.fillText(g.c, tx + s * travel + g.x, baseline);
        }
      }
      ctx.restore();
      // Line number in the fixed gutter; it lights while its line travels.
      setType(ctx, 600, numSize, "Inter", { fallback: SANS, tracking: 0.1 });
      ctx.fillStyle = moving ? theme.accent : rgba(theme.accent, 0.8);
      ctx.fillText(`0${i + 1}`, mx, y0 + numSize * 1.9);
      ctx.fillStyle = rgba(theme.ink, moving ? 0.6 : 0.3);
      ctx.fillRect(mx, y0 + numSize * 2.5, numSize * (moving ? 2.2 : 1.4), hair);
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
    void mix;
  },
};
