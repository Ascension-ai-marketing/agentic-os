import { ensureContrast, mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  frameOf,
  fbm3,
  grain,
  ground,
  hash,
  light,
  lerp,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { clean57, dots57, width57 } from "./_s4-helpers";

/** Form height in dot rows; one form prints per loop and the paper advances exactly one form. */
const FORM = 84;

/** A printed element: its top dot row in the form, and when its pass runs. */
interface Pass {
  y: number;
  kind: "sep" | "big" | "a" | "b";
  /** Which band of the big glyphs this pass prints (0..bands-1). */
  band: number;
  t0: number;
  t1: number;
  dir: 1 | -1;
}

interface Sheet {
  dp: number;
  px: number;
  pw: number;
  strip: number;
  xL: number;
  xR: number;
  pl: number;
  big: number;
  word: string;
  passes: Pass[];
}

function sheetFor(w: number, h: number, word: string): Sheet {
  const { portrait, square } = frameOf(w, h);
  const pw = w * (portrait ? 0.86 : square ? 0.7 : 0.54);
  const strip = pw * 0.085;
  const big = word.length <= 7 ? 3 : 2;
  const bigDots = width57(word) * big + big;
  const textCols = Math.max(bigDots + 8, 84);
  const areaW = pw - strip * 2 - pw * 0.04;
  let dp = areaW / textCols;
  const pl = h * (portrait ? 0.8 : 0.79);
  // The finished word must still be on the paper when the form feed ends.
  dp = Math.min(dp, (pl - h * 0.05) / (FORM - 2));
  const px = (w - pw) / 2;
  const cols = Math.floor(areaW / dp);
  const xL = px + (pw - cols * dp) / 2;
  const xR = xL + cols * dp;
  // Print passes: separator, the big word in 7-row bands, two small lines, a separator.
  const passes: Pass[] = [];
  let at = 0.12;
  let dir: 1 | -1 = 1;
  const add = (y: number, kind: Pass["kind"], band: number, dur: number, feed: number) => {
    passes.push({ y, kind, band, t0: at, t1: at + dur, dir });
    at += dur + feed;
    dir = dir === 1 ? -1 : 1;
  };
  add(5, "sep", 0, 0.36, 0.2);
  const bigY = 15;
  for (let b = 0; b < big; b++) add(bigY + b * 7, "big", b, 0.5, 0.1);
  const after = bigY + big * 7 + 7;
  add(after, "a", 0, 0.4, 0.1);
  add(after + 10, "b", 0, 0.4, 0.1);
  add(after + 22, "sep", 0, 0.36, 0);
  return { dp, px, pw, strip, xL, xR, pl, big, word, passes };
}

/** Paper position (the dot row under the print head) at time t. */
function feedAt(S: Sheet, t: number): number {
  const P = S.passes;
  if (t <= P[0].t1) return P[0].y;
  for (let i = 1; i < P.length; i++) {
    const prev = P[i - 1];
    const next = P[i];
    if (t < next.t0) return lerp(prev.y, next.y, ease.inOutSine(seg(t, prev.t1, prev.t1 + 0.09)));
    if (t <= next.t1) return next.y;
  }
  // Form feed: roll on to the next form's first line.
  const last = P[P.length - 1];
  const k = ease.inOutCubic(seg(t, last.t1 + 0.08, last.t1 + 0.9));
  return lerp(last.y, FORM + P[0].y, k);
}

/** Every dot of one form, as [x, y, ink] in dot units. ink 1 = the red half of the ribbon. */
function formDots(S: Sheet, cols: number) {
  const out: [number, number, number, number][] = [];
  const line = (text: string, y: number, pass: number) =>
    dots57(text, (x, yy) => out.push([x, y + yy, 0, pass]));
  const sep = "=".repeat(Math.floor((cols + 1) / 6));
  const bigW = width57(S.word) * S.big;
  const bigX = Math.round((cols - bigW) / 2);
  S.passes.forEach((p, i) => {
    if (p.kind === "sep") {
      const x0 = Math.round((cols - width57(sep)) / 2);
      dots57(sep, (x, yy) => out.push([x0 + x, p.y + yy, 0, i]));
    } else if (p.kind === "big") {
      dots57(S.word, (x, yy) => {
        for (let a = 0; a < S.big; a++)
          for (let b = 0; b < S.big; b++) {
            const row = yy * S.big + b;
            if (Math.floor(row / 7) !== p.band) continue;
            out.push([bigX + x * S.big + a, p.y + (row % 7), 1, i]);
          }
      });
    } else {
      const left = p.kind === "a" ? "RUN 042" : "24.09.26";
      const right = p.kind === "a" ? "OK" : "09:41";
      const n = Math.floor((cols + 1) / 6);
      const fill = Math.max(1, n - left.length - right.length - 2);
      const text = `${left} ${".".repeat(fill)} ${right}`;
      const x0 = Math.round((cols - width57(text)) / 2);
      line(text, p.y, i);
      // Centre the line.
      for (const d of out) if (d[3] === i) d[0] += x0;
    }
  });
  return out;
}

/** The printed form: one transparent canvas per pass, baked once per size. */
function formLayer(S: Sheet, theme: Theme, pass: number) {
  return (c: Ctx2D) => {
    const cols = Math.round((S.xR - S.xL) / S.dp);
    const dots = formDots(S, cols).filter((d) => d[3] === pass);
    const ink = mix(theme.bg, "#000000", 0.25);
    // Ribbon ink must read on the paper, whatever the brand's accent.
    const red = ensureContrast(theme.accent, mix(theme.ink, theme.bg, 0.05), 3.4);
    const r = S.dp * 0.46;
    for (const [x, y, k] of dots) {
      const jx = (hash(x, y, 3) - 0.5) * S.dp * 0.12;
      const jy = (hash(x, y, 5) - 0.5) * S.dp * 0.12;
      const cx = (x + 0.5) * S.dp + jx + S.dp * 2;
      const cy = (y - S.passes[pass].y + 0.5) * S.dp + jy;
      const a = 0.72 + 0.26 * hash(x, y, 7);
      // Ink bleed, then the dot itself (double-struck for the big word).
      c.fillStyle = rgba(k ? red : ink, a * 0.18);
      c.beginPath();
      c.arc(cx, cy, r * 1.35, 0, TAU);
      c.fill();
      c.fillStyle = rgba(k ? red : ink, a);
      c.beginPath();
      c.arc(cx, cy, r, 0, TAU);
      c.fill();
      if (k) {
        c.beginPath();
        c.arc(cx + S.dp * 0.28, cy, r * 0.92, 0, TAU);
        c.fill();
      }
    }
  };
}

/** One form's worth of paper: tone, green bars, fibres, tractor strips, holes, perforations. */
function paperTile(S: Sheet, theme: Theme) {
  return (c: Ctx2D, W: number, H: number) => {
    const paper = mix(theme.ink, theme.bg, 0.05);
    c.fillStyle = paper;
    c.fillRect(0, 0, W, H);
    // Green bars: bands of four lines, two per form.
    const band = H / 4;
    c.fillStyle = mix(paper, theme.accent2, 0.2);
    for (let i = 0; i < 4; i += 2)
      c.fillRect(S.strip, i * band + band * 0.5, W - S.strip * 2, band);
    // Fibres and tone.
    const r = rng(77);
    const step = Math.max(3, Math.round(S.dp * 1.2));
    for (let y = 0; y < H; y += step)
      for (let x = 0; x < W; x += step) {
        const n = fbm3(x / (S.dp * 22), y / (S.dp * 22), 1.7, 3, W / (S.dp * 22), 0, 0);
        c.fillStyle = rgba(theme.bg, Math.max(0, 0.025 + n * 0.05));
        c.fillRect(x, y, step, step);
      }
    for (let i = 0; i < (W * H) / (S.dp * S.dp * 6); i++) {
      c.fillStyle = rgba(theme.bg, 0.03 + r() * 0.05);
      c.fillRect(r() * W, r() * H, Math.max(1, S.dp * 0.18), Math.max(1, S.dp * 0.18));
    }
    // Tractor strips: perforation lines and sprocket holes (two holes per band).
    c.fillStyle = rgba(theme.bg, 0.35);
    const dash = S.dp * 0.9;
    for (let y = 0; y < H; y += dash * 2) {
      c.fillRect(S.strip - 1, y, Math.max(1, S.dp * 0.14), dash);
      c.fillRect(W - S.strip, y, Math.max(1, S.dp * 0.14), dash);
    }
    const holes = 8;
    const hr = S.strip * 0.24;
    for (let i = 0; i < holes; i++) {
      const y = (i + 0.5) * (H / holes);
      for (const x of [S.strip / 2, W - S.strip / 2]) {
        c.fillStyle = rgba("#000000", 0.25);
        c.beginPath();
        c.arc(x, y + hr * 0.12, hr * 1.05, 0, TAU);
        c.fill();
        c.fillStyle = theme.bg;
        c.beginPath();
        c.arc(x, y, hr, 0, TAU);
        c.fill();
      }
    }
    // The perforation between forms (at the top of the tile).
    c.fillStyle = rgba(theme.bg, 0.45);
    for (let x = 0; x < W; x += S.dp * 1.6) c.fillRect(x, 0, S.dp * 0.9, Math.max(1, S.dp * 0.16));
  };
}

export const style: MotionStyle = {
  id: "dot-matrix",
  name: "Dot-Matrix Printout",
  family: "Retro Tech",
  tagline: "A print head hammering red dots",
  look: "Green-bar tractor-feed paper under a desk lamp, a print head hammering the word in red ribbon dots, a serrated tear bar.",
  move: "The head sweeps back and forth, one line per pass; the big word prints in bands, the paper steps up, then a form feed rolls it on.",
  rules: [
    "Every mark is a round pin dot on one grid; big type is the same font multiplied.",
    "Bidirectional: each pass runs the other way, and dots appear only where the head has been.",
    "The paper moves only in line feeds and one form feed; it never drifts.",
    "Tractor strips with sprocket holes, perforations and green bars in period with the form.",
    "Ink varies dot to dot: density, a hair of offset, a little bleed.",
    "Two ribbon colours: the word in red, everything else in black.",
    "Warm lamp light on the paper, falling to darkness at the top.",
  ],
  prompt: `R — References
• 9-pin dot-matrix printers on continuous tractor-feed green-bar paper (search: dot matrix printer printing close up, green bar paper).
• Banner printouts and two-colour (black/red) ribbons.

I — Idea
One printout, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): the head sweeps a separator, then starts hammering "{{name}}" in huge red dot letters, one 7-dot band per pass.
• Middle (1.5–3.5 s): the last band lands, the paper steps up line by line, two small lines of dot text and a separator print underneath.
• End (3.5–5 s): a form feed rolls the paper up exactly one form, the perforation passes the tear bar, and the head parks where it began.

S — Style
Looks: {{bg}} desk in the dark, a pool of warm light; {{ink}} paper with {{accent2}} green bars, tractor strips and sprocket holes; dots in near-black ink, the big word in {{accent}} red ribbon, double-struck; a dark printer body with a serrated tear bar and a lit ON LINE lamp.
Moves: head passes at constant speed, alternating direction; line feeds ease in 90 ms; the form feed eases over 0.8 s; the paper advances exactly one form per loop.
Rules:
1. Round pin dots on one grid; big type = the same 5×7 font, multiplied.
2. Dots appear only behind the moving head.
3. Line feeds and one form feed; no drift.
4. Holes, bars and perforations repeat exactly once per form.
5. Dot-to-dot ink variation and slight bleed.
6. Warm light on the paper, darkness at the top.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the big word reads at thumbnail size; dots line up across passes (no seams between bands); holes and bars loop without a jump; nothing prints ahead of the head. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Dot_matrix_printing",
  theme: {
    bg: "#0d0c0a",
    ink: "#efe9dc",
    accent: "#d23a2c",
    accent2: "#5f9c6c",
    font: "Inter",
  },
  tags: [
    "printer",
    "dot matrix",
    "print",
    "paper",
    "receipt",
    "tractor feed",
    "office",
    "computer",
    "retro",
    "80s",
    "text",
    "typewriter",
  ],
  word: "PRINT",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const word = clean57(wordFor(theme.name, "PRINT", 12)).trim() || "PRINT";
    const S = sheetFor(w, h, word);
    const dp = S.dp;
    const formH = FORM * dp;
    const feed = feedAt(S, t);
    // Screen y of paper row r (dot units, within the current form). The band being
    // printed sits in the 7 rows just above the print line.
    const rowY = (r: number) => S.pl + (r - feed - 7) * dp;

    // Lamp light on the desk.
    light(ctx, w * 0.5, S.pl - formH * 0.35, Math.max(w, h) * 0.75, theme.ink, 0.07);

    // Paper tiles: the form being printed and the ones above it.
    const tile = bake(
      `dm-paper:${theme.ink}${theme.bg}${theme.accent2}:${S.pw.toFixed(1)}:${dp.toFixed(3)}`,
      S.pw,
      formH,
      paperTile(S, theme),
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, S.pl + dp * 1.5);
    ctx.clip();
    // Paper shadow on the desk.
    ctx.fillStyle = rgba("#000000", 0.5);
    ctx.fillRect(S.px - dp * 0.6, 0, S.pw + dp * 1.8, S.pl);
    for (let k = -3; k <= 1; k++) ctx.drawImage(tile as CanvasImageSource, S.px, rowY(k * FORM));
    // Printed dots: earlier forms in full, this form up to the head.
    const cols = Math.round((S.xR - S.xL) / dp);
    const layers = S.passes.map((p, i) =>
      bake(
        `dm-pass:${i}:${word}:${theme.bg}${theme.accent}:${S.pw.toFixed(1)}:${dp.toFixed(3)}:${cols}`,
        (cols + 4) * dp,
        8 * dp,
        formLayer(S, theme, i),
      ),
    );
    const headX = (p: Pass) => {
      const k = seg(t, p.t0, p.t1);
      const a = S.xL - dp * 2;
      const b = S.xR + dp * 2;
      return p.dir === 1 ? lerp(a, b, k) : lerp(b, a, k);
    };
    const parked = S.xL - dp * 2;
    let head = parked;
    S.passes.forEach((p, i) => {
      const img = layers[i] as CanvasImageSource;
      const lw = (cols + 4) * dp;
      // Earlier forms.
      for (let k = -3; k < 0; k++) ctx.drawImage(img, S.xL - dp * 2, rowY(p.y + k * FORM));
      if (t >= p.t1) ctx.drawImage(img, S.xL - dp * 2, rowY(p.y));
      else if (t > p.t0) {
        const hx = headX(p);
        head = hx;
        const cut = clamp(hx - (S.xL - dp * 2), 0, lw);
        if (p.dir === 1)
          ctx.drawImage(img, 0, 0, cut, 8 * dp, S.xL - dp * 2, rowY(p.y), cut, 8 * dp);
        else ctx.drawImage(img, cut, 0, lw - cut, 8 * dp, hx, rowY(p.y), lw - cut, 8 * dp);
      }
      if (t >= p.t1 && (i === S.passes.length - 1 || t < S.passes[i + 1].t0)) {
        head = p.dir === 1 ? S.xR + dp * 2 : parked;
        // After the last pass the carriage returns home during the form feed.
        if (i === S.passes.length - 1 && p.dir === 1)
          head = lerp(S.xR + dp * 2, parked, ease.inOutCubic(seg(t, p.t1 + 0.1, p.t1 + 0.85)));
      }
    });
    ctx.restore();
    // The paper falls into darkness at the top.
    const fade = ctx.createLinearGradient(0, 0, 0, S.pl * 0.7);
    fade.addColorStop(0, rgba(theme.bg, 0.92));
    fade.addColorStop(1, rgba(theme.bg, 0));
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, S.pl * 0.7);

    // The ribbon runs across the print line, just under the fresh dots.
    ctx.fillStyle = rgba("#000000", 0.6);
    ctx.fillRect(S.px - dp * 3, S.pl + dp * 0.5, S.pw + dp * 6, dp * 1.2);

    // Printer body: a slot the paper feeds from, a serrated tear bar, a moulded lip.
    const bodyY = S.pl + dp * 1.9;
    const slot = ctx.createLinearGradient(0, bodyY - dp * 2, 0, bodyY);
    slot.addColorStop(0, rgba("#000000", 0));
    slot.addColorStop(1, rgba("#000000", 0.7));
    ctx.fillStyle = slot;
    ctx.fillRect(S.px - dp * 2, bodyY - dp * 2, S.pw + dp * 4, dp * 2);
    const body = ctx.createLinearGradient(0, bodyY, 0, h);
    body.addColorStop(0, mix(theme.bg, theme.ink, 0.2));
    body.addColorStop(0.05, mix(theme.bg, theme.ink, 0.1));
    body.addColorStop(0.3, mix(theme.bg, theme.ink, 0.06));
    body.addColorStop(1, mix(theme.bg, "#000000", 0.45));
    ctx.fillStyle = body;
    ctx.fillRect(0, bodyY, w, h - bodyY);
    ctx.fillStyle = rgba(theme.ink, 0.1);
    ctx.fillRect(0, bodyY + dp * 3.2, w, Math.max(1, dp * 0.18));
    const bar = ctx.createLinearGradient(0, bodyY - dp * 0.5, 0, bodyY + dp * 1.3);
    bar.addColorStop(0, mix(theme.bg, theme.ink, 0.62));
    bar.addColorStop(0.5, mix(theme.bg, theme.ink, 0.34));
    bar.addColorStop(1, mix(theme.bg, theme.ink, 0.18));
    ctx.fillStyle = bar;
    ctx.beginPath();
    const tooth = dp * 1.1;
    const bx0 = S.px - dp * 5;
    const bx1 = S.px + S.pw + dp * 5;
    ctx.moveTo(bx0, bodyY + dp * 0.5);
    for (let x = bx0; x < bx1; x += tooth) {
      ctx.lineTo(x + tooth / 2, bodyY - dp * 0.45);
      ctx.lineTo(x + tooth, bodyY + dp * 0.5);
    }
    ctx.lineTo(bx1, bodyY + dp * 1.3);
    ctx.lineTo(bx0, bodyY + dp * 1.3);
    ctx.closePath();
    ctx.fill();
    // Control panel: ON LINE lamp, two keys, a badge (or the brand's logo).
    const panelY = bodyY + dp * 7.5;
    const small = dp * 0.42;
    const label = (text: string, x: number, y: number) =>
      dots57(text, (dx, dy) =>
        ctx.fillRect(x + dx * small, y + dy * small, small * 0.8, small * 0.8),
      );
    const lampX = S.px + S.pw - dp * 30;
    const lamp = ctx.createRadialGradient(lampX, panelY, 0, lampX, panelY, dp * 5);
    lamp.addColorStop(0, rgba(theme.accent2, 0.85));
    lamp.addColorStop(0.2, rgba(theme.accent2, 0.4));
    lamp.addColorStop(1, rgba(theme.accent2, 0));
    ctx.fillStyle = lamp;
    ctx.fillRect(lampX - dp * 5, panelY - dp * 5, dp * 10, dp * 10);
    ctx.fillStyle = mix(theme.accent2, theme.ink, 0.65);
    ctx.beginPath();
    ctx.arc(lampX, panelY, dp * 0.75, 0, TAU);
    ctx.fill();
    ctx.fillStyle = mix(theme.bg, theme.ink, 0.42);
    label("ON LINE", lampX + dp * 2, panelY - small * 3.5);
    for (let i = 0; i < 2; i++) {
      const kx = S.px + S.pw - dp * (6.5 - i * 3.4);
      const key = ctx.createLinearGradient(0, panelY - dp, 0, panelY + dp * 1.2);
      key.addColorStop(0, mix(theme.bg, theme.ink, 0.3));
      key.addColorStop(1, mix(theme.bg, "#000000", 0.3));
      ctx.fillStyle = key;
      ctx.beginPath();
      ctx.roundRect(kx - dp * 1.3, panelY - dp, dp * 2.6, dp * 2, dp * 0.35);
      ctx.fill();
    }
    const mark = tintedLogo(theme, mix(theme.bg, theme.ink, 0.45), dp * 8, dp * 3.2);
    if (mark) ctx.drawImage(mark as CanvasImageSource, S.px + dp * 2, panelY - dp * 1.6);
    else {
      ctx.fillStyle = mix(theme.bg, theme.ink, 0.42);
      label("DMP-9", S.px + dp * 2, panelY - small * 3.5);
    }

    // The print head carriage, riding the rail at the print line.
    const hw = dp * 12;
    const hh = dp * 14;
    const hy = S.pl - dp * 9;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = dp * 3.5;
    ctx.shadowOffsetX = dp * 0.6;
    ctx.shadowOffsetY = dp * 1;
    const metal = ctx.createLinearGradient(head - hw / 2, 0, head + hw / 2, 0);
    metal.addColorStop(0, mix(theme.bg, theme.ink, 0.1));
    metal.addColorStop(0.3, mix(theme.bg, theme.ink, 0.36));
    metal.addColorStop(0.55, mix(theme.bg, theme.ink, 0.22));
    metal.addColorStop(1, mix(theme.bg, "#000000", 0.3));
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.roundRect(head - hw / 2, hy, hw, hh, dp * 1.4);
    ctx.fill();
    ctx.restore();
    // Heat-sink fins across the top of the head.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = rgba("#000000", 0.45);
      ctx.fillRect(head - hw / 2 + dp * 1.4, hy + dp * (1.3 + i * 1.3), hw - dp * 2.8, dp * 0.55);
      ctx.fillStyle = rgba(theme.ink, 0.12);
      ctx.fillRect(
        head - hw / 2 + dp * 1.4,
        hy + dp * (1.85 + i * 1.3),
        hw - dp * 2.8,
        Math.max(1, dp * 0.2),
      );
    }
    // The pin nose, pressed against the ribbon.
    ctx.fillStyle = mix(theme.bg, "#000000", 0.55);
    ctx.beginPath();
    ctx.roundRect(head - dp * 1.4, S.pl - dp * 3.2, dp * 2.8, dp * 4.6, dp * 0.4);
    ctx.fill();
    ctx.fillStyle = rgba(theme.ink, 0.25);
    ctx.fillRect(head - dp * 0.15, S.pl - dp * 2.8, Math.max(1, dp * 0.3), dp * 3.6);

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
    void u;
  },
};
