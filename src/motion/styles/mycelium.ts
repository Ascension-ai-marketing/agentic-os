import { mix, rgba } from "../engine/color";
import {
  bake,
  buffer,
  clamp,
  ease,
  frameOf,
  grain,
  ground,
  hash,
  light,
  once,
  rng,
  seg,
  TAU,
  vignette,
} from "../engine/kit";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { blit, bokeh, glow, mottled, turn } from "./_s7-helpers";

interface Net {
  /** Segments: x0, y0, x1, y1, r1 (radius of the end), weight (0 thin .. 1 trunk). */
  seg: Float32Array;
  n: number;
  /** Segment indices sorted by end radius. */
  order: Uint32Array;
  /** Terminal tips: x, y, r. */
  tips: Float32Array;
  /** Hyphal knots at branch points: x, y, r. */
  knots: Float32Array;
  cx: number;
  cy: number;
  R: number;
}

/** A branching network grown from one spore by seeded random walks. Built once per size. */
function network(w: number, h: number): Net {
  return once(`myc-net@${Math.round(w)}x${Math.round(h)}`, () => {
    const { u } = frameOf(w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const R = Math.hypot(w, h) * 0.5 * 1.04;
    const L = u * 0.0085;
    const r = rng(4242);
    const segs: number[] = [];
    const tips: number[] = [];
    const knots: number[] = [];
    const cell = L * 2.6;
    const gw = Math.ceil(w / cell) + 2;
    const gh = Math.ceil(h / cell) + 2;
    const occ = new Uint8Array(gw * gh);
    type Hypha = { x: number; y: number; a: number; order: number; life: number };
    const queue: Hypha[] = [];
    const arms = 11;
    for (let i = 0; i < arms; i++)
      queue.push({ x: cx, y: cy, a: (i / arms) * TAU + r() * 0.5, order: 0, life: 0 });
    let guard = 0;
    while (queue.length && segs.length < 6 * 22000 && guard++ < 14000) {
      const hy = queue.shift() as Hypha;
      let { x, y, a } = hy;
      const steps = 420;
      for (let s = 0; s < steps; s++) {
        const radial = Math.atan2(y - cy, x - cx);
        // Wander, but keep heading outward.
        let d = radial - a;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        a += (r() - 0.5) * (0.5 + hy.order * 0.08) + d * (hy.order === 0 ? 0.08 : 0.035);
        const nx = x + Math.cos(a) * L;
        const ny = y + Math.sin(a) * L;
        const nr = Math.hypot(nx - cx, ny - cy);
        if (nr > R || nx < -L * 4 || ny < -L * 4 || nx > w + L * 4 || ny > h + L * 4) {
          break;
        }
        const gi = Math.floor(nx / cell) + 1;
        const gj = Math.floor(ny / cell) + 1;
        const k = gj * gw + gi;
        if (gi >= 0 && gj >= 0 && gi < gw && gj < gh) {
          if (occ[k] > 4 && nr > u * 0.06) {
            tips.push(x, y, Math.hypot(x - cx, y - cy));
            break;
          }
          occ[k]++;
        }
        const weight = Math.max(0, 1 - hy.order * 0.28) * (1 - 0.5 * clamp(nr / R));
        segs.push(x, y, nx, ny, nr, weight);
        x = nx;
        y = ny;
        // Branch now and then; deeper orders branch less.
        if (
          r() < Math.max(0.04, 0.12 - hy.order * 0.011) * (0.7 + 1.5 * (nr / R)) &&
          nr > u * 0.02
        ) {
          const side = r() < 0.5 ? -1 : 1;
          queue.push({ x, y, a: a + side * (0.5 + r() * 0.6), order: hy.order + 1, life: s });
          if (r() < 0.25) knots.push(x, y, nr);
        }
        if (s === steps - 1) tips.push(x, y, nr);
      }
    }
    const seg6 = Float32Array.from(segs);
    const n = seg6.length / 6;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((p, q) => seg6[p * 6 + 4] - seg6[q * 6 + 4]);
    return {
      seg: seg6,
      n,
      order,
      tips: Float32Array.from(tips),
      knots: Float32Array.from(knots),
      cx,
      cy,
      R,
    };
  });
}

/** Stroke the whole network: trunks heavier than fine branches. */
function strokeNet(c: Ctx2D, net: Net, u: number, color: string, alpha: number, widthK: number) {
  const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  for (let i = 0; i < net.n; i++) {
    const o = i * 6;
    const b = Math.min(3, Math.floor(net.seg[o + 5] * 4));
    buckets[b].moveTo(net.seg[o], net.seg[o + 1]);
    buckets[b].lineTo(net.seg[o + 2], net.seg[o + 3]);
  }
  c.lineCap = "round";
  c.lineJoin = "round";
  buckets.forEach((p, b) => {
    c.strokeStyle = rgba(color, alpha * (0.55 + 0.15 * b));
    c.lineWidth = Math.max(0.5, u * (0.0011 + 0.0011 * b) * widthK);
    c.stroke(p);
  });
}

function lit(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const net = network(w, h);
    const { u } = frameOf(w, h);
    c.globalCompositeOperation = "lighter";
    c.filter = `blur(${Math.max(1, u * 0.007).toFixed(1)}px)`;
    strokeNet(c, net, u, theme.accent, 0.55, 2.2);
    c.filter = "none";
    strokeNet(c, net, u, mix(theme.accent, theme.ink, 0.5), 0.7, 0.9);
    c.fillStyle = rgba(mix(theme.accent, theme.ink, 0.35), 0.9);
    for (let i = 0; i < net.knots.length; i += 3) {
      c.beginPath();
      c.arc(net.knots[i], net.knots[i + 1], u * 0.0035, 0, TAU);
      c.fill();
    }
    c.globalCompositeOperation = "source-over";
  };
}

function ghost(theme: Theme) {
  return (c: Ctx2D, w: number, h: number) => {
    const net = network(w, h);
    const { u } = frameOf(w, h);
    mottled(c, w, h, theme.bg, theme.accent2, 0.05, 12, 0.03);
    // Out-of-focus soil particles for depth.
    const r = rng(77);
    for (let i = 0; i < 26; i++) {
      const d = u * (0.02 + r() * 0.07);
      blit(
        c,
        bokeh(mix(theme.accent2, theme.bg, 0.3), 0.3, 0.2),
        r() * w,
        r() * h,
        d,
        0.05 + r() * 0.08,
      );
    }
    c.globalAlpha = 1;
    strokeNet(c, net, u, mix(theme.accent2, theme.ink, 0.15), 0.16, 1);
  };
}

export const style: MotionStyle = {
  id: "mycelium",
  name: "Mycelium",
  family: "Nature",
  tagline: "A glowing fungal network",
  look: "A bioluminescent fungal network under a macro lens: fine branching hyphae, glowing tips, a dark soil ground.",
  move: "From one spore the network lights up outward, its growing tips burning at the front; a signal pulses through, then the glow sinks back into the soil.",
  rules: [
    "The network is grown, not drawn: seeded random walks that branch and avoid crowding.",
    "Trunks near the spore are heavier; the fine branches at the edge are hairline.",
    "Only the growing front burns bright: every tip glows as it passes.",
    "One pulse runs through the finished network before the glow fades.",
    "The dim network stays in the soil, so the loop starts and ends on it.",
    "Light is additive: where hyphae cross, they glow brighter.",
  ],
  prompt: `R — References
• Mycelium macro photography and bioluminescent fungi (search: foxfire mycelium, hyphae macro).
• Scientific visualisation of branching networks (space colonisation, random-walk growth).

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a single glowing spore sits in dark soil over a faint trace of a network; hyphae start to light up outward from it.
• Middle (1.5–3.5 s): the glow spreads to the edges of the frame along every branch, each growing tip a bright point at the front.
• End (3.5–5 s): a bright pulse runs from the spore through the whole network, then the glow sinks back to the faint trace it began from.

S — Style
Looks: {{bg}} soil with fine mottling and soft out-of-focus particles; the dim network in {{accent2}}; lit hyphae in {{accent}} blending to {{ink}} with a soft bloom; tips as small hot glows.
Moves: the network is fixed (seeded); a radial front eases out from the spore over 3 s revealing it; tips glow where the front crosses a hypha; one pulse ring at 3.4 s; the lit layer fades over the last 0.8 s.
Rules:
1. Grown network: branching random walks with crowd avoidance.
2. Heavier trunks, hairline edges.
3. Glowing tips only at the front.
4. One pulse, then fade to the dim trace.
5. Additive light; grain.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the network fills the frame edge to edge; tips sit on the front, not scattered; the branches are fine, not a blur; the pulse is visible but brief. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Mycelium",
  theme: {
    bg: "#05080a",
    ink: "#eaf6ea",
    accent: "#8ff07c",
    accent2: "#2f7f86",
    font: "Inter",
  },
  tags: [
    "mycelium",
    "fungi",
    "network",
    "organic",
    "growth",
    "bioluminescent",
    "glow",
    "science",
    "branching",
    "nature",
    "neural",
  ],
  word: "Mycelium",
  render(ctx, t, theme, w, h) {
    const { u } = frameOf(w, h);
    const net = network(w, h);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      bake(
        `myc-ghost:${theme.bg}${theme.accent2}${theme.ink}`,
        w,
        h,
        ghost(theme),
      ) as CanvasImageSource,
      0,
      0,
    );
    const litLayer = bake(`myc-lit:${theme.accent}${theme.ink}`, w, h, lit(theme));

    const g0 = seg(t, 0.15, 3.3);
    const grow = 1 - (1 - g0) * (1 - g0);
    const front = net.R * grow;
    const fade = 1 - ease.inOutSine(seg(t, 4.1, 4.95));
    const edge = u * 0.09;

    if (fade > 0.001 && front > 0) {
      // Reveal the lit network inside the front, with a soft, hot edge.
      const { canvas, ctx: B } = buffer("myc-reveal", w, h);
      B.globalCompositeOperation = "copy";
      B.drawImage(litLayer as CanvasImageSource, 0, 0);
      B.globalCompositeOperation = "destination-in";
      const mask = B.createRadialGradient(net.cx, net.cy, 0, net.cx, net.cy, front + 1);
      const inner = Math.max(0, (front - edge) / (front + 1));
      mask.addColorStop(0, "rgba(255,255,255,0.55)");
      mask.addColorStop(inner, "rgba(255,255,255,0.7)");
      mask.addColorStop(Math.min(1, inner + (1 - inner) * 0.6), "rgba(255,255,255,1)");
      mask.addColorStop(1, "rgba(255,255,255,0)");
      B.fillStyle = mask;
      B.fillRect(0, 0, w, h);
      B.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = fade;
      ctx.drawImage(canvas as CanvasImageSource, 0, 0);
      ctx.restore();
    }

    // One pulse runs out through the finished network.
    const pulse = seg(t, 3.3, 4.3);
    if (pulse > 0 && pulse < 1 && fade > 0.001) {
      const pr = net.R * ease.inOutSine(pulse);
      const { canvas, ctx: B } = buffer("myc-pulse", w, h);
      B.globalCompositeOperation = "copy";
      B.drawImage(litLayer as CanvasImageSource, 0, 0);
      B.globalCompositeOperation = "destination-in";
      const ring = B.createRadialGradient(
        net.cx,
        net.cy,
        Math.max(0, pr - u * 0.12),
        net.cx,
        net.cy,
        pr + u * 0.02,
      );
      ring.addColorStop(0, "rgba(255,255,255,0)");
      ring.addColorStop(0.8, "rgba(255,255,255,1)");
      ring.addColorStop(1, "rgba(255,255,255,0)");
      B.fillStyle = ring;
      B.fillRect(0, 0, w, h);
      B.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.sin(Math.PI * pulse) * fade;
      ctx.drawImage(canvas as CanvasImageSource, 0, 0);
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // Growing tips: where the front crosses a hypha.
    const hot = glow(theme.accent, 0.16, theme.ink);
    if (fade > 0.001 && grow > 0 && grow < 1) {
      const lo = front - u * 0.012;
      let a = 0;
      let b = net.n;
      while (a < b) {
        const m = (a + b) >> 1;
        if (net.seg[net.order[m] * 6 + 4] < lo) a = m + 1;
        else b = m;
      }
      let drawn = 0;
      for (let k = a; k < net.n && drawn < 420; k++) {
        const i = net.order[k];
        const r1 = net.seg[i * 6 + 4];
        if (r1 > front) break;
        drawn++;
        const x = net.seg[i * 6 + 2];
        const y = net.seg[i * 6 + 3];
        // Each tip swells and fades as the front passes, so nothing pops.
        const pass = Math.sin((Math.PI * (front - r1)) / (front - lo || 1));
        blit(ctx, hot, x, y, u * (0.022 + 0.016 * hash(i, 3)), 0.95 * pass * fade);
      }
    }
    // Finished tips keep a soft glow and breathe.
    const tipGlow = glow(mix(theme.accent, theme.ink, 0.3), 0.2);
    for (let i = 0; i < net.tips.length; i += 3) {
      const r = net.tips[i + 2];
      if (r > front) continue;
      const age = clamp((front - r) / (u * 0.25));
      const breathe = 0.6 + 0.4 * Math.sin(turn(t, 2, hash(i, 5)));
      blit(
        ctx,
        tipGlow,
        net.tips[i],
        net.tips[i + 1],
        u * 0.014,
        (0.25 + 0.35 * (1 - age)) * breathe * fade,
      );
    }
    ctx.restore();

    // The spore: always glowing, the one fixed point of the loop.
    light(ctx, net.cx, net.cy, u * 0.3, theme.accent, 0.12 + 0.05 * Math.sin(turn(t, 1)));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blit(ctx, glow(mix(theme.accent, theme.ink, 0.4), 0.12), net.cx, net.cy, u * 0.07, 0.9);
    ctx.restore();

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.3);
  },
};
