import { mix, parse, rgba } from "../engine/color";
import {
  buffer,
  frameOf,
  grain,
  ground,
  LOOP,
  once,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle, Theme } from "../engine/types";
import { fitText, fontOf, tnoise } from "./_s5-helpers";

const FAMILY = "Cinzel";
const SIN = (() => {
  const n = 4096;
  const out = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = Math.sin((i / n) * TAU);
  return out;
})();
/** Table sine: x in turns (1 = one full cycle). */
function tsin(turns: number) {
  const f = turns - Math.floor(turns);
  return SIN[(f * 4096) | 0];
}

interface Geo {
  u: number;
  horizon: number;
  impactX: number;
  impactY: number;
  /** Pool buffer size and scale. */
  bw: number;
  bh: number;
  k: number;
  /** Per pool pixel: distance to the impact in pool units, radial direction, decay, and the flat reflection angles. */
  r: Float32Array;
  dx: Float32Array;
  dz: Float32Array;
  decay: Float32Array;
  el: Float32Array;
  az: Float32Array;
  front: Uint8Array;
}

function geometry(w: number, h: number): Geo {
  return once(`gold-geo:${w}x${h}`, () => {
    const { u, portrait } = frameOf(w, h);
    const horizon = h * (portrait ? 0.5 : 0.52);
    const impactX = w * (portrait ? 0.5 : 0.6);
    const impactY = h * (portrait ? 0.62 : 0.66);
    const k = 0.5;
    const bw = Math.max(16, Math.round(w * k));
    const top = Math.floor(horizon * k);
    const bh = Math.max(8, Math.round(h * k) - top);
    const N = bw * bh;
    const r = new Float32Array(N);
    const dx = new Float32Array(N);
    const dz = new Float32Array(N);
    const decay = new Float32Array(N);
    const el = new Float32Array(N);
    const az = new Float32Array(N);
    const front = new Uint8Array(N);
    const f = u * 1.2;
    const camH = 1;
    // Pool coordinates of the impact point.
    const Zi = (camH * f) / Math.max(1, impactY - horizon);
    const Xi = ((impactX - w / 2) * Zi) / f;
    for (let j = 0; j < bh; j++) {
      const y = (top + j + 0.5) / k;
      const dy = Math.max(0.5, y - horizon);
      const Z = (camH * f) / dy;
      for (let i = 0; i < bw; i++) {
        const x = (i + 0.5) / k;
        const X = ((x - w / 2) * Z) / f;
        const ex = X - Xi;
        const ez = Z - Zi;
        const d = Math.hypot(ex, ez) || 1e-4;
        const o = j * bw + i;
        r[o] = d;
        dx[o] = ex / d;
        dz[o] = ez / d;
        decay[o] = Math.exp(-d * 0.42) * smoothstep(0.05, 0.45, d);
        el[o] = Math.atan(dy / f);
        az[o] = Math.atan((x - w / 2) / f);
        front[o] = Z < Zi ? 1 : 0;
      }
    }
    return { u, horizon, impactX, impactY, bw, bh, k, r, dx, dz, decay, el, az, front };
  });
}

/** The studio the metal reflects, as a small lookup: elevation x azimuth to RGB (0..1). */
function envMap(theme: Theme) {
  return once(`gold-env:${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`, () => {
    const E = 96;
    const A = 96;
    const out = new Float32Array(E * A * 3);
    const dark = parse(mix(theme.bg, theme.accent, 0.12)).map((v) => v / 255);
    const cool = parse(mix(theme.bg, theme.accent2, 0.45)).map((v) => v / 255);
    const white = parse(theme.ink).map((v) => v / 255);
    for (let e = 0; e < E; e++) {
      const el = (e / (E - 1)) * 0.9;
      for (let a = 0; a < A; a++) {
        const az = (a / (A - 1)) * 2.4 - 1.2;
        // A dark studio: a dim far wall at the horizon, a wide low softbox, a thin strip light, a faint ceiling.
        const wall = Math.exp(-el * 30) * 0.22;
        const ceiling = smoothstep(0.1, 0.6, el) * 0.12;
        const box =
          smoothstep(0.2, 0.0, Math.abs(az - 0.05) - 0.42) *
          smoothstep(0.05, 0.0, Math.abs(el - 0.1) - 0.035);
        const strip =
          smoothstep(0.035, 0.0, Math.abs(az + 0.58) - 0.01) *
          smoothstep(0.08, 0.0, Math.abs(el - 0.2) - 0.16) *
          0.35;
        const o = (e * A + a) * 3;
        for (let c = 0; c < 3; c++) {
          let v = dark[c] * 0.35 + cool[c] * wall + ceiling * white[c];
          v += (white[c] * 1.5 - v) * Math.min(1, box + strip);
          out[o + c] = v;
        }
      }
    }
    return { E, A, data: out };
  });
}

export const style: MotionStyle = {
  id: "molten-gold",
  name: "Molten Gold",
  family: "Light & Material",
  tagline: "Molten gold pouring into a pool",
  look: "A heavy stream of molten gold pours into a pool of liquid metal; rings ripple out, bending the reflection of a studio softbox.",
  move: "The pour never stops: rings roll out from the impact and fade, the stream wobbles, highlights slide down it and across the pool.",
  rules: [
    "Metal is reflection: the gold shows the studio, tinted gold, never a flat yellow.",
    "One big softbox and a thin strip light give the only highlights.",
    "Ripples are rings in perspective: tight near the impact, flattening toward the horizon.",
    "The stream thins as it falls and carries highlights that slide down it.",
    "The impact point bulges into a bright crown.",
    "Deep shadow everywhere the studio has no light.",
    "One engraved word, set in capitals, far from the pour.",
  ],
  prompt: `R — References
• Molten gold and metal pouring footage (search: molten gold pour slow motion, liquid gold ripples).
• Luxury product lighting: a large softbox and a strip light in a black studio.

I — Idea
A pour that never ends, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a thick stream of molten gold falls into a pool of liquid metal; a crown bulges where it lands.
• Middle (1.5–3.5 s): rings roll out across the pool in perspective, bending the reflection of a softbox; highlights slide down the stream; "{{name}}" sits engraved in the dark.
• End (3.5–5 s): the rings keep rolling; every ring and highlight completes whole cycles, so the loop joins without a seam.

S — Style
Looks: {{bg}} studio; gold from {{accent}}, reflecting a softbox and strip light in {{ink}} and a cool bounce from {{accent2}}; the word in {{font}}, capitals, gold.
Moves: rings travel outward at a steady rate (whole cycles per loop); the stream wobbles on loop noise; highlights scroll down it.
Rules:
1. Shade the pool by reflection: normal from the ripple field, reflected ray into a studio map, tinted gold.
2. Rings in perspective, damped with distance.
3. Stream: cylinder shading, thinning, sliding highlights.
4. A bright crown at the impact.
5. Deep blacks, grain, vignette.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the pool reads as liquid metal, not yellow paint; the softbox reflection bends with the rings; the rings are ellipses in perspective; the word is crisp. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Casting_(metalworking)",
  theme: {
    bg: "#090705",
    ink: "#fff5dd",
    accent: "#e9a93a",
    accent2: "#5f7f9e",
    font: FAMILY,
  },
  fonts: ["Cinzel:wght@400..900"],
  tags: [
    "gold",
    "molten",
    "liquid",
    "metal",
    "luxury",
    "pour",
    "premium",
    "ripple",
    "rich",
    "shiny",
    "casting",
  ],
  word: "Aurum",
  render(ctx, t, theme, w, h) {
    const G = geometry(w, h);
    const { u, horizon } = G;
    const env = envMap(theme);
    const gold = parse(theme.accent).map((v) => v / 255);
    const hot = parse(mix(theme.ink, theme.accent, 0.25)).map((v) => v / 255);
    const glow = parse(mix(theme.accent, "#000000", 0.25)).map((v) => v / 255);
    ground(ctx, w, h, theme.bg);
    // The studio behind: near black with a faint warm glow above the pool.
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, rgba(theme.bg, 1));
    sky.addColorStop(1, rgba(mix(theme.bg, theme.accent, 0.1), 1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    // Pool: ripple normals -> reflected ray -> studio map, tinted gold.
    const { bw, bh, r, dx, dz, decay, el, az, front } = G;
    const { canvas: pc, ctx: Pc } = buffer("gold-pool", bw, bh);
    const img = Pc.createImageData(bw, bh);
    const d = img.data;
    const p = t / LOOP;
    const ringK = 1.25;
    const cycles = 2;
    const swellA = 0.03;
    const E = env.E;
    const A = env.A;
    const ed = env.data;
    const streamAz = Math.atan((G.impactX - w / 2) / (u * 1.2));
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) {
        const o = j * bw + i;
        // Rings: phase travels outward, whole cycles per loop.
        const ph = r[o] * ringK - p * cycles;
        const c = tsin(ph + 0.25);
        const amp = decay[o] * 0.34;
        let gx = amp * c * dx[o];
        let gz = amp * c * dz[o];
        // Cross swells keep the whole pool moving.
        gx +=
          swellA * tsin((i / bw) * 3 + p) +
          swellA * 0.5 * tsin((i / bw) * 7 - (j / bh) * 2 - 2 * p);
        gz +=
          swellA * 1.2 * tsin((j / bh) * 2.5 - p) +
          swellA * 0.6 * tsin((j / bh) * 6 + (i / bw) * 3 + p);
        // Linearised reflection: slopes tip the reflected ray.
        let e = el[o] - gz * 1.1;
        let a = az[o] + gx * 1.2;
        e = e < 0 ? 0 : e > 0.9 ? 0.9 : e;
        a = a < -1.2 ? -1.2 : a > 1.2 ? 1.2 : a;
        // Bilinear lookup into the studio map, so reflected edges stay smooth.
        const fe = (e / 0.9) * (E - 1.001);
        const fa = ((a + 1.2) / 2.4) * (A - 1.001);
        const e0 = fe | 0;
        const a0 = fa | 0;
        const te = fe - e0;
        const ta = fa - a0;
        const q00 = (e0 * A + a0) * 3;
        const q01 = q00 + 3;
        const q10 = q00 + A * 3;
        const q11 = q10 + 3;
        const w00 = (1 - te) * (1 - ta);
        const w01 = (1 - te) * ta;
        const w10 = te * (1 - ta);
        const w11 = te * ta;
        let R = ed[q00] * w00 + ed[q01] * w01 + ed[q10] * w10 + ed[q11] * w11;
        let Gc = ed[q00 + 1] * w00 + ed[q01 + 1] * w01 + ed[q10 + 1] * w10 + ed[q11 + 1] * w11;
        let B = ed[q00 + 2] * w00 + ed[q01 + 2] * w01 + ed[q10 + 2] * w10 + ed[q11 + 2] * w11;
        // The stream itself is in the studio: its reflection wobbles in front of the impact.
        if (front[o] === 1) {
          const sa = Math.abs(a - streamAz);
          if (sa < 0.025 && e < 0.62) {
            const s = (1 - sa / 0.025) * 0.8;
            R += (1.1 - R) * s;
            Gc += (0.9 - Gc) * s;
            B += (0.5 - B) * s;
          }
        }
        // Metal: reflection tinted by the gold; the brightest light runs toward white-gold.
        const lum = (R + Gc + B) / 3;
        const whiten = lum > 0.75 ? Math.min(1, (lum - 0.75) * 2) : 0;
        // It is molten, so it glows: hotter near the pour, cooler far away, darker in the troughs.
        const heat = 0.3 + 0.5 * decay[o] + 0.08 * c * decay[o];
        let rr = R * gold[0] * 1.2 + heat * glow[0];
        let gg = Gc * gold[1] * 1.2 + heat * glow[1];
        let bb = B * gold[2] * 1.2 + heat * glow[2];
        rr += (hot[0] - rr) * whiten;
        gg += (hot[1] - gg) * whiten;
        bb += (hot[2] - bb) * whiten;
        const k = o * 4;
        d[k] = rr * 255;
        d[k + 1] = gg * 255;
        d[k + 2] = bb * 255;
        d[k + 3] = 255;
      }
    }
    Pc.putImageData(img, 0, 0);
    const top = Math.floor(horizon * G.k) / G.k;
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pc as CanvasImageSource, 0, top, w, h - top);
    // The far edge of the pool falls into shadow; a thin lip catches the light.
    const fade = ctx.createLinearGradient(0, top, 0, top + h * 0.08);
    fade.addColorStop(0, rgba(theme.bg, 0.9));
    fade.addColorStop(1, rgba(theme.bg, 0));
    ctx.fillStyle = fade;
    ctx.fillRect(0, top, w, h * 0.08);
    ctx.restore();

    // The stream.
    const sx = G.impactX;
    const sBot = G.impactY;
    const steps = 40;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const y = -u * 0.05 + (sBot + u * 0.05) * f;
      const width = u * (0.052 - 0.02 * Math.sqrt(f));
      const wob =
        u * 0.003 * Math.sin(TAU * (f * 1.5 - p * 2)) * f + u * 0.003 * tnoise(t + f * 0.5, 2, 3);
      left.push([sx - width / 2 + wob, y]);
      right.push([sx + width / 2 + wob, y]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const q of left) ctx.lineTo(q[0], q[1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    const across = ctx.createLinearGradient(sx - u * 0.025, 0, sx + u * 0.025, 0);
    const g0 = mix(theme.accent, theme.bg, 0.55);
    const g1 = theme.accent;
    const g2 = mix(theme.ink, theme.accent, 0.2);
    across.addColorStop(0, rgba(mix(theme.accent, "#000000", 0.6), 1));
    across.addColorStop(0.18, rgba(g0, 1));
    across.addColorStop(0.36, rgba(g2, 1));
    across.addColorStop(0.46, rgba(g1, 1));
    across.addColorStop(0.75, rgba(g0, 1));
    across.addColorStop(1, rgba(mix(theme.accent, "#000000", 0.7), 1));
    ctx.fillStyle = across;
    ctx.fill();
    ctx.clip();
    // Highlights sliding down the stream.
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 7; k++) {
      const f = (((k / 7 + p * 2) % 1) + 1) % 1;
      const y = -u * 0.05 + (sBot + u * 0.05) * f;
      const len = u * (0.04 + (0.03 * ((k * 37) % 5)) / 5);
      const g = ctx.createLinearGradient(0, y - len, 0, y + len);
      g.addColorStop(0, rgba(theme.ink, 0));
      g.addColorStop(0.5, rgba(theme.ink, 0.35));
      g.addColorStop(1, rgba(theme.ink, 0));
      ctx.fillStyle = g;
      ctx.fillRect(sx - u * 0.012 + (((k * 13) % 7) - 3) * u * 0.002, y - len, u * 0.01, len * 2);
    }
    ctx.restore();

    // The crown where it lands: a bright bulge and a glow on the pool.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(sx, sBot);
    ctx.scale(1, 0.32);
    const crown = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 0.09);
    crown.addColorStop(0, rgba(mix(theme.ink, theme.accent, 0.3), 0.85));
    crown.addColorStop(0.35, rgba(theme.accent, 0.4));
    crown.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = crown;
    ctx.fillRect(-u * 0.09, -u * 0.09, u * 0.18, u * 0.18);
    ctx.restore();

    // The word, engraved in gold capitals.
    const { portrait } = frameOf(w, h);
    const word = wordFor(theme.name, "Aurum", 12).toUpperCase();
    const family = theme.font || FAMILY;
    ctx.save();
    const track = u * 0.02;
    ctx.letterSpacing = `${track.toFixed(1)}px`;
    const fit = fitText(ctx, word, portrait ? w * 0.7 : w * 0.34, h * 0.1, u * 0.1, 600, family);
    ctx.font = fontOf("", 600, fit.size, family);
    const tx = portrait ? w * 0.5 - fit.width / 2 : w * 0.08;
    const ty = portrait ? h * 0.2 : h * 0.3;
    const face = ctx.createLinearGradient(0, ty - fit.ascent, 0, ty);
    face.addColorStop(0, rgba(mix(theme.ink, theme.accent, 0.35), 1));
    face.addColorStop(0.55, rgba(theme.accent, 1));
    face.addColorStop(1, rgba(mix(theme.accent, theme.bg, 0.45), 1));
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(word, tx, ty + u * 0.004);
    ctx.fillStyle = face;
    ctx.fillText(word, tx, ty);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.accent, 0.5);
    ctx.fillRect(tx, ty + fit.size * 0.35, Math.min(fit.width, u * 0.14), Math.max(1, u * 0.0016));
    const mark = tintedLogo(theme, rgba(theme.accent, 0.9), u * 0.05, u * 0.05);
    if (mark) ctx.drawImage(mark as CanvasImageSource, tx, ty - fit.ascent - u * 0.08);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.26);
  },
};
