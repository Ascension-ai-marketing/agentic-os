import { mix, rgba } from "../engine/color";
import { ease, grain, lerp, once, seg, TAU, vignette, wordFor } from "../engine/kit";
import type { MotionStyle } from "../engine/types";
import {
  at,
  collage,
  fnFrame,
  fnGround,
  fnPalette,
  ink,
  line,
  nib,
  rrect,
  serif,
  serifWidth,
  wob,
  type Pt,
} from "./field-notes/kit";

/** The card, in its own design space (1000 x 620), laid out once per aspect. */
function card(portrait: boolean) {
  return once(`fn-sketch-card:${portrait}`, () => {
    const W = portrait ? 820 : 1000;
    const H = portrait ? 1000 : 620;
    const frame = wob(rrect(0, 0, W, H, 18, 5), 1.4, 3, 90);
    const chrome = line(0, 58, W, 58, 6);
    const dots: Pt[] = [
      [34, 30],
      [58, 30],
      [82, 30],
    ];
    const pill = rrect(W * 0.33, 19, W * 0.34, 22, 11, 4);
    const underline = wob(line(W * 0.22, H * 0.6, W * 0.78, H * 0.6, 5), 2.2, 11, 70);
    const footer = [0, 1, 2].map((i) =>
      line(W * (0.12 + i * 0.13), H - 54, W * (0.2 + i * 0.13), H - 54, 5),
    );
    return { W, H, frame, chrome, dots, pill, underline, footer };
  });
}

export const style: MotionStyle = {
  id: "field-notes-sketch",
  name: "Field Notes · Sketch",
  look: "An ivory ink sketch of a page over its pencil draft, on night, with torn ochre paper and a dawn rim at the foot.",
  move: "A clay nib inks the frame over its pencil lines, the headline writes itself, a button pops, then the ink lifts back to pencil.",
  rules: [
    "Everything is drawn: ivory ink over a faint pencil draft that never leaves.",
    "A clay nib rides the tip of whatever is being inked; it is the only warm point.",
    "Lines carry a hand wobble, fixed per path, never jitter.",
    "Headlines in Newsreader 500 at opsz 36, set tight.",
    "Torn ochre paper with an ink compass sketch anchors one corner.",
    "The dawn planet rim glows at the foot of every frame.",
    "The loop ends by lifting the ink back to pencil.",
  ],
  prompt: `R — References
• An engineer's field notebook: ink over pencil construction, compass sketches, torn paper collage.
• The Horizon Strike look: night ground, a dawn planet rim at the foot, ivory ink, one clay accent.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a page is sketched in pencil on night; a clay nib inks its frame over the pencil, stroke by stroke.
• Middle (1.5–3 s): the headline "{{name}}" writes itself, an ink underline swings under it, a clay button pops.
• End (3–5 s): hold, then the ink lifts back to the pencil draft, which is the first frame.

S — Style
Looks: {{bg}} night with a soft light pool and a dawn planet rim at the foot; {{ink}} ink lines with a hand wobble over faint pencil; {{font}} 500 at opsz 36; torn {{accent2}} paper with an ink compass sketch in the top corner, a zebra strip below; one {{accent}} nib and button.
Moves: ink draws along each path by length (ease out), the nib glows at the tip, the headline wipes in at writing speed, the button pops with a little overshoot, the lift back to pencil eases in and out.
Rules:
1. Ink over pencil; the pencil draft is always visible.
2. One warm point: the clay nib (and the button it leaves behind).
3. Fixed hand wobble per path.
4. Serif set at opsz 36, never all caps.
5. Paper collage in the corners; grain and vignette on top.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the nib sits exactly on the ink tip; the headline never clips its descenders; the torn paper has a fibre rim; the rim glow is at the foot. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Field_notes",
  theme: {
    bg: "#07080c",
    ink: "#f4f1ea",
    accent: "#d97757",
    accent2: "#e3b23c",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..700"],
  tags: [
    "sketch",
    "notebook",
    "ink",
    "pencil",
    "draw",
    "draws",
    "website",
    "page",
    "wireframe",
    "paper",
    "collage",
    "field notes",
  ],
  word: "Field notes",
  family: "Field Notes",
  tagline: "Ink over pencil, a clay nib",
  render(ctx, t, theme, w, h) {
    const f = fnFrame(w, h);
    const P = fnPalette(theme);
    fnGround(ctx, f, theme, t / 5);
    collage(ctx, theme, f, t);

    const c = card(f.portrait);
    const k = Math.min(
      (w * (f.portrait ? 0.84 : 0.6)) / c.W,
      (h * (f.portrait ? 0.56 : 0.6)) / c.H,
    );
    const ox = f.cx - (c.W * k) / 2;
    const oy = h * (f.portrait ? 0.44 : 0.46) - (c.H * k) / 2;
    const lift = ease.inOutSine(seg(t, 4.1, 4.85));
    const inked = 1 - lift;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    const lw = 2.4;
    // Pencil draft: always there.
    const pencil = { color: P.moon, w: 1.2, alpha: 0.2 };
    ink(ctx, c.frame, pencil);
    ink(ctx, c.chrome, pencil);
    ink(ctx, c.pill, pencil);
    ink(ctx, c.underline, pencil);
    for (const l of c.footer) ink(ctx, l, pencil);
    // Ink, drawn on.
    const pFrame = ease.inOutCubic(seg(t, 0.3, 1.55));
    const pChrome = ease.outCubic(seg(t, 1.2, 1.7));
    const pUnder = ease.outCubic(seg(t, 2.15, 2.6));
    const inkStyle = (to: number) => ({ color: P.moon, w: lw, to, alpha: inked });
    ink(ctx, c.frame, inkStyle(pFrame));
    ink(ctx, c.chrome, inkStyle(pChrome));
    ink(ctx, c.pill, { ...inkStyle(ease.outCubic(seg(t, 1.45, 1.85))), w: 1.6 });
    if (pChrome > 0)
      for (const [x, y] of c.dots) {
        ctx.save();
        ctx.globalAlpha = inked * pChrome;
        ctx.strokeStyle = P.moon;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    ink(ctx, c.underline, { ...inkStyle(pUnder), color: mix(P.moon, P.clay, 0.15) });
    c.footer.forEach((l, i) =>
      ink(ctx, l, inkStyle(ease.outCubic(seg(t, 2.6 + i * 0.1, 2.95 + i * 0.1)))),
    );

    // Headline: writes in at writing speed.
    const word = wordFor(theme.name, "Field notes", 18);
    const size = Math.min(104, (c.W * 0.62) / Math.max(1, serifWidth(ctx, theme.font, word, 1)));
    const tw = serifWidth(ctx, theme.font, word, size);
    const hx = (c.W - tw) / 2;
    const hy = c.H * 0.52;
    const write = ease.inOutSine(seg(t, 1.5, 2.45));
    if (write > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(hx - 10, hy - size * 1.1, (tw + 20) * write, size * 1.5);
      ctx.clip();
      serif(ctx, theme.font, word, hx, hy, size, { color: P.moon, alpha: inked });
      ctx.restore();
    }
    // Clay button pops with a little overshoot.
    const pop = ease.outBack(seg(t, 2.5, 2.85));
    if (pop > 0 && inked > 0) {
      const bw = 150;
      const bh = 48;
      const bx = c.W / 2;
      const by = c.H * 0.72;
      ctx.save();
      ctx.globalAlpha = inked;
      ctx.translate(bx, by);
      ctx.scale(pop, pop);
      ctx.fillStyle = P.clay;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
      ctx.fill();
      ctx.strokeStyle = P.ivory;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(16, 0);
      ctx.moveTo(6, -9);
      ctx.lineTo(16, 0);
      ctx.lineTo(6, 9);
      ctx.stroke();
      ctx.restore();
    }
    // The nib rides the tip of whatever is being inked.
    let tip: [number, number] | null = null;
    if (pFrame > 0 && pFrame < 1) tip = at(c.frame, pFrame).slice(0, 2) as [number, number];
    else if (write > 0 && write < 1) tip = [hx + tw * write, hy - size * 0.3];
    else if (pUnder > 0 && pUnder < 1)
      tip = at(c.underline, pUnder).slice(0, 2) as [number, number];
    if (tip) nib(ctx, theme, tip[0], tip[1], inked, 7);
    ctx.restore();

    // Caption under the card.
    const cap = Math.max(9, 15 * f.s);
    ctx.save();
    ctx.font = `600 ${cap.toFixed(1)}px "Inter", sans-serif`;
    ctx.letterSpacing = `${(cap * 0.16).toFixed(2)}px`;
    ctx.fillStyle = rgba(P.moon, 0.42);
    ctx.textAlign = "center";
    ctx.fillText("FIELD NOTES", f.cx, oy + c.H * k + cap * 3.2);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
    void lerp;
  },
};
