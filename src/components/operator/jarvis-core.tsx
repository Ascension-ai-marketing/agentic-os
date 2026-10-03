import { useEffect, useRef } from "react";

export type CoreActivity =
  | "idle"
  | "listening"
  | "speaking"
  | "thinking"
  | "memory"
  | "email"
  | "build";
/** The Memory cortex palette, drawn as a living neural constellation. Activity is real call state. */
export function JarvisCore({
  activity = "idle",
  level = 0,
  paused = false,
  compact = false,
}: {
  activity?: CoreActivity;
  level?: number;
  paused?: boolean;
  compact?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ activity, level, paused });
  live.current = { activity, level, paused };
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      last = 0,
      time = 1.8,
      width = 0,
      height = 0,
      visible = true;
    let lastStill = "";
    let energy = 0,
      pointerX = 0,
      pointerY = 0;
    // A deterministic volumetric galaxy, with linked modules embedded in its dust lanes.
    let seed = 73;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const palette = [170, 202, 270, 283, 307, 42];
    const sprites = palette.map((color) => {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      const brush = sprite.getContext("2d")!;
      const glow = brush.createRadialGradient(32, 32, 0, 32, 32, 32);
      glow.addColorStop(0, `hsla(${color},100%,94%,1)`);
      glow.addColorStop(0.06, `hsla(${color},100%,85%,.95)`);
      glow.addColorStop(0.18, `hsla(${color},100%,65%,.5)`);
      glow.addColorStop(0.45, `hsla(${color},90%,55%,.12)`);
      glow.addColorStop(1, "transparent");
      brush.fillStyle = glow;
      brush.fillRect(0, 0, 64, 64);
      return sprite;
    });
    const points = Array.from({ length: compact ? 105 : 1500 }, (_, index) => {
      const radius = 0.055 + Math.pow(random(), 0.7) * 1.04;
      const arm = index % 3;
      const angle = radius * 5.1 + (arm * Math.PI * 2) / 3 + (random() - 0.5) * 0.9;
      const spread = (random() + random() + random() - 1.5) * 0.19;
      return {
        x: Math.cos(angle) * radius + spread,
        y: Math.sin(angle) * radius * 0.75 + spread,
        z: (random() - 0.5) * (0.23 + radius * 0.3),
        color:
          arm === 0
            ? index % 7 === 0
              ? 5
              : 0
            : arm === 1
              ? index % 3 === 0
                ? 3
                : 1
              : index % 3 === 0
                ? 4
                : 2,
        size: 0.45 + random() * 1.15,
        phase: random() * Math.PI * 2,
      };
    });
    const nodes = points.slice(0, compact ? 32 : 340);
    const edges: [number, number][] = [];
    nodes.forEach((node, i) => {
      const near = nodes
        .map((other, j) => ({
          j,
          distance: Math.hypot(node.x - other.x, node.y - other.y, node.z - other.z),
        }))
        .filter((other) => other.j !== i && other.distance < 0.38)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, compact ? 2 : 5);
      for (const other of near) if (other.j > i) edges.push([i, other.j]);
    });
    function resize() {
      const rect = el!.getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      lastStill = "";
      el!.width = width * ratio;
      el!.height = height * ratio;
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    intersection.observe(el);
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointerX = (event.clientX - rect.left) / rect.width - 0.5;
      pointerY = (event.clientY - rect.top) / rect.height - 0.5;
    };
    const leave = () => {
      pointerX = 0;
      pointerY = 0;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    function draw(stamp: number) {
      frame = requestAnimationFrame(draw);
      if (!visible || document.hidden || stamp - last < (compact ? 65 : 33)) return;
      const delta = Math.min((stamp - last) / 1000, 0.08);
      last = stamp;
      const state = live.current;
      const still = reduced.matches || state.paused;
      const stillKey = `${state.activity}:${width}:${height}:${state.paused}`;
      if (still && lastStill === stillKey) return;
      lastStill = still ? stillKey : "";
      if (still) {
        energy = 0;
      }
      if (!still)
        time +=
          delta *
          (state.activity === "idle"
            ? 0.3
            : state.activity === "thinking" || state.activity === "build"
              ? 0.8
              : 0.5);
      energy += ((still ? 0 : Math.min(1, Math.max(0, state.level))) - energy) * 0.14;
      if (!width || !height) return;
      ctx!.clearRect(0, 0, width, height);
      const scale = Math.min(width * 0.45, height * 0.48);
      const cx = width * 0.5,
        cy = height * 0.48;
      const breath = 1 + energy * 0.07 + Math.sin(time * 0.45) * 0.014;
      const rotation = time * 0.035;
      const cos = Math.cos(rotation),
        sin = Math.sin(rotation);
      const tilt = 0.5 + Math.sin(time * 0.1) * 0.08;
      const project = (p: (typeof points)[number]) => {
        const x = p.x * cos - p.y * sin,
          y = p.x * sin + p.y * cos;
        const depth = y * Math.sin(tilt) + p.z * Math.cos(tilt);
        const perspective = 1 + depth * 0.2;
        return {
          x: cx + (x + pointerX * depth * 0.14) * scale * breath * perspective,
          y:
            cy +
            (y * Math.cos(tilt) - p.z * Math.sin(tilt) - x * 0.21 + pointerY * depth * 0.12) *
              scale *
              breath *
              perspective,
          depth,
          perspective,
        };
      };
      const projected = points.map(project);
      const glow = (x: number, y: number, radius: number, color: number, alpha: number) => {
        ctx!.globalAlpha = alpha;
        ctx!.drawImage(sprites[color], x - radius, y - radius, radius * 2, radius * 2);
      };
      ctx!.globalCompositeOperation = "lighter";
      // Soft, overlapping clouds create depth without a hard sphere silhouette.
      if (!compact) {
        for (let i = 0; i < 115; i++) {
          const p = projected[i * 7],
            node = points[i * 7];
          glow(p.x, p.y, scale * (0.27 + node.size * 0.11), node.color, 0.18 + energy * 0.05);
        }
      }
      // Fine threads weave across the nebula; occasional pulses travel through real links.
      ctx!.lineWidth = compact ? 0.45 : 0.55;
      for (let i = 0; i < edges.length; i++) {
        const [a, b] = edges[i],
          from = projected[a],
          to = projected[b];
        ctx!.globalAlpha = 0.17 + (from.depth + 1) * 0.09 + energy * 0.08;
        ctx!.strokeStyle = `hsl(${palette[nodes[a].color]},75%,72%)`;
        ctx!.beginPath();
        ctx!.moveTo(from.x, from.y);
        ctx!.lineTo(to.x, to.y);
        ctx!.stroke();
        if (!compact && i % 19 === 0) {
          const progress = (time * 0.18 + i * 0.073) % 1;
          glow(
            from.x + (to.x - from.x) * progress,
            from.y + (to.y - from.y) * progress,
            4 + energy * 3,
            nodes[a].color,
            0.7,
          );
        }
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const p = projected[i],
          node = points[i];
        const flicker = still ? 0.8 : 0.74 + Math.sin(time * 0.8 + node.phase) * 0.2;
        const linked = i < nodes.length;
        const radius = compact
          ? 0.7 + node.size * 1.8
          : (linked ? 2.6 : 1.1) + node.size * (linked ? 2.8 : 1.9);
        glow(
          p.x,
          p.y,
          radius * p.perspective * (1 + energy * 0.2),
          node.color,
          flicker * (linked ? 1 : 0.7),
        );
        if (linked && i % 17 === 0 && !compact) {
          // Small modular cells nested in the network, with a luminous central node.
          const size = (4.5 + node.size * 2) * p.perspective;
          ctx!.globalAlpha = 0.45;
          ctx!.strokeStyle = `hsl(${palette[node.color]},80%,80%)`;
          ctx!.lineWidth = 0.65;
          ctx!.beginPath();
          ctx!.moveTo(p.x - size, p.y - size * 0.6);
          ctx!.lineTo(p.x, p.y - size);
          ctx!.lineTo(p.x + size, p.y - size * 0.6);
          ctx!.lineTo(p.x + size, p.y + size * 0.6);
          ctx!.lineTo(p.x, p.y + size);
          ctx!.lineTo(p.x - size, p.y + size * 0.6);
          ctx!.closePath();
          ctx!.stroke();
          glow(p.x, p.y, size * 2.6, node.color, 0.62);
        }
      }
      // An irregular, bright heart keeps the network alive while leaving the dust visible.
      const coreColor = state.activity === "thinking" ? 3 : state.activity === "build" ? 5 : 0;
      glow(cx, cy, scale * 0.31, coreColor, 0.55 + energy * 0.2);
      glow(cx - scale * 0.025, cy + scale * 0.018, scale * 0.16, 1, 0.5);
      glow(cx, cy, compact ? 5 : 13 + energy * 9, coreColor, 0.9);
      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = "source-over";
    }
    resize();
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [compact]);
  return (
    <canvas
      ref={canvas}
      className={`jarvis-core ${compact ? "is-compact" : ""}`}
      data-activity={activity}
      aria-hidden="true"
    />
  );
}
