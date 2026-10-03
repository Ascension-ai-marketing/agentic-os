import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  fbm3,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  once,
  rng,
  SANS,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  balanceLines,
  darkStock,
  faceReady,
  loopT,
  preloadFaces,
  setType,
  typeEpoch,
  widthOf,
  type Box,
} from "./_s8-helpers";

const SERIF = '"Newsreader", Georgia, serif';
const ITALIC = 'italic 400 48px "Newsreader"';
preloadFaces("Newsreader:ital,opsz,wght@1,6..72,400..600", [
  ITALIC,
  'italic 500 48px "Newsreader"',
]);

const HEAD = "The quiet craft of moving type";
const DECK =
  "Every frame is a function of time. How the best motion work makes type feel inevitable.";
const QUOTE = "Hold a word long enough to read it.";
const BODY = [
  "Good motion is mostly patience. A line of type waits, then moves once, and lands exactly where the eye already was. The frame never asks for attention it has not earned, and the best of it is hardly noticed at all.",
  "We drew every frame of this issue from one function of time. Nothing was keyed by hand and nothing moved without a reason: a weight shifts because a word matters, a column slides because the page needs air.",
  "The rules are old ones. Hold a word long enough to read it. Let one thing move at a time. Ease in, ease out, and leave the rest of the page alone. What has changed is how quickly a designer can test them, frame by frame, until the page feels settled.",
  "Type in motion is still type. It needs a measure, a rhythm and a place to rest, and it rewards the same care a good compositor gave a page of lead.",
  "Most of the work is subtraction. A designer removes the bounce that does not help, the fade that hides a cut, the second accent that splits the eye. What is left is a move you could describe in one sentence, and a frame that holds still long enough to be read.",
  "None of this needs a timeline. A single function that takes a moment and returns a picture is enough, provided every line inside it earns its place. The rest is taste, and taste is still the part that takes years to learn and seconds to spot.",
  "So the pages that follow are quiet on purpose. Each one moves once, lands, and waits for you.",
];

type Reveal = "fade" | "rise" | "line";
interface Block extends Box {
  t0: number;
  kind: Reveal;
  /** Drawn from its own small layer (headline lines, the drop cap) so masks never overlap. */
  own?: (c: Ctx2D) => void;
}
interface Page extends Box {
  side: "left" | "right" | "single";
}
interface Layout {
  pages: Page[];
  image: Box;
  blocks: Block[];
  guides: { cols: Box[]; margin: Box; baseline: number }[];
  /** Draws every word of the spread; baked once, revealed block by block. */
  text: (c: Ctx2D) => void;
}

/** Justified column text with a drop cap; returns the drawn line boxes. */
function setColumns(
  c: Ctx2D,
  paint: boolean,
  theme: Theme,
  cols: Box[],
  size: number,
  lead: number,
  quote: { col: number; after: number; h: number } | null,
  draw: (b: Box, i: number) => void,
  cap = true,
) {
  const measure = (text: string) => widthOf(c, text);
  setType(c, 400, size, "Newsreader", { fallback: SERIF });
  const space = c.measureText(" ").width;
  // Drop cap geometry.
  const capLines = 3;
  const capSize = lead * (capLines - 1) + size * 0.7;
  setType(c, 500, capSize * 1.44, "Newsreader", { fallback: SERIF });
  const capW = c.measureText(BODY[0][0]).width + size * 0.5;
  setType(c, 400, size, "Newsreader", { fallback: SERIF });
  // Slots: every line position in every column, skipping the pull quote.
  const slots: Box[] = [];
  cols.forEach((col, ci) => {
    const n = Math.floor(col.h / lead);
    for (let k = 0; k < n; k++) {
      const y = col.y + k * lead;
      if (quote && ci === quote.col && k >= quote.after && y < col.y + quote.after * lead + quote.h)
        continue;
      slots.push({ x: col.x, y, w: col.w, h: lead });
    }
  });
  let si = 0;
  let lineNo = 0;
  for (let p = 0; p < BODY.length && si < slots.length; p++) {
    const words = (p === 0 ? BODY[p].slice(1) : BODY[p]).split(" ");
    let wi = 0;
    let firstInPara = true;
    while (wi < words.length && si < slots.length) {
      const slot = slots[si];
      const indent = p === 0 && lineNo < capLines ? capW : p > 0 && firstInPara ? size * 1.4 : 0;
      const maxW = slot.w - indent;
      const line: string[] = [];
      let lw = 0;
      while (wi < words.length) {
        const ww = measure(words[wi]);
        const next = line.length ? lw + space + ww : ww;
        if (line.length && next > maxW) break;
        line.push(words[wi]);
        lw = next;
        wi++;
      }
      // Never leave one word alone on the last line of a paragraph.
      const remaining = words.length - wi;
      if (remaining === 1 && line.length > 2) {
        wi--;
        line.pop();
      }
      const last = wi >= words.length;
      if (paint) {
        setType(c, 400, size, "Newsreader", { fallback: SERIF });
        c.fillStyle = rgba(theme.ink, 0.86);
        const base = slot.y + lead * 0.72;
        if (last || line.length === 1) {
          const text = line.join(" ");
          c.fillText(text, slot.x + indent, base);
          // End sign after the article's last word.
          if (last && p === BODY.length - 1) {
            const q = size * 0.46;
            c.fillStyle = theme.accent;
            c.fillRect(slot.x + indent + measure(text) + space * 0.9, base - q, q, q);
          }
        } else {
          const widths = line.map(measure);
          const gap = (maxW - widths.reduce((a, b) => a + b, 0)) / (line.length - 1);
          let x = slot.x + indent;
          line.forEach((word, k) => {
            c.fillText(word, x, base);
            x += widths[k] + gap;
          });
        }
      }
      draw({ x: slot.x, y: slot.y, w: slot.w, h: lead }, lineNo);
      si++;
      lineNo++;
      firstInPara = false;
    }
  }
  if (paint && cap && cols.length) {
    // Drop cap in the accent.
    setType(c, 500, capSize * 1.44, "Newsreader", { fallback: SERIF });
    c.fillStyle = theme.accent;
    c.fillText(
      BODY[0][0],
      cols[0].x - size * 0.06,
      cols[0].y + lead * (capLines - 1) + lead * 0.72,
    );
  }
  return { capW };
}

function layout(w: number, h: number, theme: Theme, word: string, italicOk: boolean): Layout {
  const { portrait, square } = frameOf(w, h);
  const pages: Page[] = [];
  if (portrait) {
    const pw = w * 0.86;
    const ph = Math.min(h * 0.86, pw / 0.64);
    pages.push({ x: (w - pw) / 2, y: (h - ph) / 2, w: pw, h: ph, side: "single" });
  } else {
    const ph = h * (square ? 0.84 : 0.86);
    const pw = ph * (square ? 0.78 : 0.8);
    const spreadW = pw * 2;
    // Square frames show the text page whole and the picture page running off the left edge.
    const x0 = square ? w - pw - w * 0.08 - pw : (w - spreadW) / 2;
    const y0 = (h - ph) / 2;
    pages.push({ x: x0, y: y0, w: pw, h: ph, side: "left" });
    pages.push({ x: x0 + pw, y: y0, w: pw, h: ph, side: "right" });
  }
  const tp = pages[pages.length - 1];
  const P = tp.w;
  const inner = tp.side === "right" ? P * 0.09 : P * 0.075;
  const outer = P * 0.075;
  const m: Box = { x: tp.x + inner, y: tp.y + tp.h * 0.075, w: P - inner - outer, h: tp.h * 0.85 };
  const blocks: Block[] = [];
  const guides: Layout["guides"] = [];
  const single = tp.side === "single";
  const image: Box = single
    ? { x: tp.x, y: tp.y, w: tp.w, h: tp.h * 0.36 }
    : { x: pages[0].x, y: pages[0].y, w: pages[0].w, h: pages[0].h };

  const k = P / 700;
  const runSize = Math.max(5, 11.5 * k);
  const kickSize = Math.max(5, 13 * k);
  const headSize = (single ? 64 : 58) * k;
  const deckSize = (single ? 21 : 19.5) * k;
  const bySize = Math.max(5, 10.5 * k);
  const bodySize = Math.max(4, (single ? 13.5 : 12.6) * k);
  const lead = bodySize * 1.42;

  // Vertical rhythm on the text page.
  let y = single ? image.y + image.h + tp.h * 0.045 : m.y;
  const runY = m.y;
  const colGap = P * 0.04;
  const colW = (m.w - colGap) / 2;
  const cols: Box[] = [];

  // Pre-measure with an offscreen context for layout decisions.
  const probe = once(`mag-probe`, () => {
    const cv =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(8, 8)
        : document.createElement("canvas");
    return cv.getContext("2d") as Ctx2D;
  });
  setType(probe, 500, headSize, theme.font, { fallback: SERIF, tracking: -0.01 });
  const headLines = balanceLines(probe, HEAD, m.w * 0.98);
  setType(probe, 400, deckSize, "Newsreader", { fallback: SERIF, italic: italicOk });
  const deckLines = balanceLines(probe, DECK, m.w * 0.92);

  if (!single) y = runY + runSize * 4.2;
  const kickY = y + kickSize;
  y = kickY + headSize * 0.5;
  const headY: number[] = [];
  for (let i = 0; i < headLines.length; i++) {
    y += headSize * 1.12;
    headY.push(y);
  }
  y += headSize * 0.4 + deckSize * 1.25;
  const deckY: number[] = [];
  for (let i = 0; i < deckLines.length; i++) {
    deckY.push(y);
    y += deckSize * 1.36;
  }
  const byY = y + bySize * 0.6;
  y = byY + bySize * 2.2;
  const colTop = y;
  const colBottom = tp.y + tp.h - tp.h * 0.085;
  cols.push({ x: m.x, y: colTop, w: colW, h: colBottom - colTop });
  cols.push({ x: m.x + colW + colGap, y: colTop, w: colW, h: colBottom - colTop });
  const quoteSize = (single ? 20 : 19) * k;
  setType(probe, 500, quoteSize, "Newsreader", { fallback: SERIF, italic: italicOk });
  const quoteLines = balanceLines(probe, QUOTE, colW * 0.96);
  const quoteH = quoteLines.length * quoteSize * 1.3 + lead * 2.2;
  const quote = { col: 1, after: Math.max(2, Math.round((cols[1].h / lead) * 0.34)), h: quoteH };
  guides.push({ cols, margin: m, baseline: lead });

  // Blocks and their entrance times.
  blocks.push({
    x: m.x,
    y: runY - runSize * 1.4,
    w: m.w,
    h: runSize * 2.4,
    t0: 0.62,
    kind: "fade",
  });
  blocks.push({
    x: m.x,
    y: kickY - kickSize * 1.2,
    w: m.w,
    h: kickSize * 1.7,
    t0: 0.72,
    kind: "fade",
  });
  headY.forEach((hy, i) =>
    blocks.push({
      x: m.x - headSize * 0.1,
      y: hy - headSize * 1.02,
      w: m.w + headSize * 0.2,
      h: headSize * 1.4,
      t0: 0.8 + i * 0.1,
      kind: "rise",
      own: (c) => {
        setType(c, 500, headSize, theme.font, { fallback: SERIF, tracking: -0.01 });
        c.fillStyle = theme.ink;
        c.textBaseline = "alphabetic";
        c.fillText(headLines[i], m.x, hy);
      },
    }),
  );
  deckY.forEach((dy, i) =>
    blocks.push({
      x: m.x,
      y: dy - deckSize * 1.0,
      w: m.w,
      h: deckSize * 1.34,
      t0: 1.08 + i * 0.05,
      kind: "fade",
    }),
  );
  blocks.push({ x: m.x, y: byY - bySize * 1.2, w: m.w, h: bySize * 1.8, t0: 1.2, kind: "fade" });
  const lineBoxes: Box[] = [];
  setColumns(probe, false, theme, cols, bodySize, lead, quote, (b) => lineBoxes.push(b));
  const stagger = Math.min(0.024, 0.8 / Math.max(1, lineBoxes.length));
  lineBoxes.forEach((b, i) =>
    blocks.push({
      x: b.x - bodySize * 0.2,
      y: b.y,
      w: b.w + bodySize * 0.4,
      h: lead,
      t0: 1.22 + i * stagger,
      kind: "line",
    }),
  );
  // Drop cap and pull quote.
  blocks.push({
    x: cols[0].x - bodySize,
    y: cols[0].y - lead * 0.6,
    w: bodySize * 4.2,
    h: lead * 3.4,
    t0: 1.18,
    kind: "fade",
    own: (c) => {
      const capSize = lead * 2 + bodySize * 0.7;
      setType(c, 500, capSize * 1.44, "Newsreader", { fallback: SERIF });
      c.fillStyle = theme.accent;
      c.textBaseline = "alphabetic";
      c.fillText(BODY[0][0], cols[0].x - bodySize * 0.06, cols[0].y + lead * 2 + lead * 0.72);
    },
  });
  const qy = cols[1].y + quote.after * lead;
  blocks.push({ x: cols[1].x - 2, y: qy, w: cols[1].w + 4, h: quote.h, t0: 1.75, kind: "fade" });
  // Folios.
  const folioY = tp.y + tp.h - tp.h * 0.035;
  blocks.push({
    x: tp.x,
    y: folioY - runSize * 1.4,
    w: tp.w,
    h: runSize * 2.2,
    t0: 1.95,
    kind: "fade",
  });

  const text = (c: Ctx2D) => {
    c.textBaseline = "alphabetic";
    // Running head and folio.
    setType(c, 600, runSize, "Inter", { fallback: SANS, tracking: 0.14 });
    c.fillStyle = rgba(theme.ink, 0.62);
    c.fillText(`${word.toUpperCase()} — THE TYPE ISSUE`, m.x, runY);
    c.textAlign = "right";
    c.fillText("NO. 07", m.x + m.w, runY);
    c.textAlign = "left";
    c.fillStyle = rgba(theme.ink, 0.22);
    c.fillRect(m.x, runY + runSize * 0.9, m.w, Math.max(1, P * 0.0014));
    // Kicker.
    setType(c, 700, kickSize, "Inter", { fallback: SANS, tracking: 0.18 });
    c.fillStyle = theme.accent;
    c.fillText("ESSAY", m.x, kickY);
    // Standfirst.
    setType(c, 400, deckSize, "Newsreader", { fallback: SERIF, italic: italicOk });
    c.fillStyle = rgba(theme.ink, 0.78);
    deckLines.forEach((l, i) => c.fillText(l, m.x, deckY[i]));
    // Byline.
    setType(c, 600, bySize, "Inter", { fallback: SANS, tracking: 0.12 });
    c.fillStyle = rgba(theme.ink, 0.5);
    c.fillText("WORDS BY THE STUDIO  ·  PICTURES DRAWN IN CODE", m.x, byY);
    // Body, drop cap, pull quote.
    setColumns(c, true, theme, cols, bodySize, lead, quote, () => undefined, false);
    const qTop = qy + lead * 0.85;
    c.fillStyle = theme.accent;
    c.fillRect(cols[1].x, qTop, cols[1].w * 0.28, Math.max(1, P * 0.0022));
    setType(c, 500, quoteSize, "Newsreader", { fallback: SERIF, italic: italicOk });
    c.fillStyle = theme.accent;
    quoteLines.forEach((l, i) => c.fillText(l, cols[1].x, qTop + quoteSize * (1.25 + i * 1.3)));
    // Folios.
    setType(c, 600, runSize, "Inter", { fallback: SANS, tracking: 0.14 });
    c.fillStyle = rgba(theme.ink, 0.55);
    c.textAlign = "right";
    c.fillText("43", tp.x + tp.w - outer, folioY);
    c.textAlign = "left";
    if (!single) {
      c.fillStyle = rgba("#ffffff", 0.7);
      c.fillText("42", pages[0].x + outer, folioY);
      setType(c, 500, runSize, "Inter", { fallback: SANS, tracking: 0.04 });
      c.fillStyle = rgba("#ffffff", 0.62);
      c.fillText("Fig. 1 — One sphere, one light.", pages[0].x + outer + runSize * 3, folioY);
    }
  };
  return { pages, image, blocks, guides, text };
}

/** The picture: a lit sphere on a plinth, printed as a two-tone photograph. */
function picture(theme: Theme, box: Box) {
  return (c: Ctx2D, W: number, H: number) => {
    const { x, y, w, h } = box;
    const dark = mix(theme.bg, "#000000", 0.4);
    const tone = mix(theme.accent2, theme.ink, 0.25);
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    // Seamless backdrop: light falls from the upper left.
    const bg = c.createRadialGradient(
      x + w * 0.3,
      y + h * 0.25,
      0,
      x + w * 0.4,
      y + h * 0.4,
      Math.max(w, h) * 0.95,
    );
    bg.addColorStop(0, mix(dark, tone, 0.42));
    bg.addColorStop(0.55, mix(dark, tone, 0.16));
    bg.addColorStop(1, dark);
    c.fillStyle = bg;
    c.fillRect(x, y, w, h);
    const floorY = y + h * 0.7;
    const fl = c.createLinearGradient(0, floorY, 0, y + h);
    fl.addColorStop(0, rgba(mix(dark, tone, 0.22), 0.9));
    fl.addColorStop(1, rgba(dark, 1));
    c.fillStyle = fl;
    c.fillRect(x, floorY, w, y + h - floorY);
    // Plinth.
    const px = x + w * 0.5;
    const pw = w * 0.34;
    const pt = y + h * 0.6;
    const pg = c.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
    pg.addColorStop(0, mix(dark, tone, 0.36));
    pg.addColorStop(0.6, mix(dark, tone, 0.14));
    pg.addColorStop(1, dark);
    c.fillStyle = pg;
    c.fillRect(px - pw / 2, pt, pw, y + h * 0.84 - pt);
    c.fillStyle = mix(dark, tone, 0.5);
    c.beginPath();
    c.ellipse(px, pt, pw / 2, pw * 0.07, 0, 0, TAU);
    c.fill();
    // Contact shadow and the sphere.
    const r = w * 0.2;
    const sy = pt - r * 0.97;
    const sh = c.createRadialGradient(px + r * 0.2, pt, 0, px + r * 0.2, pt, r * 1.2);
    sh.addColorStop(0, rgba("#000000", 0.55));
    sh.addColorStop(1, rgba("#000000", 0));
    c.fillStyle = sh;
    c.beginPath();
    c.ellipse(px + r * 0.2, pt, r * 1.2, r * 0.16, 0, 0, TAU);
    c.fill();
    const sg = c.createRadialGradient(px - r * 0.42, sy - r * 0.45, r * 0.05, px, sy, r * 1.05);
    sg.addColorStop(0, mix(tone, theme.ink, 0.55));
    sg.addColorStop(0.35, mix(dark, tone, 0.75));
    sg.addColorStop(0.8, mix(dark, tone, 0.18));
    sg.addColorStop(1, dark);
    c.fillStyle = sg;
    c.beginPath();
    c.arc(px, sy, r, 0, TAU);
    c.fill();
    // Rim light on the shadow side.
    c.strokeStyle = rgba(tone, 0.25);
    c.lineWidth = r * 0.03;
    c.beginPath();
    c.arc(px, sy, r * 0.985, -0.2, 1.1);
    c.stroke();
    // Photographic grain, baked.
    const R = rng(4411);
    const n = Math.round((w * h) / 90);
    for (let i = 0; i < n; i++) {
      c.fillStyle = rgba(R() < 0.5 ? "#000000" : theme.ink, 0.03 + R() * 0.05);
      c.fillRect(x + R() * w, y + R() * h, 1.2, 1.2);
    }
    c.restore();
    void W;
    void H;
  };
}

function paperLayer(theme: Theme, L: Layout) {
  return (c: Ctx2D, W: number, H: number) => {
    const { u } = frameOf(W, H);
    for (const p of L.pages) {
      c.save();
      c.shadowColor = rgba("#000000", 0.6);
      c.shadowBlur = u * 0.05;
      c.shadowOffsetY = u * 0.015;
      c.fillStyle = mix(theme.bg, theme.ink, 0.06);
      c.fillRect(p.x, p.y, p.w, p.h);
      c.restore();
      // Paper tooth.
      const step = Math.max(3, Math.round(u / 160));
      for (let yy = p.y; yy < p.y + p.h; yy += step)
        for (let xx = p.x; xx < p.x + p.w; xx += step) {
          const n = fbm3(xx / (u * 0.2), yy / (u * 0.2), 9.1, 3);
          c.fillStyle = rgba(theme.ink, Math.max(0, 0.012 + n * 0.02));
          c.fillRect(xx, yy, step, step);
        }
    }
    // The gutter: pages curve into the spine.
    if (L.pages.length === 2) {
      const [a, b] = L.pages;
      const sx = b.x;
      const gw = a.w * 0.12;
      const gl = c.createLinearGradient(sx - gw, 0, sx, 0);
      gl.addColorStop(0, rgba("#000000", 0));
      gl.addColorStop(1, rgba("#000000", 0.5));
      c.fillStyle = gl;
      c.fillRect(sx - gw, a.y, gw, a.h);
      const gr = c.createLinearGradient(sx, 0, sx + gw * 0.8, 0);
      gr.addColorStop(0, rgba("#000000", 0.42));
      gr.addColorStop(1, rgba("#000000", 0));
      c.fillStyle = gr;
      c.fillRect(sx, b.y, gw * 0.8, b.h);
      c.fillStyle = rgba(theme.ink, 0.06);
      c.fillRect(sx + 1, b.y, Math.max(1, u * 0.001), b.h);
    }
  };
}

export const style: MotionStyle = {
  id: "magazine-layout",
  name: "Magazine Spread",
  family: "Type & Editorial",
  tagline: "A dark editorial spread",
  look: "A dark editorial spread: a full-bleed still life, a serif headline, an italic standfirst, justified columns with an accent drop cap and a pull quote.",
  move: "The grid appears, the picture wipes down into its frame, headline lines rise, columns set line by line, the guides fade; it holds, then clears back to the grid.",
  rules: [
    "Everything sits on the grid: margins, two columns, a baseline.",
    "Guides show while the page assembles and fade once it is set.",
    "Headline lines rise out of their own masks; body lines set one by one.",
    "Body text is justified with no single word left on a last line.",
    "One accent: the kicker, the drop cap and the pull quote.",
    "The picture is a real still life, lit once, printed two-tone.",
    "Hold the finished spread 1.5 s before it clears.",
  ],
  prompt: `R — References
• Editorial magazines with generous grids (search: Kinfolk spread, Apartamento layout, The Gentlewoman typography).
• InDesign layouts with guides on: margins, columns, a baseline grid.
• Newsreader for headline and text; Inter for small caps and folios.

I — Idea
A spread assembling itself, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): dark pages on a darker ground with the grid showing; the picture wipes down into the left page; the kicker and headline rise into place on the right.
• Middle (1.2–2.4 s): the standfirst and byline fade up, the columns set line by line with an {{accent}} drop cap, the pull quote lands, the folios appear, the guides fade away.
• End (2.4–5 s): the finished spread holds 1.5 s, then clears block by block back to the empty grid.

S — Style
Looks: {{bg}} ground; pages a shade lighter with paper tooth and a shadowed gutter; {{ink}} type: headline in Newsreader 500 (or {{font}}), standfirst in italic, justified body at 12–13 pt, tracked Inter small caps; {{accent}} for kicker, drop cap and pull quote; {{accent2}} tints the photograph and the guides.
Moves: guides fade in and out; picture wipe 0.65 s inOutCubic; headline lines rise 0.45 s quint-out through their masks; body lines 24 ms apart; the clear-out runs in reverse.
Rules:
1. A strict grid, visible while building.
2. Justified text; never a single word alone on a line.
3. One accent colour.
4. A real, lit picture, not a flat block.
5. Masks for the headline, fades for the rest.
6. Hold the spread at least 1.2 s.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no widow or orphan word; the headline breaks into balanced lines; the columns align to the baseline; nothing clips at the page edge. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Page_layout",
  theme: {
    bg: "#0d0c0b",
    ink: "#f0ebe1",
    accent: "#e8553a",
    accent2: "#7f9bb3",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..700", "Inter:wght@400..700"],
  tags: [
    "magazine",
    "editorial",
    "layout",
    "spread",
    "print",
    "grid",
    "serif",
    "columns",
    "typography",
    "publication",
    "article",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "mag", w, h, 37) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.5, h * 0.2, Math.max(w, h) * 0.8, theme.ink, 0.07);

    const word = wordFor(theme.name, "Motion", 14);
    const italicOk = faceReady(ITALIC);
    const key = `${w}x${h}:${theme.font}:${theme.ink}${theme.accent}:${word}:${italicOk ? 1 : 0}:${typeEpoch()}`;
    const L = once(`mag-layout:${key}`, () => layout(w, h, theme, word, italicOk));
    ctx.drawImage(bake(`mag-paper:${key}`, w, h, paperLayer(theme, L)) as CanvasImageSource, 0, 0);

    // Build (0.2–2.3) and clear (3.85–4.75): a single envelope drives both.
    const clear = (t0: number) =>
      ease.inOutCubic(seg(t, 3.85 + (2.3 - t0) * 0.34, 4.05 + (2.3 - t0) * 0.34));

    // Guides: on while the page is empty or building, off while it holds.
    const guideA =
      t < 2.4 ? 1 - ease.inOutSine(seg(t, 2.0, 2.4)) : ease.inOutSine(seg(t, 4.3, 4.8));
    if (guideA > 0.001) {
      const lw = Math.max(1, u * 0.0011);
      for (const g of L.guides) {
        ctx.fillStyle = rgba(theme.accent2, 0.1 * guideA);
        for (let y = g.cols[0].y; y < g.cols[0].y + g.cols[0].h; y += g.baseline)
          ctx.fillRect(g.margin.x, Math.round(y + g.baseline * 0.72), g.margin.w, lw);
        ctx.strokeStyle = rgba(theme.accent2, 0.45 * guideA);
        ctx.lineWidth = lw;
        ctx.strokeRect(g.margin.x, g.margin.y, g.margin.w, g.margin.h);
        for (const col of g.cols) ctx.strokeRect(col.x, col.y, col.w, col.h);
      }
      ctx.strokeStyle = rgba(theme.accent2, 0.45 * guideA);
      ctx.strokeRect(
        L.image.x + u * 0.01,
        L.image.y + u * 0.01,
        L.image.w - u * 0.02,
        L.image.h - u * 0.02,
      );
    }

    // Picture: wipes down into its frame, settling from a slight scale.
    const pin = ease.inOutCubic(seg(t, 0.3, 0.95));
    const pout = clear(0.3);
    const pic = bake(`mag-pic:${key}`, w, h, picture(theme, L.image));
    if (pin > 0.001 && pout < 0.999) {
      const I = L.image;
      ctx.save();
      ctx.beginPath();
      ctx.rect(I.x, I.y, I.w, I.h * pin);
      ctx.clip();
      ctx.globalAlpha = 1 - pout;
      const sc = lerp(1.06, 1, ease.outCubic(seg(t, 0.3, 1.3)));
      ctx.translate(I.x + I.w / 2, I.y + I.h / 2);
      ctx.scale(sc, sc);
      ctx.translate(-(I.x + I.w / 2), -(I.y + I.h / 2));
      ctx.drawImage(pic as CanvasImageSource, 0, 0);
      ctx.restore();
    }

    // Text, block by block.
    const layer = bake(`mag-text:${key}`, w, h, L.text);
    for (const b of L.blocks) {
      const on =
        b.kind === "rise"
          ? ease.outQuint(seg(t, b.t0, b.t0 + 0.45))
          : ease.inOutSine(seg(t, b.t0, b.t0 + (b.kind === "line" ? 0.18 : 0.3)));
      const off = clear(b.t0);
      const a = on * (1 - off);
      if (a <= 0.001) continue;
      const sx = Math.max(0, b.x);
      const sy = Math.max(0, b.y);
      const bw = Math.min(w - sx, b.w);
      const bh = Math.min(h - sy, b.h);
      if (bw <= 0 || bh <= 0) continue;
      // Headline lines and the drop cap have their own small layers.
      const own = b.own;
      const src = own
        ? bake(`mag-own:${key}:${b.t0}`, b.w, b.h, (c) => {
            c.translate(-b.x, -b.y);
            own(c);
          })
        : layer;
      const ox = own ? 0 : sx;
      const oy = own ? 0 : sy;
      const tx = own ? b.x : sx;
      const ty = own ? b.y : sy;
      const tw = own ? b.w : bw;
      const th = own ? b.h : bh;
      if (b.kind === "rise") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(tx, ty, tw, th);
        ctx.clip();
        const dy = (1 - on) * b.h * 0.9 - off * b.h * 0.3;
        ctx.globalAlpha = 1 - off;
        ctx.drawImage(src as CanvasImageSource, ox, oy, tw, th, tx, ty + dy, tw, th);
        ctx.restore();
      } else {
        const dy = (1 - on) * b.h * (b.kind === "line" ? 0.18 : 0.25);
        ctx.globalAlpha = a;
        ctx.drawImage(src as CanvasImageSource, ox, oy, tw, th, tx, ty + dy, tw, th);
        ctx.globalAlpha = 1;
      }
    }

    const mark = tintedLogo(theme, rgba(theme.ink, 0.55), u * 0.07, u * 0.035);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w - u * 0.12, h - u * 0.06);

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.28);
  },
};
