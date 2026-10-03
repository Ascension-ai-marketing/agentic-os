import { test, expect } from "bun:test";
import { executorOdds, executorPick } from "../src/lib/jev-executor";
const c = (choice: string, probabilities: Record<string, number>) => ({ type: "choice" as const, choice, probabilities, confidence: probabilities[choice] });

test("the pick is always the highest tile, never an escalation override (Jack's 0% Claude Code card)", () => {
  // Jev: open 65%, answer 34%, work ~0%. An LLM escalation had set picked = tier-3.
  const d = { picked: "tier-3", answers: { tier: c("tier-1", { "tier-1": 0.65, "tier-2": 0.34, "tier-3": 0.004 }), worker: c("claude", { claude: 0.9, codex: 0.1 }) } };
  const odds = executorOdds(d);
  const pick = executorPick(odds);
  expect(pick.key).toBe("open");
  expect(pick.p).toBe(Math.max(...Object.values(odds)));
  expect(odds.claude).toBeLessThan(0.01);
});
test("work splits by worker, and a split vote can lose to a clear answer", () => {
  const d = { answers: { tier: c("tier-3", { "tier-3": 0.55, "tier-2": 0.45 }), worker: c("codex", { codex: 0.5, claude: 0.5 }) } };
  expect(executorPick(executorOdds(d)).key).toBe("reply");
  const clear = { answers: { tier: c("tier-3", { "tier-3": 0.9, "tier-2": 0.1 }), worker: c("codex", { codex: 0.95, claude: 0.05 }) } };
  expect(executorPick(executorOdds(clear))).toEqual({ key: "codex", p: 0.9 * 0.95 });
});
test("a signed-out agent gets no odds; its share moves to the other agent", () => {
  const d = { answers: { tier: c("tier-3", { "tier-3": 0.9, "tier-2": 0.1 }), worker: c("claude", { claude: 0.8, codex: 0.2 }) } };
  const odds = executorOdds(d, ["claude"]);
  expect(odds.claude).toBe(0); expect(odds.codex).toBeCloseTo(0.9);
  expect(executorPick(odds).key).toBe("codex");
});
