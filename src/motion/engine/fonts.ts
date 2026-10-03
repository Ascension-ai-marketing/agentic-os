/**
 * Google Fonts loading for canvas text. Canvas never waits for a web font, so a
 * style's families are requested up front and awaited before frame 0.
 */
import type { MotionStyle, Theme } from "./types";

/** Families every style may fall back on. */
export const CORE_FONTS = ["Inter:wght@100..900", "Newsreader:opsz,wght@6..72,400..600"];

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,48}$/;

export function familyOf(spec: string): string {
  return spec.split(":")[0].replace(/\+/g, " ").trim();
}

export function googleFontsHref(specs: string[]): string {
  const unique = [...new Set(specs.filter(Boolean))];
  const families = unique.map((s) => "family=" + s.trim().replace(/ /g, "+")).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

export function stylesFonts(styles: MotionStyle[]): string[] {
  return [...new Set([...CORE_FONTS, ...styles.flatMap((s) => s.fonts ?? [])])];
}

/** A safe Google Fonts spec for an arbitrary brand family name, or null. */
export function brandFontSpec(family: string | null | undefined): string | null {
  const name = (family || "").trim();
  if (!FAMILY.test(name)) return null;
  return `${name}:wght@400;500;600;700;800`;
}

type Doc = { head: HTMLElement; createElement: Document["createElement"] } | undefined;
const doc = (): Doc => (typeof document !== "undefined" ? document : undefined);

const injected = new Set<string>();
function inject(href: string): Promise<boolean> {
  const d = doc();
  if (!d) return Promise.resolve(false);
  if (injected.has(href)) return Promise.resolve(true);
  injected.add(href);
  return new Promise((resolve) => {
    const link = d.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    d.head.appendChild(link);
    setTimeout(() => resolve(true), 6000);
  });
}

/** Load stylesheets and wait (bounded) until the faces can draw. */
export async function loadFonts(specs: string[], timeoutMs = 8000): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const unique = [...new Set(specs)];
  // One stylesheet per family keeps one bad family from failing the rest.
  await Promise.all(unique.map((s) => inject(googleFontsHref([s]))));
  const loads = unique.flatMap((s) => {
    const family = familyOf(s);
    return ["300", "400", "500", "600", "700", "800"].map((w) =>
      document.fonts.load(`${w} 48px "${family}"`).catch(() => []),
    );
  });
  await Promise.race([
    Promise.all(loads),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
}

/**
 * Load a brand's display family. Resolves to the family if it can draw,
 * else to the fallback, so a theme never names a font the canvas lacks.
 */
export async function loadBrandFont(family: string, fallback = "Inter"): Promise<string> {
  const spec = brandFontSpec(family);
  if (!spec || typeof document === "undefined" || !("fonts" in document)) return fallback;
  const ok =
    (await inject(googleFontsHref([spec]))) || (await inject(googleFontsHref([familyOf(spec)])));
  if (!ok) return fallback;
  try {
    const faces = await Promise.race([
      document.fonts.load(`700 48px "${familyOf(spec)}"`),
      new Promise<FontFace[]>((r) => setTimeout(() => r([]), 5000)),
    ]);
    return faces.length ? familyOf(spec) : fallback;
  } catch {
    return fallback;
  }
}

/** Every family a theme + style pair needs. */
export function fontsFor(style: MotionStyle, theme: Theme): string[] {
  const brand = brandFontSpec(theme.font);
  return [...CORE_FONTS, ...(style.fonts ?? []), ...(brand ? [brand] : [])];
}
