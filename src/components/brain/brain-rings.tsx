// Brain rings: the whole memory on one flat, readable map. The memory core
// sits in the middle; each source owns a sector; every dot is one real
// record from the memory catalog. A slow scanner sweeps the rings.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemLink, MemNode } from "@/components/memory-graph-3d";
import "./brain-rings.css";
import { recordsKey, useCanvasCrossfade } from "./use-crossfade";
import "./brain-timeline.css";
import { memoryTime } from "./brain-relations";
import { BrainSourceLogo, type StreamState } from "./brain-source";
import { openConnectSources } from "./brain-connect";
import { readableTitle } from "./brain-record-panel";

type Placed = { n: MemNode; x: number; y: number; r: number; a: number; color: string; key: string; hub: boolean };
type Sector = { key: string; label: string; color: string; a0: number; a1: number; count: number };

const TAU = Math.PI * 2;

function originOf(n: MemNode) {
  return n.origin || n.source || "other";
}

// Project folders arrive as "-Users-me-code-app"; show the readable end.
function prettyName(name: string) {
  const clean = /Users[-/]/.test(name) ? name.split(/[-/]/).filter(Boolean).slice(-2).join(" ") : name;
  return clean.length > 22 ? clean.slice(0, 21) + "…" : clean;
}

function hashId(id: string) {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619);
  return ((x >>> 0) % 10000) / 10000;
}

function drawShape(g: CanvasRenderingContext2D, kind: MemNode["kind"], x: number, y: number, r: number) {
  g.beginPath();
  if (kind === "decision") {
    const k = r * 1.35;
    g.moveTo(x, y - k);
    g.lineTo(x + k, y);
    g.lineTo(x, y + k);
    g.lineTo(x - k, y);
    g.closePath();
    g.fill();
  } else if (kind === "session") {
    g.arc(x, y, r, 0, TAU);
    g.lineWidth = Math.max(1, r * 0.55);
    g.stroke();
  } else if (kind === "skill") {
    const k = r * 1.1;
    g.rect(x - k, y - k, k * 2, k * 2);
    g.fill();
  } else {
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
}

export { memoryTime };

function freshness(n: MemNode) {
  return memoryTime(n) ?? 0;
}

export type RingSource = { id: string; name: string; color: string; count?: number };
export const MAIN_EMPTY_SOURCES = ["email", "meetings", "chatgpt", "codex", "notion"];

function layout(nodes: MemNode[], order: string[], labelOf: (k: string) => string, w: number, h: number, sources: RingSource[] = []) {
  // Leave room outside the ring for the source labels on every side.
  const R = Math.max(60, Math.min(w - 240, h - 108) / 2);
  // On a wide canvas the ring sits right of centre, leaving the map key its own space.
  const cx = Math.max(w / 2, Math.min(w / 2 + 70, w - R - 150));
  const cy = h / 2;
  const r0 = R * 0.3;
  const core = nodes.find((n) => n.kind === "hub");
  const groups = new Map<string, MemNode[]>();
  for (const n of nodes) {
    if (n === core) continue;
    const k = originOf(n);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(n);
  }
  // The main sources with nothing yet still get a thin, labelled slot, so you
  // can see where email or meetings will land. Minor ones stay hidden.
  const EMPTY_SLOTS = MAIN_EMPTY_SOURCES;
  for (const id of EMPTY_SLOTS) if (!groups.has(id) && sources.some((x) => x.id === id)) groups.set(id, []);
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return groups.get(b)!.length - groups.get(a)!.length;
  });
  const gap = keys.length > 1 ? 0.05 : 0;
  const weights = keys.map((k) => (groups.get(k)!.length ? Math.sqrt(groups.get(k)!.length) + 1.2 : 0.55));
  const wsum = weights.reduce((s, x) => s + x, 0) || 1;
  const span = TAU - gap * keys.length;

  // One dot pitch for the whole map, the largest that fits every sector.
  const sectorsRaw = keys.map((k, i) => ({ k, share: (weights[i] / wsum) * span }));
  const capacity = (share: number, p: number) => {
    let c = 0;
    for (let r = r0 + p / 2; r <= R; r += p) c += Math.max(1, Math.floor((share * r) / p));
    return c;
  };
  let lo = 2.2, hi = 12;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const ok = sectorsRaw.every((s) => !groups.get(s.k)!.length || capacity(s.share, mid) >= groups.get(s.k)!.length);
    if (ok) lo = mid;
    else hi = mid;
  }
  const p = lo;

  const placed: Placed[] = [];
  const sectors: Sector[] = [];
  let a = -Math.PI / 2 + gap / 2;
  for (const { k, share } of sectorsRaw) {
    const list = groups.get(k)!.slice().sort((x, y) => {
      const hx = x.categoryHub || x.kind === "workspace" ? 1 : 0;
      const hy = y.categoryHub || y.kind === "workspace" ? 1 : 0;
      return hy - hx || freshness(y) - freshness(x);
    });
    const a0 = a, a1 = a + share;
    const color = list.find((n) => n.color)?.color ?? sources.find((x) => x.id === k)?.color ?? "#9aa0b4";
    sectors.push({ key: k, label: sources.find((x) => x.id === k)?.name ?? labelOf(k), color, a0, a1, count: list.length });
    let i = 0;
    for (let r = r0 + p / 2; r <= R + 0.01 && i < list.length; r += p) {
      const slots = Math.max(1, Math.floor((share * r) / p));
      const take = Math.min(slots, list.length - i);
      const step = share / slots;
      const start = a0 + (share - step * take) / 2 + step / 2;
      for (let j = 0; j < take; j++, i++) {
        const n = list[i];
        // A little stable jitter so the rings read as organic, not a grid.
        const h = hashId(n.id);
        const ang = start + j * step + (h - 0.5) * step * 0.35;
        const rj = r + (hashId(n.id + "r") - 0.5) * p * 0.4;
        const hub = !!(n.categoryHub || n.kind === "workspace");
        placed.push({
          n,
          a: ang,
          x: cx + Math.cos(ang) * rj,
          y: cy + Math.sin(ang) * rj,
          r: hub ? Math.min(4.5, p * 0.36 + 1.6) : Math.max(1.1, Math.min(2.8, p * 0.22 + 0.2 * h)),
          color: n.color || color,
          key: k,
          hub,
        });
      }
    }
    a = a1 + gap;
  }
  return { cx, cy, R, r0, p, placed, sectors, core };
}

export type BrainRingsProps = {
  nodes: MemNode[];
  links: MemLink[];
  order: string[];
  labelOf: (origin: string) => string;
  focusOrigin?: string; // "all" or an origin id
  sources?: RingSource[]; // connected sources, shown even when empty
  query?: string;
  onSelect?: (n: MemNode) => void;
  /** Sorted "a\0b" keys of cross-source relation links, drawn apart from membership links. */
  relationKeys?: Set<string>;
  selectedId?: string;
  /** Records a memory question pointed at; everything else steps back. */
  highlightIds?: Set<string>;
  /** Double-click: open the record in the large panel. */
  onOpen?: (n: MemNode) => void;
  streams?: Record<string, StreamState>;
  onSource?: (origin: string) => void;
};

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

export function BrainRings({
  nodes,
  links,
  order,
  labelOf,
  focusOrigin = "all",
  query = "",
  onSelect,
  sources = [],
  relationKeys,
  selectedId,
  highlightIds,
  onOpen,
  streams,
  onSource,
}: BrainRingsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useCanvasCrossfade(canvasRef, recordsKey(nodes));
  const [hover, setHover] = useState<Placed | null>(null);
  const hoverRef = useRef<Placed | null>(null);
  hoverRef.current = hover;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const L = useMemo(
    () => (size.w > 40 && size.h > 40 ? layout(nodes, order, labelOf, size.w, size.h, sources) : null),
    [nodes, order, labelOf, size.w, size.h, sources],
  );

  const q = query.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!L) return null;
    if (!q) return highlightIds?.size ? highlightIds : null;
    return new Set(L.placed.filter((d) => d.n.name.toLowerCase().includes(q)).map((d) => d.n.id));
  }, [q, L, highlightIds]);

  const index = useMemo(() => {
    const byId = new Map<string, Placed>();
    L?.placed.forEach((d) => byId.set(d.n.id, d));
    const adj = new Map<string, Set<string>>();
    const pairs: [Placed, Placed][] = [];
    const related: [Placed, Placed][] = [];
    const relAdj = new Map<string, Set<string>>();
    for (const l of links) {
      const s = byId.get(typeof l.source === "string" ? l.source : (l.source as any)?.id);
      const t = byId.get(typeof l.target === "string" ? l.target : (l.target as any)?.id);
      if (!s || !t || s === t) continue;
      if (relationKeys?.has(pairKey(s.n.id, t.n.id))) {
        related.push([s, t]);
        if (!relAdj.has(s.n.id)) relAdj.set(s.n.id, new Set());
        if (!relAdj.has(t.n.id)) relAdj.set(t.n.id, new Set());
        relAdj.get(s.n.id)!.add(t.n.id);
        relAdj.get(t.n.id)!.add(s.n.id);
      } else pairs.push([s, t]);
      if (!adj.has(s.n.id)) adj.set(s.n.id, new Set());
      if (!adj.has(t.n.id)) adj.set(t.n.id, new Set());
      adj.get(s.n.id)!.add(t.n.id);
      adj.get(t.n.id)!.add(s.n.id);
    }
    return { byId, adj, pairs, related, relAdj };
  }, [L, links, relationKeys]);

  // Static layer: rings, links, dots. Redrawn only when inputs change.
  const staticLayer = useMemo(() => {
    if (!L || typeof document === "undefined") return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const off = document.createElement("canvas");
    off.width = size.w * dpr;
    off.height = size.h * dpr;
    const g = off.getContext("2d")!;
    g.scale(dpr, dpr);
    const css = getComputedStyle(wrapRef.current ?? document.body);
    const ink = css.getPropertyValue("--op-ink").trim() || "#f0edf5";
    const muted = css.getPropertyValue("--op-muted").trim() || "#96919f";
    const { cx, cy, R, r0, sectors, placed } = L;
    const dimmed = (d: Placed) =>
      (focusOrigin !== "all" && d.key !== focusOrigin) || (matchIds != null && !matchIds.has(d.n.id));

    // Outer ring with ticks.
    g.strokeStyle = muted;
    g.globalAlpha = 0.28;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, R + 10, 0, TAU);
    g.stroke();
    for (let i = 0; i < 144; i++) {
      const t = (i / 144) * TAU;
      const len = i % 12 === 0 ? 7 : 3;
      g.beginPath();
      g.moveTo(cx + Math.cos(t) * (R + 10), cy + Math.sin(t) * (R + 10));
      g.lineTo(cx + Math.cos(t) * (R + 10 + len), cy + Math.sin(t) * (R + 10 + len));
      g.stroke();
    }
    // Inner guide rings.
    g.setLineDash([2, 5]);
    g.globalAlpha = 0.18;
    for (const rr of [r0 * 0.78, (r0 + R) / 2]) {
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.stroke();
    }
    g.setLineDash([]);

    // Sector arcs and labels.
    g.font = "600 10px ui-monospace, 'SF Mono', Menlo, monospace";
    for (const s of sectors) {
      const off2 = focusOrigin !== "all" && s.key !== focusOrigin;
      g.globalAlpha = off2 ? 0.2 : s.count ? 0.85 : 0.4;
      g.strokeStyle = s.color;
      g.lineWidth = s.count ? 2 : 1.2;
      if (!s.count) g.setLineDash([3, 4]);
      g.beginPath();
      g.arc(cx, cy, R + 10, s.a0, s.a1);
      g.stroke();
      g.setLineDash([]);
    }

    // Links, bundled toward the core.
    g.lineWidth = 0.7;
    const pairs = index.pairs.length > 1400 ? index.pairs.filter((_, i) => i % Math.ceil(index.pairs.length / 1400) === 0) : index.pairs;
    for (const [s, t] of pairs) {
      const faded = dimmed(s) && dimmed(t);
      g.globalAlpha = faded ? 0.02 : 0.07;
      g.strokeStyle = s.color;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.quadraticCurveTo(cx + ((s.x + t.x) / 2 - cx) * 0.35, cy + ((s.y + t.y) / 2 - cy) * 0.35, t.x, t.y);
      g.stroke();
    }

    // Relations across sources: thin Jev pink threads that arc wider than membership links.
    g.lineWidth = 0.8;
    g.strokeStyle = "#F386A1";
    for (const [s, t] of index.related) {
      const faded = dimmed(s) && dimmed(t);
      g.globalAlpha = faded ? 0.03 : 0.14;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.quadraticCurveTo(cx + ((s.x + t.x) / 2 - cx) * 0.62, cy + ((s.y + t.y) / 2 - cy) * 0.62, t.x, t.y);
      g.stroke();
    }

    // Dots: the shape says what the record is; a halo marks this week's.
    const weekAgo = Date.now() - 7 * 864e5;
    for (const d of placed) {
      const off2 = dimmed(d);
      g.globalAlpha = off2 ? 0.14 : d.hub ? 1 : 0.85;
      g.fillStyle = d.color;
      g.strokeStyle = d.color;
      drawShape(g, d.n.kind, d.x, d.y, d.r);
      if (!off2 && freshness(d.n) > weekAgo) {
        g.globalAlpha = 0.35;
        g.beginPath();
        g.arc(d.x, d.y, d.r + 2.6, 0, TAU);
        g.lineWidth = 1;
        g.stroke();
      }
      if (d.hub && !off2) {
        g.globalAlpha = 0.5;
        g.strokeStyle = d.color;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(d.x, d.y, d.r + 3, 0, TAU);
        g.stroke();
      }
      if (matchIds?.has(d.n.id)) {
        g.globalAlpha = 0.9;
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(d.x, d.y, d.r + 4, 0, TAU);
        g.stroke();
      }
    }
    // Name the biggest groups inside each source.
    g.font = "500 10px ui-sans-serif, system-ui, -apple-system, sans-serif";
    g.textBaseline = "middle";
    const hubs = placed.filter((d) => d.hub && !dimmed(d)).sort((a, b) => (b.n.val ?? 0) - (a.n.val ?? 0));
    const taken: { x: number; y: number; w: number }[] = [];
    let shown = 0;
    for (const d of hubs) {
      if (shown >= 7) break;
      const name = prettyName(d.n.name);
      const width = g.measureText(name).width;
      const right = Math.cos(d.a) >= 0;
      const lx = right ? d.x + d.r + 6 : d.x - d.r - 6 - width;
      // Skip a label that would sit on top of one already drawn.
      if (taken.some((t) => Math.abs(t.y - d.y) < 13 && lx < t.x + t.w + 6 && lx + width + 6 > t.x)) continue;
      taken.push({ x: lx, y: d.y, w: width });
      shown++;
      g.textAlign = "left";
      g.globalAlpha = 0.85;
      g.fillStyle = ink;
      g.fillText(name, lx, d.y);
    }
    g.globalAlpha = 1;
    return { off, ink, muted, dpr };
  }, [L, size.w, size.h, focusOrigin, matchIds, index]);

  // Live layer: core, scanner sweep, hover highlight.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !L || !staticLayer) return;
    const { off, ink, dpr } = staticLayer;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext("2d")!;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const { cx, cy, R, r0, placed, core } = L;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number, force = false) => {
      raf = requestAnimationFrame((t) => draw(t));
      if (document.hidden && !force) return;
      const t = (now - t0) / 1000;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.w, size.h);
      g.drawImage(off, 0, 0, size.w, size.h);

      // Scanner sweep.
      const sweep = reduce ? -Math.PI / 2 : -Math.PI / 2 + t * 0.32;
      if (!reduce && typeof g.createConicGradient === "function") {
        const grad = g.createConicGradient(sweep - 0.9, cx, cy);
        grad.addColorStop(0, "rgba(212,91,182,0)");
        grad.addColorStop(0.9 / TAU, "rgba(212,91,182,0.13)");
        grad.addColorStop(0.9 / TAU + 0.001, "rgba(212,91,182,0)");
        grad.addColorStop(1, "rgba(212,91,182,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, R + 6, 0, TAU);
        g.fill();
        g.strokeStyle = "rgba(212,91,182,0.55)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx + Math.cos(sweep) * r0 * 0.6, cy + Math.sin(sweep) * r0 * 0.6);
        g.lineTo(cx + Math.cos(sweep) * (R + 8), cy + Math.sin(sweep) * (R + 8));
        g.stroke();
        // Dots just behind the beam flare briefly.
        for (const d of placed) {
          let da = (sweep - d.a) % TAU;
          if (da < 0) da += TAU;
          if (da > 0.5) continue;
          const k = 1 - da / 0.5;
          g.globalAlpha = 0.9 * k;
          g.fillStyle = d.color;
          g.shadowColor = d.color;
          g.shadowBlur = 8 * k;
          g.beginPath();
          g.arc(d.x, d.y, d.r * (1 + 0.5 * k), 0, TAU);
          g.fill();
        }
        g.shadowBlur = 0;
        g.globalAlpha = 1;
      }

      // Core hexagon.
      const hr = r0 * 0.42;
      const pulse = reduce ? 0 : Math.sin(t * 1.6) * 0.5 + 0.5;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r0 * 0.95);
      glow.addColorStop(0, `rgba(138,255,208,${0.2 + 0.1 * pulse})`);
      glow.addColorStop(1, "rgba(138,255,208,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(cx, cy, r0 * 0.95, 0, TAU);
      g.fill();
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = -Math.PI / 2 + (i * TAU) / 6;
        const x = cx + Math.cos(ang) * hr, y = cy + Math.sin(ang) * hr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = "rgba(10,14,20,0.85)";
      g.fill();
      g.strokeStyle = "#8affd0";
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "650 12px ui-sans-serif, system-ui, -apple-system, sans-serif";
      g.fillText(core?.name ?? "Memory core", cx, cy - 6);
      g.font = "500 10px ui-monospace, 'SF Mono', Menlo, monospace";
      g.globalAlpha = 0.7;
      g.fillText(`${placed.length.toLocaleString()} records`, cx, cy + 9);
      g.globalAlpha = 1;

      // Selected and hovered records: their links light up, relations in Jev pink.
      const spotlight = (hv: Placed, strength: number) => {
        const draw1 = (id: string, related: boolean) => {
          const o = index.byId.get(id);
          if (!o) return;
          const k = related ? 0.62 : 0.35;
          g.globalAlpha = (related ? 0.9 : 0.6) * strength;
          g.strokeStyle = related ? "#F386A1" : hv.color;
          g.lineWidth = related ? 1.5 : 1.1;
          g.beginPath();
          g.moveTo(hv.x, hv.y);
          g.quadraticCurveTo(cx + ((hv.x + o.x) / 2 - cx) * k, cy + ((hv.y + o.y) / 2 - cy) * k, o.x, o.y);
          g.stroke();
          g.fillStyle = o.color;
          g.beginPath();
          g.arc(o.x, o.y, o.r + (related ? 2.2 : 1.5), 0, TAU);
          g.fill();
          if (related) {
            g.strokeStyle = "#F386A1";
            g.lineWidth = 1;
            g.beginPath();
            g.arc(o.x, o.y, o.r + 4.5, 0, TAU);
            g.stroke();
          }
        };
        for (const id of index.adj.get(hv.n.id) || []) if (!index.relAdj.get(hv.n.id)?.has(id)) draw1(id, false);
        for (const id of index.relAdj.get(hv.n.id) || []) draw1(id, true);
        g.globalAlpha = strength;
        g.fillStyle = hv.color;
        g.shadowColor = hv.color;
        g.shadowBlur = 14;
        g.beginPath();
        g.arc(hv.x, hv.y, hv.r + 3, 0, TAU);
        g.fill();
        g.shadowBlur = 0;
      };
      const sel = selectedId ? index.byId.get(selectedId) : undefined;
      if (sel) {
        spotlight(sel, 1);
        const pulse = reduce ? 0.5 : (Math.sin(t * 3) + 1) / 2;
        g.globalAlpha = 0.5 + 0.4 * pulse;
        g.strokeStyle = "#F386A1";
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(sel.x, sel.y, sel.r + 7 + pulse * 2, 0, TAU);
        g.stroke();
      }
      const hv = hoverRef.current;
      if (hv && hv !== sel) spotlight(hv, sel ? 0.7 : 1);
      g.globalAlpha = 1;
    };
    draw(performance.now(), true);
    return () => cancelAnimationFrame(raf);
  }, [L, staticLayer, size.w, size.h, index, selectedId]);

  // Dev only: where each record sits, so headless checks can click real records.
  useEffect(() => {
    if (!import.meta.env.DEV || !L || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    (window as unknown as { __brainMarks?: unknown }).__brainMarks = L.placed.map((d) => ({
      id: d.n.id,
      origin: d.key,
      kind: d.n.kind,
      hub: d.hub,
      x: r.left + d.x,
      y: r.top + d.y,
    }));
  }, [L]);
  const pick = (e: React.PointerEvent) => {
    if (!L) return null;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best: Placed | null = null, bd = 12 * 12;
    for (const d of L.placed) {
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  };

  const labelSpots = useMemo(() => {
    if (!L) return [];
    const spots = L.sectors.map((sec) => {
      const mid = (sec.a0 + sec.a1) / 2;
      const c = Math.cos(mid), sn = Math.sin(mid);
      const x = L.cx + c * (L.R + 24);
      // Rough label width: tile, gap, name and count in 10px mono caps.
      const w = 30 + (sec.label.length + String(sec.count || "+").length + 1) * 7.4;
      const left = c > 0.25 ? x : c < -0.25 ? x - w : x - w / 2;
      return {
        sec,
        x,
        y: L.cy + sn * (L.R + 24),
        left,
        w,
        tx: c > 0.25 ? "0%" : c < -0.25 ? "-100%" : "-50%",
        ty: sn > 0.25 ? "0%" : sn < -0.25 ? "-100%" : "-50%",
      };
    });
    // Labels that would overlap slide apart vertically, away from the ring's middle.
    const order = [...spots].sort((a, b) => a.y - b.y);
    for (let i = 1; i < order.length; i++)
      for (let j = 0; j < i; j++) {
        const a = order[j], b = order[i];
        const overlapX = a.left < b.left + b.w && b.left < a.left + a.w;
        if (!overlapX || Math.abs(b.y - a.y) >= 22) continue;
        if (b.tx === "-50%") {
          // A label under or over the ring slides sideways, never off the canvas.
          if (b.x >= a.x) b.x = a.left + a.w + 10 + b.w / 2;
          else b.x = a.left - 10 - b.w / 2;
          b.left = b.x - b.w / 2;
        } else if (b.y > L.cy) b.y = a.y + 22;
        else a.y = b.y - 22;
      }
    return spots;
  }, [L]);

  return (
    <div ref={wrapRef} className="brain-rings">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        onPointerMove={(e) => setHover(pick(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const d = pick(e as unknown as React.PointerEvent);
          if (d) onSelect?.(d.n);
        }}
        onDoubleClick={(e) => {
          const d = pick(e as unknown as React.PointerEvent);
          if (d) onOpen?.(d.n);
        }}
        role="img"
        aria-label={`Memory map: ${L?.placed.length ?? 0} records in ${L?.sectors.length ?? 0} sources`}
      />
      {labelSpots.map(({ sec, x, y, tx, ty }) => {
        const off = focusOrigin !== "all" && sec.key !== focusOrigin;
        return (
          <button
            key={sec.key}
            className="brain-sector-label"
            data-empty={!sec.count || undefined}
            data-off={off || undefined}
            style={{ left: x, top: y, transform: `translate(${tx}, ${ty})`, ["--sec" as string]: sec.color }}
            onClick={() => (sec.count ? onSource?.(sec.key) : openConnectSources())}
            title={sec.count ? `Show only ${sec.label}` : `How to connect ${sec.label}`}
          >
            <BrainSourceLogo origin={sec.key} color={sec.color} size={16} />
            <span>{sec.label}</span>
            {sec.count ? <b>{sec.count.toLocaleString()}</b> : <em aria-hidden>+</em>}
          </button>
        );
      })}
      <RingsKey nodes={nodes} relations={index.related.length} />
      {hover && (
        <div
          className="brain-rings-tip"
          style={{
            left: Math.min(hover.x + 14, size.w - 250),
            top: Math.max(8, hover.y - 18),
            ["--tip" as string]: hover.color,
          }}
        >
          <b>{readableTitle(hover.n.name)}</b>
          <span>
            {labelOf(hover.key)} · {hover.n.categoryHub ? "source" : hover.n.kind}
            {index.relAdj.get(hover.n.id)?.size ? ` · ${index.relAdj.get(hover.n.id)!.size} related` : ""}
          </span>
          {memoryTime(hover.n) != null && (
            <span>Updated {new Date(memoryTime(hover.n)!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
          )}
          {!hover.n.categoryHub && (hover.n.meta || hover.n.preview) && (
            <span className="brain-tip-preview">{(hover.n.meta || hover.n.preview || "").slice(0, 140)}</span>
          )}
          {!hover.n.categoryHub && <span className="brain-tip-hint">Click to open · double-click for the full view</span>}
        </div>
      )}
    </div>
  );
}

const KINDS: { kind: MemNode["kind"]; label: string }[] = [
  { kind: "file", label: "Notes and files" },
  { kind: "decision", label: "Decisions" },
  { kind: "session", label: "Sessions" },
  { kind: "skill", label: "Skills" },
];

export function RingsKey({ nodes, relations = 0 }: { nodes: MemNode[]; relations?: number }) {
  const weekAgo = Date.now() - 7 * 864e5;
  const fresh = nodes.filter((n) => freshness(n) > weekAgo).length;
  return (
    <div className="brain-key" aria-label="Map key">
      {KINDS.map(({ kind, label }) => {
        const n = nodes.filter((x) => x.kind === kind).length;
        if (!n) return null;
        return (
          <span key={kind}>
            <i data-kind={kind} /> {label} <b>{n}</b>
          </span>
        );
      })}
      <span>
        <i data-kind="fresh" /> New this week <b>{fresh}</b>
      </span>
      {relations > 0 && (
        <span>
          <i data-kind="related" /> Related across sources <b>{relations}</b>
        </span>
      )}
    </div>
  );
}
