import { mix, rgba } from "../engine/color";
import { tintedLogo } from "../engine/assets";
import { ease, grain, lerp, seg, TAU, vignette, wordFor } from "../engine/kit";
import type { MotionStyle } from "../engine/types";
import {
  collage,
  fnFrame,
  fnGround,
  fnPalette,
  fnPaperTile,
  serif,
  serifWidth,
} from "./field-notes/kit";

const STRIKE = 0.62;
const BEATS: [number, number][] = [
  [1.2, 0.8],
  [1.55, 0.8],
  [1.9, 0.75],
  [2.08, 0.75],
  [2.3, 1.25],
];

export const style: MotionStyle = {
  id: "field-notes-mark",
  name: "Field Notes · Mark",
  look: "A logo mark on its construction grid: an ivory disc holding a dawn horizon, a lockup beneath, on night.",
  move: "The mark strikes in, its rim lights along the curve, rings pulse out on a jingle's beat, then it dims back to pencil.",
  rules: [
    "The grid is construction: dashed circles, diagonals, corner ticks, a dimension arc.",
    "The mark strikes once: 1.08 to 1, a hard landing, the rim lighting outward.",
    "Rings pulse on the beat (da, da, da-da, DAA) and fade as they grow.",
    "Inside the disc: a dawn horizon with a clay sun, or your logo.",
    "Lockup in Newsreader 500 at opsz 36 with a clay plus.",
    "Paper texture on the disc; grain and vignette on the night.",
    "It settles, glows and dims back to the unlit outline to loop.",
  ],
  prompt: `R — References
• Logo construction sheets: grids, circles, diagonals and dimension ticks around a mark.
• Sonic logos (search: sonic branding animation) and the Horizon Strike look: night, dawn rim, ivory paper, one clay accent.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1 s): a faint outline of the mark on its construction grid; then it strikes in, a disc of ivory paper holding a dawn horizon (or the brand's logo) for "{{name}}".
• Middle (1–2.8 s): its rim lights along the curve; rings pulse out on a jingle's beat, da, da, da-da, DAA.
• End (2.8–5 s): it holds, glows and dims back to the unlit outline.

S — Style
Looks: {{bg}} night with a dawn rim at the foot; an ivory paper disc with a {{accent}} sun behind a dark planet curve; {{ink}} construction lines at low opacity; a {{accent2}} torn scrap in the corner; a {{font}} 500 lockup with a clay plus.
Moves: strike 0.3 s ease-out with a small overshoot; rim light grows from the apex outward; each ring grows and fades over 0.9 s; the dim back eases in and out over 1 s.
Rules:
1. The grid is construction, faint and precise.
2. One strike; rings only on the beats.
3. One clay element inside the mark.
4. Lockup set at opsz 36, never all caps.
5. Paper texture, grain and vignette.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; rings are centred on the mark; the rim light stays inside the disc; the lockup is optically centred; nothing clips at 9:16. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Sonic_branding",
  theme: {
    bg: "#07080c",
    ink: "#f4f1ea",
    accent: "#d97757",
    accent2: "#e3b23c",
    font: "Newsreader",
  },
  fonts: ["Newsreader:opsz,wght@6..72,400..700", "Inter:wght@100..900"],
  tags: [
    "logo",
    "mark",
    "brand",
    "jingle",
    "sonic",
    "sound",
    "identity",
    "reveal",
    "field notes",
    "grid",
  ],
  word: "Field + Notes",
  family: "Field Notes",
  tagline: "A mark strikes on the beat",
  render(ctx, t, theme, w, h) {
    const f = fnFrame(w, h);
    const P = fnPalette(theme);
    fnGround(ctx, f, theme, t / 5);
    collage(ctx, theme, f, t);

    const R = f.u * (f.portrait ? 0.2 : 0.17);
    const mx = f.cx;
    const my = h * (f.portrait ? 0.4 : 0.39);
    const lit =
      ease.outCubic(seg(t, STRIKE - 0.25, STRIKE + 0.06)) * (1 - ease.inOutSine(seg(t, 3.9, 4.85)));
    const strike = seg(t, STRIKE - 0.05, STRIKE + 0.3);
    const scale = strike > 0 && strike < 1 ? lerp(1.08, 1, ease.outBack(strike)) : 1;

    // Construction grid.
    ctx.save();
    ctx.translate(mx, my);
    ctx.strokeStyle = P.moon;
    ctx.globalAlpha = 0.12 + 0.06 * lit;
    ctx.lineWidth = Math.max(1, 1.2 * f.s);
    ctx.setLineDash([4 * f.s, 7 * f.s]);
    for (const k of [1.42, 0.62]) {
      ctx.beginPath();
      ctx.arc(0, 0, R * k, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-R * 1.9, 0);
    ctx.lineTo(R * 1.9, 0);
    ctx.moveTo(0, -R * 1.62);
    ctx.lineTo(0, R * 1.62);
    ctx.moveTo(-R * 1.34, -R * 1.34);
    ctx.lineTo(R * 1.34, R * 1.34);
    ctx.moveTo(R * 1.34, -R * 1.34);
    ctx.lineTo(-R * 1.34, R * 1.34);
    ctx.stroke();
    const q = R * 1.18;
    const l = 16 * f.s;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(sx * q, sy * (q - l));
      ctx.lineTo(sx * q, sy * q);
      ctx.lineTo(sx * (q - l), sy * q);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.62, -0.55, 0.55);
    ctx.stroke();
    for (let k = -5; k <= 5; k++) {
      const an = k * 0.1;
      const r0 = R * 1.62;
      const r1 = r0 + (k % 5 === 0 ? 14 : 7) * f.s;
      ctx.beginPath();
      ctx.moveTo(Math.cos(an) * r0, Math.sin(an) * r0);
      ctx.lineTo(Math.cos(an) * r1, Math.sin(an) * r1);
      ctx.stroke();
    }
    ctx.restore();

    // Sound rings on the beat.
    for (const [b, k] of BEATS) {
      const age = (t - b) / 0.9;
      if (age <= 0 || age >= 1) continue;
      ctx.strokeStyle = rgba(P.moon, 0.42 * k * (1 - age) * lit);
      ctx.lineWidth = Math.max(1, 2 * f.s);
      ctx.beginPath();
      ctx.arc(mx, my, R * (1.05 + age * 0.95), 0, TAU);
      ctx.stroke();
    }

    // The mark.
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(scale, scale);
    // Unlit outline and pencil horizon.
    ctx.save();
    ctx.globalAlpha = 0.32 * (1 - lit);
    ctx.strokeStyle = P.moon;
    ctx.lineWidth = Math.max(1, 2.6 * f.s);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.stroke();
    ctx.restore();
    const apex = R * 0.3;
    const Rp = R * 2.3;
    if (lit > 0.001) {
      ctx.save();
      ctx.globalAlpha = lit;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.clip();
      const pat = ctx.createPattern(fnPaperTile(P.ivory, 9) as CanvasImageSource, "repeat");
      ctx.fillStyle = pat ?? P.ivory;
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
      const shade = ctx.createRadialGradient(-R * 0.4, -R * 0.5, 0, 0, 0, R * 1.2);
      shade.addColorStop(0, "rgba(255,255,255,0.10)");
      shade.addColorStop(1, "rgba(90,60,30,0.16)");
      ctx.fillStyle = shade;
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
      const mark = tintedLogo(theme, mix(P.night, "#141413", 0.4), R * 1.1, R * 1.1);
      if (mark) {
        ctx.drawImage(mark as CanvasImageSource, -R * 0.55, -R * 0.55);
      } else {
        const sunUp = lerp(2, 18, ease.inOutSine(seg(t, 0.8, 3.6))) * f.s;
        let g = ctx.createRadialGradient(0, apex, 0, 0, apex, R * 0.9);
        g.addColorStop(0, rgba(P.dawn, 0.55));
        g.addColorStop(1, rgba(P.dawn, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-R, -R, 2 * R, 2 * R);
        ctx.fillStyle = P.clay;
        ctx.beginPath();
        ctx.arc(0, apex - sunUp + 6 * f.s, R * 0.14, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, apex + Rp, Rp, 0, TAU);
        ctx.fillStyle = mix(P.night, "#16140f", 0.5);
        ctx.fill();
        g = ctx.createLinearGradient(0, apex, 0, R);
        g.addColorStop(0, rgba(P.dawn, 0.25));
        g.addColorStop(0.3, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fill();
      }
      // Rim light grows outward from the apex on impact.
      const span = 0.42 * ease.outCubic(seg(t, STRIKE, STRIKE + 0.55));
      if (!mark && span > 0.001) {
        const lg = ctx.createLinearGradient(-R, 0, R, 0);
        lg.addColorStop(0, rgba(P.dawn, 0));
        lg.addColorStop(0.5, rgba(mix(P.dawn, "#ffffff", 0.5), 1));
        lg.addColorStop(1, rgba(P.dawn, 0));
        ctx.strokeStyle = lg;
        ctx.lineWidth = 3.4 * f.s;
        ctx.beginPath();
        ctx.arc(0, apex + Rp, Rp, -Math.PI / 2 - span, -Math.PI / 2 + span);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = rgba(P.moon, 0.92 * lit);
      ctx.lineWidth = Math.max(1, 2.6 * f.s);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    // Lockup: "<name>" or "Field + Notes", with the plus in clay.
    const text = wordFor(theme.name, "Field + Notes", 20);
    const parts = text.includes(" + ") ? text.split(" + ") : [text];
    const size = Math.min(f.u * 0.1, (w * 0.8) / Math.max(1, serifWidth(ctx, theme.font, text, 1)));
    const y = my + R * 1.62 + size * 1.55;
    const total = serifWidth(ctx, theme.font, text, size);
    let x = f.cx - total / 2;
    const alpha = 0.35 + 0.65 * lit;
    parts.forEach((p, i) => {
      serif(ctx, theme.font, p, x, y, size, { color: P.moon, alpha });
      x += serifWidth(ctx, theme.font, p, size);
      if (i < parts.length - 1) {
        const plus = serifWidth(ctx, theme.font, " + ", size);
        serif(ctx, theme.font, " + ", x, y, size, { color: P.clay, alpha });
        x += plus;
      }
    });

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.3);
  },
};
