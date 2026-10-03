export type ReelStyle = { id: string; name: string; brief: string; colors: [string, string, string]; seed?: string };
export const reelStylePresets: ReelStyle[] = [
  { id: "night-glow", name: "Night Glow", brief: "Ink black and electric mint. Luminous geometric forms, spacious sans serif type, sharp contrast.", colors: ["#132923", "#b3fbd5", "#438970"] },
  { id: "paper-craft", name: "Paper Craft", brief: "Warm ivory paper, cut shapes and layered shadows. Tactile editorial illustration with expressive serif type.", colors: ["#e9e0ca", "#423e32", "#ba7750"] },
  { id: "poster-pop", name: "Poster Pop", brief: "Vivid orange, heavy black shapes and oversized condensed type. Bold graphic posters with playful composition.", colors: ["#ef6d3c", "#fff0c7", "#292319"] },
  { id: "blueprint", name: "Blueprint", brief: "Cobalt canvas, fine white diagrams, grids and technical drawings. Clear typographic hierarchy and precise spacing.", colors: ["#193fac", "#f0f5ff", "#84c4ff"] },
  { id: "editorial", name: "Editorial", brief: "Cream and burgundy, oversized serif headlines, small illustrated objects and generous margins. Magazine art direction.", colors: ["#f5eedd", "#761f31", "#bb845c"] },
  { id: "mono", name: "Monochrome", brief: "Black and white with graphite accents. Confident typography, clean silhouettes and restrained composition.", colors: ["#f3f3ee", "#17191c", "#858988"] },
  { id: "candy", name: "Candy Shop", brief: "Lilac, cherry and butter yellow. Rounded forms, chunky playful typography and soft overlapping shapes.", colors: ["#dbc6ff", "#a72b4f", "#fff098"] },
  { id: "signal", name: "Signal", brief: "Acid yellow and charcoal. Industrial labels, bold arrows, tight grids and oversized numerical forms.", colors: ["#eafa57", "#232721", "#7a8570"] },
];
export const defaultReelStyles = () => ({ A: { ...reelStylePresets[0] }, B: { ...reelStylePresets[1] }, C: { ...reelStylePresets[2] } });

// The prompt controls the artwork; these neutral colors only fill unloaded previews.
export function reelStylesFromPrompt(prompt: string): Record<"A" | "B" | "C", ReelStyle> {
  const direction = prompt.trim() || "Choose a clear, visually interesting treatment that fits the spoken content.";
  return Object.fromEntries((["A", "B", "C"] as const).map((id, i) => [id, {
    id: `prompt-${id.toLowerCase()}`, name: `Version ${i + 1}`, brief: direction,
    colors: ["#20212a", "#f6f5f3", "#b6b5c1"],
  }])) as Record<"A" | "B" | "C", ReelStyle>;
}
