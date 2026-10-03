/**
 * The tiny runner: one requestAnimationFrame loop drives every attached canvas.
 *
 * - Only canvases on screen animate (IntersectionObserver); the rest freeze.
 * - Canvases far off screen give their pixels back and redraw when they return.
 * - Each tick has a time budget. Tiles past it wait for the next tick, so
 *   scrolling stays smooth with a hundred-plus tiles on the page.
 * - A quality governor trims tile resolution when the budget keeps running out
 *   and restores it when there is headroom. The detail view is exempt.
 * - First frames are the expensive ones (a style bakes its textures then), so
 *   tiles coming near are drawn in idle time, nearest first, and styles a little
 *   further down are warmed (drawn once off screen at their tile size) the same
 *   way. Scrolling then only pays for ordinary frames.
 */
import { drawFrame } from "./render";
import type { MotionStyle, Theme } from "./types";
import { LOOP } from "./types";
import { hashString } from "./kit";

export interface TileOptions {
  style: MotionStyle;
  theme: Theme;
  /** Cap on the backing-store width in device pixels. */
  maxWidth?: number;
  /** Target frames per second for this canvas. */
  fps?: number;
  /** Higher renders first and is never trimmed by the governor. */
  priority?: number;
  /** Width / height of the drawn frame. Defaults to the element's box. */
  aspect?: number;
  /** Seconds added to the clock, so a wall does not move in lockstep. */
  offset?: number;
  /** Freeze on this time (used for reduced motion and posters). */
  still?: number | null;
  /** Called after each draw with the loop time drawn. */
  onFrame?: (t: number) => void;
  onError?: (error: Error) => void;
}

export interface TileHandle {
  update(options: Partial<TileOptions>): void;
  /** Draw now at the current clock (or at t). */
  draw(t?: number): void;
  detach(): void;
}

interface Tile extends Required<Omit<TileOptions, "onFrame" | "onError" | "still" | "aspect">> {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  /** How much of the tile is on screen (0..1). */
  ratio: number;
  still: number | null;
  aspect: number | null;
  onFrame?: (t: number) => void;
  onError?: (error: Error) => void;
  cssW: number;
  cssH: number;
  visible: boolean;
  near: boolean;
  due: number;
  cost: number;
  dirty: boolean;
  failed: boolean;
  /** Size key ("WxH") this tile's style was last drawn or warmed at. */
  warmed: string;
}

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class MotionRunner {
  private tiles = new Map<HTMLCanvasElement, Tile>();
  private io: IntersectionObserver;
  private near: IntersectionObserver;
  private ro: ResizeObserver;
  private raf = 0;
  private start = performance.now();
  private cursor = 0;
  private pausedAt: number | null = null;
  /** 0.55..1, applied to trimmable tiles. */
  quality = 1;
  private overBudget = 0;
  private underBudget = 0;
  readonly budgetMs: number;
  readonly reduced: boolean;
  /** Most wall tiles that animate at once; the rest hold their last frame. */
  readonly maxLive: number;
  private idle = 0;
  private scratch: HTMLCanvasElement | null = null;

  constructor(options: { budgetMs?: number; maxLive?: number } = {}) {
    this.budgetMs = options.budgetMs ?? 9;
    this.reduced = reducedMotion();
    this.maxLive = options.maxLive ?? 12;
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const tile = this.tiles.get(e.target as HTMLCanvasElement);
          if (!tile) continue;
          tile.visible = e.isIntersecting;
          tile.ratio = e.intersectionRatio;
          if (tile.visible) tile.due = 0;
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    this.near = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const tile = this.tiles.get(e.target as HTMLCanvasElement);
          if (!tile) continue;
          tile.near = e.isIntersecting;
          if (tile.near) {
            this.resize(tile);
            // Drawn in idle time (or by the tick if it comes on screen first).
            tile.dirty = true;
            this.scheduleWarm();
          } else {
            // Give the pixels back; the canvas redraws when it comes near again.
            tile.canvas.width = 1;
            tile.canvas.height = 1;
            tile.warmed = "";
          }
        }
      },
      { rootMargin: "1200px 0px" },
    );
    this.ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const tile = this.tiles.get(e.target as HTMLCanvasElement);
        if (!tile) continue;
        tile.cssW = e.contentRect.width;
        tile.cssH = e.contentRect.height;
        if (tile.priority > 0) {
          this.resize(tile);
          this.render(tile, this.clock());
        } else if (tile.near) {
          this.resize(tile);
          tile.due = 0;
          this.scheduleWarm();
        }
      }
    });
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Seconds since the runner started (frozen while paused). */
  clock(): number {
    const now = this.pausedAt ?? performance.now();
    return (now - this.start) / 1000;
  }

  pause() {
    if (this.pausedAt === null) this.pausedAt = performance.now();
  }

  resume() {
    if (this.pausedAt !== null) {
      this.start += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  get paused() {
    return this.pausedAt !== null;
  }

  attach(canvas: HTMLCanvasElement, options: TileOptions): TileHandle {
    const rect = canvas.getBoundingClientRect();
    const lazy = !options.priority;
    // Wall tiles start as 1x1 and get pixels (and a context) only when near the viewport.
    if (lazy) {
      canvas.width = 1;
      canvas.height = 1;
    }
    const tile: Tile = {
      canvas,
      ctx: null,
      ratio: 0,
      style: options.style,
      theme: options.theme,
      maxWidth: options.maxWidth ?? 720,
      fps: options.fps ?? 30,
      priority: options.priority ?? 0,
      aspect: options.aspect ?? null,
      offset: options.offset ?? hashString(options.style.id) * (options.style.duration ?? LOOP),
      still: options.still ?? (this.reduced ? 1.9 : null),
      onFrame: options.onFrame,
      onError: options.onError,
      cssW: rect.width,
      cssH: rect.height,
      visible: options.priority ? true : false,
      near: options.priority ? true : false,
      due: 0,
      cost: 2,
      dirty: true,
      failed: false,
      warmed: "",
    };
    this.tiles.set(canvas, tile);
    this.io.observe(canvas);
    this.near.observe(canvas);
    this.ro.observe(canvas);
    if (!lazy) {
      this.resize(tile);
      this.render(tile, this.clock());
    } else this.scheduleWarm();
    return {
      update: (next) => {
        const reset = next.style && next.style !== tile.style;
        Object.assign(tile, next);
        if (next.still === undefined && this.reduced && tile.still === null) tile.still = 1.9;
        if (reset) tile.failed = false;
        if (next.aspect !== undefined || next.maxWidth !== undefined) this.resize(tile);
        tile.due = 0;
        tile.dirty = true;
        this.render(tile, this.clock());
      },
      draw: (t) => this.render(tile, t === undefined ? this.clock() : t, t !== undefined),
      detach: () => {
        this.io.unobserve(canvas);
        this.near.unobserve(canvas);
        this.ro.unobserve(canvas);
        this.tiles.delete(canvas);
      },
    };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    if (this.idle && typeof window !== "undefined") {
      if (window.cancelIdleCallback) window.cancelIdleCallback(this.idle);
      else window.clearTimeout(this.idle);
    }
    this.idle = 0;
    this.io.disconnect();
    this.near.disconnect();
    this.ro.disconnect();
    this.tiles.clear();
  }

  /** Idle-time work: draw near tiles that are still blank, then warm the next ones. */
  private scheduleWarm() {
    if (this.idle || typeof window === "undefined") return;
    const ric =
      window.requestIdleCallback?.bind(window) ??
      ((cb: IdleRequestCallback) =>
        window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 80));
    this.idle = ric(
      (deadline) => {
        this.idle = 0;
        const pending = this.warmList();
        for (const { tile, near } of pending) {
          if (deadline.timeRemaining() < 3 && !deadline.didTimeout) break;
          if (near) this.render(tile, this.clock());
          else this.warm(tile);
          if (deadline.didTimeout) break;
        }
        if (pending.length) this.scheduleWarm();
      },
      { timeout: 900 },
    );
  }

  /** Blank near tiles, then tiles within a few screens that were never drawn at their size. */
  private warmList(): { tile: Tile; near: boolean; d: number }[] {
    if (typeof window === "undefined") return [];
    const vh = window.innerHeight || 800;
    const out: { tile: Tile; near: boolean; d: number }[] = [];
    for (const tile of this.tiles.values()) {
      if (tile.priority > 0 || tile.failed) continue;
      const [w, h] = this.targetSize(tile);
      if (tile.warmed === `${w}x${h}`) continue;
      const r = tile.canvas.getBoundingClientRect();
      if (!r.width) continue;
      const d = r.bottom < 0 ? -r.bottom : r.top > vh ? r.top - vh : 0;
      if (tile.near && tile.canvas.width > 1) out.push({ tile, near: true, d: d - 1e5 });
      else if (d < 3200) out.push({ tile, near: false, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Draw one frame of a far tile's style off screen at its size, so its textures are baked. */
  private warm(tile: Tile) {
    const [w, h] = this.targetSize(tile);
    tile.warmed = `${w}x${h}`;
    if (!this.scratch) this.scratch = document.createElement("canvas");
    const c = this.scratch;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d", { alpha: false });
    if (ctx) drawFrame(ctx, tile.style, tile.still ?? 1.9, tile.theme, w, h);
  }

  private targetSize(tile: Tile): [number, number] {
    const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
    const cssW = tile.cssW || tile.canvas.clientWidth || 320;
    const cssH = tile.cssH || tile.canvas.clientHeight || cssW * (9 / 16);
    const aspect = tile.aspect ?? cssW / Math.max(1, cssH);
    const q = tile.priority > 0 ? 1 : this.quality;
    const w = Math.max(64, Math.round(Math.min(cssW * dpr, tile.maxWidth) * q));
    return [w, Math.max(36, Math.round(w / aspect))];
  }

  private resize(tile: Tile) {
    const [w, h] = this.targetSize(tile);
    if (tile.canvas.width !== w || tile.canvas.height !== h) {
      tile.canvas.width = w;
      tile.canvas.height = h;
      tile.dirty = true;
    }
  }

  private render(tile: Tile, clock: number, exact = false) {
    if (tile.canvas.width <= 1) return;
    if (!tile.ctx) tile.ctx = tile.canvas.getContext("2d", { alpha: false });
    if (!tile.ctx) return;
    const t = exact
      ? clock
      : tile.still !== null
        ? tile.still
        : (((clock + tile.offset) % (tile.style.duration ?? LOOP)) +
            (tile.style.duration ?? LOOP)) %
          (tile.style.duration ?? LOOP);
    tile.warmed = `${tile.canvas.width}x${tile.canvas.height}`;
    const t0 = performance.now();
    const error = drawFrame(
      tile.ctx,
      tile.style,
      t,
      tile.theme,
      tile.canvas.width,
      tile.canvas.height,
    );
    tile.cost = tile.cost * 0.8 + (performance.now() - t0) * 0.2;
    tile.dirty = false;
    if (error && !tile.failed) {
      tile.failed = true;
      tile.onError?.(error);
      console.error(`[motion] ${tile.style.id} failed to render`, error);
    }
    tile.onFrame?.(t);
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (typeof document !== "undefined" && document.hidden) return;
    const clock = this.clock();
    const list: Tile[] = [];
    for (const tile of this.tiles.values()) if (tile.visible && tile.near) list.push(tile);
    if (!list.length) return;
    list.sort((a, b) => b.priority - a.priority);
    const tickStart = performance.now();
    let spent = 0;
    let skipped = 0;
    const n = list.length;
    const first = list.filter((t) => t.priority > 0);
    let rest = list.filter((t) => t.priority <= 0);
    // Cap live tiles: the most-visible ones animate; the rest hold their frame.
    const held = new Set<Tile>();
    if (rest.length > this.maxLive) {
      rest = [...rest].sort((a, b) => b.ratio - a.ratio);
      for (const t of rest.slice(this.maxLive)) held.add(t);
    }
    const order = [...first];
    for (let i = 0; i < rest.length; i++) order.push(rest[(i + this.cursor) % rest.length]);
    this.cursor = (this.cursor + 1) % Math.max(1, rest.length);
    for (const tile of order) {
      const frozen = tile.still !== null || held.has(tile) || this.paused;
      if (frozen ? !tile.dirty : now < tile.due) continue;
      if (tile.priority <= 0 && spent > this.budgetMs) {
        skipped++;
        continue;
      }
      this.render(tile, clock);
      spent = performance.now() - tickStart;
      const frame = 1000 / tile.fps;
      tile.due = now + frame - Math.min(frame * 0.5, 4);
    }
    this.govern(spent, skipped, n);
  };

  /** Trim or restore tile resolution from how often the budget runs out. */
  private govern(spent: number, skipped: number, visible: number) {
    if (skipped > 0 || spent > this.budgetMs * 1.4) {
      this.overBudget++;
      this.underBudget = 0;
    } else if (spent < this.budgetMs * 0.35) {
      this.underBudget++;
      this.overBudget = Math.max(0, this.overBudget - 1);
    }
    let next = this.quality;
    if (this.overBudget > 45) next = Math.max(0.55, this.quality - 0.1);
    else if (this.underBudget > 240 && this.quality < 1) next = Math.min(1, this.quality + 0.05);
    if (next !== this.quality) {
      this.quality = next;
      this.overBudget = 0;
      this.underBudget = 0;
      for (const tile of this.tiles.values())
        if (tile.priority <= 0 && tile.near) this.resize(tile);
    }
    void visible;
  }
}
