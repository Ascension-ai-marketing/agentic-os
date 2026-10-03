import { mix, rgba } from "../engine/color";
import { bake, clamp, ease, font, frameOf, light, seg, TAU, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { finish, fitBox, stock, tracked, trackedWidth } from "./_s3-helpers";

const FAMILY = "Limelight";
const FALLBACK = '"Poiret One", "Didot", Georgia, serif';
const RAYS = 12; // rays each side of the centre ray

type Geo = {
  /** Side pilasters: width in px (0 = none). */
  pil: number;
  cx: number;
  base: number;
  W: number;
  H: number;
  sunR: number;
  titleY: number;
  titleW: number;
  titleH: number;
  u: number;
};

function geo(w: number, h: number): Geo {
  const { u, portrait, square } = frameOf(w, h);
  if (portrait)
    return {
      pil: 0,
      cx: w / 2,
      base: h * 0.72,
      W: w * 0.84,
      H: h * 0.6,
      sunR: w * 0.15,
      titleY: h * 0.845,
      titleW: w * 0.8,
      titleH: u * 0.12,
      u,
    };
  if (square)
    return {
      pil: w * 0.075,
      cx: w / 2,
      base: h * 0.73,
      W: w * 0.6,
      H: h * 0.64,
      sunR: w * 0.1,
      titleY: h * 0.88,
      titleW: w * 0.7,
      titleH: u * 0.085,
      u,
    };
  return {
    pil: w * 0.08,
    cx: w / 2,
    base: h * 0.75,
    W: w * 0.56,
    H: h * 0.7,
    sunR: h * 0.11,
    titleY: h * 0.905,
    titleW: w * 0.6,
    titleH: u * 0.09,
    u,
  };
}

/** The stepped arch (a ziggurat crown): straight sides, three setbacks, a round top. */
function arch(c: Ctx2D, g: Geo, inset: number) {
  const W = g.W - inset * 2;
  const H = g.H - inset;
  const x0 = g.cx - W / 2;
  const x1 = g.cx + W / 2;
  const y0 = g.base;
  const stepX = W * 0.07;
  const stepY = H * 0.07;
  const topR = W / 2 - stepX * 3;
  // Straight sides take whatever height the crown and setbacks leave.
  const side = Math.max(H * 0.18, H - stepY * 3 - topR);
  c.beginPath();
  c.moveTo(x0, y0);
  let x = x0;
  let y = y0 - side;
  c.lineTo(x, y);
  for (let i = 0; i < 3; i++) {
    x += stepX;
    c.lineTo(x, y);
    y -= stepY;
    c.lineTo(x, y);
  }
  // The crown: a semicircle from the left setback to the right one.
  const cy = y;
  c.arc(g.cx, cy, topR, Math.PI, 0);
  x = x1 - stepX * 3;
  y = cy;
  for (let i = 0; i < 3; i++) {
    y += stepY;
    c.lineTo(x, y);
    x += stepX;
    c.lineTo(x, y);
  }
  c.lineTo(x1, y0 - side);
  c.lineTo(x1, y0);
  c.closePath();
}

/** Gilt: brightness of gold at angle a (0 = right, π = left, measured upward) with two symmetric glints. */
function gilt(a: number, glint: number, spread: number) {
  const d1 = a - (Math.PI / 2 - glint);
  const d2 = a - (Math.PI / 2 + glint);
  return Math.exp(-(d1 * d1) / (spread * spread)) + Math.exp(-(d2 * d2) / (spread * spread));
}

function lacquer(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    stock(theme, 17, 0.6, 0.3)(c, w, h);
    // Fine vertical pinstripes, barely there, like lacquered panelling.
    const { u } = frameOf(w, h);
    c.fillStyle = rgba(theme.accent, 0.035);
    const step = Math.max(3, u * 0.012);
    for (let x = 0; x < w; x += step) c.fillRect(Math.round(x), 0, Math.max(1, u * 0.0012), h);
  };
}

export const style: MotionStyle = {
  id: "art-deco",
  name: "Art Deco Gilt",
  family: "Design Movements",
  tagline: "A gold sunburst on black lacquer",
  look: "Gold line-work on black lacquer: a sunburst fan unfolding inside a stepped ziggurat arch, spaced Limelight caps.",
  move: "Rays unfold from the centre outward in pairs, rings draw on, two glints run out across the gold, then the fan folds away.",
  rules: [
    "Perfect bilateral symmetry; every move happens in mirrored pairs.",
    "Gold is a gradient that catches light, never a flat yellow.",
    "Hairlines and double lines only; no fills heavier than a whisper.",
    "The fan opens centre-out with a stagger and closes outside-in.",
    "Glints travel outward from the centre, both sides at once.",
    "Title in wide-tracked caps, flanked by rules and diamonds.",
    "Black lacquer ground with faint pinstripes and grain.",
  ],
  prompt: `R — References
• 1920s–30s Art Deco: the Chrysler Building crown, Radio City sunbursts, Cassandre posters (search: art deco sunburst, Chrysler spire, Erté gold line).
• Gatsby-era gilt line ornament on black lacquer.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.4 s): inside a stepped ziggurat arch, a gold sunburst unfolds from its centre ray outward, pair by pair; the sun's rings draw on.
• Middle (1.4–3.8 s): the fan holds; two glints run outward across the gold from the centre; small stars twinkle at the ray tips. The title "{{name}}" sits below in spaced caps.
• End (3.8–5 s): the fan folds back from the outside in, leaving the arch, the sun and the title as they began.

S — Style
Looks: {{bg}} lacquer ground with faint pinstripes; {{accent}} gold as a metallic gradient (bronze to pale gold); a whisper of {{accent2}} in alternate fan panels; {{ink}} for the brightest glints; {{font}} (or Limelight) caps tracked +20%.
Moves: rays unfold in mirrored pairs (40 ms stagger, cubic ease), rings draw on as arcs, glints travel as symmetric highlights, the fold reverses the unfold.
Rules:
1. Bilateral symmetry in every frame.
2. Gold is a gradient that catches light.
3. Hairlines and double lines; generous black.
4. Centre-out opening, outside-in closing.
5. Title flanked by rules and diamonds.
6. Grain and a soft light pool on the lacquer.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the composition is exactly symmetric; the gold reads as metal, not mustard; hairlines stay crisp at tile size; the title never touches the ornaments. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Art_Deco",
  theme: {
    bg: "#0b0c10",
    ink: "#f6ecd4",
    accent: "#d4a54a",
    accent2: "#2f7d6d",
    font: FAMILY,
  },
  fonts: ["Limelight", "Poiret One"],
  tags: [
    "art deco",
    "deco",
    "gatsby",
    "gold",
    "luxury",
    "1920s",
    "sunburst",
    "fan",
    "symmetry",
    "elegant",
    "geometric",
    "design movement",
  ],
  word: "Deco",
  render(ctx, t, theme, w, h) {
    const g = geo(w, h);
    const { u } = g;
    ctx.drawImage(
      bake(
        `deco-lacquer:${theme.bg}${theme.ink}${theme.accent}`,
        w,
        h,
        lacquer(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, g.cx, g.base - g.H * 0.45, Math.max(w, h) * 0.6, theme.accent, 0.09);

    const gold = theme.accent;
    const deep = mix(theme.accent, theme.bg, 0.55);
    const pale = mix(theme.accent, theme.ink, 0.6);
    const lw = Math.max(1, u * 0.0028);

    // Timeline: open centre-out, hold with glints, fold outside-in.
    const openAt = (k: number) => ease.inOutCubic(seg(t, 0.15 + k * 0.055, 0.85 + k * 0.055));
    const foldAt = (k: number) =>
      ease.inOutCubic(seg(t, 3.75 + (RAYS - k) * 0.045, 4.4 + (RAYS - k) * 0.045));
    const glint = ease.inOutSine(seg(t, 1.3, 3.9)) * (Math.PI / 2 + 0.3);
    const glow = Math.sin(Math.PI * seg(t, 1.3, 3.9));

    // Arch: soft panel inside, then the double gilt outline.
    ctx.save();
    arch(ctx, g, 0);
    const panel = ctx.createLinearGradient(0, g.base - g.H, 0, g.base);
    panel.addColorStop(0, rgba(theme.accent2, 0.1));
    panel.addColorStop(1, rgba(theme.accent2, 0.02));
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.clip();

    // Fan: alternate panels whisper jade; rays in gilt.
    const R = Math.hypot(g.W, g.H) * 1.05;
    const sunY = g.base;
    for (let k = -RAYS; k <= RAYS; k++) {
      const ak = Math.abs(k);
      const open = openAt(ak) * (1 - foldAt(ak));
      if (open <= 0.001) continue;
      const a = Math.PI + (k + RAYS) * (Math.PI / (RAYS * 2));
      const a2 = a + Math.PI / (RAYS * 2);
      if (k < RAYS && (k & 1) === 0) {
        const open2 = openAt(Math.abs(k + 1)) * (1 - foldAt(Math.abs(k + 1)));
        const reach = R * Math.min(open, open2);
        if (reach > g.sunR) {
          ctx.beginPath();
          ctx.moveTo(g.cx + Math.cos(a) * g.sunR, sunY + Math.sin(a) * g.sunR);
          ctx.arc(g.cx, sunY, reach, a, a2);
          ctx.arc(g.cx, sunY, g.sunR, a2, a, true);
          ctx.closePath();
          ctx.fillStyle = rgba(theme.accent2, 0.16 + 0.08 * glow);
          ctx.fill();
        }
      }
      // The ray itself: long and short rays alternate.
      const long = ak % 2 === 0 ? 1 : 0.8;
      const r1 = g.sunR * 1.12;
      const r2 = r1 + (R * long - r1) * open;
      const up = -Math.sin(a);
      const shine = gilt(Math.acos(Math.max(-1, Math.min(1, Math.cos(a)))), glint, 0.22) * glow;
      ctx.strokeStyle = mix(gold, theme.ink, clamp(0.08 + shine * 0.75));
      ctx.lineWidth = lw * (ak === 0 ? 2.2 : 1.3);
      ctx.beginPath();
      ctx.moveTo(g.cx + Math.cos(a) * r1, sunY + Math.sin(a) * r1);
      ctx.lineTo(g.cx + Math.cos(a) * r2, sunY + Math.sin(a) * r2);
      ctx.stroke();
      // A small star at each long ray's tip once it is out.
      if (long === 1 && open > 0.95 && up > 0.05) {
        const tw = 0.5 + 0.5 * Math.sin(TAU * (t / 2.5) + ak * 1.7);
        const tx = g.cx + Math.cos(a) * g.H * 0.78;
        const ty = sunY + Math.sin(a) * g.H * 0.78;
        const s = u * 0.008 * (0.6 + tw * 0.8) * glow;
        if (s > 0.3) {
          ctx.fillStyle = mix(gold, theme.ink, 0.5 + tw * 0.4);
          ctx.beginPath();
          ctx.moveTo(tx, ty - s * 2.2);
          ctx.lineTo(tx + s * 0.5, ty);
          ctx.lineTo(tx, ty + s * 2.2);
          ctx.lineTo(tx - s * 0.5, ty);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // Rings of the rising sun, drawing on as arcs from the centre.
    for (let i = 0; i < 4; i++) {
      const rr = g.sunR * (1.3 + i * 0.42);
      const on =
        ease.inOutCubic(seg(t, 0.2 + i * 0.12, 1.1 + i * 0.12)) *
        (1 - ease.inOutCubic(seg(t, 3.9 + (3 - i) * 0.1, 4.6 + (3 - i) * 0.1)));
      if (on <= 0.001) continue;
      const span = (Math.PI / 2) * on;
      ctx.strokeStyle = mix(deep, gold, 0.6 + 0.4 * glow);
      ctx.lineWidth = lw * (i === 0 ? 1.6 : 1);
      ctx.beginPath();
      ctx.arc(g.cx, sunY, rr, -Math.PI / 2 - span, -Math.PI / 2 + span);
      ctx.stroke();
    }
    ctx.restore();

    // The sun: a gilt half-disc with inner rings.
    {
      const sg = ctx.createLinearGradient(0, sunY - g.sunR, 0, sunY);
      sg.addColorStop(0, pale);
      sg.addColorStop(0.45, gold);
      sg.addColorStop(1, deep);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(g.cx, sunY, g.sunR, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(theme.bg, 0.55);
      ctx.lineWidth = lw;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(g.cx, sunY, g.sunR * (1 - i * 0.22), Math.PI, 0);
        ctx.stroke();
      }
    }

    // Double gilt outline of the arch.
    const outline = ctx.createLinearGradient(g.cx - g.W / 2, 0, g.cx + g.W / 2, 0);
    // Glints ride the outline too; with no glow the stops fall back onto the base ramp.
    const gl = clamp(glint / (Math.PI / 2 + 0.3), 0.02, 0.98);
    const ramp = mix(deep, gold, 1 - gl);
    outline.addColorStop(0, deep);
    outline.addColorStop(0.5 - gl * 0.5, mix(ramp, theme.ink, 0.6 * glow));
    outline.addColorStop(0.5, gold);
    outline.addColorStop(0.5 + gl * 0.5, mix(ramp, theme.ink, 0.6 * glow));
    outline.addColorStop(1, deep);
    ctx.strokeStyle = outline;
    ctx.lineWidth = lw * 2.2;
    arch(ctx, g, 0);
    ctx.stroke();
    ctx.lineWidth = lw;
    arch(ctx, g, u * 0.016);
    ctx.stroke();

    // Side pilasters: stepped towers whose gilt lines rise with the fan.
    if (g.pil > 0) {
      const rise = ease.inOutCubic(seg(t, 0.25, 1.35)) * (1 - ease.inOutCubic(seg(t, 3.85, 4.85)));
      const gap = g.W * 0.06;
      const pw = g.pil;
      const ph = g.H * 0.6;
      for (const sgn of [-1, 1]) {
        const xIn = g.cx + sgn * (g.W / 2 + gap);
        const xOut = xIn + sgn * pw;
        const xl = Math.min(xIn, xOut);
        const top = g.base - ph;
        const st = pw * 0.18;
        ctx.strokeStyle = mix(gold, theme.bg, 0.15);
        ctx.lineWidth = lw * 1.4;
        ctx.beginPath();
        ctx.moveTo(xl, g.base);
        ctx.lineTo(xl, top + st * 2);
        ctx.lineTo(xl + st, top + st * 2);
        ctx.lineTo(xl + st, top + st);
        ctx.lineTo(xl + st * 2, top + st);
        ctx.lineTo(xl + st * 2, top);
        ctx.lineTo(xl + pw - st * 2, top);
        ctx.lineTo(xl + pw - st * 2, top + st);
        ctx.lineTo(xl + pw - st, top + st);
        ctx.lineTo(xl + pw - st, top + st * 2);
        ctx.lineTo(xl + pw, top + st * 2);
        ctx.lineTo(xl + pw, g.base);
        ctx.stroke();
        // Three rising hairlines and a crown fan.
        ctx.lineWidth = lw;
        const lineTop = g.base - (ph - st * 3.2) * rise;
        for (let i = 1; i <= 3; i++) {
          const lx = xl + (pw * i) / 4;
          const sh =
            gilt(Math.PI / 2 + sgn * Math.min(Math.PI / 2, glint) * 0.6, glint, 0.5) * glow;
          ctx.strokeStyle = mix(gold, theme.ink, clamp(0.05 + sh * 0.5));
          ctx.beginPath();
          ctx.moveTo(lx, g.base - lw * 3);
          ctx.lineTo(lx, lineTop);
          ctx.stroke();
        }
        if (rise > 0.01) {
          const fx = xl + pw / 2;
          const fy = top + st * 3.2;
          ctx.strokeStyle = mix(gold, theme.bg, 0.1);
          for (let i = 0; i <= 6; i++) {
            const a = Math.PI + (i * Math.PI) / 6;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(fx + Math.cos(a) * pw * 0.32 * rise, fy + Math.sin(a) * pw * 0.32 * rise);
            ctx.stroke();
          }
        }
      }
    }

    // Base: a rule with a row of chevrons under it.
    const baseW = g.pil > 0 ? g.W * 1.12 + (g.W * 0.06 + g.pil) * 2 : g.W * 1.12;
    ctx.fillStyle = gold;
    ctx.fillRect(g.cx - baseW / 2, g.base, baseW, lw * 2.2);
    ctx.strokeStyle = mix(gold, theme.bg, 0.3);
    ctx.lineWidth = lw;
    ctx.beginPath();
    const chev = u * 0.022;
    const n = Math.floor(baseW / (chev * 1.4));
    for (let i = 0; i < n; i++) {
      const x = g.cx - baseW / 2 + (i + 0.5) * (baseW / n);
      ctx.moveTo(x - chev * 0.5, g.base + lw * 4);
      ctx.lineTo(x, g.base + lw * 4 + chev * 0.45);
      ctx.lineTo(x + chev * 0.5, g.base + lw * 4);
    }
    ctx.stroke();

    // Title: spaced caps in gilt, flanked by rules and diamonds.
    const word = wordFor(theme.name, "Deco", 12).toUpperCase();
    const track = 0.22;
    const wt = theme.font === FAMILY ? 400 : 500;
    const size = fitBox(ctx, word, g.titleW * 0.62, g.titleH, wt, theme.font, FALLBACK);
    ctx.font = font(wt, size, theme.font, FALLBACK);
    const tw = trackedWidth(ctx, word, size * track);
    const tg = ctx.createLinearGradient(0, g.titleY - size * 0.75, 0, g.titleY);
    tg.addColorStop(0, pale);
    tg.addColorStop(0.5, gold);
    tg.addColorStop(1, deep);
    ctx.fillStyle = tg;
    ctx.textBaseline = "alphabetic";
    tracked(ctx, word, g.cx, g.titleY, size * track, "center");
    const midY = g.titleY - size * 0.36;
    const gap = size * 0.6;
    const ruleL = Math.min(g.titleW * 0.5 - tw / 2 - gap, u * 0.3);
    if (ruleL > u * 0.03) {
      for (const sgn of [-1, 1]) {
        const xa = g.cx + sgn * (tw / 2 + gap);
        const xb = xa + sgn * ruleL;
        ctx.fillStyle = gold;
        const L = Math.abs(xb - xa);
        ctx.fillRect(Math.min(xa, xb), midY - lw * 1.6, L, lw);
        ctx.fillRect(sgn < 0 ? xb + L * 0.2 : xa, midY + lw * 0.6, L * 0.8, lw);
        const d = size * 0.13;
        ctx.beginPath();
        ctx.moveTo(xb, midY - d);
        ctx.lineTo(xb + sgn * d, midY);
        ctx.lineTo(xb, midY + d);
        ctx.lineTo(xb - sgn * d, midY);
        ctx.closePath();
        ctx.fill();
      }
    }
    const cap = Math.max(7, size * 0.24);
    ctx.font = font(400, cap, "Poiret One", FALLBACK);
    ctx.fillStyle = rgba(theme.ink, 0.7);
    tracked(ctx, "MCMXXV", g.cx, g.titleY + cap * 2.2, cap * 0.5, "center");

    const mark = tintedLogo(theme, theme.bg, u * 0.07, u * 0.07);
    if (mark) ctx.drawImage(mark as CanvasImageSource, g.cx - u * 0.035, g.base - g.sunR * 0.72);

    finish(ctx, w, h, t, 0.55, 0.26);
  },
};
