export const VOICE_PAGES = [
  {
    path: "/business",
    label: "Dashboard",
    match: /dashboard|business|revenue|cash.?flow|overview/i,
  },
  { path: "/inbox", label: "Inbox", match: /inbox|email|messages/i },
  { path: "/calendar", label: "Calendar", match: /calendar|schedule|meetings/i },
  { path: "/memory", label: "Memory", match: /memor(?:y|ies)|brain|cortex/i },
  { path: "/motion", label: "Motion Library", match: /motion|animation/i },
  { path: "/design", label: "Design", match: /design/i },
  { path: "/websites", label: "Website", match: /website/i },
  { path: "/agents/hermes", label: "Hermes", match: /hermes/i },
  { path: "/settings", label: "Settings", match: /settings|connections/i },
  { path: "/chat", label: "Chat", match: /chat/i },
  { path: "/codegraph", label: "Codebases", match: /codebase|code.?graph/i },
] as const;
export function voiceDestination(path: unknown) {
  return typeof path === "string" ? VOICE_PAGES.find((p) => p.path === path) : undefined;
}
export function voiceIntent(
  text: string,
): { kind: "navigate"; path: string } | { kind: "memory"; query: string } | { kind: "ask" } {
  const q = text.trim().replace(/^jarvis[,\s]+/i, "");
  const memory = q.match(
    /^(?:find|search|show(?: me)?|pull up|bring up)(?: my| the)? (?:memories|memory|notes)(?: about| on| for)?\s+(.+)$/i,
  );
  if (memory) return { kind: "memory", query: memory[1].trim() };
  if (/^(?:open|go to|take me to|show me|navigate to)\b/i.test(q)) {
    const page = VOICE_PAGES.find((p) => p.match.test(q));
    if (page) return { kind: "navigate", path: page.path };
  }
  return { kind: "ask" };
}
