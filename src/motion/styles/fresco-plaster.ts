import { adjust, mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  noise3,
  rng,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import {
  fitFont,
  mottle,
  noiseTile,
  ribbon,
  speckleTile,
  tileFill,
  tracePts,
  type Pt,
} from "./_s2-helpers";

/**
 * A Pompeian black wall: red bands with a Vitruvian wave scroll, dolphins
 * swimming through the painted sea. Cracks, losses, lime bloom and patina sit
 * over everything, so the moving paint lives inside the old plaster.
 */
const CAPS = '"Cinzel", "Trajan Pro", Georgia, serif';

function palette(theme: Theme) {
  return {
    red: theme.accent,
    redDark: adjust(theme.accent, -0.12, 0.9),
    blue: theme.accent2,
    blueDark: mix(theme.accent2, theme.bg, 0.45),
    ochre: adjust(theme.accent, 0.12, 0.85, 35),
    lime: theme.ink,
    line: mix(theme.bg, "#000000", 0.4),
    plaster: mix(theme.bg, theme.ink, 0.34),
  };
}

function bands(w: number, h: number) {
  const { u, portrait } = frameOf(w, h);
  const bh = u * (portrait ? 0.1 : 0.11);
  return { top: h * 0.06, bh, bottom: h - h * 0.06 - bh, u };
}

/** Vitruvian wave scroll along a band. */
function waveScroll(c: Ctx2D, x0: number, x1: number, y: number, hgt: number, color: string) {
  const period = hgt * 1.25;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x0, y + hgt * 0.5);
  for (let x = x0; x <= x1 + period; x += period) {
    const s = hgt * 0.36;
    // One curl: up the back of the wave, round the crest, into the spiral.
    c.lineTo(x, y + hgt * 0.5);
    c.bezierCurveTo(
      x + period * 0.25,
      y + hgt * 0.5,
      x + period * 0.22,
      y + hgt * 0.02,
      x + period * 0.52,
      y + hgt * 0.05,
    );
    c.bezierCurveTo(
      x + period * 0.82,
      y + hgt * 0.08,
      x + period * 0.9,
      y + hgt * 0.42,
      x + period * 0.7,
      y + hgt * 0.45,
    );
    c.bezierCurveTo(
      x + period * 0.55,
      y + hgt * 0.48,
      x + period * 0.48,
      y + hgt * 0.3,
      x + period * 0.6,
      y + hgt * 0.26,
    );
    c.bezierCurveTo(
      x + period * 0.66 + s * 0.01,
      y + hgt * 0.24,
      x + period * 0.72,
      y + hgt * 0.32,
      x + period * 0.66,
      y + hgt * 0.36,
    );
    c.bezierCurveTo(
      x + period * 0.75,
      y + hgt * 0.3,
      x + period * 0.72,
      y + hgt * 0.18,
      x + period * 0.6,
      y + hgt * 0.17,
    );
    c.bezierCurveTo(
      x + period * 0.42,
      y + hgt * 0.16,
      x + period * 0.4,
      y + hgt * 0.48,
      x + period * 0.62,
      y + hgt * 0.56,
    );
    c.bezierCurveTo(
      x + period * 0.8,
      y + hgt * 0.62,
      x + period * 0.95,
      y + hgt * 0.5,
      x + period,
      y + hgt * 0.5,
    );
  }
  c.lineTo(x1 + period, y + hgt);
  c.lineTo(x0, y + hgt);
  c.closePath();
  c.fill();
}

/** The wall: plaster, trowel marks, the painted bands and the static sea floor. */
function wall(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const pal = palette(theme);
    const B = bands(w, h);
    const { u } = B;
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.012, 0.02, u * 0.22, u / 120, 1.9);
    // Trowel sweeps: broad soft arcs a shade lighter or darker.
    const r = rng(2601);
    for (let i = 0; i < 36; i++) {
      const x = r() * w;
      const y = r() * h;
      const R = u * (0.2 + r() * 0.4);
      c.strokeStyle = rgba(r() < 0.5 ? theme.ink : "#000000", 0.018 + r() * 0.02);
      c.lineWidth = u * (0.04 + r() * 0.05);
      c.beginPath();
      c.arc(x, y, R, r() * TAU, r() * TAU + 0.8);
      c.stroke();
    }
    // Painted bands: red ochre with a lime-white wave scroll and fine rules.
    for (const y of [B.top, B.bottom]) {
      c.fillStyle = pal.red;
      c.fillRect(0, y, w, B.bh);
      waveScroll(c, -B.bh, w, y + B.bh * 0.2, B.bh * 0.6, pal.lime);
      c.fillStyle = pal.lime;
      c.fillRect(0, y + B.bh * 0.06, w, B.bh * 0.035);
      c.fillRect(0, y + B.bh * 0.9, w, B.bh * 0.035);
    }
    // Minoan rockwork: veined wavy bands along the foot of the panel, with fronds.
    const floor = B.bottom;
    const layersR: [string, number][] = [
      [pal.blueDark, 0.12],
      [pal.ochre, 0.08],
      [mix(pal.blue, pal.lime, 0.15), 0.04],
    ];
    layersR.forEach(([col, hk], li) => {
      const top: Pt[] = [];
      for (let i = 0; i <= 60; i++) {
        const x = (i / 60) * w;
        const y =
          floor -
          u * hk -
          Math.abs(Math.sin((x / u) * 3.2 + li * 1.3)) * u * 0.035 -
          noise3((x / u) * 4, li, 2) * u * 0.01;
        top.push([x, y]);
      }
      c.beginPath();
      tracePts(c, top);
      c.lineTo(w, floor + 1);
      c.lineTo(0, floor + 1);
      c.closePath();
      c.fillStyle = col;
      c.fill();
      c.strokeStyle = pal.line;
      c.lineWidth = u * 0.004;
      c.beginPath();
      tracePts(c, top);
      c.stroke();
      // Veins following the band.
      c.strokeStyle = rgba(pal.lime, 0.35);
      c.lineWidth = u * 0.0025;
      for (const off of [0.25, 0.5]) {
        c.beginPath();
        tracePts(
          c,
          top.map(([x, y]) => [x, y + u * hk * off] as Pt),
        );
        c.stroke();
      }
    });
    c.lineCap = "round";
    for (let i = 0; i < 11; i++) {
      const fx = (i / 10) * w + (r() - 0.5) * u * 0.05;
      const fy = floor - u * 0.13;
      const fh = u * (0.09 + r() * 0.07);
      const lean = (r() - 0.5) * u * 0.05;
      const pts: Pt[] = [];
      for (let j = 0; j <= 10; j++) {
        const k = j / 10;
        pts.push([fx + lean * k + Math.sin(k * 5 + i) * u * 0.008, fy - fh * k]);
      }
      c.fillStyle = mix(pal.blue, pal.lime, 0.25);
      ribbon(c, pts, (k) => u * 0.012 * (1 - k * 0.85));
    }
  };
}

/** Damage over the paint: losses to bare arriccio, cracks with a lit lip, lime bloom, grime. */
function damage(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const pal = palette(theme);
    const { u } = frameOf(w, h);
    const r = rng(5150);
    // Losses: flaked patches showing the coarse plaster beneath.
    const losses: [number, number, number][] = [
      [0.88, 0.16, 0.1],
      [0.06, 0.62, 0.08],
      [0.52, 0.955, 0.06],
    ];
    const bare = mix(mix(theme.bg, theme.ink, 0.5), pal.ochre, 0.18);
    for (const [lx, ly, lr] of losses) {
      const pts: Pt[] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * TAU;
        const jag = 0.1 * (hash(i, lx * 100) - 0.5);
        const rr =
          lr *
          u *
          (1 +
            0.38 * noise3(Math.cos(a) * 1.4 + lx * 9, Math.sin(a) * 1.4, 3.3) +
            0.16 * noise3(a * 4, ly * 7, 1.1) +
            jag);
        pts.push([lx * w + Math.cos(a) * rr * 1.35, ly * h + Math.sin(a) * rr]);
      }
      c.save();
      c.beginPath();
      tracePts(c, pts, true);
      c.fillStyle = bare;
      c.fill();
      c.clip();
      // Coarse sand in the arriccio.
      for (let i = 0; i < 500 * lr * 10; i++) {
        c.fillStyle = rgba(r() < 0.55 ? "#000000" : theme.ink, 0.06 + r() * 0.12);
        const sz = u * (0.0015 + r() * 0.004);
        c.fillRect(lx * w + (r() - 0.5) * lr * u * 3, ly * h + (r() - 0.5) * lr * u * 2.3, sz, sz);
      }
      // Recessed: the paint edge shadows the upper left inside the loss.
      c.shadowColor = "rgba(0,0,0,0.7)";
      c.shadowBlur = u * 0.012;
      c.shadowOffsetX = u * 0.006;
      c.shadowOffsetY = u * 0.007;
      c.strokeStyle = "rgba(0,0,0,0.85)";
      c.lineWidth = u * 0.012;
      c.beginPath();
      tracePts(c, pts, true);
      c.stroke();
      c.restore();
      // The broken paint edge catches light on its lower right.
      c.strokeStyle = rgba(theme.ink, 0.3);
      c.lineWidth = Math.max(1, u * 0.002);
      c.beginPath();
      tracePts(c, pts.slice(2, 22), false);
      c.stroke();
    }
    // Cracks: branching random walks, dark with a lit lip.
    const crack = (x: number, y: number, a: number, len: number, wd: number, depth: number) => {
      const pts: Pt[] = [[x, y]];
      let cx = x;
      let cy = y;
      let ang = a;
      const steps = Math.max(4, Math.round(len / (u * 0.012)));
      for (let i = 0; i < steps; i++) {
        ang += (r() - 0.5) * 0.7;
        cx += Math.cos(ang) * u * 0.012;
        cy += Math.sin(ang) * u * 0.012;
        pts.push([cx, cy]);
        if (depth < 3 && r() < 0.08)
          crack(cx, cy, ang + (r() < 0.5 ? 0.9 : -0.9), len * 0.5, wd * 0.6, depth + 1);
      }
      c.fillStyle = rgba(theme.ink, 0.16);
      ribbon(
        c,
        pts.map(([px, py]) => [px - u * 0.0015, py - u * 0.0015] as Pt),
        (k) => wd * (1 - k * 0.8),
      );
      c.fillStyle = rgba(mix(theme.bg, "#000000", 0.6), 0.85);
      ribbon(c, pts, (k) => wd * (1 - k * 0.8));
    };
    for (let i = 0; i < 7; i++)
      crack(r() * w, r() * h, r() * TAU, u * (0.25 + r() * 0.5), u * (0.003 + r() * 0.003), 0);
    // Lime bloom: pale haze where salts came through; grime settling low.
    tileFill(c, noiseTile(5151, 256, 4, 4, 1.2, -0.05, theme.ink), w, h, u / 300, 0.16);
    const grime = c.createLinearGradient(0, h * 0.6, 0, h);
    grime.addColorStop(0, rgba("#000000", 0));
    grime.addColorStop(1, rgba("#000000", 0.22));
    c.fillStyle = grime;
    c.fillRect(0, h * 0.6, w, h * 0.4);
  };
}

type Swimmer = { phase: number; y: number; amp: number; size: number; seed: number };

/** A dolphin in the Minoan manner: blue back, ochre band, pale belly with dashes. */
function dolphin(
  c: Ctx2D,
  pal: ReturnType<typeof palette>,
  x: number,
  y: number,
  ang: number,
  L: number,
  flex: number,
  u: number,
) {
  const spine: Pt[] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const bend = flex * Math.sin(k * Math.PI * 1.2 - 0.4) * L * 0.08 * k;
    spine.push([-L * 0.5 + k * L, bend]);
  }
  const width = (k: number) => {
    if (k < 0.07) return L * 0.035 * Math.sqrt(k / 0.07);
    if (k < 0.2) return L * (0.035 + 0.1 * Math.sin(((k - 0.07) / 0.13) * (Math.PI / 2)));
    return L * 0.135 * Math.pow(1 - (k - 0.2) / 0.8, 1.1) + L * 0.014;
  };
  const top: Pt[] = [];
  const bot: Pt[] = [];
  spine.forEach(([sx, sy], i) => {
    const k = i / n;
    const wd = width(k);
    top.push([sx, sy - wd]);
    bot.push([sx, sy + wd * 0.95]);
  });
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(-1, 1);
  // Tail flukes and fins first, under the body.
  const [tx, ty] = spine[n];
  c.fillStyle = pal.blueDark;
  c.beginPath();
  c.moveTo(tx - L * 0.02, ty);
  c.quadraticCurveTo(tx + L * 0.08, ty - L * 0.14 - flex * L * 0.03, tx + L * 0.14, ty - L * 0.12);
  c.quadraticCurveTo(tx + L * 0.06, ty, tx + L * 0.14, ty + L * 0.12);
  c.quadraticCurveTo(tx + L * 0.08, ty + L * 0.14 - flex * L * 0.03, tx - L * 0.02, ty);
  c.fill();
  c.strokeStyle = pal.line;
  c.lineWidth = u * 0.003;
  c.stroke();
  const [dx, dy] = spine[Math.round(n * 0.42)];
  c.beginPath();
  c.moveTo(dx - L * 0.07, dy - width(0.42) * 0.9);
  c.quadraticCurveTo(
    dx + L * 0.02,
    dy - width(0.42) - L * 0.12,
    dx + L * 0.08,
    dy - width(0.42) - L * 0.1,
  );
  c.quadraticCurveTo(dx + L * 0.03, dy - width(0.42) * 0.6, dx + L * 0.06, dy - width(0.42) * 0.8);
  c.closePath();
  c.fill();
  c.stroke();
  const [fx, fy] = spine[Math.round(n * 0.3)];
  c.beginPath();
  c.moveTo(fx - L * 0.02, fy + width(0.3) * 0.5);
  c.quadraticCurveTo(
    fx + L * 0.04,
    fy + width(0.3) + L * 0.08,
    fx + L * 0.1,
    fy + width(0.3) + L * 0.06,
  );
  c.quadraticCurveTo(fx + L * 0.05, fy + width(0.3) * 0.7, fx + L * 0.03, fy + width(0.3) * 0.4);
  c.closePath();
  c.fill();
  c.stroke();
  // Body: pale belly, blue back, the ochre band between.
  c.beginPath();
  tracePts(c, top);
  for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]);
  c.closePath();
  c.fillStyle = pal.lime;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = pal.blue;
  c.beginPath();
  tracePts(c, top);
  for (let i = n; i >= 0; i--) c.lineTo(spine[i][0], spine[i][1] + width(i / n) * 0.05);
  c.closePath();
  c.fill();
  c.fillStyle = pal.ochre;
  const band: Pt[] = spine.map(([sx, sy], i) => [sx, sy + width(i / n) * 0.05]);
  const band2: Pt[] = spine.map(([sx, sy], i) => [sx, sy + width(i / n) * 0.32]);
  c.beginPath();
  tracePts(c, band);
  for (let i = n; i >= 0; i--) c.lineTo(band2[i][0], band2[i][1]);
  c.closePath();
  c.fill();
  c.fillStyle = pal.line;
  for (let i = 5; i < n - 4; i += 2) {
    const [bx, by] = spine[i];
    c.fillRect(bx, by + width(i / n) * 0.55, L * 0.02, u * 0.0035);
  }
  c.restore();
  c.strokeStyle = pal.line;
  c.lineWidth = u * 0.004;
  c.beginPath();
  tracePts(c, top);
  for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]);
  c.closePath();
  c.stroke();
  // Eye.
  const [ex, ey] = spine[Math.round(n * 0.14)];
  c.fillStyle = pal.line;
  c.beginPath();
  c.arc(ex, ey - width(0.14) * 0.3, L * 0.012, 0, TAU);
  c.fill();
  c.restore();
}

export const style: MotionStyle = {
  id: "fresco-plaster",
  name: "Fresco",
  family: "Paint & Draw",
  tagline: "A Pompeian fresco wall",
  look: "A Pompeian black wall in true fresco: red wave-scroll bands, dolphins in the painted sea, cracks, losses, lime bloom and patina.",
  move: "The dolphins swim and dive through the old plaster while the damage stays put: they pass under cracks and vanish into the losses.",
  rules: [
    "Pigment sits in the plaster: matte, a little soft, never glossy.",
    "Damage is fixed to the wall; the paint moves beneath it.",
    "Losses show coarse bare plaster with a lit broken edge.",
    "Cracks branch, dark in the channel with a lit lip.",
    "An earth palette: red ochre, yellow ochre, Egyptian blue, lime white.",
    "Motifs are flat and outlined, in the ancient manner.",
    "Dolphins cross exactly one period per loop, so the loop closes.",
  ],
  prompt: `R — References
• Pompeian third-style black walls and Minoan dolphin frescoes (search: Pompeii black room fresco, Knossos dolphin fresco).
• Conservation photographs: craquelure, flaking losses to the arriccio, lime bloom.

I — Idea
One wall, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a black fresco panel between red bands of wave scroll; dolphins enter the painted sea.
• Middle (1.5–3.5 s): they swim and dive in a sine through the panel, passing under the cracks and disappearing into flaked losses as if painted into the plaster.
• End (3.5–5 s): each dolphin exits as the next enters, one period on, matching the first frame.

S — Style
Looks: {{bg}} plaster with trowel marks; {{accent}} red ochre bands with a lime-white Vitruvian scroll; dolphins in {{accent2}}, yellow ochre and {{ink}}; dark outlines; losses of pale coarse plaster; branching cracks; pale lime bloom; "{{name}}" in Roman capitals on a painted plaque.
Moves: dolphins travel one period per loop along a sine, the body flexing twice per swim cycle; the damage and the wall never move.
Rules:
1. Matte pigment, slightly softened into the plaster.
2. Damage fixed to the wall; paint moves beneath it.
3. Losses: coarse plaster, lit broken edge.
4. Branching cracks with a lit lip.
5. Earth palette only.
6. Flat outlined motifs.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; dolphins read as dolphins at thumbnail size; losses cut through the moving paint; nothing looks glossy or vector-flat; the plaque text is crisp. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Fresco",
  theme: {
    bg: "#17120f",
    ink: "#efe2c4",
    accent: "#b8432b",
    accent2: "#3d7fb0",
    font: "Cinzel",
  },
  fonts: ["Cinzel:wght@500..700"],
  tags: [
    "fresco",
    "plaster",
    "pompeii",
    "ancient",
    "roman",
    "minoan",
    "dolphins",
    "cracked",
    "aged",
    "patina",
    "mural",
  ],
  word: "Mare",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const pal = palette(theme);
    const B = bands(w, h);
    ground(ctx, w, h, theme.bg);
    const key = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`;
    ctx.drawImage(bake(`fresco-wall:${key}`, w, h, wall(theme)) as CanvasImageSource, 0, 0);

    // The moving paint on its own layer, softened into the plaster.
    const { canvas: pc, ctx: P } = buffer("fresco-paint", w, h);
    P.save();
    P.clearRect(0, 0, w, h);
    const ph = t / LOOP;
    const field0 = B.top + B.bh;
    const field1 = B.bottom;
    const fieldH = field1 - field0;
    const swimmers: Swimmer[] = portrait
      ? [
          { phase: 0, y: 0.3, amp: 0.1, size: 0.62, seed: 1 },
          { phase: 0.5, y: 0.62, amp: 0.1, size: 0.56, seed: 2 },
        ]
      : [
          { phase: 0, y: 0.34, amp: 0.14, size: 0.5, seed: 1 },
          { phase: 0.36, y: 0.6, amp: 0.12, size: 0.44, seed: 2 },
          { phase: 0.7, y: 0.42, amp: 0.1, size: 0.38, seed: 3 },
        ];
    const span = w * 1.6;
    for (const s of swimmers) {
      const k = (ph + s.phase) % 1;
      const x = -w * 0.3 + span * k;
      const wave = Math.sin(TAU * (k * 2 + s.seed * 0.3));
      const y = field0 + fieldH * (s.y + s.amp * wave);
      const slope = (Math.cos(TAU * (k * 2 + s.seed * 0.3)) * (TAU * 2 * fieldH * s.amp)) / span;
      const L = u * s.size;
      const flex = Math.sin(TAU * (ph * 4 + s.seed * 0.2));
      dolphin(P, pal, x, y, Math.atan(slope), L, flex, u);
    }
    // A small school of fish going the other way.
    for (let i = 0; i < 7; i++) {
      const k = (ph + i * 0.043) % 1;
      const x = w * 1.15 - w * 1.3 * k;
      const y =
        field0 +
        fieldH * (0.2 + 0.05 * Math.sin(i * 2.1)) +
        Math.sin(TAU * (k * 3 + i * 0.2)) * u * 0.01;
      const fs = u * 0.028;
      P.fillStyle = i % 2 ? pal.ochre : pal.lime;
      P.strokeStyle = pal.line;
      P.lineWidth = u * 0.0025;
      P.beginPath();
      P.ellipse(x, y, fs, fs * 0.38, 0, 0, TAU);
      P.moveTo(x + fs * 0.9, y);
      P.lineTo(x + fs * 1.5, y - fs * 0.4);
      P.lineTo(x + fs * 1.5, y + fs * 0.4);
      P.closePath();
      P.fill();
      P.stroke();
    }
    // The plaque: a tabula ansata with the name in Roman capitals.
    const word = wordFor(theme.name, "Mare", 12).toUpperCase();
    const px = portrait ? w * 0.5 : w * 0.8;
    const py = portrait ? field0 + fieldH * 0.86 : field0 + fieldH * 0.78;
    const pw = u * (portrait ? 0.52 : 0.42);
    const phh = u * 0.12;
    P.fillStyle = pal.red;
    P.beginPath();
    P.rect(px - pw / 2, py - phh / 2, pw, phh);
    P.moveTo(px - pw / 2, py - phh * 0.3);
    P.lineTo(px - pw / 2 - phh * 0.45, py - phh * 0.5);
    P.lineTo(px - pw / 2 - phh * 0.45, py + phh * 0.5);
    P.lineTo(px - pw / 2, py + phh * 0.3);
    P.moveTo(px + pw / 2, py - phh * 0.3);
    P.lineTo(px + pw / 2 + phh * 0.45, py - phh * 0.5);
    P.lineTo(px + pw / 2 + phh * 0.45, py + phh * 0.5);
    P.lineTo(px + pw / 2, py + phh * 0.3);
    P.fill();
    P.strokeStyle = pal.lime;
    P.lineWidth = u * 0.003;
    P.strokeRect(
      px - pw / 2 + u * 0.008,
      py - phh / 2 + u * 0.008,
      pw - u * 0.016,
      phh - u * 0.016,
    );
    const css = (sz: number) => font(600, sz, "Cinzel", CAPS);
    const size = fitFont(P, word, pw * 0.8, phh * 0.55, css);
    P.font = css(size);
    const c2 = P as CanvasRenderingContext2D;
    if ("letterSpacing" in c2) c2.letterSpacing = `${(size * 0.12).toFixed(1)}px`;
    P.fillStyle = pal.lime;
    P.textAlign = "center";
    P.textBaseline = "middle";
    P.fillText(word, px, py + size * 0.04);
    P.restore();
    // Brush texture in the paint, then the plaster tooth breaking it.
    tileFill(
      P,
      speckleTile(7001, 256, 2200, 0.1, 0.45, 0.5, 1.6),
      w,
      h,
      Math.max(0.5, u / 700),
      0.5,
      "destination-out",
    );
    // Pigment faded unevenly over the centuries.
    tileFill(P, noiseTile(7002, 256, 5, 4, 1.3, 0.05), w, h, u / 360, 0.45, "destination-out");
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.filter = `blur(${Math.max(0.3, u * 0.0009).toFixed(2)}px)`;
    ctx.drawImage(pc as CanvasImageSource, 0, 0);
    ctx.restore();

    // Damage and patina over everything.
    ctx.drawImage(bake(`fresco-damage:${key}`, w, h, damage(theme)) as CanvasImageSource, 0, 0);
    tileFill(
      ctx,
      noiseTile(5152, 256, 24, 3, 0.9, 0.5, "#ffffff"),
      w,
      h,
      Math.max(0.5, u / 900),
      0.08,
      "soft-light",
    );
    light(ctx, w * 0.3, h * 0.25, Math.max(w, h) * 0.8, mix(theme.ink, theme.accent, 0.3), 0.08);
    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
