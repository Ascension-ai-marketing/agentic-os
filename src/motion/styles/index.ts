/**
 * The style registry. Add a style: create src/motion/styles/<id>.ts exporting
 * `style` (see ../STYLE-GUIDE.md), import it here, and run `bun run check:motion`.
 * Order here is the order on the wall.
 */
import type { MotionStyle } from "../engine/types";
import { style as blueprintDraw } from "./blueprint-draw";
import { style as charcoalCaliper } from "./charcoal-caliper";
import { style as crayonMarker } from "./crayon-marker";
import { style as fieldNotesChart } from "./field-notes-chart";
import { style as fieldNotesMark } from "./field-notes-mark";
import { style as fieldNotesSketch } from "./field-notes-sketch";
import { style as flowField } from "./flow-field";
import { style as halftonePrint } from "./halftone-print";
import { style as liquidChrome } from "./liquid-chrome";
import { style as paperCut } from "./paper-cut";
import { style as pixelRain } from "./pixel-rain";
import { style as risograph } from "./risograph";
import { style as sumiInkBloom } from "./sumi-ink-bloom";
import { style as swissKinetic } from "./swiss-kinetic";
import { style as topographic } from "./topographic";
import { style as letterpress } from "./letterpress";
import { style as linocut } from "./linocut";
import { style as woodcut } from "./woodcut";
import { style as screenprint } from "./screenprint";
import { style as cyanotype } from "./cyanotype";
import { style as collageCutout } from "./collage-cutout";
import { style as origamiFold } from "./origami-fold";
import { style as rubberStamp } from "./rubber-stamp";
import { style as washiScrapbook } from "./washi-scrapbook";
import { style as tornPoster } from "./torn-poster";
import { style as embroidery } from "./embroidery";
import { style as ballpointDoodle } from "./ballpoint-doodle";
import { style as comicInk } from "./comic-ink";
import { style as frescoPlaster } from "./fresco-plaster";
import { style as gouacheFlat } from "./gouache-flat";
import { style as inkWashLandscape } from "./ink-wash-landscape";
import { style as oilImpasto } from "./oil-impasto";
import { style as pastelChalk } from "./pastel-chalk";
import { style as pencilHatch } from "./pencil-hatch";
import { style as sketchnote } from "./sketchnote";
import { style as sprayStencil } from "./spray-stencil";
import { style as watercolorBloom } from "./watercolor-bloom";
import { style as bauhaus } from "./bauhaus";
import { style as memphis } from "./memphis";
import { style as constructivist } from "./constructivist";
import { style as artDeco } from "./art-deco";
import { style as artNouveau } from "./art-nouveau";
import { style as deStijl } from "./de-stijl";
import { style as psychedelic } from "./psychedelic";
import { style as brutalistType } from "./brutalist-type";
import { style as y2kBubble } from "./y2k-bubble";
import { style as opArt } from "./op-art";
import { style as midCenturyAtomic } from "./mid-century-atomic";
import { style as terminal } from "./terminal";
import { style as oscilloscope } from "./oscilloscope";
import { style as wireframe3d } from "./wireframe-3d";
import { style as ledBoard } from "./led-board";
import { style as dotMatrix } from "./dot-matrix";
import { style as crtScanline } from "./crt-scanline";
import { style as vhsGlitch } from "./vhs-glitch";
import { style as asciiArt } from "./ascii-art";
import { style as synthwave } from "./synthwave";
import { style as vaporwave } from "./vaporwave";
import { style as sprite8bit } from "./sprite-8bit";
import { style as neonSign } from "./neon-sign";
import { style as frostedGlass } from "./frosted-glass";
import { style as holoFoil } from "./holo-foil";
import { style as aurora } from "./aurora";
import { style as bokehNight } from "./bokeh-night";
import { style as caustics } from "./caustics";
import { style as candlelight } from "./candlelight";
import { style as laserGrid } from "./laser-grid";
import { style as prism } from "./prism";
import { style as smoke } from "./smoke";
import { style as moltenGold } from "./molten-gold";
import { style as barRace } from "./bar-race";
import { style as lineDraw } from "./line-draw";
import { style as donutBloom } from "./donut-bloom";
import { style as isometricCity } from "./isometric-city";
import { style as networkGraph } from "./network-graph";
import { style as mapRoute } from "./map-route";
import { style as milestones } from "./milestones";
import { style as gaugeDial } from "./gauge-dial";
import { style as sankeyFlow } from "./sankey-flow";
import { style as heatmap } from "./heatmap";
import { style as explodedView } from "./exploded-view";
import { style as oceanWaves } from "./ocean-waves";
import { style as sandDunes } from "./sand-dunes";
import { style as fallingLeaves } from "./falling-leaves";
import { style as growingVines } from "./growing-vines";
import { style as mycelium } from "./mycelium";
import { style as starfieldWarp } from "./starfield-warp";
import { style as snowfall } from "./snowfall";
import { style as rainOnGlass } from "./rain-on-glass";
import { style as fireflies } from "./fireflies";
import { style as cloudTimelapse } from "./cloud-timelapse";
import { style as coralReef } from "./coral-reef";
import { style as splitFlap } from "./split-flap";
import { style as typewriter } from "./typewriter";
import { style as stackedHeadlines } from "./stacked-headlines";
import { style as marqueeBands } from "./marquee-bands";
import { style as variableMorph } from "./variable-morph";
import { style as cropReveal } from "./crop-reveal";
import { style as titleCard } from "./title-card";
import { style as transitSign } from "./transit-sign";
import { style as stickerPop } from "./sticker-pop";
import { style as magazineLayout } from "./magazine-layout";
import { style as signature } from "./signature";

export const STYLES: MotionStyle[] = [
  // Featured family: Field Notes (the deck's story-loop look).
  fieldNotesSketch,
  fieldNotesChart,
  fieldNotesMark,
  sumiInkBloom,
  charcoalCaliper,
  pixelRain,
  blueprintDraw,
  paperCut,
  crayonMarker,
  risograph,
  swissKinetic,
  halftonePrint,
  liquidChrome,
  flowField,
  topographic,
  letterpress,
  linocut,
  woodcut,
  screenprint,
  cyanotype,
  collageCutout,
  origamiFold,
  rubberStamp,
  washiScrapbook,
  tornPoster,
  embroidery,
  watercolorBloom,
  gouacheFlat,
  oilImpasto,
  pastelChalk,
  pencilHatch,
  ballpointDoodle,
  comicInk,
  inkWashLandscape,
  frescoPlaster,
  sprayStencil,
  sketchnote,
  bauhaus,
  memphis,
  constructivist,
  artDeco,
  artNouveau,
  deStijl,
  psychedelic,
  brutalistType,
  y2kBubble,
  opArt,
  midCenturyAtomic,
  terminal,
  oscilloscope,
  wireframe3d,
  ledBoard,
  dotMatrix,
  crtScanline,
  vhsGlitch,
  asciiArt,
  synthwave,
  vaporwave,
  sprite8bit,
  neonSign,
  frostedGlass,
  holoFoil,
  aurora,
  bokehNight,
  caustics,
  candlelight,
  laserGrid,
  prism,
  smoke,
  moltenGold,
  barRace,
  lineDraw,
  donutBloom,
  isometricCity,
  networkGraph,
  mapRoute,
  milestones,
  gaugeDial,
  sankeyFlow,
  heatmap,
  explodedView,
  oceanWaves,
  sandDunes,
  fallingLeaves,
  growingVines,
  mycelium,
  starfieldWarp,
  snowfall,
  rainOnGlass,
  fireflies,
  cloudTimelapse,
  coralReef,
  splitFlap,
  typewriter,
  stackedHeadlines,
  marqueeBands,
  variableMorph,
  cropReveal,
  titleCard,
  transitSign,
  stickerPop,
  magazineLayout,
  signature,
];

/** Styles marked "Featured" on the wall. */
export const FEATURED = new Set<string>([
  "field-notes-sketch",
  "field-notes-chart",
  "field-notes-mark",
]);

export function styleById(id: string): MotionStyle | undefined {
  return STYLES.find((s) => s.id === id);
}
