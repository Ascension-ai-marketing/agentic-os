import { mix, rgba } from "../engine/color";
import {
  bake,
  fbm3,
  fract,
  frameOf,
  grain,
  ground,
  hash,
  light,
  LOOP,
  noise3,
  rng,
  TAU,
  vignette,
  wave,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";

const LAYERS = 6;

/** Paper fibre texture, applied over everything with soft-light. */
function fibre(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    c.fillStyle = "#808080";
    c.fillRect(0, 0, w, h);
    const step = Math.max(3, Math.round(u / 160));
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const n = fbm3(x / (u * 0.05), y / (u * 0.05), 1.7, 2);
        const v = Math.round(128 + n * 38);
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(x, y, step, step);
      }
    const r = rng(8);
    c.lineCap = "round";
    for (let i = 0; i < 900; i++) {
      const x = r() * w;
      const y = r() * h;
      const a = r() * TAU;
      const len = u * (0.006 + r() * 0.03);
      c.strokeStyle = r() < 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";
      c.lineWidth = Math.max(0.5, u * 0.0008);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      c.stroke();
    }
    void theme;
  };
}

/** Top edge of layer i at x, time t. Scrolls a whole number of wavelengths per loop. */
function edge(i: number, x: number, t: number, w: number, h: number, portrait: boolean) {
  const lambda = w * (portrait ? 0.9 - 0.08 * i : 0.62 - 0.05 * i);
  const k = i % 2 === 0 ? 1 : -1;
  const scroll = (k * lambda * t) / LOOP;
  const local = (x - scroll) / lambda;
  const base = h * ((portrait ? 0.5 : 0.46) + (portrait ? 0.075 : 0.085) * i);
  const amp = h * (portrait ? 0.02 + 0.006 * i : 0.028 + 0.008 * i);
  const cut = noise3(local * 6, i * 3.1, 0.5, 6, 0, 0) * h * 0.006;
  return (
    base + amp * Math.sin(TAU * local + i * 1.7) + amp * 0.35 * Math.sin(TAU * local * 2 + i) + cut
  );
}

export const style: MotionStyle = {
  id: "paper-cut",
  name: "Paper-cut Layers",
  look: "A night sea cut from stacked paper: six wave layers with real drop shadows, a layered paper moon and a folded boat.",
  move: "Each layer rolls at its own pace and direction, the boat rides its wave, birds glide across, stars wink.",
  rules: [
    "Every shape is a cut layer that casts a soft shadow on the one behind.",
    "Layers get lighter with distance: atmospheric perspective in paper.",
    "Edges are scissor-cut: slightly irregular, never perfect curves.",
    "A thin light catches the top edge of every layer.",
    "Layers move at different speeds and alternate direction (parallax).",
    "Paper fibre texture over everything.",
    "The accent lives only in the moon.",
  ],
  prompt: `R — References
• Layered paper-cut dioramas and shadow boxes (search: layered paper art ocean, paper cut shadow box).
• Paper theatre sets; stop-motion paper craft lit from above.

I — Idea
One image, a quiet night at sea, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): six cut-paper wave layers roll under a layered paper moon; a folded paper boat rides the second wave.
• Middle (1.5–3.5 s): the boat lifts and tips on a swell, two paper birds glide across, stars wink.
• End (3.5–5 s): the swell settles and every layer lands exactly where it began.

S — Style
Looks: {{bg}} night, layers graded from {{accent2}} (far) to near-black (near), each with a soft drop shadow and a lit top edge; the moon in {{accent}} with two paper rings; the boat and birds in {{ink}}. Paper fibre texture on everything.
Moves: each layer scrolls a whole number of wavelengths per loop, alternating direction; gentle sine bob; the boat follows its wave's height and slope.
Rules:
1. Every layer casts a shadow onto the layer behind it.
2. Farther layers are lighter and bluer.
3. Irregular scissor-cut edges.
4. A thin lit edge along each layer's top.
5. Parallax: different speeds, alternating directions.
6. One accent, in the moon.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; every layer has a visible shadow; the boat sits on its wave (never floating or sunk); no layer edge looks machine-perfect; paper texture is visible. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Paper_cutting",
  theme: {
    bg: "#0e1016",
    ink: "#f2e8d8",
    accent: "#f2a541",
    accent2: "#4f7396",
    font: "Newsreader",
  },
  tags: [
    "paper",
    "papercut",
    "paper-cut",
    "craft",
    "layers",
    "diorama",
    "sea",
    "ocean",
    "waves",
    "moon",
    "boat",
    "night",
    "calm",
  ],
  word: "Motion",
  family: "Print & Craft",
  tagline: "A night sea cut from paper",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    // Sky: a soft gradient toward the horizon.
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, theme.bg);
    sky.addColorStop(1, mix(theme.bg, theme.accent2, 0.3));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars: tiny cut discs that wink.
    const r = rng(31);
    for (let i = 0; i < 46; i++) {
      const x = r() * w;
      const y = r() * h * 0.5;
      const s = u * (0.002 + r() * 0.003);
      const tw = 0.55 + 0.45 * Math.sin(TAU * ((2 * t) / LOOP + r()));
      ctx.fillStyle = rgba(theme.ink, 0.35 + 0.5 * tw * r());
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
    }

    // Moon: layered paper discs.
    const mx = portrait ? w * 0.62 : w * 0.66;
    const my = (portrait ? h * 0.3 : h * 0.3) + wave(t, 1) * h * 0.01;
    const mr = u * (portrait ? 0.17 : 0.16);
    light(ctx, mx, my, mr * 3.2, theme.accent, 0.22);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = u * 0.02;
    ctx.shadowOffsetY = u * 0.006;
    for (const [k, rr] of [
      [0.6, 1.32],
      [0.35, 1.16],
      [0, 1],
    ] as const) {
      ctx.fillStyle = mix(theme.accent, theme.bg, k);
      ctx.beginPath();
      ctx.arc(mx, my, mr * rr, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // The moon's face: a few torn-paper craters, one layer up.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = u * 0.008;
    ctx.shadowOffsetY = u * 0.003;
    ctx.fillStyle = mix(theme.accent, theme.bg, 0.18);
    // A dropped logo is cut from paper and laid on the moon instead of craters.
    const mark = tintedLogo(theme, mix(theme.accent, theme.bg, 0.35), mr * 1.15, mr * 1.15);
    if (mark) ctx.drawImage(mark as CanvasImageSource, mx - mr * 0.575, my - mr * 0.575);
    else
      for (const [ox, oy, rr] of [
        [-0.35, -0.2, 0.2],
        [0.3, 0.25, 0.14],
        [0.1, -0.45, 0.09],
      ]) {
        ctx.beginPath();
        ctx.ellipse(mx + ox * mr, my + oy * mr, rr * mr, rr * mr * 0.86, 0.4, 0, TAU);
        ctx.fill();
      }
    ctx.restore();

    // Paper birds glide across once per loop.
    for (let b = 0; b < 2; b++) {
      const p = fract(t / LOOP + b * 0.47 + 0.1);
      const bx = -u * 0.1 + p * (w + u * 0.2);
      const by = h * (0.2 + b * 0.09) + Math.sin(TAU * (p * 2 + b)) * h * 0.02;
      const flap = Math.sin(TAU * ((6 * t) / LOOP + b * 0.3));
      const s = u * (0.045 - b * 0.01);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = u * 0.01;
      ctx.shadowOffsetY = u * 0.004;
      ctx.fillStyle = mix(theme.ink, theme.bg, 0.1 + b * 0.2);
      ctx.beginPath();
      ctx.moveTo(bx - s, by - s * 0.5 * flap);
      ctx.lineTo(bx, by + s * 0.12);
      ctx.lineTo(bx + s, by - s * 0.5 * flap);
      ctx.lineTo(bx, by - s * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Wave layers, back to front.
    const step = Math.max(3, w / 140);
    for (let i = 0; i < LAYERS; i++) {
      const depth = i / (LAYERS - 1);
      const color = mix(
        mix(mix(theme.bg, theme.accent2, 0.95), theme.ink, 0.12),
        mix(theme.bg, theme.accent2, 0.1),
        depth ** 0.85,
      );
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.72 + depth * 0.18})`;
      ctx.shadowBlur = u * (0.03 + depth * 0.016);
      ctx.shadowOffsetY = -u * 0.007;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-10, h + 10);
      for (let x = -10; x <= w + 10; x += step) ctx.lineTo(x, edge(i, x, t, w, h, portrait));
      ctx.lineTo(w + 10, h + 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // Lit top edge.
      ctx.save();
      ctx.strokeStyle = rgba(mix(color, theme.ink, 0.5), 0.55);
      ctx.lineWidth = Math.max(1, u * 0.0028);
      ctx.beginPath();
      for (let x = -10; x <= w + 10; x += step) {
        const y = edge(i, x, t, w, h, portrait) + u * 0.0015;
        if (x === -10) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // The boat rides layer 1.
      if (i === 1) {
        const bx = portrait ? w * 0.42 : w * 0.34;
        const y0 = edge(1, bx - u * 0.02, t, w, h, portrait);
        const y1 = edge(1, bx + u * 0.02, t, w, h, portrait);
        const by = (y0 + y1) / 2;
        const tilt = Math.atan2(y1 - y0, u * 0.04);
        const s = u * 0.07;
        ctx.save();
        ctx.translate(bx, by + s * 0.12);
        ctx.rotate(tilt);
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = u * 0.012;
        ctx.shadowOffsetY = u * 0.004;
        ctx.fillStyle = mix(theme.ink, theme.bg, 0.12);
        ctx.beginPath();
        ctx.moveTo(-s, -s * 0.28);
        ctx.lineTo(s, -s * 0.28);
        ctx.lineTo(s * 0.62, s * 0.08);
        ctx.lineTo(-s * 0.62, s * 0.08);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = theme.ink;
        ctx.beginPath();
        ctx.moveTo(-s * 0.05, -s * 0.3);
        ctx.lineTo(-s * 0.05, -s * 1.25);
        ctx.lineTo(s * 0.6, -s * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = mix(theme.ink, theme.bg, 0.3);
        ctx.beginPath();
        ctx.moveTo(-s * 0.12, -s * 0.3);
        ctx.lineTo(-s * 0.12, -s * 1.02);
        ctx.lineTo(-s * 0.55, -s * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Paper fibre over everything.
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.85;
    ctx.drawImage(bake("paper-fibre", w, h, fibre(theme)) as CanvasImageSource, 0, 0);
    ctx.restore();
    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.28);
    void hash;
  },
};
