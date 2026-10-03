import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  LOOP,
  SANS,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkStock, inkOn, loopT, rounded, setType, widthOf, type Box } from "./_s8-helpers";

/** Train A runs left to right on the first line; train B mirrors it half a loop later. */
function trainA(tau: number): number {
  if (tau < 1.4) return lerp(-0.14, 0.5, ease.outCubic(tau / 1.4));
  if (tau < 2.7) return 0.5;
  if (tau < 4.1) return lerp(0.5, 1.14, ease.inCubic((tau - 2.7) / 1.4));
  return 1.14;
}
const trainB = (t: number) => 1 - trainA((t + LOOP / 2) % LOOP);
const dwellA = (t: number) => t >= 1.4 && t < 2.7;
const dwellB = (t: number) => {
  const tau = (t + LOOP / 2) % LOOP;
  return tau >= 1.4 && tau < 2.7;
};
/** Which way the sign points: 1 = train A's direction, 0 = train B's. Flips over 0.5 s. */
const facing = (t: number) =>
  ease.inOutCubic(seg(t, 0.85, 1.35)) * (1 - ease.inOutCubic(seg(t, 3.35, 3.85)));

interface Layout {
  sign: Box;
  /** Strip map runs top to bottom (portrait). */
  vertical: boolean;
  /** Sign sets the name under the bullets (square and portrait). */
  stacked: boolean;
  /** Line geometry: start and end points of each line. */
  lines: { a: [number, number]; b: [number, number] }[];
  lw: number;
}

function layout(w: number, h: number): Layout {
  const { portrait, square, u } = frameOf(w, h);
  const mx = w * (portrait ? 0.07 : 0.085);
  if (portrait) {
    const sign = { x: mx, y: h * 0.09, w: w - mx * 2, h: h * 0.33 };
    const x1 = w * 0.3;
    const gap = u * 0.095;
    return {
      sign,
      vertical: true,
      stacked: true,
      lines: [
        { a: [x1, h * 0.5], b: [x1, h * 0.96] },
        { a: [x1 + gap, h * 0.5], b: [x1 + gap, h * 0.96] },
      ],
      lw: u * 0.03,
    };
  }
  const sign = {
    x: mx,
    y: h * (square ? 0.08 : 0.11),
    w: w - mx * 2,
    h: h * (square ? 0.46 : 0.42),
  };
  const y1 = h * (square ? 0.71 : 0.68);
  const gap = u * 0.1;
  return {
    sign,
    vertical: false,
    stacked: square,
    lines: [
      { a: [mx * 0.4, y1], b: [w - mx * 0.4, y1] },
      { a: [mx * 0.4, y1 + gap], b: [w - mx * 0.4, y1 + gap] },
    ],
    lw: u * 0.03,
  };
}

const along = (L: Layout, line: number, s: number): [number, number] => {
  const { a, b } = L.lines[line];
  return [lerp(a[0], b[0], s), lerp(a[1], b[1], s)];
};

/** A line bullet: a disc in the line colour with its letter. */
function bullet(
  c: Ctx2D,
  theme: Theme,
  x: number,
  y: number,
  r: number,
  fill: string,
  letter: string,
) {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  setType(c, 700, r * 1.2, "Inter", { fallback: SANS });
  c.fillStyle = inkOn(fill, theme);
  c.textAlign = "center";
  c.textBaseline = "alphabetic";
  const cap = c.measureText("H").actualBoundingBoxAscent || r * 0.85;
  c.fillText(letter, x, y + cap / 2);
  c.textAlign = "left";
}

/** A heavy wayfinding arrow pointing right, centred on (x, y), rotated by a. */
function arrow(c: Ctx2D, x: number, y: number, size: number, a: number, color: string) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.fillStyle = color;
  const s = size / 2;
  c.beginPath();
  c.moveTo(-s, -s * 0.2);
  c.lineTo(s * 0.12, -s * 0.2);
  c.lineTo(s * 0.12, -s * 0.62);
  c.lineTo(s, 0);
  c.lineTo(s * 0.12, s * 0.62);
  c.lineTo(s * 0.12, s * 0.2);
  c.lineTo(-s, s * 0.2);
  c.closePath();
  c.fill();
  c.restore();
}

function panel(theme: Theme, sign: Box, u: number) {
  return (c: Ctx2D) => {
    c.save();
    c.shadowColor = rgba("#000000", 0.55);
    c.shadowBlur = u * 0.04;
    c.shadowOffsetY = u * 0.012;
    rounded(c, sign.x, sign.y, sign.w, sign.h, u * 0.012);
    c.fillStyle = mix(theme.bg, "#000000", 0.35);
    c.fill();
    c.restore();
    c.save();
    rounded(c, sign.x, sign.y, sign.w, sign.h, u * 0.012);
    c.clip();
    const g = c.createLinearGradient(0, sign.y, 0, sign.y + sign.h);
    g.addColorStop(0, mix(theme.bg, theme.ink, 0.06));
    g.addColorStop(1, mix(theme.bg, "#000000", 0.3));
    c.fillStyle = g;
    c.fillRect(sign.x, sign.y, sign.w, sign.h);
    // Porcelain enamel sheen along the top edge.
    c.fillStyle = rgba(theme.ink, 0.05);
    c.fillRect(sign.x, sign.y, sign.w, sign.h * 0.08);
    c.restore();
    // The white band across the top of every sign.
    const pad = sign.h * 0.09;
    c.fillStyle = rgba(theme.ink, 0.92);
    c.fillRect(sign.x + pad, sign.y + pad * 0.75, sign.w - pad * 2, Math.max(1.5, u * 0.0045));
    // Mounting bolts.
    c.fillStyle = rgba(theme.ink, 0.16);
    for (const [bx, by] of [
      [sign.x + pad * 0.45, sign.y + pad * 0.45],
      [sign.x + sign.w - pad * 0.45, sign.y + pad * 0.45],
      [sign.x + pad * 0.45, sign.y + sign.h - pad * 0.45],
      [sign.x + sign.w - pad * 0.45, sign.y + sign.h - pad * 0.45],
    ]) {
      c.beginPath();
      c.arc(bx, by, u * 0.005, 0, TAU);
      c.fill();
    }
  };
}

export const style: MotionStyle = {
  id: "transit-sign",
  name: "Transit Signage",
  family: "Type & Editorial",
  tagline: "Subway wayfinding in enamel",
  look: "Subway wayfinding: a black enamel sign with a white rule, coloured line bullets and a heavy arrow above a two-line strip map.",
  move: "Trains glide in from opposite ends, decelerate into the interchange, dwell and leave; the sign flips its arrow and direction to the train at the platform.",
  rules: [
    "Signage grammar: black panel, white rule on top, bullets, arrow, name.",
    "Line colours are flat and exact; letters inside bullets are bold and centred.",
    "Trains decelerate into the station and accelerate out: never linear.",
    "The two lines run opposite ways, half a loop apart.",
    "The sign changes by flipping on its axis, like a prism sign.",
    "Strip-map names sit clear of the lines; the interchange is set bold.",
    "One grotesque family throughout (Inter as the Helvetica stand-in).",
  ],
  prompt: `R — References
• The 1970 NYCTA Graphics Standards Manual (Vignelli and Noorda): black signs, white band, coloured bullets, Helvetica.
• Strip maps over subway car doors: two parallel lines, stations as ticks, interchanges as white capsules.

I — Idea
A platform sign and its strip map, 5 seconds, looping seamlessly:
• Beginning (0–1.4 s): a train on the {{accent}} line glides in from the left and decelerates into "{{name}} Sq"; the sign flips its arrow and reads Downtown & Brooklyn.
• Middle (1.4–3.9 s): it dwells 1.3 s, its bullet pulsing, then accelerates away; the sign flips back as a {{accent2}} train approaches from the right.
• End (3.9–5 s): the second train dwells at the interchange, exactly as the loop began.

S — Style
Looks: {{bg}} ground; a black enamel sign with a white rule, bolts, an {{ink}} arrow, two bullets ({{accent}}, {{accent2}}), the station name in Inter (or {{font}}) bold; below, a strip map of two thick lines with station ticks, small names and a white interchange capsule.
Moves: arrivals ease out over 1.4 s, departures ease in; dwell 1.3 s; the sign flips on a horizontal axis over 0.5 s; bullet halos pulse while a train dwells.
Rules:
1. Signage grammar, exactly: panel, rule, bullets, arrow, name.
2. Flat, exact line colours.
3. Ease trains in and out.
4. Opposite directions, half a loop apart.
5. Prism flips for sign changes.
6. Grain and a soft light so the panel reads as enamel.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; bullet letters are centred; station names never touch a line; trains stop exactly at the interchange; the sign text is never clipped mid-flip. Fix what fails and render again until every check passes.`,
  ref: "https://standardsmanual.com/products/nycta-graphics-standards-manual",
  theme: {
    bg: "#0c0d0e",
    ink: "#f5f5f2",
    accent: "#ff6319",
    accent2: "#2f8cff",
    font: "Inter",
  },
  fonts: ["Inter:wght@400..800"],
  tags: [
    "transit",
    "subway",
    "metro",
    "signage",
    "wayfinding",
    "map",
    "helvetica",
    "arrow",
    "train",
    "lines",
    "swiss",
  ],
  word: "Motion",
  render(ctx, t, theme, w, h) {
    t = loopT(t);
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(darkStock(theme, "transit", w, h, 29) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.5, h * 0.05, Math.max(w, h) * 0.8, theme.ink, 0.08);

    const word = wordFor(theme.name, "Motion", 12);
    const station = `${word} Sq`;
    const L = layout(w, h);
    const S = L.sign;
    const family = theme.font;
    ctx.drawImage(
      bake(`transit-panel:${theme.bg}${theme.ink}`, w, h, panel(theme, S, u)) as CanvasImageSource,
      0,
      0,
    );

    // ── The sign.
    const f = facing(t);
    const vertical = L.vertical;
    const stacked = L.stacked;
    const pad = S.h * 0.09;
    const nameSize = stacked ? S.h * 0.2 : S.h * 0.3;
    setType(ctx, 700, nameSize, family, { fallback: SANS, tracking: -0.015 });
    let nameW = widthOf(ctx, station);
    const r = stacked ? S.h * 0.11 : S.h * 0.16;
    let x = S.x + pad * 1.6;
    const rowY = stacked ? S.y + S.h * 0.3 : S.y + S.h * 0.46;
    // Arrow: points the way of the train at the platform; turns 180° as the sign flips.
    const arrowSize = r * 2.3;
    const angle = lerp(Math.PI, 0, f);
    arrow(ctx, x + arrowSize / 2, rowY, arrowSize, angle, theme.ink);
    x += arrowSize + pad * 1.1;
    const pulseA = dwellA(t) ? (t - 1.4) / 1.3 : -1;
    const tauB = (t + LOOP / 2) % LOOP;
    const pulseB = dwellB(t) ? (tauB - 1.4) / 1.3 : -1;
    const bullets: [string, string, number][] = [
      [theme.accent, word.charAt(0).toUpperCase(), pulseA],
      [theme.accent2, "S", pulseB],
    ];
    for (const [col, letter, pulse] of bullets) {
      const bx = x + r;
      if (pulse >= 0) {
        for (const k of [0, 0.5]) {
          const p = (pulse * 2 + k) % 1;
          ctx.strokeStyle = rgba(col, 0.6 * (1 - p));
          ctx.lineWidth = Math.max(1, u * 0.004);
          ctx.beginPath();
          ctx.arc(bx, rowY, r * (1 + p * 0.7), 0, TAU);
          ctx.stroke();
        }
      }
      bullet(ctx, theme, bx, rowY, r, col, letter);
      x += r * 2 + pad * 0.5;
    }
    // Station name: beside the bullets on wide signs, under them on tall ones.
    setType(ctx, 700, nameSize, family, { fallback: SANS, tracking: -0.015 });
    const nameCap = ctx.measureText("H").actualBoundingBoxAscent || nameSize * 0.72;
    let nx = x + pad * 0.6;
    let ny = rowY + nameCap / 2;
    const room = stacked ? S.w - pad * 3.2 : S.x + S.w - pad * 1.6 - nx;
    let ns = nameSize;
    if (nameW > room) {
      ns = (nameSize * room) / nameW;
      setType(ctx, 700, ns, family, { fallback: SANS, tracking: -0.015 });
      nameW = widthOf(ctx, station);
    }
    if (stacked) {
      nx = S.x + pad * 1.6;
      ny = S.y + S.h * 0.66;
    }
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(station, nx, ny);
    // Direction line, flipping like a prism.
    let dirSize = stacked ? S.h * 0.095 : S.h * 0.13;
    const dirY = stacked ? S.y + S.h * 0.86 : S.y + S.h * 0.83;
    const texts = ["Uptown & Queens", "Downtown & Brooklyn"];
    setType(ctx, 500, dirSize, family, { fallback: SANS, tracking: 0.005 });
    const dirRoom = S.x + S.w - pad * 1.6 - nx - (theme.logo ? S.h * 0.4 : 0);
    const longestDir = Math.max(...texts.map((d) => widthOf(ctx, d)));
    if (longestDir > dirRoom) dirSize *= dirRoom / longestDir;
    const flipK = f < 0.5 ? 1 - f * 2 : f * 2 - 1;
    const shown = f < 0.5 ? texts[0] : texts[1];
    ctx.save();
    ctx.translate(0, dirY - dirSize * 0.35);
    ctx.scale(1, Math.max(0.001, flipK));
    setType(ctx, 500, dirSize, family, { fallback: SANS, tracking: 0.005 });
    ctx.fillStyle = rgba(theme.ink, 0.35 + 0.55 * flipK);
    ctx.fillText(shown, nx, dirSize * 0.35);
    ctx.restore();

    // ── Strip map.
    const lw = L.lw;
    const cols = [theme.accent, theme.accent2];
    for (let i = 0; i < 2; i++) {
      const { a, b } = L.lines[i];
      const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
      g.addColorStop(0, rgba(cols[i], 0));
      g.addColorStop(0.06, rgba(cols[i], 1));
      g.addColorStop(0.94, rgba(cols[i], 1));
      g.addColorStop(1, rgba(cols[i], 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = lw;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    const stops = ["Kerning Av", "Serif St", station, "Grid Pl", "Baseline Rd"];
    const labSize = Math.max(6, u * (vertical ? 0.034 : 0.03));
    stops.forEach((name, k) => {
      const s = 0.12 + k * 0.19;
      const inter = k === 2;
      const [x1, y1] = along(L, 0, s);
      const [x2, y2] = along(L, 1, s);
      if (inter) {
        // Interchange capsule spanning both lines.
        const cxp = (x1 + x2) / 2;
        const cyp = (y1 + y2) / 2;
        const len = Math.hypot(x2 - x1, y2 - y1) + lw * 1.6;
        const thick = lw * 1.6;
        ctx.save();
        ctx.translate(cxp, cyp);
        if (vertical) ctx.rotate(Math.PI / 2);
        rounded(ctx, -thick / 2, -len / 2, thick, len, thick / 2);
        ctx.fillStyle = mix(theme.bg, "#000000", 0.2);
        ctx.fill();
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = Math.max(1.5, lw * 0.28);
        ctx.stroke();
        ctx.restore();
      } else {
        // Station ticks on the outside of each line.
        ctx.fillStyle = theme.ink;
        const tk = lw * 0.75;
        if (vertical) {
          ctx.fillRect(x1 - lw / 2 - tk, y1 - lw * 0.18, tk, lw * 0.36);
          ctx.fillRect(x2 + lw / 2, y2 - lw * 0.18, tk, lw * 0.36);
        } else {
          ctx.fillRect(x1 - lw * 0.18, y1 - lw / 2 - tk, lw * 0.36, tk);
          ctx.fillRect(x2 - lw * 0.18, y2 + lw / 2, lw * 0.36, tk);
        }
      }
      setType(ctx, inter ? 700 : 500, labSize * (inter ? 1.18 : 1), family, { fallback: SANS });
      ctx.fillStyle = inter ? theme.ink : rgba(theme.ink, 0.72);
      const tw = widthOf(ctx, name);
      if (vertical) {
        ctx.fillText(name, x2 + lw * 1.9, y2 + labSize * 0.36);
      } else {
        const above = k % 2 === 1;
        const ly = above ? y1 - lw * 1.6 : y2 + lw * 1.6 + labSize * 0.8;
        ctx.fillText(name, x1 - tw / 2, ly);
      }
    });

    // Trains.
    const drawTrain = (
      line: number,
      s: number,
      dir: number,
      fill: string,
      letter: string,
      speed: number,
    ) => {
      if (s < -0.1 || s > 1.1) return;
      const [px, py] = along(L, line, s);
      const len = u * 0.14;
      const thick = lw * 1.8;
      ctx.save();
      ctx.translate(px, py);
      if (vertical) ctx.rotate(Math.PI / 2);
      if (dir < 0) ctx.scale(-1, 1);
      // Motion trail in the line colour.
      if (speed > 0.02) {
        const tr = ctx.createLinearGradient(-len / 2 - len * 1.4 * speed, 0, -len / 2, 0);
        tr.addColorStop(0, rgba(fill, 0));
        tr.addColorStop(1, rgba(mix(fill, theme.ink, 0.5), 0.55));
        ctx.fillStyle = tr;
        ctx.fillRect(-len / 2 - len * 1.4 * speed, -thick * 0.32, len * 1.4 * speed, thick * 0.64);
      }
      rounded(ctx, -len / 2, -thick / 2, len, thick, thick * 0.45);
      ctx.fillStyle = theme.ink;
      ctx.fill();
      ctx.fillStyle = rgba("#000000", 0.18);
      ctx.fillRect(-len / 2 + thick * 0.4, thick * 0.12, len - thick * 0.8, thick * 0.1);
      ctx.restore();
      // Bullet riding at the nose (kept upright).
      const nose = (len / 2 - thick * 0.55) * dir;
      bullet(
        ctx,
        theme,
        px + (vertical ? 0 : nose),
        py + (vertical ? nose : 0),
        thick * 0.36,
        fill,
        letter,
      );
    };
    const sA = trainA(t);
    const sB = trainB(t);
    const vA = Math.abs(trainA(t + 0.02) - trainA(Math.max(0, t - 0.02))) / 0.04;
    const vB = Math.abs(trainB(t + 0.02) - trainB(Math.max(0, t - 0.02))) / 0.04;
    drawTrain(0, sA, 1, theme.accent, word.charAt(0).toUpperCase(), clamp(vA * 1.2));
    drawTrain(1, sB, -1, theme.accent2, "S", clamp(vB * 1.2));

    // Brand mark on the sign's right edge.
    const mark = tintedLogo(theme, rgba(theme.ink, 0.85), S.h * 0.3, S.h * 0.3);
    if (mark)
      ctx.drawImage(
        mark as CanvasImageSource,
        S.x + S.w - pad * 1.6 - S.h * 0.3,
        S.y + S.h * 0.83 - S.h * 0.22,
      );

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.28);
  },
};
