import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  rng,
  seg,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { mottle, speckleTile, tileFill, type Pt } from "./_s2-helpers";

/**
 * Street stencil on board-formed concrete. The loop opens on the finished
 * piece: a roller buffs it out, a plastic stencil is taped down, sprayed in a
 * two-can fade, lifted, and the heavy spots drip.
 */
const STENCIL = '"Big Shoulders Stencil Display", "Stardos Stencil", Impact, sans-serif';
const BUFF = [0.0, 0.55];
const SHEET_IN = [0.62, 0.86];
const SPRAY = [0.92, 2.05];
const LIFT = [2.1, 2.45];
const DRIP = [2.4, 3.7];

function layout(w: number, h: number, word: string, c: Ctx2D, hasLogo: boolean) {
  const { u, portrait, square } = frameOf(w, h);
  const css = (s: number) => font(900, s, "Big Shoulders Stencil Display", STENCIL);
  const maxW = w * (portrait ? 0.8 : square ? 0.78 : 0.68);
  // With a logo, the mark sits left of the word inside the same sheet.
  const probe = 100;
  c.font = css(probe);
  const ratio = (c.measureText(word).width + (hasLogo ? probe * 1.0 : 0)) / probe;
  const size = Math.min(h * (portrait ? 0.22 : square ? 0.3 : 0.42), maxW / ratio);
  c.font = css(size);
  const tw = c.measureText(word).width;
  const lw = hasLogo ? size * 1.0 : 0;
  const cx = w / 2 + lw / 2;
  const cy = h * (portrait ? 0.46 : 0.5);
  const top = cy - size * 0.42;
  const bottom = cy + size * 0.36;
  const sheet = {
    x: cx - tw / 2 - lw - u * 0.08,
    y: top - u * 0.08,
    w: tw + lw + u * 0.16,
    h: bottom - top + u * 0.16,
  };
  return { u, css, size, tw, lw, cx, cy, top, bottom, sheet, portrait };
}

/** The can's path: horizontal zigzag passes working down the sheet. */
function sprayPath(L: ReturnType<typeof layout>): Pt[] {
  const pts: Pt[] = [];
  const passes = 6;
  for (let i = 0; i < passes; i++) {
    const y = L.top - L.size * 0.05 + ((L.bottom - L.top + L.size * 0.1) * (i + 0.5)) / passes;
    const x0 = L.sheet.x - L.u * 0.02;
    const x1 = L.sheet.x + L.sheet.w + L.u * 0.02;
    const [a, b] = i % 2 ? [x1, x0] : [x0, x1];
    for (let k = 0; k <= 16; k++)
      pts.push([a + ((b - a) * k) / 16, y + Math.sin(k * 0.7 + i) * L.u * 0.008]);
  }
  return pts;
}

/** Drip sources along the letter bottoms (found once from the rendered mask). */
function drips(L: ReturnType<typeof layout>, word: string) {
  const r = rng(word.length * 31 + 7);
  const out: { x: number; y: number; len: number; t0: number; w: number }[] = [];
  const n = Math.max(6, Math.min(14, word.length * 2));
  for (let i = 0; i < n; i++) {
    const x = L.cx - L.tw / 2 + L.tw * ((i + 0.3 + r() * 0.4) / n);
    out.push({
      x,
      y: L.bottom - L.size * 0.03,
      len: L.u * (0.04 + r() * r() * 0.22),
      t0: DRIP[0] + r() * 0.5,
      w: L.u * (0.004 + r() * 0.004),
    });
  }
  return out;
}

function wall(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, theme.ink, 0.015, 0.03, u * 0.18, u / 130, 8.8);
    const r = rng(9393);
    // Board-formed concrete: horizontal board seams and wood grain.
    const board = u * 0.13;
    for (let y = board * 0.6; y < h; y += board) {
      c.fillStyle = rgba("#000000", 0.35);
      c.fillRect(0, y, w, Math.max(1, u * 0.003));
      c.fillStyle = rgba(theme.ink, 0.05);
      c.fillRect(0, y + u * 0.003, w, Math.max(1, u * 0.002));
      for (let g = 0; g < 6; g++) {
        c.strokeStyle = rgba(r() < 0.5 ? theme.ink : "#000000", 0.025 + r() * 0.025);
        c.lineWidth = Math.max(1, u * 0.0016);
        c.beginPath();
        const gy = y + board * (0.15 + r() * 0.7);
        c.moveTo(0, gy);
        for (let x = 0; x <= w; x += u * 0.05)
          c.lineTo(x, gy + Math.sin(x / (u * 0.21) + g) * u * 0.006);
        c.stroke();
      }
    }
    // Pores and stains.
    for (let i = 0; i < (w * h) / 700; i++) {
      c.fillStyle = rgba("#000000", 0.2 + r() * 0.35);
      const s = u * (0.0015 + r() * r() * 0.005);
      c.beginPath();
      c.arc(r() * w, r() * h, s, 0, TAU);
      c.fill();
    }
    for (let i = 0; i < 8; i++) {
      const x = r() * w;
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba("#000000", 0));
      g.addColorStop(1, rgba("#000000", 0.12 + r() * 0.1));
      c.fillStyle = g;
      c.fillRect(x, h * (0.2 + r() * 0.4), u * (0.02 + r() * 0.05), h);
    }
    // Ghosts of old tags, long since faded.
    c.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      c.strokeStyle = rgba(theme.ink, 0.035);
      c.lineWidth = u * 0.006;
      c.beginPath();
      let x = r() * w;
      let y = r() * h;
      c.moveTo(x, y);
      for (let k = 0; k < 10; k++) {
        x += (r() - 0.3) * u * 0.08;
        y += (r() - 0.5) * u * 0.06;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  };
}

/** The buff: a flat patch of city grey with roller texture and ragged edges. */
function buffPatch(c: Ctx2D, theme: Theme, L: ReturnType<typeof layout>, p: number) {
  const { u } = L;
  const x0 = L.sheet.x - u * 0.08;
  const x1 = L.sheet.x + L.sheet.w + u * 0.08;
  const y0 = L.sheet.y - u * 0.08;
  const y1 = L.sheet.y + L.sheet.h + u * 0.18;
  const cols = 4;
  const cw = (x1 - x0) / cols;
  const colour = mix(theme.bg, theme.ink, 0.075);
  for (let i = 0; i < cols; i++) {
    const k = clamp(p * cols - i);
    if (k <= 0) continue;
    const yEnd = y0 + (y1 - y0) * ease.inOutSine(k);
    const cx0 = x0 + i * cw - u * 0.01;
    c.fillStyle = colour;
    c.beginPath();
    c.moveTo(cx0, y0 + hash(i, 3) * u * 0.02);
    const steps = 16;
    for (let s = 0; s <= steps; s++)
      c.lineTo(cx0 + ((cw + u * 0.02) * s) / steps, y0 + hash(i, s) * u * 0.015);
    for (let s = steps; s >= 0; s--)
      c.lineTo(cx0 + ((cw + u * 0.02) * s) / steps, yEnd - hash(i + 9, s) * u * 0.012);
    c.closePath();
    c.fill();
    // Roller streaks inside the stroke.
    for (let s = 0; s < 10; s++) {
      c.fillStyle = rgba(hash(i, s, 5) < 0.5 ? "#000000" : theme.ink, 0.025);
      c.fillRect(cx0 + cw * hash(i, s, 7), y0, u * 0.004, yEnd - y0);
    }
  }
}

export const style: MotionStyle = {
  id: "spray-stencil",
  name: "Spray Stencil",
  family: "Paint & Draw",
  tagline: "A street stencil on concrete",
  look: "Street stencil on board-formed concrete: a cut plastic sheet, a two-can spray fade, soft overspray, drips, a grey buff patch.",
  move: "A roller buffs the old piece, the stencil is taped down, sprayed in zigzag passes, lifted to reveal crisp letters, and the heavy spots drip.",
  rules: [
    "Letters are a real stencil face: bridges keep every counter attached.",
    "Spray builds in passes; density is soft and uneven, never flat.",
    "Overspray halos the letters and speckles the wall around the sheet.",
    "Two cans fade into each other top to bottom.",
    "Drips start at the heaviest paint and slow as they run out.",
    "The buff is flat city grey with roller streaks and ragged edges.",
    "The loop opens and closes on the finished piece.",
  ],
  prompt: `R — References
• Street-art stencils (search: spray paint stencil lettering, stencil overspray drips, graffiti buff).
• Board-formed concrete walls; the grey "buff" patches cities roll over graffiti.

I — Idea
One wall, 5 seconds, looping seamlessly:
• Beginning (0–0.9 s): the finished piece is rolled out by a grey buff in vertical strokes; a plastic stencil sheet with "{{name}}" cut out is taped over the patch.
• Middle (0.9–2.5 s): the can sprays zigzag passes down the sheet, {{accent2}} fading into {{accent}}; the sheet lifts off to show crisp letters haloed in overspray.
• End (2.5–5 s): drips run from the heaviest spots and slow; the piece holds, exactly the frame the loop began on.

S — Style
Looks: {{bg}} concrete with board seams, pores, stains and ghost tags; a darker translucent stencil sheet with tape corners; letters in Big Shoulders Stencil (900) with bridges; soft spray density, overspray speckle, thin drips with bulbs.
Moves: the buff rolls in four vertical strokes; the sheet drops in with a small settle; the can follows a zigzag path at spray speed; the sheet lifts up and away; drips ease out over a second.
Rules:
1. A real stencil face with bridges.
2. Soft, uneven spray density.
3. Overspray halo and speckle.
4. A two-can fade.
5. Drips from the heaviest paint, slowing.
6. Open and close on the finished piece.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; letters are crisp with bridges and fully legible; the overspray is visible but never muddy; drips hang below the letters; the buff hides the old piece completely. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Stencil_graffiti",
  theme: {
    bg: "#141516",
    ink: "#f1efe9",
    accent: "#ff4d6d",
    accent2: "#3fc6ff",
    font: "Big Shoulders Stencil Display",
  },
  fonts: ["Big Shoulders Stencil Display:wght@700..900"],
  tags: [
    "stencil",
    "spray",
    "graffiti",
    "street art",
    "urban",
    "banksy",
    "paint",
    "wall",
    "concrete",
    "drips",
    "overspray",
  ],
  word: "STREET",
  render(ctx, t, theme, w, h) {
    const word = wordFor(theme.name, "STREET", 12).toUpperCase();
    const probeLogo = tintedLogo(theme, "#000000", 8, 8);
    const L = layout(w, h, word, ctx, !!probeLogo);
    const { u } = L;
    const key = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(bake(`spray-wall:${key}`, w, h, wall(theme)) as CanvasImageSource, 0, 0);
    const path = sprayPath(L);
    const D = drips(L, word);
    const logo = probeLogo ? tintedLogo(theme, "#000000", L.size * 0.8, L.size * 0.8) : null;
    const logoX = L.cx - L.tw / 2 - L.lw;
    const colourAt = (y: number) =>
      mix(theme.accent2, theme.accent, smoothstep(L.top, L.bottom, y));

    /** The stencil's open areas (letters and a dropped logo) as one mask image. */
    const mask = bake(`spray-mask:${word}:${logo ? 1 : 0}`, w, h, (c) => {
      c.font = L.css(L.size);
      c.textAlign = "center";
      c.textBaseline = "alphabetic";
      c.fillStyle = "#000";
      c.fillText(word, L.cx, L.cy + L.size * 0.35);
      if (logo)
        c.drawImage(
          logo as CanvasImageSource,
          logoX,
          L.cy - L.size * 0.4,
          L.size * 0.8,
          L.size * 0.8,
        );
    });
    const cutout = (c: Ctx2D) => c.drawImage(mask as CanvasImageSource, 0, 0);
    /** Spray deposited up to path fraction p. */
    const sprayUpTo = (c: Ctx2D, p: number, alphaK: number) => {
      const n = Math.floor((path.length - 1) * p);
      const r0 = u * 0.09;
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j < 3; j++) {
          const k = i + j / 3;
          if (k > (path.length - 1) * p) break;
          const a = path[Math.min(path.length - 1, Math.floor(k))];
          const b = path[Math.min(path.length - 1, Math.floor(k) + 1)];
          const f = k - Math.floor(k);
          const x = a[0] + (b[0] - a[0]) * f;
          const y = a[1] + (b[1] - a[1]) * f;
          const col = colourAt(y);
          const g = c.createRadialGradient(x, y, 0, x, y, r0);
          const dens = (0.16 + 0.1 * hash(i, j, 3)) * alphaK;
          g.addColorStop(0, rgba(col, dens));
          g.addColorStop(0.6, rgba(col, dens * 0.45));
          g.addColorStop(1, rgba(col, 0));
          c.fillStyle = g;
          c.fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
        }
      }
    };
    const dripsUpTo = (c: Ctx2D, tt: number) => {
      c.lineCap = "round";
      for (const d of D) {
        const k = ease.outCubic(clamp((tt - d.t0) / 0.9));
        if (k <= 0) continue;
        const col = colourAt(d.y);
        c.strokeStyle = col;
        c.fillStyle = col;
        c.lineWidth = d.w;
        c.beginPath();
        c.moveTo(d.x, d.y - u * 0.01);
        c.lineTo(d.x, d.y + d.len * k);
        c.stroke();
        c.beginPath();
        c.ellipse(d.x, d.y + d.len * k, d.w * 0.9, d.w * 1.3, 0, 0, TAU);
        c.fill();
      }
    };
    /** The finished piece: sprayed letters, overspray halo and speckle, drips. */
    const piece = (c: Ctx2D, tt: number, p: number) => {
      const { canvas: pc, ctx: P } = buffer("spray-piece", w, h);
      P.save();
      P.clearRect(0, 0, w, h);
      sprayUpTo(P, p, 1.6);
      P.globalCompositeOperation = "destination-in";
      cutout(P);
      P.restore();
      // Overspray that crept under the sheet: a soft halo round each letter.
      c.save();
      c.globalAlpha = 0.35;
      c.filter = `blur(${(u * 0.006).toFixed(1)}px)`;
      c.drawImage(pc as CanvasImageSource, 0, 0);
      c.restore();
      c.drawImage(pc as CanvasImageSource, 0, 0);
      // Speckle mist past the sheet edges.
      const r = rng(4545);
      for (let i = 0; i < 260; i++) {
        const side = r();
        const x = L.sheet.x - u * 0.05 + r() * (L.sheet.w + u * 0.1);
        const y = side < 0.5 ? L.sheet.y - r() * u * 0.05 : L.sheet.y + L.sheet.h + r() * u * 0.05;
        c.fillStyle = rgba(colourAt(y), 0.25 + r() * 0.4);
        c.beginPath();
        c.arc(x, y, u * (0.0012 + r() * 0.002), 0, TAU);
        c.fill();
      }
      dripsUpTo(c, tt);
    };

    const buff = ease.inOutSine(seg(t, BUFF[0], BUFF[1]));
    const finalKey = `spray-final:${key}:${word}:${logo ? 1 : 0}`;
    const finished = bake(finalKey, w, h, (c) => {
      buffPatch(c, theme, L, 1);
      piece(c, 99, 1);
    });
    if (t < BUFF[1]) {
      // The old piece, then the roller rolling over it.
      ctx.drawImage(finished as CanvasImageSource, 0, 0);
      buffPatch(ctx, theme, L, buff);
    } else {
      buffPatch(ctx, theme, L, 1);
    }

    const sprayP = ease.inOutSine(seg(t, SPRAY[0], SPRAY[1]));
    const lifted = t >= LIFT[1];
    if (t >= DRIP[1] + 0.3) {
      ctx.drawImage(finished as CanvasImageSource, 0, 0);
    } else if (t >= SPRAY[0] && !lifted) {
      // Paint visible through the cutouts while the sheet is down.
      const { canvas: pc, ctx: P } = buffer("spray-live", w, h);
      P.save();
      P.clearRect(0, 0, w, h);
      sprayUpTo(P, sprayP, 1.6);
      P.globalCompositeOperation = "destination-in";
      cutout(P);
      P.restore();
      ctx.drawImage(pc as CanvasImageSource, 0, 0);
    } else if (lifted) {
      piece(ctx, t, 1);
    }

    // The stencil sheet: lands, gets sprayed, lifts away.
    const inK = ease.outBack(seg(t, SHEET_IN[0], SHEET_IN[1]));
    const outK = ease.inOutCubic(seg(t, LIFT[0], LIFT[1]));
    if (t >= SHEET_IN[0] && t < LIFT[1]) {
      const { canvas: sc, ctx: S } = buffer("spray-sheet", w, h);
      S.save();
      S.clearRect(0, 0, w, h);
      const sh = L.sheet;
      S.fillStyle = mix(theme.bg, theme.ink, 0.2);
      S.fillRect(sh.x, sh.y, sh.w, sh.h);
      const gl = S.createLinearGradient(sh.x, sh.y, sh.x + sh.w, sh.y + sh.h);
      gl.addColorStop(0, rgba(theme.ink, 0.1));
      gl.addColorStop(0.5, rgba(theme.ink, 0));
      gl.addColorStop(1, rgba(theme.ink, 0.06));
      S.fillStyle = gl;
      S.fillRect(sh.x, sh.y, sh.w, sh.h);
      // Overspray settling on the sheet itself.
      if (t >= SPRAY[0]) sprayUpTo(S, sprayP, 1.0);
      // Tape at the corners.
      S.fillStyle = rgba(mix(theme.ink, "#c8b98a", 0.3), 0.85);
      for (const [tx, ty, rot] of [
        [sh.x, sh.y, -0.7],
        [sh.x + sh.w, sh.y, 0.7],
        [sh.x, sh.y + sh.h, 0.7],
        [sh.x + sh.w, sh.y + sh.h, -0.7],
      ] as [number, number, number][]) {
        S.save();
        S.translate(tx, ty);
        S.rotate(rot);
        S.fillRect(-u * 0.05, -u * 0.014, u * 0.1, u * 0.028);
        S.restore();
      }
      S.globalCompositeOperation = "destination-out";
      cutout(S);
      S.restore();
      const drop = (1 - inK) * u * 0.06 - outK * u * 0.25;
      const shift = outK * u * 0.12;
      ctx.save();
      ctx.globalAlpha = 1 - outK;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = u * (0.01 + outK * 0.05);
      ctx.shadowOffsetY = u * (0.006 + outK * 0.04);
      ctx.drawImage(sc as CanvasImageSource, shift, drop);
      ctx.restore();
    }

    // The can's nozzle mist while spraying.
    if (t > SPRAY[0] && t < SPRAY[1]) {
      const n = (path.length - 1) * sprayP;
      const a = path[Math.floor(n)];
      const b = path[Math.min(path.length - 1, Math.floor(n) + 1)];
      const f = n - Math.floor(n);
      light(
        ctx,
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        u * 0.12,
        colourAt(a[1]),
        0.35,
      );
    }

    // Wall tooth over paint and plastic alike.
    tileFill(
      ctx,
      speckleTile(6060, 256, 1800, 0.1, 0.4, 0.5, 1.5),
      w,
      h,
      Math.max(0.5, u / 800),
      0.35,
    );
    light(ctx, w * 0.5, h * 0.2, Math.max(w, h) * 0.8, theme.ink, 0.06);
    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.32);
  },
};
