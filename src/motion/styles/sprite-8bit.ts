import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  frameOf,
  fract,
  grain,
  ground,
  hash,
  LOOP,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { clean57, dots57, stepFrame, width57 } from "./_s4-helpers";

/** World pixels scrolled per loop (one level segment). */
const SEG = 240;
const SPEED = SEG / LOOP;
const RUN_FPS = 8;

// Palette keys: o outline, h helmet, w visor/white, c suit, d legs, s skin, g slime, e eye, y coin, k coin shade.
const HERO_TOP = [
  "......oooo......",
  "....oohhhhoo....",
  "...ohhhhhhhho...",
  "..ohhhhhhhwwho..",
  "..ohhhhhhwwwwo..",
  "..ohhhhhhwwwwo..",
  "...ohhhhhhhho...",
  "....oooooooo....",
  "...occccccccoo..",
  "..occcccccccsso.",
  "..osscccccccoo..",
  "...oocccccco....",
];
const LEGS = [
  ["....odddddo.....", "...oddo.oddo....", "..oddo...oddo...", "..ooo.....ooo..."],
  ["....odddddo.....", "....oddoddo.....", "....oddoddo.....", "....ooo.ooo....."],
  ["....odddddo.....", "....oddodddo....", "...oddo..oddo...", "...ooo...ooo...."],
  ["....odddddo.....", "....oddoddo.....", "....oddoddo.....", "....ooo.ooo....."],
];
const JUMP_LEGS = ["...odddddddo....", "..oddo...oddo...", "..ooo.....ooo...", "................"];

const SLIME = [
  "................",
  "................",
  "......oooo......",
  "....oogggggoo...",
  "...ogggggggggo..",
  "..ogggwwggwwggo.",
  "..ogggweggweggo.",
  ".oggggggggggggo.",
  ".ogggggggggggggo",
  ".ogggggggggggggo",
  "..ooooooooooooo.",
  "................",
];
const SLIME_SQUASH = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....oooooooo....",
  "..oogggwwgggoo..",
  ".ogggggggggggggo",
  ".ogggggggggggggo",
  "..ooooooooooooo.",
];
const COIN = [
  ["..oooo..", ".oyyyyo.", "oyywyyko", "oywyyyko", "oyyyyyko", "oyyyyyko", ".okkkko.", "..oooo.."],
  ["...oo...", "..oyyo..", ".oywyko.", ".oyyyko.", ".oyyyko.", ".oyyyko.", "..okko..", "...oo..."],
  ["...oo...", "...oyo..", "...oyo..", "...oyo..", "...oyo..", "...oyo..", "...oko..", "...oo..."],
  ["...oo...", "..oyyo..", ".oyywko.", ".oyyyko.", ".oyyyko.", ".oyyyko.", "..okko..", "...oo..."],
];
const BLOCK = [
  "oooooooooooooooo",
  "oyyyyyyyyyyyyyyo",
  "oykyyyyyyyyyykyo",
  "oyyyyyywwyyyyyyo",
  "oyyyyyywwyyyyyyo",
  "oyyyywwwwwwyyyyo",
  "oyyyyywwwwyyyyyo",
  "oyyyyyywwyyyyyyo",
  "oyyyyywyywyyyyyo",
  "oyyyyyyyyyyyyyyo",
  "oyyyyyyyyyyyyyyo",
  "oyyyyyyyyyyyyyyo",
  "oyyyyyyyyyyyyyyo",
  "oykyyyyyyyyyykyo",
  "okkkkkkkkkkkkkko",
  "oooooooooooooooo",
];
const USED = BLOCK.map((row, j) =>
  j === 0 || j === 15 ? row : row.replace(/w/g, "k").replace(/y/g, "k"),
);
const BRICK = [
  "bbbbbbbmbbbbbbbm",
  "lllllllmlllllllm",
  "bbbbbbbmbbbbbbbm",
  "bbbbbbbmbbbbbbbm",
  "bbbbbbbmbbbbbbbm",
  "bbbbbbbmbbbbbbbm",
  "bbbbbbbmbbbbbbbm",
  "mmmmmmmmmmmmmmmm",
  "bbbmbbbbbbbmbbbb",
  "lllmllllllllmlll",
  "bbbmbbbbbbbmbbbb",
  "bbbmbbbbbbbmbbbb",
  "bbbmbbbbbbbmbbbb",
  "bbbmbbbbbbbmbbbb",
  "bbbmbbbbbbbmbbbb",
  "mmmmmmmmmmmmmmmm",
];
const HEART = [".oo.oo.", "ohhohho", "ohhhhho", ".ohhho.", "..oho..", "...o..."];

function paletteOf(theme: Theme): Record<string, string> {
  return {
    o: mix(theme.bg, "#000000", 0.55),
    h: theme.accent2,
    w: theme.ink,
    c: theme.accent,
    d: mix(theme.bg, theme.ink, 0.35),
    s: mix(theme.ink, theme.accent, 0.3),
    g: mix(theme.accent2, theme.accent, 0.45),
    e: mix(theme.bg, "#000000", 0.55),
    y: theme.accent,
    k: mix(theme.accent, theme.bg, 0.45),
    b: mix(theme.accent, theme.bg, 0.55),
    m: mix(theme.bg, "#000000", 0.35),
    l: mix(theme.accent, theme.ink, 0.1),
  };
}

/** Bake a string-map sprite into a tiny canvas. */
function sprite(key: string, rows: string[], pal: Record<string, string>) {
  const W = rows[0].length;
  const H = rows.length;
  return bake(`sprite8:${key}:${pal.o}${pal.h}${pal.c}${pal.w}${pal.y}`, W, H, (c) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = rows[y][x];
        if (k === "." || !pal[k]) continue;
        c.fillStyle = pal[k];
        c.fillRect(x, y, 1, 1);
      }
  });
}

/** A periodic ridge (period p) for parallax layers: heights at integer x. */
function ridge(x: number, p: number, seed: number, amp: number, base: number): number {
  const u = (((x % p) + p) % p) / p;
  // Two peaks per period from a sum of whole-period sines: loops exactly.
  const v =
    0.55 * Math.sin(u * Math.PI * 2 + seed) +
    0.3 * Math.sin(u * Math.PI * 4 + seed * 2.3) +
    0.15 * Math.sin(u * Math.PI * 8 + seed * 0.7);
  return Math.round(base + amp * (0.5 + 0.5 * v));
}

interface Jump {
  t0: number;
  t1: number;
  h: number;
  /** Feet height at the end (0 = ground, > 0 = landing on something). */
  land0: number;
  land1: number;
}

export const style: MotionStyle = {
  id: "sprite-8bit",
  name: "8-Bit Platformer",
  family: "Retro Tech",
  tagline: "An NES night level",
  look: "An NES-style night level: chunky sprites, a hard-edged limited palette, parallax mountains, a star block and a slime.",
  move: "The hero runs on a four-frame cycle, bumps the star block for a coin, stomps a slime, and the level scrolls one segment a loop.",
  rules: [
    "Draw everything on a ~110-pixel-high grid and scale by whole numbers with nearest-neighbour.",
    "A limited palette: a dozen flat colours derived from the theme, black outlines, no gradients.",
    "Sprites are hand-placed string maps: 16×16 hero, 16×12 slime, 8×8 coin, 16×16 blocks.",
    "Animate on the grid: 8 fps run cycle, whole-pixel positions, parabolic jumps.",
    "Parallax layers loop exactly: each moves a whole number of its periods per loop.",
    "Game feel: the block bumps, the coin spins up, the slime squashes, a score pops.",
    "A HUD in the 5×7 pixel font; nothing smooth on screen.",
  ],
  prompt: `R — References
• NES / Famicom platformers: limited palettes, black outlines, tile-built levels, parallax night skies (search: NES night level pixel art, 8-bit platformer).
• Lospec palettes and pixel-art sprite sheets (16×16 heroes, 4-frame run cycles).

I — Idea
One level segment, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a little helmeted hero runs right across a brick path under a pixel moon, collecting a row of coins.
• Middle (1.5–3.5 s): it jumps and bumps a star block; a coin spins up out of it; the block goes dark.
• End (3.5–5 s): it stomps a slime (squash, poof, +100) and runs on; the level has scrolled exactly one segment, so the next block and slime are where the first ones were.

S — Style
Looks: {{bg}} night sky in flat bands with pixel stars and a moon; mountains and hills in dark tints of {{accent2}}; bricks and coins in {{accent}}; the hero in {{accent2}} and {{accent}} with {{ink}} highlights; "{{name}}" in a 5×7 pixel font as the player name.
Moves: 8 fps run cycle, 48 px/s scroll, parallax at ¼ and ½ speed, jumps on parabolas, block bump 3 px, coin rises and spins at 12 fps.
Rules:
1. One pixel grid, whole-number scaling, no smoothing.
2. Flat limited palette with outlines.
3. String-map sprites.
4. Whole-pixel motion, looping parallax.
5. Clear game feedback on every event.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; every edge is a hard pixel edge; the hero's head meets the block at the jump's apex; the used block stays used until it scrolls off; no sprite is cut by the HUD. Fix what fails and render again until every check passes.`,
  ref: "https://lospec.com/palette-list/nintendo-entertainment-system",
  theme: {
    bg: "#100d2e",
    ink: "#fcfcfc",
    accent: "#f8b800",
    accent2: "#3cbcfc",
    font: "Inter",
  },
  tags: [
    "8-bit",
    "8bit",
    "pixel",
    "game",
    "nes",
    "retro",
    "platformer",
    "sprite",
    "arcade",
    "chiptune",
    "mario",
    "gaming",
  ],
  word: "PLAYER 1",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const P = Math.max(2, Math.round(u / 110));
    const LW = Math.ceil(w / P);
    const LH = Math.ceil(h / P);
    const pal = paletteOf(theme);
    const { canvas: lowC, ctx: g } = buffer("sprite8-low", LW, LH);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    // Portrait lifts the ground so the action sits mid-frame, bricks below it.
    const groundY = h > w * 1.2 ? Math.round(LH * 0.66) : LH - 18;
    // Sky: flat bands with a checker seam between them (no gradients on the NES).
    const bands = [
      theme.bg,
      mix(theme.bg, theme.accent2, 0.12),
      mix(theme.bg, theme.accent2, 0.24),
      mix(theme.bg, theme.accent2, 0.38),
    ];
    const bandH = Math.ceil((groundY - 10) / bands.length);
    bands.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(0, i * bandH, LW, bandH + 1);
      if (i > 0) {
        g.fillStyle = bands[i - 1];
        for (let x = 0; x < LW; x += 2) g.fillRect(x, i * bandH, 1, 1);
        for (let x = 1; x < LW; x += 2) g.fillRect(x, i * bandH + 1, 1, 1);
      }
    });
    g.fillStyle = bands[bands.length - 1];
    g.fillRect(0, bands.length * bandH, LW, LH);

    // Stars: single pixels, a few twinkling crosses.
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash(i, 1) * LW);
      const y = Math.floor(hash(i, 2) * (groundY * 0.55));
      const on = fract(t / (LOOP / 10) + hash(i, 3)) < 0.8;
      g.fillStyle = on ? theme.ink : bands[1];
      g.fillRect(x, y, 1, 1);
      if (i % 7 === 0 && on) {
        g.fillStyle = mix(theme.ink, theme.accent2, 0.4);
        g.fillRect(x - 1, y, 1, 1);
        g.fillRect(x + 1, y, 1, 1);
        g.fillRect(x, y - 1, 1, 1);
        g.fillRect(x, y + 1, 1, 1);
      }
    }
    // Moon.
    const mx = Math.round(LW * 0.78);
    const my = Math.round(groundY * 0.24);
    const mr = 9;
    for (let y = -mr; y <= mr; y++)
      for (let x = -mr; x <= mr; x++) {
        const r = Math.hypot(x, y);
        if (r > mr + 0.3) continue;
        const crater =
          Math.hypot(x + 3, y - 2) < 2.2 ||
          Math.hypot(x - 3, y + 4) < 1.6 ||
          Math.hypot(x - 2, y - 4) < 1.2;
        g.fillStyle = crater
          ? mix(theme.ink, theme.accent2, 0.35)
          : r > mr - 1.2
            ? mix(theme.ink, theme.accent2, 0.2)
            : theme.ink;
        g.fillRect(mx + x, my + y, 1, 1);
      }

    const scroll = Math.round((t / LOOP) * SEG);
    // Far mountains (¼ speed, period 60) with snow caps.
    const farShift = Math.round((t / LOOP) * 60);
    const farC = mix(theme.bg, theme.accent2, 0.45);
    for (let x = 0; x < LW; x++) {
      const top = groundY - ridge(x + farShift, 60, 1.3, 26, 8);
      g.fillStyle = farC;
      g.fillRect(x, top, 1, groundY - top);
      g.fillStyle = mix(theme.ink, theme.accent2, 0.25);
      const cap = ridge(x + farShift, 60, 1.3, 26, 8) > 26 ? 2 : 0;
      if (cap) g.fillRect(x, top, 1, cap);
    }
    // Clouds (period 80, 80 px a loop).
    const cloudShift = Math.round((t / LOOP) * 80);
    for (let k = -1; k < LW / 80 + 1; k++) {
      const cx = k * 80 - (cloudShift % 80) + 30;
      const cy = Math.round(groundY * 0.42);
      for (const [dx, dy, r] of [
        [0, 0, 5],
        [6, -2, 6],
        [13, 0, 5],
        [7, 2, 5],
      ]) {
        g.fillStyle = mix(theme.bg, theme.ink, 0.35);
        for (let y = -r; y <= r; y++)
          for (let x = -r; x <= r; x++)
            if (x * x + y * y <= r * r && y <= 2) g.fillRect(cx + dx + x, cy + dy + y, 1, 1);
      }
    }
    // Hills (½ speed, period 120) with little pines.
    const hillShift = Math.round((t / LOOP) * 120);
    const hillC = mix(theme.bg, theme.accent2, 0.22);
    for (let x = 0; x < LW; x++) {
      const top = groundY - ridge(x + hillShift, 120, 4.1, 14, 3);
      g.fillStyle = hillC;
      g.fillRect(x, top, 1, groundY - top);
      g.fillStyle = mix(hillC, theme.ink, 0.12);
      g.fillRect(x, top, 1, 1);
    }
    for (let k = -1; k < LW / 40 + 2; k++) {
      const wx = k * 40 + 17;
      const x = wx - (hillShift % 40);
      const base = groundY - ridge(wx + hillShift - (hillShift % 40), 120, 4.1, 14, 3) + 1;
      g.fillStyle = mix(theme.bg, theme.accent2, 0.1);
      for (let j = 0; j < 9; j++) {
        const half = Math.floor(j / 2.2);
        g.fillRect(x - half, base - 9 + j, half * 2 + 1, 1);
      }
    }

    // Ground: brick tiles, scrolling at full speed.
    const brick = sprite("brick", BRICK, pal);
    for (let x = -(scroll % 16) - 16; x < LW + 16; x += 16) {
      for (let y = groundY; y < LH; y += 16) g.drawImage(brick as CanvasImageSource, x, y);
    }
    g.fillStyle = mix(theme.accent, theme.ink, 0.35);
    g.fillRect(0, groundY, LW, 1);

    // Level objects live at "time of contact": world x = heroX + SPEED * tEvent.
    const heroX = Math.round(LW * 0.3) - 8;
    const HIT = 1.9;
    const STOMP = 3.62;
    const blockY = groundY - 16 - 30;
    const coinRow = [0.55, 0.75, 0.95];
    for (let segN = -1; segN <= 2; segN++) {
      const age = t - segN * LOOP; // time since this segment's events started
      const off = (tEv: number) => heroX + Math.round(SPEED * tEv) + segN * SEG - scroll;
      // Coins on the path, collected as the hero runs through them.
      coinRow.forEach((tc, i) => {
        const x = off(tc) + 4;
        if (age >= tc) {
          // Sparkle for a moment after pickup.
          const k = age - tc;
          if (k < 0.25) {
            g.fillStyle = theme.ink;
            const r = 2 + Math.floor(k * 16);
            g.fillRect(x + 3 - r, groundY - 12, 1, 1);
            g.fillRect(x + 4 + r, groundY - 12, 1, 1);
            g.fillRect(x + 3, groundY - 12 - r, 1, 1);
            g.fillRect(x + 3, groundY - 12 + r, 1, 1);
          }
          return;
        }
        const f = stepFrame(t + i * 0.1, 8) % 4;
        g.drawImage(sprite(`coin${f}`, COIN[f], pal) as CanvasImageSource, x, groundY - 16);
      });
      // The star block and its coin.
      const bx = off(HIT);
      const bump =
        age >= HIT && age < HIT + 0.16
          ? Math.round(3 * Math.sin(((age - HIT) / 0.16) * Math.PI))
          : 0;
      g.drawImage(
        sprite(age >= HIT ? "used" : "block", age >= HIT ? USED : BLOCK, pal) as CanvasImageSource,
        bx,
        blockY - bump,
      );
      if (age >= HIT && age < HIT + 0.7) {
        const k = (age - HIT) / 0.7;
        const cy = blockY - 9 - Math.round(16 * Math.sin(k * Math.PI * 0.85));
        const f = stepFrame(age * 1.5, 12) % 4;
        g.drawImage(sprite(`coin${f}`, COIN[f], pal) as CanvasImageSource, bx + 4, cy);
      }
      // The slime: patrols in place until stomped, then squashes and poofs.
      const sx = off(STOMP) + 1;
      if (age < STOMP) {
        const hop = stepFrame(t, 4) % 2;
        g.drawImage(sprite("slime", SLIME, pal) as CanvasImageSource, sx, groundY - 12 - hop);
      } else if (age < STOMP + 0.18) {
        g.drawImage(sprite("squash", SLIME_SQUASH, pal) as CanvasImageSource, sx, groundY - 12);
      } else if (age < STOMP + 0.5) {
        const k = (age - STOMP - 0.18) / 0.32;
        g.fillStyle = mix(theme.ink, theme.bg, 0.3 + k * 0.5);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const r = 3 + k * 9;
          g.fillRect(
            sx + 8 + Math.round(Math.cos(a) * r),
            groundY - 6 + Math.round(Math.sin(a) * r * 0.6),
            2,
            2,
          );
        }
        // +100
        g.fillStyle = theme.ink;
        dots57("100", (x, y) => g.fillRect(sx + x, groundY - 30 - Math.round(k * 8) + y, 1, 1));
      }
    }

    // The hero.
    const jumps: Jump[] = [
      { t0: HIT - 0.36, t1: HIT + 0.36, h: 18, land0: 0, land1: 0 },
      { t0: STOMP - 0.32, t1: STOMP, h: 16, land0: 0, land1: 10 },
      { t0: STOMP, t1: STOMP + 0.5, h: 14, land0: 10, land1: 0 },
    ];
    let lift = 0;
    let airborne = false;
    for (const j of jumps) {
      if (t >= j.t0 && t < j.t1) {
        const s = (t - j.t0) / (j.t1 - j.t0);
        const apex = Math.max(j.land0, j.land1) + j.h;
        // Rise to the apex and fall to the landing height on one parabola-like path.
        const up = apex - j.land0;
        const down = apex - j.land1;
        const sa = Math.sqrt(up) / (Math.sqrt(up) + Math.sqrt(down));
        lift =
          s < sa
            ? j.land0 + up * (1 - ((sa - s) / sa) ** 2)
            : j.land1 + down * (1 - ((s - sa) / (1 - sa)) ** 2);
        airborne = true;
      }
    }
    // First jump: the head meets the block's underside at the apex.
    if (t >= jumps[0].t0 && t < jumps[0].t1) {
      const s = (t - jumps[0].t0) / (jumps[0].t1 - jumps[0].t0);
      lift = (groundY - (blockY + 16) - 16 + 0) * (1 - (2 * s - 1) ** 2);
    }
    const feet = groundY - Math.round(lift);
    const top = sprite("hero-top", HERO_TOP, pal);
    const legs = airborne ? JUMP_LEGS : LEGS[stepFrame(t, RUN_FPS) % 4];
    const bob = !airborne && stepFrame(t, RUN_FPS) % 2 === 1 ? 1 : 0;
    const legC = sprite(airborne ? "legs-j" : `legs${stepFrame(t, RUN_FPS) % 4}`, legs, pal);
    g.drawImage(top as CanvasImageSource, heroX, feet - 16 + bob);
    g.drawImage(legC as CanvasImageSource, heroX, feet - 4);

    // HUD: player name, hearts, and a static score, in the 5×7 font.
    const name = clean57(wordFor(theme.name, "PLAYER 1", 10)).trim() || "PLAYER 1";
    g.fillStyle = theme.ink;
    dots57(name, (x, y) => g.fillRect(6 + x, 5 + y, 1, 1));
    const heart = sprite("heart", HEART, { ...pal, h: theme.accent });
    for (let i = 0; i < 3; i++)
      g.drawImage(heart as CanvasImageSource, LW - 6 - 7 * 3 - 2 * 2 + i * 9, 5);
    const score = "004200";
    g.fillStyle = mix(theme.ink, theme.accent2, 0.3);
    const scoreX = Math.round(LW / 2 - width57(score) / 2);
    if (scoreX > 6 + width57(name) + 14)
      dots57(score, (x, y) => g.fillRect(scoreX + x, 5 + y, 1, 1));
    const mark = tintedLogo(theme, theme.ink, 7, 7);
    if (mark) g.drawImage(mark as CanvasImageSource, 6 + width57(name) + 4, 5);

    // Blow it up: whole pixels, no smoothing.
    ground(ctx, w, h, theme.bg);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lowC as CanvasImageSource, 0, 0, LW * P, LH * P);
    ctx.imageSmoothingEnabled = true;
    vignette(ctx, w, h, "#000000", 0.35);
    grain(ctx, w, h, t, 0.16);
    void clamp;
    void rgba;
  },
};
