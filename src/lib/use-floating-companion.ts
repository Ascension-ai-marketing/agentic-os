import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
export type FloatingPoint = { x: number; y: number };
/** Keep a draggable companion reachable after dragging, resizing or opening its dock. */
export function useFloatingCompanion(
  ref: RefObject<HTMLElement | null>,
  visible: boolean,
  fallbackWidth: number,
  fallbackHeight: number,
) {
  const [position, setPosition] = useState<FloatingPoint | null>(null);
  const current = useRef(position);
  current.current = position;
  const gesture = useRef<{
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const dragged = useRef(false);
  const clamp = (p: FloatingPoint) => {
    const rect = ref.current?.getBoundingClientRect();
    const width = rect?.width || Math.min(fallbackWidth, window.innerWidth - 24),
      height = rect?.height || Math.min(fallbackHeight, window.innerHeight - 24);
    return {
      x: Math.max(12, Math.min(p.x, window.innerWidth - width - 12)),
      y: Math.max(12, Math.min(p.y, window.innerHeight - height - 12)),
    };
  };
  function moveTo(p: FloatingPoint) {
    setPosition(clamp(p));
  }
  useEffect(() => {
    if (!visible) return;
    const fit = () => {
      const rect = ref.current?.getBoundingClientRect();
      const p = current.current || {
        x: window.innerWidth - (rect?.width || fallbackWidth) - 24,
        y: window.innerHeight - (rect?.height || fallbackHeight) - 24,
      };
      setPosition(clamp(p));
    };
    fit();
    window.addEventListener("resize", fit);
    const observer = new ResizeObserver(fit);
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener("resize", fit);
      observer.disconnect();
    };
    // The observer reads the live node and current coordinates; pointer updates do not recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    gesture.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: rect.left,
      top: rect.top,
    };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const start = gesture.current;
    if (!start || start.pointer !== e.pointerId) return;
    const dx = e.clientX - start.x,
      dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 5) dragged.current = true;
    if (dragged.current) {
      e.preventDefault();
      moveTo({ x: start.left + dx, y: start.top + dy });
    }
  }
  function finish(e: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointer !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      e.key
    ];
    if (!delta) return;
    e.preventDefault();
    const rect = ref.current?.getBoundingClientRect();
    const p = current.current || { x: rect?.left || 12, y: rect?.top || 12 };
    const step = e.shiftKey ? 48 : 16;
    moveTo({ x: p.x + delta[0] * step, y: p.y + delta[1] * step });
  }
  return {
    position,
    moveTo,
    dragged,
    style: (position
      ? { left: position.x, top: position.y, right: "auto", bottom: "auto", transform: "none" }
      : { right: 24, bottom: 24, left: "auto", top: "auto", transform: "none" }) as CSSProperties,
    dragHandlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
    onKeyDown,
  };
}
