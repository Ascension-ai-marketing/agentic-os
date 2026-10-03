import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  fbm3,
  font,
  frameOf,
  fract,
  grain,
  ground,
  hash,
  light,
  LOOP,
  rng,
  SERIF,
  TAU,
  vignette,
  wave,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { glow, scanlines, stepFrame } from "./_s4-helpers";

/**
 * A classical bust in profile, facing right, in unit coordinates
 * (x 0..1, y 0..1.05, y down). Drawn smooth through midpoints.
 */
const PROFILE: [number, number][] = [
  [0.52, 0.03],
  [0.6, 0.045],
  [0.655, 0.08],
  [0.685, 0.115],
  [0.7, 0.16],
  [0.712, 0.215],
  [0.718, 0.245],
  [0.715, 0.263],
  [0.735, 0.3],
  [0.758, 0.345],
  [0.766, 0.36],
  [0.752, 0.373],
  [0.733, 0.379],
  [0.727, 0.392],
  [0.733, 0.41],
  [0.739, 0.418],
  [0.727, 0.428],
  [0.736, 0.44],
  [0.724, 0.456],
  [0.715, 0.467],
  [0.727, 0.49],
  [0.725, 0.512],
  [0.706, 0.531],
  [0.665, 0.541],
  [0.615, 0.552],
  [0.598, 0.59],
  [0.604, 0.63],
  [0.598, 0.67],
  [0.606, 0.71],
  [0.635, 0.748],
  [0.678, 0.79],
  [0.697, 0.845],
  [0.694, 0.895],
  [0.672, 0.93],
  [0.6, 0.952],
  [0.5, 0.958],
  [0.4, 0.952],
  [0.33, 0.93],
  [0.298, 0.885],
  [0.295, 0.825],
  [0.318, 0.77],
  [0.36, 0.715],
  [0.395, 0.66],
  [0.405, 0.6],
  [0.39, 0.54],
  [0.34, 0.49],
  [0.296, 0.415],
  [0.28, 0.32],
  [0.292, 0.22],
  [0.33, 0.13],
  [0.4, 0.07],
  [0.46, 0.04],
];

/** The hairline: hair grows above this y at a given x (forehead → temple → behind the ear). */
function hairline(x: number): number {
  if (x >= 0.6) return 0.115 + (0.685 - x) * 1.0;
  if (x >= 0.47) return 0.2 + (0.6 - x) * 0.45;
  return 0.26 + (0.47 - x) * 2.4;
}

/** Curls: the first RIM of them also bump the silhouette's outline. [x, y, radius]. */
const RIM = 13;
const CURLS = (() => {
  const out: [number, number, number][] = [];
  const r = rng(314);
  const rim: [number, number][] = [
    [0.35, 0.485],
    [0.31, 0.43],
    [0.293, 0.37],
    [0.287, 0.31],
    [0.298, 0.25],
    [0.315, 0.19],
    [0.345, 0.135],
    [0.39, 0.09],
    [0.445, 0.06],
    [0.505, 0.048],
    [0.565, 0.055],
    [0.62, 0.075],
    [0.66, 0.105],
  ];
  for (const [x, y] of rim)
    out.push([x + (r() - 0.5) * 0.008, y + (r() - 0.5) * 0.008, 0.02 + r() * 0.008]);
  // Inner curls covering the crown and the back of the head, clear of the ear.
  for (let i = 0; i < 160 && out.length < RIM + 64; i++) {
    const x = 0.3 + r() * 0.37;
    const y = 0.05 + r() * 0.46;
    const ear = Math.hypot((x - 0.44) / 0.06, (y - 0.33) / 0.085) < 1;
    if (y < hairline(x) - 0.01 && !ear) out.push([x, y, 0.02 + r() * 0.012]);
  }
  return out;
})();

type Bump = [number, number, number, number];
/** Sculpted features as height bumps: [x, y, radius, amplitude]. */
const FEATURES: Bump[] = [
  [0.44, 0.33, 0.045, 0.55], // ear
  [0.445, 0.325, 0.018, -0.5], // ear bowl
  [0.668, 0.28, 0.021, -0.5], // eye socket
  [0.676, 0.278, 0.012, 0.18], // eyeball (blank, like marble)
  [0.672, 0.249, 0.022, 0.35], // brow
  [0.64, 0.36, 0.05, 0.28], // cheek
  [0.718, 0.362, 0.016, 0.3], // nostril wing
  [0.706, 0.428, 0.01, -0.35], // mouth corner
  [0.7, 0.498, 0.03, 0.3], // chin
  [0.56, 0.5, 0.05, 0.22], // jaw
  [0.52, 0.62, 0.045, 0.2], // neck muscle
  [0.62, 0.86, 0.06, 0.25], // chest
  [0.37, 0.82, 0.07, 0.3], // shoulder
  [0.61, 0.765, 0.03, -0.25], // pit of the throat
];

function traceProfile(c: Ctx2D, ox: number, oy: number, s: number) {
  const p = PROFILE;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const m0 = mid(p[p.length - 1], p[0]);
  c.moveTo(ox + m0[0] * s, oy + m0[1] * s);
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = mid(p[i], p[(i + 1) % p.length]);
    c.quadraticCurveTo(ox + a[0] * s, oy + a[1] * s, ox + b[0] * s, oy + b[1] * s);
  }
  c.closePath();
}

/**
 * The marble bust, sculpted as a relief: silhouette → distance field →
 * rounded height, plus features and curls, then lit (cool key, pink rim).
 */
function bust(theme: Theme) {
  return (c: Ctx2D, W: number, H: number) => {
    const s = H / 1.06;
    const ox = (W - s) / 2;
    const oy = H * 0.01;
    // Silhouette, anti-aliased.
    c.fillStyle = "#fff";
    c.beginPath();
    traceProfile(c, ox, oy, s);
    c.fill();
    for (let i = 0; i < RIM; i++) {
      const [x, y, r] = CURLS[i];
      c.beginPath();
      c.arc(ox + x * s, oy + y * s, r * s * 0.9, 0, TAU);
      c.fill();
    }
    const img = c.getImageData(0, 0, W, H);
    const d = img.data;
    const n = W * H;
    // Chamfer distance to the outside, in pixels.
    const dist = new Float32Array(n);
    const BIG = 1e6;
    for (let i = 0; i < n; i++) dist[i] = d[i * 4 + 3] > 127 ? BIG : 0;
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!dist[i]) continue;
        dist[i] = Math.min(
          dist[i],
          dist[i - 1] + 1,
          dist[i - W] + 1,
          dist[i - W - 1] + 1.414,
          dist[i - W + 1] + 1.414,
        );
      }
    for (let y = H - 2; y > 0; y--)
      for (let x = W - 2; x > 0; x--) {
        const i = y * W + x;
        if (!dist[i]) continue;
        dist[i] = Math.min(
          dist[i],
          dist[i + 1] + 1,
          dist[i + W] + 1,
          dist[i + W + 1] + 1.414,
          dist[i + W - 1] + 1.414,
        );
      }
    // Height: a rounded edge (a quarter circle over D pixels), then the features.
    const D = s * 0.11;
    const hgt = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.min(dist[i], D) / D;
      hgt[i] = dist[i] > 0 ? Math.sqrt(1 - (1 - k) * (1 - k)) * D : 0;
    }
    const addBump = (bx: number, by: number, br: number, amp: number) => {
      const cx = ox + bx * s;
      const cy = oy + by * s;
      const r = br * s;
      const x0 = Math.max(1, Math.floor(cx - r * 2.5));
      const x1 = Math.min(W - 2, Math.ceil(cx + r * 2.5));
      const y0 = Math.max(1, Math.floor(cy - r * 2.5));
      const y1 = Math.min(H - 2, Math.ceil(cy + r * 2.5));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          if (!dist[i]) continue;
          const q = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
          hgt[i] += amp * D * Math.exp(-q) * Math.min(1, dist[i] / (D * 0.35));
        }
    };
    // The hair is a raised mass before it is curls.
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!dist[i]) continue;
        const ux = (x - ox) / s;
        const uy = (y - oy) / s;
        const edge = hairline(ux) - uy;
        if (edge > 0) {
          const k = Math.min(1, edge / 0.06);
          hgt[i] += D * 0.16 * k * k * (3 - 2 * k) * Math.min(1, dist[i] / (D * 0.5));
        }
      }
    for (const [x, y, r, a] of FEATURES) addBump(x, y, r, a);
    for (const [x, y, r] of CURLS) addBump(x, y, r, 0.3);
    // Smooth the height (three box passes ≈ Gaussian) so the distance field's facets never show.
    const rad = Math.max(1, Math.round(s * 0.006));
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < H; y++) {
        let acc = 0;
        const row = y * W;
        for (let x = -rad; x < W + rad; x++) {
          const add = x + rad < W ? hgt[row + Math.min(W - 1, Math.max(0, x + rad))] : 0;
          const sub = x - rad - 1 >= 0 ? hgt[row + x - rad - 1] : 0;
          acc += add - sub;
          if (x >= 0 && x < W) tmp[row + x] = acc / (rad * 2 + 1);
        }
      }
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let y = -rad; y < H + rad; y++) {
          const add = y + rad < H ? tmp[Math.min(H - 1, Math.max(0, y + rad)) * W + x] : 0;
          const sub = y - rad - 1 >= 0 ? tmp[(y - rad - 1) * W + x] : 0;
          acc += add - sub;
          if (y >= 0 && y < H) hgt[y * W + x] = acc / (rad * 2 + 1);
        }
      }
    }
    // Light it: a cool key from the front, a pink rim from behind, a marble sheen.
    const key = parse(mix(theme.ink, theme.accent2, 0.22));
    const rim = parse(theme.accent);
    const shade = parse(mix(theme.bg, theme.accent2, 0.3));
    const marble = parse(mix(theme.ink, theme.accent, 0.05));
    const kx = 0.62;
    const ky = -0.5;
    const kz = 0.6;
    const rx = -0.92;
    const ry = -0.2;
    const rz = 0.32;
    // Blinn half-vector for the key (viewer along +z).
    const hl = Math.hypot(kx, ky, kz + 1);
    const hx = kx / hl;
    const hy = ky / hl;
    const hz = (kz + 1) / hl;
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const o = i * 4;
        // Edge pixels (partly covered) are shaded too, so the outline never rings white.
        if (!d[o + 3]) continue;
        let nx = -(hgt[i + 1] - hgt[i - 1]) * 0.5;
        let ny = -(hgt[i + W] - hgt[i - W]) * 0.5;
        let nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        ny /= l;
        nz /= l;
        const diff = Math.max(0, nx * kx + ny * ky + nz * kz);
        const back = Math.max(0, nx * rx + ny * ry + nz * rz);
        const rimK = Math.pow(back, 1.8) * (1 - nz * 0.55);
        const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 18) * 0.22;
        // Marble: a whisper of veins, cool fill in the shadows.
        const vein = fbm3(x / (s * 0.1), y / (s * 0.1), 2.3, 2);
        const v =
          1 - 0.07 * Math.exp(-Math.abs(Math.sin((x + y * 0.55) / (s * 0.06) + vein * 6)) * 9);
        const low = 0.5 - 0.5 * ny;
        for (let ch = 0; ch < 3; ch++) {
          const base = marble[ch] * v;
          const lit = base * (0.1 + 0.95 * diff) * (key[ch] / 255);
          const fill = shade[ch] * (0.45 + 0.2 * low) * (1 - diff) ** 1.5;
          d[o + ch] = clamp(lit + fill + rim[ch] * rimK * 1.25 + 255 * spec, 0, 255);
        }
      }
    // Keep the anti-aliased edge alpha from the silhouette fill.
    c.putImageData(img, 0, 0);
    // The socle: a turned marble foot and a square plinth, lit from the right.
    c.globalCompositeOperation = "destination-over";
    const foot = (x0: number, y0: number, x1: number, y1: number, top: number) => {
      const g = c.createLinearGradient(ox + x0 * s, 0, ox + x1 * s, 0);
      g.addColorStop(0, mix(theme.bg, theme.accent, 0.45));
      g.addColorStop(0.08, mix(theme.accent, theme.ink, 0.3));
      g.addColorStop(0.35, mix(mix(theme.bg, theme.accent2, 0.35), theme.ink, 0.35));
      g.addColorStop(0.75, mix(theme.ink, theme.accent2, 0.2));
      g.addColorStop(1, mix(theme.ink, theme.accent2, 0.45));
      c.fillStyle = g;
      c.beginPath();
      c.roundRect(ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s, top * s);
      c.fill();
    };
    foot(0.41, 0.94, 0.59, 0.995, 0.008);
    c.globalCompositeOperation = "source-over";
    foot(0.36, 0.99, 0.64, 1.015, 0.006);
    foot(0.31, 1.012, 0.69, 1.045, 0.004);
  };
}

/** The Windows-95 style dialog, baked (title bar gradient, bevels, button). */
function dialog(theme: Theme, title: string) {
  return (c: Ctx2D, W: number, H: number) => {
    const b = Math.max(1, Math.round(H / 60));
    const face = mix(theme.ink, theme.bg, 0.25);
    c.fillStyle = face;
    c.fillRect(0, 0, W, H);
    // Bevels: light top-left, dark bottom-right.
    c.fillStyle = theme.ink;
    c.fillRect(0, 0, W, b);
    c.fillRect(0, 0, b, H);
    c.fillStyle = mix(theme.bg, "#000000", 0.4);
    c.fillRect(0, H - b, W, b);
    c.fillRect(W - b, 0, b, H);
    // Title bar.
    const tb = H * 0.22;
    const g = c.createLinearGradient(b * 3, 0, W - b * 3, 0);
    g.addColorStop(0, mix(theme.bg, theme.accent2, 0.35));
    g.addColorStop(1, theme.accent2);
    c.fillStyle = g;
    c.fillRect(b * 3, b * 3, W - b * 6, tb);
    c.fillStyle = theme.ink;
    c.font = font(700, tb * 0.62, "Inter", '"Tahoma", sans-serif');
    c.textBaseline = "middle";
    c.textAlign = "left";
    c.fillText(title, b * 3 + tb * 0.35, b * 3 + tb * 0.53);
    // Close box.
    const cb = tb * 0.78;
    const cxp = W - b * 3 - cb - tb * 0.12;
    const cyp = b * 3 + (tb - cb) / 2;
    c.fillStyle = face;
    c.fillRect(cxp, cyp, cb, cb);
    c.strokeStyle = mix(theme.bg, "#000000", 0.3);
    c.lineWidth = Math.max(1, cb * 0.12);
    c.beginPath();
    c.moveTo(cxp + cb * 0.28, cyp + cb * 0.28);
    c.lineTo(cxp + cb * 0.72, cyp + cb * 0.72);
    c.moveTo(cxp + cb * 0.72, cyp + cb * 0.28);
    c.lineTo(cxp + cb * 0.28, cyp + cb * 0.72);
    c.stroke();
    // Body: a sunken progress well with chunky blocks.
    const wx = W * 0.08;
    const wy = H * 0.44;
    const ww = W * 0.84;
    const wh = H * 0.18;
    c.fillStyle = mix(theme.bg, "#000000", 0.4);
    c.fillRect(wx, wy, ww, b);
    c.fillRect(wx, wy, b, wh);
    c.fillStyle = theme.ink;
    c.fillRect(wx, wy + wh - b, ww, b);
    c.fillRect(wx + ww - b, wy, b, wh);
    const blocks = 14;
    const bw = (ww - b * 4) / blocks;
    for (let i = 0; i < 10; i++) {
      c.fillStyle = theme.accent;
      c.fillRect(wx + b * 2 + i * bw + bw * 0.1, wy + b * 2, bw * 0.8, wh - b * 4);
    }
    // OK button.
    const bx = W * 0.36;
    const by = H * 0.72;
    const bW = W * 0.28;
    const bH = H * 0.18;
    c.fillStyle = theme.ink;
    c.fillRect(bx, by, bW, b);
    c.fillRect(bx, by, b, bH);
    c.fillStyle = mix(theme.bg, "#000000", 0.4);
    c.fillRect(bx, by + bH - b, bW, b);
    c.fillRect(bx + bW - b, by, b, bH);
    c.fillStyle = mix(theme.bg, "#000000", 0.2);
    c.font = font(600, bH * 0.5, "Inter", '"Tahoma", sans-serif');
    c.textAlign = "center";
    c.fillText("OK", bx + bW / 2, by + bH * 0.54);
  };
}

export const style: MotionStyle = {
  id: "vaporwave",
  name: "Vaporwave Bust",
  family: "Retro Tech",
  tagline: "A marble bust at a pastel sunset",
  look: "A marble bust floating over a cyan grid at a pastel sunset, a Windows-95 dialog, wide-spaced serif type.",
  move: "The bust bobs and sways over its own reflection, the grid glides toward you, sparkles blink, the sun's halo breathes.",
  rules: [
    "Pastel sunset gradient into a dark grid floor that meets one vanishing point.",
    "The bust is sculpted marble: cool key light, a pink rim from behind, veins, never a flat cut-out.",
    "It floats: slow bob and sway, a soft shadow and a glossy reflection on the floor.",
    "Windows-95 chrome is exact: bevels, gradient title bar, chunky blocks.",
    "Type is a light serif, tracked wide, like full-width text.",
    "Everything moves slowly; the loop is a held breath.",
  ],
  prompt: `R — References
• Vaporwave album art: marble busts (Helios), pastel sunsets, grid floors, Windows 95 UI (search: vaporwave statue grid, aesthetic windows 95).
• Classical marble sculpture photographed with coloured gels: cool key, pink rim.

I — Idea
One dream, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a marble bust in profile floats in front of a pastel sun over an endless cyan grid.
• Middle (1.5–3.5 s): it bobs and sways over its glossy reflection; the grid glides toward us; sparkles blink; a Windows-95 dialog titled "{{name}}.exe" hovers in the corner.
• End (3.5–5 s): the bob completes one cycle and the grid moves exactly one row, so the frame matches the first.

S — Style
Looks: {{bg}} sky falling through {{accent}} pink to a pale horizon; a sun disc from pale {{accent2}} to {{accent}}; the grid in {{accent2}}; the bust in off-white marble lit cool from the front and {{accent}} from behind; a Windows-95 dialog with an {{accent2}} title bar; "{{name}}" in a light serif, tracked very wide.
Moves: bob 1 cycle per loop (sine), sway ±2°, grid one row per loop, sparkles twinkle, halo breathes.
Rules:
1. Sunset gradient, one vanishing point.
2. Sculpted, lit marble with veins and rim light.
3. Float with shadow and reflection.
4. Exact Windows-95 bevels.
5. Wide-tracked light serif type.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the bust reads as a sculpted head at thumbnail size (nose, brow, curls); the rim light traces the back edge; the reflection is flipped and faded; the dialog never covers the face. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Vaporwave",
  theme: {
    bg: "#1d0b3a",
    ink: "#fff1fb",
    accent: "#ff71ce",
    accent2: "#01cdfe",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,300..600"],
  tags: [
    "vaporwave",
    "aesthetic",
    "statue",
    "bust",
    "marble",
    "90s",
    "windows 95",
    "pastel",
    "grid",
    "sunset",
    "retro",
    "dreamy",
  ],
  word: "AESTHETIC",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    const hy = h * (portrait ? 0.66 : 0.64);
    const cx = w / 2;
    ground(ctx, w, h, theme.bg);

    // Sunset sky.
    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, theme.bg);
    sky.addColorStop(0.45, mix(theme.bg, theme.accent, 0.42));
    sky.addColorStop(0.85, mix(theme.accent, theme.ink, 0.35));
    sky.addColorStop(1, mix(theme.ink, theme.accent2, 0.22));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hy);

    // The sun disc behind the head, with a breathing halo.
    const sunR = Math.min(w * 0.24, h * (portrait ? 0.17 : 0.3));
    const sunX = cx + (portrait ? 0 : sunR * 0.3);
    const sunY = hy - sunR * 0.95;
    light(ctx, sunX, sunY, sunR * (2.4 + 0.15 * wave(t, 1)), theme.ink, 0.22);
    const sg = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sg.addColorStop(0, mix(theme.ink, theme.accent2, 0.35));
    sg.addColorStop(0.55, mix(theme.accent, theme.ink, 0.35));
    sg.addColorStop(1, theme.accent);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, TAU);
    ctx.fill();

    // Floor: dark glossy plane, a cyan grid rolling toward us one row a loop.
    const floor = ctx.createLinearGradient(0, hy, 0, h);
    floor.addColorStop(0, mix(theme.bg, theme.accent, 0.35));
    floor.addColorStop(0.35, mix(theme.bg, "#000000", 0.15));
    floor.addColorStop(1, mix(theme.bg, theme.accent2, 0.12));
    ctx.fillStyle = floor;
    ctx.fillRect(0, hy, w, h - hy);
    const { canvas: gC, ctx: G } = buffer("vapor-grid", w, h);
    G.clearRect(0, 0, w, h);
    G.strokeStyle = theme.accent2;
    G.lineWidth = Math.max(1, u * 0.0024);
    const camH = (h - hy) * 0.85;
    const move = fract(t / LOOP);
    for (let k = 0; k < 22; k++) {
      const z = 0.8 + (k - move) * 0.6;
      if (z <= 0.3) continue;
      const y = hy + camH / z;
      if (y > h + 2) continue;
      G.globalAlpha = clamp((y - hy) / (h * 0.1)) * 0.9;
      G.beginPath();
      G.moveTo(0, y);
      G.lineTo(w, y);
      G.stroke();
    }
    G.globalAlpha = 0.85;
    const cols = portrait ? 10 : 16;
    for (let i = -cols; i <= cols; i++) {
      const xb = cx + (i / cols) * w * 1.6;
      G.beginPath();
      G.moveTo(cx + (xb - cx) * 0.04, hy);
      G.lineTo(xb, h);
      G.stroke();
    }
    G.globalAlpha = 1;
    glow(ctx, gC as CanvasImageSource, "vapor-grid-glow", 0, 0, w, h, 5, 2.2, 0.8, "screen");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(gC as CanvasImageSource, 0, 0);
    ctx.restore();

    // The bust: baked once, then floated, swayed, shadowed and reflected.
    const bh = h * (portrait ? 0.46 : 0.62);
    const bw = bh * 0.95;
    const bustC = bake(
      `vapor-bust:${theme.ink}${theme.accent}${theme.accent2}${theme.bg}`,
      bw,
      bh,
      bust(theme),
    );
    const bob = wave(t, 1, 0) * h * 0.018;
    const sway = wave(t, 1, 0.2) * 0.035;
    const bx = cx - bw * (portrait ? 0.52 : 0.62);
    const by = (portrait ? h * 0.2 : h * 0.1) + bob;
    const baseY = by + bh * 0.97;
    // Soft shadow on the floor, tighter when the bust dips.
    const shY = hy + (h - hy) * 0.45;
    const shR = bw * (0.42 - bob / h);
    const sh = ctx.createRadialGradient(bx + bw / 2, shY, 0, bx + bw / 2, shY, shR);
    sh.addColorStop(0, rgba("#000000", 0.45));
    sh.addColorStop(1, rgba("#000000", 0));
    ctx.save();
    ctx.translate(bx + bw / 2, shY);
    ctx.scale(1, 0.22);
    ctx.translate(-(bx + bw / 2), -shY);
    ctx.fillStyle = sh;
    ctx.fillRect(bx + bw / 2 - shR, shY - shR, shR * 2, shR * 2);
    ctx.restore();
    // Reflection on the floor: flipped, faded, a touch rippled.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, hy, w, h - hy);
    ctx.clip();
    ctx.globalAlpha = 0.22;
    const ry = shY + (shY - baseY) * 0.2;
    ctx.translate(bx + bw / 2, ry);
    ctx.rotate(-sway);
    ctx.scale(1, -0.6);
    ctx.drawImage(bustC as CanvasImageSource, -bw / 2, -bh);
    ctx.restore();
    // The bust itself.
    ctx.save();
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.rotate(sway);
    ctx.drawImage(bustC as CanvasImageSource, -bw / 2, -bh / 2);
    ctx.restore();

    // Sparkles.
    for (let i = 0; i < 4; i++) {
      const px = bx + bw * (0.1 + 0.9 * hash(i, 5)) + (i % 2 ? bw * 0.6 : -bw * 0.2);
      const py = by + bh * (0.05 + 0.6 * hash(i, 7));
      const life = Math.max(0, Math.sin(TAU * (t / LOOP + hash(i, 9))));
      const r = u * 0.022 * life;
      if (r < 0.5) continue;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(theme.ink, 0.9 * life);
      ctx.beginPath();
      ctx.moveTo(px - r, py);
      ctx.quadraticCurveTo(px, py, px, py - r);
      ctx.quadraticCurveTo(px, py, px + r, py);
      ctx.quadraticCurveTo(px, py, px, py + r);
      ctx.quadraticCurveTo(px, py, px - r, py);
      ctx.fill();
      ctx.restore();
    }

    // The Windows-95 dialog, hovering in the corner.
    const name = wordFor(theme.name, "AESTHETIC", 12);
    const dW = Math.min(w * (portrait ? 0.62 : 0.26), u * 0.62);
    const dH = dW * 0.46;
    const dx = portrait ? (w - dW) / 2 : w * 0.66;
    const dy = (portrait ? h * 0.07 : h * 0.12) + wave(t, 1, 0.5) * h * 0.008;
    const dlg = bake(
      `vapor-dialog:${name}:${theme.ink}${theme.bg}${theme.accent}${theme.accent2}`,
      dW,
      dH,
      dialog(theme, `${name.toLowerCase()}.exe`),
    );
    ctx.save();
    ctx.shadowColor = rgba("#000000", 0.4);
    ctx.shadowBlur = u * 0.02;
    ctx.shadowOffsetX = u * 0.008;
    ctx.shadowOffsetY = u * 0.012;
    ctx.drawImage(dlg as CanvasImageSource, dx, dy);
    ctx.restore();
    const mark = tintedLogo(theme, theme.accent2, dH * 0.3, dH * 0.3);
    if (mark) ctx.drawImage(mark as CanvasImageSource, dx + dW * 0.08, dy + dH * 0.72);

    // Wide-tracked serif word along the bottom.
    const size = Math.min(u * 0.05, (w * 0.8) / (name.length * 1.35));
    ctx.save();
    ctx.font = font(400, size, theme.font || "Newsreader", SERIF);
    (ctx as CanvasRenderingContext2D).letterSpacing = `${(size * 0.7).toFixed(1)}px`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const ty = portrait ? h * 0.9 : h * 0.92;
    ctx.fillStyle = rgba(theme.accent2, 0.7);
    ctx.fillText(name.toUpperCase(), cx + size * 0.35 + size * 0.06, ty + size * 0.06);
    ctx.fillStyle = theme.ink;
    ctx.fillText(name.toUpperCase(), cx + size * 0.35, ty);
    ctx.restore();

    scanlines(ctx, w, h, Math.max(2, h / 320), 0.06);
    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.3);
    void stepFrame;
  },
};
