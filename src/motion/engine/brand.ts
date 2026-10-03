/**
 * Turn brand colours (from a website or a logo) into a Theme every style can
 * use: always a dark ground, a light ink with strong contrast, one clear accent
 * and a distinct second accent. Framework-free; used on server and client.
 */
import {
  adjust,
  chroma,
  contrast,
  ensureContrast,
  fromOklch,
  hueDistance,
  isColor,
  luminance,
  parse,
  toOklab,
  toOklch,
  hex,
} from "./color";
import type { Theme } from "./types";

export interface BrandInput {
  /** Colours in order of importance (primary first). */
  colors: string[];
  background?: string | null;
  text?: string | null;
  font?: string | null;
  name?: string | null;
  logo?: string | null;
}

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,48}$/;

export function cleanName(raw: string | null | undefined): string | null {
  const first = (raw || "")
    .split(/\s*[|·•–—:]\s*|\s+-\s+/)[0]
    .replace(/[^\p{L}\p{N} .&'-]/gu, "")
    .trim();
  if (!first || first.length > 22) return null;
  return first;
}

export function cleanFont(raw: string | null | undefined): string | null {
  const name = (raw || "").split(",")[0].replace(/["']/g, "").trim();
  if (!FAMILY.test(name)) return null;
  if (
    /^(system-ui|sans-serif|serif|monospace|inherit|initial|ui-sans-serif|-apple-system|BlinkMacSystemFont|Segoe UI|Helvetica|Arial)$/i.test(
      name,
    )
  )
    return null;
  return name;
}

/** Build a dark-ground theme from brand colours. */
export function brandTheme(input: BrandInput, fallback: Theme): Theme {
  const colors = [
    ...new Set(
      [input.background, input.text, ...input.colors].filter(isColor).map((c) => hex(parse(c))),
    ),
  ];
  const L = (c: string) => toOklab(c)[0];

  // Ground: the brand's darkest colour if it is dark enough, else a deep tint of its hue.
  const darkest = [...colors].sort((a, b) => L(a) - L(b))[0];
  const hueSource = [...colors].sort((a, b) => chroma(b) - chroma(a))[0];
  let bg: string;
  if (darkest && L(darkest) <= 0.3) {
    const [l, c, h] = toOklch(darkest);
    bg = fromOklch([Math.min(l, 0.26), Math.min(c, 0.05), h]);
  } else if (hueSource) {
    bg = fromOklch([0.17, 0.028, toOklch(hueSource)[2]]);
  } else bg = fallback.bg;

  // Ink: the brand's lightest colour if it is light enough, else a warm white.
  const lightest = [...colors].sort((a, b) => L(b) - L(a))[0];
  let ink =
    lightest && L(lightest) >= 0.86 && chroma(lightest) < 0.06
      ? lightest
      : fromOklch([0.95, 0.01, hueSource ? toOklch(hueSource)[2] : 80]);
  ink = ensureContrast(ink, bg, 10);

  // Accents: the most brand-coloured colours, in importance order.
  const vivid = colors.filter((c) => chroma(c) >= 0.05);
  const ranked = vivid.length ? vivid : colors.filter((c) => c !== bg && c !== ink);
  let accent = ranked[0] ? ensureContrast(ranked[0], bg, 3.2) : fallback.accent;
  if (!ranked[0]) accent = fallback.accent;
  let accent2 = ranked.find(
    (c) => hueDistance(c, accent) >= 28 && Math.abs(L(c) - L(accent)) < 0.6,
  );
  if (!accent2) {
    const [l, c, h] = toOklch(accent);
    accent2 = fromOklch([
      Math.min(0.8, Math.max(0.55, l)),
      Math.max(0.06, c * 0.7),
      (h + 150) % 360,
    ]);
  }
  accent2 = ensureContrast(accent2, bg, 2.6);
  if (contrast(accent, bg) < 3) accent = adjust(accent, 0.1);

  return {
    bg,
    ink,
    accent,
    accent2,
    font: cleanFont(input.font) || fallback.font,
    name: cleanName(input.name),
    logo: input.logo ?? null,
  };
}

/**
 * Main colours of an image, from raw RGBA pixels (any size). A small k-means in
 * OKLab over opaque pixels; returns colours ordered by how much they "brand"
 * the image (area x chroma), plus the darkest and lightest clusters.
 */
export function paletteFromPixels(data: Uint8ClampedArray, k = 6): string[] {
  const pts: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(data.length / 4 / 12000));
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 200) continue;
    pts.push(toOklab(hex([data[i], data[i + 1], data[i + 2]])));
  }
  if (!pts.length) return [];
  // Deterministic seeds: spread over the sorted lightness range.
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  let centers = Array.from(
    { length: Math.min(k, pts.length) },
    (_, i) =>
      sorted[Math.floor(((i + 0.5) / Math.min(k, pts.length)) * sorted.length)].slice() as [
        number,
        number,
        number,
      ],
  );
  let counts = new Array(centers.length).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = new Array(centers.length).fill(0);
    for (const p of pts) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d =
          (p[0] - centers[c][0]) ** 2 + (p[1] - centers[c][1]) ** 2 + (p[2] - centers[c][2]) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      counts[best]++;
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
    }
    centers = centers.map((c, i) =>
      counts[i]
        ? ([sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]] as [
            number,
            number,
            number,
          ])
        : c,
    );
  }
  const total = pts.length;
  const clusters = centers
    .map((c, i) => ({ lab: c, share: counts[i] / total }))
    .filter((c) => c.share > 0.015)
    .map((c) => {
      const color = labHex(c.lab);
      return { color, share: c.share, score: c.share * (0.02 + chroma(color)) };
    });
  const byScore = [...clusters].sort((a, b) => b.score - a.score).map((c) => c.color);
  return [...new Set(byScore)];
}

function labHex(lab: [number, number, number]): string {
  const [L, a, b] = lab;
  return fromOklch([L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]);
}

/** Whether a palette carries real colour (a black or white logo does not). */
export function hasBrandColour(colors: string[]): boolean {
  return colors.some((c) => chroma(c) >= 0.05 && luminance(c) > 0.01);
}
