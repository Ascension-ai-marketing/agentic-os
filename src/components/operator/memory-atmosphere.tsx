import { useEffect, useMemo, useRef } from "react";
import { brainEnabled, sourceOrigin } from "@/lib/brain-sources";
import type { OperatorState } from "@/lib/operator";

/** A quiet projection of enabled memories. Movement is ambient, not a claim of agent activity. */
export function MemoryAtmosphere({ state }: { state: OperatorState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const memories = useMemo(
    () =>
      state.sources
        .filter((s) => !s.deletedAt && brainEnabled(state, sourceOrigin(s)))
        .slice(0, 110)
        .map((s) => ({ id: s.id, collection: s.collection || "personal" })),
    [state],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0,
      height = 0,
      frame = 0,
      last = 0,
      elapsed = 0;
    const colors: Record<string, string> = {
      business: "185,158,241",
      projects: "102,202,230",
      personal: "141,156,251",
      content: "219,171,210",
    };
    const points = memories.map((m, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / memories.length),
        theta = i * Math.PI * (3 - Math.sqrt(5));
      let hash = 0;
      for (const c of m.id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
      return {
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta),
        radius: Math.abs(hash) % 13 === 0 ? 4.2 : 1.4 + (Math.abs(hash) % 3) * 0.5,
        color: colors[m.collection] || "121,184,214",
        group: m.collection,
      };
    });
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const angle = elapsed * 0.000025,
        size = Math.min(width * 0.55, height * 0.53);
      const projected = points.map((p) => {
        const x = p.x * Math.cos(angle) + p.z * Math.sin(angle),
          z = -p.x * Math.sin(angle) + p.z * Math.cos(angle),
          depth = 1 + z * 0.18;
        return {
          ...p,
          x: width / 2 + x * size * depth,
          y: height * 0.48 + p.y * size * 0.76 * depth,
          depth: (z + 1) / 2,
        };
      });
      for (let i = 0; i < projected.length; i++) {
        const a = projected[i];
        for (let j = i + 1; j < projected.length; j++) {
          const b = projected[j],
            distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (a.group !== b.group || distance > size * 0.6 || j % 3) continue;
          ctx.strokeStyle = `rgba(${a.color},${(0.05 + a.depth * 0.11) * (1 - distance / (size * 0.7))})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      projected
        .sort((a, b) => a.depth - b.depth)
        .forEach((p) => {
          const radius = p.radius * (0.7 + p.depth * 0.5),
            alpha = 0.16 + p.depth * 0.52;
          if (p.radius > 3) {
            const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 5);
            glow.addColorStop(0, `rgba(${p.color},.28)`);
            glow.addColorStop(1, `rgba(${p.color},0)`);
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius * 5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = `rgba(${p.color},${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
          ctx.fill();
          if (p.radius > 3) {
            ctx.fillStyle = `rgba(226,235,255,${alpha * 0.65})`;
            ctx.beginPath();
            ctx.arc(p.x - radius * 0.2, p.y - radius * 0.25, radius * 0.3, 0, Math.PI * 2);
            ctx.fill();
          }
        });
    };
    const tick = (time: number) => {
      if (!document.hidden && time - last > 32) {
        elapsed += last ? Math.min(time - last, 64) : 0;
        last = time;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    const updateMotion = () => {
      cancelAnimationFrame(frame);
      if (!motion.matches) frame = requestAnimationFrame(tick);
      else draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    updateMotion();
    motion.addEventListener("change", updateMotion);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", updateMotion);
    };
  }, [memories]);
  return <canvas ref={canvas} className="jarvis-atmosphere" aria-hidden="true" />;
}
