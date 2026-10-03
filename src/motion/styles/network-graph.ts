import { mix, rgba } from "../engine/color";
import {
  bake,
  clamp,
  ease,
  font,
  frameOf,
  grain,
  ground,
  light,
  once,
  rng,
  seg,
  TAU,
  vignette,
  wordFor,
} from "../engine/kit";
import type { MotionStyle } from "../engine/types";
import { glow, studio, tabular, unit } from "./_s6-helpers";

const MONO = '"JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const HUBS = ["GATEWAY", "INDEX", "STORAGE", "COMPUTE", "CACHE"];
const METRICS = ["4.2k req/s", "812 docs/s", "38 TB", "96 cores", "99.2% hit"];
const FORM_END = 3.9;
const GONE = 4.75;

type Node = {
  x: number;
  y: number;
  z: number;
  hub: number;
  leaf: boolean;
  star: boolean;
  seed: number;
};
type Edge = { a: number; b: number; t0: number; kind: 0 | 1 | 2; curve: number };

/** Hub positions in a normalised, landscape frame (x -1..1, y -0.6..0.6, z depth). */
const HUB_POS: [number, number, number][] = [
  [0, 0, 0],
  [-0.7, -0.36, 0.25],
  [0.72, -0.4, -0.2],
  [-0.58, 0.44, -0.3],
  [0.64, 0.42, 0.3],
];

/** A made-up service graph: one core, four hubs, leaves around each, cross-links, far stars. */
const GRAPH = once("network:graph", () => {
  const r = rng(4077);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  HUB_POS.forEach(([x, y, z], i) =>
    nodes.push({ x, y, z, hub: i, leaf: false, star: false, seed: r() }),
  );
  for (let i = 1; i < 5; i++)
    edges.push({ a: 0, b: i, t0: 0.25 + (i - 1) * 0.12, kind: 0, curve: 0 });
  for (let hIdx = 0; hIdx < 5; hIdx++) {
    const hub = nodes[hIdx];
    const count = hIdx === 0 ? 6 : 8;
    for (let j = 0; j < count; j++) {
      const th = (j / count) * TAU + (r() - 0.5) * 0.7;
      const ph = (r() - 0.5) * 1.4;
      const rad = (hIdx === 0 ? 0.2 : 0.17) + r() * 0.15;
      nodes.push({
        x: hub.x + Math.cos(th) * Math.cos(ph) * rad * 1.15,
        y: hub.y + Math.sin(th) * Math.cos(ph) * rad * 0.9,
        z: hub.z + Math.sin(ph) * rad,
        hub: hIdx,
        leaf: true,
        star: false,
        seed: r(),
      });
      const base = hIdx === 0 ? 0.32 : 0.78 + (hIdx - 1) * 0.12;
      edges.push({ a: hIdx, b: nodes.length - 1, t0: base + j * 0.06, kind: 1, curve: 0 });
    }
  }
  // Cross-links between leaves of different hubs, and two hub-to-hub links.
  const leaves = nodes.map((n, i) => ({ n, i })).filter((q) => q.n.leaf);
  for (let k = 0; k < 8; k++) {
    const p = leaves[Math.floor(r() * leaves.length)];
    let q = leaves[Math.floor(r() * leaves.length)];
    for (let g = 0; g < 8 && q.n.hub === p.n.hub; g++) q = leaves[Math.floor(r() * leaves.length)];
    if (q.n.hub === p.n.hub) continue;
    edges.push({
      a: p.i,
      b: q.i,
      t0: 1.55 + k * 0.08,
      kind: 2,
      curve: (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.18),
    });
  }
  edges.push({ a: 1, b: 3, t0: 1.4, kind: 2, curve: 0.18 });
  edges.push({ a: 2, b: 4, t0: 1.5, kind: 2, curve: -0.18 });
  // Unconnected far stars give the field its depth.
  for (let k = 0; k < 70; k++)
    nodes.push({
      x: (r() - 0.5) * 2.6,
      y: (r() - 0.5) * 1.5,
      z: 0.2 + r() * 1.2,
      hub: -1,
      leaf: true,
      star: true,
      seed: r(),
    });
  return { nodes, edges, graphCount: nodes.length - 70 };
});

export const style: MotionStyle = {
  id: "network-graph",
  name: "Network Graph",
  family: "Data & Diagrams",
  tagline: "A service map pulsing in the dark",
  look: "A service map in the dark: a glowing core, four labelled hubs, clusters of leaf nodes in 3D depth, aqua links and violet pulses.",
  move: "Links grow out from the core wave by wave, each node ignites as it connects, pulses stream along the links, then it all dissolves to stars.",
  rules: [
    "Build outward from one core; every link grows from source to target.",
    "A node ignites (ring and glow) the moment its link reaches it.",
    "Depth is real: far nodes are smaller, dimmer and slower.",
    "Pulses travel at a constant speed and only on live links.",
    "Only hubs are labelled: mono caps plus one quiet metric.",
    "One accent for the core and its spokes; the second accent for traffic.",
    "Rest state is a quiet star field of unconnected nodes.",
  ],
  prompt: `R — References
• Observability service maps and knowledge-graph explorers (search: service map visualization dark, force directed graph glow).
• Constellation charts: points first, lines second.

I — Idea
One image with a beginning, middle and end, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): a quiet field of unconnected nodes; links grow out of a glowing core to four hubs, then from each hub to its cluster, and every node ignites as its link arrives.
• Middle (1.5–3.5 s): cross-links close the graph; pulses stream along every live link; hub labels and their metrics hold; the graph sways gently in depth.
• End (3.5–5 s): links dissolve and the nodes dim back to the star field of the first frame.

S — Style
Looks: {{bg}} near-black ground with a faint dot grid; the core and spokes in {{accent}}; traffic pulses in {{accent2}}; nodes in {{ink}} with depth fog; hub labels in {{font}} caps with one metric each.
Moves: each link grows in 0.35 s (outCubic), waves 0.12 s apart; ignition is a ring that expands and fades in 0.5 s; pulses move at constant speed, a whole number of trips per loop; the graph sways ±0.3 rad on a sine.
Rules:
1. Grow outward from the core, wave by wave.
2. Ignite each node when its link lands.
3. Real depth: size and brightness follow z.
4. Pulses only on live links, constant speed.
5. Label hubs only.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; no label overlaps another label or leaves the frame; links start and end on node centres; pulses never float off a link; far nodes read as far. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Force-directed_graph_drawing",
  theme: {
    bg: "#05090a",
    ink: "#dcf5ef",
    accent: "#2ef0c1",
    accent2: "#8f7bff",
    font: "JetBrains Mono",
  },
  fonts: ["JetBrains Mono:wght@100..800"],
  tags: [
    "network",
    "graph",
    "nodes",
    "connections",
    "data",
    "system",
    "map",
    "constellation",
    "tech",
    "ai",
    "infrastructure",
  ],
  word: "Core",
  render(ctx, t, theme, w, h) {
    const { portrait, square } = frameOf(w, h);
    const U = unit(w, h) * (portrait ? 1.15 : 1);
    ground(ctx, w, h, theme.bg);
    ctx.drawImage(
      studio(theme, "net", w, h, {
        lx: 0.5,
        ly: 0.45,
        tint: mix(theme.ink, theme.accent, 0.4),
        mottle: 0.6,
      }) as CanvasImageSource,
      0,
      0,
    );
    // A faint dot grid, like a plotting surface.
    ctx.drawImage(
      bake(`net-grid:${theme.ink}`, w, h, (c, W, H) => {
        const s = Math.max(10, Math.round(Math.min(W, H) / 36));
        c.fillStyle = rgba(theme.ink, 0.07);
        for (let y = s / 2; y < H; y += s)
          for (let x = s / 2; x < W; x += s) c.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      }) as CanvasImageSource,
      0,
      0,
    );

    const cx = w * (portrait ? 0.5 : 0.52);
    const cy = h * (portrait ? 0.5 : square ? 0.55 : 0.56);
    const sx = portrait ? w * 0.62 : square ? w * 0.46 : w * 0.44;
    const sy = portrait ? h * 0.52 : square ? h * 0.6 : h * 0.62;
    light(ctx, cx, cy, Math.max(w, h) * 0.45, theme.accent, 0.06);

    const { nodes, edges, graphCount } = GRAPH;
    const yaw = 0.3 * Math.sin((TAU * t) / 5);
    const cyaw = Math.cos(yaw);
    const syaw = Math.sin(yaw);
    const proj = nodes.map((n, i) => {
      // Each node also breathes on its own small orbit (whole cycles per loop).
      const nx = portrait ? n.y * 1.25 : n.x;
      const ny = portrait ? n.x * 0.62 : n.y;
      const bx = nx + 0.015 * Math.sin(TAU * (t / 5 + n.seed));
      const by = ny + 0.015 * Math.cos(TAU * ((2 * t) / 5 + n.seed));
      const x = bx * cyaw - n.z * syaw;
      const z = bx * syaw + n.z * cyaw;
      const k = 2.6 / (2.6 + z);
      return { x: cx + x * sx * k, y: cy + by * sy * k, z, k, i };
    });
    const depthA = (z: number) => clamp(0.55 - z * 0.55, 0.18, 1);

    const dissolve = ease.inOutCubic(seg(t, FORM_END, GONE));
    const grow = (e: Edge) => ease.outCubic(seg(t, e.t0, e.t0 + 0.35)) * (1 - dissolve);
    const lit = new Float32Array(nodes.length);
    const flash = new Float32Array(nodes.length);
    lit[0] = ease.outCubic(seg(t, 0.05, 0.35)) * (1 - dissolve);
    flash[0] = t > 0.05 ? Math.exp(-(t - 0.05) * 5) * (t < FORM_END ? 1 : 0) : 0;
    for (const e of edges) {
      const done = e.t0 + 0.35;
      if (t >= done) {
        lit[e.b] = Math.max(lit[e.b], 1 - dissolve);
        if (t < FORM_END) flash[e.b] = Math.max(flash[e.b], Math.exp(-(t - done) * 5));
      }
    }

    // Cluster halos: each hub sits in its own soft pool of light.
    for (let i = 0; i < 5; i++) {
      const p = proj[i];
      glow(
        ctx,
        p.x,
        p.y,
        (i === 0 ? 0.3 : 0.24) * sx * p.k,
        i === 0 ? theme.accent : mix(theme.accent, theme.accent2, 0.6),
        0.1 * depthA(p.z),
        "screen",
      );
    }
    // Ghost links: the unlit graph is always faintly there, so the rest frame reads as a map.
    ctx.strokeStyle = rgba(theme.ink, 0.13);
    ctx.lineWidth = Math.max(1, 1.1 * U);
    ctx.setLineDash([3 * U, 5 * U]);
    ctx.beginPath();
    for (const e of edges) {
      if (e.kind === 2) continue;
      ctx.moveTo(proj[e.a].x, proj[e.a].y);
      ctx.lineTo(proj[e.b].x, proj[e.b].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Links.
    let live = 0;
    ctx.lineCap = "round";
    for (const e of edges) {
      const g = grow(e);
      if (g <= 0.001) continue;
      if (g > 0.999) live++;
      const A = proj[e.a];
      const B = proj[e.b];
      const za = (A.z + B.z) / 2;
      const alpha = depthA(za);
      const mx = (A.x + B.x) / 2 + (B.y - A.y) * e.curve;
      const my = (A.y + B.y) / 2 - (B.x - A.x) * e.curve;
      const col =
        e.kind === 0
          ? theme.accent
          : e.kind === 1
            ? mix(theme.accent, theme.ink, 0.5)
            : theme.accent2;
      ctx.strokeStyle = rgba(col, (e.kind === 0 ? 0.8 : e.kind === 1 ? 0.45 : 0.4) * alpha);
      ctx.lineWidth = Math.max(1, (e.kind === 0 ? 2.8 : 1.7) * U * ((A.k + B.k) / 2));
      if (e.kind === 2) ctx.setLineDash([4 * U, 6 * U]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      if (e.curve === 0) ctx.lineTo(A.x + (B.x - A.x) * g, A.y + (B.y - A.y) * g);
      else {
        // Partial quadratic via de Casteljau.
        const q1x = A.x + (mx - A.x) * g;
        const q1y = A.y + (my - A.y) * g;
        const m2x = mx + (B.x - mx) * g;
        const m2y = my + (B.y - my) * g;
        ctx.quadraticCurveTo(q1x, q1y, q1x + (m2x - q1x) * g, q1y + (m2y - q1y) * g);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Pulses: a whole number of trips per loop, only while the link is live.
      if (g > 0.999) {
        const trips = e.kind === 0 ? 3 : 2;
        const n = e.kind === 0 ? 2 : 1;
        for (let p = 0; p < n; p++) {
          const f = ((((t / 5) * trips + p / n + e.t0 * 0.37) % 1) + 1) % 1;
          const px =
            e.curve === 0
              ? A.x + (B.x - A.x) * f
              : (1 - f) * (1 - f) * A.x + 2 * (1 - f) * f * mx + f * f * B.x;
          const py =
            e.curve === 0
              ? A.y + (B.y - A.y) * f
              : (1 - f) * (1 - f) * A.y + 2 * (1 - f) * f * my + f * f * B.y;
          const edgeFade = clamp(Math.min(f, 1 - f) * 10);
          const pc = e.kind === 0 ? theme.accent : theme.accent2;
          glow(ctx, px, py, 16 * U * A.k, pc, 0.7 * alpha * edgeFade * (1 - dissolve));
          ctx.fillStyle = rgba(mix(pc, theme.ink, 0.6), alpha * edgeFade * (1 - dissolve));
          ctx.beginPath();
          ctx.arc(px, py, Math.max(0.8, 2.2 * U * A.k), 0, TAU);
          ctx.fill();
        }
      }
    }

    // Nodes, far to near.
    const order = [...proj].sort((p, q) => q.z - p.z);
    for (const p of order) {
      const n = nodes[p.i];
      const a = depthA(p.z);
      const on = lit[p.i];
      if (n.star) {
        ctx.fillStyle = rgba(theme.ink, 0.28 * a * (0.5 + n.seed));
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.6, 1.6 * U * p.k * (0.5 + n.seed)), 0, TAU);
        ctx.fill();
        continue;
      }
      const isCore = p.i === 0;
      const isHub = !n.leaf;
      const r = (isCore ? 16 : isHub ? 11 : 5.4) * U * p.k * (1 + 0.25 * on);
      if (on > 0.01)
        glow(
          ctx,
          p.x,
          p.y,
          r * (isHub ? 5 : 3.2),
          isHub ? theme.accent : mix(theme.accent, theme.accent2, 0.5),
          (isHub ? 0.45 : 0.25) * on * a,
        );
      ctx.fillStyle = rgba(
        on > 0.5 && isHub ? theme.accent : theme.ink,
        (0.6 + 0.4 * on) * Math.max(a, 0.45),
      );
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      if (isHub) {
        ctx.strokeStyle = rgba(theme.accent, (0.25 + 0.5 * on) * a);
        ctx.lineWidth = Math.max(1, 1.4 * U);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.9, 0, TAU);
        ctx.stroke();
      }
      const fl = flash[p.i];
      if (fl > 0.01) {
        ctx.strokeStyle = rgba(isHub ? theme.accent : theme.ink, fl * 0.8 * a);
        ctx.lineWidth = Math.max(1, 1.5 * U);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (1.5 + (1 - fl) * (isHub ? 4 : 3)), 0, TAU);
        ctx.stroke();
      }
    }

    // Hub labels: name and one metric, flipped to whichever side keeps them in frame.
    const margin = 40 * U;
    for (let i = 0; i < 5; i++) {
      const p = proj[i];
      const t0 = i === 0 ? 0.3 : edges[i - 1].t0 + 0.35;
      // Dormant labels stay faintly readable; they brighten as their hub ignites.
      const on = 0.4 + 0.6 * clamp(seg(t, t0, t0 + 0.4)) * (1 - dissolve);
      ctx.save();
      ctx.font = font(500, 26 * U, theme.font, MONO);
      ctx.letterSpacing = `${(1.6 * U).toFixed(2)}px`;
      // The core carries the brand's name when there is one.
      const hubName = i === 0 ? wordFor(theme.name, HUBS[0], 12).toUpperCase() : HUBS[i];
      const nameW = ctx.measureText(hubName).width;
      ctx.font = font(400, 20 * U, theme.font, MONO);
      ctx.letterSpacing = "0px";
      const labW = Math.max(nameW, ctx.measureText(METRICS[i]).width);
      const gap = 30 * U * p.k;
      let right = i === 0 ? true : p.x >= cx;
      if (right && p.x + gap + labW > w - margin) right = false;
      if (!right && p.x - gap - labW < margin) right = true;
      const lx = p.x + (right ? gap : -gap);
      const ly = Math.min(h - margin - 30 * U, Math.max(margin + 30 * U, p.y - 4 * U));
      ctx.globalAlpha = on * Math.max(0.6, depthA(p.z));
      ctx.textAlign = right ? "left" : "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = theme.ink;
      ctx.font = font(500, 26 * U, theme.font, MONO);
      ctx.letterSpacing = `${(1.6 * U).toFixed(2)}px`;
      ctx.fillText(hubName, lx, ly);
      ctx.letterSpacing = "0px";
      ctx.fillStyle = i === 0 ? theme.accent : mix(theme.accent2, theme.ink, 0.35);
      ctx.font = font(400, 20 * U, theme.font, MONO);
      ctx.fillText(METRICS[i], lx, ly + 30 * U);
      ctx.restore();
    }

    // Title, with the live link count in its subline.
    const L = Math.max(w * (portrait ? 0.083 : 0.074), (w - 1560 * unit(w, h)) / 2);
    const ty = h * (portrait ? 0.09 : 0.13);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = font(500, 46 * U, theme.font, MONO);
    ctx.letterSpacing = `${(-0.5 * U).toFixed(2)}px`;
    ctx.fillText("Service map", L, ty);
    ctx.letterSpacing = "0px";
    ctx.font = font(400, 21 * U, theme.font, MONO);
    ctx.fillStyle = rgba(theme.ink, 0.5);
    const lead = `${graphCount} nodes · `;
    ctx.fillText(lead, L, ty + 38 * U);
    const lw = ctx.measureText(lead).width;
    ctx.fillStyle = theme.accent;
    const cw = tabular(ctx, String(live).padStart(2, "0"), L + lw, ty + 38 * U, "left");
    ctx.fillText(" links live", L + lw + cw, ty + 38 * U);

    vignette(ctx, w, h, "#000000", 0.55);
    grain(ctx, w, h, t, 0.22);
  },
};
