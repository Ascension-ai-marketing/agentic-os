// The models Jev chooses between, shared by the server (router + voice) and
// the chat UI. React-free and import-free so scripts/ can load it directly.
//
// Each option names a model family, the ids the OS can run it by (first match
// in the live catalog wins, so a newer id takes over as soon as it appears),
// and the plain-words rule Jev reads when it scores the request.

export type JevModelKey = "haiku" | "sonnet" | "opus" | "fable" | "codex" | "sol" | "luna";
export type JevVendor = "claude" | "codex" | "openai";

export type JevModelSpec = {
  key: JevModelKey;
  vendor: JevVendor;
  /** Chat catalog provider the ids live under. */
  provider: "claude-code" | "codex";
  /** Chat ids in order of preference. */
  chatIds: string[];
  /** OpenRouter ids for voice answers, in order of preference. Empty: not used for voice answers. */
  openrouterIds: string[];
  /** What Jev reads. Plain words, no jargon. */
  criteria: string;
};

export const JEV_MODELS: JevModelSpec[] = [
  {
    key: "haiku",
    vendor: "claude",
    provider: "claude-code",
    chatIds: ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    openrouterIds: ["anthropic/claude-haiku-4.5"],
    criteria: "Quick questions with a short answer: what is on my calendar, a fact, a definition, a yes or no, a lookup in saved notes. Fastest and cheapest Claude.",
  },
  {
    key: "sonnet",
    vendor: "claude",
    provider: "claude-code",
    chatIds: ["claude-sonnet-5", "claude-sonnet-4-6"],
    openrouterIds: ["anthropic/claude-sonnet-5"],
    criteria: "Everyday writing and thinking: emails, replies, summaries, plans, explanations and moderate research. The default for a normal request.",
  },
  {
    key: "opus",
    vendor: "claude",
    provider: "claude-code",
    chatIds: ["claude-opus-5-5", "claude-opus-5"],
    openrouterIds: ["anthropic/claude-opus-5.5"],
    criteria: "Hard reasoning where quality matters most: strategy, big decisions, pricing, long multi-step analysis and tricky trade-offs.",
  },
  {
    key: "fable",
    vendor: "claude",
    provider: "claude-code",
    chatIds: ["claude-fable-5-1", "claude-fable-5"],
    openrouterIds: ["anthropic/claude-fable-5.1"],
    criteria: "Design and creative taste: websites, visual design, brand, layouts, copy with style and creative direction.",
  },
  {
    key: "codex",
    vendor: "codex",
    provider: "codex",
    chatIds: ["gpt-6-astra", "gpt-5.3-codex"],
    openrouterIds: [],
    criteria: "Code work: write, fix, debug, test or review code, scripts or a repository.",
  },
  {
    key: "sol",
    vendor: "openai",
    provider: "codex",
    chatIds: ["gpt-6-sol", "gpt-5.6-sol"],
    openrouterIds: ["openai/gpt-6-sol"],
    criteria: "Number-heavy analysis, data, maths and structured step-by-step problems, or when a second opinion from OpenAI helps.",
  },
  {
    key: "luna",
    vendor: "openai",
    provider: "codex",
    chatIds: ["gpt-6-luna", "gpt-5.6-luna"],
    openrouterIds: ["openai/gpt-6-luna"],
    criteria: "The very cheapest option for a tiny task: a conversion, a spelling check, a one word answer. Needs no personal context.",
  },
];

/** How the owner likes work routed. Jev reads it as a preference, not a rule. */
export const JEV_OWNER_NOTES =
  "Keep quick questions cheap and fast. Design and visual taste goes to Fable. Code goes to Codex. Strategy and hard thinking goes to Opus. Everyday writing goes to Sonnet.";

export const isJevModelKey = (k: string): k is JevModelKey => JEV_MODELS.some((m) => m.key === k);
export const jevModelSpec = (k: string) => JEV_MODELS.find((m) => m.key === k);

/** "claude-opus-5-5" → "Opus 5.5", "gpt-6-sol" → "GPT-6 Sol", "anthropic/claude-haiku-4.5" → "Haiku 4.5". */
export function prettyModelName(id: string): string {
  const s = id.replace(/^.*\//, "").replace(/\[.*\]$/, "").toLowerCase();
  const claude = s.match(/^claude-(haiku|sonnet|opus|fable)-(\d+)(?:[.-](\d{1,2}))?(?:-\d{8})?$/);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  const gpt = s.match(/^gpt-(\d+(?:\.\d+)?)(?:-(\w+))?$/);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2][0].toUpperCase()}${gpt[2].slice(1)}` : ""}`;
  return id;
}

/** The chat label for an option once resolved, e.g. "Sonnet 5" or "Codex". */
export function jevOptionLabel(key: string, id?: string): string {
  if (key === "codex") return "Codex";
  return id ? prettyModelName(id) : key;
}

type CatalogEntry = { name: string; provider?: string };
const bare = (id: string) => id.replace(/\[.*\]$/, "");
const providerMatches = (spec: JevModelSpec, provider = "") =>
  spec.provider === "codex" ? /codex/i.test(provider) : provider === "claude-code";

/** First preferred id the catalog can actually run, or undefined. */
export function resolveJevModel(key: string, entries: CatalogEntry[]): { model: string; provider: string; label: string } | undefined {
  const spec = jevModelSpec(key);
  if (!spec) return undefined;
  for (const id of spec.chatIds) {
    const hit = entries.find((e) => providerMatches(spec, e.provider) && bare(e.name) === id);
    if (hit) return { model: id, provider: hit.provider ?? spec.provider, label: jevOptionLabel(key, id) };
  }
  return undefined;
}

/** Every option the catalog can run, in display order. */
export function availableJevModels(entries: CatalogEntry[]) {
  return JEV_MODELS.flatMap((spec) => {
    const hit = resolveJevModel(spec.key, entries);
    return hit ? [{ spec, ...hit }] : [];
  });
}
