import type { MemorySource, OperatorState } from "./operator";
export const BRAIN_SOURCES = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    group: "Agent memory",
    description: "Conversations imported from your ChatGPT export",
  },
  {
    id: "notion",
    name: "Notion",
    group: "Knowledge & tools",
    description: "Pages shared with your Notion integration",
  },
  {
    id: "images",
    name: "Images",
    group: "Knowledge & tools",
    description: "Text read from uploaded images on this Mac",
  },
  {
    id: "business",
    name: "Business context",
    group: "Your world",
    description: "Company facts, goals, offers and decisions",
  },
  {
    id: "personal",
    name: "Personal context",
    group: "Your world",
    description: "Your preferences, priorities and working style",
  },
  {
    id: "meetings",
    name: "Meetings",
    group: "Your world",
    description: "Calendar context, notes and action items",
  },
  {
    id: "email",
    name: "Email & messages",
    group: "Your world",
    description: "Inbox conversations and saved correspondence",
  },
  {
    id: "manual",
    name: "Added by you",
    group: "Your world",
    description: "Notes and memories you choose to save",
  },
  {
    id: "web",
    name: "Articles & videos",
    group: "Your world",
    description: "Web research and video transcripts",
  },
  {
    id: "claude",
    name: "Claude memory",
    group: "Agent memory",
    description: "Mapped Claude workspaces and imported memory",
  },
  {
    id: "codex",
    name: "Codex memory",
    group: "Agent memory",
    description: "Memory and project notes imported from Codex",
  },
  {
    id: "hermes",
    name: "Hermes memory",
    group: "Agent memory",
    description: "Saved context imported from Hermes",
  },
  {
    id: "openclaw",
    name: "OpenClaw memory",
    group: "Agent memory",
    description: "Imported OpenClaw notes and context",
  },
  {
    id: "grokbot",
    name: "Grok / GrokBot",
    group: "Agent memory",
    description: "Notes and memory imported from your bot",
  },
  {
    id: "files",
    name: "Files & documents",
    group: "Knowledge & tools",
    description: "Documents you import from this Mac",
  },
  {
    id: "obsidian",
    name: "Obsidian notes",
    group: "Knowledge & tools",
    description: "Connected vault notes and their links",
  },
  {
    id: "skills",
    name: "Skills",
    group: "Knowledge & tools",
    description: "Your available skills and usage metadata",
  },
  {
    id: "agents",
    name: "Agents",
    group: "Knowledge & tools",
    description: "Connected agent capability metadata",
  },
  {
    id: "codebases",
    name: "Codebases & projects",
    group: "Knowledge & tools",
    description: "Imported project knowledge and code context",
  },
] as const;
export type BrainSourceId = (typeof BRAIN_SOURCES)[number]["id"];
export const brainEnabled = (state: Pick<OperatorState, "brainSources">, id: string) =>
  state.brainSources?.[id] !== false;
export function sourceOrigin(s: Partial<MemorySource>): string {
  // The connector that brought a record in is the truth. Older Notion imports were
  // saved with a ChatGPT origin, so they read as Notion again here.
  const provider = s.connector?.provider;
  if (provider === "notion") return "notion";
  if (provider === "granola") return "meetings";
  if (s.origin) return s.origin;
  if (s.kind === "meeting") return "meetings";
  if (s.kind === "article" || s.kind === "video") return "web";
  if (s.kind === "document") return "files";
  if (s.collection === "business") return "business";
  if (s.collection === "personal") return "personal";
  if (s.collection === "projects") return "codebases";
  return "manual";
}
export function nodeOrigin(n: any): string {
  if (n.kind === "skill") return "skills";
  if (n.kind === "agent") return "agents";
  const s = String(n.source || "").toLowerCase();
  if (BRAIN_SOURCES.some((x) => x.id === s)) return s;
  if (s === "grok") return "grokbot";
  return "codebases";
}
export function brainContext(state: OperatorState) {
  return {
    ...state,
    sources: state.sources.filter((s) => !s.deletedAt && brainEnabled(state, sourceOrigin(s))),
    goals: brainEnabled(state, "business")
      ? state.goals
      : { longTerm: "", quarter: "", week: "", metrics: [] },
    inbox: brainEnabled(state, "email") ? state.inbox : [],
    inboxImports: brainEnabled(state, "email") ? state.inboxImports : [],
    gmailLabels: brainEnabled(state, "email") ? state.gmailLabels : [],
    gmailLabelsUpdatedAt: brainEnabled(state, "email") ? state.gmailLabelsUpdatedAt : undefined,
    events: brainEnabled(state, "meetings") ? state.events : [],
  };
}
export function brainSourceCounts(
  state: OperatorState,
  live: any,
): Record<string, { saved: number; mapped: number }> {
  const out = Object.fromEntries(BRAIN_SOURCES.map((s) => [s.id, { saved: 0, mapped: 0 }]));
  for (const s of state.sources.filter((s) => !s.deletedAt))
    if (out[sourceOrigin(s)]) out[sourceOrigin(s)].saved++;
  out.business.mapped = [
    state.goals.longTerm,
    state.goals.quarter,
    state.goals.week,
    ...state.goals.metrics,
  ].filter(Boolean).length;
  out.email.mapped = state.inbox.length;
  out.meetings.mapped = state.events.length;
  if (!live?.isExample) {
    for (const n of live?.memory?.nodes || [])
      if (n.kind !== "hub" && out[nodeOrigin(n)]) out[nodeOrigin(n)].mapped++;
    out.obsidian.saved += (live?.memory?.knowledge?.graphs || []).reduce(
      (sum: number, g: any) => sum + (g.notes?.length || 0),
      0,
    );
    out.skills.mapped += live?.skills?.active?.length || 0;
    // Codex, ChatGPT, email and meetings records read from this Mac by the aggregator.
    const streams = live?.memory?.streams || {};
    out.codex.mapped += streams.codex?.records?.length || 0;
    out.chatgpt.mapped += streams.chatgpt?.records?.length || 0;
    out.email.mapped = Math.max(out.email.mapped, streams.email?.records?.length || 0);
    out.meetings.mapped = Math.max(out.meetings.mapped, streams.meetings?.records?.length || 0);
    out.hermes.mapped += streams.hermes?.records?.length || 0;
    // Codex, shared and Hermes skills, minus the ones Claude already lists.
    const claudeSkills = new Set(
      (live?.skills?.active || []).map((k: { name: string }) => k.name.toLowerCase()),
    );
    out.skills.mapped += (streams.skills?.records || []).filter(
      (r: { title: string }) => !claudeSkills.has(r.title.toLowerCase()),
    ).length;
    out.agents.mapped += live?.hermes?.installed ? 1 : 0;
  }
  return out;
}
