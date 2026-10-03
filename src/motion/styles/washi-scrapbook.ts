import { mix, rgba } from "../engine/color";
import {
  bake,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { darkPaper, polyPath, stepped, tornLine, withShadow, type Pt } from "./_s1-helpers";

const HAND = '"Caveat", "Bradley Hand", cursive';
const TYPE = '"Special Elite", "Courier New", monospace';
const FPS = 12;

/** A strip of washi tape, w x h, with hand-torn ends and a printed pattern. */
function tape(theme: Theme, color: string, pattern: number, seed: number) {
  return (c: Ctx2D, w: number, h: number) => {
    const th = h * 0.8;
    const y0 = (h - th) / 2;
    const left = tornLine([w * 0.04, y0 + th], [w * 0.04, y0], seed, th * 0.08, th * 0.09);
    const right = tornLine([w * 0.96, y0], [w * 0.96, y0 + th], seed + 1, th * 0.08, th * 0.09);
    const pts: Pt[] = [...left, ...right];
    c.save();
    polyPath(c, pts);
    c.fillStyle = rgba(color, 0.84);
    c.fill();
    c.clip();
    c.fillStyle = rgba(pattern === 2 ? theme.bg : theme.ink, pattern === 2 ? 0.16 : 0.55);
    if (pattern === 0) {
      const p = th * 0.28;
      for (let y = y0 + p * 0.5; y < y0 + th; y += p)
        for (let x = (Math.round(y / p) % 2) * p * 0.5; x < w; x += p) {
          c.beginPath();
          c.arc(x, y, th * 0.055, 0, TAU);
          c.fill();
        }
    } else if (pattern === 1) {
      const p = th * 0.3;
      for (let x = -th; x < w + th; x += p) {
        c.beginPath();
        c.moveTo(x, y0);
        c.lineTo(x + p * 0.45, y0);
        c.lineTo(x + p * 0.45 + th * 0.5, y0 + th);
        c.lineTo(x + th * 0.5, y0 + th);
        c.fill();
      }
    } else {
      const p = th * 0.22;
      c.lineWidth = Math.max(0.6, th * 0.03);
      c.strokeStyle = rgba(theme.bg, 0.2);
      for (let x = 0; x < w; x += p) {
        c.beginPath();
        c.moveTo(x, y0);
        c.lineTo(x, y0 + th);
        c.stroke();
      }
      for (let y = y0; y < y0 + th; y += p) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
    }
    // Washi fibre and a soft sheen across the strip.
    const r = rng(seed);
    c.strokeStyle = rgba(theme.ink, 0.18);
    c.lineWidth = Math.max(0.5, th * 0.01);
    for (let i = 0; i < 30; i++) {
      const x = r() * w;
      const y = y0 + r() * th;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + th * 0.3 * (r() - 0.5), y + th * 0.3 * (r() - 0.5));
      c.stroke();
    }
    const g = c.createLinearGradient(0, y0, 0, y0 + th);
    g.addColorStop(0, rgba(theme.ink, 0.18));
    g.addColorStop(0.5, rgba(theme.ink, 0));
    g.addColorStop(1, rgba("#000000", 0.08));
    c.fillStyle = g;
    c.fillRect(0, y0, w, th);
    c.restore();
  };
}

/** The photo inside the polaroid: a sunset over water, soft and grainy. */
function photo(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const sky = c.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, mix(theme.accent2, theme.bg, 0.45));
    sky.addColorStop(0.55, mix(theme.accent, theme.accent2, 0.35));
    sky.addColorStop(1, mix(theme.accent, theme.ink, 0.35));
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h * 0.62);
    // Sun and its glow.
    const sx = w * 0.62;
    const sy = h * 0.56;
    const glow = c.createRadialGradient(sx, sy, 0, sx, sy, w * 0.5);
    glow.addColorStop(0, rgba(theme.ink, 0.55));
    glow.addColorStop(0.25, rgba(mix(theme.accent, theme.ink, 0.5), 0.3));
    glow.addColorStop(1, rgba(theme.accent, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    c.fillStyle = mix(theme.ink, theme.accent, 0.12);
    c.beginPath();
    c.arc(sx, sy, w * 0.07, 0, TAU);
    c.fill();
    // Water, with a broken path of light.
    const sea = c.createLinearGradient(0, h * 0.62, 0, h);
    sea.addColorStop(0, mix(theme.accent2, theme.bg, 0.35));
    sea.addColorStop(1, mix(theme.bg, theme.accent2, 0.25));
    c.fillStyle = sea;
    c.fillRect(0, h * 0.62, w, h * 0.38);
    const r = rng(9);
    for (let i = 0; i < 70; i++) {
      const y = h * 0.63 + Math.pow(r(), 1.4) * h * 0.37;
      const spread = 0.04 + ((y - h * 0.62) / (h * 0.38)) * 0.2;
      const x = sx + (r() - 0.5) * w * spread * 2;
      c.fillStyle = rgba(mix(theme.ink, theme.accent, 0.3), 0.25 + r() * 0.5);
      c.fillRect(x, y, w * (0.01 + r() * 0.04), Math.max(0.6, h * 0.004));
    }
    // A far headland, soft.
    c.fillStyle = rgba(mix(theme.bg, theme.accent2, 0.3), 0.85);
    c.beginPath();
    c.moveTo(0, h * 0.62);
    c.quadraticCurveTo(w * 0.12, h * 0.52, w * 0.3, h * 0.6);
    c.lineTo(w * 0.34, h * 0.62);
    c.closePath();
    c.fill();
    // Film: vignette and grain.
    const v = c.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    c.fillStyle = v;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 60; i++) {
      c.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
      c.fillRect(r() * w, r() * h, 1, 1);
    }
  };
}

type Lay = {
  pol: { x: number; y: number; s: number; a: number };
  note: { x: number; y: number; w: number; h: number; a: number };
  tag: { x: number; y: number; w: number; h: number; a: number };
  ticket: { x: number; y: number; w: number; h: number; a: number };
};

function layOf(w: number, h: number): Lay {
  const { portrait, square } = frameOf(w, h);
  if (portrait)
    return {
      pol: { x: w * 0.52, y: h * 0.47, s: w * 0.66, a: -0.05 },
      note: { x: w * 0.3, y: h * 0.2, w: w * 0.5, h: h * 0.22, a: -0.07 },
      tag: { x: w * 0.76, y: h * 0.8, w: w * 0.3, h: h * 0.16, a: 0.12 },
      ticket: { x: w * 0.3, y: h * 0.84, w: w * 0.42, h: h * 0.08, a: -0.06 },
    };
  if (square)
    return {
      pol: { x: w * 0.56, y: h * 0.5, s: w * 0.5, a: -0.05 },
      note: { x: w * 0.22, y: h * 0.34, w: w * 0.34, h: h * 0.44, a: -0.07 },
      tag: { x: w * 0.82, y: h * 0.18, w: w * 0.2, h: h * 0.24, a: 0.14 },
      ticket: { x: w * 0.28, y: h * 0.85, w: w * 0.4, h: h * 0.1, a: -0.05 },
    };
  return {
    pol: { x: w * 0.55, y: h * 0.5, s: h * 0.66, a: -0.05 },
    note: { x: w * 0.23, y: h * 0.44, w: w * 0.25, h: h * 0.58, a: -0.06 },
    tag: { x: w * 0.83, y: h * 0.3, w: w * 0.12, h: h * 0.32, a: 0.12 },
    ticket: { x: w * 0.8, y: h * 0.8, w: w * 0.22, h: h * 0.11, a: -0.08 },
  };
}

/** The page and everything already on it: a lined note, a kraft tag, a ticket, tapes, doodles. */
function basePage(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const { u } = frameOf(w, h);
    darkPaper(theme, 66, { fibres: 1.2, mottle: 1.2, tone: 0.03 })(c, w, h);
    const L = layOf(w, h);
    const paper = mix(theme.ink, theme.bg, 0.14);
    const kraft = mix(mix(theme.ink, theme.accent, 0.25), theme.bg, 0.5);
    const place = (
      b: { x: number; y: number; w: number; h: number; a: number },
      draw: (W: number, H: number) => void,
    ) => {
      c.save();
      c.translate(b.x, b.y);
      c.rotate(b.a);
      c.translate(-b.w / 2, -b.h / 2);
      draw(b.w, b.h);
      c.restore();
    };
    // Lined note torn from a notebook, with a handwritten list.
    place(L.note, (W, H) => {
      const pts: Pt[] = [[0, 0], [W, 0], ...tornLine([W, H], [0, H], 12, u * 0.008, u * 0.008)];
      pts.splice(2, 0, [W, H]);
      withShadow(c, u * 0.025, u * 0.004, u * 0.01, "rgba(0,0,0,0.6)", () => {
        polyPath(c, pts);
        c.fillStyle = paper;
        c.fill();
      });
      c.save();
      polyPath(c, pts);
      c.clip();
      c.strokeStyle = rgba(theme.accent2, 0.35);
      c.lineWidth = Math.max(0.6, u * 0.0015);
      const lh = H * 0.075;
      for (let y = H * 0.16; y < H; y += lh) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(W, y);
        c.stroke();
      }
      c.strokeStyle = rgba(theme.accent, 0.45);
      c.beginPath();
      c.moveTo(W * 0.14, 0);
      c.lineTo(W * 0.14, H);
      c.stroke();
      c.fillStyle = rgba(theme.bg, 0.78);
      c.font = font(600, lh * 0.95, "Caveat", HAND);
      c.textBaseline = "alphabetic";
      const lines = ["to keep:", "the light at 6pm", "salt on the rail", "that one song"];
      lines.forEach((s, i) => c.fillText(s, W * 0.2, H * 0.16 + lh * (i + 1) - lh * 0.15));
      c.restore();
    });
    // Kraft tag with a reinforced hole and string.
    place(L.tag, (W, H) => {
      const cut = W * 0.28;
      const pts: Pt[] = [
        [cut, 0],
        [W - cut, 0],
        [W, cut],
        [W, H],
        [0, H],
        [0, cut],
      ];
      withShadow(c, u * 0.02, u * 0.004, u * 0.008, "rgba(0,0,0,0.6)", () => {
        polyPath(c, pts);
        c.fillStyle = kraft;
        c.fill();
      });
      c.fillStyle = mix(kraft, theme.ink, 0.25);
      c.beginPath();
      c.arc(W / 2, cut * 0.9, W * 0.13, 0, TAU);
      c.fill();
      c.fillStyle = theme.bg;
      c.beginPath();
      c.arc(W / 2, cut * 0.9, W * 0.06, 0, TAU);
      c.fill();
      c.strokeStyle = rgba(theme.ink, 0.6);
      c.lineWidth = Math.max(0.8, u * 0.002);
      c.beginPath();
      c.moveTo(W / 2, cut * 0.9);
      c.bezierCurveTo(W * 0.9, -H * 0.2, W * 1.2, -H * 0.1, W * 1.4, -H * 0.35);
      c.stroke();
      c.fillStyle = rgba(theme.bg, 0.75);
      c.font = font(400, W * 0.16, "Special Elite", TYPE);
      c.textAlign = "center";
      c.fillText("No. 26", W / 2, H * 0.62);
      c.font = font(600, W * 0.2, "Caveat", HAND);
      c.fillText("keep", W / 2, H * 0.82);
    });
    // Ticket stub.
    place(L.ticket, (W, H) => {
      withShadow(c, u * 0.02, u * 0.004, u * 0.008, "rgba(0,0,0,0.6)", () => {
        c.fillStyle = mix(theme.accent2, theme.bg, 0.25);
        c.fillRect(0, 0, W, H);
      });
      c.strokeStyle = rgba(theme.ink, 0.5);
      c.setLineDash([u * 0.006, u * 0.006]);
      c.lineWidth = Math.max(0.8, u * 0.002);
      c.beginPath();
      c.moveTo(W * 0.72, 0);
      c.lineTo(W * 0.72, H);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = rgba(theme.ink, 0.85);
      c.font = font(400, H * 0.3, "Special Elite", TYPE);
      c.textBaseline = "middle";
      c.fillText("ADMIT ONE", W * 0.07, H * 0.52);
      c.font = font(400, H * 0.26, "Special Elite", TYPE);
      c.fillText("07", W * 0.78, H * 0.52);
    });
    // Tapes already holding the base pieces.
    const strip = (
      x: number,
      y: number,
      a: number,
      len: number,
      col: string,
      pat: number,
      seed: number,
    ) => {
      const tw = len;
      const th = u * 0.05;
      const img = bake(
        `washi-tape:${col}|${pat}|${seed}|${theme.ink}${theme.bg}`,
        tw,
        th,
        tape(theme, col, pat, seed),
      );
      c.save();
      c.translate(x, y);
      c.rotate(a);
      withShadow(c, u * 0.006, 0, u * 0.002, "rgba(0,0,0,0.35)", () =>
        c.drawImage(img as CanvasImageSource, -tw / 2, -th / 2),
      );
      c.restore();
    };
    strip(L.note.x, L.note.y - L.note.h * 0.5, 0.05, L.note.w * 0.6, theme.accent2, 1, 31);
    strip(
      L.tag.x - L.tag.w * 0.1,
      L.tag.y + L.tag.h * 0.35,
      -0.5,
      L.tag.w * 1.2,
      theme.accent,
      2,
      32,
    );
    strip(
      L.ticket.x - L.ticket.w * 0.45,
      L.ticket.y,
      1.2,
      L.ticket.h * 1.6,
      mix(theme.ink, theme.accent, 0.3),
      0,
      33,
    );
    // White gel-pen doodles on the black page.
    c.strokeStyle = rgba(theme.ink, 0.7);
    c.lineWidth = Math.max(1, u * 0.0028);
    c.lineCap = "round";
    const star = (x: number, y: number, r: number) => {
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        c.moveTo(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25);
        c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      c.stroke();
    };
    const r = rng(8);
    for (let i = 0; i < 5; i++)
      star(
        w * (0.05 + r() * 0.9),
        h * (0.06 + r() * 0.1 + (i % 2) * 0.8),
        u * (0.012 + r() * 0.012),
      );
  };
}

export const style: MotionStyle = {
  id: "washi-scrapbook",
  name: "Washi Scrapbook",
  family: "Print & Craft",
  tagline: "A taped-in scrapbook page",
  look: "A black scrapbook page: a lined note, a kraft tag and a ticket under washi tape, a polaroid taped in, captions in gel pen.",
  move: "Stop-motion at 12 fps: a polaroid drops in, washi slaps across its corners, the caption writes itself, then it's peeled off.",
  rules: [
    "Washi is translucent: you see the photo and paper through it.",
    "Tape ends are torn by hand, fibrous, never cut square.",
    "Everything on the page casts a soft shadow; a lifted piece casts a wider one.",
    "Handwriting writes on stroke by stroke, never fades in.",
    "Animate on twos (12 fps) with a hair of hand jitter.",
    "The page is never empty: the hero piece arrives on a page already lived in.",
    "Hold the finished page at least 1.2 s.",
  ],
  prompt: `R — References
• Journaling and scrapbook spreads with washi tape (search: washi tape scrapbook black paper, polaroid journal page).
• Stop-motion paper craft: things placed by hand, one frame at a time.

I — Idea
A page gets a new photo, 5 seconds, looping seamlessly:
• Beginning (0–1.2 s): on a black scrapbook page with a lined note, a kraft tag and a ticket, a polaroid drops in; a pink dotted strip and a mint striped strip of washi slap across its corners.
• Middle (1.2–4 s): "{{name}}" writes itself in white gel pen on the polaroid's margin with a small doodle; hold.
• End (4–5 s): the tapes peel up and the polaroid is slid off the page, leaving the page as it began.

S — Style
Looks: {{bg}} black kraft page with fibres; paper pieces in {{ink}} and kraft tones; washi in {{accent}} and {{accent2}} with dots, stripes and grid, translucent, torn ends; a sunset photo in the polaroid; handwriting in Caveat, labels in a typewriter face.
Moves: 12 fps stop-motion; the polaroid drops with a scale-down and a shadow that tightens; tapes unroll in 0.15 s and press; handwriting writes left to right with a pen tip; exits are quick and eased in.
Rules:
1. Translucent washi.
2. Torn tape ends.
3. Soft shadows, wider when lifted.
4. Handwriting writes on.
5. 12 fps with hand jitter.
6. Never an empty page.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the caption is readable at full size; tape shows the photo through it; nothing is clipped at the frame edge except by design; the page looks handmade, not vector. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Washi_tape",
  theme: {
    bg: "#181512",
    ink: "#f4eee3",
    accent: "#f08aa0",
    accent2: "#6fc2ad",
    font: "Caveat",
  },
  fonts: ["Caveat:wght@500;600;700", "Special Elite"],
  tags: [
    "washi",
    "scrapbook",
    "journal",
    "polaroid",
    "tape",
    "collage",
    "handmade",
    "paper",
    "memories",
    "craft",
    "stop motion",
  ],
  word: "Summer",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const { frame, tq } = stepped(t, FPS);
    ground(ctx, w, h, theme.bg);
    const keyTheme = `${theme.bg}${theme.ink}${theme.accent}${theme.accent2}`;
    ctx.drawImage(bake(`washi-base:${keyTheme}`, w, h, basePage(theme)) as CanvasImageSource, 0, 0);
    light(ctx, w * 0.55, h * 0.4, Math.max(w, h) * 0.7, mix(theme.ink, theme.accent, 0.25), 0.08);

    const L = layOf(w, h);
    const P = L.pol;
    const frameW = P.s;
    const frameH = P.s * 1.19;
    const inset = P.s * 0.06;
    const ph = bake(
      `washi-photo:${keyTheme}`,
      frameW - inset * 2,
      frameW - inset * 2,
      photo(theme),
    );
    const jit = (k: number) => (hash(frame, k) - 0.5) * u * 0.0025;

    // Timeline (stepped at 12 fps): drop, tape, write, hold, peel, slide out.
    const drop = ease.outCubic(seg(tq, 0.15, 0.62));
    const out = ease.inCubic(seg(tq, 4.28, 4.85));
    const present = tq >= 0.15 && tq < 4.85;
    if (present) {
      const lift = 1 - drop;
      const scale = 1 + lift * 0.16;
      const px = P.x + out * w * 0.62 + jit(1);
      const py = P.y - lift * h * 0.06 + out * h * 0.2 + jit(2);
      const pa = P.a + lift * 0.18 - out * 0.35;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(pa);
      ctx.scale(scale, scale);
      withShadow(
        ctx,
        u * (0.02 + lift * 0.06),
        u * (0.006 + lift * 0.03),
        u * (0.012 + lift * 0.05),
        `rgba(0,0,0,${(0.62 - lift * 0.2).toFixed(3)})`,
        () => {
          ctx.fillStyle = mix(theme.ink, theme.bg, 0.04);
          ctx.fillRect(-frameW / 2, -frameH / 2, frameW, frameH);
        },
      );
      ctx.drawImage(ph as CanvasImageSource, -frameW / 2 + inset, -frameH / 2 + inset);
      // Caption, written on in white gel... on a white frame it is dark ink.
      const word = wordFor(theme.name, "Summer", 14);
      const cap = `${word}, '26`;
      const capY = -frameH / 2 + inset + (frameW - inset * 2) + (frameH - frameW) * 0.62;
      const size = Math.min(frameH * 0.09, (frameW * 0.62) / Math.max(4, cap.length * 0.42));
      ctx.font = font(700, size, "Caveat", HAND);
      const tw = ctx.measureText(cap).width;
      const wr = seg(tq, 1.2, 2.2);
      if (wr > 0) {
        const x0 = -tw / 2 - size * 0.3;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, capY - size, tw * wr + size * 0.1, size * 1.6);
        ctx.clip();
        ctx.fillStyle = mix(theme.bg, theme.accent2, 0.15);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(cap, x0, capY + size * 0.3);
        ctx.restore();
        if (wr < 1) {
          ctx.fillStyle = rgba(theme.bg, 0.7);
          ctx.beginPath();
          ctx.arc(
            x0 + tw * wr,
            capY + size * 0.05 + Math.sin(wr * 40) * size * 0.15,
            size * 0.06,
            0,
            TAU,
          );
          ctx.fill();
        }
      }
      // A small doodled heart after the caption.
      const hd = seg(tq, 2.2, 2.5);
      if (hd > 0) {
        const hx = tw / 2 + size * 0.2;
        const hy = capY - size * 0.05;
        const s = size * 0.32;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = Math.max(1, size * 0.07);
        ctx.lineCap = "round";
        ctx.beginPath();
        const n = Math.max(2, Math.round(24 * hd));
        for (let i = 0; i <= n; i++) {
          const a = (i / 24) * TAU;
          const x = hx + (s * 16 * Math.pow(Math.sin(a), 3)) / 16;
          const y =
            hy -
            (s * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))) /
              16;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      const mark = tintedLogo(theme, rgba(theme.bg, 0.6), frameH * 0.08, frameH * 0.08);
      if (mark)
        ctx.drawImage(
          mark as CanvasImageSource,
          frameW / 2 - inset - frameH * 0.08,
          capY - frameH * 0.06,
        );
      ctx.restore();

      // Two strips of washi slap across the top corners, then peel away first.
      const tapes: [number, number, number, string, number, number][] = [
        [-1, 0.72, -0.72, theme.accent, 0, 41],
        [1, 0.95, 0.66, theme.accent2, 1, 42],
      ];
      for (const [side, tin, ang, col, pat, seed] of tapes) {
        const lay = ease.outCubic(seg(tq, tin, tin + 0.16));
        const peel = ease.inCubic(seg(tq, 4.0 + (side > 0 ? 0.1 : 0), 4.3 + (side > 0 ? 0.1 : 0)));
        if (lay <= 0 || peel >= 1) continue;
        const len = frameW * 0.42;
        const th = u * 0.055;
        const img = bake(
          `washi-tape:${col}|${pat}|${seed}|${theme.ink}${theme.bg}`,
          len,
          th,
          tape(theme, col, pat, seed),
        );
        // The corner the tape holds, in page space (follows the photo while it is down).
        const cx0 = P.x + Math.cos(P.a) * ((side * frameW) / 2) - Math.sin(P.a) * (-frameH / 2);
        const cy0 = P.y + Math.sin(P.a) * ((side * frameW) / 2) + Math.cos(P.a) * (-frameH / 2);
        const tx = cx0 + peel * side * w * 0.25 + jit(3 + side);
        const ty = cy0 - peel * h * 0.35 + jit(5 + side);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(ang + peel * side * 0.6);
        const sc = 1 + peel * 0.25 + (1 - lay) * 0.12;
        ctx.scale(sc, sc);
        withShadow(
          ctx,
          u * (0.006 + peel * 0.03),
          0,
          u * (0.002 + peel * 0.02),
          "rgba(0,0,0,0.35)",
          () => {
            ctx.drawImage(
              img as CanvasImageSource,
              0,
              0,
              len * lay,
              th,
              -len / 2,
              -th / 2,
              len * lay,
              th,
            );
          },
        );
        ctx.restore();
      }
    }

    vignette(ctx, w, h, "#000000", 0.45);
    grain(ctx, w, h, t, 0.28);
  },
};
