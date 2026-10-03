import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reelStylePresets, type ReelStyle } from "../src/lib/reel-styles";

export function validateReelStyle(raw: unknown): ReelStyle {
  const s = raw as ReelStyle;
  if (!s || typeof s.name !== "string" || !s.name.trim() || s.name.length > 48 || typeof s.brief !== "string" || !s.brief.trim() || s.brief.length > 1200 || !Array.isArray(s.colors) || s.colors.length !== 3 || s.colors.some(c => typeof c !== "string" || !/^#[a-f\d]{6}$/i.test(c))) throw new Error("Choose a style name, a short description and three hex colors");
  return { id: typeof s.id === "string" && /^[a-z\d-]{1,64}$/i.test(s.id) ? s.id : randomUUID(), name: s.name.trim(), brief: s.brief.trim(), colors: s.colors, ...(typeof s.seed === "string" && /^[a-f\d-]{36}$/.test(s.seed) ? { seed: s.seed } : {}) };
}
export function randomReelStyle(): ReelStyle {
  const pick = <T>(values: T[]) => values[randomInt(values.length)];
  const palette = pick(reelStylePresets).colors;
  const form = pick(["cut paper shapes", "precise technical diagrams", "oversized geometric objects", "hand drawn linework", "flat editorial illustrations", "bold abstract silhouettes", "comic panels", "isometric objects"]);
  const type = pick(["large serif headlines", "condensed uppercase lettering", "spacious sans serif type", "rounded playful typography", "monospaced technical labels", "heavy poster typography"]);
  const composition = pick(["an asymmetric magazine layout", "a central object and generous margins", "a diagonal composition", "a modular grid", "layered overlapping objects", "oversized edge crops"]);
  const texture = pick(["clean flat fills", "subtle halftone dots", "fine line hatching", "layered paper shadows", "a sparse dot grid", "contrasting outlines"]);
  const seed = randomUUID();
  return { id: seed, seed, name: `${pick(["Orbit", "Studio", "Nova", "Frame", "Muse", "Echo"])} ${seed.slice(0, 4).toUpperCase()}`, colors: [...palette], brief: `Use ${form}, ${type}, ${composition} and ${texture}. Palette: ${palette.join(", ")}. Keep spoken words legible. Variation seed: ${seed}.` };
}
export function createReelStyleLibrary(root: string) {
  const dir = join(root, ".operator-data/reels"), file = join(dir, "styles.json");
  function list(): ReelStyle[] { try { const data = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(data) ? data.map(validateReelStyle).slice(0, 100) : []; } catch { return []; } }
  function save(raw: unknown) { const style = { ...validateReelStyle(raw), id: randomUUID() }; const saved = list(); const same = saved.find(s => s.name === style.name && s.brief === style.brief && JSON.stringify(s.colors) === JSON.stringify(style.colors)); if (same) return same;
    mkdirSync(dir, { recursive: true, mode: 0o700 }); const temp = `${file}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify([style, ...saved].slice(0, 100)), { mode: 0o600 }); renameSync(temp, file); return style;
  }
  return { list, save, randomize: () => ({ A: randomReelStyle(), B: randomReelStyle(), C: randomReelStyle() }) };
}
