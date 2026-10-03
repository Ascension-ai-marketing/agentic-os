// When the user names an agent or a model, that choice is binding: Jev never
// switches agents, and only picks the model within the named agent.
import type { JevModelKey } from "./jev-models";

const MODEL_WORDS: [RegExp, JevModelKey][] = [
  [/\bhaiku\b/i, "haiku"],
  [/\bsonnet\b/i, "sonnet"],
  [/\bopus\b/i, "opus"],
  [/\bfable\b/i, "fable"],
  [/\b(gpt[- ]?6[- ]?)?astra\b/i, "codex"],
  [/\bgpt[- ]?[\d.]+[- ]?sol\b|\bsol\b(?=.*\b(model|codex|gpt)\b)/i, "sol"],
  [/\bgpt[- ]?[\d.]+[- ]?luna\b|\bluna\b(?=.*\b(model|codex|gpt)\b)/i, "luna"],
];

export function namedAgent(text: string): { agent?: "claude" | "codex"; model?: JevModelKey } {
  const t = text.toLowerCase();
  const model = MODEL_WORDS.find(([re]) => re.test(t))?.[1];
  const byModel = model ? (["haiku", "sonnet", "opus", "fable"].includes(model) ? "claude" : "codex") : undefined;
  const agent = /\bcodex\b/.test(t) ? "codex" : /\bclaude\b/.test(t) ? "claude" : byModel;
  // A model from the other agent does not override a named agent.
  if (agent && model && byModel !== agent) return { agent };
  return { agent, model };
}
