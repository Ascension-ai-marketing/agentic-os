import { adjust, mix, rgba } from "../engine/color";
import { tintedLogo } from "../engine/assets";
import {
  ease,
  font,
  frameOf,
  grain,
  ground,
  light,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { glow, studio, unit } from "./_s6-helpers";

const ARCHIVO = '"Archivo", "Helvetica Neue", Arial, sans-serif';
const E = 0.4;
const V = 0.92;

type Part = { key: string; name: string; spec: string; r: number; h: number; y0: number };
/** A made-up puck speaker, bottom to top. y0 is where each part sits when assembled. */
const PARTS: Part[] = [
  { key: "base", name: "Base shell", spec: "ALUMINIUM", r: 1.02, h: 0.9, y0: 0 },
  { key: "driver", name: "Driver", spec: "40 MM", r: 0.9, h: 0.14, y0: 0.05 },
  { key: "cell", name: "Cell", spec: "2,400 MAH", r: 0.8, h: 0.34, y0: 0.2 },
  { key: "board", name: "Logic board", spec: "6 LAYERS", r: 0.92, h: 0.05, y0: 0.6 },
  { key: "ring", name: "Light ring", spec: "24 LEDS", r: 0.95, h: 0.07, y0: 0.83 },
  { key: "cap", name: "Glass cap", spec: "2 MM", r: 1.02, h: 0.07, y0: 0.9 },
];
const HEIGHT = 0.97;
/** Where part i hangs when exploded: every part clears the cup, one gap apart. */
const lifted = (i: number, gap: number) => (i === 0 ? 0 : 1.08 + (i - 1) * gap);

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h) * (portrait ? 1.05 : 1);
  if (portrait)
    return {
      U,
      portrait,
      cx: w * 0.31,
      pushX: w * 0.3,
      zoomMax: 1.25,
      cy: h * 0.55,
      S: w * 0.2,
      gap: 0.7,
      labelX: w * 0.57,
    };
  if (square)
    return {
      U,
      portrait,
      cx: w * 0.3,
      pushX: w * 0.29,
      zoomMax: 1.4,
      cy: h * 0.57,
      S: h * 0.15,
      gap: 0.5,
      labelX: w * 0.56,
    };
  return {
    U,
    portrait,
    cx: w * 0.35,
    pushX: w * 0.34,
    zoomMax: 1.6,
    cy: h * 0.56,
    S: h * 0.182,
    gap: 0.5,
    labelX: w * 0.58,
  };
}

/** Assembly progress of part i (0 exploded, 1 seated). The base never moves. */
function seated(i: number, t: number) {
  if (i === 0) return 1;
  const land = 0.85 + (i - 1) * 0.26;
  const lift = 3.7 + (PARTS.length - 1 - i) * 0.12;
  return (
    ease.inOutCubic(seg(t, land, land + 0.5)) * (1 - ease.inOutCubic(seg(t, lift, lift + 0.55)))
  );
}

/** A shaded cylinder (optionally a ring) standing with its top centre at (x, yTop). */
function cylinder(
  c: Ctx2D,
  x: number,
  yTop: number,
  r: number,
  hgt: number,
  side: string,
  top: string,
  theme: Theme,
  hole = 0,
) {
  const ry = r * E;
  const yBot = yTop + hgt;
  if (hgt > 0.5) {
    c.beginPath();
    c.ellipse(x, yTop, r, ry, 0, 0, Math.PI);
    c.lineTo(x - r, yBot);
    c.ellipse(x, yBot, r, ry, 0, Math.PI, 0, true);
    c.closePath();
    const g = c.createLinearGradient(x - r, 0, x + r, 0);
    g.addColorStop(0, mix(side, "#000000", 0.6));
    g.addColorStop(0.24, mix(side, theme.ink, 0.38));
    g.addColorStop(0.34, mix(side, theme.ink, 0.12));
    g.addColorStop(0.7, mix(side, "#000000", 0.25));
    g.addColorStop(1, mix(side, "#000000", 0.72));
    c.fillStyle = g;
    c.fill();
  }
  c.beginPath();
  c.ellipse(x, yTop, r, ry, 0, 0, TAU);
  if (hole > 0) c.ellipse(x, yTop, r * hole, ry * hole, 0, 0, TAU);
  const tg = c.createLinearGradient(x - r, yTop - ry, x + r * 0.6, yTop + ry);
  tg.addColorStop(0, mix(top, theme.ink, 0.18));
  tg.addColorStop(1, mix(top, "#000000", 0.25));
  c.fillStyle = tg;
  c.fill("evenodd");
  // The front edge of the top face catches the light; the back edge stays quiet.
  c.lineWidth = Math.max(1, r * 0.008);
  c.strokeStyle = rgba(theme.ink, 0.42);
  c.beginPath();
  c.ellipse(x, yTop, r, ry, 0, 0.15, Math.PI - 0.15);
  c.stroke();
  c.strokeStyle = rgba(theme.ink, 0.14);
  c.beginPath();
  c.ellipse(x, yTop, r, ry, 0, Math.PI, TAU);
  c.stroke();
}

export const style: MotionStyle = {
  id: "exploded-view",
  name: "Exploded View",
  family: "Data & Diagrams",
  tagline: "A product, exploded on its axis",
  look: "A product engineering render: a puck speaker exploded along its axis in axonometric, brushed parts, numbered callouts, a dimension line.",
  move: "The parts drop into the shell bottom to top, the cap clicks shut with a flash, the camera pushes in, the light ring chases, then it explodes again.",
  rules: [
    "One assembly axis: parts only travel along it, dashed guide always visible.",
    "Assemble bottom to top, explode top to bottom, each part on its own beat.",
    "Parts disappear into the shell behind its front wall; the cap clicks shut with a flash.",
    "Callouts are numbered, aligned in one column, leaders with one elbow.",
    "Materials read from shading alone: brushed sides, bright rims, glass glint.",
    "The accent lives on the numbers and the light ring, nowhere else.",
    "Assembled, the camera pushes in and a dimension line states the height.",
  ],
  prompt: `R — References
• Product exploded views in engineering renders and teardown posters (search: exploded view product render, axonometric exploded diagram).
• Technical illustration callouts: numbered leaders aligned in a column.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a puck speaker hangs exploded along a dashed axis, six parts with numbered callouts ("01 Base shell" to "06 Glass cap"); the parts start dropping into place from the bottom up.
• Middle (1.5–3.5 s): each part sinks into the aluminium shell and the glass cap clicks shut with a flash; the assembled puck gets a camera push-in, its light ring chases through the glass and a dimension line reads the height.
• End (3.5–5 s): the camera pulls back and the parts lift off top down into the exploded first frame.

S — Style
Looks: {{bg}} studio ground with a soft key light; parts in brushed {{accent2}} and dark glass, bright rims; callout numbers and the light ring in {{accent}}; names in {{font}}, specs in small caps; a dashed axis and hairline leaders in {{ink}}.
Moves: each part travels 0.5 s (inOutCubic), 0.26 s apart, hidden by the shell's front wall as it enters; the cap's flash lasts 0.4 s; the push-in is 0.6 s; the ring chase runs one lap; the explode is 0.55 s per part, 0.12 s apart.
Rules:
1. Travel only along the assembly axis.
2. Bottom-up assembly, top-down explode.
3. The shell's front wall hides what goes inside it; the cap clicks shut.
4. Numbered callouts in one aligned column.
5. Accent only on numbers and the light ring.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; parts never intersect while travelling; every leader ends on its part; callouts never overlap; the assembled puck reads as one object. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Exploded-view_drawing",
  theme: {
    bg: "#0c0d0f",
    ink: "#eceff2",
    accent: "#b4ff39",
    accent2: "#8d97a3",
    font: "Archivo",
  },
  fonts: ["Archivo:wght@100..900"],
  tags: [
    "exploded",
    "technical",
    "product",
    "engineering",
    "diagram",
    "assembly",
    "hardware",
    "parts",
    "callout",
    "industrial",
    "device",
  ],
  word: "Model",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U } = lay;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "explode", w, h, { lx: 0.3, ly: 0.25, mottle: 0.8 }) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, lay.cx, h * 0.5, Math.max(w, h) * 0.45, theme.accent2, 0.08);

    const all = Math.min(...PARTS.map((_, i) => seated(i, t)));
    // The camera starts pushing in while the last parts drop, and pulls back as they lift.
    const push = ease.inOutCubic(seg(t, 1.9, 2.6)) * (1 - ease.inOutCubic(seg(t, 3.6, 4.25)));
    const zoom = 1 + (lay.zoomMax - 1) * push;
    const cx = lay.cx + (lay.pushX - lay.cx) * push;
    const steelTone = adjust(theme.accent2, 0, 0.35);
    const S = lay.S * zoom;
    const GAP = lay.gap;
    // The camera keeps the current stack centred, so it recentres as the parts close up.
    const posOf = (i: number) => {
      const k = seated(i, t);
      return lifted(i, GAP) + (PARTS[i].y0 - lifted(i, GAP)) * k;
    };
    const stackTop = PARTS.reduce((m, p, i) => Math.max(m, posOf(i) + p.h), 0);
    const midWorld = stackTop / 2;
    const Y = (yw: number) => lay.cy - (yw - midWorld) * S * V;
    const last = PARTS.length - 1;
    const explodedTop = lifted(last, GAP) + PARTS[last].h;
    // Callout rows are evenly spaced between the exploded cap and the shell.
    const rowAt = (yw: number) => lay.cy - (yw - explodedTop / 2) * lay.S * V;
    const rowTop = rowAt(lifted(last, GAP) + PARTS[last].h / 2);
    const rowBot = rowAt(PARTS[0].h * 0.5);
    const labelY = (i: number) => rowTop + ((last - i) / last) * (rowBot - rowTop);

    // Dashed assembly axis.
    ctx.strokeStyle = rgba(theme.ink, 0.22);
    ctx.lineWidth = Math.max(1, U);
    ctx.setLineDash([6 * U, 8 * U]);
    ctx.beginPath();
    ctx.moveTo(cx, Y(stackTop + 0.35));
    ctx.lineTo(cx, Y(-0.35));
    ctx.stroke();
    ctx.setLineDash([]);

    // Parts, bottom to top (each top face is drawn over the part below).
    const ends: { x: number; y: number }[] = [];
    const flashes: { y: number; r: number; a: number }[] = [];
    const baseFront = () => {
      // The cup's front wall and lip, drawn again over whatever sits inside it.
      const p = PARTS[0];
      const r = p.r * S;
      const yTop = Y(p.h);
      const yBot = yTop + p.h * S * V;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, yTop, r, r * E, 0, 0, Math.PI);
      ctx.lineTo(cx - r, yBot);
      ctx.ellipse(cx, yBot, r, r * E, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.clip();
      cylinder(
        ctx,
        cx,
        yTop,
        r,
        p.h * S * V,
        steelTone,
        mix(steelTone, theme.bg, 0.25),
        theme,
        0.94,
      );
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(cx, yTop, r, r * E, 0, 0, Math.PI);
      ctx.ellipse(cx, yTop, r * 0.94, r * 0.94 * E, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fillStyle = mix(steelTone, theme.ink, 0.2);
      ctx.fill();
    };
    PARTS.forEach((p, i) => {
      if (i === PARTS.length - 1) baseFront();
      const k = seated(i, t);
      const yw = posOf(i);
      const yTop = Y(yw + p.h);
      const hgt = p.h * S * V;
      const r = p.r * S;
      const steel = steelTone;
      // Contact shadow on the part below.
      if (i > 0)
        glow(
          ctx,
          cx,
          Y(yw) + r * E * 0.3,
          r * 1.05,
          "#000000",
          0.35 * (0.4 + 0.6 * k),
          "source-over",
        );
      if (p.key === "base") {
        cylinder(ctx, cx, yTop, r, hgt, steel, mix(steel, theme.bg, 0.25), theme, 0.94);
        // The cup's dark interior.
        const inner = ctx.createLinearGradient(0, yTop - r * E, 0, yTop + r * E);
        inner.addColorStop(0, mix(theme.bg, "#000000", 0.6));
        inner.addColorStop(1, mix(theme.bg, theme.accent2, 0.15));
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.ellipse(cx, yTop, r * 0.94, r * 0.94 * E, 0, 0, TAU);
        ctx.fill();
      } else if (p.key === "driver") {
        cylinder(
          ctx,
          cx,
          yTop,
          r,
          hgt,
          mix(theme.bg, theme.ink, 0.2),
          mix(theme.bg, theme.ink, 0.1),
          theme,
        );
        const cone = ctx.createRadialGradient(cx, yTop, 0, cx, yTop, r);
        cone.addColorStop(0, rgba("#000000", 0.5));
        cone.addColorStop(0.8, rgba(theme.ink, 0.06));
        cone.addColorStop(1, rgba(theme.ink, 0.12));
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.ellipse(cx, yTop, r * 0.92, r * 0.92 * E, 0, 0, TAU);
        ctx.fill();
        for (let q = 1; q <= 4; q++) {
          ctx.strokeStyle = rgba(theme.ink, 0.12 + q * 0.03);
          ctx.lineWidth = Math.max(1, U);
          ctx.beginPath();
          ctx.ellipse(cx, yTop, r * (1 - q * 0.17), r * (1 - q * 0.17) * E, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.fillStyle = mix(theme.bg, theme.ink, 0.25);
        ctx.beginPath();
        ctx.ellipse(cx, yTop, r * 0.18, r * 0.18 * E, 0, 0, TAU);
        ctx.fill();
      } else if (p.key === "cell") {
        cylinder(
          ctx,
          cx,
          yTop,
          r,
          hgt,
          mix(steel, theme.ink, 0.25),
          mix(steel, theme.ink, 0.15),
          theme,
        );
        // A printed band around the cell.
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, yTop + hgt * 0.35, r, r * E, 0, 0, Math.PI);
        ctx.lineTo(cx - r, yTop + hgt * 0.65);
        ctx.ellipse(cx, yTop + hgt * 0.65, r, r * E, 0, Math.PI, 0, true);
        ctx.closePath();
        ctx.fillStyle = rgba(mix(theme.bg, theme.accent, 0.5), 0.55);
        ctx.fill();
        ctx.restore();
      } else if (p.key === "board") {
        cylinder(
          ctx,
          cx,
          yTop,
          r,
          hgt,
          mix(theme.bg, theme.accent, 0.22),
          mix(theme.bg, theme.accent, 0.16),
          theme,
        );
        // Chips: small boxes on the board.
        const chips: [number, number, number, number][] = [
          [-0.35, -0.2, 0.34, 0.26],
          [0.2, -0.35, 0.22, 0.2],
          [0.25, 0.15, 0.3, 0.22],
          [-0.3, 0.3, 0.18, 0.14],
        ];
        for (const [cxw, czw, sw, sd] of chips) {
          const x0 = cx + cxw * r;
          const y0 = yTop + czw * r * E;
          const hh = 0.05 * S;
          ctx.fillStyle = mix(theme.bg, "#000000", 0.3);
          ctx.fillRect(x0 - (sw * r) / 2, y0 - (sd * r * E) / 2 - hh, sw * r, sd * r * E + hh);
          ctx.fillStyle = mix(theme.bg, theme.ink, 0.32);
          ctx.fillRect(x0 - (sw * r) / 2, y0 - (sd * r * E) / 2 - hh, sw * r, sd * r * E);
        }
      } else if (p.key === "ring") {
        cylinder(
          ctx,
          cx,
          yTop,
          r,
          hgt,
          mix(theme.bg, theme.ink, 0.16),
          mix(theme.bg, theme.ink, 0.14),
          theme,
          0.84,
        );
        // 24 LEDs: dim when exploded, chasing once around when assembled.
        const chase = seg(t, 2.5, 3.55);
        for (let q = 0; q < 24; q++) {
          const a = (q / 24) * TAU;
          const lx = cx + Math.cos(a) * r * 0.92;
          const ly = yTop + Math.sin(a) * r * 0.92 * E;
          const head = (chase * 24 - q + 24) % 24;
          const on = chase > 0 && chase < 1 ? Math.max(0, 1 - head / 8) : 0;
          const a2 = Math.min(1, 0.55 + on);
          ctx.fillStyle = rgba(theme.accent, a2);
          ctx.beginPath();
          ctx.ellipse(lx, ly, 4.5 * U * zoom, 2.2 * U * zoom, 0, 0, TAU);
          ctx.fill();
          if (on > 0.2) glow(ctx, lx, ly, 22 * U * zoom, theme.accent, on * 0.6);
        }
      } else if (p.key === "cap") {
        cylinder(
          ctx,
          cx,
          yTop,
          r,
          hgt,
          mix(theme.bg, theme.ink, 0.28),
          mix(theme.bg, theme.accent2, 0.2),
          theme,
        );
        // Glass: a sky reflection, a moving glint, and the light ring chasing through it once seated.
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, yTop, r, r * E, 0, 0, TAU);
        ctx.clip();
        const sky = ctx.createLinearGradient(
          cx - r,
          yTop - r * E,
          cx + r * 0.2,
          yTop + r * E * 0.4,
        );
        sky.addColorStop(0, rgba(theme.ink, 0.2));
        sky.addColorStop(0.5, rgba(theme.ink, 0.04));
        sky.addColorStop(0.51, rgba(theme.ink, 0));
        ctx.fillStyle = sky;
        ctx.fillRect(cx - r, yTop - r * E, r * 2, r * 2 * E);
        // The brand etched into the glass: the logo when there is one, else the word.
        const mark = tintedLogo(theme, theme.ink, r * 0.5, r * 0.5);
        ctx.save();
        ctx.translate(cx, yTop);
        ctx.scale(1, E);
        ctx.globalAlpha = 0.3;
        if (mark) ctx.drawImage(mark as CanvasImageSource, -r * 0.25, -r * 0.25, r * 0.5, r * 0.5);
        else {
          ctx.fillStyle = theme.ink;
          ctx.font = font(700, r * 0.24, theme.font, ARCHIVO);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(wordFor(theme.name, "P1", 10), 0, 0);
        }
        ctx.restore();
        const chase = seg(t, 2.45, 3.6);
        if (chase > 0 && chase < 1)
          for (let q = 0; q < 24; q++) {
            const a = (q / 24) * TAU;
            const head = (chase * 24 - q + 24) % 24;
            const on = Math.max(0, 1 - head / 8) * k;
            if (on <= 0.01) continue;
            const lx = cx + Math.cos(a) * r * 0.9;
            const ly = yTop + Math.sin(a) * r * 0.9 * E;
            glow(ctx, lx, ly, r * 0.16, theme.accent, on * 0.8);
            ctx.fillStyle = rgba(mix(theme.accent, theme.ink, 0.4), on);
            ctx.beginPath();
            ctx.ellipse(lx, ly, r * 0.022, r * 0.022 * E, 0, 0, TAU);
            ctx.fill();
          }
        const gx = cx - 1.4 * r + (((t / 5) * 2) % 1) * r * 3.2;
        const g = ctx.createLinearGradient(gx - r * 0.3, 0, gx + r * 0.3, 0);
        g.addColorStop(0, rgba(theme.ink, 0));
        g.addColorStop(0.5, rgba(theme.ink, 0.22));
        g.addColorStop(1, rgba(theme.ink, 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, yTop - r * E, r * 2, r * 2 * E);
        ctx.restore();
      }
      ends.push({ x: cx + r, y: yTop + hgt / 2 });
      // Seat flash as the part lands.
      const land = 0.85 + (i - 1) * 0.26 + 0.5;
      const since = t - land;
      if (i === PARTS.length - 1 && since > 0 && since < 0.4)
        flashes.push({ y: Y(p.y0), r: p.r * S, a: 1 - since / 0.4 });
    });
    for (const f of flashes) {
      ctx.strokeStyle = rgba(theme.accent, 0.9 * f.a);
      ctx.lineWidth = Math.max(1, 2 * U);
      ctx.beginPath();
      ctx.ellipse(
        cx,
        f.y,
        f.r * (1.02 + (1 - f.a) * 0.12),
        f.r * (1.02 + (1 - f.a) * 0.12) * E,
        0,
        0,
        TAU,
      );
      ctx.stroke();
    }

    // Callouts: one column, numbered, leaders with one elbow.
    const labelA =
      1 - 0.6 * ease.inOutCubic(seg(t, 1.2, 2.2)) * (1 - ease.inOutCubic(seg(t, 3.7, 4.5)));
    for (let i = PARTS.length - 1; i >= 0; i--) {
      const ly = labelY(i);
      const e = ends[i];
      const elbow = lay.labelX - 40 * U;
      ctx.strokeStyle = rgba(theme.ink, 0.35 * labelA + 0.1);
      ctx.lineWidth = Math.max(1, U);
      ctx.beginPath();
      ctx.moveTo(e.x + 8 * U, e.y);
      ctx.lineTo(elbow - 30 * U, e.y);
      ctx.lineTo(elbow, ly);
      ctx.lineTo(lay.labelX - 12 * U, ly);
      ctx.stroke();
      ctx.fillStyle = rgba(theme.ink, 0.6);
      ctx.beginPath();
      ctx.arc(e.x + 8 * U, e.y, 3 * U, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.globalAlpha = labelA;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = theme.accent;
      ctx.font = font(700, 22 * U, theme.font, ARCHIVO);
      ctx.fillText(String(i + 1).padStart(2, "0"), lay.labelX, ly);
      ctx.fillStyle = theme.ink;
      ctx.font = font(500, 30 * U, theme.font, ARCHIVO);
      ctx.fillText(PARTS[i].name, lay.labelX + 44 * U, ly - 1 * U);
      const nw = ctx.measureText(PARTS[i].name).width;
      ctx.fillStyle = rgba(theme.ink, 0.45);
      ctx.font = font(500, 15 * U, theme.font, ARCHIVO);
      ctx.letterSpacing = `${(1.6 * U).toFixed(2)}px`;
      ctx.fillText(PARTS[i].spec, lay.labelX + 44 * U + nw + 14 * U, ly + 2 * U);
      ctx.letterSpacing = "0px";
      ctx.restore();
    }

    // Dimension line while assembled.
    const dim = ease.outCubic(seg(t, 2.6, 2.9)) * (1 - ease.inOutCubic(seg(t, 3.45, 3.7))) * all;
    if (dim > 0.01) {
      const x = cx - 1.02 * S - 40 * U;
      const yA = Y(HEIGHT) - 0;
      const yB = Y(0);
      ctx.save();
      ctx.globalAlpha = dim;
      ctx.strokeStyle = rgba(theme.ink, 0.7);
      ctx.lineWidth = Math.max(1, 1.3 * U);
      ctx.beginPath();
      ctx.moveTo(x, yA);
      ctx.lineTo(x, yB);
      ctx.moveTo(x - 10 * U, yA);
      ctx.lineTo(x + 10 * U, yA);
      ctx.moveTo(x - 10 * U, yB);
      ctx.lineTo(x + 10 * U, yB);
      ctx.stroke();
      ctx.translate(x - 16 * U, (yA + yB) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = theme.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = font(500, 24 * U, theme.font, ARCHIVO);
      ctx.fillText("48 mm", 0, 0);
      ctx.restore();
    }

    // Title.
    const L = Math.max(w * (lay.portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
    const ty = h * (lay.portrait ? 0.08 : 0.13);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(700, 52 * U, theme.font, ARCHIVO);
    ctx.letterSpacing = `${(-0.8 * U).toFixed(2)}px`;
    ctx.fillText("Exploded view", L, ty);
    ctx.letterSpacing = `${(2.2 * U).toFixed(2)}px`;
    ctx.fillStyle = rgba(theme.ink, 0.45);
    ctx.font = font(500, 16 * U, theme.font, ARCHIVO);
    ctx.fillText(
      `${wordFor(theme.name, "MODEL P1", 16).toUpperCase()} · SIX PARTS`,
      L,
      ty + 34 * U,
    );
    ctx.letterSpacing = "0px";

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.22);
  },
};
