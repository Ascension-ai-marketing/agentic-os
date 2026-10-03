import type { ReelStyle } from "./reel-styles";
import type { JevDecision } from "./jev-types";
export const reelFamilies = [{ id: "A", name: "Night Glow", description: "Ink black, electric mint and luminous forms." }, { id: "B", name: "Paper Craft", description: "Warm paper, cut shapes and tangible layers." }, { id: "C", name: "Poster Pop", description: "Oversized type, vivid orange and bold graphic contrast." }] as const;
export type ReelFamily = typeof reelFamilies[number]["id"];
export const reelEffects = ["whoosh", "pop", "impact", "riser", "cash-register", "clock-tick", "notification-ding", "typing", "crowd-gasp", "none"] as const;
export type ReelSection = { id: string; name: string; t0: number; t1: number; words: string; image: string; graphics?: Record<ReelFamily, string>; sfxDecision?: JevDecision; clips?: Partial<Record<ReelFamily, string>>; variants?: ReelVariant[] };
/** One playable take of a section: A, B, C or a later take such as A2, in full screen and/or top half (graphic above, speaker below). */
export type ReelVariant = { key: string; family: ReelFamily; full?: string; top?: string };
export type ReelProject = {
  id: string; name: string; duration: number; layout: "full" | "top";
  state: "uploaded" | "processing-audio" | "transcribing" | "planning" | "ready" | "graphics" | "sound" | "rendering" | "exporting" | "done" | "error";
  sections: ReelSection[]; decision?: JevDecision; outputs: Partial<Record<ReelFamily, string>>;
  simulated?: boolean; notice?: string; error?: string; transcriptionSource?: string;
  opusCostUsd?: number; jevCostUsd?: number; progress?: string; includeSfx?: boolean;
  createdAt?: string; updatedAt?: string; audioProcessing?: "none" | "local";
  styles?: Record<ReelFamily, ReelStyle>; stylePrompt?: string; styleMode?: "selected" | "random"; autoCut?: boolean; processedSource?: string; originalDuration?: number; source?: "reference";
  selectedSectionIds?: string[]; picks?: Record<string, ReelFamily>; selectedOutput?: string;
};
export const reelIsBusy = (p: ReelProject | null) => !!p && !["uploaded", "ready", "done", "error"].includes(p.state);
export type ReelSummary = Pick<ReelProject, "id" | "name" | "duration" | "state" | "createdAt" | "updatedAt" | "outputs" | "layout" | "source"> & { sectionCount: number };
export type ReelQuote = { estimated: true; opusUsd: number; prepareUsd: number; buildUsd: number; jevUsd: number; estimatedTotalUsd: number; opusBudgetUsd: number; model: string };
