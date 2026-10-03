import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkPaper, mottleTile, speckTile, tileOver, tintLayer } from "./_s1-helpers";

const MONO = '"Space Mono", "Courier New", monospace';
const COND = '"Anton", Impact, sans-serif';
/** Four stamps land, then the leaf turns. */
const LAND = [0.3, 0.9, 1.5, 2.1];
const TURN0 = 3.75;
const TURN1 = 4.85;

type Kind = 0 | 1 | 2 | 3;
type Spot = { x: number; y: number; a: number; w: number; h: number; round: boolean };

function spots(W: number, H: number): Spot[] {
  const m = Math.min(W, H);
  return [
    { x: 0.31 * W, y: 0.3 * H, a: -0.16, w: m * 0.46, h: m * 0.46, round: true },
    { x: 0.6 * W, y: 0.55 * H, a: 0.08, w: W * 0.66, h: W * 0.26, round: false },
    { x: 0.45 * W, y: 0.8 * H, a: -0.1, w: W * 0.74, h: W * 0.24, round: false },
    { x: 0.68 * W, y: 0.13 * H, a: 0.05, w: W * 0.54, h: m * 0.22, round: true },
  ];
}

function inkOf(theme: Theme, k: Kind) {
  return k === 0 ? theme.accent : k === 1 ? theme.accent2 : k === 2 ? theme.ink : theme.accent;
}

/** Draw one stamp's artwork (white on clear), centred in a w x h box. */
function artwork(c: Ctx2D, k: Kind, theme: Theme, w: number, h: number, word: string) {
  c.fillStyle = "#fff";
  c.strokeStyle = "#fff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  const cx = w / 2;
  const cy = h / 2;
  if (k === 0) {
    // Round seal: double ring, text round the band, a star (or the logo) in the middle.
    const r = Math.min(w, h) * 0.47;
    c.lineWidth = r * 0.05;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.stroke();
    c.lineWidth = r * 0.025;
    c.beginPath();
    c.arc(cx, cy, r * 0.9, 0, TAU);
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, r * 0.58, 0, TAU);
    c.stroke();
    const text = `${word.toUpperCase()} · HAND STAMPED · NO. 07 · `;
    const size = r * 0.17;
    c.font = font(700, size, "Inter");
    const chars = [...text];
    const total = chars.reduce((a, ch) => a + c.measureText(ch).width, 0);
    const scale = (TAU * r * 0.74) / total;
    let ang = -Math.PI / 2;
    for (const ch of chars) {
      const cw = c.measureText(ch).width * scale;
      ang += cw / (2 * r * 0.74);
      c.save();
      c.translate(cx + Math.cos(ang) * r * 0.74, cy + Math.sin(ang) * r * 0.74);
      c.rotate(ang + Math.PI / 2);
      c.fillText(ch, 0, 0);
      c.restore();
      ang += cw / (2 * r * 0.74);
    }
    const mark = tintedLogo(theme, "#ffffff", r * 0.7, r * 0.7);
    if (mark) c.drawImage(mark as CanvasImageSource, cx - r * 0.35, cy - r * 0.35);
    else {
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const rr = i % 2 ? r * 0.18 : r * 0.42;
        c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      c.closePath();
      c.fill();
    }
  } else if (k === 1) {
    // Date stamp: rounded frame, RECEIVED, the date, a number.
    const pad = h * 0.08;
    c.lineWidth = h * 0.045;
    c.beginPath();
    c.roundRect(pad, pad, w - pad * 2, h - pad * 2, h * 0.14);
    c.stroke();
    c.font = font(700, h * 0.16, "Inter");
    if ("letterSpacing" in c)
      (c as CanvasRenderingContext2D).letterSpacing = `${(h * 0.05).toFixed(1)}px`;
    c.fillText("RECEIVED", cx, h * 0.27);
    if ("letterSpacing" in c) (c as CanvasRenderingContext2D).letterSpacing = "0px";
    c.font = font(700, h * 0.3, "Space Mono", MONO);
    c.fillText("24 SEP 2026", cx, h * 0.55);
    c.font = font(700, h * 0.12, "Space Mono", MONO);
    c.fillText("No. 0417", cx, h * 0.79);
  } else if (k === 2) {
    // The word in a double-ruled box.
    const pad = h * 0.07;
    c.lineWidth = h * 0.05;
    c.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
    c.lineWidth = h * 0.02;
    c.strokeRect(pad * 2.4, pad * 2.4, w - pad * 4.8, h - pad * 4.8);
    const label = word.toUpperCase();
    c.font = font(400, h * 0.5, "Anton", COND);
    const tw = c.measureText(label).width;
    const size = Math.min(h * 0.5, (h * 0.5 * (w - pad * 7)) / Math.max(1, tw));
    c.font = font(400, size, "Anton", COND);
    if ("letterSpacing" in c)
      (c as CanvasRenderingContext2D).letterSpacing = `${(size * 0.06).toFixed(1)}px`;
    c.fillText(label, cx + size * 0.03, cy + size * 0.04);
    if ("letterSpacing" in c) (c as CanvasRenderingContext2D).letterSpacing = "0px";
  } else {
    // Postmark: a ring with text and five wavy cancel lines.
    const r = h * 0.44;
    const ox = r * 1.05;
    c.lineWidth = r * 0.07;
    c.beginPath();
    c.arc(ox, cy, r, 0, TAU);
    c.stroke();
    c.font = font(700, r * 0.26, "Inter");
    c.fillText("STUDIO", ox, cy - r * 0.34);
    c.font = font(700, r * 0.34, "Space Mono", MONO);
    c.fillText("24·09", ox, cy + r * 0.05);
    c.font = font(700, r * 0.22, "Inter");
    c.fillText("AM", ox, cy + r * 0.42);
    c.lineWidth = r * 0.075;
    for (let i = 0; i < 5; i++) {
      const y = cy + (i - 2) * r * 0.36;
      c.beginPath();
      for (let x = ox + r * 1.25; x < w - r * 0.1; x += r * 0.08) {
        const yy = y + Math.sin((x / r) * 2.2) * r * 0.1;
        if (x === ox + r * 1.25) c.moveTo(x, yy);
        else c.lineTo(x, yy);
      }
      c.stroke();
    }
  }
}

/** A finished impression: artwork, uneven pressure, ink misses, tinted. */
function impression(theme: Theme, k: Kind, word: string) {
  return (c: Ctx2D, w: number, h: number) => {
    artwork(c, k, theme, w, h, word);
    // Rocked stamp: one side printed lighter.
    const g = c.createLinearGradient(0, 0, w, h * 0.4);
    const r = rng(90 + k);
    const light0 = r() < 0.5;
    g.addColorStop(0, `rgba(0,0,0,${light0 ? 0.45 : 0})`);
    g.addColorStop(1, `rgba(0,0,0,${light0 ? 0 : 0.4})`);
    c.save();
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.restore();
    const s = Math.max(0.5, Math.min(w, h) / 320);
    tileOver(c, w, h, mottleTile(20 + k, 6, 1.6), { alpha: 0.35, scale: s * 1.4 });
    tileOver(c, w, h, speckTile(300 + k, 1600, 1.8, 1.4), { alpha: 0.8, scale: s });
    tintLayer(c, w, h, inkOf(theme, k));
  };
}

/** Page ground: black journal paper with a dot grid. */
function pageStock(theme: Theme, seed: number) {
  return (c: Ctx2D, w: number, h: number) => {
    darkPaper(theme, seed, { tone: 0.075, fibres: 0.8, mottle: 0.7 })(c, w, h);
    const m = Math.min(w, h);
    const step = m * 0.055;
    c.fillStyle = rgba(theme.ink, 0.09);
    for (let y = step; y < h - step * 0.5; y += step)
      for (let x = step; x < w - step * 0.5; x += step) {
        c.beginPath();
        c.arc(x, y, Math.max(0.6, m * 0.0028), 0, TAU);
        c.fill();
      }
  };
}

/** The back of the leaf (what the left page shows): its own older, faded stamps. */
function backStock(theme: Theme, word: string) {
  return (c: Ctx2D, w: number, h: number) => {
    pageStock(theme, 12)(c, w, h);
    const m = Math.min(w, h);
    const place = (
      k: Kind,
      x: number,
      y: number,
      a: number,
      bw: number,
      bh: number,
      alpha: number,
    ) => {
      const art = makeArt(theme, k, word, bw, bh);
      c.save();
      c.translate(x, y);
      c.rotate(a);
      c.globalAlpha = alpha;
      c.drawImage(art as CanvasImageSource, -bw / 2, -bh / 2);
      c.restore();
    };
    place(1, w * 0.46, h * 0.3, -0.12, w * 0.64, w * 0.25, 0.55);
    place(3, w * 0.52, h * 0.64, 0.14, w * 0.52, m * 0.27, 0.45);
    // Page number.
    c.fillStyle = rgba(theme.ink, 0.35);
    c.font = font(700, m * 0.03, "Space Mono", MONO);
    c.textAlign = "left";
    c.fillText("14", w * 0.07, h * 0.95);
  };
}

function makeArt(theme: Theme, k: Kind, word: string, w: number, h: number) {
  return bake(
    `rs-art:${k}|${word}|${theme.accent}${theme.accent2}${theme.ink}|${theme.logo ? theme.logo.length : 0}`,
    w,
    h,
    impression(theme, k, word),
  );
}

/** The stamp tool seen from above: a wooden mount, a turned knob, a soft shadow. */
function tool(ctx: Ctx2D, theme: Theme, s: Spot, lift: number, u: number, w: number, h: number) {
  const scale = 1 + lift * 0.5;
  const wood = mix(mix(theme.bg, theme.accent, 0.3), theme.ink, 0.16);
  const mw = s.w * 1.08;
  const mh = s.h * 1.08;
  // Brought in by hand from above the frame's top right.
  const ox = lift * lift * w * 0.62;
  const oy = -lift * lift * h * 0.8;
  // Shadow: tight at the bite, wide and faint as it rises.
  ctx.save();
  ctx.translate(
    s.x + ox * 0.6 + u * 0.012 * (1 + lift * 3),
    s.y + oy * 0.6 + u * 0.02 * (1 + lift * 3),
  );
  ctx.rotate(s.a);
  ctx.filter = `blur(${(u * (0.008 + lift * 0.05)).toFixed(1)}px)`;
  ctx.fillStyle = `rgba(0,0,0,${(0.65 * Math.pow(1 - lift, 0.7)).toFixed(3)})`;
  ctx.beginPath();
  if (s.round) ctx.ellipse(0, 0, mw / 2, mh / 2, 0, 0, TAU);
  else ctx.roundRect(-mw / 2, -mh / 2, mw, mh, Math.min(mw, mh) * 0.08);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(s.x + ox, s.y + oy);
  ctx.rotate(s.a);
  ctx.scale(scale, scale);
  // Mount: a lit top face over a darker bevel.
  ctx.fillStyle = mix(wood, "#000000", 0.45);
  ctx.beginPath();
  if (s.round) ctx.ellipse(0, mh * 0.03, mw / 2, mh / 2, 0, 0, TAU);
  else ctx.roundRect(-mw / 2, -mh / 2 + mh * 0.04, mw, mh, Math.min(mw, mh) * 0.08);
  ctx.fill();
  const g = ctx.createLinearGradient(-mw / 2, -mh / 2, mw / 2, mh / 2);
  g.addColorStop(0, mix(wood, theme.ink, 0.22));
  g.addColorStop(1, mix(wood, "#000000", 0.25));
  ctx.fillStyle = g;
  ctx.beginPath();
  if (s.round) ctx.ellipse(0, 0, (mw / 2) * 0.97, (mh / 2) * 0.97, 0, 0, TAU);
  else ctx.roundRect(-mw / 2, -mh / 2, mw, mh * 0.97, Math.min(mw, mh) * 0.08);
  ctx.fill();
  // Wood grain on the top face.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba("#000000", 0.16);
  ctx.lineWidth = Math.max(0.6, u * 0.0015);
  for (let i = -7; i <= 7; i++) {
    const y = (i / 7) * mh * 0.5;
    ctx.beginPath();
    ctx.moveTo(-mw / 2, y);
    ctx.bezierCurveTo(-mw / 6, y + mh * 0.05, mw / 6, y - mh * 0.05, mw / 2, y + mh * 0.01);
    ctx.stroke();
  }
  ctx.restore();
  // Turned knob.
  const kr = Math.min(mw, mh) * 0.26;
  const kg = ctx.createRadialGradient(-kr * 0.35, -kr * 0.35, kr * 0.1, 0, 0, kr);
  kg.addColorStop(0, mix(wood, theme.ink, 0.5));
  kg.addColorStop(0.6, wood);
  kg.addColorStop(1, mix(wood, "#000000", 0.4));
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = kr * 0.5;
  ctx.shadowOffsetX = kr * 0.1;
  ctx.shadowOffsetY = kr * 0.18;
  ctx.fillStyle = kg;
  ctx.beginPath();
  ctx.arc(0, 0, kr, 0, TAU);
  ctx.fill();
  ctx.restore();
}

type Layout = { mode: "spread" | "single"; spine: number; top: number; W: number; H: number };

function layoutOf(w: number, h: number): Layout {
  const { portrait } = frameOf(w, h);
  if (portrait) {
    const W = w * 0.84;
    const H = Math.min(h * 0.8, W * 1.5);
    return { mode: "single", spine: (w - W) / 2, top: (h - H) / 2, W, H };
  }
  const H = h * 0.8;
  const W = Math.min(w * 0.43, H * 0.78);
  return { mode: "spread", spine: w / 2, top: (h - H) / 2, W, H };
}

export const style: MotionStyle = {
  id: "rubber-stamp",
  name: "Rubber Stamp Journal",
  family: "Print & Craft",
  tagline: "Seals and postmarks, rocked in ink",
  look: "A black-paper journal: a seal, a date stamp, a word box and a postmark in red, blue and white ink, uneven and rocked.",
  move: "Each stamp drops from above, bites with a jolt and lifts away to reveal its mark; then the leaf turns over.",
  rules: [
    "Every mark is uneven: a lighter rocked side, mottle and speckled misses.",
    "The tool is seen: its shadow closes in, it bites, it lifts away.",
    "Stamps sit at small angles and overlap a little, never on a grid.",
    "Three inks only: red, blue and white pigment on black paper.",
    "One jolt per landing, nothing else shakes.",
    "The page turns with a curl, showing its back as it lands.",
    "Hold the full page at least a second before the turn.",
  ],
  prompt: `R — References
• Rubber stamps and postmarks in travel journals (search: rubber stamp ink texture, passport stamps, date stamp received).
• Pigment ink on black paper: white, red and blue stamp pads.

I — Idea
Stamps land on a journal page, 5 seconds, looping seamlessly:
• Beginning (0–2.2 s): on the right page of a black journal, a round seal with "{{name}}" on its band, a RECEIVED date stamp, a boxed "{{name}}" and a postmark land one by one; each tool's shadow closes in, it bites, lifts away.
• Middle (2.2–3.75 s): the page holds, each mark uneven: rocked light on one side, mottled, speckled.
• End (3.75–5 s): the leaf turns over to the left with a curl, showing its back, and a fresh page lies ready: the opening frame.

S — Style
Looks: {{bg}} black journal paper with a dot grid; pigment inks {{accent}}, {{accent2}} and {{ink}}; a wooden stamp mount with a turned knob seen from above; soft shadows; grain.
Moves: each stamp takes 0.3 s to come down (shadow tightening), 0.04 s to bite (a 1-2 px jolt), 0.3 s to lift; landings 0.6 s apart; the page turn eases in-out over 1.1 s with the outer edge lagging.
Rules:
1. Uneven ink on every mark.
2. Show the tool and its shadow.
3. Small angles and overlaps.
4. Three inks on black.
5. One jolt per landing.
6. A curled page turn.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; every stamp's text is readable at full size; the ink is visibly uneven; the page turn shows the back of the leaf; the left page after the turn matches the left page at the start. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Rubber_stamp",
  theme: {
    bg: "#131210",
    ink: "#efe8dc",
    accent: "#e2463a",
    accent2: "#4b7fd6",
    font: "Anton",
  },
  fonts: ["Anton", "Space Mono:wght@700", "Inter:wght@700"],
  tags: [
    "stamp",
    "rubber stamp",
    "postmark",
    "passport",
    "journal",
    "ink",
    "seal",
    "date",
    "print",
    "travel",
    "office",
  ],
  word: "Approved",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `rs-desk:${theme.bg}${theme.ink}`,
        w,
        h,
        darkPaper(theme, 8, { fibres: 0.2, mottle: 1.2 }),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.45, h * 0.35, Math.max(w, h) * 0.8, mix(theme.ink, theme.accent, 0.2), 0.1);

    const L = layoutOf(w, h);
    const word = wordFor(theme.name, "Approved", 12);
    const { W, H } = L;
    const rightX = L.spine;
    const leftX = L.spine - W;
    const S = spots(W, H);
    const arts = S.map((s, k) => makeArt(theme, k as Kind, word, s.w, s.h));
    const front = bake(`rs-page:${theme.bg}${theme.ink}`, W, H, pageStock(theme, 31));
    const back = bake(
      `rs-back:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}|${word}`,
      W,
      H,
      backStock(theme, word),
    );
    // The stamped leaf, finished (used for the turn).
    const leaf = bake(
      `rs-leaf:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}|${word}|${theme.logo ? theme.logo.length : 0}`,
      W,
      H,
      (c) => {
        c.drawImage(front as CanvasImageSource, 0, 0);
        S.forEach((s, k) => {
          c.save();
          c.translate(s.x, s.y);
          c.rotate(s.a);
          c.globalAlpha = 0.94;
          c.drawImage(arts[k] as CanvasImageSource, -s.w / 2, -s.h / 2);
          c.restore();
        });
      },
    );

    // Jolt on each landing.
    let jx = 0;
    let jy = 0;
    for (let k = 0; k < 4; k++) {
      const d = t - LAND[k];
      if (d >= 0 && d < 0.1) {
        const a = (1 - d / 0.1) * u * 0.003;
        jx += (hash(k, 3) - 0.5) * a * 2;
        jy += a;
      }
    }
    ctx.save();
    ctx.translate(jx, jy);

    // The book: page block edges, left page, right page (fresh), gutter.
    const edge = Math.max(2, u * 0.006);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = u * 0.05;
    ctx.shadowOffsetY = u * 0.015;
    ctx.fillStyle = mix(theme.bg, theme.ink, 0.12);
    ctx.fillRect(leftX - edge, L.top - edge * 0.3, W * 2 + edge * 2, H + edge * 1.3);
    ctx.restore();
    // Stacked page edges on the outer sides.
    ctx.strokeStyle = rgba(theme.ink, 0.12);
    ctx.lineWidth = Math.max(0.5, u * 0.001);
    for (let i = 1; i <= 3; i++) {
      const o = (edge * i) / 3;
      ctx.beginPath();
      if (L.mode === "spread") {
        ctx.moveTo(leftX - o, L.top + o * 0.4);
        ctx.lineTo(leftX - o, L.top + H + o * 0.4);
      }
      ctx.moveTo(rightX + W + o, L.top + o * 0.4);
      ctx.lineTo(rightX + W + o, L.top + H + o * 0.4);
      ctx.stroke();
    }
    ctx.drawImage(back as CanvasImageSource, leftX, L.top);
    ctx.drawImage(front as CanvasImageSource, rightX, L.top);

    const turning = t >= TURN0;
    if (!turning) {
      // Marks already down, the tool of the one landing now.
      S.forEach((s, k) => {
        const land = LAND[k];
        if (t < land) return;
        const since = t - land;
        const settle = since < 0.12 ? 1 + 0.02 * (1 - since / 0.12) : 1;
        ctx.save();
        ctx.translate(rightX + s.x, L.top + s.y);
        ctx.rotate(s.a);
        ctx.scale(settle, settle);
        ctx.globalAlpha = 0.94;
        ctx.drawImage(arts[k] as CanvasImageSource, -s.w / 2, -s.h / 2);
        ctx.restore();
      });
      S.forEach((s, k) => {
        const land = LAND[k];
        const down = seg(t, land - 0.28, land);
        const up = seg(t, land + 0.05, land + 0.33);
        if (down <= 0 || up >= 1) return;
        const lift = t < land ? 1 - ease.inCubic(down) : ease.outCubic(up);
        tool(ctx, theme, { ...s, x: rightX + s.x, y: L.top + s.y }, lift, u, w, h);
      });
    } else {
      // The leaf turns over the spine; the outer edge lags so the paper curls.
      const p = ease.inOutCubic(seg(t, TURN0, TURN1));
      const theta = p * Math.PI;
      const strips = 22;
      const dStep = W / strips;
      const D = W * 3.2;
      let x = 0;
      let z = 0;
      const pts: { x: number; z: number; phi: number }[] = [{ x: 0, z: 0, phi: theta }];
      for (let s = 0; s < strips; s++) {
        const f = (s + 0.5) / strips;
        const phi = theta - Math.sin(theta) * 0.55 * f * f;
        x += Math.cos(phi) * dStep;
        z += Math.sin(phi) * dStep;
        pts.push({ x, z, phi });
      }
      // Shadow of the lifted leaf on the pages below.
      const lean = Math.sin(theta);
      ctx.save();
      const sg = ctx.createLinearGradient(L.spine, 0, L.spine + (theta < Math.PI / 2 ? W : -W), 0);
      sg.addColorStop(0, `rgba(0,0,0,${(0.55 * lean).toFixed(3)})`);
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      if (theta < Math.PI / 2) ctx.fillRect(L.spine, L.top, W, H);
      else ctx.fillRect(leftX, L.top, W, H);
      ctx.restore();
      for (let s = 0; s < strips; s++) {
        const a = pts[s];
        const b = pts[s + 1];
        const fa = D / (D - a.z);
        const fb = D / (D - b.z);
        const xa = L.spine + a.x * fa;
        const xb = L.spine + b.x * fb;
        const cy = L.top + H / 2;
        const ha = H * fa;
        const facing = Math.cos(b.phi);
        const frontSide = xb >= xa;
        const src = frontSide ? leaf : back;
        const sx = frontSide ? s * dStep : W - (s + 1) * dStep;
        const width = xb - xa;
        if (Math.abs(width) < 0.05) continue;
        ctx.save();
        // Affine map of the strip: source column -> screen quad (left edge height ha).
        ctx.beginPath();
        ctx.moveTo(xa, cy - ha / 2);
        ctx.lineTo(xb, cy - (H * fb) / 2);
        ctx.lineTo(xb, cy + (H * fb) / 2);
        ctx.lineTo(xa, cy + ha / 2);
        ctx.closePath();
        ctx.clip();
        const hs = (H * (fa + fb)) / 2;
        if (frontSide) {
          ctx.setTransform(width / dStep, 0, 0, hs / H, xa - (sx * width) / dStep, cy - hs / 2);
        } else {
          // The back runs the other way along the strip.
          ctx.setTransform(
            -width / dStep,
            0,
            0,
            hs / H,
            xa + ((sx + dStep) * width) / dStep,
            cy - hs / 2,
          );
        }
        ctx.drawImage(src as CanvasImageSource, sx - 1, 0, dStep + 2, H, sx - 1, 0, dStep + 2, H);
        ctx.restore();
        // Light across the curl.
        const shade = frontSide ? 0.25 * (1 - Math.abs(facing)) : 0.35 * (1 - Math.abs(facing));
        ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(xa, cy - ha / 2);
        ctx.lineTo(xb, cy - (H * fb) / 2);
        ctx.lineTo(xb, cy + (H * fb) / 2);
        ctx.lineTo(xa, cy + ha / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Gutter shadow down the spine.
    if (L.mode === "spread") {
      const gg = ctx.createLinearGradient(L.spine - W * 0.08, 0, L.spine + W * 0.08, 0);
      gg.addColorStop(0, "rgba(0,0,0,0)");
      gg.addColorStop(0.5, "rgba(0,0,0,0.45)");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(L.spine - W * 0.08, L.top, W * 0.16, H);
    } else {
      const gg = ctx.createLinearGradient(L.spine, 0, L.spine + W * 0.08, 0);
      gg.addColorStop(0, "rgba(0,0,0,0.45)");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(L.spine, L.top, W * 0.08, H);
    }
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
