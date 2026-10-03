import { mix, parse, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  fitSize,
  font,
  frameOf,
  fract,
  grain,
  ground,
  hash,
  LOOP,
  seg,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { barrel, glow, snowTile, stepFrame } from "./_s4-helpers";

const DISPLAY = '"Unbounded", "Arial Black", sans-serif';
/** Power-on: dot → line → picture. */
const ON_A = 0.16;
const ON_B = 0.3;
const ON_C = 0.56;
const ON_D = 1.05;
/** Power-off: picture → line → dot, which then fades into the next loop. */
const OFF_A = 4.28;
const OFF_B = 4.44;
const OFF_C = 4.58;

interface Screen {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

function screenOf(w: number, h: number): Screen {
  const { u } = frameOf(w, h);
  const m = u * 0.045;
  return { x: m, y: m, w: w - m * 2, h: h - m * 2, r: u * 0.07 };
}

/**
 * Aperture grille (vertical R, G, B stripes) and scanline gaps, as a multiply
 * layer the size of the screen buffer. White where the phosphor glows fully.
 */
function mask(pitch: number, line: number) {
  return (c: Ctx2D, W: number, H: number) => {
    const img = c.createImageData(W, H);
    const d = img.data;
    const tri = [
      [255, 92, 92],
      [92, 255, 92],
      [92, 92, 255],
    ];
    for (let y = 0; y < H; y++) {
      const ly = (y % line) / line;
      // A soft dark gap at the bottom of each scanline.
      const gap = ly > 0.58 ? Math.sin(((ly - 0.58) / 0.42) * Math.PI) : 0;
      const k = 1 - 0.6 * gap;
      for (let x = 0; x < W; x++) {
        const s = Math.floor(x / pitch) % 3;
        const o = (y * W + x) * 4;
        d[o] = tri[s][0] * k;
        d[o + 1] = tri[s][1] * k;
        d[o + 2] = tri[s][2] * k;
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
  };
}

/** The stand-by slide: full-height colour bars, a black caption box, the word and a channel overline. */
function ident(c: Ctx2D, theme: Theme, sw: number, sh: number, word: string, flash: number) {
  const { portrait } = frameOf(sw, sh);
  const family = theme.font || "Unbounded";
  const size = fitSize(
    c,
    word,
    sw * (portrait ? 0.8 : 0.66),
    sh * (portrait ? 0.14 : 0.22),
    800,
    family,
    DISPLAY,
  );
  const cy = sh * 0.5;
  const lift = (col: string, k: number) => mix(col, "#ffffff", flash * 0.55 * k);
  // Colour bars in the theme's own colours. Their straight edges are what show
  // off the curved glass.
  const bars = [
    theme.ink,
    mix(theme.ink, theme.accent, 0.62),
    mix(theme.ink, theme.accent2, 0.7),
    theme.accent2,
    mix(theme.accent2, theme.accent, 0.5),
    theme.accent,
    mix(theme.accent2, theme.bg, 0.45),
  ];
  // Full-height bars, then a black caption box in the middle, like a stand-by slide.
  const bw = sw / bars.length;
  bars.forEach((col, i) => {
    c.fillStyle = lift(col, 1);
    c.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, sh);
  });
  c.font = font(800, size, family, DISPLAY);
  const boxW = Math.min(sw * 0.9, c.measureText(word).width + size * 1.3);
  const boxH = size * 1.9;
  c.fillStyle = mix(theme.bg, "#000000", 0.5);
  c.beginPath();
  c.roundRect(sw / 2 - boxW / 2, cy - boxH * 0.56, boxW, boxH, size * 0.12);
  c.fill();
  c.strokeStyle = rgba(theme.ink, 0.85);
  c.lineWidth = Math.max(1, size * 0.035);
  c.stroke();
  c.textAlign = "center";
  c.textBaseline = "alphabetic";
  c.font = font(800, size, family, DISPLAY);
  const tw = c.measureText(word).width;
  const base = cy + size * 0.36;
  // Misconvergence: the three guns land a hair apart.
  const [r, g, b] = parse(mix(theme.ink, "#ffffff", flash));
  const off = Math.max(0.6, sw / 900);
  c.globalCompositeOperation = "lighter";
  c.fillStyle = `rgb(${r},0,0)`;
  c.fillText(word, sw / 2 - off, base);
  c.fillStyle = `rgb(0,${g},0)`;
  c.fillText(word, sw / 2, base);
  c.fillStyle = `rgb(0,0,${b})`;
  c.fillText(word, sw / 2 + off, base + off * 0.3);
  c.globalCompositeOperation = "source-over";
  // Overline: channel number (and the brand's logo when there is one).
  const small = Math.max(8, size * 0.17);
  c.font = font(600, small, family, DISPLAY);
  c.fillStyle = theme.accent;
  const over = cy - size * 0.62;
  const label = "CH 03";
  const mark = tintedLogo(theme, theme.accent, small * 1.6, small * 1.6);
  const lw = c.measureText(label).width;
  if (mark) {
    c.drawImage(mark as CanvasImageSource, sw / 2 - lw / 2 - small * 2.2, over - small * 1.25);
    c.fillText(label, sw / 2 + small * 0.9, over);
  } else c.fillText(label, sw / 2, over);
  void tw;
}

export const style: MotionStyle = {
  id: "crt-scanline",
  name: "CRT Tube",
  family: "Retro Tech",
  tagline: "A picture tube up close",
  look: "A curved picture tube up close: RGB aperture-grille stripes, scanline gaps, bloom, and a colour-bar stand-by slide.",
  move: "The set switches on (dot, line, picture), a hum bar rolls down the slide, then it collapses back to a fading dot.",
  rules: [
    "Draw the picture flat, then warp it: the raster bows outward like curved glass.",
    "Aperture grille and scanlines multiply the picture; bright areas show the RGB stripes.",
    "Phosphor bloom on everything bright; blacks are the grey-green of dead glass, never pure.",
    "The three guns land a hair apart: faint red and blue fringes on type.",
    "Power on and off are the motion: dot, line, picture, and back.",
    "One slow hum bar per loop; no other movement on the ident.",
    "Hold the ident at least 1.2 s.",
  ],
  prompt: `R — References
• Sony Trinitron close-ups: vertical RGB aperture-grille stripes, scanline gaps, phosphor bloom (search: CRT macro RGB phosphor, Trinitron aperture grille).
• CRT power-on and power-off: the white line, the collapsing dot, the afterglow.
• Late-night TV stand-by slides: colour bars behind a caption box.

I — Idea
One switch-on, 5 seconds, looping seamlessly:
• Beginning (0–1 s): a fading dot in the dark glass; it stretches into a white line, which opens into the picture with a bright flash.
• Middle (1–4.3 s): the stand-by slide holds: full-height colour bars, a black caption box with "{{name}}" huge and a small channel overline; a hum bar rolls slowly down.
• End (4.3–5 s): the picture collapses to a line, the line to a dot, and the dot fades, which is where the loop began.

S — Style
Looks: {{bg}} glass and bezel; seven colour bars mixed from the palette ({{ink}}, {{accent2}}, {{accent}}); a black caption box with a thin {{ink}} rule; the word in {{ink}} set in Unbounded (or {{font}}) extra bold; overline in {{accent}}; vertical RGB stripes and dark scanline gaps multiplied over the picture; warm bloom; the raster bowed by the curved glass; a soft reflection on the tube.
Moves: power-on line in 0.14 s, open in 0.26 s with a slight overshoot, flash decays over 0.5 s; hum bar rolls once per loop; power-off collapses in 0.3 s; the dot fades exponentially.
Rules:
1. Warp the flat picture so straight lines bow near the edges.
2. RGB stripes + scanline gaps as a multiply layer; bloom added after.
3. Misconverged guns: 1 px red/blue fringes on type.
4. Dead-glass grey-green blacks, a vignette and a reflection.
5. The only motion is power on, the hum bar, and power off.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the stripes are visible at full size and do not moiré at tile size; the edges of the picture bow; the power line is white-hot with bloom; the word never clips at the rounded corners. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Aperture_grille",
  theme: {
    bg: "#07090a",
    ink: "#f2f5ff",
    accent: "#ff5a3c",
    accent2: "#3ec6ff",
    font: "Unbounded",
  },
  fonts: ["Unbounded:wght@400..900"],
  tags: [
    "crt",
    "tv",
    "television",
    "scanlines",
    "monitor",
    "screen",
    "phosphor",
    "retro",
    "broadcast",
    "80s",
    "90s",
    "glow",
  ],
  word: "SIGNAL",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const S = screenOf(w, h);
    const sw = Math.round(S.w);
    const sh = Math.round(S.h);
    // Bezel: dark plastic, lit a little from above.
    ground(ctx, w, h, mix(theme.bg, "#000000", 0.2));
    const bez = ctx.createLinearGradient(0, 0, 0, h);
    bez.addColorStop(0, mix(theme.bg, theme.ink, 0.07));
    bez.addColorStop(1, mix(theme.bg, "#000000", 0.35));
    ctx.fillStyle = bez;
    ctx.fillRect(0, 0, w, h);

    // Power state.
    const openX =
      t < OFF_A ? ease.outCubic(seg(t, ON_A, ON_B)) : 1 - ease.inCubic(seg(t, OFF_B, OFF_C));
    const openY =
      t < OFF_A
        ? Math.max(0.006, ease.outBack(seg(t, ON_B, ON_C)))
        : Math.max(0.006, 1 - ease.inCubic(seg(t, OFF_A, OFF_B)));
    const lineMode = (t >= ON_A && t < ON_C && openY < 0.05) || (t >= OFF_A && t < OFF_C);
    const picture = t >= ON_B && t < OFF_B;
    const flash = picture
      ? t < OFF_A
        ? 1 - ease.outCubic(seg(t, ON_B, ON_D))
        : ease.inCubic(seg(t, OFF_A, OFF_B))
      : 0;
    const dotAge = (t - OFF_C + LOOP) % LOOP;
    const dot = t >= OFF_C || t < ON_A ? Math.exp(-dotAge * 4.2) : 0;

    // The flat picture, before the glass bends it.
    const { canvas: pC, ctx: p } = buffer("crt-pic", sw, sh);
    p.globalCompositeOperation = "source-over";
    p.globalAlpha = 1;
    p.fillStyle = mix(theme.bg, "#000000", 0.35);
    p.fillRect(0, 0, sw, sh);
    const frame = stepFrame(t, 30);
    if (picture || lineMode) {
      p.save();
      p.translate(sw / 2, sh / 2);
      p.scale(Math.max(0.002, openX), openY);
      p.translate(-sw / 2, -sh / 2);
      if (picture && openY > 0.04) {
        ident(p, theme, sw, sh, wordFor(theme.name, "SIGNAL", 12), clamp(flash));
        // The hum bar: a soft band of extra brightness rolling down once a loop.
        const band = sh * 0.34;
        const hy = fract(t / LOOP + 0.2) * (sh + band * 2) - band;
        const hum = p.createLinearGradient(0, hy - band / 2, 0, hy + band / 2);
        hum.addColorStop(0, rgba(theme.ink, 0));
        hum.addColorStop(0.5, rgba(theme.ink, 0.07));
        hum.addColorStop(1, rgba(theme.ink, 0));
        p.globalCompositeOperation = "lighter";
        p.fillStyle = hum;
        p.fillRect(0, hy - band / 2, sw, band);
        p.globalCompositeOperation = "source-over";
      }
      p.restore();
      if (lineMode) {
        // The white-hot line (or dot) while the raster is collapsed.
        const lw = sw * Math.max(0.004, openX);
        const lh = Math.max(2, sh * 0.012);
        const g = p.createLinearGradient(0, sh / 2 - lh * 2, 0, sh / 2 + lh * 2);
        g.addColorStop(0, rgba(theme.ink, 0));
        g.addColorStop(0.5, rgba(mix(theme.ink, "#ffffff", 0.7), 1));
        g.addColorStop(1, rgba(theme.ink, 0));
        p.fillStyle = g;
        p.fillRect(sw / 2 - lw / 2, sh / 2 - lh * 2, lw, lh * 4);
      }
    }
    if (dot > 0.002) {
      const r = sh * 0.05;
      const g = p.createRadialGradient(sw / 2, sh / 2, 0, sw / 2, sh / 2, r);
      g.addColorStop(0, rgba(mix(theme.ink, "#ffffff", 0.8), dot));
      g.addColorStop(0.12, rgba(theme.ink, dot * 0.7));
      g.addColorStop(1, rgba(theme.ink, 0));
      p.fillStyle = g;
      p.fillRect(sw / 2 - r, sh / 2 - r, r * 2, r * 2);
    }
    // A breath of snow in the black level.
    p.save();
    p.globalAlpha = 0.045;
    p.globalCompositeOperation = "screen";
    const snow = p.createPattern(snowTile(frame) as CanvasImageSource, "repeat");
    if (snow) {
      p.fillStyle = snow;
      p.fillRect(0, 0, sw, sh);
    }
    p.restore();

    // Keep the unmasked picture for the bloom, then lay on the grille and scanlines.
    const { canvas: bC, ctx: b } = buffer("crt-bloom-src", sw, sh);
    b.globalCompositeOperation = "copy";
    b.drawImage(pC as CanvasImageSource, 0, 0);
    b.globalCompositeOperation = "source-over";
    const pitch = Math.max(3, Math.round(u / 360));
    const line = Math.max(3, sh / Math.round(sh / Math.max(3, u / 200)));
    p.globalCompositeOperation = "multiply";
    p.drawImage(
      bake(`crt-mask:${pitch}:${line.toFixed(3)}`, sw, sh, mask(pitch, line)) as CanvasImageSource,
      0,
      0,
    );
    p.globalCompositeOperation = "source-over";
    // The mask costs brightness; win it back like the tube's gamma does.
    p.globalCompositeOperation = "lighter";
    p.globalAlpha = 0.18;
    p.drawImage(bC as CanvasImageSource, 0, 0);
    p.globalAlpha = 1;
    p.globalCompositeOperation = "source-over";

    // The curved glass: warp the picture into a rounded, bulging screen.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(S.x, S.y, S.w, S.h, S.r);
    ctx.clip();
    ctx.fillStyle = mix(theme.bg, "#000000", 0.4);
    ctx.fillRect(S.x, S.y, S.w, S.h);
    barrel(ctx, pC, sw, sh, S.x, S.y, S.w, S.h, 0.06, 0.08, "crt", 64, 80);
    // Bloom, then dead-glass lift, edge falloff and the reflection.
    glow(ctx, bC as CanvasImageSource, "crt-bloom", S.x, S.y, S.w, S.h, 5, 2.4, 0.6, "screen");
    glow(ctx, bC as CanvasImageSource, "crt-halo", S.x, S.y, S.w, S.h, 14, 5, 0.5, "screen");
    ctx.fillStyle = rgba(mix(theme.bg, theme.accent2, 0.25), 0.05);
    ctx.globalCompositeOperation = "screen";
    ctx.fillRect(S.x, S.y, S.w, S.h);
    ctx.globalCompositeOperation = "source-over";
    const edge = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(S.w, S.h) * 0.3,
      w / 2,
      h / 2,
      Math.hypot(S.w, S.h) * 0.56,
    );
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(0,0,0,0.78)");
    ctx.fillStyle = edge;
    ctx.fillRect(S.x, S.y, S.w, S.h);
    const refl = ctx.createLinearGradient(S.x, S.y, S.x + S.w * 0.45, S.y + S.h * 0.6);
    refl.addColorStop(0, rgba(theme.ink, 0.07));
    refl.addColorStop(0.55, rgba(theme.ink, 0.02));
    refl.addColorStop(1, rgba(theme.ink, 0));
    ctx.fillStyle = refl;
    ctx.fillRect(S.x, S.y, S.w, S.h);
    ctx.restore();
    // The bezel's lip: a hairline highlight and a shadow where glass meets plastic.
    ctx.save();
    ctx.strokeStyle = rgba("#000000", 0.7);
    ctx.lineWidth = u * 0.008;
    ctx.beginPath();
    ctx.roundRect(S.x, S.y, S.w, S.h, S.r);
    ctx.stroke();
    ctx.strokeStyle = rgba(theme.ink, 0.1);
    ctx.lineWidth = Math.max(1, u * 0.0016);
    ctx.beginPath();
    ctx.roundRect(S.x - u * 0.005, S.y - u * 0.005, S.w + u * 0.01, S.h + u * 0.01, S.r * 1.05);
    ctx.stroke();
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.35);
    grain(ctx, w, h, t, 0.22);
    void hash;
  },
};
