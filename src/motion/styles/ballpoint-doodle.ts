import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  noise3,
  once,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  chaikin,
  handLine,
  headOf,
  lengths,
  mottle,
  speckleTile,
  textOutline,
  tileFill,
  tracePts,
  type Pt,
} from "./_s2-helpers";

/**
 * Ballpoint doodles on a dark spiral notepad. The loop opens on the finished
 * page, which flips up over the spiral; the fresh page underneath carries the
 * pressure indents of the last one, and the pen draws it all again.
 */
const FLIP = [0.08, 0.62];
const WORD_T = [0.62, 2.3];
const HATCH_T = [2.25, 3.35];
const LETTER = '"Fredoka", "Arial Rounded MT Bold", sans-serif';

type Pen = { pts: Pt[]; t0: number; t1: number; width: number; col: 0 | 1 | 2; retrace?: number };

/** Layout of the page: word box and doodle anchors. */
function layout(w: number, h: number) {
  const { u, portrait, square } = frameOf(w, h);
  const marginX = w * (portrait ? 0.16 : 0.13);
  const rule = u * (portrait ? 0.062 : 0.058);
  const top = h * (portrait ? 0.1 : 0.12);
  const wordCx = portrait ? w * 0.56 : square ? w * 0.56 : w * 0.54;
  const wordCy = portrait ? h * 0.44 : h * 0.47;
  const wordMaxW = w * (portrait ? 0.72 : square ? 0.7 : 0.6);
  const wordMaxH = h * (portrait ? 0.14 : square ? 0.2 : 0.3);
  return { u, marginX, rule, top, wordCx, wordCy, wordMaxW, wordMaxH, portrait, square };
}

/** The word traced as bubble-letter outlines, sized to its box (cached per font state). */
function wordOutline(word: string, maxW: number, maxH: number) {
  const ready =
    typeof document === "undefined" ||
    !document.fonts ||
    document.fonts.check(`700 64px ${LETTER}`);
  return once(`bp-word:${word}:${Math.round(maxW)}x${Math.round(maxH)}:${ready}`, () => {
    const base = 160;
    const o = textOutline(word, font(700, base, "Fredoka", LETTER), base, 1.4);
    const k = Math.min(maxW / (o.width || 1), maxH / (o.ascent + o.descent || 1));
    return {
      loops: o.loops.map((l) => chaikin(l, 1, true).map(([x, y]) => [x * k, y * k] as Pt)),
      width: o.width * k,
      size: base * k,
      ascent: o.ascent * k,
    };
  });
}

function spiralPts(cx: number, cy: number, r: number, turns: number): Pt[] {
  const out: Pt[] = [];
  const n = Math.round(turns * 40);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const a = k * turns * TAU;
    const rr = r * (0.08 + 0.92 * k) * (1 + 0.04 * Math.sin(a * 3));
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}

function starPts(cx: number, cy: number, r: number, rot: number, jit: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 5; i++) {
    const a = rot + (i * 2 * TAU) / 5;
    out.push([
      cx + Math.cos(a) * r * (1 + jit * Math.sin(i * 2.3)),
      cy + Math.sin(a) * r * (1 + jit * Math.cos(i * 1.7)),
    ]);
  }
  const dense: Pt[] = [];
  for (let i = 0; i < out.length - 1; i++)
    dense.push(
      ...handLine(out[i], out[i + 1], i * 7 + jit * 100, r * 0.02, 8, 0.01).slice(i ? 1 : 0),
    );
  return dense;
}

function cubePts(x: number, y: number, s: number): Pt[][] {
  const d: Pt = [s * 0.45, -s * 0.35];
  const A: Pt[] = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
    [x, y],
  ];
  const B = A.map(([px, py]) => [px + d[0], py + d[1]] as Pt);
  return [A, B, [A[0], B[0]], [A[1], B[1]], [A[2], B[2]], [A[3], B[3]]].map((path, i) => {
    const out: Pt[] = [];
    for (let j = 0; j < path.length - 1; j++)
      out.push(...handLine(path[j], path[j + 1], i * 13 + j, s * 0.02, 6, 0.01).slice(j ? 1 : 0));
    return out;
  });
}

/** Cursive loop chain along a ruled line: the classic margin loop-de-loop. */
function loopChain(x0: number, y0: number, width: number, h: number): Pt[] {
  const out: Pt[] = [];
  const loops = Math.max(4, Math.round(width / (h * 0.9)));
  const n = loops * 24;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * loops * TAU;
    const x = x0 + (s / TAU) * (width / loops) - Math.sin(s) * h * 0.42;
    const y = y0 - (1 - Math.cos(s)) * h * 0.5;
    out.push([x, y]);
  }
  return out;
}

/** Every pen path on the page, with when it is drawn (cached per size, word and font state). */
function pens(w: number, h: number, word: string): Pen[] {
  const ready =
    typeof document === "undefined" ||
    !document.fonts ||
    document.fonts.check(`700 64px ${LETTER}`);
  return once(`bp-pens:${Math.round(w)}x${Math.round(h)}:${word}:${ready}`, () =>
    buildPens(w, h, word),
  );
}

function buildPens(w: number, h: number, word: string): Pen[] {
  const L = layout(w, h);
  const { u } = L;
  const O = wordOutline(word, L.wordMaxW, L.wordMaxH);
  const ox = L.wordCx - O.width / 2;
  const oy = L.wordCy + O.ascent / 2;
  const out: Pen[] = [];
  const wordLoops = O.loops.map((l) => l.map(([x, y]) => [ox + x, oy + y] as Pt));
  const total = wordLoops.reduce((s, l) => s + lengths(l)[l.length - 1], 0) || 1;
  let acc = 0;
  for (const l of wordLoops) {
    const len = lengths(l)[l.length - 1];
    const t0 = WORD_T[0] + ((WORD_T[1] - WORD_T[0]) * acc) / total;
    acc += len;
    const t1 = WORD_T[0] + ((WORD_T[1] - WORD_T[0]) * acc) / total;
    out.push({ pts: l, t0, t1, width: u * 0.0048, col: 0 });
  }
  const mx = L.marginX;
  if (L.portrait) {
    out.push({
      pts: spiralPts(mx * 0.5, h * 0.24, u * 0.06, 3.2),
      t0: 1.2,
      t1: 1.9,
      width: u * 0.0042,
      col: 0,
    });
    out.push({
      pts: starPts(w * 0.8, h * 0.2, u * 0.07, -1.57, 0.05),
      t0: 1.8,
      t1: 2.2,
      width: u * 0.0042,
      col: 0,
      retrace: 2,
    });
    cubePts(w * 0.2, h * 0.7, u * 0.1).forEach((p, i) =>
      out.push({ pts: p, t0: 2.2 + i * 0.06, t1: 2.3 + i * 0.06, width: u * 0.0042, col: 0 }),
    );
  } else {
    out.push({
      pts: spiralPts(mx * 0.5, h * 0.3, u * 0.055, 3.2),
      t0: 1.2,
      t1: 1.9,
      width: u * 0.0042,
      col: 0,
    });
    out.push({
      pts: starPts(mx * 0.5, h * 0.62, u * 0.055, -1.57, 0.05),
      t0: 1.85,
      t1: 2.25,
      width: u * 0.0042,
      col: 0,
      retrace: 2,
    });
    cubePts(w * (L.square ? 0.74 : 0.8), h * 0.17, u * 0.085).forEach((p, i) =>
      out.push({ pts: p, t0: 2.2 + i * 0.06, t1: 2.3 + i * 0.06, width: u * 0.0042, col: 0 }),
    );
  }
  // The underline loop chain, in red pen, under the word.
  const chainY = oy + O.size * 0.34;
  out.push({
    pts: loopChain(L.wordCx - O.width * 0.46, chainY, O.width * 0.92, u * 0.05),
    t0: 2.4,
    t1: 3.35,
    width: u * 0.0042,
    col: 2,
  });
  // An arrow curling in toward the word.
  const ax0: Pt = L.portrait ? [w * 0.78, h * 0.72] : [w * 0.88, h * 0.78];
  const ax1: Pt = [L.wordCx + O.width * 0.5 + u * 0.01, L.wordCy + O.ascent * 0.35];
  const arrow: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const k = i / 24;
    arrow.push([
      ax0[0] + (ax1[0] - ax0[0]) * k + Math.sin(k * Math.PI) * u * 0.04,
      ax0[1] + (ax1[1] - ax0[1]) * k + Math.sin(k * Math.PI) * u * 0.05,
    ]);
  }
  out.push({ pts: arrow, t0: 2.75, t1: 3.05, width: u * 0.0042, col: 0 });
  const e = arrow[arrow.length - 1];
  const pr = arrow[arrow.length - 3];
  const ang = Math.atan2(e[1] - pr[1], e[0] - pr[0]);
  const hl = u * 0.028;
  out.push({
    pts: [
      [e[0] + Math.cos(ang + 2.5) * hl, e[1] + Math.sin(ang + 2.5) * hl],
      e,
      [e[0] + Math.cos(ang - 2.5) * hl, e[1] + Math.sin(ang - 2.5) * hl],
    ],
    t0: 3.05,
    t1: 3.15,
    width: u * 0.0042,
    col: 0,
  });
  return out;
}

/** A ballpoint line: thin, a hair of pressure variation, blobs where the pen lands. */
function penLine(c: Ctx2D, pts: Pt[], width: number, color: string, seed: number) {
  if (pts.length < 2) return;
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = "round";
  c.lineJoin = "round";
  // Draw in short runs whose alpha wavers: the ball skips and floods a little.
  const run = 6;
  for (let i = 0; i < pts.length - 1; i += run) {
    const seg2 = pts.slice(i, Math.min(pts.length, i + run + 1));
    c.globalAlpha = 0.72 + 0.28 * (0.5 + 0.5 * noise3(i * 0.21, seed, 0.3));
    c.beginPath();
    tracePts(c, seg2);
    c.stroke();
  }
  c.globalAlpha = 0.9;
  c.fillStyle = color;
  const [x, y] = pts[0];
  c.beginPath();
  c.arc(x, y, width * 0.95, 0, TAU);
  c.fill();
  c.globalAlpha = 1;
}

function paperSheet(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const L = layout(w, h);
    const { u } = L;
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.008, 0.012, u * 0.3, u / 120, 4.4);
    // Ruled lines and a doubled margin.
    c.strokeStyle = rgba(theme.accent2, 0.16);
    c.lineWidth = Math.max(1, u * 0.0016);
    for (let y = L.top + L.rule; y < h; y += L.rule) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.strokeStyle = rgba(theme.accent, 0.26);
    for (const dx of [0, u * 0.008]) {
      c.beginPath();
      c.moveTo(L.marginX + dx, 0);
      c.lineTo(L.marginX + dx, h);
      c.stroke();
    }
    // Punched holes for the spiral.
    const gap = u * 0.07;
    for (let x = gap * 0.8; x < w; x += gap) {
      c.fillStyle = mix(theme.bg, "#000000", 0.7);
      c.beginPath();
      c.ellipse(x, h * 0.04, u * 0.011, u * 0.009, 0, 0, TAU);
      c.fill();
    }
  };
}

/** The spiral wire over the top edge. */
function spiral(c: Ctx2D, w: number, h: number, u: number, theme: Theme) {
  const gap = u * 0.07;
  c.save();
  c.lineCap = "round";
  for (let x = gap * 0.8; x < w; x += gap) {
    c.strokeStyle = mix(theme.ink, theme.bg, 0.45);
    c.lineWidth = u * 0.006;
    c.beginPath();
    c.ellipse(x + u * 0.004, h * 0.02, u * 0.012, h * 0.028, 0.15, Math.PI * 0.6, Math.PI * 2.35);
    c.stroke();
    c.strokeStyle = rgba(theme.ink, 0.5);
    c.lineWidth = u * 0.002;
    c.beginPath();
    c.ellipse(x + u * 0.002, h * 0.018, u * 0.011, h * 0.026, 0.15, Math.PI * 1.1, Math.PI * 1.7);
    c.stroke();
  }
  c.restore();
}

export const style: MotionStyle = {
  id: "ballpoint-doodle",
  name: "Ballpoint Doodle",
  family: "Paint & Draw",
  tagline: "Ballpoint doodles in the margin",
  look: "Margin doodles in ballpoint on a dark spiral notepad: bubble letters, shadow hatching, a spiral, a retraced star, a loop-de-loop.",
  move: "The finished page flips up over the spiral; on the fresh page, still dented by the last one, the pen traces every letter and doodle again.",
  rules: [
    "One thin ballpoint line, drawn along its path, never faded in.",
    "The ink wavers a little and blobs where the pen lands.",
    "Bubble letters are traced as outlines, then shadow-hatched.",
    "Doodles live in the margin: spiral, retraced star, a cube, an arrow.",
    "One red-pen moment: the loop chain under the word.",
    "The fresh page carries the pressure dents of the last drawing.",
    "The loop opens on the finished page, so start and end match.",
  ],
  prompt: `R — References
• School-notebook margin doodles in ballpoint (search: bubble letter doodle, notebook margin doodles, loop de loop doodle).
• Real ballpoint marks: blobs where the pen lands, retraced lines, pressure dents on the page below.

I — Idea
One page, 5 seconds, looping seamlessly:
• Beginning (0–0.6 s): the finished page flips up over the spiral binding and reveals a fresh page, faintly dented by the drawing that was on top.
• Middle (0.6–3.4 s): the pen traces "{{name}}" as bubble letters, hatches their shadow, then fills the margin: a spiral, a star traced twice, a cube, an arrow curling in, a red loop-de-loop underline.
• End (3.4–5 s): the finished page holds, exactly the page that flips at the start.

S — Style
Looks: {{bg}} notepad with {{accent2}} rules, an {{accent}} margin, a spiral wire; ballpoint lines in a pale {{accent2}}, shadow hatching in {{accent2}}, one {{accent}} loop chain; rounded bubble letters traced from Fredoka.
Moves: every line is drawn along its path at pen speed; letters in reading order; hatching line by line; the flip eases in and out over half a second with a soft shadow.
Rules:
1. Draw along the path; never fade a line in.
2. Blobs at pen landings; a little skip and flood in the ink.
3. Outline first, shadow hatching second.
4. Doodles in the margin, never over the word.
5. One red-pen element.
6. Pressure dents of the last page on the fresh one.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word reads at thumbnail size; letters are traced in order; doodles stay in the margins; the page flip never shows a gap at the frame edge. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Doodle",
  theme: {
    bg: "#11141b",
    ink: "#e6ebf5",
    accent: "#ff5a6e",
    accent2: "#5b86ff",
    font: "Fredoka",
  },
  fonts: ["Fredoka:wght@600..700"],
  tags: [
    "ballpoint",
    "pen",
    "doodle",
    "notebook",
    "sketch",
    "bubble letters",
    "school",
    "hand-drawn",
    "handdrawn",
    "margin",
    "lined paper",
  ],
  word: "Doodle",
  render(ctx, t, theme, w, h) {
    const L = layout(w, h);
    const { u } = L;
    const word = wordFor(theme.name, "Doodle", 10);
    const pen = mix(theme.accent2, theme.ink, 0.62);
    const cols = [pen, theme.accent2, mix(theme.accent, theme.ink, 0.15)];
    const all = pens(w, h, word);
    const O = wordOutline(word, L.wordMaxW, L.wordMaxH);
    const ox = L.wordCx - O.width / 2;
    const oy = L.wordCy + O.ascent / 2;
    const key = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`;
    const sheet = bake(`bp-sheet:${key}`, w, h, paperSheet(theme));

    /** The drawing up to time tt, on a transparent layer. */
    const drawInk = (c: Ctx2D, tt: number) => {
      // Shadow hatching inside each letter's offset, outside the letter itself.
      const hp = clamp((tt - HATCH_T[0]) / (HATCH_T[1] - HATCH_T[0]));
      if (hp > 0) {
        const { canvas: hc, ctx: H } = buffer("bp-hatch", w, h);
        H.save();
        H.clearRect(0, 0, w, h);
        H.strokeStyle = theme.accent2;
        H.lineWidth = u * 0.0034;
        H.lineCap = "round";
        const gap = u * 0.0075;
        const x0 = ox - O.size * 0.2;
        const x1 = ox + O.width + O.size * 0.4;
        const n = Math.ceil((x1 - x0 + O.size) / gap);
        const shown = Math.floor(n * hp);
        for (let i = 0; i < shown; i++) {
          const x = x0 + i * gap;
          H.globalAlpha = 0.75 + 0.25 * hash(i, 5);
          H.beginPath();
          H.moveTo(x, oy + O.size * 0.25);
          H.lineTo(x + O.size * 0.9, oy - O.size * 0.95);
          H.stroke();
        }
        H.globalAlpha = 1;
        const d = O.size * 0.07;
        H.font = font(700, O.size, "Fredoka", LETTER);
        H.textBaseline = "alphabetic";
        H.globalCompositeOperation = "destination-in";
        H.fillText(word, ox + d, oy + d);
        H.globalCompositeOperation = "destination-out";
        H.fillText(word, ox, oy);
        H.restore();
        c.drawImage(hc as CanvasImageSource, 0, 0);
      }
      for (const p of all) {
        const k = clamp((tt - p.t0) / (p.t1 - p.t0));
        if (k <= 0) continue;
        const passes = p.retrace ?? 1;
        for (let r = 0; r < passes; r++) {
          const kr = clamp(k * passes - r);
          if (kr <= 0) continue;
          const pts = r
            ? p.pts.map(
                ([x, y], i) =>
                  [
                    x + u * 0.004 * Math.sin(i * 0.3 + r),
                    y + u * 0.003 * Math.cos(i * 0.2 + r),
                  ] as Pt,
              )
            : p.pts;
          penLine(c, headOf(pts, kr), p.width, cols[p.col], p.t0 * 100 + r);
        }
      }
    };

    // The finished drawing, baked once: it is the page that flips and the dents below.
    const finalKey = `bp-final:${key}:${word}`;
    const finalInk = bake(finalKey, w, h, (c) => {
      drawInk(c, 99);
      tileFill(
        c,
        speckleTile(2323, 256, 1400, 0.2, 0.6, 0.5, 1.2),
        w,
        h,
        Math.max(0.5, u / 800),
        0.25,
        "destination-out",
      );
    });
    const dents = bake(`bp-dents:${finalKey}`, w, h, (c) => {
      c.globalAlpha = 0.07;
      c.drawImage(finalInk as CanvasImageSource, -u * 0.0012, -u * 0.0012);
      c.globalCompositeOperation = "source-in";
      c.fillStyle = theme.ink;
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 0.5;
      c.filter = "brightness(0)";
      c.drawImage(finalInk as CanvasImageSource, u * 0.0012, u * 0.0012);
    });
    // Every page is a fresh sheet carrying the last page's dents.
    const page = bake(`bp-pagebase:${finalKey}`, w, h, (c) => {
      c.drawImage(sheet as CanvasImageSource, 0, 0);
      c.globalAlpha = 0.5;
      c.drawImage(dents as CanvasImageSource, 0, 0);
    });

    ground(ctx, w, h, theme.bg);
    ctx.drawImage(page as CanvasImageSource, 0, 0);

    const flip = ease.inOutCubic(seg(t, FLIP[0], FLIP[1]));
    const drawingTime = t < FLIP[1] ? 0 : t;
    if (drawingTime > 0) {
      const { canvas: ic, ctx: I } = buffer("bp-ink", w, h);
      I.clearRect(0, 0, w, h);
      if (t >= HATCH_T[1] + 0.2) I.drawImage(finalInk as CanvasImageSource, 0, 0);
      else {
        drawInk(I, drawingTime);
        tileFill(
          I,
          speckleTile(2323, 256, 1400, 0.2, 0.6, 0.5, 1.2),
          w,
          h,
          Math.max(0.5, u / 800),
          0.25,
          "destination-out",
        );
      }
      ctx.drawImage(ic as CanvasImageSource, 0, 0);
      // The ball of the pen, glinting where it draws.
      for (const p of all) {
        if (t > p.t0 && t < p.t1) {
          const pts = headOf(p.pts, clamp((t - p.t0) / (p.t1 - p.t0)));
          const [x, y] = pts[pts.length - 1];
          ctx.fillStyle = rgba(theme.ink, 0.9);
          ctx.beginPath();
          ctx.arc(x, y, u * 0.0045, 0, TAU);
          ctx.fill();
          break;
        }
      }
    }

    // The previous page: complete, flipping up over the spiral.
    if (flip < 1) {
      const { canvas: pc, ctx: P } = buffer("bp-page", w, h);
      P.save();
      P.clearRect(0, 0, w, h);
      P.drawImage(page as CanvasImageSource, 0, 0);
      P.drawImage(finalInk as CanvasImageSource, 0, 0);
      P.restore();
      const hinge = h * 0.04;
      const sy = Math.cos((flip * Math.PI) / 2);
      if (sy > 0.002) {
        // Shadow cast on the fresh page just below the lifting edge.
        const edge = hinge + (h - hinge) * sy;
        const sh = ctx.createLinearGradient(0, edge, 0, edge + u * 0.12 * (1 - sy) + u * 0.02);
        sh.addColorStop(0, rgba("#000000", 0.55 * Math.sin(flip * Math.PI)));
        sh.addColorStop(1, rgba("#000000", 0));
        ctx.fillStyle = sh;
        ctx.fillRect(0, edge, w, u * 0.14);
        ctx.save();
        ctx.translate(w / 2, hinge);
        ctx.scale(1 + 0.04 * Math.sin(flip * Math.PI), sy);
        ctx.drawImage(pc as CanvasImageSource, 0, hinge, w, h - hinge, -w / 2, 0, w, h - hinge);
        // The page darkens as it turns away from the light.
        ctx.fillStyle = rgba("#000000", 0.45 * flip);
        ctx.fillRect(-w / 2, 0, w, h - hinge);
        ctx.restore();
      }
    }
    light(ctx, w * 0.35, h * 0.25, Math.max(w, h) * 0.8, theme.ink, 0.06);
    spiral(ctx, w, h, u, theme);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
