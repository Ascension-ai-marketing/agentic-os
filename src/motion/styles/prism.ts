import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  frameOf,
  grain,
  ground,
  hash,
  LOOP,
  once,
  rng,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { fitText, fontOf, spectrum } from "./_s5-helpers";

const FAMILY = "Fraunces";
const WAVES = 9;

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

/** Ray vs segment: distance along the ray to segment p-q, or -1. */
function hit(o: V, d: V, p: V, q: V): number {
  const e = sub(q, p);
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return -1;
  const w = sub(p, o);
  const t = (w[0] * e[1] - w[1] * e[0]) / den;
  const s = (w[0] * d[1] - w[1] * d[0]) / den;
  return t > 1e-6 && s >= 0 && s <= 1 ? t : -1;
}

/** Snell's law in vector form; null on total internal reflection. */
function refract(d: V, n: V, eta: number): V | null {
  let nn = n;
  let cosi = -dot(nn, d);
  if (cosi < 0) {
    nn = [-n[0], -n[1]];
    cosi = -cosi;
  }
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const a = eta * cosi - Math.sqrt(k);
  return norm([eta * d[0] + a * nn[0], eta * d[1] + a * nn[1]]);
}

interface Layout {
  u: number;
  portrait: boolean;
  cx: number;
  cy: number;
  side: number;
  beamY: number;
  word: { x: number; y: number; size: number };
}

function layout(
  ctx: Ctx2D,
  theme: Theme,
  w: number,
  h: number,
  word: string,
  family: string,
): Layout {
  const { u, portrait } = frameOf(w, h);
  const side = u * (portrait ? 0.36 : 0.34);
  const cx = portrait ? w * 0.34 : w * 0.3;
  const cy = portrait ? h * 0.3 : h * 0.34;
  ctx.save();
  ctx.letterSpacing = "0px";
  const fit = fitText(
    ctx,
    word,
    portrait ? w * 0.84 : w * 0.6,
    h * (portrait ? 0.11 : 0.24),
    u * 0.34,
    700,
    family,
  );
  ctx.restore();
  const { square } = frameOf(w, h);
  const wx = portrait ? w * 0.5 : square ? w * 0.56 : w * 0.64;
  const wy = portrait ? h * 0.62 : square ? h * 0.7 : h * 0.66;
  return {
    u,
    portrait,
    cx,
    cy,
    side,
    beamY: cy + side * 0.02,
    word: { x: wx, y: wy, size: fit.size },
  };
}

function prismPoints(L: Layout, rot: number): V[] {
  const R = L.side / Math.sqrt(3);
  const out: V[] = [];
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + rot + (i * TAU) / 3;
    out.push([L.cx + Math.cos(a) * R, L.cy + Math.sin(a) * R]);
  }
  // Apex, bottom-right, bottom-left.
  return out;
}

interface Ray {
  entry: V;
  exit: V;
  dir: V;
  color: string;
}

/** The beam: a fixed pivot on the prism's lit face, its angle steered slowly (like a mirror). */
function beamOf(L: Layout, rot: number, tilt: number) {
  const [A, , Bl] = prismPoints(L, rot);
  const pivot: V = [Bl[0] + (A[0] - Bl[0]) * 0.52, Bl[1] + (A[1] - Bl[1]) * 0.52];
  const d = norm([Math.cos(-0.31 + tilt), Math.sin(-0.31 + tilt)]);
  const back = (pivot[0] + L.u * 0.1) / d[0];
  const o: V = [pivot[0] - d[0] * back, pivot[1] - d[1] * back];
  return { o, d };
}

function trace(
  L: Layout,
  rot: number,
  tilt: number,
  colors: string[],
): { o: V; entry: V; rays: Ray[] } | null {
  const [A, Br, Bl] = prismPoints(L, rot);
  const { o, d } = beamOf(L, rot, tilt);
  const t1 = hit(o, d, Bl, A);
  if (t1 < 0) return null;
  const entry: V = [o[0] + d[0] * t1, o[1] + d[1] * t1];
  const eL = sub(A, Bl);
  const nL = norm([eL[1], -eL[0]]);
  const eR = sub(Br, A);
  const nR = norm([eR[1], -eR[0]]);
  const rays: Ray[] = [];
  for (let k = 0; k < colors.length; k++) {
    const f = k / (colors.length - 1);
    // Exaggerated dispersion: red bends least, violet most.
    const n = 1.46 + 0.16 * f;
    const inside = refract(d, nL, 1 / n);
    if (!inside) continue;
    const t2 = hit(entry, inside, A, Br);
    if (t2 < 0) continue;
    const exit: V = [entry[0] + inside[0] * t2, entry[1] + inside[1] * t2];
    const out = refract(inside, nR, n);
    if (!out) continue;
    rays.push({ entry, exit, dir: out, color: colors[k] });
  }
  return { o, entry, rays };
}

/** Dust motes: fixed seeds that drift on small loops. */
const MOTES = once("prism-motes", () => {
  const r = rng(515);
  return Array.from({ length: 170 }, () => ({
    x: r(),
    y: r(),
    a: r(),
    s: 0.4 + r() * r() * 1.8,
    ph: r(),
  }));
});

export const style: MotionStyle = {
  id: "prism",
  name: "Prism",
  family: "Light & Material",
  tagline: "A prism fans a beam into colour",
  look: "A glass prism in the dark: a thin white beam enters, bends and fans out as a spectrum that paints a large word, dust glinting in the light.",
  move: "The prism turns a few degrees and back; the spectrum swings with it, sweeping its colours across the letters; the beam never breaks.",
  rules: [
    "Real refraction: each colour bends by its own index, so the fan is ordered red to violet.",
    "White light in, spectrum out; inside the glass the beam is a faint pale line.",
    "The glass shows only in its edges and highlights, never as a filled shape.",
    "Light is visible only where it hits something: haze, dust or the word.",
    "The word is dark until the spectrum crosses it, then takes the light's colour.",
    "Dust motes glint as they drift through the beam and the fan.",
  ],
  prompt: `R — References
• Newton's prism experiment photographs (search: prism dispersion photography, light through prism dark room).
• Dust in a projector beam; light falling across raised lettering.

I — Idea
White light splits and paints a word, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a thin white beam crosses the dark and enters a glass prism; a spectrum fans out of the far face and falls across "{{name}}".
• Middle (1.5–3.5 s): the prism turns a few degrees; the fan swings, sweeping its bands of colour across the letters; dust glints as it drifts through the light.
• End (3.5–5 s): the prism turns back to where it began.

S — Style
Looks: {{bg}} darkness; the beam {{ink}}; a spectrum running from {{accent}} to {{accent2}}; glass drawn only as edges and highlights; the word in {{font}}, large, barely visible until lit.
Moves: one slow sine rotation of about ±7° per loop; the fan follows by real refraction; dust drifts on small loops.
Rules:
1. Trace each wavelength with Snell's law; exaggerate the dispersion so the fan reads.
2. Additive light; the fan fades with distance.
3. Glass as edges, highlights and a faint internal path.
4. The word is lit by the fan (light times letter mask).
5. Dust, grain, vignette.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the spectrum is ordered and continuous, not separate stripes; the lit part of the word moves between frames; the glass reads as glass; the beam is thin and white. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Dispersion_(optics)",
  theme: {
    bg: "#060608",
    ink: "#f7f5f0",
    accent: "#ff4a4a",
    accent2: "#7b5cff",
    font: FAMILY,
  },
  fonts: ["Fraunces:opsz,wght@9..144,300..800"],
  tags: [
    "prism",
    "light",
    "rainbow",
    "spectrum",
    "physics",
    "science",
    "refraction",
    "glass",
    "beam",
    "dark",
    "optics",
  ],
  word: "Spectrum",
  render(ctx, t, theme, w, h) {
    const word = wordFor(theme.name, "Spectrum", 12);
    const family = theme.font || FAMILY;
    const L = layout(ctx, theme, w, h, word, family);
    const { u } = L;
    const ph = (TAU * t) / LOOP;
    // Portrait turns the whole bench so the fan falls steeply onto the word.
    const base = L.portrait ? 0.66 : frameOf(w, h).square ? 0.3 : 0;
    const rot = base + 0.1 * Math.sin(ph);
    const tilt = base - 0.075 * Math.sin(ph);
    const colors = spectrum(theme.accent, theme.accent2, WAVES, 0.74, 0.2);
    const tr = trace(L, rot, tilt, colors);
    ground(ctx, w, h, theme.bg);
    const glow = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(w, h) * 0.8);
    glow.addColorStop(0, rgba(mix(theme.bg, theme.ink, 0.06), 1));
    glow.addColorStop(1, rgba(theme.bg, 1));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // The unlit word: just visible.
    const mask = bake(`prism-word:${word}|${family}`, w, h, (c) => {
      c.font = fontOf("", 700, L.word.size, family);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#fff";
      c.fillText(word, L.word.x, L.word.y);
    });
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.drawImage(mask as CanvasImageSource, 0, 0);
    ctx.restore();

    // The fan, into a buffer: filled bands between neighbouring colours.
    const { canvas: fc, ctx: F } = buffer("prism-fan", w, h);
    F.save();
    F.globalCompositeOperation = "source-over";
    F.globalAlpha = 1;
    F.fillStyle = "#000";
    F.fillRect(0, 0, w, h);
    F.globalCompositeOperation = "lighter";
    const far = Math.hypot(w, h) * 1.2;
    if (tr && tr.rays.length > 1) {
      const rays = tr.rays;
      for (let k = 0; k < rays.length - 1; k++) {
        const a = rays[k];
        const b = rays[k + 1];
        const a2: V = [a.exit[0] + a.dir[0] * far, a.exit[1] + a.dir[1] * far];
        const b2: V = [b.exit[0] + b.dir[0] * far, b.exit[1] + b.dir[1] * far];
        const g = F.createLinearGradient(
          a.exit[0],
          a.exit[1],
          (a2[0] + b2[0]) / 2,
          (a2[1] + b2[1]) / 2,
        );
        const col = mix(a.color, b.color, 0.5);
        g.addColorStop(0, rgba(col, 0.95));
        g.addColorStop(0.25, rgba(col, 0.55));
        g.addColorStop(1, rgba(col, 0.1));
        F.fillStyle = g;
        F.beginPath();
        F.moveTo(a.exit[0], a.exit[1]);
        F.lineTo(a2[0], a2[1]);
        F.lineTo(b2[0], b2[1]);
        F.lineTo(b.exit[0], b.exit[1]);
        F.closePath();
        F.fill();
      }
    }
    F.restore();

    // The fan as light in the air (dim), and on the word (bright).
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.28;
    ctx.filter = `blur(${(u * 0.004).toFixed(1)}px)`;
    ctx.drawImage(fc as CanvasImageSource, 0, 0);
    ctx.filter = "none";
    ctx.restore();
    const { canvas: wc, ctx: Wd } = buffer("prism-lit", w, h);
    Wd.save();
    Wd.globalCompositeOperation = "copy";
    Wd.drawImage(fc as CanvasImageSource, 0, 0);
    Wd.globalCompositeOperation = "destination-in";
    Wd.drawImage(mask as CanvasImageSource, 0, 0);
    Wd.restore();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;
    ctx.drawImage(wc as CanvasImageSource, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.filter = `blur(${(u * 0.012).toFixed(1)}px)`;
    ctx.drawImage(wc as CanvasImageSource, 0, 0);
    ctx.filter = "none";
    ctx.restore();

    // The white beam in, and the pale path inside the glass.
    if (tr) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      const [x0, y0] = tr.o;
      const beam = ctx.createLinearGradient(x0, y0, tr.entry[0], tr.entry[1]);
      beam.addColorStop(0, rgba(theme.ink, 0.35));
      beam.addColorStop(1, rgba(theme.ink, 0.95));
      ctx.strokeStyle = rgba(theme.ink, 0.12);
      ctx.lineWidth = u * 0.014;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(tr.entry[0], tr.entry[1]);
      ctx.stroke();
      ctx.strokeStyle = beam;
      ctx.lineWidth = Math.max(1, u * 0.0035);
      ctx.stroke();
      if (tr.rays.length) {
        const first = tr.rays[0];
        const last = tr.rays[tr.rays.length - 1];
        ctx.fillStyle = rgba(theme.ink, 0.22);
        ctx.beginPath();
        ctx.moveTo(tr.entry[0], tr.entry[1] - u * 0.002);
        ctx.lineTo(first.exit[0], first.exit[1]);
        ctx.lineTo(last.exit[0], last.exit[1]);
        ctx.lineTo(tr.entry[0], tr.entry[1] + u * 0.002);
        ctx.closePath();
        ctx.fill();
        // Hot spots where light crosses a surface.
        for (const [px, py, r] of [
          [tr.entry[0], tr.entry[1], u * 0.03],
          [(first.exit[0] + last.exit[0]) / 2, (first.exit[1] + last.exit[1]) / 2, u * 0.035],
        ]) {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, rgba(theme.ink, 0.55));
          g.addColorStop(1, rgba(theme.ink, 0));
          ctx.fillStyle = g;
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
      ctx.restore();
    }

    // The glass: edges and highlights only.
    const P = prismPoints(L, rot);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    ctx.lineTo(P[1][0], P[1][1]);
    ctx.lineTo(P[2][0], P[2][1]);
    ctx.closePath();
    const body = ctx.createLinearGradient(P[2][0], P[2][1], P[1][0], P[0][1]);
    body.addColorStop(0, rgba(theme.ink, 0.07));
    body.addColorStop(0.5, rgba(theme.ink, 0.02));
    body.addColorStop(1, rgba(theme.ink, 0.06));
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(theme.ink, 0.28);
    ctx.lineWidth = Math.max(1, u * 0.0022);
    ctx.stroke();
    // Thickness: an inset edge a little inside the outline, like the far edges seen through glass.
    const gx = (P[0][0] + P[1][0] + P[2][0]) / 3;
    const gy = (P[0][1] + P[1][1] + P[2][1]) / 3;
    ctx.strokeStyle = rgba(theme.ink, 0.1);
    ctx.lineWidth = Math.max(1, u * 0.0016);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const x = gx + (P[i][0] - gx) * 0.86;
      const y = gy + (P[i][1] - gy) * 0.86 - L.side * 0.02;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    // A specular streak across the glass, clipped to it.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    ctx.lineTo(P[1][0], P[1][1]);
    ctx.lineTo(P[2][0], P[2][1]);
    ctx.closePath();
    ctx.clip();
    const st = ctx.createLinearGradient(P[2][0], P[0][1], P[1][0], P[2][1]);
    st.addColorStop(0, rgba(theme.ink, 0));
    st.addColorStop(0.36, rgba(theme.ink, 0));
    st.addColorStop(0.42, rgba(theme.ink, 0.1));
    st.addColorStop(0.47, rgba(theme.ink, 0.02));
    st.addColorStop(0.55, rgba(theme.ink, 0.06));
    st.addColorStop(0.6, rgba(theme.ink, 0));
    ctx.fillStyle = st;
    ctx.fillRect(gx - L.side, gy - L.side, L.side * 2, L.side * 2);
    // Dispersed light caught inside the base.
    if (tr && tr.rays.length > 1) {
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < tr.rays.length; k += 2) {
        const r = tr.rays[k];
        const bx = P[2][0] + (P[1][0] - P[2][0]) * (0.55 + (k / tr.rays.length) * 0.3);
        const by = P[2][1] + (P[1][1] - P[2][1]) * (0.55 + (k / tr.rays.length) * 0.3);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, L.side * 0.18);
        g.addColorStop(0, rgba(r.color, 0.16));
        g.addColorStop(1, rgba(r.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(bx - L.side * 0.18, by - L.side * 0.18, L.side * 0.36, L.side * 0.36);
      }
    }
    ctx.restore();
    // A brighter bevel on the lit face and a glint at the apex.
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(theme.ink, 0.5);
    ctx.lineWidth = Math.max(1, u * 0.0032);
    ctx.beginPath();
    ctx.moveTo(P[2][0], P[2][1]);
    ctx.lineTo(P[0][0], P[0][1]);
    ctx.stroke();
    const ag = ctx.createRadialGradient(P[0][0], P[0][1], 0, P[0][0], P[0][1], u * 0.04);
    ag.addColorStop(0, rgba(theme.ink, 0.5));
    ag.addColorStop(1, rgba(theme.ink, 0));
    ctx.fillStyle = ag;
    ctx.fillRect(P[0][0] - u * 0.04, P[0][1] - u * 0.04, u * 0.08, u * 0.08);
    ctx.restore();

    // Dust: glints where it crosses the light.
    if (tr && tr.rays.length > 1) {
      const p = t / LOOP;
      const first = tr.rays[0];
      const last = tr.rays[tr.rays.length - 1];
      const ex = (first.exit[0] + last.exit[0]) / 2;
      const ey = (first.exit[1] + last.exit[1]) / 2;
      const a0 = Math.atan2(first.dir[1], first.dir[0]);
      const a1 = Math.atan2(last.dir[1], last.dir[0]);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const m of MOTES) {
        const x = (m.x + 0.02 * Math.sin(TAU * (p + m.ph))) * w;
        const y = (m.y + 0.03 * Math.sin(TAU * (p + m.a))) * h;
        let col: string | null = null;
        let k = 0;
        // In the white beam?
        if (x < tr.entry[0]) {
          const slope = (tr.entry[1] - tr.o[1]) / (tr.entry[0] - tr.o[0]);
          const dy = Math.abs(y - (tr.o[1] + (x - tr.o[0]) * slope));
          if (dy < u * 0.012) {
            col = theme.ink;
            k = 1 - dy / (u * 0.012);
          }
        } else {
          const a = Math.atan2(y - ey, x - ex);
          const f = (a - a0) / (a1 - a0);
          if (f >= 0 && f <= 1 && x > ex) {
            col = tr.rays[Math.min(tr.rays.length - 1, Math.round(f * (tr.rays.length - 1)))].color;
            k = 0.8 * Math.min(1, Math.min(f, 1 - f) * 8);
          }
        }
        if (!col || k <= 0.02) continue;
        const tw = 0.6 + 0.4 * Math.sin(TAU * (2 * p + m.ph * 3));
        const s = Math.max(0.6, u * 0.0018 * m.s);
        ctx.fillStyle = rgba(col, clamp(k * tw));
        ctx.beginPath();
        ctx.arc(x, y, s, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    const mark = tintedLogo(theme, rgba(theme.ink, 0.6), u * 0.05, u * 0.05);
    if (mark) ctx.drawImage(mark as CanvasImageSource, u * 0.06, h - u * 0.11);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
  },
};
