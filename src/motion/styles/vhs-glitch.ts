import { mix, rgba } from "../engine/color";
import {
  buffer,
  clamp,
  ease,
  font,
  frameOf,
  fract,
  grain,
  ground,
  hash,
  lerp,
  LOOP,
  noise3,
  seg,
  smoothstep,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { clean57, dots57, snowTile, stepFrame, width57 } from "./_s4-helpers";

const OSD = '"VT323", "Courier New", monospace';
/** PLAY runs from 4.5 s through the loop point to 3.25 s; REW rewinds in between (1.25 s, readable). */
const REW_AT = 3.25;
const PLAY_AT = 4.5;
const PLAY_LEN = LOOP - (PLAY_AT - REW_AT);

/** Seconds of tape played since PLAY was pressed (runs backwards while rewinding). */
function playClock(t: number): number {
  if (t >= PLAY_AT) return t - PLAY_AT;
  if (t <= REW_AT) return t + (LOOP - PLAY_AT);
  return lerp(PLAY_LEN, 0, ease.inOutSine(seg(t, REW_AT, PLAY_AT)));
}

/** The home-video picture: a beach at sunset with a camcorder title burned in. */
function picture(c: Ctx2D, theme: Theme, W: number, H: number, p: number, word: string) {
  const { portrait } = frameOf(W, H);
  const horizon = H * (portrait ? 0.58 : 0.62);
  // Sky: dusk overhead, the accent in the middle, hot near the sun.
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, mix(theme.bg, theme.accent2, 0.42));
  sky.addColorStop(0.2, mix(theme.bg, theme.accent2, 0.3));
  sky.addColorStop(0.5, mix(theme.bg, theme.accent, 0.55));
  sky.addColorStop(0.85, mix(theme.accent, theme.ink, 0.45));
  sky.addColorStop(1, mix(theme.ink, theme.accent, 0.25));
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon);
  // Sun, sitting on the horizon, with a wide bloom.
  const sx = W * (portrait ? 0.5 : 0.64);
  const sr = Math.min(W, H) * 0.09;
  const bloom = c.createRadialGradient(sx, horizon - sr * 0.4, 0, sx, horizon - sr * 0.4, sr * 6);
  bloom.addColorStop(0, rgba(theme.ink, 0.55));
  bloom.addColorStop(0.25, rgba(mix(theme.ink, theme.accent, 0.4), 0.25));
  bloom.addColorStop(1, rgba(theme.accent, 0));
  c.fillStyle = bloom;
  c.fillRect(0, 0, W, horizon);
  c.fillStyle = mix(theme.ink, theme.accent, 0.12);
  c.beginPath();
  c.arc(sx, horizon - sr * 0.35, sr, Math.PI, 0);
  c.lineTo(sx + sr, horizon);
  c.lineTo(sx - sr, horizon);
  c.fill();
  // Sea: dark water with the sun's glitter path.
  const sea = c.createLinearGradient(0, horizon, 0, H);
  sea.addColorStop(0, mix(theme.bg, theme.accent, 0.35));
  sea.addColorStop(1, mix(theme.bg, "#000000", 0.2));
  c.fillStyle = sea;
  c.fillRect(0, horizon, W, H - horizon);
  for (let i = 0; i < 46; i++) {
    const y = horizon + (H - horizon) * Math.pow((i + 0.5) / 46, 1.6);
    const spread = sr * (0.8 + 5 * ((y - horizon) / (H - horizon)));
    const shimmer = noise3(i * 0.7, p * 1.6, 0.3);
    const len = spread * (0.25 + 0.5 * Math.abs(shimmer));
    const x = sx + shimmer * spread * 0.9;
    c.fillStyle = rgba(mix(theme.ink, theme.accent, 0.3), 0.35 + 0.4 * (1 - i / 46));
    c.fillRect(x - len / 2, y, len, Math.max(1, H * 0.004));
  }
  // A small boat drifting along the horizon (it sails backwards on rewind).
  const bx = W * (0.2 + 0.035 * p);
  const bs = Math.min(W, H) * 0.03;
  c.fillStyle = mix(theme.bg, "#000000", 0.35);
  c.beginPath();
  c.moveTo(bx - bs, horizon - bs * 0.1);
  c.lineTo(bx + bs, horizon - bs * 0.1);
  c.lineTo(bx + bs * 0.7, horizon + bs * 0.25);
  c.lineTo(bx - bs * 0.7, horizon + bs * 0.25);
  c.fill();
  c.beginPath();
  c.moveTo(bx - bs * 0.05, horizon - bs * 0.15);
  c.lineTo(bx - bs * 0.05, horizon - bs * 1.9);
  c.lineTo(bx + bs * 0.75, horizon - bs * 0.25);
  c.fill();
  // The camcorder's title generator: chunky pixel letters, white with a black edge.
  const title = clean57(word).trim() || "SUMMER";
  const cols = width57(title);
  const px = Math.max(
    1,
    Math.floor(Math.min((W * 0.72) / cols, (H * (portrait ? 0.09 : 0.14)) / 7)),
  );
  const tx = Math.round((W - cols * px) / 2);
  const ty = Math.round(H * (portrait ? 0.24 : 0.2));
  c.fillStyle = "#000000";
  const edge = Math.max(1, Math.round(px * 0.3));
  dots57(title, (x, y) =>
    c.fillRect(tx + x * px - edge, ty + y * px - edge, px + edge * 2, px + edge * 2),
  );
  c.fillStyle = theme.ink;
  dots57(title, (x, y) => c.fillRect(tx + x * px, ty + y * px, px, px));
  // Burned-in date stamp, bottom left.
  const ds = Math.max(8, H * (portrait ? 0.034 : 0.05));
  c.font = font(400, ds, "VT323", OSD);
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  const sec = 7 + Math.floor(p + 1e-6);
  const stamp = [`SEP 24 1994`, `PM 7:42:${String(sec).padStart(2, "0")}`];
  stamp.forEach((line, i) => {
    const y = H * 0.9 - (1 - i) * ds * 1.05;
    c.fillStyle = "#000000";
    c.fillText(line, W * 0.07 + ds * 0.08, y + ds * 0.08);
    c.fillStyle = mix(theme.ink, theme.accent2, 0.1);
    c.fillText(line, W * 0.07, y);
  });
}

export const style: MotionStyle = {
  id: "vhs-glitch",
  name: "VHS Home Video",
  family: "Retro Tech",
  tagline: "A worn VHS tape of the beach",
  look: "A worn VHS tape of a sunset beach: a camcorder title and date stamp, chroma bleeding sideways, tracking noise, head-switch hash.",
  move: "It plays, a tracking band rolls up through the picture, the deck rewinds with noise bars, then presses play again.",
  rules: [
    "Luma soft, chroma softer: colour smears sideways and lags a few pixels behind the picture.",
    "Rows wobble a little all the time; the tracking band tears them hard.",
    "Head-switching hash lives in the bottom few lines, always.",
    "Dropouts are short white horizontal streaks, a few per frame.",
    "The VCR's on-screen display is crisp; the camcorder's date stamp is burned in and degrades.",
    "The rewind is diegetic: the picture and the stamp run backwards, so the loop closes.",
    "Grain, interlace and a vignette; never a clean frame.",
  ],
  prompt: `R — References
• Home video on VHS: camcorder title generators, burned-in date stamps (search: VHS home video sunset, camcorder date stamp 1994).
• VHS artefacts: chroma bleed, tracking errors, head-switching noise at the bottom, dropouts, rewind noise bars.

I — Idea
One tape, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): "▶ PLAY" shows; a sunset beach with the title "{{name}}" in chunky camcorder letters and a date stamp.
• Middle (1.5–3.25 s): a tracking band rolls up through the picture and tears the rows as it passes.
• End (3.25–5 s): "◀◀ REW": noise bars roll, the picture and the stamp run backwards to the start, and "▶ PLAY" returns.

S — Style
Looks: a dusk sky from {{accent2}} through {{accent}} to a hot sun, dark water with a glitter path, a small boat; title letters in {{ink}} with a black edge; VCR on-screen text in VT323 {{ink}}; chroma smeared sideways; a {{bg}} vignette, grain and faint interlace.
Moves: constant small row wobble; one tracking roll (0.9 s); rewind with two noise bars and a vertical roll; the play clock runs backwards during REW so the stamp's seconds return.
Rules:
1. Chroma: low-res colour, shifted a few pixels right, blended over sharper luma.
2. Row displacement from noise, strong inside the tracking band.
3. Head-switch hash in the bottom 3% of lines.
4. OSD crisp; date stamp burned in.
5. The rewind returns the picture to its first frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the title reads at thumbnail size; colour visibly bleeds past edges; the OSD stays crisp while the picture degrades; the stamp's seconds match the play clock. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/VHS",
  theme: {
    bg: "#0c0a14",
    ink: "#fbf4e9",
    accent: "#ff4f7b",
    accent2: "#3fd2ff",
    font: "VT323",
  },
  fonts: ["VT323"],
  tags: [
    "vhs",
    "tape",
    "glitch",
    "vcr",
    "home video",
    "camcorder",
    "90s",
    "80s",
    "analog",
    "retro",
    "noise",
    "tracking",
  ],
  word: "SUMMER",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    const p = playClock(t);
    const rew = t > REW_AT && t < PLAY_AT;
    const frame = stepFrame(t, 30);
    const word = wordFor(theme.name, "SUMMER", 12);

    // The recorded picture, at half resolution: VHS luma is soft.
    const PW = Math.max(64, Math.round(w / 2));
    const PH = Math.max(36, Math.round(h / 2));
    const { canvas: picC, ctx: pic } = buffer("vhs-pic", PW, PH);
    pic.globalCompositeOperation = "source-over";
    picture(pic, theme, PW, PH, p, word);
    // Colour at a sixteenth of the width: the smear.
    const CW = Math.max(8, Math.round(w / 16));
    const { canvas: chC, ctx: ch } = buffer("vhs-chroma", CW, PH);
    ch.imageSmoothingEnabled = true;
    ch.clearRect(0, 0, CW, PH);
    ch.drawImage(picC as CanvasImageSource, 0, 0, CW, PH);

    // Tracking: a band that rolls up once while playing; two noise bars while rewinding.
    const roll = seg(t, 1.9, 2.95);
    const bandH = h * 0.12;
    const bands: { y: number; k: number }[] = [];
    if (roll > 0 && roll < 1)
      bands.push({ y: lerp(h + bandH, -bandH, ease.inOutSine(roll)), k: Math.sin(roll * Math.PI) });
    if (rew) {
      const e = Math.sin(seg(t, REW_AT, PLAY_AT) * Math.PI);
      for (let i = 0; i < 2; i++)
        bands.push({ y: fract(t * 1.3 + i * 0.5) * (h + bandH * 2) - bandH, k: 0.4 + 0.6 * e });
    }
    const settle = t >= PLAY_AT ? 1 - ease.outCubic(seg(t, PLAY_AT, PLAY_AT + 0.45)) : 0;
    const rollY = rew
      ? fract(seg(t, REW_AT, PLAY_AT) * 2) * h * 0.06 * Math.sin(seg(t, REW_AT, PLAY_AT) * Math.PI)
      : 0;

    // Rows: draw the picture strip by strip, each shifted by its own wobble.
    const rows = Math.max(60, Math.round(h / 4));
    const rh = h / rows;
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < rows; i++) {
      const y = i * rh;
      let dx = noise3(i * 0.09, frame * 0.37, 1.7) * u * 0.0035;
      dx += Math.sin(TAU * (y / h) * 2 + t * 9) * u * 0.0012 * settle * 4;
      for (const b of bands) {
        const d = Math.abs(y - b.y) / (bandH / 2);
        if (d < 1.6) {
          const tear = (1 - smoothstep(0, 1.6, d)) * b.k;
          dx += (hash(i, frame, 7) - 0.3) * u * 0.07 * tear;
        }
      }
      // Head-switching: the last few lines slide right.
      const foot = smoothstep(h * 0.965, h, y + rh);
      dx += foot * u * (0.03 + 0.02 * hash(i, frame, 3));
      const sy = ((((y - rollY) / h) % 1) + 1) % 1;
      ctx.drawImage(picC as CanvasImageSource, 0, sy * PH, PW, PH / rows, dx, y, w, rh + 0.6);
    }
    // Ringing: a faint ghost of every edge trails to the right.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.14;
    ctx.drawImage(picC as CanvasImageSource, u * 0.014, 0, w, h);
    ctx.restore();
    // Chroma: soft colour laid over the sharper luma, a few pixels late.
    ctx.save();
    ctx.globalCompositeOperation = "color";
    ctx.globalAlpha = 0.9;
    ctx.drawImage(chC as CanvasImageSource, u * 0.012, 0, w, h);
    ctx.restore();

    // Noise: snow and streaks in the bands, hash at the bottom, dropouts anywhere.
    const snow = snowTile(frame) as CanvasImageSource;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const b of bands) {
      ctx.globalAlpha = 0.55 * b.k;
      ctx.drawImage(snow, hash(frame, 1) * 100, 0, 128, 40, 0, b.y - bandH * 0.35, w, bandH * 0.7);
    }
    ctx.globalAlpha = 0.6;
    ctx.drawImage(snow, 0, hash(frame, 2) * 60, 256, 10, 0, h * 0.968, w, h * 0.035);
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(theme.ink, 0.85);
    const drops = 4 + Math.floor(hash(frame, 9) * 5) + bands.length * 12;
    for (let i = 0; i < drops; i++) {
      const inBand = i >= 4 + Math.floor(hash(frame, 9) * 5) && bands.length > 0;
      const b = inBand ? bands[i % bands.length] : null;
      const y = b ? b.y + (hash(i, frame, 21) - 0.5) * bandH * 0.8 : hash(i, frame, 11) * h;
      const x = hash(i, frame, 13) * w;
      ctx.globalAlpha = 0.35 + 0.5 * hash(i, frame, 17);
      ctx.fillRect(x, y, u * (0.01 + 0.05 * hash(i, frame, 19)), Math.max(1, u * 0.0018));
    }
    ctx.restore();

    // Interlace: faint alternate lines.
    ctx.fillStyle = rgba("#000000", 0.14);
    const il = Math.max(2, Math.round(h / 270));
    for (let y = frame % 2; y < h; y += il * 2) ctx.fillRect(0, y, w, il * 0.5);

    // The VCR's on-screen display: crisp, drawn after the tape.
    const osd = Math.max(10, u * 0.062);
    ctx.font = font(400, osd, "VT323", OSD);
    ctx.textBaseline = "alphabetic";
    const ox = w * 0.07;
    const oy = h * 0.1 + osd * 0.8;
    const showPlay = t >= PLAY_AT || t < 1.3;
    const label = rew ? "REW" : "PLAY";
    const glyphW = osd * 0.62;
    const drawOsd = (color: string, dx: number, dy: number) => {
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      if (rew || showPlay) {
        const x = ox + dx;
        const y = oy + dy;
        ctx.beginPath();
        if (rew) {
          for (let k = 0; k < 2; k++) {
            ctx.moveTo(x + glyphW * (0.55 + k * 0.55), y - osd * 0.62);
            ctx.lineTo(x + glyphW * (0.55 + k * 0.55), y - osd * 0.06);
            ctx.lineTo(x + glyphW * (0.05 + k * 0.55), y - osd * 0.34);
          }
        } else {
          ctx.moveTo(x + glyphW * 0.1, y - osd * 0.62);
          ctx.lineTo(x + glyphW * 0.1, y - osd * 0.06);
          ctx.lineTo(x + glyphW * 0.75, y - osd * 0.34);
        }
        ctx.fill();
        ctx.fillText(label, x + glyphW * (rew ? 1.5 : 1.1), y);
      }
      ctx.textAlign = "right";
      ctx.fillText("SP", w - ox + dx, oy + dy);
    };
    drawOsd("rgba(0,0,0,0.75)", osd * 0.06, osd * 0.06);
    drawOsd(theme.ink, 0, 0);
    // A dropped logo rides in the OSD corner like a channel bug.
    const mark = tintedLogo(theme, rgba(theme.ink, 0.85), osd * 1.1, osd * 1.1);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w - ox - osd * 2.6, oy - osd * 0.9);
    ctx.textAlign = "left";

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.38);
    void clamp;
  },
};
