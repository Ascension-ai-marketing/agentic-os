import { mix, rgba } from "../engine/color";
import { bake, fbm3, frameOf, grain, ground, hash, light, rng, TAU, vignette } from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, bokeh, cyc, glow, mottled, pfbm, tnoise, turn, vgrad } from "./_s7-helpers";

interface Scene {
  u: number;
  horizon: number;
  /** Cabin: left, base y, width, height; window centre. */
  hx: number;
  hy: number;
  hw: number;
  hh: number;
  wx: number;
  wy: number;
  chimX: number;
  chimY: number;
}

function scene(w: number, h: number): Scene {
  const { u, portrait } = frameOf(w, h);
  const horizon = h * (portrait ? 0.62 : 0.58);
  const hw = u * 0.12;
  const hh = u * 0.07;
  const hx = portrait ? w * 0.46 : w * 0.56;
  const hy = horizon + u * 0.075;
  return {
    u,
    horizon,
    hx,
    hy,
    hw,
    hh,
    wx: hx + hw * 0.3,
    wy: hy - hh * 0.45,
    chimX: hx + hw * 0.72,
    chimY: hy - hh - hw * 0.3,
  };
}

/** A conifer silhouette with spiky, drooping branches and snow resting on some of them. */
function pine(
  c: Ctx2D,
  x: number,
  base: number,
  H: number,
  dark: string,
  snow: string,
  seed: number,
  snowAlpha = 0.85,
) {
  const r = rng(seed);
  const levels = 16 + Math.floor(r() * 8);
  const maxW = H * (0.2 + r() * 0.06);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const branches: [number, number, number, number][] = [];
  const trunkTop = base - H * 0.07;
  for (let k = 0; k <= levels; k++) {
    const f = k / levels;
    const y = trunkTop - H * 0.93 * f;
    const wv = maxW * Math.pow(1 - f, 1.05) * (0.7 + 0.55 * r());
    const droop = H * 0.03 * (1 - f * 0.6);
    for (const side of [-1, 1]) {
      const tipX = x + side * wv;
      const tipY = y + droop;
      const notchX = x + side * wv * (0.25 + 0.15 * r());
      const notchY = y - H * 0.012;
      (side < 0 ? left : right).push([tipX, tipY], [notchX, notchY]);
      if (r() < 0.75 && f < 0.92) branches.push([notchX, notchY, tipX, tipY]);
    }
  }
  c.fillStyle = dark;
  c.fillRect(x - H * 0.01, base - H * 0.1, H * 0.02, H * 0.1);
  c.beginPath();
  c.moveTo(x, trunkTop);
  for (const [px, py] of left) c.lineTo(px, py);
  c.lineTo(x, base - H);
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
  c.fill();
  // Snow lying along the upper side of most branches.
  c.strokeStyle = rgba(snow, snowAlpha);
  c.lineCap = "round";
  c.lineWidth = Math.max(0.6, H * 0.013);
  c.beginPath();
  for (const [nx, ny, tx, ty] of branches) {
    c.moveTo(nx, ny - H * 0.004);
    c.quadraticCurveTo(
      (nx + tx) / 2,
      ny - H * 0.008,
      nx + (tx - nx) * 0.85,
      ny + (ty - ny) * 0.8 - H * 0.006,
    );
  }
  c.stroke();
}

/** Everything that never moves: sky, hills, treeline, cabin, snowfield. */
function landscape(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const g = scene(w, h);
    const { u } = g;
    mottled(c, w, h, theme.bg, theme.accent2, 0.04, 31, 0.015);
    vgrad(c, 0, 0, w, g.horizon, [
      [0, "#000000", 0.35],
      [0.6, theme.bg, 0],
      [1, mix(theme.bg, theme.accent2, 0.38), 0.95],
    ]);
    // A moon diffused behind thin snow cloud.
    const mx = w * (frameOf(w, h).portrait ? 0.3 : 0.2);
    const my = h * 0.16;
    light(c, mx, my, u * 0.9, theme.accent2, 0.2);
    light(c, mx, my, u * 0.18, mix(theme.ink, theme.accent2, 0.3), 0.22);
    c.fillStyle = rgba(mix(theme.ink, theme.accent2, 0.2), 0.3);
    c.beginPath();
    c.arc(mx, my, u * 0.035, 0, TAU);
    c.fill();
    // Two far ridges.
    const ridge = (y0: number, amp: number, col: string, seed: number, snowy: number) => {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(0, h);
      for (let x = 0; x <= w; x += Math.max(2, w / 240)) {
        const n = pfbm((x / w) * 3.2, 64, seed, 4);
        c.lineTo(x, y0 - amp * (0.5 + n));
      }
      c.lineTo(w, h);
      c.closePath();
      c.fill();
      if (snowy > 0) {
        c.save();
        c.clip();
        vgrad(c, 0, y0 - amp * 1.1, w, y0 + amp * 0.2, [
          [0, theme.ink, snowy],
          [1, theme.ink, 0],
        ]);
        c.restore();
      }
    };
    ridge(g.horizon - u * 0.05, u * 0.14, mix(theme.bg, theme.accent2, 0.32), 3, 0.06);
    ridge(g.horizon + u * 0.01, u * 0.08, mix(theme.bg, theme.accent2, 0.22), 7, 0.04);
    // Fog pooled along the valley floor.
    vgrad(c, 0, g.horizon - u * 0.12, w, g.horizon + u * 0.04, [
      [0, theme.accent2, 0],
      [0.7, mix(theme.accent2, theme.ink, 0.2), 0.22],
      [1, theme.accent2, 0.05],
    ]);
    // Far forest: small, hazy, dense.
    const r = rng(55);
    const hazy = mix(theme.bg, theme.accent2, 0.3);
    const hazySnow = mix(theme.accent2, theme.ink, 0.35);
    const far = Math.round(w / (u * 0.018));
    for (let i = 0; i < far; i++) {
      const x = (i + r()) * (w / far);
      const H = u * (0.05 + r() * 0.05);
      pine(c, x, g.horizon + u * (0.02 + r() * 0.015), H, hazy, hazySnow, 300 + i, 0.35);
    }
    // Near forest: larger and darker, parting around the cabin.
    const treeDark = mix(theme.bg, "#000000", 0.3);
    const treeSnow = mix(theme.ink, theme.accent2, 0.3);
    const count = Math.round(w / (u * 0.05));
    for (let i = 0; i < count; i++) {
      const x = (i + r()) * (w / count);
      if (Math.abs(x - (g.hx + g.hw / 2)) < g.hw * 1.1) continue;
      const H = u * (0.12 + r() * 0.12);
      pine(c, x, g.horizon + u * (0.05 + r() * 0.03), H, treeDark, treeSnow, 100 + i, 0.6);
    }
    // The snowfield.
    c.fillStyle = mix(theme.bg, mix(theme.accent2, theme.ink, 0.25), 0.42);
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w; x += Math.max(2, w / 200)) {
      const n = pfbm((x / w) * 2.2, 64, 13, 3);
      c.lineTo(x, g.horizon + u * 0.06 + n * u * 0.03);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fill();
    c.save();
    c.clip();
    vgrad(c, 0, g.horizon, w, h, [
      [0, theme.ink, 0.1],
      [0.5, theme.bg, 0.1],
      [1, "#000000", 0.35],
    ]);
    // Drifts: soft light and shadow undulations.
    const step = Math.max(3, Math.round(u / 120));
    for (let y = Math.floor(g.horizon); y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.25), (y - g.horizon) / (u * 0.07), 9.1, 3);
        c.fillStyle = n > 0 ? rgba(theme.ink, n * 0.14) : rgba("#000000", -n * 0.2);
        c.fillRect(x, y, step, step);
      }
    // Crystals glinting in the snow.
    const rs = rng(808);
    for (let i = 0; i < (w * (h - g.horizon)) / 900; i++) {
      const x = rs() * w;
      const y = g.horizon + u * 0.06 + rs() ** 1.6 * (h - g.horizon);
      c.fillStyle = rgba(theme.ink, 0.1 + rs() * 0.35);
      const d = Math.max(0.6, u * 0.0016 * (0.5 + (y - g.horizon) / (h - g.horizon)));
      c.fillRect(x, y, d, d);
    }
    c.restore();
    // Footprints leading up to the door, shrinking with distance.
    const doorX = g.hx + g.hw * 0.74;
    const startX = frameOf(w, h).portrait ? w * 0.36 : w * 0.34;
    c.fillStyle = rgba("#000000", 0.35);
    for (let k = 0; k < 26; k++) {
      const f = k / 25;
      const e = f * f;
      const y = h * 1.02 + (g.hy + g.hh * 0.05 - h * 1.02) * (1 - Math.pow(1 - f, 1.8));
      const x = startX + (doorX - startX) * f + Math.sin(f * 3.2) * u * 0.05 * (1 - f);
      const size = u * 0.016 * (1 - e * 0.8);
      const side = k % 2 === 0 ? -1 : 1;
      c.beginPath();
      c.ellipse(x + side * size * 0.9, y, size * 0.55, size * 0.28, 0, 0, TAU);
      c.fill();
    }
    // The cabin.
    const { hx, hy, hw, hh } = g;
    const wall = mix(theme.bg, "#000000", 0.35);
    c.fillStyle = wall;
    c.fillRect(hx, hy - hh, hw, hh);
    c.strokeStyle = rgba(mix(wall, theme.ink, 0.25), 0.35);
    c.lineWidth = Math.max(0.5, hh * 0.02);
    c.beginPath();
    for (let k = 1; k < 7; k++) {
      c.moveTo(hx, hy - hh + (hh * k) / 7);
      c.lineTo(hx + hw, hy - hh + (hh * k) / 7);
    }
    c.stroke();
    // Roof, heavy with snow.
    c.beginPath();
    c.moveTo(hx - hw * 0.1, hy - hh);
    c.lineTo(hx + hw * 0.5, hy - hh - hw * 0.36);
    c.lineTo(hx + hw * 1.1, hy - hh);
    c.closePath();
    c.fill();
    c.fillStyle = mix(theme.ink, theme.accent2, 0.2);
    c.beginPath();
    c.moveTo(hx - hw * 0.13, hy - hh + hw * 0.015);
    c.quadraticCurveTo(hx + hw * 0.2, hy - hh - hw * 0.2, hx + hw * 0.5, hy - hh - hw * 0.41);
    c.quadraticCurveTo(hx + hw * 0.8, hy - hh - hw * 0.2, hx + hw * 1.13, hy - hh + hw * 0.015);
    c.quadraticCurveTo(hx + hw * 0.5, hy - hh - hw * 0.25, hx - hw * 0.13, hy - hh + hw * 0.015);
    c.fill();
    // Chimney.
    c.fillStyle = wall;
    c.fillRect(g.chimX - hw * 0.05, g.chimY, hw * 0.1, hw * 0.3);
    c.fillStyle = mix(theme.ink, theme.accent2, 0.2);
    c.fillRect(g.chimX - hw * 0.065, g.chimY - hw * 0.025, hw * 0.13, hw * 0.035);
    // Door, and snow banked against the wall.
    c.fillStyle = mix(wall, "#000000", 0.3);
    c.fillRect(hx + hw * 0.66, hy - hh * 0.7, hw * 0.16, hh * 0.7);
    c.fillStyle = mix(theme.bg, mix(theme.accent2, theme.ink, 0.25), 0.5);
    c.beginPath();
    c.ellipse(hx + hw * 0.5, hy + hh * 0.02, hw * 0.75, hh * 0.14, 0, 0, TAU);
    c.fill();
    // Foreground pines framing the view, slightly out of focus.
    c.save();
    c.filter = `blur(${Math.max(0.5, u * 0.004).toFixed(1)}px)`;
    const fg = mix(theme.bg, "#000000", 0.55);
    const fgSnow = mix(theme.ink, theme.accent2, 0.45);
    pine(c, w * 0.03, h * 1.04, h * 0.95, fg, fgSnow, 901, 0.22);
    pine(c, w * 0.96, h * 1.06, h * 0.78, fg, fgSnow, 907, 0.22);
    c.restore();
  };
}

/** The lit window and the warm light it throws (static part). */
function windowLight(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const g = scene(w, h);
    const ww = g.hw * 0.24;
    const wh = g.hh * 0.36;
    light(c, g.wx, g.wy + g.hh * 0.9, g.u * 0.3, theme.accent, 0.38, "source-over");
    c.save();
    c.translate(g.wx, g.hy + g.hh * 0.9);
    c.scale(1, 0.28);
    light(c, 0, 0, g.u * 0.42, theme.accent, 0.5, "source-over");
    c.restore();
    const grad = c.createLinearGradient(0, g.wy - wh / 2, 0, g.wy + wh / 2);
    grad.addColorStop(0, mix(theme.accent, theme.ink, 0.5));
    grad.addColorStop(1, theme.accent);
    c.fillStyle = grad;
    c.fillRect(g.wx - ww / 2, g.wy - wh / 2, ww, wh);
    c.fillStyle = mix(theme.bg, "#000000", 0.35);
    c.fillRect(g.wx - ww * 0.04, g.wy - wh / 2, ww * 0.08, wh);
    c.fillRect(g.wx - ww / 2, g.wy - wh * 0.04, ww, wh * 0.08);
  };
}

export const style: MotionStyle = {
  id: "snowfall",
  name: "First Snow",
  family: "Nature",
  tagline: "Snow on a quiet cabin night",
  look: "A quiet winter night: snow-laden pines, a lone cabin with one warm window, snow drifting through three depths of air.",
  move: "Snow drifts down in three layers, near flakes soft and fast, far flakes fine and slow; smoke curls from the chimney; the window breathes.",
  rules: [
    "Three depths of snow: fine far flakes, mid flakes, soft out-of-focus near flakes.",
    "Flakes sway as they fall; none fall straight.",
    "The window is the only warm colour, and flakes passing it glow.",
    "Everything but the snow, smoke and window light is still.",
    "Pines carry snow on every tier; the cabin roof is heavy with it.",
    "Night is blue-black with a moon behind cloud; never pure black.",
  ],
  prompt: `R — References
• Winter night photography with a single lit cabin window (search: snowy cabin night window glow).
• Shin-hanga snow prints by Kawase Hasui for the quiet composition.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a snowy valley at night, pines on the ridge, one cabin window glowing warm; snow already falling.
• Middle (1.5–3.5 s): flakes drift through three depths, catching the window light as they pass; smoke curls up from the chimney.
• End (3.5–5 s): the snow keeps falling and every flake lands where the loop began.

S — Style
Looks: {{bg}} night sky with a moon diffused in {{accent2}} cloud; ridges and snowfield in cold {{accent2}}-tinted tones; pines near-black with {{ink}} snow on every tier; one {{accent}} window and its warm spill.
Moves: flakes fall a whole number of frame heights per loop (far 1, mid 1, near 2) with whole-cycle sways; smoke puffs rise on whole-loop lifetimes; the window breathes on a slow periodic noise.
Rules:
1. Three depths of snow.
2. Swaying fall, never straight.
3. One warm light: the window.
4. Still landscape, moving weather.
5. Blue-black night, never flat black.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; near flakes are soft discs, far flakes crisp points; flakes glow near the window; the smoke never jumps; the pines read as pines at tile size. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Kawase_Hasui",
  theme: {
    bg: "#070b13",
    ink: "#eaf1f8",
    accent: "#ffae55",
    accent2: "#5b7aa3",
    font: "Newsreader",
  },
  tags: [
    "snow",
    "winter",
    "night",
    "cabin",
    "christmas",
    "cosy",
    "quiet",
    "pine",
    "forest",
    "holiday",
    "nature",
  ],
  word: "Snow",
  render(ctx, t, theme, w, h) {
    const g = scene(w, h);
    const { u } = g;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `snow-land:${theme.bg}${theme.ink}${theme.accent2}`,
        w,
        h,
        landscape(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    // The window breathes.
    const breathe = 0.86 + 0.14 * (0.5 + 0.5 * tnoise(0.3, t, 4, 2));
    ctx.save();
    ctx.globalAlpha = breathe;
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(
      bake(
        `snow-window:${theme.bg}${theme.ink}${theme.accent}`,
        w,
        h,
        windowLight(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    ctx.restore();

    // Chimney smoke: soft puffs rising and leaning with the wind.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const puff = glow(mix(theme.accent2, theme.ink, 0.3), 0.4);
    for (let j = 0; j < 14; j++) {
      const q = cyc(t, 1, j / 14);
      const x = g.chimX + q * u * 0.1 + Math.sin(turn(t, 1, j * 0.37) + q * 3) * u * 0.012 * q;
      const y = g.chimY - q * u * 0.3;
      blit(ctx, puff, x, y, u * (0.03 + 0.09 * q), Math.sin(Math.PI * q) * 0.1);
    }
    ctx.restore();

    // Snow in three depths.
    const layers: [number, number, number, number][] = [
      // count, size (u), fall cycles per loop, alpha
      [260, 0.0035, 1, 0.55],
      [110, 0.009, 1, 0.8],
      [16, 0.045, 2, 0.35],
    ];
    const flake = glow(theme.ink, 0.35);
    const warm = glow(mix(theme.accent, theme.ink, 0.4), 0.3);
    const soft = bokeh(theme.ink, 0.25, 0.3);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    layers.forEach(([count, size, fall, alpha], L) => {
      for (let i = 0; i < count; i++) {
        const s = L * 1000 + i;
        const q = cyc(t, fall, hash(s, 1));
        const m = size * u * 2;
        const y = -m + (h + m * 2) * q;
        const sway =
          Math.sin(turn(t, 1 + Math.floor(hash(s, 3) * 2), hash(s, 4))) * u * (0.01 + L * 0.012);
        const x = hash(s, 2) * w + sway + q * u * 0.05 * (L + 1);
        const d = size * u * (0.6 + 0.8 * hash(s, 5));
        if (L === 2) {
          blit(ctx, soft, x, y, d, alpha * (0.6 + 0.4 * hash(s, 6)));
          continue;
        }
        // Flakes near the window pick up its warmth.
        const near = Math.hypot(x - g.wx, y - (g.wy + g.hh * 0.5)) / (u * 0.3);
        if (near < 1) blit(ctx, warm, x, y, d * 3.2, (1 - near) * alpha * breathe);
        if (L === 0) {
          ctx.globalAlpha = alpha * (0.5 + 0.5 * hash(s, 6));
          ctx.fillStyle = theme.ink;
          ctx.fillRect(x - d / 2, y - d / 2, d, d);
        } else blit(ctx, flake, x, y, d * 2.4, alpha * (0.6 + 0.4 * hash(s, 6)));
      }
    });
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
    void TAU;
  },
};
