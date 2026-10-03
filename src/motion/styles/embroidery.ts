import { mix, rgba } from "../engine/color";
import {
  context,
  frameOf,
  grain,
  ground,
  lerp,
  light,
  LOOP,
  makeCanvas,
  once,
  rng,
  TAU,
  vignette,
  type AnyCanvas,
} from "../engine/kit";
import { tintedLogo } from "../engine/assets";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import type { Pt } from "./_s1-helpers";

/** One stitch: a line, a French knot, or a lazy-daisy loop from a (base) to b (tip). */
type Kind = "line" | "knot" | "loop";
type Stitch = { a: Pt; b: Pt; c: 0 | 1 | 2 | 3; kind: Kind; wid?: number; t0: number; t1: number };
type Pattern = { P: number; tw: number; stitches: Stitch[]; trace: Pt[][]; cam: number[] };
/** A drawable thread segment. */
type Seg = { a: Pt; b: Pt; c: 0 | 1 | 2 | 3; knot?: boolean; holeA?: boolean; holeB?: boolean };

/** Points of a lazy-daisy loop: up one side from base to tip, down the other. */
function loopPts(a: Pt, b: Pt, wid: number): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const out: Pt[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const half = wid * Math.sin(Math.PI * Math.pow(f, 0.8)) * 0.5;
    out.push([a[0] + dx * f + nx * half, a[1] + dy * f + ny * half]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const f = i / n;
    const half = wid * Math.sin(Math.PI * Math.pow(f, 0.8)) * 0.5;
    out.push([a[0] + dx * f - nx * half, a[1] + dy * f - ny * half]);
  }
  return out;
}

/** Turn a stitch (shifted by dx, drawn to fraction f) into thread segments. */
function segsOf(s: Stitch, dx: number, f: number, out: Seg[]) {
  const A: Pt = [s.a[0] + dx, s.a[1]];
  const B: Pt = [s.b[0] + dx, s.b[1]];
  if (s.kind === "knot") {
    if (f > 0.55) out.push({ a: A, b: A, c: s.c, knot: true });
    return;
  }
  if (s.kind === "line") {
    out.push({
      a: A,
      b: [lerp(A[0], B[0], f), lerp(A[1], B[1], f)],
      c: s.c,
      holeA: true,
      holeB: f >= 1,
    });
    return;
  }
  const pts = loopPts(A, B, s.wid ?? 1);
  const upto = f * (pts.length - 1);
  for (let i = 0; i < pts.length - 1 && i < upto; i++) {
    const g = Math.min(1, upto - i);
    const p1: Pt = [lerp(pts[i][0], pts[i + 1][0], g), lerp(pts[i][1], pts[i + 1][1], g)];
    out.push({ a: pts[i], b: p1, c: s.c, holeA: i === 0 });
  }
  // The little tie stitch across the tip, once the loop is round.
  if (f >= 1) {
    const dxx = B[0] - A[0];
    const dyy = B[1] - A[1];
    const L = Math.hypot(dxx, dyy) || 1;
    out.push({
      a: [B[0] - (dxx / L) * (s.wid ?? 1) * 0.1, B[1] - (dyy / L) * (s.wid ?? 1) * 0.1],
      b: [B[0] + (dxx / L) * (s.wid ?? 1) * 0.28, B[1] + (dyy / L) * (s.wid ?? 1) * 0.28],
      c: s.c,
      holeA: true,
      holeB: true,
    });
  }
}

/** Needle tip for stitch s at fraction f. */
function tipOf(s: Stitch, f: number): Pt {
  if (s.kind === "loop") {
    const pts = loopPts(s.a, s.b, s.wid ?? 1);
    const k = f * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(k));
    const g = k - i;
    return [lerp(pts[i][0], pts[i + 1][0], g), lerp(pts[i][1], pts[i + 1][1], g)];
  }
  return [lerp(s.a[0], s.b[0], f), lerp(s.a[1], s.b[1], f)];
}

/**
 * One repeat of the vine, P wide, in the order the needle sews it: stem stitch
 * along a wave, fishbone leaves, a lazy-daisy flower with a knotted centre, buds.
 */
function pattern(w: number, h: number): Pattern {
  const { u, portrait, square } = frameOf(w, h);
  const P = portrait ? w * 1.0 : square ? w * 0.86 : Math.min(w * 0.78, h * 1.38);
  const A = h * (portrait ? 0.09 : 0.15);
  const S = Math.min(h, P * (portrait ? 1.3 : 1.1));
  const cy = h * 0.5;
  const tw = u * 0.022;
  const Ls = u * (portrait ? 0.05 : 0.058);
  const stemY = (x: number) => cy + A * Math.sin((TAU * x) / P);
  const raw: Omit<Stitch, "t0" | "t1">[] = [];
  const trace: Pt[][] = [];
  const stemRun = (x0: number, x1: number) => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 60; i++) {
      const x = lerp(x0, x1, i / 60);
      pts.push([x, stemY(x)]);
    }
    let acc = 0;
    let last: Pt = pts[0];
    let prev: Pt = pts[0];
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1]);
      prev = pts[i];
      if (acc >= Ls * 0.8 || i === pts.length - 1) {
        // Stem stitch: each stitch slants across the line, overlapping the last by half.
        const nx = -(pts[i][1] - last[1]);
        const ny = pts[i][0] - last[0];
        const nl = Math.hypot(nx, ny) || 1;
        const o = tw * 0.38;
        raw.push({
          a: [last[0] + (nx / nl) * o, last[1] + (ny / nl) * o],
          b: [pts[i][0] - (nx / nl) * o, pts[i][1] - (ny / nl) * o],
          c: 0,
          kind: "line",
        });
        last = [lerp(last[0], pts[i][0], 0.5), lerp(last[1], pts[i][1], 0.5)];
        acc = Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]);
      }
    }
    trace.push(pts);
  };
  const leaf = (bx: number, ang: number, len: number, wid: number, tone: 1 | 2) => {
    const base: Pt = [bx, stemY(bx)];
    const tip: Pt = [base[0] + Math.cos(ang) * len, base[1] + Math.sin(ang) * len];
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const edge = (f: number, side: number): Pt => {
      const half = wid * Math.pow(Math.sin(Math.PI * Math.min(1, f)), 0.8) * (1 - 0.3 * f);
      return [
        lerp(base[0], tip[0], f) + nx * half * side,
        lerp(base[1], tip[1], f) + ny * half * side,
      ];
    };
    const n = 30;
    for (let i = 0; i < n; i++) {
      const f = 0.05 + (i / (n - 1)) * 0.9;
      const side = i % 2 ? 1 : -1;
      const m: Pt = [
        lerp(base[0], tip[0], Math.min(1, f + 0.08)),
        lerp(base[1], tip[1], Math.min(1, f + 0.08)),
      ];
      raw.push({ a: edge(f, side), b: m, c: side > 0 ? tone : tone === 1 ? 2 : 1, kind: "line" });
    }
    const outline: Pt[] = [];
    for (let i = 0; i <= 18; i++) outline.push(edge(i / 18, -1));
    for (let i = 18; i >= 0; i--) outline.push(edge(i / 18, 1));
    trace.push(outline);
  };
  const flower = (bx: number, up: number) => {
    const base: Pt = [bx, stemY(bx)];
    const c: Pt = [bx + P * 0.06, base[1] + up * S * 0.25];
    const mid: Pt = [lerp(base[0], c[0], 0.55) - P * 0.01, lerp(base[1], c[1], 0.5)];
    raw.push({ a: base, b: mid, c: 0, kind: "line" });
    raw.push({ a: mid, b: c, c: 0, kind: "line" });
    const petals = 7;
    const pr = S * 0.19;
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * TAU - Math.PI / 2;
      const from: Pt = [c[0] + Math.cos(a) * pr * 0.2, c[1] + Math.sin(a) * pr * 0.2];
      const to: Pt = [c[0] + Math.cos(a) * pr, c[1] + Math.sin(a) * pr];
      raw.push({ a: from, b: to, c: 3, kind: "loop", wid: pr * 0.42 });
      trace.push(loopPts(from, to, pr * 0.42));
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.3;
      raw.push({
        a: [c[0] + Math.cos(a) * pr * 0.1, c[1] + Math.sin(a) * pr * 0.1],
        b: c,
        c: 2,
        kind: "knot",
      });
    }
    raw.push({ a: c, b: base, c: 0, kind: "line" });
  };
  stemRun(0, P * 0.18);
  leaf(P * 0.18, -Math.PI / 2 + 0.6, S * 0.42, S * 0.12, 1);
  stemRun(P * 0.18, P * 0.46);
  flower(P * 0.46, 1);
  stemRun(P * 0.46, P * 0.7);
  leaf(P * 0.7, Math.PI / 2 - 0.55, S * 0.4, S * 0.115, 2);
  stemRun(P * 0.7, P * 0.84);
  for (const [bx, dy, dxx] of [
    [0.84, -0.11, 0.03],
    [0.93, 0.1, 0.02],
  ] as const) {
    const root: Pt = [P * bx, stemY(P * bx)];
    const p: Pt = [P * (bx + dxx), root[1] + S * dy];
    raw.push({ a: root, b: p, c: 0, kind: "line" });
    raw.push({ a: p, b: p, c: 3, kind: "knot" });
  }
  stemRun(P * 0.84, P);
  // Close the repeat exactly: the last stitch ends where the next repeat's first begins.
  raw[raw.length - 1].b = [raw[0].a[0] + P, raw[0].a[1]];
  // Needle time: proportional to thread length (knots take a fixed beat).
  const lens = raw.map((s) =>
    s.kind === "knot"
      ? Ls * 0.7
      : s.kind === "loop"
        ? Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) * 2
        : Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) + Ls * 0.3,
  );
  const total = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  const stitches: Stitch[] = raw.map((s, i) => {
    const t0 = acc / total;
    acc += lens[i];
    return { ...s, t0, t1: acc / total };
  });
  // Camera: follow the needle, low-passed to whole harmonics so it loops.
  const N = 200;
  const dev: number[] = [];
  for (let i = 0; i < N; i++) {
    const q = i / N;
    const k = Math.max(
      0,
      stitches.findIndex((s) => q < s.t1),
    );
    const s = stitches[k];
    dev.push(tipOf(s, (q - s.t0) / Math.max(1e-6, s.t1 - s.t0))[0] - P * q);
  }
  const mean = dev.reduce((a, b) => a + b, 0) / N;
  const coef: number[] = [];
  for (const k of [1, 2]) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < N; i++) {
      a += (dev[i] - mean) * Math.cos((TAU * k * i) / N);
      b += (dev[i] - mean) * Math.sin((TAU * k * i) / N);
    }
    coef.push((2 * a) / N, (2 * b) / N);
  }
  return { P, tw, stitches, trace, cam: [mean, ...coef] };
}

/** Linen: a plain weave (over one, under one) with slubs, tiled so the pan loops. */
function linenTile(theme: Theme, T: number, u: number) {
  return (c: Ctx2D, w: number, h: number) => {
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, w, h);
    const n = Math.max(8, Math.round(T / Math.max(3, u * 0.0085)));
    const p = w / n;
    const r = rng(1203);
    const rowTone = Array.from({ length: n }, () => 0.085 + r() * 0.03);
    const colTone = Array.from({ length: n }, () => 0.085 + r() * 0.03);
    const slub = Array.from({ length: n }, () => (r() < 0.15 ? 1.15 : 1));
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = i * p;
        const y = j * p;
        if ((i + j) % 2 === 0) {
          // Weft over: a horizontal float, lit on top.
          const th = p * 0.78 * slub[j];
          c.fillStyle = rgba(theme.ink, rowTone[j]);
          c.fillRect(x - p * 0.1, y + (p - th) / 2, p * 1.2, th);
          c.fillStyle = rgba(theme.ink, rowTone[j] * 0.8);
          c.fillRect(x, y + (p - th) / 2, p, th * 0.3);
          c.fillStyle = "rgba(0,0,0,0.22)";
          c.fillRect(x, y + (p + th) / 2 - th * 0.18, p, th * 0.18);
        } else {
          const tw = p * 0.72 * slub[i];
          c.fillStyle = rgba(theme.ink, colTone[i]);
          c.fillRect(x + (p - tw) / 2, y - p * 0.1, tw, p * 1.2);
          c.fillStyle = rgba(theme.ink, colTone[i] * 0.7);
          c.fillRect(x + (p - tw) / 2, y, tw * 0.3, p);
          c.fillStyle = "rgba(0,0,0,0.22)";
          c.fillRect(x + (p + tw) / 2 - tw * 0.2, y, tw * 0.2, p);
        }
      }
  };
}

const tiles = new Map<string, AnyCanvas>();
function linen(theme: Theme, T: number, u: number): AnyCanvas {
  const key = `${theme.bg}${theme.ink}|${Math.round(T)}|${Math.round(u)}`;
  let c = tiles.get(key);
  if (!c) {
    c = makeCanvas(T, T);
    linenTile(theme, T, u)(context(c), Math.round(T), Math.round(T));
    tiles.set(key, c);
    if (tiles.size > 12) tiles.delete(tiles.keys().next().value as string);
  }
  return c;
}

function threadColor(theme: Theme, c: 0 | 1 | 2 | 3) {
  return c === 0
    ? theme.accent2
    : c === 1
      ? mix(theme.accent2, theme.ink, 0.32)
      : c === 2
        ? theme.ink
        : theme.accent;
}

/** Draw thread: cast shadow, body, ply twist, sheen, needle holes; knots as coiled bumps. */
function sew(ctx: Ctx2D, theme: Theme, list: Seg[], tw: number) {
  if (!list.length) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Needle holes: a little dark pit in the weave where the thread goes through.
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  for (const s of list) {
    if (s.knot) continue;
    for (const [p, on] of [
      [s.a, s.holeA],
      [s.b, s.holeB],
    ] as const) {
      if (!on) continue;
      ctx.moveTo(p[0] + tw * 0.62, p[1]);
      ctx.arc(p[0], p[1], tw * 0.62, 0, TAU);
    }
  }
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = tw * 1.05;
  ctx.beginPath();
  for (const s of list) {
    if (s.knot) continue;
    ctx.moveTo(s.a[0] + tw * 0.28, s.a[1] + tw * 0.42);
    ctx.lineTo(s.b[0] + tw * 0.28, s.b[1] + tw * 0.42);
  }
  ctx.stroke();
  for (const c of [0, 1, 2, 3] as const) {
    const col = threadColor(theme, c);
    ctx.strokeStyle = mix(col, theme.bg, 0.14);
    ctx.lineWidth = tw;
    ctx.beginPath();
    for (const s of list) {
      if (s.c !== c || s.knot) continue;
      ctx.moveTo(s.a[0], s.a[1]);
      ctx.lineTo(s.b[0], s.b[1]);
    }
    ctx.stroke();
    // Ply twist: short glints leaning across the thread.
    ctx.strokeStyle = rgba(mix(col, "#ffffff", 0.5), 0.5);
    ctx.lineWidth = Math.max(0.6, tw * 0.15);
    ctx.beginPath();
    for (const s of list) {
      if (s.c !== c || s.knot) continue;
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const L = Math.hypot(dx, dy);
      if (L < tw * 0.5) continue;
      const ux = dx / L;
      const uy = dy / L;
      const n = Math.max(1, Math.floor(L / (tw * 0.85)));
      for (let i = 1; i <= n; i++) {
        const f = i / (n + 1);
        const x = s.a[0] + dx * f;
        const y = s.a[1] + dy * f;
        ctx.moveTo(x - uy * tw * 0.36 - ux * tw * 0.2, y + ux * tw * 0.36 - uy * tw * 0.2);
        ctx.lineTo(x + uy * tw * 0.36 + ux * tw * 0.2, y - ux * tw * 0.36 + uy * tw * 0.2);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(mix(col, "#ffffff", 0.6), 0.32);
    ctx.lineWidth = Math.max(0.5, tw * 0.2);
    ctx.beginPath();
    for (const s of list) {
      if (s.c !== c || s.knot) continue;
      ctx.moveTo(s.a[0] - tw * 0.16, s.a[1] - tw * 0.22);
      ctx.lineTo(s.b[0] - tw * 0.16, s.b[1] - tw * 0.22);
    }
    ctx.stroke();
    for (const s of list) {
      if (s.c !== c || !s.knot) continue;
      const [x, y] = s.a;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.arc(x + tw * 0.3, y + tw * 0.42, tw * 1.0, 0, TAU);
      ctx.fill();
      const g = ctx.createRadialGradient(x - tw * 0.3, y - tw * 0.35, tw * 0.1, x, y, tw);
      g.addColorStop(0, mix(col, "#ffffff", 0.4));
      g.addColorStop(1, mix(col, theme.bg, 0.35));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, tw * 0.95, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(mix(col, theme.bg, 0.55), 0.8);
      ctx.lineWidth = tw * 0.16;
      ctx.beginPath();
      ctx.arc(x, y, tw * 0.52, 0.4, 0.4 + TAU * 0.8);
      ctx.stroke();
    }
  }
}

/** The embroidery scene, always laid out landscape (portrait frames draw it turned 90°). */
function scene(ctx: Ctx2D, t: number, theme: Theme, w: number, h: number) {
  const { u } = frameOf(w, h);
  const pat = once(`emb-pattern:${Math.round(w)}x${Math.round(h)}`, () => pattern(w, h));
  const { P, tw, stitches } = pat;
  const q = t / LOOP;
  // Needle position in the current repeat.
  let k = stitches.findIndex((s) => q < s.t1);
  if (k < 0) k = stitches.length - 1;
  const cur = stitches[k];
  const f = Math.max(0, Math.min(1, (q - cur.t0) / Math.max(1e-6, cur.t1 - cur.t0)));
  const tip: Pt = tipOf(cur, f);
  // Camera: the smoothed needle track, exactly one repeat per loop.
  const [mean, a1, b1, a2, b2] = pat.cam;
  const camX =
    P * q +
    mean +
    a1 * Math.cos(TAU * q) +
    b1 * Math.sin(TAU * q) +
    a2 * Math.cos(TAU * 2 * q) +
    b2 * Math.sin(TAU * 2 * q);
  // Keep the needle right of centre: more finished work in view than traced line.
  const ox = w * 0.66 - camX;

  // Linen, panned with the camera (tile width divides the repeat, so it loops).
  const T = P / 4;
  const tile = linen(theme, T, u);
  const patn = ctx.createPattern(tile as CanvasImageSource, "repeat");
  if (patn) {
    if (typeof DOMMatrix !== "undefined")
      patn.setTransform(
        new DOMMatrix()
          .translateSelf(((ox % T) + T) % T, 0)
          .scaleSelf(T / Math.round(T), T / Math.round(T)),
      );
    ctx.fillStyle = patn;
    ctx.fillRect(0, 0, w, h);
  }
  light(ctx, w * 0.42, h * 0.32, Math.max(w, h) * 0.8, theme.ink, 0.08);

  // Repeats in view: finished before the current one, traced after it.
  const first = Math.floor((-ox - P) / P);
  const last = Math.ceil((w - ox + P) / P);
  ctx.save();
  ctx.translate(ox, 0);
  const done: Seg[] = [];
  const traceStyle = () => {
    ctx.strokeStyle = rgba(mix(theme.accent2, theme.ink, 0.55), 0.34);
    ctx.lineWidth = Math.max(0.8, u * 0.0022);
    ctx.setLineDash([u * 0.008, u * 0.006]);
  };
  for (let m = first; m <= last; m++) {
    const dx = m * P;
    if (m > 0) {
      // Traced pattern ahead of the needle.
      ctx.save();
      ctx.translate(dx, 0);
      traceStyle();
      for (const line of pat.trace) {
        ctx.beginPath();
        line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    const upto = m < 0 ? stitches.length : k;
    for (let i = 0; i < upto; i++) segsOf(stitches[i], dx, 1, done);
    if (m === 0) {
      // Remaining trace in this repeat: only what the needle has not reached.
      ctx.save();
      ctx.beginPath();
      ctx.rect(tip[0] + tw * 1.5, 0, P * 2, h);
      ctx.clip();
      traceStyle();
      for (const line of pat.trace) {
        ctx.beginPath();
        line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.restore();
      segsOf(cur, 0, f, done);
    }
  }
  ctx.setLineDash([]);
  sew(ctx, theme, done, tw);

  // The needle and the working thread rising to the top of the frame.
  const bob = Math.sin(f * Math.PI);
  const ang = -0.95;
  const nl = u * 0.22;
  const nx = tip[0] + Math.cos(ang) * tw * 0.4;
  const ny = tip[1] - bob * tw * 0.8;
  const eyeX = nx - Math.cos(ang) * -nl;
  const eyeY = ny + Math.sin(ang) * nl;
  const col = threadColor(theme, cur.c);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = tw * 0.55;
  ctx.beginPath();
  ctx.moveTo(eyeX + tw, eyeY + tw * 1.4);
  ctx.quadraticCurveTo(eyeX + P * 0.1, eyeY - h * 0.2, eyeX + P * 0.05 + tw, -h * 0.05);
  ctx.stroke();
  ctx.strokeStyle = mix(col, theme.bg, 0.05);
  ctx.lineWidth = tw * 0.5;
  ctx.beginPath();
  ctx.moveTo(eyeX, eyeY);
  ctx.quadraticCurveTo(eyeX + P * 0.1, eyeY - h * 0.22, eyeX + P * 0.05, -h * 0.05);
  ctx.stroke();
  // Needle shadow, then steel.
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(ang);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(nl * 0.5 + tw * 0.6, tw * 1.4, nl * 0.5, tw * 0.3, 0, 0, TAU);
  ctx.fill();
  const nw = tw * 0.36;
  const g = ctx.createLinearGradient(0, -nw, 0, nw);
  g.addColorStop(0, mix(theme.ink, "#ffffff", 0.3));
  g.addColorStop(0.3, "#ffffff");
  g.addColorStop(0.55, mix(theme.ink, theme.bg, 0.4));
  g.addColorStop(1, mix(theme.bg, "#000000", 0.3));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(nl * 0.14, -nw);
  ctx.lineTo(nl * 0.86, -nw);
  ctx.lineTo(nl * 0.97, -nw * 1.15);
  ctx.arc(nl, 0, nw * 1.15, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(nl * 0.86, nw);
  ctx.lineTo(nl * 0.14, nw);
  ctx.closePath();
  ctx.fill();
  // The eye, with the thread through it.
  ctx.fillStyle = mix(theme.bg, "#000000", 0.35);
  ctx.beginPath();
  ctx.ellipse(nl * 0.93, 0, nl * 0.045, nw * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = mix(col, theme.bg, 0.05);
  ctx.lineWidth = tw * 0.5;
  ctx.beginPath();
  ctx.moveTo(nl * 0.9, 0);
  ctx.lineTo(nl * 0.99, 0);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

export const style: MotionStyle = {
  id: "embroidery",
  name: "Embroidery Stitch",
  family: "Print & Craft",
  tagline: "Crewel stitches on dark linen",
  look: "Crewel embroidery on dark linen: a stem-stitch vine, fishbone leaves, a lazy-daisy flower and French knots in twisted thread.",
  move: "The camera tracks a steel needle along an endless vine; it lays each stitch along the traced line, finished work trailing behind.",
  rules: [
    "Thread is a material: a cast shadow, a twisted ply, a sheen, a hole at each end.",
    "The needle only moves along the traced path; stitches appear in the order it sews them.",
    "Ahead of the needle, only the faint traced line; behind it, finished work.",
    "Real stitches: stem stitch for the vine, fishbone for leaves, lazy daisy and French knots.",
    "The linen weave is visible everywhere and tiles with the pan so the loop closes.",
    "Two thread colours plus cream, on a dark ground.",
  ],
  prompt: `R — References
• Crewel and hand embroidery close-ups (search: stem stitch vine, fishbone stitch leaf, lazy daisy French knot).
• Embroidery patterns traced in water-soluble pen before stitching.

I — Idea
A needle sews an endless vine, 5 seconds, looping seamlessly:
• Beginning (0–1.5 s): on dark linen a steel needle draws the thread through, laying stem stitches along a traced wave; it turns out along the line of a leaf and fills it in fishbone.
• Middle (1.5–3.5 s): back on the stem it sews a lazy-daisy flower in {{accent}} with a knotted cream centre.
• End (3.5–5 s): a second leaf and two knotted buds, while the camera keeps pace, landing exactly one repeat along.

S — Style
Looks: {{bg}} linen with a visible irregular weave; thread in {{accent2}} (stem and leaves, two tones), {{accent}} (petals and buds), {{ink}} (knots); each stitch shadowed with a twisted-ply highlight; the pattern ahead traced faintly; a steel needle with the working thread rising out of frame.
Moves: the needle moves at a steady pace along the path; the camera follows it with a smoothed pan of exactly one pattern repeat per loop; the weave pans with it and tiles.
Rules:
1. Thread shadow, ply twist, sheen, holes.
2. Stitches appear in sewing order.
3. Traced line ahead, finished work behind.
4. Real stitch types.
5. Visible weave that tiles.

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–5 s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, 1.25, 2.5, 3.75, 5). Check: frame 0 equals frame 5; the thread reads as thread (twist and shadow) at full size; the needle sits on the path; nothing ahead of the needle is stitched; the weave does not jump at the loop. Fix what fails and render again until every check passes.`,
  ref: "https://en.wikipedia.org/wiki/Embroidery",
  theme: {
    bg: "#171a20",
    ink: "#efe6d4",
    accent: "#e4654f",
    accent2: "#86ad83",
    font: "Inter",
  },
  tags: [
    "embroidery",
    "stitch",
    "needle",
    "thread",
    "sewing",
    "textile",
    "fabric",
    "craft",
    "floral",
    "handmade",
    "linen",
  ],
  word: "Stitch",
  render(ctx, t, theme, w, h) {
    const { u, portrait } = frameOf(w, h);
    ground(ctx, w, h, theme.bg);
    if (portrait) {
      // Re-lay for 9:16: the vine runs down the frame instead of across it.
      ctx.save();
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
      scene(ctx, t, theme, h, w);
      ctx.restore();
    } else scene(ctx, t, theme, w, h);

    const mark = tintedLogo(theme, rgba(theme.ink, 0.6), u * 0.07, u * 0.07);
    if (mark) ctx.drawImage(mark as CanvasImageSource, w - u * 0.11, h - u * 0.11);

    vignette(ctx, w, h, "#000000", 0.5);
    grain(ctx, w, h, t, 0.26);
  },
};
