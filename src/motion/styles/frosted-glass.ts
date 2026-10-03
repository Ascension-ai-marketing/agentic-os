import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  ease,
  frameOf,
  grain,
  ground,
  LOOP,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { fitText, fontOf } from "./_s5-helpers";

const FAMILY = "Inter Tight";

interface Pane {
  /** Left edge within the conveyor strip. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  panes: Pane[];
  /** Conveyor period: the strip repeats every P px. */
  P: number;
  r: number;
  u: number;
}

function layout(w: number, h: number): Layout {
  const { u, portrait, square } = frameOf(w, h);
  const spec = portrait
    ? {
        ws: [0.34, 0.48, 0.28],
        gs: [0.26, 0.3, 0.3],
        hs: [0.4, 0.5, 0.34],
        ys: [0.01, -0.02, 0.04],
      }
    : square
      ? {
          ws: [0.26, 0.36, 0.21],
          gs: [0.24, 0.28, 0.27],
          hs: [0.56, 0.68, 0.46],
          ys: [0.0, -0.03, 0.05],
        }
      : {
          ws: [0.2, 0.28, 0.17],
          gs: [0.2, 0.26, 0.24],
          hs: [0.6, 0.72, 0.5],
          ys: [0.0, -0.03, 0.05],
        };
  const panes: Pane[] = [];
  let x = spec.gs[2] * w * 0.5;
  for (let i = 0; i < 3; i++) {
    const pw = spec.ws[i] * w;
    const ph = spec.hs[i] * h;
    panes.push({ x, y: h * (0.5 + spec.ys[i]) - ph / 2, w: pw, h: ph });
    x += pw + spec.gs[i] * w;
  }
  return { panes, P: x - spec.gs[2] * w * 0.5, r: u * 0.034, u };
}

interface Orb {
  x: number;
  y: number;
  r: number;
  color: string;
  a: number;
}

function orbs(theme: Theme, t: number, w: number, h: number): Orb[] {
  const { u } = frameOf(w, h);
  const p = t / LOOP;
  const s = Math.sin;
  return [
    {
      x: w * (0.3 + 0.1 * s(TAU * p)),
      y: h * (0.46 + 0.1 * s(TAU * (p + 0.2))),
      r: u * 0.62,
      color: theme.accent,
      a: 0.95,
    },
    {
      x: w * (0.72 - 0.09 * s(TAU * (p + 0.35))),
      y: h * (0.58 + 0.12 * s(TAU * (2 * p + 0.1))),
      r: u * 0.5,
      color: theme.accent2,
      a: 0.9,
    },
    {
      x: w * (0.55 + 0.14 * s(TAU * (p + 0.6))),
      y: h * (0.3 - 0.08 * s(TAU * (p + 0.1))),
      r: u * 0.3,
      color: mix(theme.accent, theme.ink, 0.55),
      a: 0.7,
    },
    {
      x: w * (0.16 + 0.06 * s(TAU * (2 * p + 0.4))),
      y: h * (0.82 - 0.05 * s(TAU * p)),
      r: u * 0.34,
      color: mix(theme.accent, theme.accent2, 0.5),
      a: 0.55,
    },
  ];
}

function drawOrbs(c: Ctx2D, list: Orb[], k: number, bg: string) {
  for (const o of list) {
    const g = c.createRadialGradient(o.x * k, o.y * k, 0, o.x * k, o.y * k, o.r * k);
    g.addColorStop(0, rgba(o.color, o.a));
    g.addColorStop(0.35, rgba(o.color, o.a * 0.62));
    g.addColorStop(0.7, rgba(mix(o.color, bg, 0.5), o.a * 0.18));
    g.addColorStop(1, rgba(o.color, 0));
    c.fillStyle = g;
    c.fillRect((o.x - o.r) * k, (o.y - o.r) * k, o.r * 2 * k, o.r * 2 * k);
  }
}

function paneShape(c: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Margin around a pane sprite (px), so the rim stroke is never cut. */
const RIM = 3;

/** One pane's static look, baked on its own small sprite: frost, rim, edge light. */
function paneGlass(theme: Theme, L: Layout, i: number) {
  return (c: Ctx2D) => {
    const u = L.u;
    const p = L.panes[i];
    c.translate(RIM - p.x, RIM - p.y);
    c.save();
    paneShape(c, p.x, p.y, p.w, p.h, L.r);
    c.clip();
    // Frosted lift: scattered light brightens the glass, more at the top.
    const lift = c.createLinearGradient(0, p.y, 0, p.y + p.h);
    lift.addColorStop(0, rgba(theme.ink, 0.13));
    lift.addColorStop(0.5, rgba(theme.ink, 0.06));
    lift.addColorStop(1, rgba(theme.ink, 0.03));
    c.fillStyle = lift;
    c.fillRect(p.x, p.y, p.w, p.h);
    // Frost: fine speckle that catches the light.
    const n = Math.round((p.w * p.h) / 14);
    const r = rng(9100 + i * 37);
    for (let k = 0; k < n; k++) {
      const x = p.x + r() * p.w;
      const y = p.y + r() * p.h;
      const v = r();
      c.fillStyle =
        v > 0.5 ? rgba(theme.ink, 0.05 + 0.08 * v) : `rgba(0,0,0,${(0.05 + 0.1 * v).toFixed(3)})`;
      const s = Math.max(0.6, u * 0.0016);
      c.fillRect(x, y, s, s);
    }
    // Edge light: glass is thick, so its rim glows just inside the edge.
    c.lineWidth = u * 0.012;
    const edge = c.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
    edge.addColorStop(0, rgba(theme.ink, 0.28));
    edge.addColorStop(0.45, rgba(theme.ink, 0.05));
    edge.addColorStop(1, rgba(theme.ink, 0.14));
    c.strokeStyle = edge;
    c.filter = `blur(${(u * 0.004).toFixed(1)}px)`;
    paneShape(c, p.x, p.y, p.w, p.h, L.r);
    c.stroke();
    c.filter = "none";
    // Faint chromatic fringes on the vertical edges.
    c.globalCompositeOperation = "lighter";
    c.fillStyle = rgba(theme.accent2, 0.1);
    c.fillRect(p.x, p.y, u * 0.004, p.h);
    c.fillStyle = rgba(theme.accent, 0.12);
    c.fillRect(p.x + p.w - u * 0.004, p.y, u * 0.004, p.h);
    c.globalCompositeOperation = "source-over";
    // An etched mark on the largest pane.
    if (i === 1) {
      c.fillStyle = rgba(theme.ink, 0.34);
      c.font = fontOf("", 500, u * 0.024, FAMILY);
      c.textBaseline = "alphabetic";
      c.letterSpacing = `${(u * 0.003).toFixed(2)}px`;
      c.fillText("02", p.x + u * 0.035, p.y + p.h - u * 0.035);
      c.letterSpacing = "0px";
    }
    c.restore();
    // Rim: crisp hairline, bright top-left, darker bottom-right.
    c.save();
    const rim = c.createLinearGradient(p.x, p.y, p.x + p.w * 0.6, p.y + p.h);
    rim.addColorStop(0, rgba(theme.ink, 0.85));
    rim.addColorStop(0.35, rgba(theme.ink, 0.3));
    rim.addColorStop(1, rgba(theme.ink, 0.12));
    c.strokeStyle = rim;
    c.lineWidth = Math.max(1, u * 0.0022);
    paneShape(c, p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1, L.r);
    c.stroke();
    c.restore();
  };
}

/** One pane's soft contact shadow, on its own sprite with room for the blur. */
function paneShadow(L: Layout, i: number, pad: number) {
  return (c: Ctx2D) => {
    const u = L.u;
    const p = L.panes[i];
    c.translate(pad - p.x, pad - p.y);
    c.filter = `blur(${(u * 0.035).toFixed(1)}px)`;
    c.fillStyle = "rgba(0,0,0,0.55)";
    paneShape(c, p.x + u * 0.01, p.y + u * 0.045, p.w, p.h, L.r);
    c.fill();
    c.filter = "none";
  };
}

export const style: MotionStyle = {
  id: "frosted-glass",
  name: "Frosted Glass",
  family: "Light & Material",
  tagline: "Frosted panes over soft colour",
  look: "Thick frosted glass panes with lit edges glide over soft orbs of colour, turning the word behind them to mist.",
  move: "The panes slide along in two eased steps; whatever they cross melts into a soft, magnified blur, then snaps crisp again.",
  rules: [
    "Behind the glass is blurred and slightly magnified, never just dimmed.",
    "Each pane has a hairline rim: bright where the light hits, faint on the far side.",
    "Frost is a real texture: fine speckle and a lift that fades down the pane.",
    "Panes cast soft shadows, so they float above the colour.",
    "The colour behind is a few big soft orbs, drifting slowly; never a flat gradient.",
    "Motion is two eased steps with holds, so the frosted word can be read.",
    "One crisp word; the glass is what changes it.",
  ],
  prompt: `R — References
• Apple visionOS / Liquid Glass materials (search: visionOS glass material, frosted glass UI).
• Architectural frosted glass partitions and fluted glass photography.

I — Idea
Frosted panes slide across a word, 5 seconds, looping seamlessly:
• Beginning (0–1.8 s): "{{name}}" sits crisp over soft drifting orbs of colour; three frosted panes of different sizes glide one step to the right.
• Middle (1.8–2.9 s): they hold; the part of the word under the glass is a soft, magnified blur while the rest stays sharp.
• End (2.9–5 s): the panes glide one more step and settle exactly where the loop began.

S — Style
Looks: {{bg}} ground; big blurred orbs in {{accent}} and {{accent2}}; the word in {{ink}}, {{font}}, large and tight. Panes: rounded, frosted, lifted a little lighter, with a hairline {{ink}} rim and soft drop shadows.
Moves: the panes move as one conveyor in two inOutCubic steps (1.4 s each) with holds; the orbs drift on slow whole-loop paths.
Rules:
1. Blur plus slight magnification behind glass; crisp outside it.
2. Hairline rim, bright top-left, faint bottom-right.
3. Frost speckle and a top-down light lift inside each pane.
4. Soft drop shadows under the panes.
5. Few big orbs, grain and a vignette; never a flat gradient.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the word is sharp outside the glass and blurred inside; pane edges are crisp hairlines, not thick outlines; the panes read as glass, not grey boxes; the blur has no blocky artefacts. Fix what fails and render again until every check passes.`,
  ref: "https://developer.apple.com/design/human-interface-guidelines/materials",
  theme: {
    bg: "#07080d",
    ink: "#f3f5fa",
    accent: "#4a78ff",
    accent2: "#ff6b3d",
    font: FAMILY,
  },
  fonts: ["Inter Tight:wght@400..800"],
  tags: [
    "glass",
    "frosted",
    "glassmorphism",
    "blur",
    "ui",
    "apple",
    "visionos",
    "translucent",
    "panel",
    "clean",
    "modern",
    "gradient",
  ],
  word: "Focus",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const L = layout(w, h);
    const list = orbs(theme, t, w, h);
    const word = wordFor(theme.name, "Focus", 12);
    const family = theme.font || FAMILY;

    // The scene behind the glass, drawn small: orbs, then the word.
    const sk = 1 / 12;
    const sw = Math.max(8, Math.round(w * sk));
    const sh = Math.max(8, Math.round(h * sk));
    const kx = sw / w;
    const { canvas: sc, ctx: S } = buffer("frost-scene", sw, sh);
    S.globalCompositeOperation = "source-over";
    S.fillStyle = theme.bg;
    S.fillRect(0, 0, sw, sh);
    S.globalCompositeOperation = "lighter";
    drawOrbs(S, list, kx, theme.bg);
    S.globalCompositeOperation = "source-over";

    // Background outside the glass: the orbs only, smoothly upscaled.
    ground(ctx, w, h, theme.bg);
    const mw = Math.max(8, Math.round(w / 3));
    const mh = Math.max(8, Math.round(h / 3));
    const { canvas: mc, ctx: M } = buffer("frost-mid", mw, mh);
    const soften = () => {
      M.globalCompositeOperation = "source-over";
      M.fillStyle = theme.bg;
      M.fillRect(0, 0, mw, mh);
      M.filter = "blur(1.5px)";
      M.drawImage(sc as CanvasImageSource, 0, 0, mw, mh);
      M.filter = "none";
    };
    soften();
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mc as CanvasImageSource, 0, 0, w, h);
    ctx.restore();

    // The crisp word.
    ctx.save();
    ctx.letterSpacing = `${(-u * 0.006).toFixed(2)}px`;
    const fit = fitText(ctx, word, portrait ? w * 0.84 : w * 0.68, h * 0.3, u * 0.42, 650, family);
    ctx.font = fontOf("", 650, fit.size, family);
    const m = ctx.measureText(word);
    const wx = w / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const wy = h * 0.5 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillStyle = theme.ink;
    ctx.fillText(word, wx, wy);
    ctx.restore();

    // The same word blurred into the small scene, for behind the glass.
    S.save();
    S.letterSpacing = `${(-u * 0.006 * kx).toFixed(3)}px`;
    S.font = fontOf("", 650, fit.size * kx, family);
    S.fillStyle = rgba(theme.ink, 0.92);
    S.fillText(word, wx * kx, wy * kx);
    S.restore();
    soften();

    // Conveyor: two eased steps per loop, one period in total.
    const shift =
      L.P * 0.5 * (ease.inOutCubic(seg(t, 0.35, 1.75)) + ease.inOutCubic(seg(t, 2.85, 4.25))) -
      L.P * 0.18;
    let off = shift % L.P;
    if (off > 0) off -= L.P;
    const key = `${theme.ink}${theme.accent}${theme.accent2}${family}`;
    const pad = u * 0.12;
    const panesOn: { i: number; x: number }[] = [];
    for (let x0 = off; x0 < w; x0 += L.P)
      L.panes.forEach((p, i) => {
        const px = x0 + p.x;
        if (px - pad < w && px + p.w + pad > 0) panesOn.push({ i, x: px });
      });
    for (const { i, x } of panesOn) {
      const p = L.panes[i];
      const sh = bake(
        `frost-pshadow:${i}:${w}x${h}`,
        p.w + pad * 2,
        p.h + pad * 2,
        paneShadow(L, i, pad),
      );
      ctx.drawImage(sh as CanvasImageSource, x - pad, p.y - pad);
    }
    for (const { i, x: px } of panesOn) {
      const p = L.panes[i];
      if (px > w || px + p.w < 0) continue;
      ctx.save();
      paneShape(ctx, px, p.y, p.w, p.h, L.r);
      ctx.clip();
      // Thick glass magnifies a touch around its own centre.
      const cx = px + p.w / 2;
      const cy = p.y + p.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(1.06, 1.06);
      ctx.translate(-cx, -cy);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(mc as CanvasImageSource, 0, 0, w, h);
      ctx.restore();
      const glass = bake(
        `frost-pane:${i}:${w}x${h}:${key}`,
        p.w + RIM * 2,
        p.h + RIM * 2,
        paneGlass(theme, L, i),
      );
      ctx.drawImage(glass as CanvasImageSource, px - RIM, p.y - RIM);
    }

    // A fixed light reflection that the moving panes slide under.
    ctx.save();
    ctx.beginPath();
    for (let x0 = off; x0 < w; x0 += L.P)
      for (const p of L.panes) ctx.roundRect(x0 + p.x, p.y, p.w, p.h, L.r);
    ctx.clip();
    const sheen = ctx.createLinearGradient(w * 0.2, 0, w * 0.55, h);
    sheen.addColorStop(0, rgba(theme.ink, 0));
    sheen.addColorStop(0.46, rgba(theme.ink, 0));
    sheen.addColorStop(0.52, rgba(theme.ink, 0.09));
    sheen.addColorStop(0.6, rgba(theme.ink, 0.02));
    sheen.addColorStop(0.7, rgba(theme.ink, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const mark = tintedLogo(theme, rgba(theme.ink, 0.8), u * 0.06, u * 0.06);
    if (mark) ctx.drawImage(mark as CanvasImageSource, u * 0.05, u * 0.05);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
  },
};
