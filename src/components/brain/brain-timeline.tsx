// Brain timeline: the whole memory laid out over time. One lane per source,
// one mark per record, a peaks strip of daily activity above and a draggable
// overview of all history below. Pick a range (24h to All), pinch or scroll with
// Ctrl to zoom, drag to pan, click a day to see what the OS learned that day.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { MemNode } from "@/components/memory-graph-3d";
import { MAIN_EMPTY_SOURCES, memoryTime, type RingSource } from "./brain-rings";
import { BrainSourceLogo, type StreamState } from "./brain-source";
import { openConnectSources } from "./brain-connect";
import { readableTitle } from "./brain-record-panel";
import "./brain-rings.css";
import { recordsKey, useCanvasCrossfade } from "./use-crossfade";
import "./brain-timeline.css";

type Mark = { n: MemNode; t: number; x: number; y: number; color: string; lane: string };
type Win = { start: number; end: number };
const DAY = 864e5,
  HOUR = 36e5;
export const TIMELINE_RANGES = [
  { id: "24h", label: "24h", ms: DAY },
  { id: "7d", label: "7d", ms: 7 * DAY },
  { id: "30d", label: "30d", ms: 30 * DAY },
  { id: "90d", label: "90d", ms: 90 * DAY },
  { id: "1y", label: "1y", ms: 365 * DAY },
  { id: "all", label: "All", ms: 0 },
] as const;
export type TimelineRange = (typeof TIMELINE_RANGES)[number]["id"];

const stamp = (n: MemNode) => memoryTime(n);
function hash(id: string) {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619);
  return ((x >>> 0) % 10000) / 10000;
}
const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ease = (p: number) => 1 - Math.pow(1 - p, 3);

export type TimelineFocus = { start: number; end: number; nonce: number };

export function BrainTimeline({
  nodes,
  sources,
  labelOf,
  query = "",
  onSelect,
  onOpen,
  relations = [],
  selectedId,
  highlightIds,
  streams,
  daily,
  focus,
}: {
  nodes: MemNode[];
  sources: RingSource[];
  labelOf: (origin: string) => string;
  query?: string;
  onSelect?: (n: MemNode) => void;
  /** Double-click: open the record in the large panel. */
  onOpen?: (n: MemNode) => void;
  /** Cross-source relation pairs; drawn as faint threads, bright for the chosen record. */
  relations?: Array<{ source: string; target: string }>;
  selectedId?: string;
  /** Records a memory question pointed at; everything else steps back. */
  highlightIds?: Set<string>;
  streams?: Record<string, StreamState>;
  /** Full-history counts per day for sources that list only their newest records. */
  daily?: Record<string, Record<string, number>>;
  /** Move the window here (from the memory focus command). */
  focus?: TimelineFocus;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useCanvasCrossfade(canvas, recordsKey(nodes));
  const [hover, setHover] = useState<Mark | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    // Folders are containers, not events; only real records get a day.
    const records = nodes.filter((n) => n.kind !== "hub" && !n.categoryHub && n.kind !== "workspace");
    const origin = (n: MemNode) => n.origin || n.source || "other";
    const withRecords = [...new Set(records.map(origin))];
    const order = sources.map((s) => s.id);
    const laneIds = [
      ...withRecords,
      ...MAIN_EMPTY_SOURCES.filter((id) => order.includes(id) && !withRecords.includes(id)),
    ].sort(
      (a, b) =>
        (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)),
    );
    const timed = records
      .map((n) => ({ n, t: stamp(n) }))
      .filter((r): r is { n: MemNode; t: number } => r.t != null);
    const lanes = laneIds.map((id) => {
      const list = timed.filter((r) => origin(r.n) === id);
      const counts = daily?.[id];
      return {
        id,
        name: sources.find((s) => s.id === id)?.name ?? labelOf(id),
        color:
          records.find((n) => origin(n) === id && n.color)?.color ??
          sources.find((s) => s.id === id)?.color ??
          "#9aa0b4",
        list,
        total: Math.max(list.length, counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0),
        counts,
      };
    });
    // Records per day across every source, for the peaks and the overview.
    const perDay = new Map<string, number>();
    for (const lane of lanes)
      if (lane.counts) for (const [k, v] of Object.entries(lane.counts)) perDay.set(k, (perDay.get(k) || 0) + v);
      else for (const r of lane.list) perDay.set(dayKey(r.t), (perDay.get(dayKey(r.t)) || 0) + 1);
    const times = timed.map((r) => r.t);
    for (const k of perDay.keys()) times.push(Date.parse(`${k}T12:00:00`));
    const now = Date.now();
    const oldest = times.length ? Math.min(...times) : now - 30 * DAY;
    return { lanes, perDay, first: dayStart(Math.max(oldest, now - 3 * 365 * DAY)), now };
  }, [nodes, sources, labelOf, daily]);

  // The visible window, animated between ranges.
  const full = useMemo<Win>(() => ({ start: model.first - DAY, end: model.now + HOUR * 2 }), [model]);
  const [range, setRange] = useState<TimelineRange | "custom">("90d");
  const [win, setWin] = useState<Win>(() => ({ start: Date.now() - 90 * DAY, end: Date.now() + HOUR * 2 }));
  const winRef = useRef(win);
  winRef.current = win;
  const anim = useRef(0);
  const animateTo = useCallback(
    (target: Win) => {
      cancelAnimationFrame(anim.current);
      const from = winRef.current,
        t0 = performance.now();
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const step = (now: number) => {
        const p = reduce ? 1 : Math.min(1, (now - t0) / 420);
        const k = ease(p);
        setWin({ start: from.start + (target.start - from.start) * k, end: from.end + (target.end - from.end) * k });
        if (p < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [],
  );
  const clamp = useCallback(
    (w: Win): Win => {
      const span = Math.max(2 * HOUR, Math.min(w.end - w.start, full.end - full.start));
      let start = w.start;
      if (start < full.start) start = full.start;
      if (start + span > full.end) start = full.end - span;
      return { start, end: start + span };
    },
    [full],
  );
  const pickRange = useCallback(
    (id: TimelineRange) => {
      setRange(id);
      const r = TIMELINE_RANGES.find((x) => x.id === id)!;
      animateTo(r.ms ? clamp({ start: full.end - r.ms, end: full.end }) : full);
    },
    [animateTo, clamp, full],
  );
  // Start on 90 days, or All when the history is shorter.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !model.lanes.length) return;
    started.current = true;
    const span = full.end - full.start;
    const id: TimelineRange = span < 90 * DAY ? "all" : "90d";
    setRange(id);
    const r = TIMELINE_RANGES.find((x) => x.id === id)!;
    setWin(r.ms ? clamp({ start: full.end - r.ms, end: full.end }) : full);
  }, [model, full, clamp]);
  useEffect(() => {
    if (!focus) return;
    setRange("custom");
    const pad = Math.max(HOUR * 6, (focus.end - focus.start) * 0.15);
    animateTo(clamp({ start: focus.start - pad, end: focus.end + pad }));
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = useMemo(() => {
    if (size.w < 60 || size.h < 120) return null;
    const left = 150,
      right = 16,
      axisY = 54,
      peaksTop = 58,
      peaksH = 28,
      top = peaksTop + peaksH + 10,
      miniH = 28,
      bottom = miniH + 34;
    const lanesH = size.h - top - bottom;
    const laneH = Math.max(20, Math.min(64, lanesH / Math.max(1, model.lanes.length)));
    const plotW = size.w - left - right;
    const x = (t: number) => left + ((t - win.start) / (win.end - win.start)) * plotW;
    const tAt = (px: number) => win.start + ((px - left) / plotW) * (win.end - win.start);
    const marks: Mark[] = [];
    const span = win.end - win.start;
    model.lanes.forEach((lane, i) => {
      const cy = top + laneH * (i + 0.5);
      for (const r of lane.list) {
        if (r.t < win.start - span * 0.02 || r.t > win.end + span * 0.02) continue;
        marks.push({
          n: r.n,
          t: r.t,
          x: x(r.t),
          y: cy + (hash(r.n.id) - 0.5) * laneH * 0.62,
          color: r.n.color || lane.color,
          lane: lane.id,
        });
      }
    });
    const miniTop = size.h - miniH - 20;
    const mx = (t: number) => left + ((t - full.start) / (full.end - full.start)) * plotW;
    const byId = new Map(marks.map((m) => [m.n.id, m]));
    const threads = relations
      .map((r) => [byId.get(r.source), byId.get(r.target)] as const)
      .filter((p): p is readonly [Mark, Mark] => !!p[0] && !!p[1]);
    // Bins: hours when zoomed in close, days otherwise, weeks for long views.
    const bin = span <= 3 * DAY ? HOUR : span <= 200 * DAY ? DAY : 7 * DAY;
    return { left, right, axisY, peaksTop, peaksH, top, laneH, plotW, x, tAt, marks, miniTop, miniH, mx, byId, threads, bin };
  }, [size, model, win, full, relations]);

  // Activity per bin in the window, across every lane, for the peaks strip.
  const peaks = useMemo(() => {
    if (!L) return [];
    const out: Array<{ t: number; n: number }> = [];
    const first = L.bin === HOUR ? Math.floor(win.start / HOUR) * HOUR : dayStart(win.start);
    for (let t = first; t < win.end; t += L.bin) {
      let n = 0;
      if (L.bin === HOUR) {
        for (const lane of model.lanes) for (const r of lane.list) if (r.t >= t && r.t < t + HOUR) n++;
      } else for (let d = t; d < t + L.bin; d += DAY) n += model.perDay.get(dayKey(d)) || 0;
      out.push({ t, n });
    }
    return out;
  }, [L, win, model]);

  const q = query.trim().toLowerCase();
  useEffect(() => {
    const c = canvas.current;
    if (!c || !L) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const css = getComputedStyle(wrap.current!);
    const ink = css.getPropertyValue("--op-ink").trim() || "#f0edf5";
    const muted = css.getPropertyValue("--op-muted").trim() || "#96919f";
    const { left, top, laneH, x, marks, peaksTop, peaksH, plotW } = L;
    const lanesBottom = top + laneH * model.lanes.length;
    const span = win.end - win.start;

    // Grid and labels: hours, days, weeks or months depending on zoom.
    g.font = "500 10px ui-monospace, 'SF Mono', Menlo, monospace";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    const tick =
      span <= 2 * DAY ? 3 * HOUR : span <= 10 * DAY ? DAY : span <= 45 * DAY ? 7 * DAY : span <= 400 * DAY ? 0 : -1;
    const ticks: number[] = [];
    if (tick > 0) {
      const first = tick >= DAY ? dayStart(win.start) : Math.floor(win.start / tick) * tick;
      for (let t = first; t <= win.end; t += tick) {
        if (tick === 7 * DAY && new Date(t).getDay() !== 1) {
          t = dayStart(t + ((8 - new Date(t).getDay()) % 7) * DAY) - tick;
          continue;
        }
        ticks.push(t);
      }
    } else {
      const d = new Date(win.start);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      for (let t = d.getTime(); t <= win.end; ) {
        const m = new Date(t);
        if (tick === 0 || m.getMonth() % 3 === 0) ticks.push(t);
        m.setMonth(m.getMonth() + 1);
        t = m.getTime();
      }
    }
    for (const t of ticks) {
      const px = x(t);
      if (px < left - 1 || px > left + plotW + 1) continue;
      g.globalAlpha = 0.12;
      g.strokeStyle = muted;
      g.beginPath();
      g.moveTo(px, peaksTop);
      g.lineTo(px, lanesBottom);
      g.stroke();
      g.globalAlpha = 0.75;
      g.fillStyle = muted;
      const dd = new Date(t);
      g.fillText(
        tick > 0 && tick < DAY
          ? dd.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
          : tick > 0
            ? dd.toLocaleDateString(undefined, { weekday: tick === DAY ? "short" : undefined, day: "numeric", month: "short" })
            : dd.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        px,
        L.axisY,
      );
    }

    // Peaks: records per bin, the busiest days stand tall.
    const peak = Math.max(1, ...peaks.map((p) => p.n));
    const bw = Math.max(1, (L.bin / span) * plotW);
    for (const p of peaks) {
      if (!p.n) continue;
      const px = x(p.t);
      const h = Math.max(1.5, (p.n / peak) * peaksH);
      const on = hoverDay != null && p.t <= hoverDay && hoverDay < p.t + L.bin;
      const chosen = day != null && L.bin <= DAY && dayStart(p.t) === day;
      g.globalAlpha = on || chosen ? 0.95 : 0.55;
      g.fillStyle = on || chosen ? "#F386A1" : "#D45BB6";
      g.fillRect(px + 0.5, peaksTop + peaksH - h, Math.max(1, bw - 1), h);
    }
    g.globalAlpha = 0.25;
    g.strokeStyle = muted;
    g.beginPath();
    g.moveTo(left, peaksTop + peaksH + 0.5);
    g.lineTo(left + plotW, peaksTop + peaksH + 0.5);
    g.stroke();

    // Chosen day: a soft column through every lane.
    if (day != null) {
      g.globalAlpha = 0.08;
      g.fillStyle = "#F386A1";
      g.fillRect(x(day), top, Math.max(2, x(day + DAY) - x(day)), lanesBottom - top);
    }

    // Now.
    g.globalAlpha = 0.8;
    g.strokeStyle = "#d45bb6";
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(x(Date.now()), peaksTop);
    g.lineTo(x(Date.now()), lanesBottom);
    g.stroke();
    g.setLineDash([]);

    // Lanes: band and activity wave.
    g.save();
    g.beginPath();
    g.rect(left, top - 4, plotW, lanesBottom - top + 8);
    g.clip();
    model.lanes.forEach((lane, i) => {
      const cy = top + laneH * (i + 0.5);
      g.globalAlpha = i % 2 ? 0.03 : 0.06;
      g.fillStyle = ink;
      g.fillRect(left, top + laneH * i, plotW, laneH);
      const binW = L.bin;
      const first = binW === HOUR ? Math.floor(win.start / HOUR) * HOUR : dayStart(win.start);
      const bins: number[] = [];
      for (let t = first; t < win.end; t += binW) {
        let n = 0;
        if (lane.counts && binW >= DAY) for (let d = t; d < t + binW; d += DAY) n += lane.counts[dayKey(d)] || 0;
        else for (const r of lane.list) if (r.t >= t && r.t < t + binW) n++;
        bins.push(n);
      }
      const top2 = Math.max(1, ...bins);
      g.globalAlpha = 0.2;
      g.fillStyle = lane.color;
      g.beginPath();
      g.moveTo(x(first), cy + laneH * 0.42);
      bins.forEach((b, k) => {
        const s = (bins[k - 1] ?? b) * 0.25 + b * 0.5 + (bins[k + 1] ?? b) * 0.25;
        g.lineTo(x(first + (k + 0.5) * binW), cy + laneH * 0.42 - (s / top2) * laneH * 0.8);
      });
      g.lineTo(x(first + bins.length * binW), cy + laneH * 0.42);
      g.closePath();
      g.fill();
    });

    // Relation threads.
    const focusId = hover?.n.id || selectedId;
    const thread = (a: Mark, b: Mark, alpha: number, width: number) => {
      g.globalAlpha = alpha;
      g.strokeStyle = "#F386A1";
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(a.x, a.y);
      const bend = Math.min(60, Math.abs(a.y - b.y) * 0.35 + 10);
      g.bezierCurveTo(a.x + bend, a.y, b.x - bend, b.y, b.x, b.y);
      g.stroke();
    };
    const quiet = !!q || !!highlightIds?.size;
    for (const [a, b] of L.threads) thread(a, b, quiet ? 0.03 : 0.07, 0.6);
    for (const [a, b] of L.threads)
      if (focusId && (a.n.id === focusId || b.n.id === focusId)) thread(a, b, 0.9, 1.5);
    g.lineWidth = 1;

    // Marks: bigger as you zoom in.
    const r0 = span <= 2 * DAY ? 4 : span <= 10 * DAY ? 3.4 : span <= 45 * DAY ? 2.8 : 2.3;
    for (const m of marks) {
      const hit = (q && m.n.name.toLowerCase().includes(q)) || highlightIds?.has(m.n.id);
      g.globalAlpha = quiet && !hit ? 0.13 : 0.9;
      g.fillStyle = m.color;
      g.beginPath();
      g.arc(m.x, m.y, hit ? r0 + 1.6 : r0, 0, Math.PI * 2);
      g.fill();
      if (hit) {
        g.globalAlpha = 0.9;
        g.strokeStyle = "#F386A1";
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(m.x, m.y, r0 + 4.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    const sel = selectedId ? L.byId.get(selectedId) : undefined;
    if (sel) {
      g.globalAlpha = 0.95;
      g.strokeStyle = "#F386A1";
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(sel.x, sel.y, r0 + 5, 0, Math.PI * 2);
      g.stroke();
      for (const [a, b] of L.threads)
        if (a === sel || b === sel) {
          const o = a === sel ? b : a;
          g.beginPath();
          g.arc(o.x, o.y, r0 + 3, 0, Math.PI * 2);
          g.stroke();
        }
    }
    if (hover) {
      g.globalAlpha = 1;
      g.shadowColor = hover.color;
      g.shadowBlur = 12;
      g.fillStyle = hover.color;
      g.beginPath();
      g.arc(hover.x, hover.y, r0 + 2.5, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
    g.restore();

    // Overview of all history, with the current window as a brush.
    const { miniTop, miniH, mx } = L;
    g.globalAlpha = 0.07;
    g.fillStyle = ink;
    g.fillRect(left, miniTop, plotW, miniH);
    const weeks = new Map<number, number>();
    for (const [k, v] of model.perDay) {
      const t = Date.parse(`${k}T12:00:00`);
      const w = Math.floor((t - full.start) / (7 * DAY));
      weeks.set(w, (weeks.get(w) || 0) + v);
    }
    const wPeak = Math.max(1, ...weeks.values());
    const ww = Math.max(1, ((7 * DAY) / (full.end - full.start)) * plotW);
    g.fillStyle = "#D45BB6";
    for (const [w, v] of weeks) {
      const h = Math.max(1, Math.sqrt(v / wPeak) * (miniH - 6));
      g.globalAlpha = 0.5;
      g.fillRect(mx(full.start + w * 7 * DAY), miniTop + miniH - 3 - h, Math.max(1, ww - 0.6), h);
    }
    const bx = mx(win.start),
      bw2 = Math.max(6, mx(win.end) - bx);
    g.globalAlpha = 0.16;
    g.fillStyle = "#F386A1";
    g.fillRect(bx, miniTop, bw2, miniH);
    g.globalAlpha = 0.9;
    g.strokeStyle = "#F386A1";
    g.lineWidth = 1.2;
    g.strokeRect(bx + 0.5, miniTop + 0.5, bw2 - 1, miniH - 1);
    g.fillStyle = "#F386A1";
    g.fillRect(bx - 1, miniTop + miniH / 2 - 7, 3, 14);
    g.fillRect(bx + bw2 - 2, miniTop + miniH / 2 - 7, 3, 14);
    g.globalAlpha = 0.7;
    g.fillStyle = muted;
    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = "500 9.5px ui-monospace, 'SF Mono', Menlo, monospace";
    g.fillText(new Date(full.start).toLocaleDateString(undefined, { month: "short", year: "numeric" }), left, miniTop + miniH + 4);
    g.textAlign = "right";
    g.fillText("Now", left + plotW, miniTop + miniH + 4);
    g.globalAlpha = 1;
  }, [L, size, model, hover, q, selectedId, highlightIds, peaks, hoverDay, day, win, full]);

  // Dev only: where each record sits, so headless checks can click real records.
  useEffect(() => {
    if (!import.meta.env.DEV || !L || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    (window as unknown as { __brainMarks?: unknown }).__brainMarks = L.marks
      .filter((m) => m.x > L.left && m.x < L.left + L.plotW)
      .map((m) => ({ id: m.n.id, origin: m.lane, kind: m.n.kind, x: r.left + m.x, y: r.top + m.y }));
  }, [L]);
  // Pointer: hover marks, drag to pan the lanes, drag or resize the brush, click a day.
  const drag = useRef<null | { kind: "pan" | "brush" | "left" | "right"; x0: number; win: Win; moved: boolean }>(null);
  const pick = (px: number, py: number) => {
    if (!L) return null;
    let best: Mark | null = null,
      bd = 110;
    for (const m of L.marks) {
      const d = (m.x - px) ** 2 + (m.y - py) ** 2;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  };
  const local = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const zone = (py: number) => {
    if (!L) return "none";
    if (py >= L.miniTop - 4) return "mini";
    if (py >= L.peaksTop && py <= L.peaksTop + L.peaksH + 4) return "peaks";
    return "lanes";
  };
  const onDown = (e: React.PointerEvent) => {
    if (!L) return;
    const { px, py } = local(e);
    const z = zone(py);
    if (z === "mini") {
      const bx = L.mx(win.start),
        bx2 = L.mx(win.end);
      const kind = Math.abs(px - bx) < 7 ? "left" : Math.abs(px - bx2) < 7 ? "right" : px > bx && px < bx2 ? "brush" : "brush";
      if (kind === "brush" && (px < bx || px > bx2)) {
        // Click outside the brush: jump the window there.
        const span = win.end - win.start;
        const t = full.start + ((px - L.left) / L.plotW) * (full.end - full.start);
        setRange("custom");
        animateTo(clamp({ start: t - span / 2, end: t + span / 2 }));
        return;
      }
      drag.current = { kind, x0: px, win, moved: false };
    } else if (z === "lanes") drag.current = { kind: "pan", x0: px, win, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!L) return;
    const { px, py } = local(e);
    const d = drag.current;
    if (d) {
      const dx = px - d.x0;
      if (Math.abs(dx) > 3) d.moved = true;
      if (!d.moved) return;
      setRange("custom");
      cancelAnimationFrame(anim.current);
      const span = d.win.end - d.win.start;
      if (d.kind === "pan") {
        const dt = (dx / L.plotW) * span;
        setWin(clamp({ start: d.win.start - dt, end: d.win.end - dt }));
      } else {
        const dt = (dx / L.plotW) * (full.end - full.start);
        if (d.kind === "brush") setWin(clamp({ start: d.win.start + dt, end: d.win.end + dt }));
        else if (d.kind === "left") setWin(clamp({ start: Math.min(d.win.start + dt, d.win.end - 2 * HOUR), end: d.win.end }));
        else setWin(clamp({ start: d.win.start, end: Math.max(d.win.end + dt, d.win.start + 2 * HOUR) }));
      }
      setHover(null);
      return;
    }
    const z = zone(py);
    setHover(z === "lanes" ? pick(px, py) : null);
    setHoverDay(z === "peaks" && px >= L.left ? L.tAt(px) : null);
    canvas.current!.style.cursor = z === "mini" ? "ew-resize" : z === "peaks" ? "pointer" : "crosshair";
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!L || (d && d.moved)) return;
    const { px, py } = local(e);
    const z = zone(py);
    if (z === "lanes") {
      const m = pick(px, py);
      if (m) onSelect?.(m.n);
      else if (px > L.left) setDay(dayStart(L.tAt(px)));
    } else if (z === "peaks" && px > L.left) setDay(dayStart(L.tAt(px)));
  };
  // Ctrl or Cmd with the wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      if (!L || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const t = L.tAt(e.clientX - r.left);
      const k = Math.exp(e.deltaY * 0.01);
      const w = winRef.current;
      setRange("custom");
      cancelAnimationFrame(anim.current);
      setWin(clamp({ start: t - (t - w.start) * k, end: t + (w.end - t) * k }));
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, [L, clamp]);

  // What the OS learned on the chosen day.
  const dayRecords = useMemo(() => {
    if (day == null) return null;
    const groups = model.lanes
      .map((lane) => ({
        lane,
        items: lane.list.filter((r) => r.t >= day && r.t < day + DAY).sort((a, b) => b.t - a.t),
        count: lane.counts?.[dayKey(day)] ?? 0,
      }))
      .map((g) => ({ ...g, count: Math.max(g.count, g.items.length) }))
      .filter((g) => g.count > 0);
    return { groups, total: groups.reduce((s, g) => s + g.count, 0) };
  }, [day, model]);

  const rangeLabel = useMemo(() => {
    const f = (t: number, withYear: boolean) =>
      new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
    const years = new Date(win.start).getFullYear() !== new Date(win.end).getFullYear();
    return `${f(win.start, years)} to ${f(Math.min(win.end, Date.now()), true)}`;
  }, [win]);
  const inWindow = L ? L.marks.length : 0;

  return (
    <div ref={wrap} className="brain-rings brain-timeline">
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setHover(null);
          setHoverDay(null);
        }}
        onDoubleClick={(e) => {
          const { px, py } = local(e);
          const m = zone(py) === "lanes" ? pick(px, py) : null;
          if (m) onOpen?.(m.n);
        }}
        role="img"
        aria-label={`Memory timeline, ${rangeLabel}: ${inWindow} records across ${model.lanes.length} sources`}
      />
      <div className="btl-bar">
        <div className="btl-ranges" role="group" aria-label="Time range">
          {TIMELINE_RANGES.map((r) => (
            <button key={r.id} aria-pressed={range === r.id} onClick={() => pickRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="btl-range-label">
          {rangeLabel} · {inWindow.toLocaleString()} records
        </span>
      </div>
      {L &&
        model.lanes.map((lane, i) => {
          const cy = L.top + L.laneH * (i + 0.5);
          const empty = !lane.total;
          const shown = lane.list.filter((r) => r.t >= win.start && r.t <= win.end).length;
          return (
            // Just the logo and the name; counts live in the hover title.
            // An empty source is dimmed and opens Connect on click.
            <div
              key={lane.id}
              className="brain-lane-label"
              data-empty={empty || undefined}
              title={empty ? `${lane.name}: not connected yet` : `${lane.name} · ${range === "all" ? lane.total.toLocaleString() : `${shown.toLocaleString()} of ${lane.total.toLocaleString()}`} records`}
              style={{ top: cy, width: L.left - 12, ["--sec" as string]: lane.color }}
              onClick={empty ? openConnectSources : undefined}
            >
              <BrainSourceLogo origin={lane.id} size={L.laneH < 30 ? 16 : 20} />
              <span>
                <b>{lane.name}</b>
              </span>
            </div>
          );
        })}
      {L && hoverDay != null && !hover && (
        <div className="brain-rings-tip" style={{ left: Math.min(L.x(hoverDay) + 12, size.w - 230), top: L.peaksTop + L.peaksH + 6 }}>
          {(() => {
            const p = peaks.find((b) => b.t <= hoverDay && hoverDay < b.t + L.bin);
            const d = new Date(p?.t ?? hoverDay);
            return (
              <>
                <b>
                  {L.bin === HOUR
                    ? d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })
                    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                </b>
                <span>
                  {(p?.n || 0).toLocaleString()} records{L.bin > DAY ? " that week" : ""} · click to open the day
                </span>
              </>
            );
          })()}
        </div>
      )}
      {hover && (
        <div
          className="brain-rings-tip"
          style={{ left: Math.min(hover.x + 14, size.w - 250), top: Math.max(8, hover.y - 18), ["--tip" as string]: hover.color }}
        >
          <b>{readableTitle(hover.n.name)}</b>
          <span>
            {labelOf(hover.lane)} · {new Date(hover.t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
          {(hover.n.meta || hover.n.preview) && <span className="brain-tip-preview">{(hover.n.meta || hover.n.preview || "").slice(0, 140)}</span>}
          <span className="brain-tip-hint">Click to open · double-click for the full view</span>
        </div>
      )}
      {day != null && dayRecords && (
        <aside className="btl-day" aria-label="What your OS learned this day">
          <header>
            <div>
              <span>What your OS learned</span>
              <b>{new Date(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</b>
            </div>
            <button aria-label="Close day" onClick={() => setDay(null)}>
              <X size={14} />
            </button>
          </header>
          {!dayRecords.total && <p className="btl-day-empty">Nothing was recorded on this day.</p>}
          {!!dayRecords.total && (
            <div className="btl-day-bars" aria-hidden>
              {dayRecords.groups.map((g) => (
                <i key={g.lane.id} style={{ flex: g.count, background: g.lane.color }} title={`${g.lane.name} ${g.count}`} />
              ))}
            </div>
          )}
          {dayRecords.groups.map((g) => (
            <section key={g.lane.id}>
              <h5>
                <BrainSourceLogo origin={g.lane.id} size={16} />
                {g.lane.name}
                <small>{g.count.toLocaleString()}</small>
              </h5>
              {g.items.slice(0, 6).map((r) => (
                <button key={r.n.id} onClick={() => onSelect?.(r.n)} onDoubleClick={() => onOpen?.(r.n)}>
                  <time>{new Date(r.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
                  <span>{readableTitle(r.n.name)}</span>
                </button>
              ))}
              {g.count > Math.min(6, g.items.length) && (
                <small className="btl-day-more">
                  {(g.count - Math.min(6, g.items.length)).toLocaleString()} more {g.items.length < g.count ? "in the full history" : ""}
                </small>
              )}
            </section>
          ))}
        </aside>
      )}
    </div>
  );
}
