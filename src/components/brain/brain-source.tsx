// Brain source identity: the logo, the short name and, for a source with
// nothing in it yet, one plain line on how to connect it.
import codex from "@/assets/logos/codex.png";
import openai from "@/assets/logos/openai.png";
import claude from "@/assets/claude-logo.png";
import gmail from "@/assets/logos/gmail.svg";
import calendar from "@/assets/logos/googlecalendar.svg";
import granola from "@/assets/logos/granola.png";
import obsidian from "@/assets/logos/obsidian.png";
import notion from "@/assets/logos/notion.png";
import hermes from "@/assets/hermes-face.png";
import openclaw from "@/assets/logos/openclaw.svg";
import { SourceBrand } from "@/components/operator/source-brand";
import "./brain-source.css";

/**
 * One tile per source, drawn like its app icon: the real brand mark on the
 * brand's own ground, the same rounded square everywhere it appears.
 * pad is the inset as a share of the tile; 0 means the image is the whole icon.
 */
export type BrandTileSpec = { src: string; bg: string; pad: number; invert?: boolean };
const TILES: Record<string, BrandTileSpec> = {
  claude: { src: claude, bg: "#d97757", pad: 0 },
  codex: { src: codex, bg: "#ffffff", pad: 0 },
  chatgpt: { src: openai, bg: "#000000", pad: 0.2, invert: true },
  openai: { src: openai, bg: "#000000", pad: 0.2, invert: true },
  notion: { src: notion, bg: "#ffffff", pad: 0.14 },
  email: { src: gmail, bg: "#ffffff", pad: 0.2 },
  gmail: { src: gmail, bg: "#ffffff", pad: 0.2 },
  meetings: { src: granola, bg: "#b2c248", pad: 0 },
  granola: { src: granola, bg: "#b2c248", pad: 0 },
  calendar: { src: calendar, bg: "#ffffff", pad: 0.16 },
  obsidian: { src: obsidian, bg: "#211d33", pad: 0.14 },
  hermes: { src: hermes, bg: "#ffffff", pad: 0 },
  openclaw: { src: openclaw, bg: "#1b1a22", pad: 0.16 },
};
export const brandTile = (origin: string): BrandTileSpec | undefined => TILES[origin];
export const brainLogoSrc = (origin: string): string | undefined => TILES[origin]?.src;

export function BrainSourceLogo({
  origin,
  size = 22,
}: {
  origin: string;
  color?: string;
  size?: number;
}) {
  const tile = TILES[origin];
  return (
    <span
      className="brain-logo"
      data-brand={origin}
      data-art={tile ? undefined : true}
      style={{
        width: size,
        height: size,
        background: tile?.bg,
        padding: tile ? Math.round(size * tile.pad) : undefined,
      }}
      aria-hidden
    >
      {tile ? (
        <img src={tile.src} alt="" data-invert={tile.invert || undefined} />
      ) : (
        <SourceBrand id={origin} size={Math.round(size * 0.8)} />
      )}
    </span>
  );
}

export type StreamState = { status: "ok" | "empty" | "missing"; total: number; checked: string[] };
