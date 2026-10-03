import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  ease,
  fitSize,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  seg,
  SANS,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkPaper, mottleTile, speckTile, tileOver, tintLayer, withShadow } from "./_s1-helpers";

const SERIF = '"Bodoni Moda", "Didot", "Bodoni 72", Georgia, serif';
/** The platen closes, bites at IMPACT, and opens again. */
const IMPACT = 0.4;
/** The printed card is fed out and a blank one fed in. */
const FEED0 = 4.28;

function cardSize(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  if (portrait) {
    const cw = w * 0.84;
    return { cw, ch: Math.min(h * 0.72, cw * 1.4) };
  }
  if (square) {
    const cw = w * 0.84;
    return { cw, ch: cw * 0.74 };
  }
  const ch = h * 0.8;
  return { cw: Math.min(w * 0.82, ch * 1.62), ch };
}

type Layout = { size: number; wordY: number; lineY: number; lineSize: number; ruleY: number };

function layout(c: Ctx2D, word: string, family: string, cw: number, ch: number): Layout {
  const portrait = ch > cw;
  const size = fitSize(
    c,
    word,
    cw * (portrait ? 0.8 : 0.76),
    ch * (portrait ? 0.3 : 0.52),
    800,
    family,
    SERIF,
  );
  return {
    size,
    wordY: ch * (portrait ? 0.53 : 0.555),
    lineY: ch * (portrait ? 0.27 : 0.2),
    lineSize: Math.min(cw, ch) * 0.038,
    ruleY: ch * (portrait ? 0.74 : 0.8),
  };
}

/** Everything the plate bites into the sheet, white on clear. `deep` = the inked word only. */
function plate(theme: Theme, word: string, deep: boolean) {
  return (c: Ctx2D, cw: number, ch: number) => {
    const L = layout(c, word, theme.font, cw, ch);
    c.fillStyle = "#ffffff";
    c.strokeStyle = "#ffffff";
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    if (deep) {
      c.font = font(800, L.size, theme.font, SERIF);
      c.fillText(word, cw / 2, L.wordY + L.size * 0.34);
      return;
    }
    // Blind (uninked) marks: an inner border, a spaced line, a double rule and a number.
    const m = Math.min(cw, ch) * 0.055;
    c.lineWidth = Math.max(1, Math.min(cw, ch) * 0.0035);
    c.strokeRect(m, m, cw - m * 2, ch - m * 2);
    const mark = tintedLogo(theme, "#ffffff", L.lineSize * 2.6, L.lineSize * 2.6);
    if (mark)
      c.drawImage(mark as CanvasImageSource, cw / 2 - L.lineSize * 1.3, L.lineY - L.lineSize * 1.9);
    else {
      c.font = font(600, L.lineSize, "Inter", SANS);
      if ("letterSpacing" in c)
        (c as CanvasRenderingContext2D).letterSpacing = `${(L.lineSize * 0.42).toFixed(1)}px`;
      c.fillText("HAND SET · NO. 07", cw / 2 + L.lineSize * 0.21, L.lineY);
      if ("letterSpacing" in c) (c as CanvasRenderingContext2D).letterSpacing = "0px";
    }
    const rw = cw * 0.11;
    c.lineWidth = Math.max(1, Math.min(cw, ch) * 0.003);
    for (const dy of [0, L.lineSize * 0.34]) {
      c.beginPath();
      c.moveTo(cw / 2 - rw, L.ruleY + dy);
      c.lineTo(cw / 2 + rw, L.ruleY + dy);
      c.stroke();
    }
  };
}

/** The inked word: one ink, squashed dark at the edges, mottled by the cotton, a few misses. */
function inked(theme: Theme, word: string) {
  return (c: Ctx2D, cw: number, ch: number) => {
    const L = layout(c, word, theme.font, cw, ch);
    const y = L.wordY + L.size * 0.34;
    const k = Math.max(0.6, Math.min(cw, ch) / 700);
    const setText = (g: Ctx2D) => {
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      g.font = font(800, L.size, theme.font, SERIF);
    };
    setText(c);
    c.fillStyle = theme.accent;
    c.fillText(word, cw / 2, y);
    // Cotton shows through: lighter patches where the ink laid thin.
    const { canvas: mc, ctx: M } = buffer("lp-ink-mottle", cw, ch);
    M.clearRect(0, 0, cw, ch);
    const pat = M.createPattern(mottleTile(31, 5, 1.8) as CanvasImageSource, "repeat");
    if (pat) {
      if (typeof DOMMatrix !== "undefined")
        pat.setTransform(new DOMMatrix().scaleSelf(k * 1.4, k * 1.4));
      M.fillStyle = pat;
      M.fillRect(0, 0, cw, ch);
      tintLayer(M, cw, ch, mix(theme.accent, theme.ink, 0.5));
      M.globalCompositeOperation = "destination-in";
      setText(M);
      M.fillStyle = "#fff";
      M.fillText(word, cw / 2, y);
      M.globalCompositeOperation = "source-over";
      c.save();
      c.globalAlpha = 0.4;
      c.drawImage(mc as CanvasImageSource, 0, 0);
      c.restore();
    }
    // Ink squash: a denser band just inside every edge.
    M.clearRect(0, 0, cw, ch);
    setText(M);
    M.lineJoin = "round";
    M.strokeStyle = mix(theme.accent, "#000000", 0.3);
    M.lineWidth = L.size * 0.03;
    M.strokeText(word, cw / 2, y);
    M.globalCompositeOperation = "destination-in";
    M.fillStyle = "#fff";
    M.fillText(word, cw / 2, y);
    M.globalCompositeOperation = "source-over";
    c.save();
    c.globalAlpha = 0.8;
    c.drawImage(mc as CanvasImageSource, 0, 0);
    c.restore();
    // …and a faint halo squeezed just past the edge.
    c.save();
    c.globalCompositeOperation = "destination-over";
    c.strokeStyle = rgba(mix(theme.accent, "#000000", 0.2), 0.35);
    c.lineWidth = L.size * 0.012;
    c.strokeText(word, cw / 2, y);
    c.restore();
    // Where the fibres resisted: tiny misses.
    tileOver(c, cw, ch, speckTile(808, 520, 1.1, 2.6), { alpha: 0.5, scale: k });
  };
}

/** Shade one impression for light arriving from direction la (radians, toward the light). */
function deboss(
  card: Ctx2D,
  cw: number,
  ch: number,
  mask: AnyCanvas,
  depth: number,
  la: number,
  theme: Theme,
  strength: number,
) {
  if (strength <= 0.001) return;
  const lx = Math.cos(la) * depth;
  const ly = Math.sin(la) * depth;
  const { canvas: tc, ctx: T } = buffer("lp-shade", cw, ch);
  const src = mask as CanvasImageSource;
  // Pressed floor: compressed cotton reads a touch darker.
  card.save();
  card.globalAlpha = 0.22 * strength;
  card.globalCompositeOperation = "multiply";
  card.drawImage(src, 0, 0);
  card.restore();
  // Walls on the light side throw shadow onto the floor.
  T.clearRect(0, 0, cw, ch);
  T.globalCompositeOperation = "source-over";
  T.drawImage(src, 0, 0);
  T.globalCompositeOperation = "destination-out";
  T.drawImage(src, -lx, -ly);
  T.globalCompositeOperation = "source-over";
  tintLayer(T, cw, ch, "#000000");
  card.save();
  card.globalAlpha = 0.92 * strength;
  card.filter = `blur(${Math.max(0.4, depth * 0.3).toFixed(2)}px)`;
  card.drawImage(tc as CanvasImageSource, 0, 0);
  card.restore();
  // Walls facing the light catch it.
  T.clearRect(0, 0, cw, ch);
  T.drawImage(src, 0, 0);
  T.globalCompositeOperation = "destination-out";
  T.drawImage(src, lx * 0.8, ly * 0.8);
  T.globalCompositeOperation = "source-over";
  tintLayer(T, cw, ch, theme.ink);
  card.save();
  card.globalAlpha = 0.55 * strength;
  card.filter = `blur(${Math.max(0.3, depth * 0.22).toFixed(2)}px)`;
  card.drawImage(tc as CanvasImageSource, 0, 0);
  card.restore();
  // The lip just outside the lit wall: the sheet bulges where the plate pushed it.
  T.clearRect(0, 0, cw, ch);
  T.drawImage(src, lx * 0.9, ly * 0.9);
  T.globalCompositeOperation = "destination-out";
  T.drawImage(src, 0, 0);
  T.globalCompositeOperation = "source-over";
  tintLayer(T, cw, ch, theme.ink);
  card.save();
  card.globalAlpha = 0.12 * strength;
  card.filter = `blur(${Math.max(0.5, depth * 0.6).toFixed(2)}px)`;
  card.drawImage(tc as CanvasImageSource, 0, 0);
  card.restore();
}

function cardStock(theme: Theme) {
  return darkPaper(theme, 17, { tone: 0.065, fibres: 1.3, mottle: 0.8 });
}

export const style: MotionStyle = {
  id: "letterpress",
  name: "Letterpress Deboss",
  family: "Print & Craft",
  tagline: "A word bitten into cotton card",
  look: "One word bitten deep into black cotton card in a single ink, squashed dark at its edges, lit by a raking lamp.",
  move: "The platen closes and bites, opens on the fresh impression, the lamp rakes across its walls, then the sheet is fed out for the next.",
  rules: [
    "Depth is light: shadow on the walls facing the lamp, a lit wall opposite.",
    "One ink only; every other mark is a blind (uninked) impression.",
    "Ink squash: a darker band just inside every letter edge.",
    "The cotton shows through the ink as mottle and tiny misses.",
    "The press bites once, hard, with a small recoil; nothing else shakes.",
    "The lamp moves, the card holds still while it reads.",
    "The card has thickness: a lit edge and a soft contact shadow.",
  ],
  prompt: `R — References
• Letterpress on heavy cotton stock (search: deep impression letterpress, black cotton letterpress card, blind deboss).
• A Heidelberg platen press printing: the sheet is fed, the platen closes, the sheet is delivered.

I — Idea
One sheet through the press, 5 seconds, looping seamlessly:
• Beginning (0–0.5 s): a black cotton card, already blind-pressed with a border and a small spaced line, sits on the press; the platen closes toward the camera and bites.
• Middle (0.5–4.1 s): it opens on "{{name}}" pressed deep in one ink, with a blind border and a small spaced line; a raking lamp swings across so the walls of every letter change their shadows.
• End (4.1–5 s): the printed card is fed out to the left as the next blank card slides in to the same spot.

S — Style
Looks: {{bg}} press bed, card a touch lighter with visible cotton fibres; one {{accent}} ink; {{ink}} only as light on the walls; the word in {{font}} (a heavy Didone suits it), everything else blind.
Moves: the platen closes with an ease-in, bites with a 0.1 s recoil, opens with an ease-out; the lamp swings on a slow sine; the feed eases in and out over 0.9 s.
Rules:
1. Shade the deboss with offset masks: shadow on the lamp side, lit wall opposite, a faint lip outside.
2. One ink; squash it darker inside every edge and let the paper mottle through.
3. Blind impressions carry the secondary type.
4. One hard bite per loop; no drifting.
5. The card has an edge and a contact shadow.
6. Grain and light falloff on the bed.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word reads as pressed in, not printed on; shadows flip sides as the lamp moves; the ink edge is darker than its middle; no letter is clipped. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Letterpress_printing",
  theme: {
    bg: "#121110",
    ink: "#ece4d6",
    accent: "#e2543a",
    accent2: "#8f9fb2",
    font: "Bodoni Moda",
  },
  fonts: ["Bodoni Moda:opsz,wght@6..96,400..900"],
  tags: [
    "letterpress",
    "deboss",
    "emboss",
    "print",
    "press",
    "cotton",
    "stationery",
    "type",
    "luxury",
    "invitation",
    "craft",
  ],
  word: "Press",
  render(ctx, t, theme, w, h) {
    const { u, cx, cy } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `lp-bed:${theme.bg}${theme.ink}`,
        w,
        h,
        darkPaper(theme, 5, { fibres: 0.25, mottle: 1.4 }),
      ) as CanvasImageSource,
      0,
      0,
    );

    // The lamp swings across the top of the sheet once per loop.
    const la = -Math.PI / 2 - 0.95 * Math.cos(TAU * ((t - IMPACT) / LOOP));
    const lampX = cx + Math.cos(la) * w * 0.34;
    const lampY = cy + Math.sin(la) * h * 0.46;
    light(ctx, lampX, lampY, Math.max(w, h) * 0.8, mix(theme.ink, theme.accent2, 0.25), 0.16);

    const { cw, ch } = cardSize(w, h);
    const word = wordFor(theme.name, "Press", 12);
    const logoKey = theme.logo ? `${theme.logo.length}${theme.logo.slice(-24)}` : "";
    const key = `${theme.font}|${word}|${theme.accent}|${theme.ink}|${logoKey}`;
    const deep = bake(`lp-deep:${key}`, cw, ch, plate(theme, word, true));
    const blind = bake(`lp-blind:${key}`, cw, ch, plate(theme, word, false));
    const ink = bake(`lp-ink:${key}`, cw, ch, inked(theme, word));
    const stock = bake(`lp-stock:${theme.bg}${theme.ink}`, cw, ch, cardStock(theme));

    // Press cycle: close (scale toward camera, platen shadow), bite, open.
    const close = ease.inCubic(seg(t, 0, IMPACT));
    const open = ease.outCubic(seg(t, IMPACT, IMPACT + 0.7));
    const pressed = t >= IMPACT && t < FEED0 + 1;
    const platen = t < IMPACT ? close : 1 - open;
    const since = t - IMPACT;
    const recoil =
      since >= 0 && since < 0.16 ? Math.sin((since / 0.16) * Math.PI) * (1 - since / 0.16) : 0;
    const depthK = pressed ? 1 + 0.12 * recoil : 0;
    const scale = 1 + 0.03 * platen - 0.006 * recoil;
    const shake = since >= 0 && since < 0.14 ? (1 - since / 0.14) * u * 0.0025 : 0;

    const feed = ease.inOutCubic(seg(t, FEED0, LOOP));
    const D = w / 2 + cw / 2 + w * 0.04;

    const drawCard = (dx: number, printed: boolean) => {
      const { canvas: cc, ctx: C } = buffer(printed ? "lp-card-a" : "lp-card-b", cw, ch);
      C.globalCompositeOperation = "source-over";
      C.globalAlpha = 1;
      C.filter = "none";
      C.drawImage(stock as CanvasImageSource, 0, 0);
      // The blind border and small line came in an earlier pass: always there.
      deboss(C, cw, ch, blind, u * 0.0028, la, theme, 1);
      if (printed) {
        C.save();
        C.globalAlpha = 0.97;
        C.drawImage(ink as CanvasImageSource, 0, 0);
        C.restore();
        deboss(C, cw, ch, deep, u * 0.0085 * depthK, la, theme, 1);
      }
      // Soft sheen falling off from the lamp side.
      const g = C.createLinearGradient(
        cw / 2 + Math.cos(la) * cw * 0.6,
        ch / 2 + Math.sin(la) * ch * 0.6,
        cw / 2 - Math.cos(la) * cw * 0.6,
        ch / 2 - Math.sin(la) * ch * 0.6,
      );
      g.addColorStop(0, rgba(theme.ink, 0.11));
      g.addColorStop(0.55, rgba(theme.ink, 0));
      g.addColorStop(1, rgba("#000000", 0.24));
      C.fillStyle = g;
      C.fillRect(0, 0, cw, ch);

      const x = cx - cw / 2 + dx;
      const y = cy - ch / 2;
      if (x > w || x + cw < 0) return;
      ctx.save();
      ctx.translate(
        cx + dx + (hash(Math.floor(since * 60), 3) - 0.5) * shake,
        cy + (hash(Math.floor(since * 60), 5) - 0.5) * shake,
      );
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      // Thickness: a lit bottom edge, then a contact shadow thrown away from the lamp.
      const th = Math.max(1.5, u * 0.0045);
      withShadow(
        ctx,
        u * 0.045,
        -Math.cos(la) * u * 0.02,
        -Math.sin(la) * u * 0.02 + u * 0.01,
        "rgba(0,0,0,0.7)",
        () => {
          ctx.fillStyle = mix(theme.bg, theme.ink, 0.2);
          ctx.fillRect(cx - cw / 2, y + th, cw, ch);
        },
      );
      ctx.drawImage(cc as CanvasImageSource, cx - cw / 2, y);
      ctx.fillStyle = rgba(theme.ink, 0.1);
      ctx.fillRect(cx - cw / 2, y, cw, Math.max(1, u * 0.0012));
      ctx.restore();
    };

    drawCard(-feed * D, t >= IMPACT);
    if (feed > 0) drawCard((1 - feed) * D, false);

    // The platen's shadow as it closes over the sheet.
    if (platen > 0.001) {
      ctx.save();
      ctx.fillStyle = rgba("#000000", 0.72 * platen);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      light(ctx, cx, cy, Math.max(w, h) * 0.6, theme.ink, 0.04 * (1 - platen));
    }

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
