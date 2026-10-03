import { expect, test } from "bun:test";
import {
  inboxOpenRequest,
  prepareVoiceEmailReview,
  searchSavedVoiceEmails,
} from "../src/lib/voice-email-review";
import { buildOpenAIVoiceSession } from "./openai-voice";
import type { InboxItem } from "../src/lib/operator";

const message: InboxItem = {
  id: "gmail:fixture-message",
  source: "gmail",
  from: "Alice <alice@example.test>",
  subject: "Workshop planning",
  body: "Shall we meet on Friday?",
  receivedAt: "2026-09-17T08:00:00Z",
  category: "needs-you",
  status: "open",
  draft: "Existing draft",
  draftBcc: "records@example.test",
};
const input = {
  message_id: message.id,
  to: "alice@example.test",
  cc: "",
  body: "Friday works. Thanks, Alice.",
};

test("saved email search finds older exact IDs by sender, subject and body without changing state", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    ...message,
    id: `gmail:${index}`,
    subject: `Meeting ${index}`,
    body: index === 0 ? "The coastal workshop" : "Other content",
    receivedAt: new Date(index * 86_400_000).toISOString(),
  }));
  const before = structuredClone(rows);
  expect(searchSavedVoiceEmails("COASTAL workshop", rows, true).map((row) => row.id)).toEqual([
    "gmail:0",
  ]);
  expect(searchSavedVoiceEmails("alice Meeting 17", rows, true)[0]).toMatchObject({
    id: "gmail:17",
    replyTo: "alice@example.test",
    excerptOnly: true,
    hasLocalDraft: true,
  });
  expect(rows).toEqual(before);
});

test("saved email search bounds results and snippets, respects source gating and excludes non-email threads", () => {
  const rows = Array.from({ length: 24 }, (_, index) => ({
    ...message,
    id: `gmail:${index}`,
    body: "x".repeat(20000),
    receivedAt: new Date(index * 86_400_000).toISOString(),
  }));
  const result = searchSavedVoiceEmails("", rows, true);
  expect(result).toHaveLength(10);
  expect(result[0].id).toBe("gmail:23");
  expect(result.every((item) => item.excerpt.length === 400)).toBe(true);
  expect(() => searchSavedVoiceEmails("", rows, false)).toThrow("excluded");
  expect(searchSavedVoiceEmails("not-present", rows, true)).toEqual([]);
  expect(searchSavedVoiceEmails("", [{ ...message, source: "slack" }], true)).toEqual([]);
  for (const query of [null, {}, "a".repeat(501), "one\ntwo"])
    expect(() => searchSavedVoiceEmails(query, rows, true)).toThrow("short");
});

test("preparing a reply leaves original draft and mailbox unchanged and preserves visible BCC", () => {
  const before = structuredClone(message);
  const review = prepareVoiceEmailReview(input, [message], true);
  expect(review).toEqual({
    messageId: message.id,
    source: "gmail",
    subject: "Re: Workshop planning",
    to: "alice@example.test",
    cc: "",
    bcc: "records@example.test",
    body: input.body,
  });
  expect(message).toEqual(before);
  expect(prepareVoiceEmailReview({ ...input, bcc: "" }, [message], true).bcc).toBe("");
});

test("an excluded source, missing message or non-email thread cannot become a reply review", () => {
  expect(() => prepareVoiceEmailReview(input, [message], false)).toThrow("excluded");
  expect(() =>
    prepareVoiceEmailReview({ ...input, message_id: "made-up" }, [message], true),
  ).toThrow("current workspace");
  for (const source of ["capture", "slack"] as const)
    expect(() => prepareVoiceEmailReview(input, [{ ...message, source }], true)).toThrow(
      "Gmail or Outlook",
    );
});

test("review refuses hidden send flags, unexpected fields and malformed recipients", () => {
  for (const value of [
    "Alice",
    "a@example.test\r\nBcc: thief@example.test",
    "x@example.test, nope",
    "https://example.test",
  ]) {
    expect(() => prepareVoiceEmailReview({ ...input, to: value }, [message], true)).toThrow();
    expect(() => prepareVoiceEmailReview({ ...input, cc: value }, [message], true)).toThrow();
    expect(() => prepareVoiceEmailReview({ ...input, bcc: value }, [message], true)).toThrow();
  }
  for (const extra of [{ send: true }, { account: "other" }, { url: "https://example.test" }])
    expect(() => prepareVoiceEmailReview({ ...input, ...extra }, [message], true)).toThrow(
      "only prepares",
    );
});

test("review bounds text and recipients without silently truncating them", () => {
  for (const body of ["", "  ", "x\0y", "a".repeat(20001)])
    expect(() => prepareVoiceEmailReview({ ...input, body }, [message], true)).toThrow("20,000");
  expect(() =>
    prepareVoiceEmailReview(
      { ...input, to: Array.from({ length: 21 }, (_, i) => `person${i}@example.test`).join(",") },
      [message],
      true,
    ),
  ).toThrow();
  expect(
    prepareVoiceEmailReview(
      { ...input, to: "alice@example.test, alice@example.test" },
      [message],
      true,
    ).to,
  ).toBe("alice@example.test");
});

test("Inbox route handoff expires and accepts only bounded opaque identifiers", () => {
  const now = 123000;
  expect(inboxOpenRequest({ id: message.id, createdAt: now }, now)).toEqual({
    id: message.id,
    createdAt: now,
  });
  for (const value of [
    null,
    [],
    { id: "", createdAt: now },
    { id: "\nrecipient", createdAt: now },
    { id: "x".repeat(201), createdAt: now },
    { id: message.id, createdAt: now - 60001 },
    { id: message.id, createdAt: now + 1001 },
  ])
    expect(inboxOpenRequest(value, now)).toBeNull();
});

test("voice session offers an email review tool but no provider write or send tool", () => {
  const session = buildOpenAIVoiceSession();
  const review = session.tools.find((tool) => tool.name === "prepare_email_reply");
  expect(review).toBeDefined();
  expect(review?.parameters.additionalProperties).toBe(false);
  expect(review?.parameters.required).toEqual(["message_id", "to", "cc", "body"]);
  expect(session.tools.some((tool) => /send|delete|shell|execute/.test(tool.name))).toBe(false);
  expect(session.instructions).toContain("prepared reply is not a sent message");
});
