import { mix, rgba } from "../engine/color";
import {
  bake,
  ease,
  frameOf,
  grain,
  ground,
  hash,
  light,
  once,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkStock, loopT, rounded, setType, widthOf } from "./_s8-helpers";

/** The drum every module carries, in flip order. */
const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-/&'";
const IDX = new Map([...DRUM].map((c, i) => [c, i]));
const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';

/** Update A→B at T1, back at T2 (each module flips on its own delay). */
const T1 = 0.42;
const T2 = 2.92;
const STEP = 0.05;

interface Row {
  x: number;
  y: number;
  cw: number;
  ch: number;
  gap: number;
  a: string;
  b: string;
  /** Modules that land on accent flaps in each state. */
  accA: Set<number>;
  accB: Set<number>;
  big: boolean;
  index: number;
  /** Cascade delay per row, shorter on tall boards so every row still holds. */
  rowStep: number;
}

interface Layout {
  rows: Row[];
  board: { x: number; y: number; w: number; h: number; r: number };
  labels: { text: string; x: number; y: number; size: number }[];
  head: { x: number; y: number; size: number; right: number };
}

const clean = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9:.\-/&' ]/g, " ")
    .slice(0, 14);
const center = (s: string, n: number) => {
  const l = Math.floor((n - s.length) / 2);
  return (" ".repeat(Math.max(0, l)) + s).padEnd(n, " ").slice(0, n);
};

function layout(w: number, h: number, word: string): Layout {
  const { portrait, square, u } = frameOf(w, h);
  const hero = clean(word).trim() || "MOTION";
  const from = "LISBON";
  const n = Math.max(9, hero.length, from.length);
  const small = n * 2;
  const destW = small - 10;
  const flights: [string, string, string][] = [
    ["09:55", hero, "A07"],
    ["10:20", "KYOTO", "C14"],
    ["10:45", "OSLO", "D02"],
    ["11:10", "LIMA", "B09"],
    ["11:30", "SEOUL", "E21"],
    ["11:55", "CAIRO", "A11"],
    ["12:20", "QUITO", "F04"],
    ["12:45", "NAIROBI", "C08"],
    ["13:05", "PERTH", "B03"],
    ["13:30", "HANOI", "E12"],
    ["13:50", "PORTO", "A02"],
    ["14:15", "DAKAR", "D11"],
    ["14:40", "BOGOTA", "C05"],
    ["15:05", "ACCRA", "F09"],
    ["15:25", "MUMBAI", "B16"],
    ["15:50", "HAVANA", "E03"],
    ["16:10", "TALLINN", "A13"],
  ];
  const listRow = (f: [string, string, string]) =>
    `${f[0]} ${f[1].slice(0, destW).padEnd(destW, " ")} ${f[2]}`.padEnd(small, " ");

  const mx = w * (portrait ? 0.07 : square ? 0.07 : 0.085);
  const top = h * (portrait ? 0.12 : square ? 0.15 : 0.17);
  const bottom = h * (portrait ? 0.93 : square ? 0.92 : 0.9);
  const pad = u * 0.03;
  const availW = w - mx * 2 - pad * 2;
  const gap = Math.max(1, Math.round(u * 0.006));
  let B = Math.floor((availW - (n - 1) * gap) / n);
  const heroH = (b: number) => Math.round(b * 1.36);
  const smallW = (b: number) => Math.floor((b - gap) / 2);
  const smallH = (b: number) => Math.round(smallW(b) * 1.5);
  const labelSize = (b: number) => Math.max(6, smallW(b) * 0.3);
  // Rows that fit: hero, info, then as many list rows as the height allows (max 7).
  const fixed = (b: number) =>
    heroH(b) + pad * 2 + labelSize(b) * 2.2 + smallH(b) + b * 0.34 + labelSize(b) * 2.2;
  while (B > 8 && fixed(B) + smallH(B) > bottom - top) B -= 1;
  let K = Math.floor((bottom - top - fixed(B)) / (smallH(B) + gap * 2));
  K = Math.max(1, Math.min(portrait ? 15 : square ? 5 : 2, K));

  const rowW = n * B + (n - 1) * gap;
  const x0 = Math.round((w - rowW) / 2);
  const totalH = fixed(B) + K * (smallH(B) + gap * 2);
  let y = Math.round(top + (bottom - top - totalH) / 2 + pad);
  const rows: Row[] = [];
  const labels: Layout["labels"] = [];
  const ls = labelSize(B);
  rows.push({
    x: x0,
    y,
    cw: B,
    ch: heroH(B),
    gap,
    a: center(from, n),
    b: center(hero, n),
    accA: new Set(),
    accB: new Set(),
    big: true,
    index: 0,
    rowStep: 0,
  });
  y += heroH(B) + Math.round(B * 0.34);
  const sw = smallW(B);
  labels.push({ text: "TIME", x: x0, y: y + ls, size: ls });
  labels.push({ text: "GATE", x: x0 + 6 * (sw + gap), y: y + ls, size: ls });
  labels.push({ text: "REMARKS", x: x0 + 10 * (sw + gap), y: y + ls, size: ls });
  y += Math.round(ls * 2.2);
  const infoA = "09:40 B12 ON TIME".padEnd(small, " ");
  const infoB = "09:55 A07 BOARDING".padEnd(small, " ");
  const accB = new Set<number>();
  for (let i = 10; i < 18; i++) accB.add(i);
  rows.push({
    x: x0,
    y,
    cw: sw,
    ch: smallH(B),
    gap,
    a: infoA,
    b: infoB,
    accA: new Set(),
    accB,
    big: false,
    index: 1,
    rowStep: 0,
  });
  y += smallH(B) + Math.round(ls * 1.2);
  labels.push({ text: "NEXT DEPARTURES", x: x0, y: y + ls, size: ls });
  y += Math.round(ls * 2.2);
  for (let k = 0; k < K; k++) {
    rows.push({
      x: x0,
      y,
      cw: sw,
      ch: smallH(B),
      gap,
      a: listRow(flights[k]),
      b: listRow(flights[k + 1]),
      accA: new Set(),
      accB: new Set(),
      big: false,
      index: 2 + k,
      rowStep: 0,
    });
    y += smallH(B) + gap * 2;
  }
  for (const r of rows) r.rowStep = Math.min(0.07, 0.62 / rows.length);
  const bx = x0 - pad;
  const by = rows[0].y - pad;
  const board = {
    x: bx,
    y: by,
    w: rowW + pad * 2,
    h: y - gap * 2 + pad - by,
    r: u * 0.012,
  };
  const headSize = Math.max(7, u * (portrait ? 0.028 : 0.03));
  return {
    rows,
    board,
    labels,
    head: { x: bx, y: by - headSize * 1.05, size: headSize, right: bx + board.w },
  };
}

/** One card per drum character and colourway: the full flap, both halves, with its letter. */
function atlas(theme: Theme, cw: number, ch: number, big: boolean): AnyCanvas {
  const cols = 11;
  const count = DRUM.length * 2;
  const rows = Math.ceil(count / cols);
  return bake(
    `flap-atlas:${theme.bg}${theme.ink}${theme.accent}${theme.font}:${big ? 1 : 0}`,
    cols * cw,
    rows * ch,
    (c) => {
      for (let k = 0; k < count; k++) {
        const accent = k >= DRUM.length;
        const ch0 = DRUM[k % DRUM.length];
        const x = (k % cols) * cw;
        const y = Math.floor(k / cols) * ch;
        card(c, theme, x, y, cw, ch, ch0, accent, big);
      }
    },
  );
}

function card(
  c: Ctx2D,
  theme: Theme,
  x: number,
  y: number,
  cw: number,
  ch: number,
  letter: string,
  accent: boolean,
  big: boolean,
) {
  const face = accent ? theme.accent : mix(theme.bg, theme.ink, 0.085);
  const r = cw * 0.07;
  const mid = y + ch / 2;
  const split = Math.max(1, ch * 0.012);
  // Top half: lit from above.
  const gt = c.createLinearGradient(0, y, 0, mid);
  gt.addColorStop(0, mix(face, theme.ink, accent ? 0.16 : 0.07));
  gt.addColorStop(1, face);
  c.save();
  c.beginPath();
  c.rect(x, y, cw, ch / 2 - split / 2);
  c.clip();
  rounded(c, x, y, cw, ch, r);
  c.fillStyle = gt;
  c.fill();
  c.restore();
  // Bottom half: the flap tilts away from the light.
  const gb = c.createLinearGradient(0, mid, 0, y + ch);
  gb.addColorStop(0, mix(face, "#000000", 0.1));
  gb.addColorStop(1, mix(face, "#000000", 0.32));
  c.save();
  c.beginPath();
  c.rect(x, mid + split / 2, cw, ch / 2 - split / 2);
  c.clip();
  rounded(c, x, y, cw, ch, r);
  c.fillStyle = gb;
  c.fill();
  c.restore();
  // The letter, cut by the split through its middle.
  if (letter !== " ") {
    const size = ch * (big ? 0.8 : 0.78);
    setType(c, big ? 700 : 500, size, theme.font, { fallback: COND });
    const m = c.measureText("H");
    const cap = m.actualBoundingBoxAscent || size * 0.7;
    const tw = widthOf(c, letter);
    const scale = Math.min(1, (cw * 0.84) / Math.max(1, tw));
    c.save();
    c.translate(x + cw / 2, mid + (cap * scale) / 2);
    c.scale(scale, scale);
    c.fillStyle = accent ? mix(theme.bg, "#000000", 0.35) : theme.ink;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillText(letter, 0, 0);
    c.restore();
    // Print wear: the letter is slightly dimmer toward the bottom flap.
    c.save();
    c.beginPath();
    c.rect(x, mid, cw, ch / 2);
    c.clip();
    c.fillStyle = rgba("#000000", 0.1);
    c.fillRect(x, mid, cw, ch / 2);
    c.restore();
  }
  // Split gap and hinge pins.
  c.fillStyle = rgba("#000000", 0.85);
  c.fillRect(x, mid - split / 2, cw, split);
  c.fillStyle = mix(theme.bg, theme.ink, 0.22);
  const pinW = Math.max(1, cw * 0.05);
  const pinH = Math.max(1, ch * 0.05);
  c.fillRect(x - pinW * 0.2, mid - pinH / 2, pinW, pinH);
  c.fillRect(x + cw - pinW * 0.8, mid - pinH / 2, pinW, pinH);
  // A hairline highlight on each flap's leading edge.
  c.fillStyle = rgba(theme.ink, accent ? 0.2 : 0.07);
  c.fillRect(x + r, y + Math.max(1, ch * 0.004), cw - r * 2, Math.max(1, ch * 0.006));
  c.fillRect(x + r * 0.5, mid + split / 2, cw - r, Math.max(1, ch * 0.005));
}

/** The housing, labels and the empty wells behind every module (static). */
function housing(theme: Theme, L: Layout, word: string, hasLogo: boolean) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.drawImage(darkStock(theme, "flap", w, h, 11) as CanvasImageSource, 0, 0);
    const b = L.board;
    // Soft drop shadow, then brushed dark metal.
    c.save();
    c.shadowColor = rgba("#000000", 0.6);
    c.shadowBlur = u * 0.05;
    c.shadowOffsetY = u * 0.018;
    rounded(c, b.x, b.y, b.w, b.h, b.r);
    c.fillStyle = mix(theme.bg, theme.ink, 0.035);
    c.fill();
    c.restore();
    c.save();
    rounded(c, b.x, b.y, b.w, b.h, b.r);
    c.clip();
    const g = c.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, mix(theme.bg, theme.ink, 0.06));
    g.addColorStop(1, mix(theme.bg, "#000000", 0.25));
    c.fillStyle = g;
    c.fillRect(b.x, b.y, b.w, b.h);
    let s = 91;
    for (let i = 0; i < 260; i++) {
      s = (s * 16807) % 2147483647;
      const yy = b.y + ((s % 10000) / 10000) * b.h;
      c.fillStyle = rgba(i % 2 ? theme.ink : "#000000", 0.012 + (i % 7) * 0.003);
      c.fillRect(b.x, yy, b.w, Math.max(1, u * 0.0012));
    }
    c.restore();
    c.strokeStyle = rgba(theme.ink, 0.08);
    c.lineWidth = Math.max(1, u * 0.0015);
    rounded(c, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, b.r);
    c.stroke();
    // Wells: the dark recess each module sits in.
    for (const row of L.rows)
      for (let i = 0; i < row.a.length; i++) {
        const x = row.x + i * (row.cw + row.gap);
        c.fillStyle = rgba("#000000", 0.55);
        rounded(c, x - 1, row.y - 1, row.cw + 2, row.ch + 3, row.cw * 0.08);
        c.fill();
      }
    // Column labels.
    for (const l of L.labels) {
      setType(c, 600, l.size, theme.font, { fallback: COND, tracking: 0.14 });
      c.fillStyle = rgba(theme.ink, 0.46);
      c.textBaseline = "alphabetic";
      c.fillText(l.text, l.x, l.y);
    }
    // Header above the board.
    const hd = L.head;
    setType(c, 600, hd.size, theme.font, { fallback: COND, tracking: 0.16 });
    c.fillStyle = rgba(theme.ink, 0.9);
    c.fillText("DEPARTURES", hd.x, hd.y);
    if (!hasLogo) {
      setType(c, 500, hd.size * 0.8, theme.font, { fallback: COND, tracking: 0.16 });
      c.fillStyle = rgba(theme.ink, 0.42);
      c.textAlign = "right";
      c.fillText(`GATE A07 · ${clean(word).trim() || "MOTION"}`, hd.right, hd.y);
      c.textAlign = "left";
    }
  };
}

/** Where a module is in its flip at time t. */
function moduleState(row: Row, i: number, t: number, cols: number) {
  const a = row.a[i];
  const b = row.b[i];
  const accA = row.accA.has(i);
  const accB = row.accB.has(i);
  const delay = (T: number) =>
    T + (i / Math.max(1, cols)) * 0.46 + row.index * row.rowStep + hash(i, row.index, 7) * 0.05;
  // Before the first update the board shows A; between updates B; after the second, A again.
  const run = (from: string, to: string, fromAcc: boolean, toAcc: boolean, start: number) => {
    const ia = IDX.get(from) ?? 0;
    const ib = IDX.get(to) ?? 0;
    const dist = (ib - ia + DRUM.length) % DRUM.length;
    const steps =
      dist === 0 && fromAcc === toAcc
        ? 0
        : Math.max(1, Math.min(dist || DRUM.length, 3 + Math.floor(hash(i, row.index, 3) * 6)));
    const seq: { c: string; acc: boolean }[] = [{ c: from, acc: fromAcc }];
    for (let j = 1; j <= steps; j++) {
      const k = (ib - steps + j + DRUM.length * 4) % DRUM.length;
      seq.push({ c: DRUM[k], acc: j === steps ? toAcc : false });
    }
    const e = t - start;
    if (e <= 0 || steps === 0) return { prev: seq[0], next: seq[0], f: 0 };
    if (e >= steps * STEP) return { prev: seq[steps], next: seq[steps], f: 0 };
    const s = Math.floor(e / STEP);
    return { prev: seq[s], next: seq[s + 1], f: (e - s * STEP) / STEP };
  };
  if (t < T2) return run(a, b, accA, accB, delay(T1));
  return run(b, a, accB, accA, delay(T2));
}

export const style: MotionStyle = {
  id: "split-flap",
  name: "Split-Flap Board",
  family: "Type & Editorial",
  tagline: "An airport departures board",
  look: "An airport departures board in dark metal: rows of split-flap modules, condensed white letters, amber flaps for the one flight boarding.",
  move: "The board updates twice a loop: every module clatters through its drum in a left-to-right cascade, each flap falling on a hinge.",
  rules: [
    "Every letter lives on a flap cut through its middle by a dark split.",
    "A flap falls on its hinge: the top half drops, shading as it turns.",
    "Modules only flip forward through the drum, a few letters each.",
    "Cascade left to right and row by row, with a little mechanical jitter.",
    "Unchanged modules never flip; the board holds 1.2 s after each update.",
    "One accent: the status flaps that land on BOARDING.",
    "Big hero row, half-width info rows, all on one aligned grid.",
  ],
  prompt: `R — References
• Solari split-flap departure boards (search: Solari board, split flap display airport).
• The mechanism: flaps on a drum, each character cut through its middle, a hinge that drops the top half.

I — Idea
One board, updating, 5 seconds, looping seamlessly:
• Beginning (0–0.4 s): the board rests on a Lisbon departure; the next flight, "{{name}}", waits in the list.
• Middle (0.4–2.9 s): the board updates. Every module flips forward through its drum in a left-to-right, row-by-row cascade; the hero row lands on "{{name}}" and the remarks flip to BOARDING on {{accent}} flaps. Hold at least 1.2 s.
• End (2.9–5 s): it updates back the same way and holds on the opening board, so the loop closes.

S — Style
Looks: {{bg}} ground, a brushed dark-metal housing, near-black flaps lit from above, {{ink}} letters in {{font}} (condensed), {{accent}} status flaps, small tracked labels (DEPARTURES, TIME, GATE, REMARKS).
Moves: each flip takes 50 ms: the old top half falls on the hinge (scaleY = cos θ, darkening), then the new bottom half lands; 3–8 flips per module; cascade delay grows left to right and down the rows.
Rules:
1. Letters are cut through their middle by the split; top and bottom halves are shaded differently.
2. Modules flip forward through a fixed drum order, never backward.
3. Unchanged modules stay still.
4. One accent colour, for the boarding flaps.
5. Hero row cells are exactly two info cells wide: one grid.
6. Grain, a soft overhead light and a vignette; the housing is never flat.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; letters sit centred on the split, never clipped; mid-flip frames show a falling half, not a cross-fade; the grid of hero and info rows lines up; each board holds at least 1.2 s. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Split-flap_display",
  theme: {
    bg: "#0b0b0c",
    ink: "#f2eee6",
    accent: "#f5b83d",
    accent2: "#5b8def",
    font: "Barlow Condensed",
  },
  fonts: ["Barlow Condensed:wght@500;600;700"],
  tags: [
    "split flap",
    "flap",
    "airport",
    "departures",
    "board",
    "solari",
    "mechanical",
    "letters",
    "transit",
    "typography",
    "retro",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { u, cx } = frameOf(w, h);
    const word = wordFor(theme.name, "Motion", 14);
    ground(ctx, w, h, theme.bg);
    const L = once(`flap-layout:${w}x${h}:${word}`, () => layout(w, h, word));
    const mark = tintedLogo(theme, rgba(theme.ink, 0.7), L.head.size * 2.4, L.head.size * 1.25);
    ctx.drawImage(
      bake(
        `flap-housing:${theme.bg}${theme.ink}${theme.font}:${word}:${mark ? 1 : 0}`,
        w,
        h,
        housing(theme, L, word, !!mark),
      ) as CanvasImageSource,
      0,
      0,
    );
    if (mark)
      ctx.drawImage(
        mark as CanvasImageSource,
        L.head.right - L.head.size * 2.4,
        L.head.y - L.head.size * 1.05,
      );

    for (const row of L.rows) {
      const img = atlas(theme, row.cw, row.ch, row.big);
      const cols = row.a.length;
      const src = (letter: string, acc: boolean) => {
        const k = (IDX.get(letter) ?? 0) + (acc ? DRUM.length : 0);
        return [(k % 11) * row.cw, Math.floor(k / 11) * row.ch];
      };
      const half = row.ch / 2;
      for (let i = 0; i < cols; i++) {
        const x = row.x + i * (row.cw + row.gap);
        const y = row.y;
        const { prev, next, f } = moduleState(row, i, t, cols);
        const [nx, ny] = src(next.c, next.acc);
        const [px, py] = src(prev.c, prev.acc);
        const I = img as CanvasImageSource;
        if (f <= 0) {
          ctx.drawImage(I, nx, ny, row.cw, row.ch, x, y, row.cw, row.ch);
          continue;
        }
        // Static halves: the new top is revealed; the old bottom waits to be covered.
        ctx.drawImage(I, nx, ny, row.cw, half, x, y, row.cw, half);
        ctx.drawImage(I, px, py + half, row.cw, half, x, y + half, row.cw, half);
        // The falling flap, accelerating like a hinge under gravity.
        const g = ease.inCubic(Math.min(1, f * 1.08));
        const theta = g * Math.PI;
        const k = Math.cos(theta);
        if (k > 0) {
          const hh = half * k;
          ctx.drawImage(I, px, py, row.cw, half, x, y + half - hh, row.cw, hh);
          ctx.fillStyle = rgba("#000000", 0.55 * (1 - k));
          ctx.fillRect(x, y + half - hh, row.cw, hh);
          // The shadow the flap throws onto the revealed top half.
          ctx.fillStyle = rgba("#000000", 0.35 * (1 - k));
          ctx.fillRect(x, y, row.cw, half - hh);
        } else {
          const hh = half * -k;
          ctx.drawImage(I, nx, ny + half, row.cw, half, x, y + half, row.cw, hh);
          ctx.fillStyle = rgba("#000000", 0.5 * (1 + k));
          ctx.fillRect(x, y + half, row.cw, hh);
        }
      }
    }

    light(ctx, cx, h * 0.12, Math.max(w, h) * 0.75, theme.ink, 0.07);
    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
    void u;
  },
};
