import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  fbm3,
  font,
  frameOf,
  grain,
  ground,
  light,
  once,
  seg,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { along, fmt, glow, strokeTrack, tabular, track, unit, type Track } from "./_s6-helpers";

const MONO = '"Red Hat Mono", "SFMono-Regular", Menlo, monospace';
const LEG = 1.25;
const TRAVEL = 0.92;
/** Made-up stops and leg distances (km) of a closed loop. */
const CITIES = ["Aldren", "Port Vey", "Solmere", "Karsa"];
const KM = [1284, 972, 1530, 1334];
/** Pin positions in map space (x across, y down), per aspect. */
const PINS = {
  wide: [
    [-0.55, 0.22],
    [0.08, -0.34],
    [0.86, -0.12],
    [0.52, 0.5],
  ],
  tall: [
    [-0.18, -0.62],
    [0.3, -0.1],
    [-0.08, 0.48],
    [-0.4, 0.02],
  ],
  square: [
    [-0.5, 0.05],
    [0.02, -0.42],
    [0.58, -0.05],
    [0.18, 0.5],
  ],
} as const;

function geometry(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const S = Math.min(w, h) * (portrait ? 0.62 : square ? 0.5 : 0.5);
  const cx = w * (portrait ? 0.5 : square ? 0.5 : 0.53);
  const cy = h * (portrait ? 0.52 : square ? 0.56 : 0.55);
  const pins = (portrait ? PINS.tall : square ? PINS.square : PINS.wide).map(
    ([x, y]) => [cx + x * S, cy + y * S] as [number, number],
  );
  return { portrait, square, S, cx, cy, pins };
}

/** Land height at a screen point: noise plus bumps under each pin, so every stop is on land. */
function landAt(x: number, y: number, g: ReturnType<typeof geometry>): number {
  const mx = (x - g.cx) / g.S;
  const my = (y - g.cy) / g.S;
  let v = fbm3(mx * 1.5 + 11.3, my * 1.5 + 4.1, 0.73, 4) * 1.5;
  for (const [px, py] of g.pins) {
    const d2 = ((x - px) ** 2 + (y - py) ** 2) / (g.S * 0.3) ** 2;
    v += 0.36 * Math.exp(-d2);
  }
  const r = Math.hypot(mx * 0.55, my * 0.75);
  return v - 0.08 - 0.34 * r * r;
}

/** Dot-matrix land on a hex grid: dot size follows elevation. */
function mapLayer(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const g = geometry(w, h);
    const U = unit(w, h);
    const sp = 13 * U;
    const rowH = sp * 0.866;
    for (let j = 0, y = rowH / 2; y < h + rowH; j++, y += rowH) {
      const off = j % 2 ? sp / 2 : 0;
      for (let x = off; x < w + sp; x += sp) {
        const v = landAt(x, y, g);
        if (v > 0) {
          const k = clamp(v / 0.45);
          const coast = v < 0.035 ? 0.14 : 0;
          c.fillStyle = rgba(theme.ink, 0.38 + 0.4 * k + coast);
          c.beginPath();
          c.arc(x, y, sp * (0.2 + 0.14 * k), 0, TAU);
          c.fill();
        } else if (j % 2 === 0 && Math.round(x / sp) % 2 === 0) {
          c.fillStyle = rgba(theme.ink, 0.05);
          c.fillRect(x - 0.7 * U, y - 0.7 * U, 1.4 * U, 1.4 * U);
        }
      }
    }
    // Graticule: faint dashed meridians and parallels, with degree ticks at the edge.
    c.strokeStyle = rgba(theme.ink, 0.07);
    c.lineWidth = Math.max(1, U);
    c.setLineDash([2 * U, 7 * U]);
    const stepG = g.S * 0.5;
    for (let x = g.cx % stepG; x < w; x += stepG) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = g.cy % stepG; y < h; y += stepG) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.setLineDash([]);
    // Scrims under the title and the leg card, like a broadcast lower third.
    const top = c.createLinearGradient(0, 0, 0, h * 0.3);
    top.addColorStop(0, rgba(theme.bg, 0.9));
    top.addColorStop(1, rgba(theme.bg, 0));
    c.fillStyle = top;
    c.fillRect(0, 0, w, h * 0.3);
    const bottom = c.createLinearGradient(0, h * 0.66, 0, h);
    bottom.addColorStop(0, rgba(theme.bg, 0));
    bottom.addColorStop(1, rgba(theme.bg, 0.92));
    c.fillStyle = bottom;
    c.fillRect(0, h * 0.66, w, h * 0.34);
    c.fillStyle = rgba(theme.ink, 0.32);
    c.font = font(500, 15 * U, "Red Hat Mono", MONO);
    c.textBaseline = "top";
    let lon = 8;
    for (let x = g.cx % stepG; x < w - 60 * U; x += stepG, lon += 6)
      if (x > 30 * U) c.fillText(`${lon}°E`, x + 6 * U, h - 30 * U);
    let lat = 52;
    c.textAlign = "right";
    for (let y = g.cy % stepG; y < h - 40 * U; y += stepG, lat -= 4)
      if (y > 30 * U) c.fillText(`${lat}°N`, w - 16 * U, y + 6 * U);
  };
}

/** Each leg is an arc bowed toward the pole, like a great circle on a flat map. */
function legs(pins: [number, number][], S: number): Track[] {
  return pins.map(([x0, y0], i) => {
    const [x1, y1] = pins[(i + 1) % pins.length];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const bow = 0.2 * d + 0.03 * S;
    // Bow toward the top of the map (the pole).
    let nx = -(y1 - y0) / d;
    let ny = (x1 - x0) / d;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const qx = mx + nx * bow;
    const qy = my + ny * bow;
    return track(80, (u) => [
      (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * qx + u * u * x1,
      (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * qy + u * u * y1,
    ]);
  });
}

export const style: MotionStyle = {
  id: "map-route",
  name: "Route Map",
  family: "Data & Diagrams",
  tagline: "A route arcing over a dot map",
  look: "A dot-matrix map at night: halftone land on a dark sea, a graticule with degree ticks, four pinned stops and a bright arced route.",
  move: "A marker flies each arced leg and lands on the next pin; the pin rings, the leg's distance counts up, the last leg fades as the next draws.",
  rules: [
    "Land is dots on a hex grid; dot size follows the terrain.",
    "Legs are arcs bowed toward the pole, never straight lines.",
    "The marker eases out of each pin and into the next, then dwells.",
    "Only the current leg is solid and bright; the full loop stays dashed.",
    "Each landing rings the pin once; the counter holds the leg's distance.",
    "Labels are mono and small; the leg card is the only big type.",
    "The loop is a closed tour, so the last landing is the first frame.",
  ],
  prompt: `R — References
• Dot-matrix world maps and airline route maps (search: dotted map route animation, halftone map flight path).
• Nautical charts: a graticule with degree ticks at the edge.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a dark sea and dot-matrix land; four pinned stops joined by a dashed loop; a marker lifts off the first pin and flies an arced leg while the leg card counts the kilometres.
• Middle (1.5–3.5 s): it lands (the pin rings), the leg card updates, and it flies the next two legs; each finished leg fades as the next draws.
• End (3.5–5 s): the last leg brings it home to the first pin, exactly where it started.

S — Style
Looks: {{bg}} sea; land as {{ink}} dots whose size follows elevation; a faint dashed graticule with degree labels; the route and marker in {{accent}} with a soft glow; pins in {{accent2}}; a leg card in {{font}} with the distance in tabular digits.
Moves: each leg is 1.25 s: 0.92 s inOutSine flight, 0.33 s dwell; the pin ring expands and fades in 0.6 s; the previous leg fades over the next leg.
Rules:
1. Hex-grid dots for land, never a filled shape.
2. Arced legs, bowed toward the pole.
3. One bright leg at a time.
4. The distance counts during flight and holds on landing.
5. A closed loop: the last landing equals the first frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; every pin sits on land; the marker points along its path; city labels never overlap the route card; the card holds each leg at least 1.2 s. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Great-circle_distance",
  theme: {
    bg: "#070d12",
    ink: "#e3ecf2",
    accent: "#5cc8ff",
    accent2: "#ffcf70",
    font: "Inter",
  },
  fonts: ["Red Hat Mono:wght@300..700"],
  tags: [
    "map",
    "route",
    "travel",
    "journey",
    "flight",
    "logistics",
    "location",
    "pins",
    "path",
    "geography",
    "delivery",
  ],
  word: "Route",
  render(ctx, t, theme, w, h) {
    const g = geometry(w, h);
    const U = unit(w, h) * (g.portrait ? 1.15 : 1);
    ground(ctx, w, h, theme.bg);
    light(ctx, g.cx, g.cy, Math.max(w, h) * 0.6, mix(theme.bg, theme.accent, 0.5), 0.12);
    ctx.drawImage(bake(`route-map:${theme.ink}`, w, h, mapLayer(theme)) as CanvasImageSource, 0, 0);

    const tracks = once(`route-legs:${w}x${h}`, () => legs(g.pins as [number, number][], g.S));
    // The route runs on a clock offset from the loop, so no still lands on a take-off.
    const clock = (((t - 0.35) % 5) + 5) % 5;
    const leg = Math.floor(clock / LEG + 1e-9) % 4;

    // The whole loop, dashed and quiet.
    ctx.strokeStyle = rgba(theme.accent, 0.4);
    ctx.lineWidth = Math.max(1, 1.6 * U);
    ctx.setLineDash([2 * U, 8 * U]);
    ctx.lineCap = "round";
    for (const tr of tracks) strokeTrack(ctx, tr, 0, 1);
    ctx.setLineDash([]);

    // Current leg solid behind the marker; the previous leg fades out.
    let head: { x: number; y: number; tx: number; ty: number } | null = null;
    for (let i = 0; i < 4; i++) {
      const tl = (((clock - i * LEG) % 5) + 5) % 5;
      const tr = tracks[i];
      ctx.lineCap = "round";
      if (tl < LEG) {
        const p = ease.inOutSine(seg(tl, 0, TRAVEL));
        if (p > 0.001) {
          ctx.strokeStyle = rgba(theme.accent, 0.22);
          ctx.lineWidth = 9 * U;
          strokeTrack(ctx, tr, 0, p);
          ctx.strokeStyle = theme.accent;
          ctx.lineWidth = 3 * U;
          strokeTrack(ctx, tr, 0, p);
        }
        head = along(tr, p);
      } else if (tl < 2 * LEG) {
        const fade = 1 - ease.inOutSine(seg(tl, LEG, 2 * LEG - 0.1));
        if (fade > 0.001) {
          ctx.strokeStyle = rgba(theme.accent, 0.8 * fade);
          ctx.lineWidth = 3 * U;
          strokeTrack(ctx, tr, 0, 1);
        }
      }
    }

    // Pins: ring on landing, label beside.
    const legT = clock - leg * LEG;
    for (let i = 0; i < 4; i++) {
      const [px, py] = g.pins[i];
      const arrivedAt = ((i + 3) % 4) * LEG + TRAVEL;
      const since = (((clock - arrivedAt) % 5) + 5) % 5;
      const ring = since < 0.9 ? since / 0.9 : 1;
      const active = i === leg || (i === (leg + 1) % 4 && legT > TRAVEL);
      glow(ctx, px, py, 34 * U, theme.accent2, active ? 0.5 : 0.22);
      if (ring < 1) {
        ctx.strokeStyle = rgba(theme.accent2, (1 - ring) * 0.9);
        ctx.lineWidth = Math.max(1, 2 * U);
        ctx.beginPath();
        ctx.arc(px, py, (10 + 42 * ease.outCubic(ring)) * U, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = theme.bg;
      ctx.beginPath();
      ctx.arc(px, py, 9 * U, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = theme.accent2;
      ctx.lineWidth = 2.4 * U;
      ctx.stroke();
      ctx.fillStyle = theme.accent2;
      ctx.beginPath();
      ctx.arc(px, py, 3.6 * U, 0, TAU);
      ctx.fill();
      const leftSide = px > g.cx + g.S * 0.3;
      ctx.textBaseline = "middle";
      ctx.textAlign = leftSide ? "right" : "left";
      // Map labels carry a halo in the sea colour so routes never cut through them.
      const lx = px + (leftSide ? -22 : 22) * U;
      ctx.lineJoin = "round";
      ctx.strokeStyle = rgba(theme.bg, 0.85);
      ctx.lineWidth = 7 * U;
      ctx.font = font(500, 24 * U, theme.font);
      ctx.strokeText(CITIES[i], lx, py - 9 * U);
      ctx.fillStyle = rgba(theme.ink, active ? 1 : 0.72);
      ctx.fillText(CITIES[i], lx, py - 9 * U);
      ctx.font = font(500, 14 * U, "Red Hat Mono", MONO);
      ctx.lineWidth = 5 * U;
      ctx.strokeText(`STOP 0${i + 1}`, lx, py + 15 * U);
      ctx.fillStyle = rgba(theme.ink, 0.5);
      ctx.fillText(`STOP 0${i + 1}`, lx, py + 15 * U);
    }

    // The marker: a navigation chevron along the tangent.
    if (head) {
      glow(ctx, head.x, head.y, 46 * U, theme.accent, 0.6);
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(Math.atan2(head.ty, head.tx));
      const s = 15 * U;
      ctx.fillStyle = mix(theme.accent, theme.ink, 0.55);
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.75, s * 0.68);
      ctx.lineTo(-s * 0.35, 0);
      ctx.lineTo(-s * 0.75, -s * 0.68);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Title and the leg card.
    const L = Math.max(w * (g.portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(700, 50 * U, theme.font);
    ctx.letterSpacing = `${(-1 * U).toFixed(2)}px`;
    ctx.fillText("The northern loop", L, h * (g.portrait ? 0.09 : 0.14));
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.font = font(500, 16 * U, "Red Hat Mono", MONO);
    ctx.fillText(
      `4 STOPS · ${fmt(KM.reduce((s2, k) => s2 + k, 0))} KM`,
      L,
      h * (g.portrait ? 0.09 : 0.14) + 34 * U,
    );

    const cardY = h * (g.portrait ? 0.9 : 0.87);
    const fly = ease.inOutSine(seg(legT, 0, TRAVEL));
    const km = Math.round(KM[leg] * fly);
    ctx.fillStyle = rgba(theme.accent, 1);
    ctx.font = font(500, 15 * U, "Red Hat Mono", MONO);
    ctx.letterSpacing = `${(2 * U).toFixed(2)}px`;
    ctx.fillText(`LEG ${leg + 1} OF 4`, L, cardY - 88 * U);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.ink, 0.72);
    ctx.font = font(500, 22 * U, theme.font);
    ctx.fillText(`${CITIES[leg]} — ${CITIES[(leg + 1) % 4]}`, L, cardY - 58 * U);
    ctx.fillStyle = theme.ink;
    ctx.font = font(400, 72 * U, theme.font);
    const kw = tabular(ctx, fmt(km), L, cardY + 4 * U, "left", -1.5 * U);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.font = font(500, 22 * U, "Red Hat Mono", MONO);
    ctx.fillText("km", L + kw + 10 * U, cardY + 2 * U);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.22);
  },
};
