import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  fract,
  frameOf,
  grain,
  ground,
  hash,
  LOOP,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { faceReady, glyphXs, preloadFaces, setType, widthOf, type Box } from "./_s8-helpers";

const SERIF = '"Cormorant Garamond", "Newsreader", Georgia, serif';
const GOTHIC = '"League Gothic", "Oswald", "Arial Narrow", sans-serif';
const ITALIC = 'italic 500 48px "Cormorant Garamond"';
preloadFaces("Cormorant Garamond:ital,wght@1,500", [ITALIC]);

const FPS = 24;
const ARTICLE = "THE";
const TITLE = "LONG TAKE";
/** Card timings: presenter card, then the title card with its billing block. */
const A = { in: [1.52, 1.86], out: [3.06, 3.38] };
/**
 * The title card runs on unwrapped time (tb = t + 5 before 2.5 s): it builds at
 * the end of the loop and is still up when the loop starts, then fades out.
 */
const B = { in: [3.5, 4.12], out: [6.0, 6.4] };
const unwrap = (t: number) => (t < 2.5 ? t + LOOP : t);

/** The film gate: 2.39:1 on wide frames, the full frame otherwise. */
function gate(w: number, h: number): Box {
  if (w > h * 1.2) {
    const gh = Math.min(h, w / 2.39);
    return { x: 0, y: (h - gh) / 2, w, h: gh };
  }
  return { x: 0, y: 0, w, h };
}

function billing(presenter: string): [string, boolean][] {
  return [
    [presenter, true],
    ["presents", false],
    ["a", false],
    ["CODE", true],
    ["production", false],
    [`${ARTICLE} ${TITLE}`, true],
    ["music by", false],
    ["SILENCE", true],
    ["edited by", false],
    ["TIME", true],
    ["photography by", false],
    ["ONE FUNCTION", true],
    ["produced in", false],
    ["FIVE SECONDS", true],
  ];
}

/** Warm halation around bright type: the red glow film gives highlights. */
function halo(theme: Theme, draw: (c: Ctx2D) => void, blur: number) {
  return (c: Ctx2D) => {
    c.filter = `blur(${blur.toFixed(1)}px)`;
    draw(c);
    c.filter = "none";
    c.globalCompositeOperation = "source-in";
    c.fillStyle = theme.accent;
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  };
}

export const style: MotionStyle = {
  id: "title-card",
  name: "Film Title Card",
  family: "Type & Editorial",
  tagline: "A 35 mm opening title",
  look: "A 35 mm opening title in a 2.39:1 gate: wide-tracked Garamond caps, a condensed billing block, heavy grain, halation, dust and gate weave.",
  move: "The title holds, a cue mark flashes, fade through black to the presenter, then the title's letters surface one by one and the billing block settles.",
  rules: [
    "Everything steps at 24 frames a second: weave, flicker, dust.",
    "Titles fade through black, never slide.",
    "Title in wide-tracked caps; the only glow is film halation.",
    "The billing block: tiny roles, taller names, condensed gothic.",
    "Grain is heavy and alive; the blacks are never pure.",
    "One cue mark near the end of the reel, four frames long.",
    "Hold the title at least 1.2 s at full strength.",
  ],
  prompt: `R — References
• Opening title cards of 1970s and A24-era films (search: film opening title card, movie billing block).
• 35 mm projection artefacts: gate weave, flicker, dust, halation, cue marks (cigarette burns).

I — Idea
An opening title on a loop, 5 seconds, looping seamlessly:
• Beginning (0–1.6 s): the title card holds — a small THE over LONG TAKE in wide-tracked caps, an italic line, a condensed billing block; a cue mark flashes for four frames; it fades to black.
• Middle (1.6–3.4 s): "A {{name}} PICTURE" fades up in tracked caps, holds, and fades back to black.
• End (3.4–5 s): THE fades up, then LONG TAKE surfaces letter by letter; the italic line and billing block settle, and the card holds into the next loop.

S — Style
Looks: a 2.39:1 gate on {{bg}}; {{ink}} type in Cormorant Garamond (or {{font}}) caps tracked +28%; League Gothic billing block; warm {{accent}} halation around the type; heavy grain, dust specks, a faint scratch, gate weave, flicker, a projector hotspot.
Moves: fades 0.35–0.75 s; title letters surface in a seeded random order over 0.75 s; all film artefacts step at 24 fps and are seeded by frame number.
Rules:
1. 24 fps artefacts, seeded by frame.
2. Fades through black only.
3. Halation, not glow: red-orange bloom on the brightest type.
4. Billing block: small roles, tall names, one line or two.
5. A cue mark for four frames near the end.
6. Hold the title at least 1.2 s.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the title is centred and never clipped; the billing block is legible at full size; the grain moves every frame but the weave stays subtle; no card cuts, all fades. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Title_sequence",
  theme: {
    bg: "#0b0a09",
    ink: "#efe6d4",
    accent: "#ff5a24",
    accent2: "#8d8578",
    font: "Cormorant Garamond",
  },
  fonts: ["Cormorant Garamond:wght@300..700", "League Gothic:wdth@75..100"],
  tags: [
    "film",
    "title",
    "title card",
    "cinema",
    "credits",
    "movie",
    "grain",
    "35mm",
    "opening",
    "serif",
    "editorial",
  ],
  word: "Motion Library",
  render(ctx, t, theme, w, h) {
    const frame = Math.floor(fract(t / LOOP) * LOOP * FPS + 1e-6);
    const tf = frame / FPS;
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, "#000000");
    const G = gate(w, h);

    // Gate weave and flicker, per film frame.
    const wx = (hash(frame, 3) - 0.5) * u * 0.003;
    const wy = (hash(frame, 5) - 0.5) * u * 0.0045;
    const flicker = 1 + (hash(frame, 7) - 0.5) * 0.07;

    ctx.save();
    ctx.beginPath();
    ctx.rect(G.x, G.y, G.w, G.h);
    ctx.clip();
    ctx.translate(wx, wy);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(G.x - 4, G.y - 4, G.w + 8, G.h + 8);
    // Projector hotspot.
    const hs = ctx.createRadialGradient(
      w / 2,
      G.y + G.h * 0.48,
      0,
      w / 2,
      G.y + G.h * 0.48,
      Math.max(G.w, G.h) * 0.62,
    );
    hs.addColorStop(0, rgba(mix(theme.bg, theme.ink, 0.16), 0.9 * flicker));
    hs.addColorStop(1, rgba(theme.bg, 0));
    ctx.fillStyle = hs;
    ctx.fillRect(G.x, G.y, G.w, G.h);

    const presenter = `A ${wordFor(theme.name, "Motion Library", 18).toUpperCase()} PICTURE`;
    const family = theme.font;
    const italicOk = family === "Cormorant Garamond" ? faceReady(ITALIC) : true;
    const cx = w / 2;
    const cy = G.y + G.h * (portrait ? 0.46 : 0.47);

    // ── Card A: the presenter.
    const aIn = ease.inOutSine(seg(tf, A.in[0], A.in[1]));
    const aOut = 1 - ease.inOutSine(seg(tf, A.out[0], A.out[1]));
    const aAlpha = aIn * aOut;
    const aSize = Math.min(u * (portrait ? 0.05 : 0.046), (G.w * 0.8) / (presenter.length * 0.95));
    const drawA = (c: Ctx2D) => {
      setType(c, 500, aSize, family, { fallback: SERIF, tracking: 0.32 });
      c.fillStyle = theme.ink;
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      c.fillText(presenter, cx - widthOf(c, presenter) / 2, cy + aSize * 0.35);
    };
    if (aAlpha > 0.001) {
      const glow = bake(
        `tc-halo-a:${theme.accent}${family}${presenter}`,
        w,
        h,
        halo(theme, drawA, u * 0.012),
      );
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = aAlpha * 0.55;
      ctx.drawImage(glow as CanvasImageSource, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = aAlpha * flicker;
      drawA(ctx);
      ctx.restore();
    }

    // ── Card B: the title (a small article over the main words), an italic line and the billing block.
    const tb = unwrap(tf);
    const bOut = 1 - ease.inOutSine(seg(tb, B.out[0], B.out[1]));
    const tSize = Math.min(
      u * (portrait ? 0.1 : 0.15),
      (G.w * (portrait ? 0.84 : 0.64)) / (TITLE.length * 0.98),
    );
    setType(ctx, 500, tSize, family, { fallback: SERIF, tracking: 0.26 });
    const titleW = widthOf(ctx, TITLE);
    const xs = glyphXs(ctx, TITLE);
    const tx = cx - titleW / 2;
    const ty = cy + tSize * 0.3;
    const artSize = tSize * 0.3;
    const artY = ty - tSize * 0.98;
    const drawTitle = (c: Ctx2D) => {
      setType(c, 500, tSize, family, { fallback: SERIF, tracking: 0.26 });
      c.fillStyle = theme.ink;
      c.textBaseline = "alphabetic";
      c.fillText(TITLE, tx, ty);
    };
    const titleOn = seg(tb, B.in[0], B.in[1] + 0.2);
    if (titleOn > 0 && bOut > 0.001) {
      const glow = bake(
        `tc-halo-b:${theme.accent}${family}`,
        w,
        h,
        halo(theme, drawTitle, u * 0.014),
      );
      const letterIn = (i: number) => {
        const start = B.in[0] + 0.08 + hash(i, 77) * 0.34;
        return ease.inOutSine(seg(tb, start, start + 0.34));
      };
      // Halation follows each letter as it surfaces.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < TITLE.length; i++) {
        if (TITLE[i] === " ") continue;
        const a = letterIn(i) * bOut * 0.6;
        if (a <= 0.001) continue;
        const x0 = tx + xs[i] - tSize * 0.14;
        const x1 = tx + xs[i + 1] - tSize * 0.12;
        ctx.globalAlpha = a;
        ctx.drawImage(glow as CanvasImageSource, x0, 0, x1 - x0, h, x0, 0, x1 - x0, h);
      }
      ctx.restore();
      // The article first, then the letters surface in a seeded order.
      const art = ease.inOutSine(seg(tb, B.in[0] - 0.1, B.in[0] + 0.35)) * bOut * flicker;
      setType(ctx, 500, artSize, family, { fallback: SERIF, tracking: 0.6 });
      ctx.globalAlpha = clamp(art);
      ctx.fillStyle = rgba(theme.ink, 0.9);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ARTICLE, cx - widthOf(ctx, ARTICLE) / 2, artY);
      setType(ctx, 500, tSize, family, { fallback: SERIF, tracking: 0.26 });
      const chars = [...TITLE];
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] === " ") continue;
        const a = letterIn(i) * bOut * flicker;
        if (a <= 0.001) continue;
        ctx.globalAlpha = clamp(a);
        ctx.fillStyle = theme.ink;
        ctx.fillText(chars[i], tx + xs[i], ty);
      }
      ctx.globalAlpha = 1;
    }
    // Rule and italic line.
    const sub = ease.inOutSine(seg(tb, B.in[1] - 0.1, B.in[1] + 0.35)) * bOut;
    if (sub > 0.001) {
      ctx.globalAlpha = sub * flicker;
      ctx.fillStyle = rgba(theme.ink, 0.5);
      const rw = tSize * 1.4;
      ctx.fillRect(cx - rw / 2, ty + tSize * 0.5, rw, Math.max(1, u * 0.0014));
      const iSize = tSize * 0.34;
      setType(ctx, 500, iSize, family, { fallback: SERIF, tracking: 0.02, italic: italicOk });
      ctx.fillStyle = rgba(theme.ink, 0.82);
      const line = "a film in five seconds";
      ctx.fillText(line, cx - widthOf(ctx, line) / 2, ty + tSize * 1.12);
      ctx.globalAlpha = 1;
    }
    // Billing block.
    const bill = ease.inOutSine(seg(tb, B.in[1] + 0.15, B.in[1] + 0.7)) * bOut;
    if (bill > 0.001) {
      const items = billing(wordFor(theme.name, "Motion Library", 18).toUpperCase());
      const big = Math.max(6, G.h * (portrait ? 0.022 : 0.05));
      const small = big * 0.5;
      const gap = big * 0.28;
      const measure = (it: [string, boolean]) => {
        setType(ctx, 400, it[1] ? big : small, "League Gothic", {
          fallback: GOTHIC,
          tracking: it[1] ? 0.02 : 0.06,
        });
        return widthOf(ctx, it[0].toUpperCase());
      };
      // Break into balanced lines that fit the gate.
      const maxW = G.w * (portrait ? 0.86 : 0.8);
      const lines: [string, boolean][][] = [[]];
      let lw = 0;
      for (const it of items) {
        const iw = measure(it) + gap;
        if (lw + iw > maxW && lines[lines.length - 1].length) {
          lines.push([]);
          lw = 0;
        }
        lines[lines.length - 1].push(it);
        lw += iw;
      }
      const lineH = big * 1.12;
      let by = G.y + G.h * (portrait ? 0.86 : 0.9) - (lines.length - 1) * lineH;
      ctx.globalAlpha = bill * 0.86 * flicker;
      for (const L of lines) {
        const total = L.reduce((s, it) => s + measure(it) + gap, -gap);
        let x = cx - total / 2;
        for (const it of L) {
          const iw = measure(it);
          ctx.fillStyle = it[1] ? theme.ink : rgba(theme.ink, 0.8);
          // Roles sit on the names' cap line, like a real billing block.
          ctx.fillText(it[0].toUpperCase(), x, it[1] ? by : by - big * 0.34);
          x += iw + gap;
        }
        by += lineH;
      }
      ctx.globalAlpha = 1;
    }

    // Dust, hair and a scratch: new every film frame.
    const specks = Math.floor(hash(frame, 11) * 5);
    for (let i = 0; i < specks; i++) {
      const x = G.x + hash(frame, i, 13) * G.w;
      const y = G.y + hash(frame, i, 17) * G.h;
      const r = u * (0.0015 + hash(frame, i, 19) * 0.004);
      ctx.fillStyle = hash(frame, i, 23) < 0.7 ? rgba("#000000", 0.75) : rgba(theme.ink, 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + hash(frame, i, 29)), hash(frame, i, 31) * TAU, 0, TAU);
      ctx.fill();
    }
    if (hash(Math.floor(frame / 3), 37) < 0.35) {
      const hx = G.x + hash(Math.floor(frame / 3), 41) * G.w;
      const hy = G.y + hash(Math.floor(frame / 3), 43) * G.h;
      ctx.strokeStyle = rgba("#000000", 0.6);
      ctx.lineWidth = Math.max(1, u * 0.0012);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.bezierCurveTo(
        hx + u * 0.02,
        hy - u * 0.03,
        hx + u * 0.05,
        hy + u * 0.01,
        hx + u * 0.06,
        hy - u * 0.02,
      );
      ctx.stroke();
    }
    const sx =
      G.x +
      G.w * (0.2 + 0.6 * hash(Math.floor(frame / 12), 47)) +
      (hash(frame, 53) - 0.5) * u * 0.004;
    ctx.fillStyle = rgba(theme.ink, 0.07 + 0.05 * hash(frame, 59));
    ctx.fillRect(sx, G.y, Math.max(1, u * 0.0012), G.h);

    // Cue mark: four frames just before the title fades (the reel's end), top right.
    const cue = frame >= 20 && frame < 24;
    if (cue) {
      const r = u * 0.032;
      const qx = G.x + G.w * 0.9;
      const qy = G.y + G.h * 0.14;
      const g = ctx.createRadialGradient(qx, qy, r * 0.2, qx, qy, r);
      g.addColorStop(0, rgba(mix(theme.ink, theme.accent, 0.3), 0.95));
      g.addColorStop(0.8, rgba(mix(theme.ink, theme.accent, 0.5), 0.75));
      g.addColorStop(1, rgba(theme.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(qx, qy, r, 0, TAU);
      ctx.fill();
    }

    // Flicker darkens the whole frame a touch on some frames.
    if (flicker < 1) {
      ctx.fillStyle = rgba("#000000", (1 - flicker) * 1.6);
      ctx.fillRect(G.x, G.y, G.w, G.h);
    }
    ctx.restore();

    // A dropped logo sits small in the lower bar like a distributor's mark.
    const mark = tintedLogo(theme, rgba(theme.ink, 0.5), u * 0.06, u * 0.035);
    if (mark && G.y > u * 0.06)
      ctx.drawImage(mark as CanvasImageSource, w / 2 - u * 0.03, G.y + G.h + (G.y - u * 0.035) / 2);

    vignette(ctx, w, h, "#000000", 0.6);
    grain(ctx, w, h, tf, 0.5);
  },
};
