import type { InboxItem } from "./operator";

export type VoiceEmailReview = {
  messageId: string;
  subject: string;
  source: "gmail" | "outlook";
  to: string;
  cc: string;
  bcc: string;
  body: string;
};

/** Bounded evidence from the current saved mailbox. This never queries or changes a provider. */
export function searchSavedVoiceEmails(
  query: unknown,
  inbox: readonly InboxItem[],
  emailEnabled: boolean,
) {
  if (!emailEnabled) throw new Error("Email is excluded from your AI context.");
  if (typeof query !== "string" || query.length > 500 || /[\x00-\x1f]/.test(query))
    throw new Error("Use a short sender, subject or message search.");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return inbox
    .filter((message) => {
      if (!["gmail", "outlook"].includes(message.source)) return false;
      const text =
        `${message.from} ${message.subject} ${message.body.slice(0, 20_000)}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, 10)
    .map((message) => ({
      id: message.id,
      source: message.source,
      from: message.from.slice(0, 300),
      replyTo: (message.replyTo || message.from.match(/<([^>]+)>/)?.[1] || message.from).slice(
        0,
        300,
      ),
      subject: message.subject.slice(0, 250),
      receivedAt: message.receivedAt,
      excerpt: message.body.slice(0, 400),
      excerptOnly: true,
      hasLocalDraft: !!message.draft,
    }));
}

function recipients(value: unknown, required: boolean) {
  if (typeof value !== "string" || value.length > 2000 || /[\r\n\x00-\x1f]/.test(value))
    throw new Error("Use email addresses in To and CC, without line breaks.");
  const addresses = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (required && !addresses.length) throw new Error("Add the recipient’s email address.");
  if (
    addresses.length > 20 ||
    addresses.some((address) => !/^[^\s<>,@]+@[^\s<>,@]+\.[^\s<>,@]+$/.test(address))
  )
    throw new Error("Use complete email addresses separated by commas.");
  return [...new Set(addresses)].join(", ");
}

/** A voice tool can prepare a review, never send or overwrite an existing draft. */
export function prepareVoiceEmailReview(
  value: unknown,
  inbox: readonly InboxItem[],
  emailEnabled: boolean,
): VoiceEmailReview {
  if (!emailEnabled) throw new Error("Email is excluded from your AI context.");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a saved email and provide a reply to review.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["message_id", "to", "cc", "bcc", "body"].includes(key)))
    throw new Error("This tool only prepares an email reply for review.");
  const message = inbox.find((item) => item.id === input.message_id);
  if (!message || !["gmail", "outlook"].includes(message.source))
    throw new Error("Choose a Gmail or Outlook email from the current workspace results.");
  if (
    typeof input.body !== "string" ||
    !input.body.trim() ||
    input.body.length > 20_000 ||
    input.body.includes("\0")
  )
    throw new Error("Write a reply of up to 20,000 characters.");
  return {
    messageId: message.id,
    subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    source: message.source as "gmail" | "outlook",
    to: recipients(input.to, true),
    cc: recipients(input.cc ?? "", false),
    bcc: recipients(input.bcc ?? message.draftBcc ?? "", false),
    body: input.body.trim(),
  };
}

export const INBOX_OPEN_KEY = "agentic:inbox-open";

/** Only a short-lived message identifier crosses routes. No body or recipients in browser storage. */
export function inboxOpenRequest(value: unknown, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (
    typeof request.id !== "string" ||
    !request.id ||
    request.id.length > 200 ||
    /[\s\x00-\x1f]/.test(request.id)
  )
    return null;
  if (
    typeof request.createdAt !== "number" ||
    !Number.isFinite(request.createdAt) ||
    request.createdAt > now + 1000 ||
    now - request.createdAt > 60_000
  )
    return null;
  return { id: request.id, createdAt: request.createdAt };
}
