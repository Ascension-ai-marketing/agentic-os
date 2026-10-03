import { fromOklch, mix, parse, rgba, toOklch } from "../engine/color";
import {
  buffer,
  clamp,
  context,
  font,
  frameOf,
  grain,
  ground,
  LOOP,
  makeCanvas,
  once,
  rng,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle, Theme } from "../engine/types";
import { fitText, fontReady } from "./_s5-helpers";

const FAMILY = "Unbounded";

/**
 * A cyclic foil palette: the whole hue circle, anchored on the theme's two
 * accents (their lightness and chroma hold near them), pearly in between.
 */
function foilLUT(theme: Theme): Uint8ClampedArray {
  return once(`holo-lut:${theme.accent}${theme.accent2}${theme.ink}`, () => {
    const [La, Ca, ha] = toOklch(theme.accent);
    const [Lb, Cb, hb] = toOklch(theme.accent2);
    const up = (hb - ha + 360) % 360;
    const through = (170 - ha + 360) % 360;
    const span = through <= up ? up : up - 360;
    const rest = span > 0 ? 360 - span : -360 - span;
    const n = 256;
    const out = new Uint8ClampedArray(n * 3);
    const la = clamp(0.62 + La * 0.3, 0.72, 0.9);
    const lb = clamp(0.62 + Lb * 0.3, 0.72, 0.9);
    const ca = clamp(Ca, 0.1, 0.19);
    const cb = clamp(Cb, 0.1, 0.19);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      let L: number;
      let C: number;
      let hue: number;
      if (p < 0.5) {
        const k = p / 0.5;
        hue = ha + span * k;
        L = la + (lb - la) * k + 0.05 * Math.sin(Math.PI * k);
        C = ca + (cb - ca) * k;
      } else {
        const k = (p - 0.5) / 0.5;
        hue = hb + rest * k;
        L = lb + (la - lb) * k + 0.03 * Math.sin(Math.PI * k);
        C = cb + (ca - cb) * k;
      }
      const c = parse(fromOklch([L, C, ((hue % 360) + 360) % 360]));
      out[i * 3] = c[0];
      out[i * 3 + 1] = c[1];
      out[i * 3 + 2] = c[2];
    }
    return out;
  });
}

interface Maps {
  W: number;
  H: number;
  /** Static diffraction phase per pixel: position, facet, grating and stamped face. */
  base: Float32Array;
  /** Coordinate along the rainbow band. */
  bpos: Float32Array;
  /** Height-map slope (for the emboss bevels). */
  bx: Float32Array;
  by: Float32Array;
  /** Facet seams and the stamped face's lift, as one multiplier. */
  mul: Float32Array;
  /** Rounded-corner coverage. */
  alpha: Float32Array;
  cell: Uint16Array;
  cellGlint: Float32Array;
  sparks: { x: number; y: number; k: number; s: number }[];
}

/** Everything about the card that does not move, precomputed so a frame is a few lookups per pixel. */
function cardMaps(W: number, H: number, word: string, family: string, key: string): Maps {
  return once(`holo-maps:${W}x${H}:${word}:${family}:${key}`, () => {
    const N = W * H;
    // Cracked ice: jittered-grid Voronoi with an edge term (F2 - F1).
    const cellsX = 16;
    const cs = W / cellsX;
    const cellsY = Math.ceil(H / cs);
    const r = rng(4411);
    const px: number[] = [];
    const py: number[] = [];
    for (let j = 0; j < cellsY; j++)
      for (let i = 0; i < cellsX; i++) {
        px.push((i + 0.1 + r() * 0.8) * cs);
        py.push((j + 0.1 + r() * 0.8) * cs);
      }
    const count = px.length;
    const cellPhase = new Float32Array(count);
    const cellGlint = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      cellPhase[k] = (r() - 0.5) * 0.16;
      cellGlint[k] = r();
    }
    const cell = new Uint16Array(N);
    const edge = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const gj = Math.floor(y / cs);
      for (let x = 0; x < W; x++) {
        const gi = Math.floor(x / cs);
        let d1 = 1e9;
        let d2 = 1e9;
        let best = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = gj + dj;
          if (jj < 0 || jj >= cellsY) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = gi + di;
            if (ii < 0 || ii >= cellsX) continue;
            const k = jj * cellsX + ii;
            const dx = px[k] - x;
            const dy = py[k] - y;
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = k;
            } else if (d < d2) d2 = d;
          }
        }
        const i = y * W + x;
        cell[i] = best;
        edge[i] = clamp(1 - (Math.sqrt(d2) - Math.sqrt(d1)) / Math.max(0.8, cs * 0.07));
      }
    }

    // Relief: the stamped elements, white on black, read back as masks.
    const c = makeCanvas(W, H);
    const g = context(c);
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    const m = W * 0.055;
    g.lineWidth = Math.max(1, W * 0.007);
    g.beginPath();
    g.roundRect(m, m, W - m * 2, H - m * 2, W * 0.03);
    g.stroke();
    // A guilloche rosette, the classic security-hologram seal.
    const cx = W / 2;
    const cy = H * 0.37;
    const R = W * 0.31;
    g.lineWidth = Math.max(0.7, W * 0.003);
    for (let ring = 0; ring < 8; ring++) {
      const baseR = R * (0.4 + ring * 0.078);
      const amp = R * 0.045;
      g.beginPath();
      for (let s = 0; s <= 480; s++) {
        const a = (s / 480) * TAU;
        const rr = baseR + amp * Math.sin(14 * a + ring * 0.8) + amp * 0.4 * Math.sin(5 * a - ring);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.beginPath();
    for (let s = 0; s < 16; s++) {
      const a = (s / 16) * TAU - Math.PI / 2;
      const rr = s % 2 === 0 ? R * 0.28 : R * 0.09;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (s === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.textBaseline = "alphabetic";
    const fit = fitText(g, word, W * 0.74, H * 0.12, W * 0.2, 800, family);
    g.font = font(800, fit.size, family);
    const mm = g.measureText(word);
    g.fillText(
      word,
      W / 2 - (mm.actualBoundingBoxRight - mm.actualBoundingBoxLeft) / 2,
      H * 0.75 + (mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2,
    );
    g.font = font(500, W * 0.034, family);
    g.letterSpacing = `${(W * 0.006).toFixed(2)}px`;
    g.fillText("Nº 001", m * 1.8, m * 1.8 + W * 0.034);
    g.letterSpacing = "0px";
    g.fillRect(W * 0.32, H * 0.865, W * 0.36, Math.max(1, W * 0.004));
    const faceData = g.getImageData(0, 0, W, H).data;
    const blurPx = Math.max(0.8, W * 0.0055);
    g.filter = `blur(${blurPx.toFixed(2)}px)`;
    g.drawImage(c as CanvasImageSource, 0, 0);
    g.filter = "none";
    const soft = g.getImageData(0, 0, W, H).data;

    const base = new Float32Array(N);
    const bpos = new Float32Array(N);
    const bx = new Float32Array(N);
    const by = new Float32Array(N);
    const mul = new Float32Array(N);
    const alpha = new Float32Array(N);
    const K = 0.75 * blurPx;
    const rad = W * 0.06;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const U = x / W;
        const V = y / H;
        const f = faceData[i * 4] / 255;
        // A fine diffraction grating on top of the position gradient.
        const grating = 0.035 * Math.sin(TAU * 34 * (0.8 * U + 0.4 * V));
        base[i] = 1.25 * U + 0.75 * V + cellPhase[cell[i]] * (1 - f) + grating * (1 - f) + f * 0.5;
        bpos[i] = U * 0.78 + V * 0.52;
        const hx =
          (soft[(y * W + Math.min(W - 1, x + 1)) * 4] - soft[(y * W + Math.max(0, x - 1)) * 4]) /
          255;
        const hy =
          (soft[(Math.min(H - 1, y + 1) * W + x) * 4] - soft[(Math.max(0, y - 1) * W + x) * 4]) /
          255;
        bx[i] = hx * K;
        by[i] = hy * K;
        mul[i] = (1 - edge[i] * 0.32 * (1 - f)) * (1 + f * 0.14);
        const qx = Math.max(rad - x - 0.5, x + 0.5 - (W - rad), 0);
        const qy = Math.max(rad - y - 0.5, y + 0.5 - (H - rad), 0);
        alpha[i] = clamp(0.5 - (Math.hypot(qx, qy) - rad));
      }
    const sparks: Maps["sparks"] = [];
    const rs = rng(77);
    for (let k = 0; k < 26; k++)
      sparks.push({
        x: (0.08 + rs() * 0.84) * W,
        y: (0.06 + rs() * 0.88) * H,
        k: rs(),
        s: 0.5 + rs() * 0.8,
      });
    return { W, H, base, bpos, bx, by, mul, alpha, cell, cellGlint, sparks };
  });
}

const BAND = (() => {
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const bd = i / 128 - 2;
    out[i] = Math.exp(-bd * bd * 8);
  }
  return out;
})();
const GLARE = (() => {
  const out = new Float32Array(257);
  for (let i = 0; i <= 256; i++) out[i] = Math.exp(-(i / 256) * 10) * 0.5;
  return out;
})();

/** A four-point glint sprite, white on transparent (built on first use: no DOM at import). */
const star = () =>
  once("holo-star", () => {
    const S = 64;
    const c = makeCanvas(S, S);
    const g = context(c);
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.18);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    for (const [w0, h0] of [
      [S, S * 0.06],
      [S * 0.06, S],
    ]) {
      const lg = w0 > h0 ? g.createLinearGradient(0, 0, S, 0) : g.createLinearGradient(0, 0, 0, S);
      lg.addColorStop(0, "rgba(255,255,255,0)");
      lg.addColorStop(0.5, "rgba(255,255,255,0.95)");
      lg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lg;
      g.fillRect((S - w0) / 2, (S - h0) / 2, w0, h0);
    }
    return c;
  });

function card(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const ch = portrait ? Math.min(h * 0.62, (w * 0.74) / 0.714) : square ? h * 0.8 : h * 0.8;
  const cw = ch * 0.714;
  return { cw, ch, cx: w / 2, cy: h * (portrait ? 0.47 : 0.49) };
}

export const style: MotionStyle = {
  id: "holo-foil",
  name: "Holo Foil",
  family: "Light & Material",
  tagline: "A holographic foil card",
  look: "A holographic foil card under a spotlight: cracked-ice facets, a guilloche seal and an embossed wordmark throwing rainbow light.",
  move: "The card rocks gently in 3D; the rainbow slides across the foil, facets glint in turn and the glare sweeps over the emboss.",
  rules: [
    "The foil colour depends on the viewing angle: tilt the card and the rainbow moves.",
    "Cracked-ice facets each sit at their own phase, with fine dark seams between.",
    "Embossed elements catch a highlight on one bevel and a shadow on the other.",
    "One soft glare travels with the tilt; glints fire on single facets.",
    "Real perspective: the near edge grows, the far edge shrinks.",
    "The card throws a faint coloured glow onto the dark behind it.",
    "Pastel, pearly colour, anchored on the brand's two accents.",
  ],
  prompt: `R — References
• Holographic trading cards and foil stickers (search: holo foil card, cracked ice holo).
• The CSS holo-card technique: stacked rainbow gradients with colour-dodge, shifted by tilt (simeydotme pokemon-cards-css).
• Security holograms with guilloche rosettes.

I — Idea
One foil card rocking under a light, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): the card turns slightly left; a pearly rainbow sits over its cracked-ice surface.
• Middle (1.5–3.5 s): it rocks through to the right; the rainbow slides across, facets glint in turn, the glare sweeps over the embossed "{{name}}" and seal.
• End (3.5–5 s): it rocks back to where it began.

S — Style
Looks: {{bg}} ground under one soft spotlight; a portrait card with rounded corners; foil colours cycle around the hue wheel anchored on {{accent}} and {{accent2}}, pearly toward {{ink}}; the wordmark in {{font}}, heavy and wide, embossed.
Moves: one slow sine rock per loop (about ±20°), true perspective; foil phase follows the tilt; glints are brief.
Rules:
1. Colour = function of position + tilt (diffraction), never a fixed gradient.
2. Cracked-ice facets with their own phase and dark seams.
3. Emboss shading from a height map, lit from the moving light.
4. One glare, a few glints, a coloured glow behind.
5. Grain and vignette on the ground.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the rainbow visibly moves between frames; the emboss reads as raised; the card edges are smooth, with no slice seams; the colours stay pearly, not muddy. Fix what fails and render again until every check passes.`,
  ref: "https://github.com/simeydotme/pokemon-cards-css",
  theme: {
    bg: "#09090e",
    ink: "#f6f3ff",
    accent: "#ff5fa8",
    accent2: "#45d3ff",
    font: FAMILY,
  },
  fonts: ["Unbounded:wght@400..900"],
  tags: [
    "holographic",
    "holo",
    "foil",
    "iridescent",
    "rainbow",
    "card",
    "sticker",
    "y2k",
    "shiny",
    "trading card",
    "prism",
  ],
  word: "Holo",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const { cw, ch, cx, cy } = card(w, h);
    const q = w * h > 1.3e6 ? 1 : 0.75;
    const W = Math.max(24, Math.round(cw * q));
    const H = Math.max(32, Math.round(ch * q));
    const p = t / LOOP;
    const rotY = 0.36 * Math.sin(TAU * p);
    const rotX = 0.1 * Math.sin(TAU * p * 2 + 0.6);
    const roll = 0.035 * Math.sin(TAU * p + 1.2);
    const lut = foilLUT(theme);
    const family = theme.font || FAMILY;
    const word = wordFor(theme.name, "Holo", 12);
    const maps = cardMaps(W, H, word, family, fontReady(800, family) ? "ready" : "fallback");

    // Ground: a soft spotlight and a coloured bloom thrown by the foil.
    ground(ctx, w, h, theme.bg);
    const spot = ctx.createRadialGradient(
      cx,
      cy - ch * 0.3,
      0,
      cx,
      cy - ch * 0.1,
      Math.max(w, h) * 0.7,
    );
    spot.addColorStop(0, rgba(mix(theme.bg, theme.ink, 0.16), 1));
    spot.addColorStop(0.5, rgba(mix(theme.bg, theme.ink, 0.05), 1));
    spot.addColorStop(1, rgba(theme.bg, 1));
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, w, h);
    const glowPhase = (((0.62 + rotY * 1.25) % 1) + 1) % 1;
    const gi = Math.floor(glowPhase * 255) * 3;
    const glowCol = `rgb(${lut[gi]},${lut[gi + 1]},${lut[gi + 2]})`;
    const bloom = ctx.createRadialGradient(cx, cy, ch * 0.25, cx, cy, ch * 0.95);
    bloom.addColorStop(0, rgba(glowCol, 0.22));
    bloom.addColorStop(1, rgba(glowCol, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, w, h);
    // Contact shadow.
    ctx.save();
    ctx.translate(cx + rotY * cw * 0.2, cy + ch * 0.53);
    ctx.scale(1, 0.12);
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, cw * 0.7);
    sh.addColorStop(0, "rgba(0,0,0,0.55)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(-cw, -cw, cw * 2, cw * 2);
    ctx.restore();

    // Shade the foil in card space: a handful of lookups per pixel.
    const { canvas: cc, ctx: C } = buffer("holo-card", W, H);
    const img = C.createImageData(W, H);
    const d = img.data;
    const silver = parse(mix(theme.bg, theme.ink, 0.36));
    const ink = parse(theme.ink);
    const dark = parse(mix(theme.bg, "#000000", 0.3));
    const s0 = silver[0];
    const s1 = silver[1];
    const s2 = silver[2];
    // Light direction in card space follows the tilt.
    const lx = -Math.sin(rotY) * 2.2 - 0.45;
    const ly = -Math.sin(rotX) * 2.2 - 0.7;
    const gx = 0.5 - rotY * 1.5;
    const gy = 0.3 - rotX * 1.6;
    const bandShift = -0.66 + rotY * 1.35 + rotX * 0.6;
    const tiltPhase = rotY * 1.3 + rotX * 0.9;
    const invW = 1 / W;
    const invH = 1 / H;
    const { base, bpos, bx, by, mul, alpha, cell, cellGlint } = maps;
    const glintAt = (((rotY * 2.2 + rotX) % 1) + 1) % 1;
    for (let y = 0; y < H; y++) {
      const ey = y * invH - gy;
      const ey2 = ey * ey;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const a = alpha[i];
        const o = i << 2;
        if (a <= 0) {
          d[o + 3] = 0;
          continue;
        }
        let ph = base[i] + tiltPhase;
        ph -= Math.floor(ph);
        const li = ((ph * 255) | 0) * 3;
        let bi = ((bpos[i] + bandShift + 2) * 128) | 0;
        bi = bi < 0 ? 0 : bi > 511 ? 511 : bi;
        const band = BAND[bi];
        const s = 0.1 + 0.9 * band;
        const shade = (0.4 + 0.6 * band) * mul[i];
        const ex = x * invW - gx;
        const e2 = ex * ex + ey2;
        const glare = e2 < 1 ? GLARE[(e2 * 256) | 0] : 0;
        const bevel = bx[i] * lx + by[i] * ly;
        // Facets catch the light a touch as the tilt passes their angle.
        let gd = cellGlint[cell[i]] - glintAt;
        if (gd < 0) gd = -gd;
        if (gd > 0.5) gd = 1 - gd;
        const glint = gd < 0.03 ? (1 - gd / 0.03) * 0.07 : 0;
        let r = (s0 + (lut[li] - s0) * s) * shade;
        let g = (s1 + (lut[li + 1] - s1) * s) * shade;
        let b = (s2 + (lut[li + 2] - s2) * s) * shade;
        let lift = glare + glint + (bevel > 0 ? bevel : 0);
        if (lift > 1) lift = 1;
        r += (ink[0] - r) * lift;
        g += (ink[1] - g) * lift;
        b += (ink[2] - b) * lift;
        if (bevel < 0) {
          const drop = bevel < -1.1 ? 1 : -bevel * 0.9;
          r += (dark[0] - r) * drop;
          g += (dark[1] - g) * drop;
          b += (dark[2] - b) * drop;
        }
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = a * 255;
      }
    }
    C.putImageData(img, 0, 0);
    // Glints: single sparkles that fire as the tilt passes their angle.
    C.save();
    C.globalCompositeOperation = "lighter";
    for (const sp of maps.sparks) {
      const k = Math.cos(TAU * (sp.k - rotY * 1.4 - rotX * 0.7));
      const v = k > 0 ? Math.pow(k, 26) : 0;
      if (v < 0.02) continue;
      const S = W * 0.07 * sp.s * (0.6 + 0.4 * v);
      C.globalAlpha = v;
      C.drawImage(star() as CanvasImageSource, sp.x - S / 2, sp.y - S / 2, S, S);
    }
    C.restore();
    const mark = tintedLogo(theme, rgba(theme.ink, 0.85), W * 0.09, W * 0.09);
    if (mark)
      C.drawImage(
        mark as CanvasImageSource,
        W - W * 0.055 * 1.8 - W * 0.09,
        W * 0.055 * 1.8 - W * 0.015,
      );

    // Project the flat card with real perspective: vertical slices, each scaled by depth.
    const D = cw * 3.2;
    const slices = Math.max(24, Math.min(120, Math.round(W / 3)));
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(roll);
    // The card's thickness, visible on the edge that swings toward the camera.
    const edgeW = Math.abs(sin) * u * 0.01;
    if (edgeW > 0.2) {
      const un = sin > 0 ? -0.5 : 0.5;
      const zn = un * cw * sin;
      const xn = (un * cw * cos * D) / (D + zn);
      const sc = D / (D + zn);
      const hh = ch * sc * 0.9;
      const g = ctx.createLinearGradient(0, -hh / 2, 0, hh / 2);
      g.addColorStop(0, rgba(mix(theme.ink, theme.bg, 0.35), 1));
      g.addColorStop(1, rgba(mix(theme.ink, theme.bg, 0.7), 1));
      ctx.fillStyle = g;
      ctx.fillRect(un < 0 ? xn - edgeW : xn, -hh / 2, edgeW + 0.5, hh);
    }
    const vk = 1 + rotX * 0.05;
    for (let s = 0; s < slices; s++) {
      const u0 = s / slices - 0.5;
      const u1 = (s + 1) / slices - 0.5;
      const z0 = u0 * cw * sin;
      const z1 = u1 * cw * sin;
      const x0 = (u0 * cw * cos * D) / (D + z0);
      const x1 = (u1 * cw * cos * D) / (D + z1);
      const sc = D / (D + (z0 + z1) / 2);
      const srcX = (s / slices) * W;
      const srcW = W / slices;
      const hh = ch * sc * vk;
      ctx.drawImage(
        cc as CanvasImageSource,
        srcX,
        0,
        srcW,
        H,
        Math.min(x0, x1) - 0.35,
        -hh / 2,
        Math.abs(x1 - x0) + 0.7,
        hh,
      );
    }
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.24);
  },
};
