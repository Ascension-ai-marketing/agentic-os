import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  context,
  ease,
  frameOf,
  grain,
  ground,
  hash,
  lerp,
  light,
  makeCanvas,
  MONO,
  once,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkStock, loopT, setType } from "./_s8-helpers";

const TYPE = '"Courier Prime", "Courier New", monospace';
const ADV = 0.6; // Courier Prime advance, in em.
const LINE = 1.42;

type Ev =
  | { kind: "char"; t: number; c: string; line: number; col: number; red: boolean }
  | { kind: "cr"; t: number; dur: number };

interface Script {
  events: Ev[];
  /** Carriage column over time: [t, col] steps (animated by the escapement). */
  steps: [number, number][];
  lines: number;
  crs: { t: number; dur: number; line: number }[];
  maxCols: number;
  end: number;
}

/** The keystrokes: type, return, type, back up, strike through, retype. */
function script(): Script {
  const events: Ev[] = [];
  const steps: [number, number][] = [[0, 0]];
  const crs: Script["crs"] = [];
  let t = 0.3;
  let col = 0;
  let line = 0;
  let maxCols = 0;
  const key = (c: string, red = false, dt = 0.084) => {
    if (c !== " ") events.push({ kind: "char", t, c, line, col, red });
    col += 1;
    maxCols = Math.max(maxCols, col);
    steps.push([t + 0.012, col]);
    t += dt * (0.84 + 0.32 * hash(events.length, 41));
  };
  for (const c of LINE1) key(c);
  t += 0.04;
  crs.push({ t, dur: 0.32, line: line + 1 });
  events.push({ kind: "cr", t, dur: 0.32 });
  steps.push([t + 0.02, 0]);
  t += 0.38;
  line += 1;
  col = 0;
  for (const c of "hand") key(c);
  t += 0.22;
  for (let i = 0; i < 4; i++) {
    col -= 1;
    steps.push([t, col]);
    t += 0.075;
  }
  t += 0.06;
  for (let i = 0; i < 4; i++) key("-", true, 0.06);
  t += 0.04;
  for (const c of " code.") key(c, c !== " ");
  return { events, steps, lines: line + 1, crs, maxCols, end: t };
}

const LINE1 = "Drawn by";
/** Both lines must stay on the sheet while the carriage travels: 8 + 10 columns. */
const SPAN = 18;

const EJECT = 4.3;

interface Geo {
  S: number;
  cw: number;
  px: number;
  py: number;
  fan: { x: number; y: number; R: number; rin: number };
}

function geometry(w: number, h: number, maxCols: number): Geo {
  const { portrait, square } = frameOf(w, h);
  const S = Math.min(h * (portrait ? 0.1 : square ? 0.12 : 0.14), (w * 0.88) / (SPAN * ADV));
  const cw = S * ADV;
  // The strike point sits where the finished line and the returned first line both fit.
  const slack = w * 0.88 - SPAN * cw;
  const px = w * 0.06 + maxCols * cw + slack / 2;
  const py = h * (portrait ? 0.42 : square ? 0.44 : 0.46);
  const R = portrait ? Math.min(h * 0.46, w * 0.86) : Math.min(h * 0.45, w * 0.42);
  return { S, cw, px, py, fan: { x: px + cw * 0.5, y: py - S * 0.28, R, rin: R * 0.5 } };
}

/** Carriage column at time t: each escapement step snaps over 30 ms. */
function carriage(sc: Script, t: number): number {
  let col = 0;
  for (let i = 1; i < sc.steps.length; i++) {
    const [ts, c] = sc.steps[i];
    if (t < ts) break;
    const prev = sc.steps[i - 1][1];
    const isReturn = c === 0 && prev > 0;
    const d = isReturn ? 0.3 : 0.03;
    col = lerp(
      prev,
      c,
      isReturn ? ease.inOutCubic(seg(t, ts, ts + d)) : ease.outCubic(seg(t, ts, ts + d)),
    );
  }
  // Eject: the carriage returns home while the sheet feeds out.
  const back = ease.inOutCubic(seg(t, EJECT, EJECT + 0.55));
  return col * (1 - back);
}

/** Ribbon texture: fabric weave and missed ink, punched out of the type layer. */
function ribbon(size: number): AnyCanvas {
  return once(`tw-ribbon:${size}`, () => {
    const c = makeCanvas(size, size);
    const g = context(c);
    const r = rng(311);
    for (let i = 0; i < size * size * 0.035; i++) {
      g.fillStyle = `rgba(0,0,0,${(0.2 + r() * 0.55).toFixed(3)})`;
      const s = 0.5 + r() * r() * 1.6;
      g.fillRect(r() * size, r() * size, s, s);
    }
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < size; y += 3) g.fillRect(0, y, size, 1);
    return c;
  });
}

function fanLayer(theme: Theme, G: Geo) {
  return (c: Ctx2D) => {
    const { x, y, R, rin } = G.fan;
    for (let i = 0; i < BARS; i++) {
      const a = barAngle(i);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x0 = x + ca * R;
      const y0 = y + sa * R;
      const x1 = x + ca * rin;
      const y1 = y + sa * rin;
      const gr = c.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, rgba(theme.ink, 0.02));
      gr.addColorStop(1, rgba(theme.ink, 0.14));
      c.strokeStyle = gr;
      c.lineWidth = Math.max(1, G.S * 0.05);
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      // Slug at the tip.
      c.fillStyle = rgba(theme.ink, 0.16);
      c.beginPath();
      c.arc(x1, y1, G.S * 0.06, 0, TAU);
      c.fill();
    }
    // The segment the bars pivot in.
    c.strokeStyle = rgba(theme.ink, 0.07);
    c.lineWidth = Math.max(1, G.S * 0.08);
    c.beginPath();
    c.arc(x, y, R * 1.02, barAngle(0) - 0.04, barAngle(BARS - 1) + 0.04);
    c.stroke();
  };
}

const BARS = 44;
const barAngle = (i: number) => 0.42 + ((Math.PI - 0.84) * i) / (BARS - 1);
const barFor = (c: string) => Math.floor(hash(c.charCodeAt(0), 5) * BARS);

export const style: MotionStyle = {
  id: "typewriter",
  name: "Typewriter",
  family: "Type & Editorial",
  tagline: "A manual typewriter striking",
  look: "A manual typewriter on a dark sheet: slab-serif ribbon ink, a moving carriage scale, a fan of typebars striking one point.",
  move: "Keys strike in an uneven human rhythm, the carriage steps left, returns, backs up to strike a word through in red and retypes it.",
  rules: [
    "The strike point never moves; the sheet and its scale move under it.",
    "Every key is a typebar flicking up from the fan to one point.",
    "Ink is uneven: each letter a little lighter or heavier, a hair off its line.",
    "Human rhythm: 55–75 ms per key, a pause before the correction.",
    "Corrections are struck through with hyphens, never deleted.",
    "One accent: the red half of the ribbon, for the strike and the retype.",
    "Hold the finished line at least 1.2 s before the sheet feeds out.",
  ],
  prompt: `R — References
• Manual typewriters (search: Olivetti Lettera 32 typing close up, typewriter typebar basket).
• Typed manuscripts with strike-through corrections (words x-ed or hyphened out, then retyped).
• Courier and slab-serif typewriter faces.

I — Idea
One sentence typed live, 5 seconds, looping seamlessly:
• Beginning (0–1.4 s): keys strike "Drawn by" one by one; the carriage steps left under a fixed strike point, then returns and feeds a line.
• Middle (1.4–3.1 s): it types "hand", pauses, backs up four spaces and strikes the word through with red hyphens, then types " code." in red.
• End (3–5 s): the finished two lines hold 1.3 s, the sheet feeds out upward and the carriage returns home: back to the opening frame.

S — Style
Looks: {{bg}} sheet with grain, {{ink}} ribbon ink in Courier Prime, red {{accent}} for the correction, a dim fan of typebars below the strike point, a moving scale with ticks and numbers, a small fixed pointer.
Moves: each keystroke flicks one typebar to the strike point (30 ms up, 50 ms back) and steps the carriage one column in 30 ms; the return eases over 0.3 s with a line feed; the eject eases up and out.
Rules:
1. The strike point is fixed; the text moves left as it is typed.
2. The same letter always uses the same typebar.
3. Per-letter ink density and a hair of vertical jitter, seeded.
4. Strike through with hyphens typed over the word.
5. Red is only the correction and the retype.
6. Grain and ribbon texture on every letter; never flat vector type.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the hyphens sit through the middle of the struck word; the finished text is centred and never clipped; a typebar reaches the strike point on each key; the final line holds at least 1.2 s. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Typewriter",
  theme: {
    bg: "#0e0d0c",
    ink: "#efe9dc",
    accent: "#e5484d",
    accent2: "#8a8f98",
    font: "Courier Prime",
  },
  fonts: ["Courier Prime:wght@400;700"],
  tags: [
    "typewriter",
    "typing",
    "type",
    "text",
    "retro",
    "writing",
    "correction",
    "strike",
    "mono",
    "manuscript",
    "editorial",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "tw", w, h, 5) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.5, h * 0.38, Math.max(w, h) * 0.7, theme.ink, 0.075);

    const sc = once("tw-script", script);
    const G = geometry(w, h, sc.maxCols);
    const col = carriage(sc, t);
    const paperX = G.px - col * G.cw;
    // Line feed: the sheet rises one line per return, then feeds out.
    let feed = 0;
    for (const cr of sc.crs) feed += ease.inOutCubic(seg(t, cr.t, cr.t + cr.dur * 0.7));
    const eject = ease.inCubic(seg(t, EJECT, EJECT + 0.6));
    const sheetY = -feed * G.S * LINE - eject * h * 0.75;
    const fade = 1 - ease.inSine(seg(t, EJECT + 0.1, EJECT + 0.55));

    // Typebar fan (static) and the bar in flight.
    ctx.drawImage(bake(`tw-fan:${theme.ink}`, w, h, fanLayer(theme, G)) as CanvasImageSource, 0, 0);
    let strike: { c: string; k: number; red: boolean } | null = null;
    for (const ev of sc.events) {
      if (ev.kind !== "char") continue;
      const dt = t - ev.t;
      if (dt > -0.03 && dt < 0.06) {
        const k = dt < 0 ? 1 + dt / 0.03 : 1 - dt / 0.06;
        strike = { c: ev.c, k: ease.inOutSine(clamp(k)), red: ev.red };
      }
    }
    if (strike) {
      const i = barFor(strike.c);
      const a = barAngle(i);
      const { x, y, R, rin } = G.fan;
      const tip = lerp(rin, G.S * 0.2, strike.k);
      ctx.strokeStyle = rgba(theme.ink, 0.35 + 0.4 * strike.k);
      ctx.lineWidth = Math.max(1, G.S * 0.055);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
      ctx.lineTo(x + Math.cos(a) * tip, y + Math.sin(a) * tip);
      ctx.stroke();
      ctx.fillStyle = strike.red ? theme.accent : theme.ink;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * tip, y + Math.sin(a) * tip, G.S * 0.075, 0, TAU);
      ctx.fill();
    }

    // Typed text on its own layer, so the ribbon texture punches through it.
    const { canvas: layer, ctx: L } = buffer("tw-type", w, h);
    L.clearRect(0, 0, w, h);
    setType(L, 400, G.S, "Courier Prime", { fallback: TYPE });
    L.textBaseline = "alphabetic";
    let lastStrike = -1;
    for (const ev of sc.events) {
      if (ev.kind !== "char" || t < ev.t) continue;
      lastStrike = Math.max(lastStrike, ev.t);
      const n = hash(ev.line * 97 + ev.col, ev.c.charCodeAt(0));
      const age = t - ev.t;
      const x = paperX + ev.col * G.cw;
      const y = G.py + sheetY + ev.line * G.S * LINE;
      const jy = (hash(ev.line, ev.col, 9) - 0.5) * G.S * 0.035;
      const rot = (hash(ev.line, ev.col, 13) - 0.5) * 0.02;
      const fresh = 1 - seg(age, 0, 0.09);
      const color = ev.red ? theme.accent : theme.ink;
      L.save();
      L.translate(x + G.cw / 2, y + jy);
      L.rotate(rot);
      L.globalAlpha = (0.8 + 0.2 * n) * fade;
      L.fillStyle = color;
      L.textAlign = "center";
      L.fillText(ev.c, 0, 0);
      // A faint second impression where the slug bounced.
      L.globalAlpha = 0.14 * fade;
      L.fillText(ev.c, G.S * 0.012, G.S * 0.008);
      if (fresh > 0) {
        L.globalAlpha = 0.35 * fresh * fade;
        L.fillStyle = mix(color, "#ffffff", 0.5);
        L.fillText(ev.c, 0, 0);
      }
      L.restore();
    }
    L.save();
    L.globalCompositeOperation = "destination-out";
    const tex = ribbon(256);
    const pat = L.createPattern(tex as CanvasImageSource, "repeat");
    if (pat) {
      L.globalAlpha = 0.5;
      L.fillStyle = pat;
      L.fillRect(0, 0, w, h);
    }
    L.restore();
    // Impact: the platen gives a hair on each strike.
    const kick = lastStrike >= 0 ? Math.max(0, 1 - (t - lastStrike) / 0.05) : 0;
    ctx.drawImage(layer as CanvasImageSource, 0, kick * G.S * 0.01);

    // Scale: ticks per column riding with the carriage, and the fixed pointer.
    const scaleY = G.py + G.S * 0.42;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(theme.ink, 0.1);
    ctx.fillRect(0, scaleY, w, Math.max(1, G.S * 0.018));
    ctx.fillStyle = rgba(theme.ink, 0.28);
    const first = Math.floor(-paperX / G.cw) - 2;
    const last = Math.ceil((w - paperX) / G.cw) + 2;
    setType(ctx, 400, G.S * 0.17, "Courier Prime", { fallback: MONO });
    ctx.textAlign = "center";
    for (let i = first; i <= last; i++) {
      const x = paperX + i * G.cw + G.cw / 2;
      const major = i % 5 === 0;
      ctx.fillRect(
        x - 0.5,
        scaleY - G.S * (major ? 0.14 : 0.07),
        Math.max(1, G.S * 0.012),
        G.S * (major ? 0.14 : 0.07),
      );
      if (i % 10 === 0 && i >= 0) ctx.fillText(String(i), x, scaleY + G.S * 0.24);
    }
    ctx.restore();
    // Pointer: two prongs around the strike cell and a small accent notch.
    const cxp = G.px + G.cw / 2;
    ctx.strokeStyle = rgba(theme.ink, 0.5);
    ctx.lineWidth = Math.max(1, G.S * 0.02);
    ctx.beginPath();
    ctx.moveTo(G.px - G.cw * 0.08, scaleY - G.S * 0.02);
    ctx.lineTo(G.px - G.cw * 0.08, scaleY - G.S * 0.3);
    ctx.moveTo(G.px + G.cw * 1.08, scaleY - G.S * 0.02);
    ctx.lineTo(G.px + G.cw * 1.08, scaleY - G.S * 0.3);
    ctx.stroke();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(cxp, scaleY + G.S * 0.02);
    ctx.lineTo(cxp - G.S * 0.07, scaleY + G.S * 0.13);
    ctx.lineTo(cxp + G.S * 0.07, scaleY + G.S * 0.13);
    ctx.closePath();
    ctx.fill();

    // Corner caption: the brand mark or the machine's name.
    const cap = Math.max(7, u * 0.022);
    const mark = tintedLogo(theme, rgba(theme.ink, 0.55), cap * 3, cap * 1.6);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w * 0.06, h * 0.07);
    else {
      setType(ctx, 700, cap, "Courier Prime", { fallback: MONO, tracking: 0.12 });
      ctx.fillStyle = rgba(theme.ink, 0.45);
      ctx.textAlign = "left";
      ctx.fillText(
        `${wordFor(theme.name, "Motion", 14).toUpperCase()} · DRAFT 3`,
        w * 0.06,
        h * 0.07 + cap,
      );
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
