/**
 * Browser entry used by headless Chrome for the mp4 exporter and the style
 * check. It exposes window.__motion and sets window.__ready once loaded.
 * No framework: it imports the engine and the style registry directly.
 */
import { preloadLogo } from "../engine/assets";
import { loadBrandFont, loadFonts, fontsFor } from "../engine/fonts";
import { drawFrame } from "../engine/render";
import type { Ctx2D, MotionStyle, Theme } from "../engine/types";
import { LOOP } from "../engine/types";
import { STYLES, styleById } from "../styles";

const NUMERIC_METHODS = new Set([
  "moveTo",
  "lineTo",
  "arc",
  "arcTo",
  "bezierCurveTo",
  "quadraticCurveTo",
  "rect",
  "roundRect",
  "ellipse",
  "fillRect",
  "strokeRect",
  "clearRect",
  "translate",
  "scale",
  "rotate",
  "transform",
  "setTransform",
  "drawImage",
  "fillText",
  "strokeText",
  "putImageData",
  "getImageData",
  "createImageData",
  "createLinearGradient",
  "createRadialGradient",
  "createConicGradient",
]);
const NUMERIC_PROPS = new Set([
  "globalAlpha",
  "lineWidth",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
  "lineDashOffset",
  "miterLimit",
]);

/** Wrap a context so any non-finite number reaching the canvas is reported. */
function guard(ctx: Ctx2D, report: (message: string) => void): Ctx2D {
  return new Proxy(ctx, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && NUMERIC_METHODS.has(prop))
        return (...args: unknown[]) => {
          if (args.some((a) => typeof a === "number" && !Number.isFinite(a)))
            report(
              `${prop}(${args.map((a) => (typeof a === "number" ? a : typeof a)).join(", ")})`,
            );
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
    set(target, prop, value) {
      if (typeof prop === "string" && NUMERIC_PROPS.has(prop) && !Number.isFinite(value))
        report(`${prop} = ${String(value)}`);
      return Reflect.set(target, prop, value, target);
    },
  }) as Ctx2D;
}

const canvas = document.createElement("canvas");
canvas.style.cssText = "position:fixed;left:0;top:0;width:10px;height:10px;opacity:0.01";
document.body.appendChild(canvas);
let ctx = canvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
}) as CanvasRenderingContext2D;
let style: MotionStyle = STYLES[0];
let theme: Theme = STYLES[0].theme;

function pixels(): Uint8ClampedArray {
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function statsOf(data: Uint8ClampedArray) {
  let sum = 0;
  let sq = 0;
  let n = 0;
  const buckets = new Set<number>();
  const step = Math.max(1, Math.floor(data.length / 4 / 60000));
  for (let i = 0; i < data.length; i += 4 * step) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += l;
    sq += l * l;
    n++;
    buckets.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4));
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), colors: buckets.size };
}

const api = {
  loop: LOOP,
  ids: () => STYLES.map((s) => s.id),
  meta: () =>
    STYLES.map((s) => ({
      id: s.id,
      name: s.name,
      look: s.look,
      move: s.move,
      rules: s.rules.length,
      prompt: s.prompt,
      hasRender: typeof s.render === "function",
      theme: s.theme,
    })),
  async setup(options: { id: string; theme?: Theme | null; w: number; h: number }) {
    const next = styleById(options.id);
    if (!next) throw new Error(`Unknown style ${options.id}`);
    style = next;
    theme = options.theme ? { ...options.theme } : { ...next.theme };
    if (options.theme?.font) theme.font = await loadBrandFont(options.theme.font, next.theme.font);
    await loadFonts(fontsFor(style, theme));
    if (theme.logo && !(await preloadLogo(theme.logo))) theme.logo = null;
    canvas.width = Math.round(options.w);
    canvas.height = Math.round(options.h);
    ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    return { font: theme.font };
  },
  /** Draw t and return a base64 JPEG (no data: prefix). */
  frame(t: number, quality = 0.95): string {
    const error = drawFrame(ctx, style, t, theme, canvas.width, canvas.height);
    if (error) throw error;
    return canvas.toDataURL("image/jpeg", quality).slice("data:image/jpeg;base64,".length);
  },
  /** Draw t through the NaN guard and report pixel statistics. */
  stats(t: number) {
    const problems: string[] = [];
    const guarded = guard(ctx, (m) => {
      if (problems.length < 5) problems.push(m);
    });
    const error = drawFrame(guarded, style, t, theme, canvas.width, canvas.height);
    return { ...statsOf(pixels()), problems, error: error ? String(error.stack || error) : null };
  },
  /** Mean absolute difference (0..255) between frames a and b, and the share of pixels off by > 24. */
  diff(a: number, b: number) {
    drawFrame(ctx, style, a, theme, canvas.width, canvas.height);
    const A = pixels().slice();
    drawFrame(ctx, style, b, theme, canvas.width, canvas.height);
    const B = pixels();
    let sum = 0;
    let over = 0;
    for (let i = 0; i < A.length; i += 4) {
      const d =
        (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3;
      sum += d;
      if (d > 24) over++;
    }
    const n = A.length / 4;
    return { mean: sum / n, over: over / n };
  },
  /** Render time in ms for one frame at the current size. */
  cost(t: number) {
    const t0 = performance.now();
    drawFrame(ctx, style, t, theme, canvas.width, canvas.height);
    return performance.now() - t0;
  },
};

declare global {
  interface Window {
    __motion: typeof api;
    __ready: boolean;
  }
}

window.__motion = api;
window.__ready = true;
