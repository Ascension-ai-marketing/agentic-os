import { mix, parse, rgba } from "../engine/color";
import { buffer, fract, frameOf, grain, hash, LOOP, once, rng, TAU, wordFor } from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

/** 5x7 bitmap font: each glyph is 7 rows of 5 bits. */
const GLYPHS: Record<string, string> = {
  A: "01110100011000111111100011000110001",
  B: "11110100011000111110100011000111110",
  C: "01110100011000010000100001000101110",
  D: "11110100011000110001100011000111110",
  E: "11111100001000011110100001000011111",
  F: "11111100001000011110100001000010000",
  G: "01110100011000010111100011000101111",
  H: "10001100011000111111100011000110001",
  I: "01110001000010000100001000010001110",
  J: "00111000100001000010000101001001100",
  K: "10001100101010011000101001001010001",
  L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001",
  N: "10001100011100110101100111000110001",
  O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101",
  R: "11110100011000111110101001001010001",
  S: "01111100001000001110000010000111110",
  T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100",
  W: "10001100011000110101101011010101010",
  X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100",
  Z: "11111000010001000100010001000011111",
  "0": "01110100011001110101110011000101110",
  "1": "00100011000010000100001000010001110",
  "2": "01110100010000100010001000100011111",
  "3": "11111000100010000010000011000101110",
  "4": "00010001100101010010111110001000010",
  "5": "11111100001111000001000011000101110",
  "6": "00110010001000011110100011000101110",
  "7": "11111000010001000100010000100001000",
  "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000010001001100",
  "-": "00000000000000011111000000000000000",
  ".": "00000000000000000000000000110001100",
  "!": "00100001000010000100001000000000100",
  "&": "01100100101010001000101011001001101",
  " ": "00000000000000000000000000000000000",
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

type Building = { x: number; w: number; h: number; windows: [number, number, number][] };

function city(LW: number, LH: number, horizon: number) {
  return once(`pixel-city:${LW}x${LH}`, () => {
    const r = rng(2024);
    const far: Building[] = [];
    const near: Building[] = [];
    for (let x = -4; x < LW + 4; ) {
      const w = 6 + Math.floor(r() * 10);
      const h = Math.floor(LH * (0.12 + r() * 0.2));
      const windows: [number, number, number][] = [];
      for (let wy = horizon - h + 2; wy < horizon - 2; wy += 3)
        for (let wx = x + 1; wx < x + w - 1; wx += 2) if (r() < 0.3) windows.push([wx, wy, r()]);
      far.push({ x, w, h, windows });
      x += w + (r() < 0.3 ? 1 : 0);
    }
    for (let x = -6; x < LW + 6; ) {
      const w = 12 + Math.floor(r() * 16);
      const h = Math.floor(LH * (0.2 + r() * 0.26));
      const windows: [number, number, number][] = [];
      for (let wy = horizon - h + 3; wy < horizon - 3; wy += 4)
        for (let wx = x + 2; wx < x + w - 2; wx += 3) if (r() < 0.42) windows.push([wx, wy, r()]);
      near.push({ x, w, h, windows });
      x += w + 2 + Math.floor(r() * 6);
    }
    return { far, near };
  });
}

function lit(seed: number, t: number) {
  // Most windows stay put; a few switch once per loop.
  const on = seed > 0.5;
  if (seed < 0.12) {
    const at = seed * 40;
    const len = 0.6 + seed * 6;
    const local = (((t - at) % LOOP) + LOOP) % LOOP;
    return local < len ? !on : on;
  }
  return on;
}

function neonOn(t: number, i: number, broken: number) {
  const offs = [
    [1.1, 1.16],
    [1.22, 1.26],
    [1.42, 1.47],
  ];
  if (offs.some(([a, b]) => t >= a && t < b)) return 0.18;
  if (i === broken && ((t >= 3.05 && t < 3.3) || (t >= 3.4 && t < 3.46))) return 0.12;
  return 1;
}

function pixelWord(theme: Theme) {
  const raw = wordFor(theme.name, "LO-FI", 10).toUpperCase();
  return [...raw].map((ch) => (GLYPHS[ch] ? ch : " ")).join("");
}

export const style: MotionStyle = {
  id: "pixel-rain",
  name: "Pixel Lo-fi Rain",
  look: "A chunky pixel city at night: dithered sky, lit windows, a flickering neon sign, rain and a rippling wet street.",
  move: "Rain falls in whole-pixel steps, the neon stutters once, windows blink, reflections wobble in the puddles.",
  rules: [
    "Draw at 108 pixels high and scale up with nearest-neighbour: no smoothing.",
    "Gradients are ordered dither, never smooth ramps.",
    "The neon sign is the brightest thing on screen, with a soft bloom.",
    "Rain moves in whole pixels on a slant, several speeds, wrapping every loop.",
    "The street mirrors the sign with a per-row wobble.",
    "One stutter of the neon per loop; one broken letter later on.",
    "Faint scanlines and grain on top.",
  ],
  prompt: `R — References
• Lo-fi pixel art city loops (search: pixel art rainy city gif, lofi pixel night).
• 1990s game backgrounds: ordered (Bayer) dithering, limited palettes, neon signage.

I — Idea
One image, a rainy night, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): rain over a pixel skyline; the neon sign reading "{{name}}" stutters on.
• Middle (1.5–3.5 s): the sign hums, windows blink on and off, ripples bloom in puddles; one letter flickers.
• End (3.5–5 s): the rain keeps its rhythm and the scene lands exactly on its first frame.

S — Style
Looks: {{bg}} night sky dithered toward {{accent2}} at the horizon, two layers of buildings, warm lit windows, a {{accent}} neon sign with a 5×7 pixel font and a soft glow, {{ink}} rain streaks, a wet street reflecting the sign.
Moves: rain in whole-pixel steps at three speeds (each wraps a whole number of times per loop), per-row reflection wobble, deterministic flicker windows.
Rules:
1. Render at 108 px high, upscale with nearest-neighbour; never smooth the pixels.
2. Ordered 4×4 Bayer dithering for every gradient.
3. The neon is the brightest element and the only saturated one.
4. Reflections are the sign flipped, darkened and wobbling per row.
5. Scanlines and grain on top.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; every pixel edge is crisp (no blur except the glow); the sign reads at thumbnail size; the dither is visible in the sky; rain never pops. Fix what fails and render again until every check passes.`,
  ref: "https://lospec.com/palette-list",
  theme: {
    bg: "#0b0d1a",
    ink: "#e7e2d3",
    accent: "#ff4fa0",
    accent2: "#4fd6e0",
    font: "Inter",
  },
  tags: [
    "pixel",
    "8-bit",
    "8bit",
    "retro",
    "game",
    "lofi",
    "lo-fi",
    "rain",
    "neon",
    "city",
    "night",
    "arcade",
  ],
  word: "LO-FI",
  family: "Retro Tech",
  tagline: "Neon, rain and a pixel city",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const P = Math.max(2, Math.round(u / 108));
    const LW = Math.ceil(w / P);
    const LH = Math.ceil(h / P);
    const horizon = Math.round(LH * 0.7);
    const { canvas: lowCanvas, ctx: low } = buffer("pixel-low", LW, LH);
    const { canvas: glowCanvas, ctx: glow } = buffer("pixel-glow", LW, LH);
    glow.clearRect(0, 0, LW, LH);

    const sky0 = theme.bg;
    const sky1 = mix(theme.bg, theme.accent2, 0.1);
    const sky2 = mix(theme.bg, theme.accent, 0.16);
    const farC = mix(theme.bg, theme.accent2, 0.12);
    const nearC = mix(theme.bg, "#000000", 0.35);
    const winC = mix(theme.ink, theme.accent, 0.18);
    const winDim = mix(theme.bg, theme.ink, 0.25);
    const neon = theme.accent;

    // Sky: dithered bands toward the horizon.
    const img = low.createImageData(LW, LH);
    const d = img.data;
    const c0 = parse(sky0);
    const c1 = parse(sky1);
    const c2 = parse(sky2);
    for (let y = 0; y < horizon; y++) {
      const g = (y / horizon) ** 2.2;
      for (let x = 0; x < LW; x++) {
        const threshold = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        const band = g * 2;
        const k = (y * LW + x) * 4;
        const c =
          band < 1 ? (fract(band) > threshold ? c1 : c0) : fract(band) > threshold ? c2 : c1;
        d[k] = c[0];
        d[k + 1] = c[1];
        d[k + 2] = c[2];
        d[k + 3] = 255;
      }
    }
    const street = parse(mix(theme.bg, "#000000", 0.25));
    for (let y = horizon; y < LH; y++)
      for (let x = 0; x < LW; x++) {
        const k = (y * LW + x) * 4;
        d[k] = street[0];
        d[k + 1] = street[1];
        d[k + 2] = street[2];
        d[k + 3] = 255;
      }
    low.putImageData(img, 0, 0);

    // Moon with a dithered halo.
    const mx = Math.round(LW * 0.8);
    const my = Math.round(LH * 0.2);
    const mr = Math.max(4, Math.round(LH * 0.07));
    const moon = mix(theme.ink, theme.accent2, 0.2);
    for (let y = -mr * 2; y <= mr * 2; y++)
      for (let x = -mr * 2; x <= mr * 2; x++) {
        const r = Math.hypot(x, y);
        if (r <= mr) {
          low.fillStyle =
            r > mr - 1.2 || (x + 2) ** 2 + (y - 1) ** 2 < 3 ? mix(moon, theme.bg, 0.2) : moon;
          low.fillRect(mx + x, my + y, 1, 1);
          glow.fillStyle = rgba(moon, 0.5);
          glow.fillRect(mx + x, my + y, 1, 1);
        } else if (
          r <= mr * 1.9 &&
          (BAYER[((y + 64) & 3) * 4 + ((x + 64) & 3)] + 0.5) / 16 > 0.35 + (r - mr) / (mr * 1.2)
        ) {
          low.fillStyle = mix(sky1, moon, 0.25);
          low.fillRect(mx + x, my + y, 1, 1);
        }
      }

    // Skyline, far and near.
    const { far, near } = city(LW, LH, horizon);
    for (const b of far) {
      low.fillStyle = farC;
      low.fillRect(b.x, horizon - b.h, b.w, b.h);
      for (const [wx, wy, s] of b.windows) {
        low.fillStyle = lit(s, t) ? mix(winC, farC, 0.45) : mix(farC, theme.ink, 0.06);
        low.fillRect(wx, wy, 1, 1);
      }
    }
    // The sign sits on the building nearest the centre.
    const centre = near.reduce((best, b) =>
      Math.abs(b.x + b.w / 2 - LW * 0.42) < Math.abs(best.x + best.w / 2 - LW * 0.42) ? b : best,
    );
    for (const b of near) {
      low.fillStyle = nearC;
      low.fillRect(b.x, horizon - b.h, b.w, b.h);
      low.fillStyle = mix(nearC, theme.accent2, 0.18);
      low.fillRect(b.x, horizon - b.h, b.w, 1);
      if (b === centre) continue;
      for (const [wx, wy, s] of b.windows) {
        const on = lit(s, t);
        low.fillStyle = on ? winC : winDim;
        low.fillRect(wx, wy, 2, 2);
        if (on) {
          glow.fillStyle = rgba(winC, 0.35);
          glow.fillRect(wx, wy, 2, 2);
        }
      }
    }

    // Neon sign.
    const word = pixelWord(theme);
    const scale = word.length * 6 > LW * 0.55 ? 1 : 2;
    const mark = tintedLogo(theme, neon, 7 * scale, 7 * scale);
    const markW = mark ? 7 * scale + 2 * scale : 0;
    const signW = word.length * 6 * scale - scale + 6 + markW;
    const signH = 7 * scale + 6;
    const sx = Math.round(Math.min(Math.max(2, LW * 0.42 - signW / 2), LW - signW - 2));
    const sy = Math.round(horizon - Math.max(centre.h * 0.7, signH + 10));
    const broken = Math.floor(hash(word.length, 7) * word.length);
    low.fillStyle = mix(theme.bg, "#000000", 0.5);
    low.fillRect(sx - 1, sy - 1, signW + 2, signH + 2);
    low.fillStyle = mix(nearC, neon, 0.12);
    low.fillRect(sx, sy, signW, signH);
    if (mark) {
      // The brand's logo, pixelated into the sign.
      const lit = neonOn(t, -1, -2) > 0.5;
      low.save();
      low.imageSmoothingEnabled = false;
      low.globalAlpha = lit ? 1 : 0.35;
      low.drawImage(mark as CanvasImageSource, sx + 3, sy + 3, 7 * scale, 7 * scale);
      low.restore();
      if (lit) glow.drawImage(mark as CanvasImageSource, sx + 3, sy + 3, 7 * scale, 7 * scale);
    }
    for (let i = 0; i < word.length; i++) {
      const glyph = GLYPHS[word[i]];
      const on = neonOn(t, i, broken);
      const col = on > 0.5 ? neon : mix(nearC, neon, 0.35);
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy * 5 + gx] !== "1") continue;
          const px = sx + 3 + markW + (i * 6 + gx) * scale;
          const py = sy + 3 + gy * scale;
          low.fillStyle = col;
          low.fillRect(px, py, scale, scale);
          if (on > 0.5) {
            glow.fillStyle = rgba(neon, 0.95);
            glow.fillRect(px, py, scale, scale);
          }
        }
    }
    // Sign frame tube.
    const frameOn = neonOn(t, -1, -2);
    low.strokeStyle =
      frameOn > 0.5 ? mix(neon, theme.accent2, 0.5) : mix(nearC, theme.accent2, 0.3);
    low.lineWidth = 1;
    low.strokeRect(sx + 0.5, sy + 0.5, signW - 1, signH - 1);
    if (frameOn > 0.5) {
      glow.strokeStyle = rgba(mix(neon, theme.accent2, 0.5), 0.7);
      glow.strokeRect(sx + 0.5, sy + 0.5, signW - 1, signH - 1);
    }

    // Street reflections: mirror rows above the horizon with a per-row wobble.
    const src = low.getImageData(0, 0, LW, LH);
    const sd = src.data;
    const gsrc = glow.getImageData(0, 0, LW, LH);
    const gd = gsrc.data;
    const depth = LH - horizon;
    for (let y = horizon; y < LH; y++) {
      const dy = y - horizon;
      const sy2 = horizon - 1 - Math.floor(dy * 1.1);
      if (sy2 < 0) continue;
      const wob = Math.round(Math.sin(TAU * ((2 * t) / LOOP) + dy * 0.9) * (0.6 + dy * 0.035));
      const fade = 0.5 * (1 - dy / (depth + 4));
      for (let x = 0; x < LW; x++) {
        const xs = Math.min(LW - 1, Math.max(0, x + wob));
        const ks = (sy2 * LW + xs) * 4;
        const kd = (y * LW + x) * 4;
        const stripe = y % 4 === 0 ? 0.55 : 1;
        for (let c = 0; c < 3; c++)
          sd[kd + c] = sd[kd + c] * (1 - fade * stripe) + sd[ks + c] * fade * stripe;
        gd[kd + 3] = Math.round(gd[ks + 3] * fade * 0.8 * stripe);
        for (let c = 0; c < 3; c++) gd[kd + c] = gd[ks + c];
      }
    }
    low.putImageData(src, 0, 0);
    glow.putImageData(gsrc, 0, 0);

    // Ripples in the puddles.
    for (let i = 0; i < 7; i++) {
      const period = LOOP / (2 + (i % 3));
      const age = fract(t / period + hash(i, 41));
      const rx = Math.round(hash(i, 3) * LW);
      const ry = Math.round(horizon + 3 + hash(i, 5) * (depth - 6));
      const rad = 1 + age * (5 + (i % 3) * 2);
      low.fillStyle = rgba(mix(theme.ink, theme.accent2, 0.4), 0.55 * (1 - age));
      for (let a = 0; a < 20; a++) {
        const ang = (a / 20) * TAU;
        low.fillRect(
          Math.round(rx + Math.cos(ang) * rad),
          Math.round(ry + Math.sin(ang) * rad * 0.34),
          1,
          1,
        );
      }
    }

    // Rain: three speeds, each wrapping a whole number of times per loop.
    const rain = mix(theme.ink, theme.accent2, 0.35);
    const drops = Math.round((LW * LH) / 190);
    const wrapH = LH + 10;
    for (let i = 0; i < drops; i++) {
      const k = 2 + (i % 3);
      const len = 3 + (i % 3);
      const y = fract(hash(i, 1) + (k * t) / LOOP) * wrapH - 6;
      const x0 = hash(i, 2) * (LW + LH * 0.4);
      const x = Math.round(x0 - (y + 6) * 0.35) - Math.round(LH * 0.05);
      low.fillStyle = rgba(rain, i % 3 === 0 ? 0.62 : 0.34);
      for (let j = 0; j < len; j++) low.fillRect(x - Math.round(j * 0.35), Math.round(y) - j, 1, 1);
    }

    // Upscale crisp, then bloom the emissive pixels.
    ground(ctx, w, h, theme.bg);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lowCanvas as CanvasImageSource, 0, 0, LW * P, LH * P);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "screen";
    ctx.filter = `blur(${(P * 2.2).toFixed(1)}px)`;
    ctx.drawImage(glowCanvas as CanvasImageSource, 0, 0, LW * P, LH * P);
    ctx.filter = `blur(${(P * 6).toFixed(1)}px)`;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(glowCanvas as CanvasImageSource, 0, 0, LW * P, LH * P);
    ctx.restore();
    // Scanlines.
    ctx.save();
    ctx.fillStyle = rgba("#000000", 0.1);
    for (let y = P - Math.max(1, Math.round(P / 3)); y < h; y += P)
      ctx.fillRect(0, y, w, Math.max(1, Math.round(P / 3)));
    ctx.restore();
    grain(ctx, w, h, t, 0.22);
  },
};

function ground(ctx: Ctx2D, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}
