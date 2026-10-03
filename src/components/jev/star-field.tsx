// A small galaxy behind the voice orb. Stars orbit the orb and react to what
// it is doing: a slow drift at rest, a rush inward while listening, a swirl
// while Jev decides, a pulse outward while it speaks. They lean toward the
// pointer when you hover.
import { useEffect, useRef, type MutableRefObject } from "react";
import type { OrbMood } from "./voice-orb-canvas";

export type PointerState = { x: number; y: number; active: number };

const TINT: Record<OrbMood, [number, number, number]> = {
  idle: [169, 139, 230],
  listening: [46, 230, 200],
  thinking: [212, 91, 182],
  working: [245, 165, 36],
  speaking: [143, 124, 255],
  error: [226, 85, 85],
};
// How the field moves in each state: spin speed and radial pull.
const MOTION: Record<OrbMood, { spin: number; pull: number }> = {
  idle: { spin: 0.05, pull: 0 },
  listening: { spin: 0.12, pull: -0.22 },
  thinking: { spin: 0.9, pull: 0 },
  working: { spin: 0.35, pull: 0.02 },
  speaking: { spin: 0.18, pull: 0.12 },
  error: { spin: 0.02, pull: 0 },
};

type Star = { r: number; a: number; z: number; tw: number; ph: number };

export function StarField({
  mood,
  levelRef,
  pointerRef,
  centerY = 0.42,
}: {
  mood: OrbMood;
  levelRef: MutableRefObject<number>;
  pointerRef: MutableRefObject<PointerState>;
  centerY?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let w = 0, h = 0, maxR = 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stars: Star[] = [];
    const spawn = (outer = false): Star => ({
      r: outer ? 0.85 + Math.random() * 0.25 : 0.12 + Math.random() * 1.0,
      a: Math.random() * Math.PI * 2,
      z: 0.25 + Math.random() * 0.75,
      tw: 0.6 + Math.random() * 2.2,
      ph: Math.random() * Math.PI * 2,
    });
    for (let i = 0; i < 110; i++) stars.push(spawn());
    const size = () => {
      const r = c.getBoundingClientRect();
      w = r.width;
      h = r.height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      maxR = Math.hypot(w, h) * 0.55;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);

    let spin = MOTION.idle.spin, pull = 0, hover = 0;
    let tint = [...TINT.idle];
    let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let nextShoot = 3 + Math.random() * 5;
    let last = performance.now();
    let raf = 0;
    const frame = (now: number, force = false) => {
      raf = requestAnimationFrame((t) => frame(t));
      if (document.hidden && !force) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = moodRef.current;
      const k = 1 - Math.exp(-dt * 2.5);
      spin += (MOTION[m].spin - spin) * k;
      pull += (MOTION[m].pull - pull) * k;
      tint = tint.map((v, i) => v + (TINT[m][i] - v) * k);
      const p = pointerRef.current;
      hover += (p.active - hover) * (1 - Math.exp(-dt * 6));
      const level = levelRef.current;
      const cx = w / 2, cy = h * centerY;
      const t = now / 1000;

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      // Nebula glow behind the orb, tinted by state.
      const neb = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
      const [tr, tg, tb] = tint.map(Math.round);
      neb.addColorStop(0, `rgba(${tr},${tg},${tb},${0.2 + level * 0.15})`);
      neb.addColorStop(0.45, `rgba(${tr},${tg},${tb},0.05)`);
      neb.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = neb;
      g.fillRect(0, 0, w, h);

      const speed = reduce ? 0 : 1;
      for (const s of stars) {
        s.a += spin * dt * speed * (0.4 + (1.2 - s.r) * 0.8) * (0.5 + s.z);
        s.r += (pull * (1 + level * 2) * dt * speed) / (0.6 + s.z);
        if (s.r < 0.1 || s.r > 1.15) Object.assign(s, spawn(s.r < 0.1));
        const px = (p.x * 10 * s.z) * hover, py = (p.y * 10 * s.z) * hover;
        const x = cx + Math.cos(s.a) * s.r * maxR + px;
        const y = cy + Math.sin(s.a) * s.r * maxR * 0.9 + py;
        const twinkle = 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
        const size = (0.4 + s.z * 1.1) * (1 + level * 0.6 * s.z);
        g.globalAlpha = Math.min(1, (0.25 + 0.75 * s.z) * twinkle);
        g.fillStyle = s.z > 0.8 ? `rgb(${tr},${tg},${tb})` : "#fff";
        g.beginPath();
        g.arc(x, y, size, 0, Math.PI * 2);
        g.fill();
        if (s.z > 0.85 && twinkle > 0.9) {
          g.globalAlpha = 0.25 * twinkle;
          g.fillRect(x - size * 3, y - 0.3, size * 6, 0.6);
          g.fillRect(x - 0.3, y - size * 3, 0.6, size * 6);
        }
      }
      // An occasional shooting star.
      if (!reduce) {
        nextShoot -= dt;
        if (!shoot && nextShoot <= 0) {
          shoot = { x: Math.random() * w * 0.6, y: -4, vx: 90 + Math.random() * 60, vy: 70 + Math.random() * 40, life: 1 };
          nextShoot = 6 + Math.random() * 8;
        }
        if (shoot) {
          shoot.x += shoot.vx * dt;
          shoot.y += shoot.vy * dt;
          shoot.life -= dt * 0.9;
          const grad = g.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 0.25, shoot.y - shoot.vy * 0.25);
          grad.addColorStop(0, `rgba(255,255,255,${0.8 * shoot.life})`);
          grad.addColorStop(1, "rgba(255,255,255,0)");
          g.globalAlpha = 1;
          g.strokeStyle = grad;
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(shoot.x, shoot.y);
          g.lineTo(shoot.x - shoot.vx * 0.25, shoot.y - shoot.vy * 0.25);
          g.stroke();
          if (shoot.life <= 0 || shoot.x > w + 20 || shoot.y > h + 20) shoot = null;
        }
      }
      g.globalAlpha = 1;
    };
    frame(performance.now(), true);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [levelRef, pointerRef, centerY]);

  return <canvas ref={ref} className="jev-stars" aria-hidden="true" />;
}
