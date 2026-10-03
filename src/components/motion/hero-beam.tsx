/**
 * The deck hero's blue light, as a calm backdrop for the top of the page: the
 * same Lightfall engine (WebGL, pure render(t)), run at half speed, low
 * resolution and low opacity, paused whenever it is off screen.
 *
 * The impact point sits exactly on the top edge of `anchor` (the box's slot):
 * the planet is made nearly flat so the light runs along that edge, the canvas
 * is cut just below it, and on every strike `--ml-strike` (0..1) is set on the
 * anchor so the box's rim can pulse in time with the light.
 */
import { useEffect, useRef } from "react";

type Lightfall = {
  init: (canvas: HTMLCanvasElement, opts?: Record<string, unknown>) => unknown;
  render: (t: number) => void;
  resize: () => void;
  dispose: () => void;
  configure?: (opts: Record<string, unknown>) => void;
  loop: number;
  strikes: number[];
};

const SPEED = 0.5; // beam seconds per real second
const HEIGHT = 600; // canvas height in CSS px (the light's scale follows it)
const FLAT = 40; // planet radius in canvas widths: nearly flat, like the box's edge

let loading: Promise<void> | null = null;
function loadEngine(): Promise<void> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "/motion/hero/lightfall.js";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return loading;
}

/** A gentle pulse: a quick swell, then a slow fade. */
function pulseAt(since: number): number {
  if (since < 0) return 0;
  if (since < 0.22) {
    const x = since / 0.22;
    return x * x * (3 - 2 * x);
  }
  return Math.exp(-(since - 0.22) / 1.15);
}

export function HeroBeam({ anchor }: { anchor: React.RefObject<HTMLElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let visible = true;
    let V: Lightfall | null = null;
    let apex = 0.7;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = ref.current;
    const box = wrap.current;
    if (!canvas || !box) return;

    // Put the impact on the anchor's top edge.
    let placedTop = NaN;
    const place = () => {
      const a = anchor.current;
      const parent = box.offsetParent as HTMLElement | null;
      if (!a || !parent) return;
      const ar = a.getBoundingClientRect();
      box.style.setProperty("--ml-box-half", `${Math.round(ar.width / 2)}px`);
      const top = Math.round(ar.top - parent.getBoundingClientRect().top);
      if (top === placedTop) return;
      placedTop = top;
      const lift = 24; // the canvas starts a little above the page
      const h = Math.max(HEIGHT, Math.round((top + lift) / 0.8));
      apex = (top + lift) / h;
      box.style.top = `${-lift}px`;
      box.style.height = `${h}px`;
      box.style.setProperty("--ml-apex", `${(apex * 100).toFixed(3)}%`);
      V?.configure?.({ apex, radius: FLAT });
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      place();
      V?.resize();
    });
    ro.observe(box);
    const host = anchor.current?.parentElement;
    if (host) ro.observe(host);
    place();

    let strikeAt = -1e9;
    let lastPulse = -1;
    const setPulse = (v: number) => {
      const r = Math.round(v * 200) / 200;
      if (r === lastPulse) return;
      lastPulse = r;
      anchor.current?.style.setProperty("--ml-strike", r.toFixed(3));
    };

    void loadEngine().then(() => {
      const F = (window as unknown as { MotionHeroLightfall?: { create: () => Lightfall } })
        .MotionHeroLightfall;
      if (disposed || !F) return;
      try {
        V = F.create();
        V.init(canvas, { dpr: Math.min(window.devicePixelRatio || 1, 1.25), apex, radius: FLAT });
      } catch {
        V = null;
        return;
      }
      canvas.dataset.ready = "1";
      const loop = V.loop || 8;
      const strikes = (V.strikes ?? []).slice().sort((a, b) => a - b);
      let t = 3.1;
      let prev = performance.now();
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(now - prev, 50) / 1000;
        prev = now;
        if (!visible || document.hidden || !V) return;
        if (!reduced) {
          const a = t % loop;
          t += dt * SPEED;
          const b = t % loop;
          for (const s of strikes) if (b >= a ? s > a && s <= b : s > a || s <= b) strikeAt = now;
          setPulse(pulseAt((now - strikeAt) / 1000));
        }
        V.render(t);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      anchor.current?.style.removeProperty("--ml-strike");
      try {
        V?.dispose();
      } catch {
        /* already gone */
      }
    };
  }, [anchor]);
  return (
    <div className="ml-beam" ref={wrap} aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
