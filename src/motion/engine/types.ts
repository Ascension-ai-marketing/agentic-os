/**
 * The Motion Library style contract. Framework-free: nothing in src/motion/engine
 * or src/motion/styles imports React, the router or any server module, so the
 * engine can ship as its own package later.
 */

/** Every colour a style draws comes from here, so a brand can re-skin every style. */
export interface Theme {
  /** Ground. Brand themes are normalised so this is always dark. */
  bg: string;
  /** Main foreground: type, lines, highlights. */
  ink: string;
  /** The one accent colour. */
  accent: string;
  /** A second, quieter accent. */
  accent2: string;
  /** Display family (a Google Fonts family name). */
  font: string;
  /** Brand logo URL. Shown by the studio UI; styles never draw remote images. */
  logo?: string | null;
  /** Brand name. Styles that set a word use it in place of their own word. */
  name?: string | null;
}

/** A 2D context, on-screen or offscreen. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Pure: the same (t, theme, w, h) always draws the same frame, in any order.
 * t runs 0..LOOP seconds and render(0) must equal render(LOOP).
 */
export type RenderFn = (ctx: Ctx2D, t: number, theme: Theme, w: number, h: number) => void;

export interface MotionStyle {
  /** kebab-case, equal to the file name in src/motion/styles. */
  id: string;
  name: string;
  /** "Looks like": one line. */
  look: string;
  /** "Moves like": one line. */
  move: string;
  /** 5 to 8 short craft rules. */
  rules: string[];
  /**
   * The full prompt in RISE format. May contain {{bg}} {{ink}} {{accent}}
   * {{accent2}} {{font}} {{name}} placeholders, filled from the active theme.
   */
  prompt: string;
  /** Optional link to the real-world source of the look. */
  ref?: string;
  render: RenderFn;
  /** The style's own palette, used until a brand theme is applied. */
  theme: Theme;
  /** Google Fonts specs the style needs, e.g. "Inter:wght@400..900". */
  fonts?: string[];
  /** Words the prompt improver matches a rough idea against. */
  tags?: string[];
  /** Word the style sets when no brand name is present. */
  word?: string;
  /** Optional family for the wall's filter, e.g. "Print" or "Field Notes". */
  family?: string;
  /** Tile line under the name: one short line, about 36 characters at most. */
  tagline?: string;
  /** Loop length in seconds when it is not LOOP (showcase pieces only; styles use LOOP). */
  duration?: number;
}

/** The loop length every style obeys. */
export const LOOP = 5;
