import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  hash,
  light,
  once,
  seg,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle } from "../engine/types";
import { fmt, glow, studio, tabular, unit } from "./_s6-helpers";

const N = 8;
const ROAD_X = 3;
const ROAD_Y = 5;
const FLOOR = 0.2;
const GROTESK = '"Space Grotesk", "Helvetica Neue", Arial, sans-serif';

type Tile = {
  gx: number;
  gy: number;
  kind: "road" | "park" | "tower" | "plaza";
  floors: number;
  crown: number;
  cols: number;
  d: number;
  id: number;
};

/** The block plan: roads on one row and one column, a downtown that peaks off-centre. */
const PLAN = once("iso-city:plan", () => {
  const tiles: Tile[] = [];
  let id = 0;
  for (let gy = 0; gy < N; gy++)
    for (let gx = 0; gx < N; gx++) {
      const road = gx === ROAD_X || gy === ROAD_Y;
      const r = hash(gx, gy, 71);
      const dc = Math.hypot(gx - 2.6, gy - 3.2);
      let kind: Tile["kind"] = road ? "road" : r < 0.13 ? "park" : r < 0.19 ? "plaza" : "tower";
      if ((gx === 6 && gy === 1) || (gx === 1 && gy === 6)) kind = "park";
      const tall = Math.max(0, 1 - dc / 5.2);
      const floors = Math.round(2 + tall * tall * 13 + hash(gx, gy, 5) * 3);
      tiles.push({
        gx,
        gy,
        kind,
        floors,
        crown: floors > 9 && hash(gx, gy, 9) < 0.6 ? Math.round(2 + hash(gx, gy, 13) * 3) : 0,
        cols: floors > 8 ? 3 : 2,
        d: Math.hypot(gx - 3.5, gy - 3.5),
        id: id++,
      });
    }
  const towers = tiles.filter((t) => t.kind === "tower");
  const tallest = [...towers].sort((a, b) => b.floors + b.crown - (a.floors + a.crown)).slice(0, 3);
  const total = towers.reduce((s, t) => s + t.floors + t.crown, 0);
  return { tiles, tallest: new Set(tallest.map((t) => t.id)), total };
});

function layoutOf(w: number, h: number) {
  const { portrait, square } = frameOf(w, h);
  const U = unit(w, h) * (portrait ? 1.15 : 1);
  const a = portrait
    ? (w * 0.94) / (2 * N)
    : square
      ? (w * 0.86) / (2 * N)
      : Math.min((w * 0.72) / (2 * N), (h * 0.6) / N);
  return {
    U,
    portrait,
    square,
    a,
    ox: w * (portrait || square ? 0.5 : 0.53),
    oy: portrait ? h * 0.45 : square ? h * 0.4 : h * 0.3,
    zk: portrait ? 2.1 : square ? 1.1 : 1,
  };
}

export const style: MotionStyle = {
  id: "isometric-city",
  name: "Isometric City",
  family: "Data & Diagrams",
  tagline: "An isometric city at dusk",
  look: "A dusk isometric block plan: three-tone towers in brand blue, warm lit windows, a road cross with headlights, floor tags on the tallest.",
  move: "Towers rise out of the plan in a ripple from the centre, windows flicker on, cars run the roads, then the city sinks back into the grid.",
  rules: [
    "True isometric: 2:1 tiles, three faces lit top, left and right.",
    "Every tower is the same blue in three tones; only windows are warm.",
    "Rise in a ripple from the centre with a small overshoot, never all at once.",
    "Windows light after a tower lands; a few flicker on whole seconds.",
    "Only the three tallest towers get a floor tag.",
    "The empty plan (footprints on the grid) is the first and last frame.",
    "Painter's order: back tiles first, so no tower cuts through another.",
  ],
  prompt: `R — References
• Isometric city illustrations and SimCity-style block plans (search: isometric city illustration dusk, isometric infographic buildings).
• Architectural massing models: one material, light from the top left.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): an empty isometric block plan (tile grid, footprints, a road cross); towers rise out of it in a ripple from the centre, each overshooting slightly.
• Middle (1.5–3.5 s): windows flicker on in a warm tone, small cars with headlights run the roads, the three tallest towers show floor tags, a counter reads the floors built.
• End (3.5–5 s): the lights go out and the towers sink back into the grid from the outside in, landing on the empty plan.

S — Style
Looks: {{bg}} dusk ground; towers in {{accent2}} as three tones (light top, mid left face, dark right face); lit windows and headlights in {{accent}}; tags and title in {{font}}; faint grid lines on the plan.
Moves: each tower rises 0.7 s with outBack, staggered 0.12 s per tile of distance from the centre; windows fade on over 0.6 s after landing; cars move at constant speed and fade at the edges; the sink is 0.5 s inOutCubic, outside in.
Rules:
1. 2:1 isometric projection, painter's order back to front.
2. One building colour in three tones; warmth only in windows.
3. Ripple timing from the centre; never everything at once.
4. Floor tags only on the three tallest towers.
5. The empty plan is the first and last frame.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no tower draws over one in front of it; windows sit inside their faces; tags never overlap each other; the city fills the stage at every aspect. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Isometric_video_game_graphics",
  theme: {
    bg: "#0a0e1a",
    ink: "#e8ecf7",
    accent: "#ffc35c",
    accent2: "#5b6cff",
    font: "Space Grotesk",
  },
  fonts: ["Space Grotesk:wght@300..700"],
  tags: [
    "isometric",
    "city",
    "buildings",
    "3d",
    "architecture",
    "urban",
    "blocks",
    "map",
    "infographic",
    "growth",
    "construction",
  ],
  word: "District",
  render(ctx, t, theme, w, h) {
    const lay = layoutOf(w, h);
    const { U, a, ox, oy, zk } = lay;
    const P = (gx: number, gy: number, z: number): [number, number] => [
      ox + (gx - gy) * a,
      oy + ((gx + gy) * a) / 2 - z * a * zk,
    ];
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "iso", w, h, {
        lx: 0.5,
        ly: 0.0,
        tint: mix(theme.ink, theme.accent2, 0.5),
      }) as CanvasImageSource,
      0,
      0,
    );
    const [ccx, ccy] = P(N / 2, N / 2, 0);
    light(ctx, ccx, ccy, a * N * 1.1, theme.accent2, 0.1);

    const { tiles, tallest, total } = PLAN;
    const base = mix(theme.accent2, theme.bg, 0.46);
    const cTop = mix(base, theme.ink, 0.3);
    const cLeft = base;
    const cRight = mix(base, theme.bg, 0.5);
    const winOff = mix(base, theme.bg, 0.62);

    // The plan: ground tiles, grid, roads, parks, footprints (baked once per theme and size).
    const plan = bake(`iso-plan:${theme.bg}${theme.ink}${theme.accent2}`, w, h, (c) => {
      const poly = (pts: [number, number][]) => {
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.closePath();
      };
      // Plinth under the whole plan.
      const e = 0.18;
      poly([P(0, N, 0), P(N, N, 0), P(N, N, -e), P(0, N, -e)]);
      c.fillStyle = mix(theme.bg, theme.accent2, 0.14);
      c.fill();
      poly([P(N, 0, 0), P(N, N, 0), P(N, N, -e), P(N, 0, -e)]);
      c.fillStyle = mix(theme.bg, theme.accent2, 0.08);
      c.fill();
      for (const tl of tiles) {
        const { gx, gy } = tl;
        poly([P(gx, gy, 0), P(gx + 1, gy, 0), P(gx + 1, gy + 1, 0), P(gx, gy + 1, 0)]);
        c.fillStyle =
          tl.kind === "road"
            ? mix(theme.bg, "#000000", 0.3)
            : tl.kind === "park"
              ? mix(theme.bg, theme.accent2, 0.2)
              : mix(theme.bg, theme.accent2, 0.1);
        c.fill();
        c.strokeStyle = rgba(theme.ink, 0.07);
        c.lineWidth = Math.max(1, 0.012 * a);
        c.stroke();
        if (tl.kind === "tower") {
          const m = 0.14;
          poly([
            P(gx + m, gy + m, 0),
            P(gx + 1 - m, gy + m, 0),
            P(gx + 1 - m, gy + 1 - m, 0),
            P(gx + m, gy + 1 - m, 0),
          ]);
          c.strokeStyle = rgba(theme.ink, 0.3);
          c.setLineDash([0.05 * a, 0.05 * a]);
          c.stroke();
          c.setLineDash([]);
        }
        if (tl.kind === "road") {
          c.strokeStyle = rgba(theme.ink, 0.22);
          c.lineWidth = Math.max(1, 0.02 * a);
          c.setLineDash([0.12 * a, 0.12 * a]);
          c.beginPath();
          if (gx === ROAD_X && gy !== ROAD_Y) {
            c.moveTo(...P(gx + 0.5, gy, 0));
            c.lineTo(...P(gx + 0.5, gy + 1, 0));
          } else if (gy === ROAD_Y && gx !== ROAD_X) {
            c.moveTo(...P(gx, gy + 0.5, 0));
            c.lineTo(...P(gx + 1, gy + 0.5, 0));
          }
          c.stroke();
          c.setLineDash([]);
        }
        if (tl.kind === "park")
          for (let k = 0; k < 4; k++) {
            const tx = gx + 0.25 + (k % 2) * 0.5 + (hash(tl.id, k, 1) - 0.5) * 0.12;
            const ty = gy + 0.25 + Math.floor(k / 2) * 0.5 + (hash(tl.id, k, 2) - 0.5) * 0.12;
            const [px, py] = P(tx, ty, 0);
            const rr = a * (0.13 + hash(tl.id, k, 3) * 0.05);
            c.fillStyle = rgba("#000000", 0.35);
            c.beginPath();
            c.ellipse(px + rr * 0.3, py, rr, rr * 0.5, 0, 0, TAU);
            c.fill();
            const g = c.createRadialGradient(
              px - rr * 0.35,
              py - rr * 1.3,
              rr * 0.1,
              px,
              py - rr * 0.9,
              rr,
            );
            g.addColorStop(0, mix(theme.accent2, theme.ink, 0.45));
            g.addColorStop(1, mix(theme.accent2, theme.bg, 0.55));
            c.fillStyle = g;
            c.beginPath();
            c.arc(px, py - rr * 0.9, rr, 0, TAU);
            c.fill();
          }
      }
    });
    ctx.drawImage(plan as CanvasImageSource, 0, 0);

    // Cars on the roads: constant speed, fading in and out at the plan's edge.
    for (let k = 0; k < 4; k++) {
      const along = ((((t / 5) * (k % 2 ? 2 : 1) + k * 0.31) % 1) + 1) % 1;
      const fade = clamp(Math.min(along, 1 - along) * 8);
      const lane = k < 2 ? 0.34 : 0.66;
      const [cx, cy] =
        k % 2 === 0
          ? P(ROAD_X + lane, k === 0 ? along * N : N - along * N, 0.02)
          : P(k === 1 ? along * N : N - along * N, ROAD_Y + lane, 0.02);
      glow(ctx, cx, cy, a * 0.45, theme.accent, 0.5 * fade);
      ctx.fillStyle = rgba(mix(theme.accent, theme.ink, 0.5), fade);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, a * 0.045), 0, TAU);
      ctx.fill();
    }

    // Towers, back to front.
    const maxD = 5;
    let built = 0;
    const tags: { x: number; y: number; floors: number; alpha: number }[] = [];
    const quad = (c: Ctx2D, p: [number, number][]) => {
      c.moveTo(p[0][0], p[0][1]);
      c.lineTo(p[1][0], p[1][1]);
      c.lineTo(p[2][0], p[2][1]);
      c.lineTo(p[3][0], p[3][1]);
      c.closePath();
    };
    for (const tl of tiles) {
      if (tl.kind !== "tower") continue;
      const riseA = 0.2 + tl.d * 0.12;
      const up = ease.outBack(seg(t, riseA, riseA + 0.7));
      const downA = 3.85 + (maxD - tl.d) * 0.1;
      const down = ease.inOutCubic(seg(t, downA, downA + 0.5));
      const k = up * (1 - down);
      if (k <= 0.001) continue;
      const floorsNow = (tl.floors + tl.crown) * clamp(k);
      built += floorsNow;
      const lit =
        clamp(seg(t, riseA + 0.55, riseA + 1.15)) * (1 - clamp(seg(t, downA - 0.35, downA)));
      const m = 0.14;
      const boxes: [number, number, number, number][] = [[m, 1 - m, 0, tl.floors * FLOOR * k]];
      if (tl.crown)
        boxes.push([0.3, 0.7, tl.floors * FLOOR * k, (tl.floors + tl.crown) * FLOOR * k]);
      for (let bi = 0; bi < boxes.length; bi++) {
        const [i0, i1, z0, z1] = boxes[bi];
        if (z1 - z0 < 0.002) continue;
        const x0 = tl.gx + i0;
        const x1 = tl.gx + i1;
        const y0 = tl.gy + i0;
        const y1 = tl.gy + i1;
        // Right face (x = x1), left face (y = y1), top.
        // Faces darken toward the ground (ambient occlusion), so nothing reads flat.
        const [, gy0] = P(x1, y1, z0);
        const [, gy1] = P(x1, y1, Math.max(z1, z0 + 0.6));
        const shade = (c: string) => {
          const g = ctx.createLinearGradient(0, gy0, 0, gy1);
          g.addColorStop(0, mix(c, "#000000", 0.42));
          g.addColorStop(0.45, c);
          g.addColorStop(1, mix(c, theme.ink, 0.05));
          return g;
        };
        ctx.fillStyle = shade(cRight);
        ctx.beginPath();
        quad(ctx, [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)]);
        ctx.fill();
        ctx.fillStyle = shade(cLeft);
        ctx.beginPath();
        quad(ctx, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]);
        ctx.fill();
        ctx.fillStyle = cTop;
        ctx.beginPath();
        quad(ctx, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]);
        ctx.fill();
        // Edge light on the front corner.
        ctx.strokeStyle = rgba(theme.ink, 0.16);
        ctx.lineWidth = Math.max(1, 0.012 * a);
        ctx.beginPath();
        ctx.moveTo(...P(x1, y1, z0));
        ctx.lineTo(...P(x1, y1, z1));
        ctx.lineTo(...P(x1, y0, z1));
        ctx.moveTo(...P(x1, y1, z1));
        ctx.lineTo(...P(x0, y1, z1));
        ctx.stroke();

        // Windows: one path for lit, one for dark, per face.
        const floors = Math.floor((z1 - z0) / FLOOR + 1e-6);
        const cols = bi === 0 ? tl.cols : 2;
        for (const face of [0, 1]) {
          const litPath = new Path2D();
          const offPath = new Path2D();
          for (let f = 0; f < floors; f++) {
            const za = z0 + (f + 0.3) * FLOOR;
            const zb = z0 + (f + 0.78) * FLOOR;
            for (let cI = 0; cI < cols; cI++) {
              const s0 = (cI + 0.22) / cols;
              const s1 = (cI + 0.78) / cols;
              const pts: [number, number][] =
                face === 0
                  ? [
                      P(x1, y0 + (y1 - y0) * s0, za),
                      P(x1, y0 + (y1 - y0) * s1, za),
                      P(x1, y0 + (y1 - y0) * s1, zb),
                      P(x1, y0 + (y1 - y0) * s0, zb),
                    ]
                  : [
                      P(x0 + (x1 - x0) * s0, y1, za),
                      P(x0 + (x1 - x0) * s1, y1, za),
                      P(x0 + (x1 - x0) * s1, y1, zb),
                      P(x0 + (x1 - x0) * s0, y1, zb),
                    ];
              const hv = hash(tl.id * 7 + bi, f * 5 + cI, face);
              const flick = hash(tl.id, f * 3 + cI + face * 17, Math.floor(t * 2) % 10) < 0.06;
              const on = hv < 0.62 * lit && !flick;
              const target = on ? litPath : offPath;
              target.moveTo(pts[0][0], pts[0][1]);
              target.lineTo(pts[1][0], pts[1][1]);
              target.lineTo(pts[2][0], pts[2][1]);
              target.lineTo(pts[3][0], pts[3][1]);
              target.closePath();
            }
          }
          ctx.fillStyle = winOff;
          ctx.fill(offPath);
          ctx.fillStyle = face === 0 ? mix(theme.accent, theme.bg, 0.18) : theme.accent;
          ctx.fill(litPath);
        }
      }
      if (tallest.has(tl.id)) {
        const zTop = (tl.floors + tl.crown) * FLOOR * k;
        const [tx, ty] = P(tl.gx + 0.5, tl.gy + 0.5, zTop);
        const alpha =
          clamp(seg(t, riseA + 0.75, riseA + 1.05)) *
          (1 - clamp(seg(t, downA - 0.3, downA - 0.05)));
        if (alpha > 0.01) tags.push({ x: tx, y: ty, floors: tl.floors + tl.crown, alpha });
      }
    }

    // Floor tags on the three tallest towers.
    tags.sort((p, q) => p.x - q.x);
    for (let ti = 0; ti < tags.length; ti++) {
      const tg = tags[ti];
      ctx.save();
      ctx.globalAlpha = tg.alpha;
      const lift = (40 + ti * 40) * U;
      ctx.strokeStyle = rgba(theme.ink, 0.7);
      ctx.lineWidth = Math.max(1, 1.3 * U);
      ctx.beginPath();
      ctx.moveTo(tg.x, tg.y - 4 * U);
      ctx.lineTo(tg.x, tg.y - lift);
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(tg.x, tg.y - 2 * U, 3.5 * U, 0, TAU);
      ctx.fill();
      ctx.font = font(500, 22 * U, theme.font, GROTESK);
      const label = `${tg.floors} FL`;
      const tw = ctx.measureText(label).width;
      const bx = tg.x - (tw + 20 * U) / 2;
      const by = tg.y - lift - 34 * U;
      ctx.fillStyle = rgba(theme.bg, 0.86);
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + 20 * U, 32 * U, 4 * U);
      ctx.fill();
      ctx.strokeStyle = rgba(theme.accent, 0.8);
      ctx.lineWidth = Math.max(1, U);
      ctx.stroke();
      ctx.fillStyle = theme.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, tg.x, by + 16.5 * U);
      ctx.restore();
    }

    // Title and the floors counter.
    const L = lay.portrait ? w * 0.09 : w * 0.074;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(500, 54 * U, theme.font, GROTESK);
    ctx.letterSpacing = `${(-0.8 * U).toFixed(2)}px`;
    ctx.fillText("District build-out", L, h * (lay.portrait ? 0.1 : 0.14));
    ctx.letterSpacing = "0px";
    ctx.fillStyle = rgba(theme.ink, 0.5);
    ctx.font = font(400, 22 * U, theme.font, GROTESK);
    ctx.fillText("Block plan, phase two", L, h * (lay.portrait ? 0.1 : 0.14) + 38 * U);

    const cyN = lay.portrait ? h * 0.875 : h * 0.88;
    ctx.fillStyle = theme.ink;
    ctx.font = font(400, 76 * U, theme.font, GROTESK);
    const nw = tabular(ctx, fmt(Math.round(built)), L, cyN, "left");
    ctx.fillStyle = theme.accent;
    ctx.font = font(500, 20 * U, theme.font, GROTESK);
    ctx.letterSpacing = `${(2.4 * U).toFixed(2)}px`;
    ctx.fillText("FLOORS BUILT", L + nw + 18 * U, cyN - 8 * U);
    ctx.fillStyle = rgba(theme.ink, 0.45);
    ctx.fillText(`OF ${fmt(total)}`, L + nw + 18 * U, cyN - 34 * U);
    ctx.letterSpacing = "0px";

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.22);
  },
};
