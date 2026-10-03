import type { JevDecision } from "./jev-types";
export const inboxCategories = ["reply-today", "lead", "sponsor", "billing", "community", "newsletter", "spam", "fyi"] as const;
export type InboxCategory = typeof inboxCategories[number];
export type InboxLabel = { messageId: string; fingerprint: string; category: InboxCategory; needsReply: number; urgency: number; decision: JevDecision; simulated?: boolean };

// One colour per pile. Jev pink is kept for Jev itself.
export const PILES: Record<InboxCategory, { name: string; color: string }> = {
  "reply-today": { name: "Reply today", color: "#ff7a59" },
  lead: { name: "Leads", color: "#3ddc97" },
  sponsor: { name: "Sponsors", color: "#f5b83d" },
  billing: { name: "Billing", color: "#7c9cff" },
  community: { name: "Community", color: "#43c6e8" },
  newsletter: { name: "Newsletters", color: "#b08cff" },
  spam: { name: "Spam", color: "#ff5d6c" },
  fyi: { name: "FYI", color: "#8a93a6" },
};
