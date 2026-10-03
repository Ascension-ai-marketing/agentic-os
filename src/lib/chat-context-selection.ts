import { BRAIN_SOURCES, brainEnabled, sourceOrigin } from "./brain-sources";

export const CHAT_CONTEXT_LOGOS = [
  { id: "hermes", name: "Hermes memory" }, { id: "gmail", name: "Gmail" },
  { id: "outlook", name: "Outlook" }, { id: "codex", name: "Codex memory" },
  { id: "claude", name: "Claude memory" }, { id: "personal", name: "Personal context" },
  { id: "granola", name: "Granola meetings" },
] as const;
export type ChatContextSelection = { enabled: boolean; sources: Record<string, boolean> };
export const DEFAULT_CHAT_CONTEXT: ChatContextSelection = { enabled: true, sources: {} };
export function contextSelectionKey(selection: ChatContextSelection): string {
  return `chat1:${Number(selection.enabled)}:${CHAT_CONTEXT_LOGOS.map(({ id }) => Number(selection.sources[id] !== false)).join("")}`;
}
export function selectedMailProvider(provider: string | undefined, selection: ChatContextSelection): boolean {
  if (!selection.enabled) return false;
  if (provider === "gmail" || provider === "outlook") return selection.sources[provider] !== false;
  // Untagged legacy email cannot safely be assigned to either account.
  return selection.sources.gmail !== false && selection.sources.outlook !== false;
}
export function selectedMemorySource(source: { origin?: string; collection?: string; connector?: { provider: string } }, selection: ChatContextSelection): boolean {
  if (!selection.enabled) return false;
  if (source.connector?.provider === "granola" && selection.sources.granola === false) return false;
  const origin = sourceOrigin({ origin: source.origin, collection: source.collection });
  return selection.sources[origin] !== false && (origin !== "email" || selectedMailProvider(source.connector?.provider, selection));
}
/** The toggles only narrow the server's brain policy; they never enable a disabled source. */
export function scopeChatContext<T extends { sources: any[]; brainSources?: Record<string, boolean>; inbox?: any[]; inboxImports?: any[]; events?: any[]; business?: any; goals?: any; personalProfile?: any; mailArchive?: any }>(workspace: T, selection: ChatContextSelection): T & { contextKey: string } {
  const brainSources = { ...workspace.brainSources };
  for (const { id } of BRAIN_SOURCES) {
    // Explicitly attached files remain usable without automatic workspace retrieval.
    if ((!selection.enabled && id !== "files" && id !== "images") || selection.sources[id] === false) brainSources[id] = false;
  }
  const email = selection.enabled && brainEnabled(workspace, "email");
  return { ...workspace, brainSources, contextKey: contextSelectionKey(selection),
    sources: workspace.sources.filter(s => !s.deletedAt && brainEnabled(workspace, sourceOrigin(s)) && selectedMemorySource(s, selection)),
    business: selection.enabled ? workspace.business : null,
    goals: selection.enabled ? workspace.goals : null,
    personalProfile: selection.enabled && selection.sources.personal !== false ? workspace.personalProfile : null,
    inbox: email ? (workspace.inbox || []).filter(item => selectedMailProvider(item.source, selection)) : [],
    inboxImports: email ? (workspace.inboxImports || []).filter(item => selectedMailProvider(item.provider || item.source, selection)) : [],
    mailArchive: email && selection.sources.gmail !== false && selection.sources.outlook !== false ? workspace.mailArchive : null,
    events: selection.enabled ? workspace.events : [],
  };
}
export function selectedChatHistory(turn: { contextKey?: string }, selection: ChatContextSelection): boolean {
  const key = turn.contextKey || contextSelectionKey(DEFAULT_CHAT_CONTEXT);
  // Before Granola had its own switch, it followed the enabled workspace sources.
  return (/^chat1:[01]:[01]{6}$/.test(key) ? `${key}1` : key) === contextSelectionKey(selection);
}
