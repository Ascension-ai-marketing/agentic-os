import { adjust, mix, rgba } from "../engine/color";
import {
  bake,
  font,
  frameOf,
  grain,
  ground,
  light,
  LOOP,
  noise3,
  once,
  rng,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { fitFont, ribbon, speckleTile, sprite, tileFill, tracePts, type Pt } from "./_s2-helpers";

type Shape = "disc" | "kidney" | "petal" | "crescent";
type Plate = {
  shape: Shape;
  /** Radius, in mobile units. */
  r: number;
  front: number;
  back: number;
  /** Plate yaw against its arm, and its own extra swing. */
  off: number;
  spin: number;
  rot: number;
};
/**
 * One arm of a Calder-style cascade: a curved wire hanging from a hook at its
 * balance point. The outer end (right) carries a plate; the inner end (left)
 * carries the next arm, or a second plate at the bottom of the chain.
 */
type Arm = {
  inner: number;
  outer: number;
  /** Tilt of the arm in the picture plane (outer end down is positive). */
  tilt: number;
  yaw0: number;
  amp: number;
  k: number;
  ph: number;
  plate: Plate;
  last?: Plate;
  /** Hook length from the parent's inner end to this arm's pivot. */
  hook: number;
};

const CHAIN: Arm[] = [
  {
    inner: 0.34,
    outer: 0.6,
    tilt: 0.08,
    yaw0: 0.1,
    amp: 0.3,
    k: 1,
    ph: 0,
    plate: { shape: "disc", r: 0.2, front: 0, back: 3, off: 0, spin: 0.2, rot: 0 },
    hook: 0,
  },
  {
    inner: 0.27,
    outer: 0.4,
    tilt: 0.16,
    yaw0: -0.3,
    amp: 0.55,
    k: 1,
    ph: 0.35,
    plate: { shape: "kidney", r: 0.16, front: 1, back: 2, off: 0.35, spin: 0.35, rot: -0.5 },
    hook: 0.2,
  },
  {
    inner: 0.21,
    outer: 0.31,
    tilt: 0.2,
    yaw0: 0.4,
    amp: 0.7,
    k: 1,
    ph: 0.6,
    plate: { shape: "petal", r: 0.13, front: 2, back: 0, off: -0.4, spin: 0.45, rot: 0.55 },
    hook: 0.19,
  },
  {
    inner: 0.17,
    outer: 0.24,
    tilt: 0.22,
    yaw0: -0.2,
    amp: 0.85,
    k: 2,
    ph: 0.1,
    plate: { shape: "disc", r: 0.095, front: 3, back: 1, off: 0.6, spin: 0.5, rot: 0 },
    hook: 0.17,
  },
  {
    inner: 0.14,
    outer: 0.14,
    tilt: -0.06,
    yaw0: 0.5,
    amp: 1.0,
    k: 2,
    ph: 0.45,
    plate: { shape: "crescent", r: 0.1, front: 0, back: 2, off: 0.9, spin: 0.5, rot: 0.6 },
    last: { shape: "disc", r: 0.065, front: 1, back: 3, off: 0.3, spin: 0.6, rot: 0 },
    hook: 0.15,
  },
];

/** The mid-century palette, derived from the theme so a brand re-skins it. */
function palette(theme: Theme) {
  return [theme.accent, theme.accent2, adjust(theme.accent, 0.12, 0.95, 38), theme.ink];
}

/** Outline of a plate shape, radius 1, with a ragged brushed edge. */
function outline(shape: Shape, seed: number): Pt[] {
  const pts: Pt[] = [];
  const n = 180;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let x = Math.cos(a);
    let y = Math.sin(a);
    if (shape === "kidney") {
      const r = 1 - 0.36 * Math.pow(Math.max(0, Math.cos(a - Math.PI / 2)), 3);
      x = Math.cos(a) * 1.22 * r;
      y = Math.sin(a) * 0.8 * r;
    } else if (shape === "petal") {
      const r = 0.52 + 0.48 * Math.pow((1 - Math.cos(a)) / 2, 0.85);
      x = Math.cos(a) * r * 1.15 - 0.22;
      y = Math.sin(a) * r * 0.82;
    } else if (shape === "crescent") {
      const k = i / n;
      if (k < 0.5) {
        const b = -Math.PI / 2 + k * 2 * Math.PI;
        x = Math.cos(b);
        y = Math.sin(b);
      } else {
        const b = Math.PI / 2 - (k - 0.5) * 2 * Math.PI;
        x = 0.4 + Math.cos(b) * 0.74;
        y = Math.sin(b) * 0.84;
      }
    }
    const wob = 1 + 0.012 * noise3(a * 3, seed, 0.3) + 0.007 * noise3(a * 21, seed + 5, 0.7);
    pts.push([x * wob, y * wob]);
  }
  pts.push(pts[0]);
  return pts;
}

/** A gouache plate: opaque flat colour, broad brush strokes, bristle streaks, dry-brush edge. */
function plateSprite(
  shape: Shape,
  color: string,
  px: number,
  seed: number,
  logo: AnyCanvas | null,
) {
  const S = Math.max(8, Math.round(px * 2.8));
  return sprite(`gouache-plate:${shape}:${color}:${seed}:${logo ? "L" : ""}`, S, S, (c) => {
    const s = S / 2.8;
    const cx = S / 2;
    const cy = S / 2;
    const pts = outline(shape, seed).map(([x, y]) => [cx + x * s, cy + y * s] as Pt);
    const r = rng(seed * 97 + 13);
    c.save();
    c.beginPath();
    tracePts(c, pts, true);
    c.fillStyle = color;
    c.fill();
    c.clip();
    // Broad strokes in one direction, each a hair lighter or darker.
    const dir = -0.6 + r() * 1.2;
    const cd = Math.cos(dir);
    const sd = Math.sin(dir);
    for (let i = 0; i < 14; i++) {
      const off = (-1.3 + (2.6 * (i + r() * 0.6)) / 14) * s;
      const wBand = s * (0.2 + r() * 0.18);
      const path: Pt[] = [];
      for (let j = 0; j <= 12; j++) {
        const k = j / 12;
        const along = (-1.6 + 3.2 * k) * s;
        const bow = Math.sin(k * Math.PI) * s * 0.06 * (r() - 0.5);
        path.push([cx + cd * along - sd * (off + bow), cy + sd * along + cd * (off + bow)]);
      }
      c.fillStyle = adjust(color, (r() - 0.5) * 0.07, 1 + (r() - 0.5) * 0.14, (r() - 0.5) * 5);
      c.globalAlpha = 0.55 + r() * 0.4;
      ribbon(c, path, (k) => wBand * (0.7 + 0.3 * Math.sin(k * Math.PI)));
    }
    // Bristle streaks: fine lines along the brush direction.
    c.lineCap = "round";
    for (let i = 0; i < 110; i++) {
      const off = (r() * 2.6 - 1.3) * s;
      const start = (r() * 2.2 - 1.1) * s;
      const len = s * (0.3 + r() * 0.9);
      const x0 = cx + cd * start - sd * off;
      const y0 = cy + sd * start + cd * off;
      c.strokeStyle = r() < 0.5 ? adjust(color, 0.09) : adjust(color, -0.1);
      c.globalAlpha = 0.18 + r() * 0.4;
      c.lineWidth = Math.max(0.6, s * (0.004 + r() * 0.01));
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x0 + cd * len, y0 + sd * len);
      c.stroke();
    }
    c.globalAlpha = 1;
    if (logo) {
      const box = s * 0.95;
      c.drawImage(logo as CanvasImageSource, cx - box / 2, cy - box / 2, box, box);
    }
    c.restore();
    // Dry-brush flicks where strokes left the edge.
    c.save();
    c.fillStyle = color;
    for (let i = 0; i < 30; i++) {
      const at = Math.floor(r() * (pts.length - 2));
      const [x0, y0] = pts[at];
      const [x1, y1] = pts[at + 1];
      const tl = Math.hypot(x1 - x0, y1 - y0) || 1;
      const tx = (x1 - x0) / tl;
      const ty = (y1 - y0) / tl;
      const len = s * (0.06 + r() * 0.18);
      const wid = s * (0.004 + r() * 0.012);
      const sgn = r() < 0.5 ? -1 : 1;
      const path: Pt[] = [];
      for (let j = 0; j <= 6; j++) {
        const k = j / 6;
        path.push([
          x0 + tx * len * k * sgn - ty * wid * k * 1.5,
          y0 + ty * len * k * sgn + tx * wid * k * 1.5,
        ]);
      }
      c.globalAlpha = 0.5 + r() * 0.5;
      ribbon(c, path, (k) => wid * (1 - k) * 2);
    }
    c.restore();
    // Paper tooth where the paint skipped.
    tileFill(
      c,
      speckleTile(4100 + seed, 256, 900, 0.2, 0.7, 0.5, 1.6),
      S,
      S,
      Math.max(0.5, s / 160),
      0.45,
      "destination-out",
    );
  });
}

/** Silhouette of a sprite in one colour (for the flat wall shadow). */
function silhouette(src: AnyCanvas, color: string, key: string) {
  const W = (src as { width: number }).width;
  const H = (src as { height: number }).height;
  return sprite(`gouache-sil:${key}:${color}`, W, H, (c) => {
    c.drawImage(src as CanvasImageSource, 0, 0);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = color;
    c.fillRect(0, 0, W, H);
  });
}

/** Painted board: broad, barely-there strokes of the ground colour. */
function board(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const r = rng(2201);
    for (let i = 0; i < 46; i++) {
      const y = r() * h * 1.1 - h * 0.05;
      const x = r() * w * 1.2 - w * 0.1;
      const len = u * (0.5 + r() * 1.1);
      const ang = -0.12 + r() * 0.24;
      const path: Pt[] = [];
      for (let j = 0; j <= 10; j++) {
        const k = j / 10;
        path.push([
          x + Math.cos(ang) * len * k,
          y + Math.sin(ang) * len * k + Math.sin(k * 3) * u * 0.01,
        ]);
      }
      c.fillStyle = adjust(theme.bg, (r() - 0.5) * 0.035);
      c.globalAlpha = 0.5 + r() * 0.5;
      const bw = u * (0.05 + r() * 0.04);
      ribbon(c, path, (k) => bw * (0.7 + 0.3 * Math.sin(k * Math.PI)));
    }
    c.globalAlpha = 1;
    c.lineCap = "round";
    for (let i = 0; i < 900; i++) {
      const x = r() * w;
      const y = r() * h;
      const len = u * (0.02 + r() * 0.08);
      c.strokeStyle = rgba(r() < 0.5 ? theme.ink : "#000000", 0.012 + r() * 0.018);
      c.lineWidth = Math.max(0.5, u * 0.0012);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + len, y + (r() - 0.5) * len * 0.1);
      c.stroke();
    }
  };
}

type V3 = { x: number; y: number; z: number };
type Posed = {
  wires: { a: V3; b: V3; bow: number }[];
  hooks: V3[];
  plates: { at: V3; plate: Plate; face: number; lead: boolean }[];
};

/** Pose the cascade at loop phase `ph` in mobile units (pivot of the top arm at 0,0). */
function pose(ph: number, portrait: boolean, square: boolean): Posed {
  const sx = portrait ? 0.5 : square ? 0.74 : 1;
  const sy = portrait ? 2.4 : square ? 1.75 : 1.4;
  const out: Posed = { wires: [], hooks: [], plates: [] };
  let pivot: V3 = { x: 0, y: 0, z: 0 };
  CHAIN.forEach((arm, i) => {
    const yaw = arm.yaw0 + arm.amp * Math.sin(TAU * (arm.k * ph + arm.ph));
    const cy = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const ct = Math.cos(arm.tilt);
    const st = Math.sin(arm.tilt);
    const outer: V3 = {
      x: pivot.x + cy * arm.outer * sx * ct,
      y: pivot.y + arm.outer * st * sx,
      z: pivot.z + syw * arm.outer * sx,
    };
    const inner: V3 = {
      x: pivot.x - cy * arm.inner * sx * ct,
      y: pivot.y - arm.inner * st * sx,
      z: pivot.z - syw * arm.inner * sx,
    };
    out.wires.push({ a: inner, b: outer, bow: i % 2 ? 0.07 : -0.06 });
    out.hooks.push(pivot);
    out.plates.push({
      at: outer,
      plate: arm.plate,
      face: yaw + arm.plate.off + arm.plate.spin * Math.sin(TAU * (ph + arm.plate.off)),
      lead: i === 0,
    });
    if (arm.last)
      out.plates.push({
        at: inner,
        plate: arm.last,
        face: yaw + arm.last.off + arm.last.spin * Math.sin(TAU * (2 * ph + arm.last.off)),
        lead: false,
      });
    const next = CHAIN[i + 1];
    if (next) {
      const p: V3 = { x: inner.x, y: inner.y + next.hook * sy, z: inner.z };
      out.wires.push({ a: inner, b: p, bow: 0 });
      pivot = p;
    }
  });
  return out;
}

/** Rest-pose bounds (sampled over the loop) so the mobile always fits its stage. */
function bounds(portrait: boolean, square: boolean) {
  return once(`gouache-bounds:${portrait}:${square}`, () => {
    let x0 = Infinity;
    let x1 = -Infinity;
    const y0 = 0;
    let y1 = -Infinity;
    for (let i = 0; i < 40; i++) {
      const P = pose(i / 40, portrait, square);
      for (const p of P.plates) {
        const r = p.plate.r;
        x0 = Math.min(x0, p.at.x - r * 1.25);
        x1 = Math.max(x1, p.at.x + r * 1.25);
        y1 = Math.max(y1, p.at.y + r * 2);
      }
      for (const wv of P.wires) {
        x0 = Math.min(x0, wv.a.x, wv.b.x);
        x1 = Math.max(x1, wv.a.x, wv.b.x);
      }
    }
    return { x0, x1, y0, y1 };
  });
}

export const style: MotionStyle = {
  id: "gouache-flat",
  name: "Gouache Mobile",
  family: "Paint & Draw",
  tagline: "A gouache mobile in flat colour",
  look: "A mid-century hanging mobile of gouache-painted plates: opaque flat colour, brushed edges, bristle streaks, flat gallery shadows.",
  move: "Each arm turns slowly on its hook at its own tempo, plates flip edge-on to show their other colour, shadows slide on the wall.",
  rules: [
    "Opaque, flat colour: no gradients inside a plate, only brush streaks.",
    "Every plate edge is brushed: a slight wobble and a few dry-brush flicks.",
    "Four colours from one mid-century palette, each plate two-sided.",
    "Arms turn around their hooks (yaw), never spin in the picture plane.",
    "Plates foreshorten to a thin edge and flip to their back colour.",
    "Shadows are flat, offset and hard, like a gallery wall.",
    "Whole-number tempos, so every arm returns home each loop.",
  ],
  prompt: `R — References
• Alexander Calder hanging mobiles, 1950s (search: Calder mobile, Calder gouache).
• Mid-century gouache illustration: opaque flat colour with visible brush edges (Mary Blair, Charley Harper).

I — Idea
One image, one slow turn, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a cascade of five curved wire arms hangs in a dark gallery, a painted plate on each arm, shadows flat on the wall.
• Middle (1.5–3.5 s): the arms turn on their hooks at different tempos; plates foreshorten to a thin edge and flip to show their other colour; the shadows slide.
• End (3.5–5 s): every arm swings home and the plates face us again, exactly as at the start.

S — Style
Looks: {{bg}} painted board with barely-there broad strokes; plates in {{accent}}, {{accent2}}, a mustard mixed from {{accent}}, and {{ink}}; each plate opaque gouache with broad strokes, bristle streaks and a brushed edge; cream wire; flat offset shadows; "{{name}}" set small in widely tracked {{font}} caps.
Moves: each arm yaws on a sine with a whole number of cycles per loop; plate width follows the cosine of its yaw and flips to its back colour; slight perspective as plates come toward us.
Rules:
1. Opaque flat colour; texture only from brush strokes.
2. Brushed edges with a few dry-brush flicks.
3. A four-colour mid-century palette; every plate two-sided.
4. Yaw rotation around the hooks, foreshortening, flips.
5. Flat, hard, offset shadows on the wall.
6. Whole-number tempos for a seamless loop.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the plates read as painted, not vector; edge-on plates show a thin edge; the mobile fills its stage without touching the frame; the wire never detaches from a plate. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Mobile_(sculpture)",
  theme: {
    bg: "#1c1c21",
    ink: "#f0e3c6",
    accent: "#e2573b",
    accent2: "#2e8a84",
    font: "Jost",
  },
  fonts: ["Jost:wght@300..700"],
  tags: [
    "gouache",
    "flat",
    "mid-century",
    "midcentury",
    "retro",
    "mobile",
    "calder",
    "shapes",
    "paint",
    "illustration",
    "vintage",
    "50s",
  ],
  word: "Mobile",
  render(ctx, t, theme, w, h) {
    const { u, portrait, square } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(`gouache-board:${theme.bg}${theme.ink}`, w, h, board(theme)) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.55, h * 0.3, Math.max(w, h) * 0.75, theme.ink, 0.08);

    const cols = palette(theme);
    const shadowCol = mix(theme.bg, "#000000", 0.6);
    const wireCol = mix(theme.ink, theme.bg, 0.22);
    // Fit the cascade's full swing into its stage, leaving room for the title.
    const B = bounds(portrait, square);
    const stageTop = h * 0.14;
    const stageBottom = h * (portrait ? 0.84 : 0.86);
    const stageLeft = w * (portrait ? 0.08 : 0.07);
    const stageRight = w * (portrait ? 0.92 : 0.93);
    const S = Math.min(
      (stageRight - stageLeft) / (B.x1 - B.x0),
      (stageBottom - stageTop) / (B.y1 - B.y0),
    );
    const ox = (stageLeft + stageRight) / 2 - ((B.x0 + B.x1) / 2) * S;
    const oy = stageTop;
    const P = pose(t / LOOP, portrait, square);
    const tilt = 0.14;
    const project = (v: V3) => ({
      x: ox + v.x * S,
      y: oy + v.y * S + v.z * S * tilt,
      s: 1 + v.z * 0.3,
    });
    const shadowOff = (v: V3) => u * (0.03 + 0.02 * Math.max(0, v.z));

    // Wall shadows: wires faint, plates flat and hard.
    ctx.save();
    ctx.strokeStyle = rgba(shadowCol, 0.45);
    ctx.lineWidth = Math.max(1, u * 0.003);
    for (const wv of P.wires) {
      const a = project(wv.a);
      const b = project(wv.b);
      const oa = shadowOff(wv.a);
      const ob = shadowOff(wv.b);
      ctx.beginPath();
      ctx.moveTo(a.x + oa, a.y + oa * 1.3);
      ctx.lineTo(b.x + ob, b.y + ob * 1.3);
      ctx.stroke();
    }
    ctx.restore();

    type Draw = { z: number; shadow: () => void; draw: () => void };
    const draws: Draw[] = P.plates.map(({ at, plate, face, lead }) => {
      const pr = plate.r * S;
      const px = Math.max(4, Math.round(pr));
      const cf = Math.cos(face);
      const isFront = cf >= 0;
      const colour = cols[isFront ? plate.front : plate.back];
      const seed = Math.round(plate.r * 1000) + plate.front * 7 + (isFront ? 0 : 50);
      const logo = isFront && lead ? tintedLogo(theme, theme.ink, 96, 96) : null;
      const sprite = plateSprite(plate.shape, colour, px, seed, logo);
      const sil = silhouette(sprite, shadowCol, `${plate.shape}${px}${seed}${logo ? "L" : ""}`);
      const Pp = project(at);
      const width = Math.max(0.03, Math.abs(cf));
      const size = px * 2.8;
      // The plate hangs from the wire at its top edge.
      const cyOff = pr * 0.92 * Math.cos(plate.rot);
      const at2 = (img: AnyCanvas, dx: number, dy: number, alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(Pp.x + dx, Pp.y + cyOff * Pp.s + dy);
        ctx.scale(width * Pp.s, Pp.s);
        ctx.rotate(plate.rot * width);
        ctx.drawImage(img as CanvasImageSource, -size / 2, -size / 2, size, size);
        ctx.restore();
      };
      const off = shadowOff(at);
      return {
        z: at.z,
        shadow: () => at2(sil, off, off * 1.3, 0.85),
        draw: () => {
          at2(sprite, 0, 0, 1);
          if (width < 0.16) {
            ctx.save();
            ctx.strokeStyle = mix(colour, "#000000", 0.3);
            ctx.globalAlpha = 1 - width / 0.16;
            ctx.lineWidth = Math.max(1.2, u * 0.005) * Pp.s;
            ctx.beginPath();
            ctx.moveTo(Pp.x, Pp.y + (cyOff - pr * 0.95) * Pp.s);
            ctx.lineTo(Pp.x, Pp.y + (cyOff + pr * 0.95) * Pp.s);
            ctx.stroke();
            ctx.restore();
          }
        },
      };
    });
    for (const d of draws) d.shadow();

    // Wires: bent cream wire, a hook above every pivot.
    ctx.save();
    ctx.strokeStyle = wireCol;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, u * 0.0036);
    const top = project({ x: 0, y: 0, z: 0 });
    ctx.beginPath();
    ctx.moveTo(top.x, -2);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    for (const wv of P.wires) {
      const a = project(wv.a);
      const b = project(wv.b);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const mx = (a.x + b.x) / 2 + ((b.y - a.y) / (L || 1)) * L * wv.bow;
      const my = (a.y + b.y) / 2 - ((b.x - a.x) / (L || 1)) * L * wv.bow;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(1, u * 0.003);
    for (const hk of P.hooks) {
      const p = project(hk);
      ctx.beginPath();
      ctx.arc(p.x, p.y - u * 0.008, u * 0.008, Math.PI * 0.25, Math.PI * 2.1);
      ctx.stroke();
    }
    ctx.restore();

    draws.sort((a, b) => a.z - b.z);
    for (const d of draws) d.draw();

    // The title, set small and wide like a mid-century exhibition card.
    const word = wordFor(theme.name, "Mobile", 14).toUpperCase();
    const css = (s: number) => font(500, s, theme.font, '"Jost", "Futura", sans-serif');
    const size = fitFont(
      ctx,
      word + "WW",
      w * (portrait ? 0.46 : 0.24),
      u * (portrait ? 0.05 : 0.044),
      css,
    );
    ctx.save();
    ctx.font = css(size);
    const c2 = ctx as CanvasRenderingContext2D;
    if ("letterSpacing" in c2) c2.letterSpacing = `${(size * 0.32).toFixed(1)}px`;
    const tw = ctx.measureText(word).width;
    const tx = portrait ? w / 2 - tw / 2 : w * 0.93 - tw;
    const ty = h * (portrait ? 0.93 : 0.92);
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(word, tx, ty);
    ctx.fillStyle = cols[0];
    ctx.beginPath();
    ctx.arc(tx - size * 0.9, ty - size * 0.36, size * 0.3, 0, TAU);
    ctx.fill();
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
  },
};
