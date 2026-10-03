import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  frameOf,
  grain,
  ground,
  light,
  LOOP,
  noise3,
  rng,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

type Screen = {
  angle: number;
  color: string;
  tone: (x: number, y: number) => number;
  pitch: number;
  dx: number;
  dy: number;
};

/** One halftone screen: a rotated grid of dots whose area follows the tone. */
function screen(
  c: Ctx2D,
  w: number,
  h: number,
  s: Screen,
  bounds: [number, number, number, number],
) {
  const [bx0, by0, bx1, by1] = bounds;
  const cos = Math.cos(s.angle);
  const sin = Math.sin(s.angle);
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2 + s.pitch;
  const n = Math.ceil(reach / s.pitch);
  c.fillStyle = s.color;
  c.beginPath();
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const gx = i * s.pitch;
      const gy = j * s.pitch;
      const x = cx + gx * cos - gy * sin + s.dx;
      const y = cy + gx * sin + gy * cos + s.dy;
      if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
      const tone = s.tone(x, y);
      if (tone <= 0.02) continue;
      const r = s.pitch * 0.56 * Math.sqrt(clamp(tone));
      c.moveTo(x + r, y);
      c.arc(x, y, r, 0, TAU);
    }
  }
  c.fill();
}

function stock(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const r = rng(404);
    for (let i = 0; i < (w * h) / 600; i++) {
      c.fillStyle = rgba(theme.ink, 0.02 + r() * 0.035);
      c.fillRect(r() * w, r() * h, u * 0.0018, u * 0.0018);
    }
  };
}

export const style: MotionStyle = {
  id: "halftone-print",
  name: "Halftone Print",
  look: "A moon printed in three halftone screens on black stock: warm dots on the lit side, cool dots in the shadow.",
  move: "The light swings across the sphere so the terminator sweeps, craters turn with the moon, dots swell and shrink.",
  rules: [
    "All tone is dot size on a fixed grid; no smooth shading anywhere.",
    "Three screens at classic angles: 45°, 15° and 75°.",
    "Dot area, not radius, follows the tone (radius ∝ √tone).",
    "Warm ink on the lit side, cool ink in the shadows.",
    "Screens sit a hair out of register.",
    "The light moves, the grid never does.",
    "Paper grain and a soft vignette on the stock.",
  ],
  prompt: `R — References
• Halftone printing: rosette patterns, screen angles, Ben-Day dots (search: halftone moon print, CMYK halftone rosette).
• Vintage astronomy plates and pop-art print textures.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a full moon printed in dots; the light starts swinging to one side.
• Middle (1.5–3.5 s): the terminator sweeps across into a crescent while craters turn with the moon; shadow dots shift from warm to cool.
• End (3.5–5 s): the light swings back to full and the moon lands on its first frame.

S — Style
Looks: {{bg}} stock with fibres; an {{ink}} key screen at 45°, an {{accent}} warm screen at 15° on the lit side, an {{accent2}} cool screen at 75° in the shadows; faint background screen.
Moves: light direction swings on a sine (never linear), the moon's surface rotates one full turn per loop, the grid stays fixed; ease in and out.
Rules:
1. Tone only through dot size; radius ∝ √tone.
2. Three screens at 45°, 15°, 75°, slightly misregistered.
3. Warm lit side, cool shadow side.
4. The grid never moves; only the tone underneath does.
5. Grain and vignette on the stock.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the sphere reads as round at thumbnail size; dots never merge into flat areas; the three screens form a rosette, not moiré stripes; the edge of the moon is clean. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Halftone",
  theme: {
    bg: "#0e0d0c",
    ink: "#efe9dd",
    accent: "#ff6a3d",
    accent2: "#2aa7e0",
    font: "Inter",
  },
  tags: [
    "halftone",
    "print",
    "dots",
    "comic",
    "pop art",
    "newspaper",
    "moon",
    "space",
    "retro",
    "texture",
    "cmyk",
  ],
  word: "Motion",
  family: "Print & Craft",
  tagline: "A moon printed in three screens",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(`halftone-stock:${theme.bg}${theme.ink}`, w, h, stock(theme)) as CanvasImageSource,
      0,
      0,
    );

    const R = u * (portrait ? 0.38 : 0.36);
    const mx = portrait ? w * 0.5 : w * 0.54;
    const my = h * (portrait ? 0.42 : 0.45);
    // Light swings between a thin crescent and full, on a sine.
    const theta = 0.78 * Math.PI * Math.sin(TAU * (t / LOOP));
    const L = [Math.sin(theta), -0.22, Math.cos(theta)];
    const Ln = Math.hypot(L[0], L[1], L[2]);
    const spin = TAU * (t / LOOP);
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    const shade = (x: number, y: number) => {
      const nx = (x - mx) / R;
      const ny = (y - my) / R;
      const rr = nx * nx + ny * ny;
      if (rr >= 1) return { inside: false, lit: -1, n: 0 };
      const nz = Math.sqrt(1 - rr);
      const lit = (nx * L[0] + ny * L[1] + nz * L[2]) / Ln;
      // Surface turns about the vertical axis: craters from periodic noise.
      const px = nx * cs + nz * sn;
      const pz = -nx * sn + nz * cs;
      const crater =
        noise3(px * 2.4 + 5, ny * 2.4, pz * 2.4) * 0.6 + noise3(px * 6, ny * 6 + 3, pz * 6) * 0.25;
      return { inside: true, lit, n: crater };
    };
    const pitch = u / 34;
    const box: [number, number, number, number] = [
      mx - R - pitch,
      my - R - pitch,
      mx + R + pitch,
      my + R + pitch,
    ];
    const edgeFade = (x: number, y: number) => clamp((1 - Math.hypot(x - mx, y - my) / R) * 18);

    light(ctx, mx - R * 0.3, my - R * 0.2, R * 2.6, theme.accent2, 0.08);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    // Background screen: a faint vertical ramp.
    screen(
      ctx,
      w,
      h,
      {
        angle: Math.PI / 4,
        color: rgba(theme.accent2, 0.55),
        pitch: pitch * 1.1,
        dx: 0,
        dy: 0,
        tone: (x, y) => {
          if (Math.hypot(x - mx, y - my) < R * 1.06) return 0;
          // A dotted planet curve at the foot: the moon hangs above a printed horizon.
          const pr = Math.max(w, h) * 1.4;
          const pd = Math.hypot(x - w * 0.5, y - (h * 0.86 + pr));
          const land = pd < pr ? 0.16 + 0.34 * Math.min(1, (pr - pd) / (h * 0.25)) : 0;
          return Math.max(land, 0.02 + 0.08 * (y / h) ** 1.5);
        },
      },
      [0, 0, w, h],
    );
    // Cool screen in the shadow side.
    screen(
      ctx,
      w,
      h,
      {
        angle: (75 * Math.PI) / 180,
        color: theme.accent2,
        pitch,
        dx: u * 0.002,
        dy: -u * 0.0015,
        tone: (x, y) => {
          const s = shade(x, y);
          if (!s.inside) return 0;
          return Math.max(0.07, 0.08 + 0.22 * clamp(-s.lit + 0.3) + 0.05 * s.n) * edgeFade(x, y);
        },
      },
      box,
    );
    // Warm screen on the lit side.
    screen(
      ctx,
      w,
      h,
      {
        angle: (15 * Math.PI) / 180,
        color: theme.accent,
        pitch,
        dx: -u * 0.0018,
        dy: u * 0.0012,
        tone: (x, y) => {
          const s = shade(x, y);
          if (!s.inside) return 0;
          return clamp(s.lit * 0.8 - s.n * 0.12) * 0.75 * edgeFade(x, y);
        },
      },
      box,
    );
    // Key screen: the light itself.
    screen(
      ctx,
      w,
      h,
      {
        angle: Math.PI / 4,
        color: mix(theme.ink, theme.accent, 0.08),
        pitch,
        dx: 0,
        dy: 0,
        tone: (x, y) => {
          const s = shade(x, y);
          if (!s.inside) return 0;
          return clamp(s.lit * 0.95 - 0.06 + s.n * 0.12) ** 1.2 * edgeFade(x, y);
        },
      },
      box,
    );
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
