/** Colour maths for themes: parsing, OKLab mixing, contrast and cached rgba() strings. */

export type RGB = [number, number, number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_FN = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i;

/** Parse #rgb, #rrggbb or rgb(r g b). Anything else is black. */
export function parse(color: string): RGB {
  const text = (color || "").trim();
  const hex = text.match(HEX);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fn = text.match(RGB_FN);
  if (fn) return [clamp255(+fn[1]), clamp255(+fn[2]), clamp255(+fn[3])];
  return [0, 0, 0];
}

export function isColor(color: unknown): color is string {
  return typeof color === "string" && (HEX.test(color.trim()) || RGB_FN.test(color.trim()));
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function hex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

const cache = new Map<string, string>();
/** rgba() string for a colour at alpha a. Cached: styles call this every frame. */
export function rgba(color: string, a = 1): string {
  const alpha = Math.max(0, Math.min(1, a));
  const key = color + "|" + alpha.toFixed(3);
  let out = cache.get(key);
  if (!out) {
    const [r, g, b] = parse(color);
    out = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    if (cache.size > 4000) cache.clear();
    cache.set(key, out);
  }
  return out;
}

// ── sRGB ↔ linear ↔ OKLab ────────────────────────────────────────────────
const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
  return c * 255;
};

export type Lab = [number, number, number];

export function toOklab(color: string): Lab {
  const [r, g, b] = parse(color).map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab([L, a, bb]: Lab): string {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * bb, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * bb, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * bb, 3);
  return hex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** OKLCH: [lightness 0..1, chroma, hue degrees]. */
export function toOklch(color: string): Lab {
  const [L, a, b] = toOklab(color);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

export function fromOklch([L, C, h]: Lab): string {
  const r = (h * Math.PI) / 180;
  return fromOklab([L, C * Math.cos(r), C * Math.sin(r)]);
}

const mixCache = new Map<string, string>();
/** Perceptual mix of two colours; t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const key = a + b + k.toFixed(3);
  let out = mixCache.get(key);
  if (!out) {
    const A = toOklab(a);
    const B = toOklab(b);
    out = fromOklab([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
    if (mixCache.size > 4000) mixCache.clear();
    mixCache.set(key, out);
  }
  return out;
}

/** Shift OKLCH lightness by dl, scale chroma by cs, rotate hue by dh degrees. */
export function adjust(color: string, dl = 0, cs = 1, dh = 0): string {
  const [L, C, h] = toOklch(color);
  return fromOklch([Math.max(0, Math.min(1, L + dl)), Math.max(0, C * cs), (h + dh + 360) % 360]);
}

/** WCAG relative luminance, 0..1. */
export function luminance(color: string): number {
  const [r, g, b] = parse(color).map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Chroma in OKLCH, a proxy for how "brand-coloured" a colour is. */
export function chroma(color: string): number {
  return toOklch(color)[1];
}

/** Hue distance in degrees, 0..180. */
export function hueDistance(a: string, b: string): number {
  const d = Math.abs(toOklch(a)[2] - toOklch(b)[2]) % 360;
  return d > 180 ? 360 - d : d;
}

/** Lighten (or darken on light grounds) until the colour reaches `ratio` against bg. */
export function ensureContrast(color: string, bg: string, ratio: number): string {
  let out = color;
  const dark = luminance(bg) < 0.4;
  for (let i = 0; i < 24 && contrast(out, bg) < ratio; i++) out = adjust(out, dark ? 0.03 : -0.03);
  return out;
}
