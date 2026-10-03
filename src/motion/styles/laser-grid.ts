import { mix, rgba } from "../engine/color";
import {
  buffer,
  clamp,
  context,
  ease,
  frameOf,
  grain,
  ground,
  LOOP,
  makeCanvas,
  once,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";
import { fitText, fontOf, noiseTile, pulse } from "./_s5-helpers";

const FAMILY = "Syncopate";
const BEAMS = 15;

/** Haze: a soft, tileable smoke texture in grey (0.25..1), used to modulate the beams (built on first use: no DOM at import). */
const haze = () =>
  once("laser-haze", () => {
    const S = 256;
    const A = noiseTile(404, S, 4, 5);
    const B = noiseTile(505, S, 9, 3);
    const c = makeCanvas(S, S);
    const g = context(c);
    const img = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const x = i % S;
      const y = (i / S) | 0;
      const v = clamp(0.06 + 1.5 * Math.pow(A.sample(x, y), 2.2) + 0.35 * (B.sample(x, y) - 0.5));
      const b = v * 255;
      img.data[i * 4] = b;
      img.data[i * 4 + 1] = b;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  });

interface Fan {
  x: number;
  y: number;
  /** Direction the fan points (radians), its spread, and its colour. */
  dir: number;
  color: string;
  side: number;
}

function state(t: number) {
  const lock = pulse(t, 1.4, 1.95, 3.6, 4.25);
  const p = t / LOOP;
  // Scissor sweep, damped to zero while the grid locks.
  const sweep = 0.26 * Math.sin(TAU * 2 * p) * (1 - lock);
  const spread = 0.62 - 0.14 * lock;
  const flash = pulse(t, 1.9, 1.95, 1.99, 2.25);
  const trace = ease.inOutCubic(seg(t, 1.85, 2.45)) * (1 - ease.inCubic(seg(t, 3.85, 4.35)));
  return { lock, sweep, spread, flash, trace };
}

export const style: MotionStyle = {
  id: "laser-grid",
  name: "Laser Grid",
  family: "Light & Material",
  tagline: "Club lasers through haze",
  look: "Club lasers fanning through thick haze: razor beams from two projectors, a glowing lattice where they cross, a word traced in light.",
  move: "Two fans scissor through the smoke, lock into a diamond grid with a flash while the word traces on, then scan open again.",
  rules: [
    "Beams are only visible where the haze is: brightness follows the drifting smoke.",
    "Each beam is a hot thin core inside a soft coloured glow, fading with distance.",
    "Two fans, two colours; where beams cross they add, never cover.",
    "The sweep is mechanical and eased: scissor, lock, hold, release.",
    "The word is drawn the way a laser draws: an outline traced on, contour by contour.",
    "The projectors burn as hot points at the frame edge.",
    "Black room, grain, nothing else lit.",
  ],
  prompt: `R — References
• Club and festival laser shows in haze (search: laser fan haze, laser tunnel concert).
• ILDA laser graphics: outline text traced by a scanning beam.

I — Idea
Two laser fans lock into a grid, 5 seconds, looping seamlessly:
• Beginning (0–1.4 s): two projectors at the sides fire fans of beams through drifting haze; the fans scissor up and down.
• Middle (1.4–3.9 s): the fans lock into a symmetric lattice with a flash; "{{name}}" traces on as a laser outline and holds for over a second.
• End (3.9–5 s): the word un-traces and the fans scan open, back to the opening sweep.

S — Style
Looks: {{bg}} room full of haze; one fan in {{accent}}, the other in {{accent2}}, hot cores toward {{ink}}; the word as a thin laser outline in {{font}}, caps, wide.
Moves: sine scissor sweep with eased lock; the flash is short; the outline traces contour by contour.
Rules:
1. Beam brightness = haze density along it; haze drifts slowly.
2. Hot core, soft glow, distance falloff.
3. Additive crossings; two colours.
4. Eased mechanical motion; one lock and flash.
5. Outline text traced on, held at least 1.2 s.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; beams are thin and crisp, not blurry bars; the haze visibly breaks up the beams; the lattice at 2.5 s is symmetric; the traced word is readable. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Laser_lighting_display",
  theme: {
    bg: "#040509",
    ink: "#f1fff7",
    accent: "#2dff8c",
    accent2: "#ff2f8e",
    font: FAMILY,
  },
  fonts: ["Syncopate:wght@400;700"],
  tags: [
    "laser",
    "club",
    "rave",
    "concert",
    "beams",
    "haze",
    "neon",
    "techno",
    "light show",
    "grid",
    "night",
  ],
  word: "Live",
  render(ctx, t, theme, w, h) {
    const { u, cx, cy, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const S = state(t);
    const p = t / LOOP;

    const fans: Fan[] = portrait
      ? [
          { x: w * 0.02, y: h * 0.86, dir: -0.95, color: theme.accent, side: 1 },
          { x: w * 0.98, y: h * 0.86, dir: Math.PI + 0.95, color: theme.accent2, side: -1 },
        ]
      : [
          { x: -w * 0.01, y: h * 0.62, dir: -0.08, color: theme.accent, side: 1 },
          { x: w * 1.01, y: h * 0.62, dir: Math.PI + 0.08, color: theme.accent2, side: -1 },
        ];

    // Beams into their own buffer, then multiplied by the haze.
    const { canvas: bc, ctx: B } = buffer("laser-beams", w, h);
    B.save();
    B.globalCompositeOperation = "source-over";
    B.globalAlpha = 1;
    B.fillStyle = "#000";
    B.fillRect(0, 0, w, h);
    B.globalCompositeOperation = "lighter";
    B.lineCap = "round";
    const reach = Math.hypot(w, h) * 1.1;
    for (const F of fans) {
      const hot = mix(F.color, theme.ink, 0.6);
      for (let k = 0; k < BEAMS; k++) {
        const f = k / (BEAMS - 1) - 0.5;
        const a = F.dir + F.side * (S.sweep + f * S.spread);
        const ex = F.x + Math.cos(a) * reach;
        const ey = F.y + Math.sin(a) * reach;
        const fade = B.createLinearGradient(F.x, F.y, ex, ey);
        fade.addColorStop(0, rgba(F.color, 0.55));
        fade.addColorStop(0.45, rgba(F.color, 0.3));
        fade.addColorStop(1, rgba(F.color, 0.04));
        B.strokeStyle = fade;
        B.lineWidth = u * 0.012;
        B.beginPath();
        B.moveTo(F.x, F.y);
        B.lineTo(ex, ey);
        B.stroke();
        const core = B.createLinearGradient(F.x, F.y, ex, ey);
        core.addColorStop(0, rgba(hot, 1));
        core.addColorStop(0.5, rgba(hot, 0.65));
        core.addColorStop(1, rgba(hot, 0.1));
        B.strokeStyle = core;
        B.lineWidth = Math.max(0.8, u * 0.0018);
        B.stroke();
      }
    }
    // Haze: two layers drifting in opposite directions, a whole tile per loop.
    B.globalCompositeOperation = "multiply";
    const pat = B.createPattern(haze() as CanvasImageSource, "repeat");
    if (pat) {
      const scale = (u * 1.1) / 256;
      pat.setTransform(new DOMMatrix().translateSelf(p * 256 * scale, 0).scaleSelf(scale));
      B.fillStyle = pat;
      B.fillRect(0, 0, w, h);
      // A second, larger drift the other way breaks the smoke into slow rolling clumps.
      const pat2 = B.createPattern(haze() as CanvasImageSource, "repeat");
      if (pat2) {
        const s2 = (u * 2.3) / 256;
        pat2.setTransform(
          new DOMMatrix()
            .translateSelf(-p * 256 * s2, 0)
            .rotateSelf(90)
            .scaleSelf(s2),
        );
        B.globalAlpha = 0.7;
        B.fillStyle = pat2;
        B.fillRect(0, 0, w, h);
      }
    }
    B.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // Soft bloom of the whole beam layer, then the crisp layer.
    // Lit air: a wide soft bloom, then a tighter one, then the crisp beams.
    ctx.globalAlpha = 0.5 + 0.5 * S.flash;
    ctx.filter = `blur(${(u * 0.035).toFixed(1)}px)`;
    ctx.drawImage(bc as CanvasImageSource, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.filter = `blur(${(u * 0.008).toFixed(1)}px)`;
    ctx.drawImage(bc as CanvasImageSource, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.drawImage(bc as CanvasImageSource, 0, 0);
    // Hot projector heads.
    for (const F of fans) {
      const g = ctx.createRadialGradient(F.x, F.y, 0, F.x, F.y, u * 0.12);
      g.addColorStop(0, rgba(mix(F.color, theme.ink, 0.7), 0.95));
      g.addColorStop(0.08, rgba(F.color, 0.6));
      g.addColorStop(1, rgba(F.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(F.x - u * 0.12, F.y - u * 0.12, u * 0.24, u * 0.24);
    }
    // The flash when the grid locks.
    if (S.flash > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
      g.addColorStop(0, rgba(mix(theme.accent, theme.accent2, 0.5), 0.25 * S.flash));
      g.addColorStop(1, rgba(theme.bg, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // The word, traced on as a laser outline.
    if (S.trace > 0.001) {
      const word = wordFor(theme.name, "Live", 10).toUpperCase();
      const family = theme.font || FAMILY;
      ctx.save();
      ctx.letterSpacing = `${(u * 0.02).toFixed(1)}px`;
      const fit = fitText(ctx, word, portrait ? w * 0.8 : w * 0.56, h * 0.2, u * 0.24, 700, family);
      ctx.font = fontOf("", 700, fit.size, family);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const ty = portrait ? h * 0.42 : h * 0.34;
      const len = fit.size * 4.2 * S.trace;
      ctx.setLineDash([len, fit.size * 8]);
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "lighter";
      const col = mix(theme.accent, theme.ink, 0.15);
      ctx.strokeStyle = rgba(col, 0.35);
      ctx.lineWidth = u * 0.012;
      ctx.filter = `blur(${(u * 0.006).toFixed(1)}px)`;
      ctx.strokeText(word, cx + u * 0.01, ty);
      ctx.filter = "none";
      ctx.strokeStyle = rgba(mix(col, theme.ink, 0.5), 0.95);
      ctx.lineWidth = Math.max(1, u * 0.0028);
      ctx.strokeText(word, cx + u * 0.01, ty);
      ctx.restore();
      const mark = tintedLogo(theme, rgba(col, 0.9), u * 0.06, u * 0.06);
      if (mark) {
        ctx.save();
        ctx.globalAlpha = S.trace;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(mark as CanvasImageSource, cx - u * 0.03, ty + fit.ascent + u * 0.05);
        ctx.restore();
      }
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
