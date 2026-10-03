import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  ease,
  fbm3,
  fitSize,
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
import { polyPath, tornLine, type Pt } from "./_s1-helpers";

const COND = '"Anton", Impact, "Arial Narrow", sans-serif';
const PEEL0 = 0.4;
const PEEL1 = 2.0;
const RIP1 = 2.3;
const PASTE0 = 3.6;
const PASTE1 = 4.5;

type Box = { x: number; y: number; w: number; h: number };

function posterBox(w: number, h: number): Box {
  const { portrait, square } = frameOf(w, h);
  const pw = w * (portrait ? 0.84 : square ? 0.8 : 0.62);
  const ph = h * (portrait ? 0.78 : square ? 0.84 : 0.9);
  return { x: (w - pw) / 2, y: (h - ph) / 2, w: pw, h: ph };
}

/** Concrete wall with old paste stains. */
function wall(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = mix(theme.bg, theme.ink, 0.06);
    c.fillRect(0, 0, w, h);
    const step = Math.max(3, Math.round(u / 150));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.12), y / (u * 0.12), 5.5, 4);
        c.fillStyle = n > 0 ? rgba(theme.ink, 0.05 * n) : rgba("#000000", -0.35 * n);
        c.fillRect(x, y, step, step);
      }
    const r = rng(77);
    for (let i = 0; i < (w * h) / 700; i++) {
      c.fillStyle = r() < 0.5 ? rgba("#000000", 0.25) : rgba(theme.ink, 0.05);
      c.fillRect(r() * w, r() * h, u * 0.002, u * 0.002);
    }
  };
}

/** Printed poster faces. kind 0 = the top poster (word), 1 = the blue one below, 2 = the oldest. */
function face(theme: Theme, kind: number, word: string) {
  return (c: Ctx2D, w: number, h: number) => {
    const m = Math.min(w, h);
    const bgc =
      kind === 0 ? theme.accent : kind === 1 ? theme.accent2 : mix(theme.ink, theme.bg, 0.1);
    const fg =
      kind === 0
        ? mix(theme.bg, "#000000", 0.3)
        : kind === 1
          ? theme.ink
          : mix(theme.bg, "#000000", 0.2);
    c.fillStyle = bgc;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.textBaseline = "alphabetic";
    if (kind === 0) {
      // Halftone sun top right.
      c.fillStyle = rgba(theme.ink, 0.85);
      const cx = w * 0.72;
      const cy = h * 0.24;
      const R = m * 0.26;
      const p = m * 0.028;
      for (let y = cy - R; y < cy + R; y += p)
        for (let x = cx - R; x < cx + R; x += p) {
          const d = Math.hypot(x - cx, y - cy) / R;
          if (d > 1) continue;
          const rr = p * 0.5 * Math.sqrt(1 - d * d * 0.85);
          c.beginPath();
          c.arc(x, y, rr, 0, TAU);
          c.fill();
        }
      c.fillStyle = fg;
      const label = word.toUpperCase();
      const size = fitSize(c, label, w * 0.86, h * 0.34, 400, "Anton", COND);
      c.font = font(400, size, "Anton", COND);
      c.fillText(label, w * 0.07, h * 0.72);
      c.font = font(700, m * 0.045, "Inter");
      c.fillText("DOORS 8 PM  ·  NO. 07  ·  ALL NIGHT", w * 0.07, h * 0.8);
      c.fillRect(w * 0.07, h * 0.84, w * 0.86, m * 0.008);
      c.font = font(400, m * 0.1, "Anton", COND);
      c.fillText("24.09", w * 0.07, h * 0.95);
    } else if (kind === 1) {
      c.font = font(400, h * 0.62, "Anton", COND);
      c.fillText("LIVE", w * 0.05, h * 0.6);
      c.font = font(400, h * 0.3, "Anton", COND);
      c.fillText("07", w * 0.05, h * 0.92);
      c.fillStyle = rgba(theme.ink, 0.8);
      c.font = font(700, m * 0.045, "Inter");
      c.fillText("THE BASEMENT · FRIDAY", w * 0.42, h * 0.8);
    } else {
      c.font = font(400, h * 0.22, "Anton", COND);
      c.fillText("SALE", w * 0.06, h * 0.25);
      c.fillStyle = rgba(fg, 0.6);
      for (let y = h * 0.34; y < h * 0.95; y += m * 0.04)
        c.fillRect(w * 0.06, y, w * (0.5 + 0.35 * hash(y | 0, 3)), m * 0.012);
    }
    // Paper: grain, wheat-paste wrinkles and weathering.
    const r = rng(kind * 17 + 3);
    for (let i = 0; i < 26; i++) {
      const x = r() * w;
      const len = h * (0.1 + r() * 0.4);
      const g = c.createLinearGradient(x - m * 0.01, 0, x + m * 0.01, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, r() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(x - m * 0.01, r() * h * 0.7, m * 0.02, len);
    }
    for (let i = 0; i < (w * h) / 500; i++) {
      c.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)";
      c.fillRect(r() * w, r() * h, m * 0.003, m * 0.003);
    }
  };
}

/** The back of the top poster: paste-stained paper with the print faintly through it. */
function backFace(theme: Theme, word: string) {
  return (c: Ctx2D, w: number, h: number) => {
    face(theme, 0, word)(c, w, h);
    c.fillStyle = rgba(mix(theme.ink, theme.accent, 0.12), 0.92);
    c.fillRect(0, 0, w, h);
    const { u } = frameOf(w, h);
    const step = Math.max(3, Math.round(u / 90));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.2), y / (u * 0.2), 2.4, 3);
        if (n > 0.05) {
          c.fillStyle = rgba(mix(theme.ink, theme.accent, 0.28), Math.min(0.5, n));
          c.fillRect(x, y, step, step);
        }
      }
  };
}

export const style: MotionStyle = {
  id: "torn-poster",
  name: "Torn Street Posters",
  family: "Print & Craft",
  tagline: "Gig posters peeling off a wall",
  look: "A wall of wheat-pasted gig posters: the top one peels back in a curling flap with a white fibre edge, revealing the layers below.",
  move: "A corner lifts and the poster peels diagonally, the flap rips away, the layer beneath holds, then a fresh copy is rolled on from the top.",
  rules: [
    "Every torn edge shows the white paper core, jagged and fibrous.",
    "The flap shows the back of the poster: paste-stained, the print faint through it.",
    "The flap casts a shadow on the layers below; the curl darkens toward the fold.",
    "Layers underneath are real posters with their own type and tears.",
    "Big condensed type, flat inks, wheat-paste wrinkles.",
    "Re-paste with a roll from the top, wet sheen drying off.",
    "Hold the revealed layer at least a second.",
  ],
  prompt: `R — References
• Layered street posters and décollage (search: torn posters wall, Mimmo Rotella décollage, wheatpaste poster peeling).
• Gig posters in heavy condensed type on flat inks.

I — Idea
A poster peels off a wall, 5 seconds, looping seamlessly:
• Beginning (0.4–2 s): the corner of an orange poster reading "{{name}}" lifts and peels diagonally, a curling flap showing its paste-stained back; the blue poster underneath appears.
• Middle (2–3.6 s): the flap rips away and falls; the wall holds with the torn remnant, the blue layer and older scraps showing through its tears.
• End (3.6–5 s): a fresh copy is rolled on from the top, wet and glossy, drying back to the opening frame.

S — Style
Looks: {{bg}} concrete; the top poster in {{accent}} with near-black type and a halftone sun; the next in {{accent2}} with {{ink}} type; an old cream poster below; torn edges with a white fibrous core; soft shadows under every flap.
Moves: the peel eases out (fast lift, slow finish), the rip is quick with a fall, the paste roll eases in-out; nothing else moves.
Rules:
1. White fibrous core on every tear.
2. The flap shows the back.
3. Flap shadows and curl shading.
4. Real posters underneath.
5. Condensed type, flat inks, wrinkles.
6. Re-paste from the top with a wet sheen.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the torn edge has a visible white core; the flap reads as the back of the paper; the type on the top poster is readable at 0 s; nothing looks like a flat vector cut. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/D%C3%A9collage",
  theme: {
    bg: "#121212",
    ink: "#efe9df",
    accent: "#ff5a1f",
    accent2: "#2b56e0",
    font: "Anton",
  },
  fonts: ["Anton", "Inter:wght@700"],
  tags: [
    "poster",
    "torn",
    "street",
    "wheatpaste",
    "decollage",
    "gig poster",
    "urban",
    "paper",
    "layers",
    "grunge",
    "type",
  ],
  word: "Tonight",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const key = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`;
    ctx.drawImage(bake(`tp-wall:${key}`, w, h, wall(theme)) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.4, h * 0.3, Math.max(w, h) * 0.8, theme.ink, 0.06);

    const B = posterBox(w, h);
    const word = wordFor(theme.name, "Tonight", 12);
    const fA = bake(`tp-a:${key}|${word}`, B.w, B.h, face(theme, 0, word));
    const fB = bake(`tp-b:${key}`, B.w, B.h, face(theme, 1, word));
    const fC = bake(`tp-c:${key}`, B.w, B.h, face(theme, 2, word));
    const fBack = bake(`tp-back:${key}|${word}`, B.w, B.h, backFace(theme, word));
    const fibre = mix(theme.ink, "#ffffff", 0.2);

    // Old layers under everything: the cream poster, then the blue one with a torn hole.
    const shadowed = (draw: () => void, blur = u * 0.015) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = blur;
      ctx.shadowOffsetY = u * 0.004;
      draw();
      ctx.restore();
    };
    shadowed(() => ctx.drawImage(fC as CanvasImageSource, B.x - B.w * 0.08, B.y + B.h * 0.04));
    const holeA = tornLine(
      [B.x + B.w * 0.62, B.y + B.h],
      [B.x + B.w, B.y + B.h * 0.55],
      5,
      u * 0.03,
      u * 0.012,
    );
    const bPoly: Pt[] = [
      [B.x, B.y],
      [B.x + B.w, B.y],
      ...holeA.slice().reverse(),
      [B.x, B.y + B.h],
    ];
    ctx.save();
    shadowed(() => {
      polyPath(ctx, bPoly);
      ctx.fillStyle = theme.accent2;
      ctx.fill();
    });
    polyPath(ctx, bPoly);
    ctx.clip();
    ctx.drawImage(fB as CanvasImageSource, B.x, B.y);
    ctx.restore();
    ctx.strokeStyle = fibre;
    ctx.lineWidth = Math.max(1, u * 0.004);
    polyPath(ctx, holeA, false);
    ctx.stroke();

    // The top poster: intact, peeling, torn, or being re-pasted.
    const corner: Pt = [B.x + B.w, B.y + B.h];
    const dir: Pt = [-0.78, -0.62];
    const diag = B.w * 0.78 + B.h * 0.62;
    const peel = ease.outCubic(seg(t, PEEL0, PEEL1));
    const s = diag * 0.66 * peel;
    const ripped = t >= PEEL1;
    const pasting = t >= PASTE0 && t < PASTE1;
    const pasted = t >= PASTE1 || t < PEEL0;

    // The tear line across the poster, perpendicular to the peel direction, at distance s.
    const tearAt = (dist: number): Pt[] => {
      const px = corner[0] + dir[0] * dist;
      const py = corner[1] + dir[1] * dist;
      const tx = -dir[1];
      const ty = dir[0];
      const L = diag * 1.2;
      return tornLine(
        [px - tx * L, py - ty * L],
        [px + tx * L, py + ty * L],
        21,
        u * 0.018,
        u * 0.01,
      );
    };
    const drawA = (clip: Pt[] | null) => {
      ctx.save();
      if (clip) {
        polyPath(ctx, clip);
        ctx.clip();
      }
      shadowed(() => ctx.drawImage(fA as CanvasImageSource, B.x, B.y), u * 0.02);
      const mark = tintedLogo(theme, rgba(theme.bg, 0.9), B.w * 0.14, B.w * 0.14);
      if (mark) ctx.drawImage(mark as CanvasImageSource, B.x + B.w * 0.06, B.y + B.w * 0.06);
      ctx.restore();
    };
    // The region of A still stuck to the wall: the far side of the tear line.
    const tearFinal = tearAt(diag * 0.66);
    const keepPoly = (line: Pt[]): Pt[] => {
      const far = diag * 3;
      return [
        ...line,
        [line[line.length - 1][0] + dir[0] * far, line[line.length - 1][1] + dir[1] * far],
        [line[0][0] + dir[0] * far, line[0][1] + dir[1] * far],
      ];
    };
    const boxPoly: Pt[] = [
      [B.x, B.y],
      [B.x + B.w, B.y],
      [B.x + B.w, B.y + B.h],
      [B.x, B.y + B.h],
    ];

    if (pasted) {
      drawA(null);
      // Wet sheen drying off after the paste.
      const since = (((t - PASTE1) % LOOP) + LOOP) % LOOP;
      const wet = Math.exp(-since / 0.45);
      if (wet > 0.01) {
        ctx.save();
        ctx.globalAlpha = wet * 0.5;
        const g = ctx.createLinearGradient(B.x, B.y, B.x + B.w, B.y + B.h);
        g.addColorStop(0, "rgba(0,0,0,0.3)");
        g.addColorStop(0.45, rgba(theme.ink, 0.35));
        g.addColorStop(0.55, "rgba(0,0,0,0.25)");
        g.addColorStop(1, "rgba(0,0,0,0.35)");
        ctx.fillStyle = g;
        ctx.fillRect(B.x, B.y, B.w, B.h);
        ctx.restore();
      }
    } else {
      // Torn remnant (and, while peeling, the part still to come).
      const line = ripped ? tearFinal : tearAt(s);
      const keep = keepPoly(line);
      ctx.save();
      polyPath(ctx, boxPoly);
      ctx.clip();
      drawA(keep);
      ctx.restore();
      // White fibrous core along the tear.
      ctx.save();
      polyPath(ctx, boxPoly);
      ctx.clip();
      ctx.strokeStyle = fibre;
      ctx.lineWidth = Math.max(1.2, u * 0.006);
      polyPath(ctx, line, false);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.6, u * 0.002);
      ctx.strokeStyle = rgba(fibre, 0.6);
      for (let i = 0; i < line.length - 1; i += 3) {
        const [x, y] = line[i];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - dir[0] * u * 0.006 * hash(i, 4), y - dir[1] * u * 0.006 * hash(i, 4));
        ctx.stroke();
      }
      ctx.restore();

      // The flap: the peeled part folded back over the tear line, or falling after the rip.
      const fall = ease.inCubic(seg(t, PEEL1, RIP1));
      if (s > 1 && fall < 1) {
        const fline = ripped ? tearFinal : line;
        const p0 = fline[0];
        const p1 = fline[fline.length - 1];
        const lx = p1[0] - p0[0];
        const ly = p1[1] - p0[1];
        const ll = Math.hypot(lx, ly) || 1;
        const ux = lx / ll;
        const uy = ly / ll;
        // Reflection across the fold line through p0 with direction (ux, uy).
        const a = ux * ux - uy * uy;
        const b = 2 * ux * uy;
        const e = p0[0] - (a * p0[0] + b * p0[1]);
        const f = p0[1] - (b * p0[0] - a * p0[1]);
        // The peeled region (corner side of the line), clipped to the poster.
        const far = diag * 3;
        const peeled: Pt[] = [
          ...fline,
          [p1[0] - dir[0] * far, p1[1] - dir[1] * far],
          [p0[0] - dir[0] * far, p0[1] - dir[1] * far],
        ];
        // Paint the flap into its own layer: the back of the poster, mirrored over the fold.
        const { canvas: fc, ctx: F } = buffer("tp-flap", w, h);
        F.save();
        F.setTransform(1, 0, 0, 1, 0, 0);
        F.clearRect(0, 0, w, h);
        F.transform(a, b, b, -a, e, f);
        polyPath(F, peeled);
        F.clip();
        polyPath(F, boxPoly);
        F.clip();
        F.drawImage(fBack as CanvasImageSource, B.x, B.y);
        F.setTransform(1, 0, 0, 1, 0, 0);
        // Curl: darker toward the fold, lighter where the paper lifts.
        const mx = (p0[0] + p1[0]) / 2;
        const my = (p0[1] + p1[1]) / 2;
        const g = F.createLinearGradient(
          mx,
          my,
          mx + dir[0] * diag * 0.45,
          my + dir[1] * diag * 0.45,
        );
        g.addColorStop(0, "rgba(0,0,0,0.45)");
        g.addColorStop(0.22, "rgba(0,0,0,0.1)");
        g.addColorStop(1, "rgba(255,255,255,0.1)");
        F.globalCompositeOperation = "source-atop";
        F.fillStyle = g;
        F.fillRect(0, 0, w, h);
        F.restore();
        // Its torn edge, mirrored too.
        F.save();
        F.setTransform(1, 0, 0, 1, 0, 0);
        F.transform(a, b, b, -a, e, f);
        polyPath(F, boxPoly);
        F.clip();
        F.strokeStyle = fibre;
        F.lineWidth = Math.max(1.2, u * 0.005);
        polyPath(F, fline, false);
        F.stroke();
        F.restore();
        // After the rip the flap drops away.
        const fx = -fall * w * 0.12;
        const fy = fall * h * 0.95;
        ctx.save();
        ctx.translate(fx + p0[0], fy + p0[1]);
        ctx.rotate(fall * 0.5);
        ctx.translate(-p0[0], -p0[1]);
        ctx.save();
        ctx.filter = `blur(${(u * 0.018).toFixed(1)}px) brightness(0)`;
        ctx.globalAlpha = 0.55;
        ctx.drawImage(
          fc as CanvasImageSource,
          u * 0.025 * (1 + fall * 2),
          u * 0.035 * (1 + fall * 2),
        );
        ctx.restore();
        ctx.drawImage(fc as CanvasImageSource, 0, 0);
        ctx.restore();
      }

      // Re-paste: a fresh copy rolls down from the top, wet above the roll.
      if (pasting) {
        const k = ease.inOutCubic(seg(t, PASTE0, PASTE1));
        const ry = B.y + B.h * k;
        ctx.save();
        ctx.beginPath();
        ctx.rect(B.x - 2, B.y - 2, B.w + 4, ry - B.y + 2);
        ctx.clip();
        drawA(null);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(B.x, B.y, B.w, ry - B.y);
        const g = ctx.createLinearGradient(0, ry - B.h * 0.25, 0, ry);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(1, rgba(theme.ink, 0.22));
        ctx.fillStyle = g;
        ctx.fillRect(B.x, ry - B.h * 0.25, B.w, B.h * 0.25);
        ctx.restore();
        // The roll of paper still to unroll.
        const rh = Math.max(4, u * 0.035);
        const rg = ctx.createLinearGradient(0, ry - rh * 0.2, 0, ry + rh);
        rg.addColorStop(0, mix(theme.accent, theme.ink, 0.35));
        rg.addColorStop(0.45, theme.accent);
        rg.addColorStop(1, mix(theme.accent, "#000000", 0.55));
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = u * 0.03;
        ctx.shadowOffsetY = u * 0.015;
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.roundRect(B.x - u * 0.01, ry - rh * 0.2, B.w + u * 0.02, rh, rh / 2);
        ctx.fill();
        ctx.restore();
      }
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
