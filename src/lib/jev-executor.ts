// The executor odds: one source of truth for what Jev picked and what the card
// shows. The server acts on `executorPick`, the card draws the same numbers,
// so the highlighted tile, headline and % chip can never disagree.
// (Jev's `picked` may come from an LLM escalation that overrode the odds; the
// executor ignores that and uses the odds themselves.)
import type { JevAnswer, JevDecision } from "./jev-types";

export type ExecutorKey = "reply" | "open" | "memory" | "claude" | "codex" | "continue";
const choice = (a: JevAnswer | undefined) => (a?.type === "choice" ? a : undefined);

/**
 * Odds per door: quick answer, open a page, Memory, continue, and work split
 * by worker: P(work) × P(worker). Signed-out agents get 0 and their share
 * goes to the other agent.
 */
export function executorOdds(d: Pick<JevDecision, "answers">, signedOut: string[] = []): Record<ExecutorKey, number> {
  const tier = choice(d.answers.tier)?.probabilities ?? {};
  const w = { ...(choice(d.answers.worker)?.probabilities ?? { claude: 0.5, codex: 0.5 }) };
  for (const a of ["claude", "codex"] as const) if (signedOut.includes(a)) w[a] = 0;
  const wSum = (w.claude ?? 0) + (w.codex ?? 0);
  const work = tier["tier-3"] ?? 0;
  const share = (a: "claude" | "codex") => (wSum > 0 ? work * ((w[a] ?? 0) / wSum) : 0);
  return { reply: tier["tier-2"] ?? 0, open: tier["tier-1"] ?? 0, memory: tier.memory ?? 0, continue: tier.continue ?? 0, claude: share("claude"), codex: share("codex") };
}

/** The door with the highest odds. Ties go to the cheaper door (answer before work). */
export function executorPick(odds: Record<ExecutorKey, number>): { key: ExecutorKey; p: number } {
  const order: ExecutorKey[] = ["reply", "open", "memory", "continue", "claude", "codex"];
  let best = order[0];
  for (const k of order) if (odds[k] > odds[best]) best = k;
  return { key: best, p: odds[best] };
}
