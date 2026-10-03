import { mix, rgba } from "../engine/color";
import {
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  MONO,
  seg,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle } from "../engine/types";
import { darkStock, loopT, setType, widthOf, type Box } from "./_s8-helpers";

const SERIF = '"Fraunces", "Newsreader", Georgia, serif';

/** Timeline (s): frame the start, move to a detail, commit the crop, hold, release, return. */
const T = {
  move1: [0.5, 1.1],
  zoomIn: [1.15, 1.85],
  hold: [1.85, 3.2],
  zoomOut: [3.2, 3.9],
  move2: [3.9, 4.5],
};

const lerpBox = (a: Box, b: Box, k: number): Box => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k),
});

function cropMarks(c: Ctx2D, r: Box, len: number, gap: number, color: string, lw: number) {
  c.strokeStyle = color;
  c.lineWidth = lw;
  c.lineCap = "butt";
  c.beginPath();
  const corners: [number, number, number, number][] = [
    [r.x, r.y, -1, -1],
    [r.x + r.w, r.y, 1, -1],
    [r.x, r.y + r.h, -1, 1],
    [r.x + r.w, r.y + r.h, 1, 1],
  ];
  for (const [x, y, sx, sy] of corners) {
    // Marks sit just outside the corner, like print crop marks.
    c.moveTo(x + sx * gap, y);
    c.lineTo(x + sx * (gap + len), y);
    c.moveTo(x, y + sy * gap);
    c.lineTo(x, y + sy * (gap + len));
  }
  c.stroke();
}

export const style: MotionStyle = {
  id: "crop-reveal",
  name: "Crop Reveal",
  family: "Type & Editorial",
  tagline: "An art director's crop",
  look: "A huge soft-serif word under an art director's crop: the frame dims everything outside it, crop marks at its corners, then commits and fills the screen.",
  move: "The crop glides to a detail of the letterforms, commits and scales it to fill the frame, holds on the huge cropped shapes, then releases back.",
  rules: [
    "The word is huge and whole; the crop decides what is seen.",
    "Outside the crop the type dims to a ghost; inside it is full ink.",
    "Crop marks sit just outside each corner, in the one accent.",
    "Moves ease in and out; the zoom is exponential so it feels even.",
    "Thirds guides appear only while the crop is moving.",
    "Hold the committed crop 1.3 s: letterforms as pure shapes.",
    "Readouts are tiny mono captions riding the crop's corner.",
  ],
  prompt: `R — References
• Editorial and poster design built from cropped giant letterforms (search: cropped typography poster, oversized type crop).
• Photo-editor crop tools: dimmed outside, corner handles, thirds grid while dragging.
• Fraunces or another soft, high-contrast display serif at black weight.

I — Idea
One huge word, re-framed, 5 seconds, looping seamlessly:
• Beginning (0–1.1 s): "{{name}}" fills the frame in black serif; a crop frames its first letters, everything outside dimmed; then it glides to a detail in the middle of the word.
• Middle (1.1–3.2 s): the crop commits — it scales up until the detail fills the screen — and holds on the huge cropped shapes of the letters.
• End (3.2–5 s): it releases back to the whole word and returns to the first crop.

S — Style
Looks: {{bg}} ground with soft light; the word in {{ink}}, Fraunces 900 (or {{font}}); outside the crop the word is a 16% ghost under a dark veil; {{accent}} crop marks just outside the corners; faint thirds guides; tiny mono readouts (size, zoom).
Moves: crop moves 0.6 s inOutCubic; the commit is an exponential zoom over 0.7 s so it feels even; hold 1.35 s with a slow 3% push; release mirrors the commit.
Rules:
1. The whole word is always there; only the crop changes what reads.
2. Ghost outside, full ink inside.
3. Accent only on the crop marks and the zoom readout.
4. Exponential zoom, eased.
5. Thirds guides only while moving.
6. Grain and light falloff; never a flat ground.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the committed crop fills the frame exactly; edges of the huge letters stay crisp; the crop marks never cover the type; the full word reads at the start. Fix what fails and render again until every check passes.`,
  ref: "https://fonts.google.com/specimen/Fraunces",
  theme: {
    bg: "#0e0d0c",
    ink: "#f2ece0",
    accent: "#ff5b3a",
    accent2: "#86807a",
    font: "Fraunces",
  },
  fonts: ["Fraunces:opsz,wght@9..144,100..900", "JetBrains Mono:wght@400;500"],
  tags: [
    "crop",
    "reveal",
    "type",
    "typography",
    "editorial",
    "serif",
    "zoom",
    "frame",
    "poster",
    "letterforms",
    "big type",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { portrait, u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "crop", w, h, 23) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.45, h * 0.3, Math.max(w, h) * 0.8, theme.ink, 0.08);

    const word = wordFor(theme.name, "Motion", 12);
    const family = theme.font;
    // Tall frames set the word up the page (rotated a quarter turn), as posters do,
    // so it stays huge. Layout happens in the word's own frame (LW x LH).
    const rot = portrait;
    const LW = rot ? h : w;
    const LH = rot ? w : h;
    const toScreen = (b: Box): Box => (rot ? { x: b.y, y: LW - b.x - b.w, w: b.h, h: b.w } : b);
    // Set the word as large as the frame allows.
    const maxW = LW * (rot ? 0.88 : 0.86);
    setType(ctx, 900, 100, family, { fallback: SERIF, tracking: -0.02 });
    const m100 = ctx.measureText(word);
    const asc = m100.actualBoundingBoxAscent / 100;
    const desc = m100.actualBoundingBoxDescent / 100;
    const size = Math.min(
      (100 * maxW) / widthOf(ctx, word),
      (LH * (rot ? 0.74 : 0.62)) / (asc + desc),
    );
    setType(ctx, 900, size, family, { fallback: SERIF, tracking: -0.02 });
    const ww = widthOf(ctx, word);
    const bx = (LW - ww) / 2;
    const baseline = LH / 2 + ((asc - desc) * size) / 2;
    const top = baseline - asc * size;
    const bh = (asc + desc) * size;

    // Crops, laid out in the word's frame and mapped to the screen.
    const margin = u * 0.05;
    const K0 = toScreen({
      x: bx - margin,
      y: top - margin,
      w: ww * 0.42 + margin,
      h: bh + margin * 2,
    });
    const kw = ww * 0.3;
    const kh = (kw * LH) / LW;
    const K1 = toScreen({ x: bx + ww * 0.52 - kw / 2, y: top + bh * 0.46 - kh / 2, w: kw, h: kh });
    const Z = w / K1.w;

    // Where the crop is, and how far the view has zoomed into it.
    const m1 = ease.inOutCubic(seg(t, T.move1[0], T.move1[1]));
    const m2 = ease.inOutCubic(seg(t, T.move2[0], T.move2[1]));
    const zin = ease.inOutCubic(seg(t, T.zoomIn[0], T.zoomIn[1]));
    const zout = ease.inOutCubic(seg(t, T.zoomOut[0], T.zoomOut[1]));
    const zk = zin * (1 - zout);
    const push = 1 + 0.03 * ease.inOutSine(seg(t, T.hold[0], T.zoomOut[1]));
    const crop = t < T.move2[0] ? lerpBox(K0, K1, m1) : lerpBox(K1, K0, m2);
    const s = Math.exp(Math.log(Z) * zk) * (zk > 0 ? lerp(1, push, clamp(zk)) : 1);
    const kc = Z > 1 ? (s - 1) / (Z - 1) : 0;
    const ccx = lerp(w / 2, crop.x + crop.w / 2, clamp(kc));
    const ccy = lerp(h / 2, crop.y + crop.h / 2, clamp(kc));
    const view = (x: number, y: number) => [(x - ccx) * s + w / 2, (y - ccy) * s + h / 2] as const;
    const [sx0, sy0] = view(crop.x, crop.y);
    const screen: Box = { x: sx0, y: sy0, w: crop.w * s, h: crop.h * s };

    const drawWord = (c: Ctx2D, color: string) => {
      c.save();
      c.translate(w / 2, h / 2);
      c.scale(s, s);
      c.translate(-ccx, -ccy);
      if (rot) c.transform(0, -1, 1, 0, 0, LW);
      setType(c, 900, size, family, { fallback: SERIF, tracking: -0.02 });
      c.fillStyle = color;
      c.textBaseline = "alphabetic";
      c.fillText(word, bx, baseline);
      c.restore();
    };

    // Ghost outside, veil, then the crop in full ink.
    drawWord(ctx, rgba(theme.ink, 0.16));
    ctx.save();
    ctx.fillStyle = rgba("#000000", 0.28);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(screen.x, screen.y, screen.w, screen.h);
    ctx.fill("evenodd");
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(screen.x, screen.y, screen.w, screen.h);
    ctx.clip();
    ctx.fillStyle = rgba(mix(theme.bg, theme.ink, 0.04), 1);
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
    light(
      ctx,
      screen.x + screen.w * 0.3,
      screen.y + screen.h * 0.2,
      Math.max(screen.w, screen.h),
      theme.ink,
      0.06,
    );
    drawWord(ctx, theme.ink);
    // Thirds guides while the crop is moving.
    const moving = Math.max(
      Math.sin(Math.PI * m1),
      Math.sin(Math.PI * m2),
      Math.sin(Math.PI * zin) * 0.6,
      Math.sin(Math.PI * zout) * 0.6,
    );
    if (moving > 0.01) {
      ctx.fillStyle = rgba(theme.ink, 0.22 * moving);
      const lw = Math.max(1, u * 0.0012);
      for (const f of [1 / 3, 2 / 3]) {
        ctx.fillRect(screen.x + screen.w * f, screen.y, lw, screen.h);
        ctx.fillRect(screen.x, screen.y + screen.h * f, screen.w, lw);
      }
    }
    ctx.restore();

    // Frame hairline and crop marks (they sit outside the crop, so they leave the screen when it fills).
    const lw = Math.max(1, u * 0.0016);
    ctx.strokeStyle = rgba(theme.ink, 0.35);
    ctx.lineWidth = lw;
    ctx.strokeRect(screen.x, screen.y, screen.w, screen.h);
    const inset = zk > 0.001 ? lerp(0, u * 0.06, ease.inOutCubic(zk)) : 0;
    const marks: Box = {
      x: screen.x + inset,
      y: screen.y + inset,
      w: screen.w - inset * 2,
      h: screen.h - inset * 2,
    };
    cropMarks(ctx, marks, u * 0.035, u * 0.012, theme.accent, Math.max(1.5, u * 0.0035));

    // Readouts riding the crop's corner.
    const lab = Math.max(6, u * 0.016);
    setType(ctx, 500, lab, "JetBrains Mono", { fallback: MONO, tracking: 0.06 });
    ctx.textBaseline = "alphabetic";
    const dims = `${Math.round((crop.w / w) * 1920)} × ${Math.round((crop.h / w) * 1920)}`;
    const zoom = `${s.toFixed(2)}×`;
    const rx = marks.x;
    const ry = marks.y - lab * 1.1;
    const inside = ry < lab * 2;
    ctx.fillStyle = rgba(theme.ink, 0.62);
    ctx.fillText(`CROP  ${dims}`, inside ? marks.x + lab : rx, inside ? marks.y + lab * 2 : ry);
    ctx.fillStyle = theme.accent;
    ctx.textAlign = "right";
    ctx.fillText(
      zoom,
      inside ? marks.x + marks.w - lab : marks.x + marks.w,
      inside ? marks.y + lab * 2 : ry,
    );
    ctx.textAlign = "left";

    // Corner label.
    const mark = tintedLogo(theme, rgba(theme.ink, 0.6), lab * 3.4, lab * 1.8);
    if (mark && zk < 0.5)
      ctx.drawImage(mark as CanvasImageSource, w * 0.05, h - h * 0.05 - lab * 1.8);

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
