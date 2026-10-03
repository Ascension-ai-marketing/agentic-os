import type { InboxItem } from "./operator";

export type RecentVoiceEmails = {
  kind: "emails";
  checkedAt: string;
  mode: "live" | "mixed" | "saved" | "unavailable";
  items: Array<InboxItem & { evidence?: "live" | "saved" }>;
  providers: Array<{
    provider: "gmail" | "outlook";
    status: "live" | "unavailable" | "not-connected";
    checkedAt?: string;
    reason?: string;
  }>;
  freshness: string;
  instruction: string;
};
export type RecentVoiceCreation = {
  id: string;
  title: string;
  filename: string;
  prompt?: string;
  model?: string;
  provider?: string;
  createdAt: string;
  previewUrl: string;
};
export type RecentVoiceCreations = {
  kind: "creations";
  checkedAt: string;
  items: RecentVoiceCreation[];
  freshness: string;
  instruction: string;
};
export type RecentVoiceResult = RecentVoiceEmails | RecentVoiceCreations;

/** Narrow recency requests must use actual provider/creation evidence, not general recall. */
export function recentVoiceIntent(request: string): "emails" | "creations" | null {
  if (!/\b(?:last|latest|newest|recent|most recent)\b/i.test(request)) return null;
  if (/\b(?:e-?mails?|inbox|mailbox)\b/i.test(request)) return "emails";
  if (/\b(?:images?|pictures?|photos?|artwork|creations?)\b/i.test(request) &&
      /\b(?:creat\w*|generat\w*|made|design|studio|OS)\b/i.test(request)) return "creations";
  return null;
}

/** Generic capability questions must never trigger a private lookup or leave old results visible. */
export function permitsRecentVoiceTool(kind: "emails" | "creations", request: string) {
  return recentVoiceIntent(request) === kind;
}
export function recentMemoryQuery(query: string) {
  return /\b(?:just|recently) (?:save(?:d)?|add(?:ed)?|tell|told|upload(?:ed)?)\b|\b(?:latest|last|newest|most recent) (?:saved )?(?:memory|note)\b/i.test(query);
}
