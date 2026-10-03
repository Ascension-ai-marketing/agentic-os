import { mix, rgba } from "../engine/color";
import {
  ease,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  MONO,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";
import { darkStock, loopT, preloadWidths, setType, widthFace, widthOf } from "./_s8-helpers";

const FAMILY = "Anybody";
const SPEC = "Anybody:wdth,wght@50..150,100..900";
const STOPS = Array.from({ length: 41 }, (_, i) => 50 + i * 2.5);
preloadWidths(FAMILY, SPEC, STOPS);
const FALLBACK = '"Anybody", "Arial", sans-serif';

/** The four corners of the design space, visited in order with a hold at each. */
const CORNERS: { wdth: number; wght: number; name: string }[] = [
  { wdth: 50, wght: 900, name: "Black Ultra Condensed" },
  { wdth: 150, wght: 900, name: "Black Ultra Expanded" },
  { wdth: 150, wght: 200, name: "ExtraLight Ultra Expanded" },
  { wdth: 50, wght: 200, name: "ExtraLight Ultra Condensed" },
];
const LEG = 1.25;
const HOLD = 0.42;

/** Position in the design space at time t (holds sit exactly on the corners). */
function state(t: number) {
  const leg = Math.floor(t / LEG) % 4;
  const local = t - leg * LEG;
  // Hold straddles the corner: the last HOLD/2 of one leg and first HOLD/2 of the next.
  const k = ease.inOutCubic(seg(local, HOLD / 2, LEG - HOLD / 2));
  const a = CORNERS[leg];
  const b = CORNERS[(leg + 1) % 4];
  return {
    wdth: lerp(a.wdth, b.wdth, k),
    wght: lerp(a.wght, b.wght, k),
    name: k < 0.5 ? a.name : b.name,
    moving: k > 0.001 && k < 0.999,
  };
}

export const style: MotionStyle = {
  id: "variable-morph",
  name: "Variable Morph",
  family: "Type & Editorial",
  tagline: "One word, a variable font morphing",
  look: "One word in a variable face, set huge on specimen guides, with a small axis pad plotting its width and weight like a type designer's tool.",
  move: "The word travels the four corners of its design space: black condensed, black expanded, extra-light expanded, extra-light condensed, easing and holding at each.",
  rules: [
    "Real axes only: wdth and wght on a variable face, never a fake scale.",
    "One word, always as large as the box allows at its current width.",
    "Hold on each corner of the design space; ease between them.",
    "Specimen guides (cap height, baseline) move with the type.",
    "An axis pad shows where the word is; its dot is the only accent.",
    "Readouts in mono, small, never competing with the word.",
    "Kerning stays on: the word is set as one string at every instant.",
  ],
  prompt: `R — References
• Variable font specimens and axis playgrounds (search: variable font specimen animation, Axis-Praxis, Google Fonts variable axes).
• Anybody by Tyler Finck: a width axis from 50 to 150 and weights 100 to 900.

I — Idea
One word morphing through its design space, 5 seconds, looping seamlessly:
• Beginning (0–1.25 s): "{{name}}" sits in Black Ultra Condensed, then stretches to Black Ultra Expanded.
• Middle (1.25–3.75 s): it thins to ExtraLight while expanded, then narrows to ExtraLight Ultra Condensed; the guides and axis pad follow.
• End (3.75–5 s): it thickens back to Black Ultra Condensed, exactly where it began.

S — Style
Looks: {{bg}} ground with soft light; the word in {{ink}}, set as large as its box allows; hairline cap and baseline guides in {{accent2}}; a small axis pad with a {{accent}} dot, its path and a short trail; mono readouts (wdth, wght, instance name).
Moves: 1.25 s per edge of the design space: a short hold on the corner, then an inOutCubic morph along one edge. Width and weight change continuously; the size re-fits every frame.
Rules:
1. Use the font's real wdth and wght axes.
2. One word, re-fitted every frame to the box.
3. Hold at each corner, ease along each edge.
4. The accent is only the pad's dot.
5. Kerning on; set the word as one string.
6. Grain and light falloff; never a flat ground.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the width really changes (not a horizontal scale: stems stay true); the word never leaves its box; the dot matches the readouts; the guides sit on the cap height and baseline. Fix what fails and render again until every check passes.`,
  ref: "https://fonts.google.com/specimen/Anybody",
  theme: {
    bg: "#0c0c0e",
    ink: "#f1efea",
    accent: "#8f7bff",
    accent2: "#6f6c68",
    font: "Anybody",
  },
  fonts: [SPEC, "JetBrains Mono:wght@400;500"],
  tags: [
    "variable",
    "font",
    "morph",
    "weight",
    "width",
    "type",
    "typography",
    "specimen",
    "axis",
    "kinetic",
    "word",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { portrait, square, u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "vf", w, h, 17) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.5, h * 0.35, Math.max(w, h) * 0.75, theme.ink, 0.07);

    const word = wordFor(theme.name, "Motion", 12).toUpperCase();
    const S = state(t);
    const face = widthFace(FAMILY, S.wdth);
    const wght = Math.round(S.wght);

    // Box the word lives in.
    const mx = w * (portrait ? 0.07 : 0.08);
    const boxW = w - mx * 2;
    const boxTop = h * (portrait ? 0.2 : square ? 0.2 : 0.2);
    const boxBottom = h * (portrait ? 0.62 : square ? 0.66 : 0.7);
    const boxH = boxBottom - boxTop;
    setType(ctx, wght, 100, face.family, { fallback: FALLBACK, stretch: face.stretch });
    const perEm = widthOf(ctx, word) / 100;
    const capEm = (ctx.measureText("H").actualBoundingBoxAscent || 70) / 100;
    const size = Math.min(boxW / perEm, (boxH * 0.92) / capEm);
    const cap = capEm * size;
    const baseline = boxTop + (boxH + cap) / 2;
    const capY = baseline - cap;

    // Specimen guides.
    const hair = Math.max(1, u * 0.0014);
    const guide = rgba(theme.accent2, 0.55);
    ctx.fillStyle = guide;
    ctx.fillRect(mx * 0.5, Math.round(baseline), w - mx, hair);
    ctx.fillRect(mx * 0.5, Math.round(capY), w - mx, hair);
    const lab = Math.max(6, u * 0.017);
    setType(ctx, 500, lab, "JetBrains Mono", { fallback: MONO, tracking: 0.04 });
    ctx.fillStyle = rgba(theme.ink, 0.45);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("cap", mx * 0.5, capY - lab * 0.6);
    ctx.fillText("baseline", mx * 0.5, baseline + lab * 1.5);

    // The word, as one kerned string.
    setType(ctx, wght, size, face.family, { fallback: FALLBACK, stretch: face.stretch });
    const ww = widthOf(ctx, word);
    ctx.fillStyle = theme.ink;
    ctx.textAlign = "left";
    ctx.fillText(word, w / 2 - ww / 2, baseline);

    // Axis pad.
    const pad = u * (portrait ? 0.26 : 0.2);
    const px = portrait ? mx : mx;
    const py = portrait ? h * 0.7 : h * 0.9 - pad;
    ctx.strokeStyle = rgba(theme.ink, 0.16);
    ctx.lineWidth = hair;
    ctx.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, pad, pad);
    ctx.fillStyle = rgba(theme.ink, 0.18);
    for (let i = 0; i <= 4; i++)
      for (let j = 0; j <= 4; j++) {
        ctx.beginPath();
        ctx.arc(px + (pad * i) / 4, py + (pad * j) / 4, Math.max(0.8, u * 0.0018), 0, TAU);
        ctx.fill();
      }
    const toPad = (wd: number, wg: number) =>
      [px + ((wd - 50) / 100) * pad, py + pad - ((wg - 100) / 800) * pad] as const;
    // The path around the corners.
    ctx.strokeStyle = rgba(theme.accent, 0.35);
    ctx.beginPath();
    CORNERS.forEach((c, i) => {
      const [x, y] = toPad(c.wdth, c.wght);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    // Trail and dot.
    for (let k = 7; k >= 1; k--) {
      const s = state((((t - k * 0.045) % 5) + 5) % 5);
      const [x, y] = toPad(s.wdth, s.wght);
      ctx.fillStyle = rgba(theme.accent, 0.5 * (1 - k / 8));
      ctx.beginPath();
      ctx.arc(x, y, u * 0.006 * (1 - k / 10), 0, TAU);
      ctx.fill();
    }
    const [dx, dy] = toPad(S.wdth, S.wght);
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(dx, dy, u * 0.0085, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(theme.accent, 0.4);
    ctx.lineWidth = Math.max(1, u * 0.0016);
    ctx.beginPath();
    ctx.arc(dx, dy, u * 0.017, 0, TAU);
    ctx.stroke();
    // Pad labels and readouts.
    setType(ctx, 500, lab, "JetBrains Mono", { fallback: MONO, tracking: 0.04 });
    ctx.fillStyle = rgba(theme.ink, 0.42);
    ctx.fillText("wdth →", px, py + pad + lab * 1.6);
    ctx.save();
    ctx.translate(px - lab * 0.7, py + pad);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("wght →", 0, 0);
    ctx.restore();
    const rx = px + pad + lab * 2;
    ctx.fillStyle = rgba(theme.ink, 0.85);
    setType(ctx, 500, lab * 1.15, "JetBrains Mono", { fallback: MONO, tracking: 0.02 });
    ctx.fillText(`wdth ${S.wdth.toFixed(1).padStart(5, " ")}`, rx, py + lab * 1.2);
    ctx.fillText(`wght ${String(wght).padStart(5, " ")}`, rx, py + lab * 2.9);
    ctx.fillStyle = rgba(theme.ink, S.moving ? 0.3 : 0.6);
    setType(ctx, 500, lab, "JetBrains Mono", { fallback: MONO, tracking: 0.02 });
    ctx.fillText(`${FAMILY} ${S.name}`, rx, py + lab * 4.8);

    // Top label band.
    const mark = tintedLogo(theme, rgba(theme.ink, 0.7), lab * 3.4, lab * 1.8);
    setType(ctx, 500, lab, "JetBrains Mono", { fallback: MONO, tracking: 0.12 });
    ctx.fillStyle = rgba(theme.ink, 0.5);
    if (mark) ctx.drawImage(mark as CanvasImageSource, mx, h * 0.08);
    else ctx.fillText("VARIABLE / 2 AXES", mx, h * 0.08 + lab);
    ctx.textAlign = "right";
    ctx.fillText("wdth 50–150 · wght 100–900", w - mx, h * 0.08 + lab);
    ctx.textAlign = "left";

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.28);
    void mix;
  },
};
