/** One safe entry point for drawing a style frame, shared by the wall, export and the check. */
import type { Ctx2D, MotionStyle, Theme } from "./types";
import { LOOP } from "./types";

/** Resolve a style's theme against an optional brand override. */
export function themeFor(style: MotionStyle, brand: Theme | null | undefined): Theme {
  return brand ? { ...brand } : style.theme;
}

/** Wrap t into [0, loop] (loop itself is allowed so checks can compare 0 and the end). */
export function loopTime(t: number, loop = LOOP): number {
  if (t === loop) return loop;
  const r = t % loop;
  return r < 0 ? r + loop : r;
}

/**
 * Draw one frame with a clean context state. Returns the error if the style
 * threw, after painting a quiet placeholder so a wall never shows a hole.
 */
export function drawFrame(
  ctx: Ctx2D,
  style: MotionStyle,
  t: number,
  theme: Theme,
  w: number,
  h: number,
): Error | null {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.imageSmoothingEnabled = true;
  try {
    style.render(ctx, loopTime(t, style.duration ?? LOOP), theme, w, h);
    ctx.restore();
    return null;
  } catch (error) {
    ctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg || "#111";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return error instanceof Error ? error : new Error(String(error));
  }
}
