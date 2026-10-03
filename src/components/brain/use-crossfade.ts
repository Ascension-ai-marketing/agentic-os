// When new data arrives, the old picture fades out over the new one instead of
// the map blinking. No spinners, no blank frames.
import { useLayoutEffect, useRef, type RefObject } from "react";

export function useCanvasCrossfade(canvas: RefObject<HTMLCanvasElement | null>, key: string) {
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    const c = canvas.current;
    const first = previous.current === null;
    const changed = previous.current !== key;
    previous.current = key;
    if (first || !changed || !c || !c.width || !c.height || !c.parentElement) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ghost = document.createElement("canvas");
    ghost.width = c.width;
    ghost.height = c.height;
    ghost.getContext("2d")?.drawImage(c, 0, 0);
    Object.assign(ghost.style, {
      position: "absolute",
      left: `${c.offsetLeft}px`,
      top: `${c.offsetTop}px`,
      width: c.style.width,
      height: c.style.height,
      pointerEvents: "none",
      transition: "opacity 480ms ease",
      opacity: "1",
    });
    c.parentElement.appendChild(ghost);
    requestAnimationFrame(() => requestAnimationFrame(() => (ghost.style.opacity = "0")));
    const done = window.setTimeout(() => ghost.remove(), 560);
    return () => {
      window.clearTimeout(done);
      ghost.remove();
    };
  }, [canvas, key]);
}

/** A cheap fingerprint of a record list: changes when records come or go. */
export const recordsKey = (nodes: Array<{ id: string }>) => {
  let h = nodes.length;
  for (let i = 0; i < nodes.length; i += Math.max(1, Math.floor(nodes.length / 64)))
    for (const ch of nodes[i].id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return String(h);
};
