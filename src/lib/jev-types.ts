// Shared contract for every Jev feature (voice, router, inbox, image search,
// reels, slop). The server writes JevDecision records; the UI reads them.
// Change this file only by agreement: both build branches depend on it.

export type JevSurface = "voice" | "router" | "inbox" | "image-search" | "reels" | "slop";

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number }
  | {
      type: "score";
      score: number;
      // Jev returns the legend as {"0": "never", "1": "this week"}; older
      // notes assumed a list. Accept both.
      legend?: string[] | Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export type JevDecision = {
  id: string;
  at: string; // ISO time
  surface: JevSurface;
  purpose: string; // plain words, e.g. "Which tier handles this voice request?"
  input: string; // short human summary of the state, max 280 chars, never raw email bodies or secrets
  answers: Record<string, JevAnswer>;
  picked: string; // headline outcome label, e.g. "tier-3", "opus-5.5", "reply-today"
  pickedLabel?: string; // display text for picked
  optionLabels?: Record<string, string>; // display text for each option id, e.g. { sonnet: "Sonnet 5" }
  escalated: boolean; // true when confidence fell below the bar and an LLM made the call
  ms: number; // Jev round trip
  costUsd: number; // Jev cost from usage.cost
  compare?: { model: string; ms: number; costUsd: number; kind: "measured" | "estimated" };
  error?: string;
};

export type JevDecideRequest = {
  surface: JevSurface;
  purpose: string;
  input: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
  headline: string; // which question id supplies `picked`
  escalateBelow?: number; // confidence bar for the headline question
};

export type JevSavings = {
  calls: number;
  costUsd: number;
  compareCostUsd: number;
  savedUsd: number;
  bySurface: Partial<Record<JevSurface, { calls: number; costUsd: number; compareCostUsd: number }>>;
  estimated: boolean; // true when any compare figure is an estimate
};
