// "Let Jev pick" on the Reels scroll page. Jev scores every take of a
// section on three plain criteria and picks the take with the best overall
// score. Until a live Jev call is wired here these are Sample decisions:
// simple rules about the spoken line and each style, no network.
import type { JevDecideRequest } from "./jev-types";
import type { ReelFamily } from "./jev-reels";

export type ReelTake = { key: string; family: ReelFamily };
export type ReelCriterionId = "energy" | "glance" | "variety";
export const REEL_PICK_CRITERIA: Array<{ id: ReelCriterionId; label: string; short: string; hint: string; weight: number }> = [
  { id: "energy", label: "Matches the line's energy", short: "Energy", hint: "A loud line gets a loud look, a calm line a calm one.", weight: 0.45 },
  { id: "glance", label: "Reads in one second", short: "One-second read", hint: "The point of the picture lands at a glance on a phone.", weight: 0.35 },
  { id: "variety", label: "Different from the section before", short: "Fresh look", hint: "The reel keeps changing so the eye stays awake.", weight: 0.2 },
];

export type ReelJevPick = {
  sectionId: string;
  pick: string;
  family: ReelFamily;
  reason: string;
  /** Winner's score on each criterion, 0..1. */
  scores: Record<ReelCriterionId, number>;
  odds: Array<{ key: string; family: ReelFamily; p: number }>;
  ms: number;
  costUsd: number;
  sample: true;
};

// Measured Jev cost for one short Reels decision on 28 Sep 2026.
export const REEL_JEV_COST = 0.0000187;

const STYLE: Record<ReelFamily, string> = { A: "Night Glow", B: "Paper Craft", C: "Poster Pop" };
// How loud each look is: Night Glow is quiet, Paper Craft is warm, Poster Pop is loud.
const LOUDNESS: Record<ReelFamily, number> = { A: 0.15, B: 0.5, C: 0.95 };

type Beat = { kind: string; energy: number; clear: Record<ReelFamily, number>; says: string };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** What kind of moment the spoken line is, and what that asks of the picture. */
export function reelBeat(section: { name: string; words: string }, index: number, total: number): Beat {
  const text = `${section.name} ${section.words}`.toLowerCase();
  if (index === 0) return { kind: "hook", energy: 0.95, clear: { A: 0.62, B: 0.74, C: 0.9 }, says: "is the hook, so it needs the loudest look" };
  if (index === total - 1 || /\b(comment|follow|link|subscribe|dm)\b/.test(text))
    return { kind: "cta", energy: 0.9, clear: { A: 0.6, B: 0.75, C: 0.9 }, says: "asks for an action, so it has to pop" };
  if (/\b(by|until|before|deadline|october|november|december|january|today|tonight)\b/.test(text) && /\b(claim|only|ends?|expires?|by)\b/.test(text))
    return { kind: "deadline", energy: 0.85, clear: { A: 0.66, B: 0.82, C: 0.86 }, says: "is a deadline, so it needs urgency" };
  if (/\b(sleep|close|closing|laptop|wake|night|quiet)\b/.test(text))
    return { kind: "calm", energy: 0.15, clear: { A: 0.84, B: 0.74, C: 0.6 }, says: "is a calm payoff, so the quiet look fits" };
  if (/\b(cloud|server|computer|computers|runs?|works|agent|code)\b/.test(text))
    return { kind: "tech", energy: 0.3, clear: { A: 0.82, B: 0.76, C: 0.7 }, says: "is about machines doing the work, which reads premium in the dark" };
  if (/(\$\d|\bpro\b|\bmax\b|\bprice|\bplan|\bpay)/.test(text))
    return { kind: "price", energy: 0.5, clear: { A: 0.64, B: 0.88, C: 0.8 }, says: "is about prices, and numbers read clearest on paper" };
  if (/\b(miss|lose|losing|people|most)\b/.test(text))
    return { kind: "people", energy: 0.5, clear: { A: 0.62, B: 0.84, C: 0.76 }, says: "is about people missing out, which feels human on paper" };
  return { kind: "explain", energy: 0.5, clear: { A: 0.68, B: 0.8, C: 0.74 }, says: "is a plain explainer beat" };
}

/** Kept for callers that only need the style and a short why. */
export function reelStyleFor(section: { name: string; words: string }, index: number, total: number): { family: ReelFamily; why: string } {
  const beat = reelBeat(section, index, total);
  const family = (Object.keys(LOUDNESS) as ReelFamily[]).sort((a, b) => Math.abs(LOUDNESS[a] - beat.energy) - Math.abs(LOUDNESS[b] - beat.energy))[0];
  return { family, why: beat.says };
}

/** The part of the spoken line that carries the point: a number, a date or the key clause. */
function quoteOf(words: string, beat: Beat): string {
  const clauses = words.replace(/[“”"]/g, "").split(/[,;.!?]+/).map((c) => c.trim()).filter(Boolean);
  const signal = (c: string) =>
    (/\$\d|\d/.test(c) ? 3 : 0) +
    (beat.kind === "tech" && /\b(computers?|cloud|works)\b/i.test(c) ? 2 : 0) +
    (beat.kind === "calm" && /\b(laptop|wake|close)\b/i.test(c) ? 2 : 0) +
    (beat.kind === "cta" && /\b(comment|follow|link)\b/i.test(c) ? 2 : 0);
  const best = clauses.slice().sort((a, b) => signal(b) - signal(a))[0] ?? words;
  const parts = best.split(/\s+/);
  return parts.length > 9 ? `${parts.slice(0, 9).join(" ")}...` : best;
}

/** Score every take on the three criteria and pick the best overall. */
export function simulateReelJevPick(
  section: { id: string; name: string; words: string },
  index: number,
  total: number,
  takes: ReelTake[],
  previousFamily?: ReelFamily,
): ReelJevPick | null {
  if (!takes.length) return null;
  const beat = reelBeat(section, index, total);
  const scored = takes.map((t) => {
    const j = hash(`${section.id}|${t.key}`) - 0.5;
    const fresh = t.key.length > 1 ? 0.03 : 0; // a later take fixes notes on the first
    const scores: Record<ReelCriterionId, number> = {
      energy: clamp(1 - Math.abs(LOUDNESS[t.family] - beat.energy) * 0.9 + j * 0.06 + fresh),
      glance: clamp(beat.clear[t.family] + j * 0.05 + fresh),
      variety: previousFamily === undefined ? 0.8 : previousFamily === t.family ? 0.25 : 0.92,
    };
    const overall = REEL_PICK_CRITERIA.reduce((n, c) => n + c.weight * scores[c.id], 0);
    return { ...t, scores, overall };
  });
  const exp = scored.map((s) => Math.exp(s.overall * 14));
  const sum = exp.reduce((n, x) => n + x, 0);
  const odds = scored.map((s, i) => ({ key: s.key, family: s.family, p: exp[i] / sum })).sort((a, b) => b.p - a.p);
  const win = scored.find((s) => s.key === odds[0].key)!;
  const variety = previousFamily === undefined ? "" : previousFamily !== win.family ? ", and it changes the look from the section before" : ". It repeats the last look, but energy and a one-second read outweigh that";
  return {
    sectionId: section.id,
    pick: win.key,
    family: win.family,
    reason: `“${quoteOf(section.words, beat)}” ${beat.says}${variety}.`,
    scores: win.scores,
    odds,
    ms: 480 + Math.round(hash(section.id) * 260),
    costUsd: REEL_JEV_COST,
    sample: true,
  };
}

/** The same decision as a live Jev request: the three criteria are the questions. */
export function reelPickRequest(section: { name: string; words: string; image?: string }, takes: ReelTake[], previousFamily?: ReelFamily): JevDecideRequest {
  const options = Object.fromEntries(takes.map((t) => [t.key, `${STYLE[t.family]}${t.key.length > 1 ? " (later take)" : ""}`]));
  return {
    surface: "reels",
    purpose: "Which take fits this section best?",
    input: `"${section.words.slice(0, 240)}"`,
    state: { line: section.words, section: section.name, pictureIdea: section.image ?? "", previousStyle: previousFamily ? STYLE[previousFamily] : "none", takes: options },
    questions: {
      best: { type: "choice", instructions: `Pick the take that scores best overall on: ${REEL_PICK_CRITERIA.map((c) => `${c.label} (${c.hint})`).join("; ")}.`, criteria: options },
      ...Object.fromEntries(REEL_PICK_CRITERIA.map((c) => [c.id, { type: "choice" as const, instructions: `${c.label}. ${c.hint} Which take does this best?`, criteria: options }])),
    },
    headline: "best",
  };
}

function clamp(n: number) {
  return Math.max(0.02, Math.min(0.98, n));
}
