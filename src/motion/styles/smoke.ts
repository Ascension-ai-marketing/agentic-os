import { mix, rgba } from "../engine/color";
import {
  buffer,
  clamp,
  frameOf,
  grain,
  ground,
  hash,
  LOOP,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle } from "../engine/types";
import { fitText, flowNoise, fontOf } from "./_s5-helpers";

const FAMILY = "Italiana";
const STRANDS = 44;
const STEPS = 96;

interface Plume {
  tipX: number;
  tipY: number;
  H: number;
  u: number;
}

function plume(w: number, h: number): Plume {
  const { u, portrait } = frameOf(w, h);
  return {
    tipX: portrait ? w * 0.4 : w * 0.34,
    tipY: h * (portrait ? 0.8 : 0.84),
    H: h * (portrait ? 0.78 : 0.86),
    u,
  };
}

/**
 * Trace every strand of the plume for time t into `pts` (x, y pairs).
 * The plume is a thin laminar thread at the tip that wavers, then rolls
 * into curls that widen and fade as they rise.
 */
function strands(P: Plume, t: number, pts: Float32Array) {
  const { u, H } = P;
  const ph = (TAU * t) / LOOP;
  // A shared, meandering centre line.
  const cx = new Float32Array(STEPS);
  for (let j = 0; j < STEPS; j++) {
    const s = j / (STEPS - 1);
    cx[j] =
      P.tipX +
      u * 0.05 * s * flowNoise(s * 2.2, 0.5, t, 1) +
      u * 0.16 * s * s * flowNoise(s * 1.3 + 3, 1.7, t, 1) +
      u * 0.05 * s * s;
  }
  for (let i = 0; i < STRANDS; i++) {
    const o = (i / (STRANDS - 1)) * 2 - 1 + (hash(i, 3) - 0.5) * 0.12;
    // Neighbouring strands twist at slightly different phases, so the ribbon folds.
    const phase = hash(i, 7) * 1.1 + o * 2.3;
    const reach = 0.85 + 0.25 * hash(i, 13);
    for (let j = 0; j < STEPS; j++) {
      const s = j / (STEPS - 1);
      const spread = u * (0.002 + 0.15 * Math.pow(s, 1.5));
      const curl = u * 0.1 * smoothstep(0.14, 0.7, s) * (0.7 + 0.6 * hash(i, 11));
      const a = 13 * s + phase - ph;
      const turb = u * 0.035 * s * s * flowNoise(s * 5 + o * 1.5, i * 0.13, t, 2);
      const k = (i * STEPS + j) * 2;
      pts[k] = cx[j] + o * spread + curl * Math.sin(a) + turb;
      pts[k + 1] = P.tipY - s * H * reach + curl * 0.9 * Math.cos(a);
    }
  }
}

export const style: MotionStyle = {
  id: "smoke",
  name: "Smoke",
  family: "Light & Material",
  tagline: "Incense smoke curling up",
  look: "Incense smoke rising out of the dark: one laminar thread that wavers, then rolls into fine curling ribbons, rim-lit warm and cool.",
  move: "The thread climbs straight, starts to sway, then twists into slow curls that drift up and dissolve; it never stops rising.",
  rules: [
    "Smoke is many fine threads, not a cloud: each strand is a hairline.",
    "Laminar at the source, turbulent above: the curls only begin a third of the way up.",
    "Two rim lights: warm on one side of the plume, cool on the other.",
    "Threads fade as they rise; a soft haze follows them.",
    "The glowing ember is the only hard light.",
    "One quiet word, set thin and wide, keeps its distance from the plume.",
  ],
  prompt: `R — References
• Incense smoke photographed on black with side light (search: incense smoke photography, laminar to turbulent smoke).
• Perfume advertising: a single plume and a thin, wide serif.

I — Idea
A thread of smoke becomes curls, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a glowing ember at the tip of an incense stick; one thin laminar thread climbs straight up.
• Middle (1.5–3.5 s): above a third of the frame it wavers, twists and rolls into fine curling ribbons, rim-lit warm on one side and cool on the other; "{{name}}" sits quietly beside it.
• End (3.5–5 s): the curls drift up and dissolve as new ones form below; the flow repeats without a seam.

S — Style
Looks: {{bg}} black; smoke in {{ink}}, warm rim {{accent}}, cool rim {{accent2}}; the ember {{accent}}; the word in {{font}}, thin, wide-tracked caps.
Moves: continuous rise; curls travel up the plume; the centre line meanders on whole-loop noise.
Rules:
1. Draw dozens of hairline strands, added together.
2. Laminar near the source, curls higher up.
3. Warm and cool rim light across the plume.
4. Fade with height, plus a soft haze.
5. Grain and vignette.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; strands are fine hairlines, not thick ropes; the base is laminar and the top curls; there is no visible jump when the loop restarts; the word never collides with the plume. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Laminar_flow",
  theme: {
    bg: "#070707",
    ink: "#ecebe7",
    accent: "#ff9249",
    accent2: "#6d9dff",
    font: FAMILY,
  },
  fonts: ["Italiana"],
  tags: [
    "smoke",
    "incense",
    "vapor",
    "fog",
    "perfume",
    "luxury",
    "elegant",
    "dark",
    "organic",
    "flow",
    "calm",
  ],
  word: "Reverie",
  render(ctx, t, theme, w, h) {
    const { u, portrait, square } = frameOf(w, h);
    const P = plume(w, h);
    ground(ctx, w, h, theme.bg);
    // A faint warm pool of light behind the plume.
    const back = ctx.createRadialGradient(
      P.tipX + u * 0.1,
      h * 0.45,
      0,
      P.tipX,
      h * 0.45,
      Math.max(w, h) * 0.6,
    );
    back.addColorStop(0, rgba(mix(theme.bg, theme.ink, 0.07), 1));
    back.addColorStop(1, rgba(theme.bg, 1));
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, w, h);

    const pts = new Float32Array(STRANDS * STEPS * 2);
    strands(P, t, pts);

    // Soft haze that follows the strands.
    const qk = 0.25;
    const qw = Math.max(8, Math.round(w * qk));
    const qh = Math.max(8, Math.round(h * qk));
    const { canvas: qc, ctx: Q } = buffer("smoke-haze", qw, qh);
    Q.setTransform(1, 0, 0, 1, 0, 0);
    Q.globalCompositeOperation = "source-over";
    Q.clearRect(0, 0, qw, qh);
    Q.globalCompositeOperation = "lighter";
    Q.lineCap = "round";
    Q.lineJoin = "round";

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const chunks = 8;
    const per = Math.ceil(STEPS / chunks);
    const warm = mix(theme.ink, theme.accent, 0.55);
    const cool = mix(theme.ink, theme.accent2, 0.55);
    for (let i = 0; i < STRANDS; i++) {
      const o = (i / (STRANDS - 1)) * 2 - 1;
      const col =
        o > 0 ? mix(theme.ink, warm, clamp(o * 1.4)) : mix(theme.ink, cool, clamp(-o * 1.4));
      const edge = 1 - 0.55 * Math.abs(o);
      const lw = Math.max(0.6, u * (0.0011 + 0.0009 * hash(i, 5)));
      for (let c = 0; c < chunks; c++) {
        const j0 = c * per;
        const j1 = Math.min(STEPS - 1, j0 + per);
        const sMid = (j0 + j1) / 2 / (STEPS - 1);
        const alpha =
          smoothstep(0, 0.06, sMid) * Math.pow(1 - sMid, 1.1) * edge * (0.16 + 0.12 * hash(i, 9));
        if (alpha < 0.004) continue;
        // Near the tip every strand overlaps, so each carries less light there.
        ctx.strokeStyle = rgba(col, clamp(alpha * clamp(0.1 + sMid * 3.2)));
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let j = j0; j <= j1; j++) {
          const k = (i * STEPS + j) * 2;
          if (j === j0) ctx.moveTo(pts[k], pts[k + 1]);
          else ctx.lineTo(pts[k], pts[k + 1]);
        }
        ctx.stroke();
        if (i % 2 === 0) {
          Q.strokeStyle = rgba(col, clamp(alpha * 0.9));
          Q.lineWidth = Math.max(1, u * 0.012 * qk * (1 + sMid * 3));
          Q.beginPath();
          for (let j = j0; j <= j1; j += 2) {
            const k = (i * STEPS + j) * 2;
            if (j === j0) Q.moveTo(pts[k] * qk, pts[k + 1] * qk);
            else Q.lineTo(pts[k] * qk, pts[k + 1] * qk);
          }
          Q.stroke();
        }
      }
    }
    ctx.globalAlpha = 0.9;
    ctx.filter = `blur(${(u * 0.012).toFixed(1)}px)`;
    ctx.drawImage(qc as CanvasImageSource, 0, 0, w, h);
    ctx.filter = "none";
    ctx.restore();

    // The incense stick and its ember.
    ctx.save();
    const stickEnd = { x: P.tipX - u * 0.06, y: h + u * 0.02 };
    ctx.strokeStyle = rgba(mix(theme.bg, theme.accent, 0.25), 1);
    ctx.lineWidth = Math.max(1, u * 0.006);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(P.tipX, P.tipY + u * 0.004);
    ctx.lineTo(stickEnd.x, stickEnd.y);
    ctx.stroke();
    ctx.strokeStyle = rgba(theme.ink, 0.12);
    ctx.lineWidth = Math.max(0.6, u * 0.0015);
    ctx.beginPath();
    ctx.moveTo(P.tipX + u * 0.0015, P.tipY + u * 0.006);
    ctx.lineTo(stickEnd.x + u * 0.0015, stickEnd.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    const pulseK = 0.85 + 0.15 * Math.sin((TAU * t * 2) / LOOP);
    const eg = ctx.createRadialGradient(P.tipX, P.tipY, 0, P.tipX, P.tipY, u * 0.06);
    eg.addColorStop(0, rgba(mix(theme.accent, theme.ink, 0.5), 0.95 * pulseK));
    eg.addColorStop(0.12, rgba(theme.accent, 0.6 * pulseK));
    eg.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = eg;
    ctx.fillRect(P.tipX - u * 0.06, P.tipY - u * 0.06, u * 0.12, u * 0.12);
    ctx.restore();

    // One quiet word, well clear of the plume.
    const word = wordFor(theme.name, "Reverie", 14).toUpperCase();
    const family = theme.font || FAMILY;
    ctx.save();
    const track = u * 0.018;
    ctx.letterSpacing = `${track.toFixed(1)}px`;
    const fit = fitText(
      ctx,
      word,
      portrait ? w * 0.7 : square ? w * 0.3 : w * 0.34,
      h * 0.08,
      u * 0.075,
      400,
      family,
      '"Newsreader", Georgia, serif',
    );
    ctx.font = fontOf("", 400, fit.size, family, '"Newsreader", Georgia, serif');
    ctx.fillStyle = rgba(theme.ink, 0.88);
    ctx.textBaseline = "alphabetic";
    const tx = portrait ? w * 0.5 - fit.width / 2 : square ? w * 0.64 : w * 0.6;
    const ty = portrait ? h * 0.9 : h * 0.54;
    ctx.fillText(word, tx, ty);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.ink, 0.35);
    ctx.fillRect(tx, ty + fit.size * 0.5, Math.min(fit.width, u * 0.12), Math.max(1, u * 0.0015));
    const mark = tintedLogo(theme, rgba(theme.ink, 0.7), u * 0.045, u * 0.045);
    if (mark) ctx.drawImage(mark as CanvasImageSource, tx, ty - fit.size - u * 0.08);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
