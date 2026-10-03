import { adjust, mix, parse, rgba } from "../engine/color";
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
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { MotionStyle, Theme } from "../engine/types";
import { fitText, fontOf } from "./_s5-helpers";

const FAMILY = "Instrument Serif";
const SPRITE = 160;
/** Cat's-eye amounts: how far the lens barrel clips the disc. */
const EYES = [0, 0.3, 0.55, 0.8];

/**
 * One defocused highlight: a nine-blade aperture disc with a brighter rim
 * (spherical aberration), faint onion rings and dust, optionally clipped
 * into a cat's eye by the lens barrel. White; tinted per colour below.
 */
function disc(eye: number, color: string): AnyCanvas {
  const c = makeCanvas(SPRITE, SPRITE);
  const g = context(c);
  const R = SPRITE * 0.36;
  const cx = SPRITE / 2;
  const img = g.createImageData(SPRITE, SPRITE);
  const [cr, cg, cb] = parse(color);
  // Rim fringes: the disc's own colour turned toward magenta on one side and green on the other.
  const fringeA = parse(mix(color, adjust(color, 0.04, 1.3, 55), 0.45));
  const fringeB = parse(mix(color, adjust(color, 0.04, 1.3, -55), 0.35));
  const r = rng(Math.round(eye * 100) + 5);
  const dust: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * R * 0.8;
    dust.push([cx + Math.cos(a) * d, cx + Math.sin(a) * d, R * (0.03 + r() * 0.06)]);
  }
  const blades = 9;
  const bladeK = Math.cos(Math.PI / blades);
  const off = eye * R * 1.0;
  for (let y = 0; y < SPRITE; y++)
    for (let x = 0; x < SPRITE; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cx;
      const ang = Math.atan2(dy, dx);
      // Nine-blade polygon, very slightly rounded.
      const sector = TAU / blades;
      const local = (((ang % sector) + sector) % sector) - sector / 2;
      const poly = (R * bladeK) / Math.cos(local);
      const edgeR = R * 0.7 + poly * 0.3;
      const d = Math.hypot(dx, dy);
      let cover = clamp(edgeR - d + 0.5);
      // Veiling glare: a faint halo of the same light just outside the disc.
      const halo = d > edgeR ? 0.13 * Math.exp(-(((d - edgeR) / (R * 0.22)) ** 2)) : 0;
      // The lens barrel: a second circle, offset outward along +x.
      let rim = 0;
      if (eye > 0) {
        const db = Math.hypot(dx + off, dy);
        const barrel = R * 1.02 - db;
        cover = Math.min(cover, clamp(barrel + 0.5));
        rim = Math.max(rim, Math.exp(-(barrel * barrel) / (R * 0.05) ** 2) * 0.6);
      }
      if (cover <= 0) {
        if (halo > 0.004 && eye === 0) {
          const o = (y * SPRITE + x) * 4;
          img.data[o] = cr;
          img.data[o + 1] = cg;
          img.data[o + 2] = cb;
          img.data[o + 3] = halo * 255;
        }
        continue;
      }
      const k = d / edgeR;
      rim = Math.max(rim, Math.exp(-((edgeR - d) ** 2) / (R * 0.045) ** 2));
      const rings = 0.014 * Math.sin(k * 22);
      let v = 0.78 + 0.1 * k * k + rings + rim * 0.35;
      for (const [px, py, pr] of dust) {
        const q = Math.hypot(x - px, y - py) / pr;
        if (q < 1.6) v -= 0.07 * Math.exp(-q * q * 1.5);
      }
      v = Math.max(clamp(v) * cover, eye === 0 ? halo : 0);
      // Longitudinal chromatic aberration tints the rim: magenta on one side, green on the other.
      const side = dx / R;
      const fr = rim * 0.5;
      const o = (y * SPRITE + x) * 4;
      const tr = side > 0 ? fringeA : fringeB;
      img.data[o] = cr + (tr[0] - cr) * fr * Math.abs(side);
      img.data[o + 1] = cg + (tr[1] - cg) * fr * Math.abs(side);
      img.data[o + 2] = cb + (tr[2] - cb) * fr * Math.abs(side);
      img.data[o + 3] = v * 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

function sprites(theme: Theme): AnyCanvas[][] {
  return once(`bokeh-sprites:${theme.accent}${theme.accent2}${theme.ink}`, () => {
    const colors = [
      theme.accent,
      mix(theme.accent, theme.ink, 0.35),
      theme.accent2,
      mix(theme.ink, theme.accent, 0.12),
      mix(theme.accent, theme.accent2, 0.5),
    ];
    return colors.map((col) => EYES.map((e) => disc(e, col)));
  });
}

interface Light {
  x: number;
  y: number;
  r: number;
  c: number;
  a: number;
  layer: number;
}

/** A city of lights in three depth layers. Positions are in a strip that wraps horizontally. */
function lights(w: number, h: number): Light[] {
  return once(`bokeh-lights:${w}x${h}`, () => {
    const { u } = frameOf(w, h);
    const r = rng(1717);
    const out: Light[] = [];
    const layers = [
      { n: 90, r0: 0.006, r1: 0.02, a: 1 },
      { n: 26, r0: 0.03, r1: 0.065, a: 0.85 },
      { n: 7, r0: 0.1, r1: 0.17, a: 0.4 },
    ];
    layers.forEach((L, layer) => {
      for (let i = 0; i < L.n; i++) {
        const pick = r();
        const c = pick < 0.46 ? 0 : pick < 0.62 ? 1 : pick < 0.82 ? 2 : pick < 0.93 ? 3 : 4;
        // Street lights cluster in two bands, like a street and a skyline beyond it.
        const q = r();
        const band =
          q < 0.45 ? 0.62 + (r() - 0.5) * 0.18 : q < 0.7 ? 0.36 + (r() - 0.5) * 0.14 : r();
        out.push({
          x: r(),
          y: clamp(band, 0.04, 0.96) * h,
          r: u * (L.r0 + (L.r1 - L.r0) * r() * r()),
          c,
          a: L.a * (0.45 + 0.55 * r()),
          layer,
        });
      }
    });
    return out;
  });
}

export const style: MotionStyle = {
  id: "bokeh-night",
  name: "Bokeh Night",
  family: "Light & Material",
  tagline: "A city at night, out of focus",
  look: "A defocused city at night: nine-blade discs of sodium and neon light with bright rims, cat's-eye edges and drifting depth.",
  move: "The lights slide past in three depths; the focus racks in to a crisp title, holds, then melts back into pure bokeh.",
  rules: [
    "Every light is a lens disc: aperture blades, a brighter rim, faint rings and dust.",
    "Discs near the frame edge are clipped into cat's eyes, pointing outward.",
    "Three depth layers slide with parallax; the near ones are huge and faint.",
    "Light adds: overlapping discs brighten, they never cover each other.",
    "The focus pull is the one event: the title sharpens as the bokeh breathes larger.",
    "Magenta and green fringes on the rims, like real glass.",
  ],
  prompt: `R — References
• Night city bokeh shot wide open on a fast prime (search: bokeh city lights 50mm f1.2, cat's eye bokeh).
• Film title cards over defocused night streets.

I — Idea
A rack focus on a night street, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): only bokeh: discs of sodium and neon light drift past in three depths; the title is a soft glow.
• Middle (1.2–3.6 s): focus racks in; "{{name}}" sharpens and holds while the discs behind breathe slightly larger.
• End (3.6–5 s): focus racks back out and the title melts into the lights again.

S — Style
Looks: {{bg}} night; discs in {{accent}} (sodium), {{accent2}} (neon) and {{ink}} (white), brighter rims, nine-blade shapes, cat's eyes toward the edges; the title in {{font}}, large, {{ink}}.
Moves: a slow camera slide: three depth layers sway sideways with parallax (one whole cycle per loop); the rack focus eases in and out over about a second each way.
Rules:
1. Discs are lens shapes: blades, rim, rings, dust.
2. Cat's-eye clipping near the edges, pointing away from the centre.
3. Additive light; near discs large and faint.
4. One focus pull; the title holds sharp for at least 1.2 s.
5. Grain and vignette.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; discs read as lens bokeh, not flat circles; the title is razor sharp at 2.5 s and fully soft at 0 s; edge discs are cat's eyes; the parallax slide is gentle and joins without a jump. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Bokeh",
  theme: {
    bg: "#07060a",
    ink: "#fff5e8",
    accent: "#ffae42",
    accent2: "#45c2ff",
    font: FAMILY,
  },
  fonts: ["Instrument Serif"],
  tags: [
    "bokeh",
    "night",
    "city",
    "lights",
    "cinematic",
    "blur",
    "focus",
    "lens",
    "film",
    "moody",
    "title",
  ],
  word: "After Dark",
  render(ctx, t, theme, w, h) {
    const { u, cx, cy, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    // City haze: warm below, cool above.
    const haze = ctx.createLinearGradient(0, 0, 0, h);
    haze.addColorStop(0, rgba(mix(theme.bg, theme.accent2, 0.07), 1));
    haze.addColorStop(0.55, rgba(theme.bg, 1));
    haze.addColorStop(1, rgba(mix(theme.bg, theme.accent, 0.07), 1));
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);

    // Rack focus: soft, pull in, hold, pull out.
    const focus = ease.inOutCubic(seg(t, 1.15, 2.05)) * (1 - ease.inOutCubic(seg(t, 3.65, 4.55)));
    const breathe = 1 + 0.14 * focus;
    const S = sprites(theme);
    const list = lights(w, h);
    const p = t / LOOP;
    // A slow camera slide: each depth sways sideways by its own parallax, on one whole cycle per loop.
    const sway = [0.012, 0.03, 0.06];
    const slide = Math.sin(TAU * p);
    const diag = Math.hypot(cx, cy);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const L of list) {
      const x =
        -w * 0.06 +
        L.x * w * 1.12 +
        slide * w * sway[L.layer] +
        Math.sin(TAU * (p + L.y / h)) * u * 0.006;
      const y = L.y + Math.sin(TAU * (p + L.x * 3)) * u * 0.008 * (L.layer + 1);
      const r = L.r * breathe * (L.layer === 2 ? 1 : 1 + 0.08 * focus);
      // Cat's eye grows toward the edges, oriented radially.
      const dx = x - cx;
      const dy = y - cy;
      const rad = Math.hypot(dx, dy) / diag;
      const eyeIdx = Math.min(EYES.length - 1, Math.max(0, Math.floor((rad - 0.35) / 0.18) + 1));
      const sprite = S[L.c][rad < 0.35 ? 0 : eyeIdx];
      const ang = Math.atan2(dy, dx);
      const size = (r * 2) / 0.72;
      // Lights breathe a little, each on its own phase.
      const shimmer = 0.85 + 0.15 * Math.sin(TAU * (2 * p + L.x * 7.3));
      ctx.globalAlpha = clamp(L.a * shimmer * (1 - 0.25 * focus * (L.layer === 0 ? 1 : 0)));
      ctx.setTransform(Math.cos(ang), Math.sin(ang), -Math.sin(ang), Math.cos(ang), x, y);
      ctx.drawImage(sprite as CanvasImageSource, -size / 2, -size / 2, size, size);
    }
    ctx.restore();

    // The title: a soft glow when defocused, razor sharp at the hold.
    const word = wordFor(theme.name, "After Dark", 16);
    const family = theme.font || FAMILY;
    ctx.save();
    ctx.letterSpacing = "0px";
    const fit = fitText(
      ctx,
      word,
      portrait ? w * 0.84 : w * 0.66,
      h * 0.24,
      u * 0.34,
      400,
      family,
      '"Newsreader", Georgia, serif',
    );
    ctx.restore();
    const size = fit.size * (1.03 - 0.03 * focus);
    const small = 1 / 9;
    const bw = Math.max(8, Math.round(w * small));
    const bh = Math.max(8, Math.round(h * small));
    const { canvas: bc, ctx: B } = buffer("bokeh-title", bw, bh);
    B.setTransform(1, 0, 0, 1, 0, 0);
    B.clearRect(0, 0, bw, bh);
    B.font = fontOf("", 400, size * small, family, '"Newsreader", Georgia, serif');
    B.textAlign = "center";
    B.textBaseline = "middle";
    B.fillStyle = rgba(theme.ink, 1);
    B.fillText(word, bw / 2, (cy / h) * bh);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.7 * (1 - focus * 0.75);
    ctx.filter = `blur(${(u * 0.026 * (1 - focus) + u * 0.004).toFixed(1)}px)`;
    ctx.drawImage(bc as CanvasImageSource, 0, 0, w, h);
    ctx.filter = "none";
    ctx.restore();
    if (focus > 0.02) {
      ctx.save();
      ctx.globalAlpha = focus;
      ctx.font = fontOf("", 400, size, family, '"Newsreader", Georgia, serif');
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = theme.ink;
      ctx.fillText(word, cx, cy);
      ctx.restore();
    }
    const mark = tintedLogo(theme, rgba(theme.ink, 0.85), u * 0.055, u * 0.055);
    if (mark) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.6 * focus;
      ctx.drawImage(mark as CanvasImageSource, cx - u * 0.0275, cy + fit.ascent * 0.9 + u * 0.05);
      ctx.restore();
    }

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
