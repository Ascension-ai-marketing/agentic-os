import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  fbm3,
  font,
  frameOf,
  grain,
  ground,
  hash,
  lerp,
  light,
  noise3,
  once,
  rng,
  seg,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { drawLogo, logoFor } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

/** A static, tileable fbm texture for cheap per-pixel lookups. */
const TEX = 256;
const tex = once("sumi-tex", () => {
  const out = new Float32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++)
      out[y * TEX + x] = fbm3((x / TEX) * 8, (y / TEX) * 8, 0.37, 3, 8, 8, 0);
  return out;
});
function sample(x: number, y: number) {
  const fx = ((x % TEX) + TEX) % TEX;
  const fy = ((y % TEX) + TEX) % TEX;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = (x0 + 1) % TEX;
  const y1 = (y0 + 1) % TEX;
  const tx = fx - x0;
  const ty = fy - y0;
  const a = tex[y0 * TEX + x0] + (tex[y0 * TEX + x1] - tex[y0 * TEX + x0]) * tx;
  const b = tex[y1 * TEX + x0] + (tex[y1 * TEX + x1] - tex[y1 * TEX + x0]) * tx;
  return a + (b - a) * ty;
}

interface Geo {
  x: number;
  y: number;
  R: number;
  u: number;
  a0: number;
  sweep: number;
}

const START = -0.64 * Math.PI;
const SWEEP = 1.8 * Math.PI;

function geometry(w: number, h: number): Geo {
  const { u, portrait } = frameOf(w, h);
  return {
    x: portrait ? w * 0.5 : w * 0.49,
    y: portrait ? h * 0.44 : h * 0.5,
    R: u * (portrait ? 0.36 : 0.345),
    u,
    a0: START,
    sweep: SWEEP,
  };
}

const radiusAt = (g: Geo, s: number) =>
  g.R * (1 + 0.035 * Math.sin(TAU * s * 1.5 + 0.7) + 0.025 * noise3(s * 3, 1.3, 0.5));

function halfWidth(g: Geo, s: number) {
  const press = s < 0.06 ? 0.72 + 0.43 * smoothstep(0, 0.06, s) : 1.15;
  const body = press * (1 - 0.55 * smoothstep(0.06, 1, s)) - 0.4 * smoothstep(0.8, 1, s);
  return g.u * 0.05 * Math.max(0.06, body) * (1 + 0.07 * noise3(s * 12, 7.1, 0.2));
}

function point(g: Geo, s: number) {
  const a = g.a0 + s * g.sweep;
  const r = radiusAt(g, s);
  return { x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
}

/** The brush stroke from s=0 to s=p on its own layer: body, wet rim, spatter, dry-brush gaps. */
function stroke(c: Ctx2D, g: Geo, p: number, ink: string) {
  if (p <= 0.001) return;
  const steps = 120;
  const n = Math.max(2, Math.ceil(steps * p));
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * p;
    const q = point(g, s);
    const hw = halfWidth(g, s);
    const jl = g.u * 0.0045 * noise3(s * 40, 2.2, 0.1);
    const jr = g.u * 0.0045 * noise3(s * 40, 5.9, 0.4);
    left.push([q.x + q.nx * (hw + jl), q.y + q.ny * (hw + jl)]);
    right.push([q.x - q.nx * (hw + jr), q.y - q.ny * (hw + jr)]);
  }
  c.fillStyle = ink;
  c.beginPath();
  c.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) c.lineTo(x, y);
  // Rounded brush tip.
  const tip = point(g, p);
  const tipW = halfWidth(g, p);
  c.arc(tip.x, tip.y, tipW, Math.atan2(tip.ny, tip.nx), Math.atan2(-tip.ny, -tip.nx));
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
  c.fill();
  // The entry blob where the loaded brush pressed down.
  const s0 = point(g, 0.012);
  c.beginPath();
  c.arc(s0.x, s0.y, halfWidth(g, 0.03) * 1.02, 0, TAU);
  c.fill();
  // Spatter flicked off as the brush lands.
  const r = rng(77);
  for (let i = 0; i < 14; i++) {
    const a = g.a0 - 0.5 + r() * 1.3;
    const d = g.R * (0.86 + r() * 0.34);
    const size = g.u * (0.0015 + r() * r() * 0.007);
    c.beginPath();
    c.arc(g.x + Math.cos(a) * d, g.y + Math.sin(a) * d, size, 0, TAU);
    c.fill();
  }
  c.save();
  c.globalCompositeOperation = "destination-out";
  // Less ink reaches the end of the stroke.
  if (typeof c.createConicGradient === "function") {
    const cone = c.createConicGradient(g.a0, g.x, g.y);
    const span = g.sweep / TAU;
    cone.addColorStop(0, "rgba(0,0,0,0)");
    cone.addColorStop(span * 0.3, "rgba(0,0,0,0.04)");
    cone.addColorStop(span, "rgba(0,0,0,0.34)");
    cone.addColorStop(Math.min(1, span + 0.01), "rgba(0,0,0,0)");
    c.fillStyle = cone;
    c.fillRect(g.x - g.R * 1.5, g.y - g.R * 1.5, g.R * 3, g.R * 3);
  }
  // Bristle striations along the whole stroke, opening into dry-brush gaps at the tail.
  c.lineCap = "round";
  for (let i = 0; i < 38; i++) {
    const dryGap = i < 16;
    const off = dryGap ? -0.92 + (1.84 * (i + hash(i, 3) * 0.6)) / 16 : -0.95 + 1.9 * hash(i, 13);
    const s0s = dryGap ? 0.46 + 0.4 * hash(i, 9) : 0.04 + 0.4 * hash(i, 17);
    if (p <= s0s) continue;
    c.strokeStyle = dryGap
      ? `rgba(0,0,0,${(0.55 + 0.4 * hash(i, 5)).toFixed(3)})`
      : `rgba(0,0,0,${(0.1 + 0.22 * hash(i, 19)).toFixed(3)})`;
    c.lineWidth = g.u * (dryGap ? 0.0026 : 0.0014) * (0.6 + hash(i, 7));
    c.beginPath();
    const m = 36;
    for (let j = 0; j <= m; j++) {
      const s = s0s + ((p - s0s) * j) / m;
      const q = point(g, s);
      const hw = halfWidth(g, s);
      const x = q.x + q.nx * hw * off;
      const y = q.y + q.ny * hw * off;
      if (j === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  c.restore();
}

/** Diffusion halo (nijimi) on a quarter-resolution buffer: soft wash plus a tide-line rim. */
function bloom(ctx: Ctx2D, g: Geo, w: number, h: number, p: number, grow: number, color: string) {
  if (grow <= 0.002) return;
  const scale = 3;
  const bw = Math.max(8, Math.round(w / scale));
  const bh = Math.max(8, Math.round(h / scale));
  const { canvas, ctx: b } = buffer("sumi-bloom", bw, bh);
  const img = b.createImageData(bw, bh);
  const [cr, cg, cb] = parse(color);
  const texScale = 180 / g.u;
  const maxB = g.u * 0.075;
  const end = point(g, p);
  const start = point(g, 0);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const x = (i + 0.5) * (w / bw);
      const y = (j + 0.5) * (h / bh);
      const dx = x - g.x;
      const dy = y - g.y;
      const rho = Math.hypot(dx, dy);
      let a = Math.atan2(dy, dx) - g.a0;
      a = ((a % TAU) + TAU) % TAU;
      const s = a / g.sweep;
      let d: number;
      let sAt: number;
      if (s <= p) {
        d = Math.abs(rho - radiusAt(g, s)) - halfWidth(g, s);
        sAt = s;
      } else {
        const de = Math.hypot(x - end.x, y - end.y) - halfWidth(g, p);
        const ds = Math.hypot(x - start.x, y - start.y) - halfWidth(g, 0.03);
        d = Math.min(de, ds);
        sAt = de < ds ? p : 0;
      }
      if (d > maxB * 1.6) continue;
      const wet = 1.25 - 0.95 * sAt;
      const reach = maxB * grow * wet;
      const n =
        sample(x * texScale, y * texScale) * 0.72 +
        sample(x * texScale * 2.7 + 71, y * texScale * 2.7) * 0.28;
      const f = reach - d + n * maxB * 0.7;
      if (f <= 0) continue;
      const inside = smoothstep(0, maxB * 0.16, f);
      const wash = inside * Math.exp(-Math.max(0, d) / (maxB * 0.8 + 1e-3)) * 0.24;
      const rim = Math.exp(-((f - maxB * 0.06) ** 2) / (maxB * 0.055) ** 2) * 0.62;
      const v = clamp((wash + rim * inside) * Math.min(1, grow * 1.4));
      const k = (j * bw + i) * 4;
      img.data[k] = cr;
      img.data[k + 1] = cg;
      img.data[k + 2] = cb;
      img.data[k + 3] = Math.round(v * 255);
    }
  }
  b.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = "screen";
  // A touch of blur hides the buffer's pixel steps along the tide line.
  ctx.filter = `blur(${Math.max(0.5, scale * 0.45).toFixed(2)}px)`;
  ctx.drawImage(canvas as CanvasImageSource, 0, 0, w, h);
  ctx.restore();
}

function paper(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    // Mottled wash.
    const step = Math.max(4, Math.round(u / 90));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.35), y / (u * 0.35), 3.1, 3);
        c.fillStyle = rgba(theme.ink, 0.018 + 0.02 * n);
        c.fillRect(x, y, step, step);
      }
    // Long fibres.
    const r = rng(4242);
    c.lineCap = "round";
    for (let i = 0; i < 260; i++) {
      const x = r() * w;
      const y = r() * h;
      const len = u * (0.02 + r() * 0.08);
      const a = r() * TAU;
      c.strokeStyle = rgba(theme.ink, 0.02 + r() * 0.035);
      c.lineWidth = Math.max(0.5, u * 0.0007);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(
        x + Math.cos(a + 0.6) * len * 0.5,
        y + Math.sin(a + 0.6) * len * 0.5,
        x + Math.cos(a) * len,
        y + Math.sin(a) * len,
      );
      c.stroke();
    }
  };
}

function seal(theme: Theme, letter: string, logo: ReturnType<typeof logoFor>) {
  return (c: Ctx2D, w: number, h: number) => {
    c.fillStyle = theme.accent;
    const pad = w * 0.06;
    c.beginPath();
    c.roundRect(pad, pad, w - pad * 2, h - pad * 2, w * 0.06);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    // Carved mark: the brand's logo when there is one, else a letter.
    c.fillStyle = "#000";
    if (logo) drawLogo(c, logo, w / 2, h / 2, w * 0.56, h * 0.56);
    else {
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = font(700, w * 0.56, theme.font, "Georgia, serif");
      c.fillText(letter, w / 2, h * 0.53);
    }
    // Inner border, carved.
    c.strokeStyle = "#000";
    c.lineWidth = w * 0.035;
    c.strokeRect(pad * 2.1, pad * 2.1, w - pad * 4.2, h - pad * 4.2);
    // Uneven ink pickup.
    const r = rng(99);
    for (let i = 0; i < 140; i++) {
      c.fillStyle = `rgba(0,0,0,${(0.25 + r() * 0.6).toFixed(3)})`;
      const x = r() * w;
      const y = r() * h;
      c.beginPath();
      c.arc(x, y, w * (0.004 + r() * r() * 0.02), 0, TAU);
      c.fill();
    }
    c.globalCompositeOperation = "source-over";
  };
}

export const style: MotionStyle = {
  id: "sumi-ink-bloom",
  name: "Sumi Ink Bloom",
  look: "One ensō brushed in luminous ink on dark wet paper, bleeding into a soft tide-line halo, sealed in vermilion.",
  move: "The brush lands, sweeps the circle in one breath, ink blooms outward, the seal stamps, then it all dries to a ghost.",
  rules: [
    "One brush stroke, one breath: slow landing, fast middle, slow lift.",
    "Width follows pressure: a pressed blob at the start, a dry split tail.",
    "Dry-brush gaps open only in the last third of the stroke.",
    "The bloom spreads after the stroke, most where the brush was wettest.",
    "Every bloom edge carries a tide line, never a clean blur.",
    "The vermilion seal is the only colour and lands once, with weight.",
    "The loop ends by drying back to a ghost of the circle.",
  ],
  prompt: `R — References
• Zen ensō calligraphy (search: ensō brush painting, kasure dry brush).
• Ink dropped on wet rice paper (nijimi bleeding with a tide-line edge).
• A carved red hanko seal stamped once in the corner.

I — Idea
One image, one breath, 5 seconds, looping seamlessly:
• Beginning (0–1.9 s): a loaded brush lands on dark wet paper and sweeps one circle, fast in the middle, slow at both ends, splitting into dry bristles at the tail.
• Middle (1.9–3.9 s): ink bleeds outward into the paper and a vermilion seal carrying the initial of "{{name}}" stamps down once, hard.
• End (3.9–5 s): the ink dries back to a faint ghost of the circle, which is where the next stroke begins.

S — Style
Looks: {{bg}} paper with visible fibres and mottling, luminous {{ink}} ink, a cool {{accent2}} bloom, a small {{accent}} seal with the letter carved out in {{font}}. Generous empty space around one circle.
Moves: brush speed ease-in-out over 1.6 s; the bloom grows after the stroke with a feathered noise edge; the seal scales 1.2 to 1 in 0.25 s; the fade to ghost eases out.
Rules:
1. One stroke, drawn as a filled shape whose width follows brush pressure.
2. Dry-brush gaps (thin streaks of paper) only in the last third.
3. Bloom = soft wash + a brighter tide-line rim at its edge, driven by noise.
4. More bleed where the brush was wet (the start), less at the dry tail.
5. Spatter: a few dots flicked outward where the brush lands.
6. The seal is the only colour and stamps once.
7. Paper texture, light falloff and grain on every frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the stroke width really tapers; the bloom has a rim, not a blur; the seal letter is crisp and not clipped; the paper is never a flat colour. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Ens%C5%8D",
  theme: {
    bg: "#0d0c0b",
    ink: "#ede6d8",
    accent: "#d8432f",
    accent2: "#7f93a8",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..700"],
  tags: [
    "ink",
    "sumi",
    "brush",
    "calligraphy",
    "japanese",
    "zen",
    "circle",
    "enso",
    "organic",
    "bloom",
    "watercolor",
    "paint",
  ],
  word: "Motion",
  family: "Paint & Draw",
  tagline: "One brushed circle, ink bleeding",
  render(ctx, t, theme, w, h) {
    ground(ctx, w, h, theme.bg);
    const key = `sumi:${theme.bg}${theme.ink}`;
    ctx.drawImage(bake(key, w, h, paper(theme)) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.28, h * 0.18, Math.max(w, h) * 0.95, theme.ink, 0.07);

    const g = geometry(w, h);
    const draw = ease.inOutCubic(seg(t, 0.3, 1.9));
    const fresh = 1 - ease.inOutSine(seg(t, 3.9, 4.95));
    const ghost = 0.1;

    // Ghost of the dried circle, always present (the loop starts and ends on it).
    const ghostLayer = bake(`sumi-ghost:${theme.ink}`, w, h, (c) => stroke(c, g, 1, theme.ink));
    ctx.save();
    ctx.globalAlpha = ghost;
    ctx.drawImage(ghostLayer as CanvasImageSource, 0, 0);
    ctx.restore();

    const wash = mix(theme.accent2, theme.ink, 0.25);
    bloom(ctx, g, w, h, draw, ease.outCubic(seg(t, 0.9, 3.4)) * fresh, wash);

    if (fresh > 0.001 && draw > 0) {
      const { canvas, ctx: layer } = buffer("sumi-stroke", w, h);
      layer.clearRect(0, 0, w, h);
      stroke(layer, g, draw, theme.ink);
      ctx.save();
      ctx.globalAlpha = fresh;
      ctx.drawImage(canvas as CanvasImageSource, 0, 0);
      ctx.restore();
    }

    // The seal: stamps once at 2.35 s.
    const { portrait } = frameOf(w, h);
    const S = g.u * 0.1;
    const sx = portrait ? g.x + g.R * 0.62 : g.x + g.R * 1.28;
    const sy = portrait ? g.y + g.R * 1.42 : g.y + g.R * 0.7;
    const letter = wordFor(theme.name, "Motion").charAt(0).toUpperCase();
    const logo = logoFor(theme);
    const mark = logo && theme.logo ? `logo${theme.logo.length}${theme.logo.slice(-32)}` : letter;
    const sealLayer = bake(
      `sumi-seal:${theme.accent}${theme.font}${mark}`,
      S,
      S,
      seal(theme, letter, logo),
    );
    const stamp = seg(t, 2.35, 2.6);
    const drawSeal = (alpha: number, scale: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      ctx.rotate(-0.05);
      ctx.scale(scale, scale);
      ctx.drawImage(sealLayer as CanvasImageSource, -S / 2, -S / 2, S, S);
      ctx.restore();
    };
    drawSeal(ghost * 1.4, 1);
    if (stamp > 0 && fresh > 0.001) {
      const scale = lerp(1.22, 1, ease.outCubic(stamp));
      drawSeal(Math.min(1, stamp * 3) * fresh * 0.94, scale);
    }

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.32);
  },
};
