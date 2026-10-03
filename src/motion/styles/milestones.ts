import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { glow, studio, unit } from "./_s6-helpers";

const DISPLAY = '"Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", "SFMono-Regular", Menlo, monospace';
/** Made-up roadmap. */
const STEPS = [
  { n: "01", title: "Kickoff", when: "JAN" },
  { n: "02", title: "Prototype", when: "MAR" },
  { n: "03", title: "Beta", when: "JUN" },
  { n: "04", title: "Launch", when: "SEP" },
  { n: "05", title: "Scale", when: "DEC" },
];
const ZS = [0.1, 0.45, 0.8, 1.15, 1.5];
const DZ = 0.035;
const HOP = 0.175;
const WALK_A = 0.15;
const WALK_B = 2.55;
const FOLD = 3.95;

/**
 * A diorama camera: the horizon sits above the frame, so the whole frame is
 * ground; near stones read almost round, far ones flatten into the fog.
 */
function view(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const yNear = h * 0.975;
  const yFar = h * (portrait ? 0.34 : square ? 0.43 : 0.39);
  const F = (yNear - yFar) / (1 - 1 / (1 + ZS[4]));
  const hy = yNear - F;
  const cx = w * 0.5;
  const A0 = w * (portrait ? 0.2 : square ? 0.16 : 0.2);
  /** World sizes shrink in portrait, where depth is carried by height, not width. */
  const S = portrait ? 0.6 : square ? 0.72 : 1;
  /** Path offset from centre in pixels: milestones sit on the outer bends. */
  const swing = (z: number) => A0 * Math.cos((Math.PI * (z - ZS[0])) / 0.35) * (1 - 0.2 * z);
  const k = (z: number) => F / (z + 1);
  const at = (z: number, off = 0, y = 0): [number, number] => [
    cx + swing(z) + off * k(z),
    hy + k(z) * (1 - y),
  ];
  return {
    portrait,
    square,
    F,
    hy,
    k,
    at,
    S,
    sign: portrait,
    CM: portrait ? 0.9 : square ? 0.72 : 1,
    U: unit(w, h) * (portrait ? 1.12 : 1),
  };
}

/** Static ground: a perspective grid fading into fog. */
function groundLayer(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const v = view(w, h);
    c.lineWidth = Math.max(1, v.U);
    for (let z = -0.05; z < 6; z = z < 2 ? z + 0.175 : z * 1.3) {
      const y = v.hy + v.k(z);
      c.strokeStyle = rgba(theme.ink, 0.06 * clamp((v.k(z) / v.F) * 1.6));
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    for (let x = -5; x <= 5; x += 0.35) {
      const g = c.createLinearGradient(0, v.hy + v.k(-0.05), 0, v.hy + v.k(4));
      g.addColorStop(0, rgba(theme.ink, 0.06));
      g.addColorStop(1, rgba(theme.ink, 0));
      c.strokeStyle = g;
      c.beginPath();
      c.moveTo(w / 2 + x * v.k(-0.05), v.hy + v.k(-0.05));
      c.lineTo(w / 2 + x * v.k(4), v.hy + v.k(4));
      c.stroke();
    }
  };
}

function fogLayer(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const v = view(w, h);
    const farY = v.hy + v.k(2.1);
    const end = farY + (h - farY) * 0.22;
    const fog = c.createLinearGradient(0, 0, 0, end);
    fog.addColorStop(0, rgba(theme.bg, 1));
    fog.addColorStop(0.5, rgba(theme.bg, 0.9));
    fog.addColorStop(1, rgba(theme.bg, 0));
    c.fillStyle = fog;
    c.fillRect(0, 0, w, end);
  };
}

export const style: MotionStyle = {
  id: "milestones",
  name: "Milestone Path",
  family: "Data & Diagrams",
  tagline: "A roadmap as a board game",
  look: "A roadmap as a board-game journey: stepping stones winding into fog, a glowing token hopping along, numbered flags on poles.",
  move: "The token hops stone to stone into the distance; each milestone springs up as it lands there (pole, then flag); they hold, then fold away.",
  rules: [
    "The path recedes in perspective; nothing sweeps left to right.",
    "Stones, not a line: the token hops from one to the next.",
    "A milestone springs up only when the token lands on it: pole, then flag.",
    "Flags alternate sides on the outer bends so none overlap.",
    "Each flag: a big number, one word, a month. Nothing more.",
    "Fog swallows the far stones; near ones read almost round.",
    "Empty stones are the first and last frame.",
  ],
  prompt: `R — References
• Board-game journey maps and roadmap infographics (search: board game path isometric, roadmap stepping stones).
• Diorama photography: a high camera, soft fog, small props lit from the front.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): stepping stones wind from the foreground into fog, five of them larger and ringed; a glowing token starts hopping from the nearest stone.
• Middle (1.5–3.5 s): each time it lands on a ringed stone a pole springs up and a numbered flag unfolds ("01 Kickoff JAN" to "05 Scale DEC"), alternating sides; it settles on the last one.
• End (3.5–5 s): the token fades, the flags fold back far to near, and only the stones remain.

S — Style
Looks: {{bg}} night ground with a faint perspective grid and top fog; stones in a soft {{ink}} tint that flatten with distance; milestone rings and flag numbers in {{accent}}; the token and footstep flashes in {{accent2}}; flag text in {{font}}.
Moves: the token hops once per stone (a sine arc) over 2.4 s, inOutSine; each landing flashes its stone; poles spring in 0.3 s and flags unfold in 0.35 s with outBack; folds are 0.3 s each, far to near.
Rules:
1. Perspective depth; no left-to-right sweep.
2. Discrete stones and hops, never a drawn line.
3. Pole first, then flag, only on landing.
4. Flags alternate sides on the outer bends.
5. Empty stones are the first and last frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no flag overlaps another or leaves the frame; the far flag is legible at full size; the token lands on stones, not between them. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Technology_roadmap",
  theme: {
    bg: "#0c0b10",
    ink: "#f3f0ea",
    accent: "#b69cff",
    accent2: "#ffd6a5",
    font: "Bricolage Grotesque",
  },
  fonts: ["Bricolage Grotesque:opsz,wght@12..96,200..800", "JetBrains Mono:wght@100..800"],
  tags: [
    "milestones",
    "roadmap",
    "timeline",
    "journey",
    "path",
    "progress",
    "steps",
    "plan",
    "board game",
    "perspective",
    "history",
  ],
  word: "Launch",
  render(ctx, t, theme, w, h) {
    const v = view(w, h);
    const { U } = v;
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "miles", w, h, {
        lx: 0.5,
        ly: 0.7,
        tint: mix(theme.ink, theme.accent, 0.4),
        mottle: 0.8,
      }) as CanvasImageSource,
      0,
      0,
    );
    ctx.drawImage(
      bake(`miles-ground:${theme.bg}${theme.ink}`, w, h, groundLayer(theme)) as CanvasImageSource,
      0,
      0,
    );
    light(ctx, w * 0.5, h * 0.75, w * 0.55, theme.accent, 0.05);

    // Token walk: z along the path, one hop per stone.
    const walk = ease.inOutSine(seg(t, WALK_A, WALK_B));
    const zT = lerp(0.03, ZS[4], walk);
    const tokenA = clamp(seg(t, 0.02, 0.28)) * (1 - clamp(seg(t, 3.25, 3.75)));

    // Stones, far to near. Milestone stones are bigger and ringed.
    const stones: number[] = [];
    for (let z = 0.03; z < 2.3; z += DZ) stones.push(z);
    for (let si = stones.length - 1; si >= 0; si--) {
      const z = stones[si];
      const mi = ZS.findIndex((m) => Math.abs(m - z) < DZ * 0.55);
      if (mi < 0 && ZS.some((m) => Math.abs(m - z) < DZ * 1.6)) continue;
      const isMile = mi >= 0;
      const [x, y] = v.at(isMile ? ZS[mi] : z);
      const kz = v.k(z);
      const r = (isMile ? 0.085 : 0.026) * v.S * kz;
      const ry = ((isMile ? 0.085 : 0.026) * v.S * v.F) / (z + 1) ** 2;
      const near = clamp(kz / v.F);
      // Footstep flash where the token just landed.
      const passT =
        WALK_A +
        (WALK_B - WALK_A) * (Math.acos(1 - 2 * clamp((z - 0.03) / (ZS[4] - 0.03))) / Math.PI);
      const since = t - passT;
      const flash = since > 0 && since < 0.6 && z <= ZS[4] + 0.01 ? 1 - since / 0.6 : 0;
      ctx.fillStyle = rgba("#000000", 0.35);
      ctx.beginPath();
      ctx.ellipse(x, y + ry * 0.35, r * 1.02, ry * 1.02, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = mix(mix(theme.bg, theme.ink, 0.1 + 0.12 * near), theme.accent2, flash * 0.6);
      ctx.beginPath();
      ctx.ellipse(x, y, r, ry, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(theme.ink, 0.07 + 0.05 * near);
      ctx.beginPath();
      ctx.ellipse(x, y - ry * 0.18, r * 0.72, ry * 0.62, 0, 0, TAU);
      ctx.fill();
      if (flash > 0) glow(ctx, x, y, r * 2.4, theme.accent2, 0.5 * flash);
      if (isMile) {
        ctx.strokeStyle = rgba(theme.accent, 0.7);
        ctx.lineWidth = Math.max(1, 2 * U * near);
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.3, ry * 1.3, 0, 0, TAU);
        ctx.stroke();
        // The stop's number is painted on its stone, flat on the ground, until its flag rises.
        const reachM =
          WALK_A +
          (WALK_B - WALK_A) *
            (Math.acos(1 - 2 * clamp((ZS[mi] - 0.03) / (ZS[4] - 0.03))) / Math.PI);
        const foldM = FOLD + (STEPS.length - 1 - mi) * 0.12;
        const hidden =
          clamp(seg(t, reachM, reachM + 0.2)) * (1 - clamp(seg(t, foldM + 0.2, foldM + 0.45)));
        const paint = 0.85 - 0.65 * hidden;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, ry / r);
        ctx.fillStyle = rgba(theme.accent, paint);
        ctx.font = font(700, r * 0.95, theme.font, DISPLAY);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(STEPS[mi].n, 0, r * 0.06);
        ctx.restore();
      }
    }

    // The token hops: height is a sine arc between stones, its shadow shrinks as it rises.
    if (tokenA > 0.001) {
      const hopPhase = ((zT - 0.03) / HOP) % 1;
      const moving = t > WALK_A && t < WALK_B;
      const hop = moving ? Math.sin(Math.PI * hopPhase) : 0;
      const [gx, gy] = v.at(zT);
      const kz = v.k(zT);
      const lift = (0.045 + 0.07 * hop) * v.S;
      const [ox, oy] = v.at(zT, 0, lift);
      ctx.save();
      ctx.globalAlpha = tokenA;
      ctx.fillStyle = rgba("#000000", 0.45 * (1 - hop * 0.5));
      ctx.beginPath();
      ctx.ellipse(
        gx,
        gy,
        0.035 * v.S * kz * (1 - hop * 0.3),
        (0.035 * v.S * v.F) / (zT + 1) ** 2,
        0,
        0,
        TAU,
      );
      ctx.fill();
      glow(ctx, ox, oy, 0.2 * v.S * kz, theme.accent2, 0.75);
      ctx.fillStyle = mix(theme.accent2, theme.ink, 0.55);
      ctx.beginPath();
      ctx.arc(ox, oy, Math.max(1.5, 0.026 * v.S * kz), 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.drawImage(bake(`miles-fog:${theme.bg}`, w, h, fogLayer(theme)) as CanvasImageSource, 0, 0);

    // Milestones, far to near: pole, then flag.
    for (let i = STEPS.length - 1; i >= 0; i--) {
      const z = ZS[i];
      const side = i % 2 ? -1 : 1;
      const reach =
        WALK_A +
        (WALK_B - WALK_A) * (Math.acos(1 - 2 * clamp((z - 0.03) / (ZS[4] - 0.03))) / Math.PI);
      const pole = ease.outBack(seg(t, reach, reach + 0.3));
      const card = ease.outBack(seg(t, reach + 0.12, reach + 0.47));
      const foldAt = FOLD + (STEPS.length - 1 - i) * 0.12;
      const up = pole * (1 - ease.inCubic(seg(t, foldAt + 0.1, foldAt + 0.4)));
      const open = card * (1 - ease.inOutCubic(seg(t, foldAt - 0.1, foldAt + 0.15)));
      const kz = v.k(z);
      const near = clamp(kz / v.F);
      const [bx, by] = v.at(z);
      const rip = seg(t, reach, reach + 0.7);
      if (rip > 0 && rip < 1) {
        const [mx, my] = v.at(z);
        ctx.strokeStyle = rgba(theme.accent, (1 - rip) * 0.85);
        ctx.lineWidth = Math.max(1, 2 * U * near);
        ctx.beginPath();
        ctx.ellipse(
          mx,
          my,
          (0.11 + 0.3 * rip) * v.S * kz,
          ((0.11 + 0.3 * rip) * v.S * v.F) / (z + 1) ** 2,
          0,
          0,
          TAU,
        );
        ctx.stroke();
      }
      if (up <= 0.001) continue;
      const poleH = 0.3 * v.S * kz * up;
      ctx.strokeStyle = rgba(theme.ink, 0.8);
      ctx.lineWidth = Math.max(1, 3.2 * U * near);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - poleH);
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(bx, by - poleH, Math.max(1.5, 5 * U * near), 0, TAU);
      ctx.fill();
      if (open <= 0.01) continue;
      const cs = Math.pow(near, 0.5) * v.CM;
      const cw = 290 * U * cs;
      const ch = 186 * U * cs;
      const top = by - poleH;
      // Flags hang outward from the pole top; in portrait they sit on top as signs.
      const x0 = v.sign ? bx - (cw * open) / 2 : side > 0 ? bx : bx - cw * open;
      const y0 = v.sign ? top - ch - 10 * U * cs : top;
      ctx.save();
      ctx.fillStyle = rgba("#000000", 0.3);
      ctx.beginPath();
      ctx.roundRect(x0 + 8 * U * cs, y0 + 12 * U * cs, cw * open, ch, 12 * U * cs);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(x0, y0, cw * open, ch, 12 * U * cs);
      ctx.fillStyle = mix(theme.bg, theme.ink, 0.1);
      ctx.fill();
      ctx.strokeStyle = rgba(theme.ink, 0.16);
      ctx.lineWidth = Math.max(1, U);
      ctx.stroke();
      ctx.clip();
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x0, y0, cw * open, 5 * U * cs);
      ctx.globalAlpha = clamp((open - 0.45) * 2.4);
      const tx = x0 + 24 * U * cs;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = font(700, 68 * U * cs, theme.font, DISPLAY);
      ctx.fillText(STEPS[i].n, tx, y0 + 80 * U * cs);
      ctx.fillStyle = theme.ink;
      ctx.font = font(500, 36 * U * cs, theme.font, DISPLAY);
      ctx.fillText(STEPS[i].title, tx, y0 + 128 * U * cs);
      ctx.fillStyle = rgba(theme.ink, 0.55);
      ctx.font = font(500, 18 * U * cs, "JetBrains Mono", MONO);
      ctx.letterSpacing = `${(2.2 * U * cs).toFixed(2)}px`;
      ctx.fillText(STEPS[i].when, tx, y0 + 160 * U * cs);
      ctx.letterSpacing = "0px";
      ctx.restore();
    }

    // Title.
    const L = Math.max(w * (v.portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
    const ty = h * (v.portrait ? 0.08 : 0.13);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(700, 58 * U, theme.font, DISPLAY);
    ctx.letterSpacing = `${(-1.2 * U).toFixed(2)}px`;
    ctx.fillText(`Road to ${wordFor(theme.name, "launch", 14)}`, L, ty);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.font = font(400, 23 * U, theme.font, DISPLAY);
    ctx.fillText("Five milestones, one year", L, ty + 40 * U);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.24);
  },
};
