import { describe, expect, test } from "bun:test";
import { retrieveInboxQuestion } from "./inbox-question-search";
import type { InboxItem, OperatorState } from "../src/lib/operator";

const now = new Date("2026-09-16T12:00:00Z");
function state(inbox: InboxItem[] = []): OperatorState {
  return { version: 1, inbox, sources: [], events: [], hiddenMemoryTitles: [], goals: { longTerm: "", quarter: "", week: "", metrics: [] }, settings: { mission: false, openclaw: false, news: true } };
}
const mail = (id: string, patch: Partial<InboxItem> = {}): InboxItem => ({ id, from: "Alex Example", subject: "Project update", body: "The project is complete.", source: "gmail", receivedAt: "2026-09-16T10:00:00Z", direction: "inbound", category: "needs-you", status: "open", read: false, ...patch });
const search = (question: string, s: OperatorState) => retrieveInboxQuestion({ question, state: s, now });

describe("local inbox question retrieval", () => {
  test("finds exact text in older thread history and returns the matching message ID", () => {
    const old = "Our launch budget is EUR 12,400. The venue deposit is included.";
    const s = state([
      mail("old", { from: "Sarah Stone", threadId: "thread-one", body: old, receivedAt: "2026-08-02T10:00:00Z" }),
      mail("new", { from: "You", threadId: "thread-one", body: "Thanks for yesterday's call!", direction: "outbound" }),
    ]);
    const result = search("What did Sarah say about the launch budget?", s);
    expect(result.totalSearched).toBe(1); expect(result.matchedCount).toBe(1);
    expect(result.results[0]).toMatchObject({ id: "old", source: "gmail", threadId: "thread-one", excerpt: old, receivedAt: "2026-08-02T10:00:00Z", direction: "inbound" });
    expect(result.results[0].reason).toContain("history");
    expect(result.coverage).toContain("provider archives were not searched");
  });

  test("hidden providers never appear", () => {
    const s = state([mail("gmail", { body: "Budget" }), mail("slack", { body: "Budget", source: "slack" })]);
    s.settings.inboxAccounts = { gmail: false, outlook: true, capture: true, slack: true };
    const result = search("budget", s);
    expect(result.totalSearched).toBe(1);
    expect(result.results.map(item => item.source)).toEqual(["slack"]);
    s.brainSources = { email: false };
    expect(search("budget", s).results).toHaveLength(1);
  });

  test("deduplicates email threads per provider and account while preserving the matched message ID", () => {
    const s = state([
      mail("one-old", { account: "one@example.com", threadId: "same", body: "The launch budget is 100.", receivedAt: "2026-08-01T10:00:00Z" }),
      mail("one-new", { account: "one@example.com", threadId: "same", body: "Thanks for the information." }),
      mail("two", { account: "two@example.com", threadId: "same", body: "The launch budget is 200." }),
    ]);
    const result = search("launch budget", s);
    expect(result.totalSearched).toBe(2); expect(result.matchedCount).toBe(2);
    expect(result.results.map(item => item.id).sort()).toEqual(["one-old", "two"]);
  });

  test("irrelevant questions return no results and relevance outranks recency", () => {
    const s = state([
      mail("fresh", { from: "Alex", subject: "Budget", body: "The budget is ready." }),
      mail("relevant-old", { from: "Budget Review", subject: "Budget review", body: "Budget needs review.", receivedAt: "2026-01-02T10:00:00Z" }),
    ]);
    expect(search("platypus quantum zeppelin", s).matchedCount).toBe(0);
    expect(search("budget", s).results[0].id).toBe("relevant-old");
    expect(search("Can you show me my messages?", s).results).toHaveLength(0);
  });

  test("reply intent needs an incoming request; unread alone and already answered questions do not qualify", () => {
    const s = state([
      mail("needs", { body: "Could you approve the launch budget?" }),
      mail("unread-fyi", { body: "The launch happened yesterday." }),
      mail("newsletter", { body: "Could you read this newsletter?", category: "updates" }),
      mail("completed", { body: "Can you review this?", status: "done" }),
      mail("outbound", { body: "Could you confirm the date?", direction: "outbound" }),
    ]);
    s.inbox.push(
      mail("answered-question", { threadId: "answered", body: "Can you review this?", receivedAt: "2026-09-15T10:00:00Z" }),
      mail("answered-reply", { threadId: "answered", body: "Yes, all done.", direction: "outbound" }),
    );
    const result = search("Who needs a reply?", s);
    expect(result.results.map(item => item.id)).toEqual(["needs"]);
    expect(result.results[0].reason).toBe("Latest incoming message asks a question.");
  });

  test("waiting and sent questions use latest direction rather than old inbound requests", () => {
    const s = state([
      mail("sent", { direction: "outbound", body: "Could you confirm the appointment?" }),
      mail("received", { body: "Yes, confirmed." }),
      mail("previous", { source: "slack", threadId: "waiting", body: "Thanks for checking.", receivedAt: "2026-09-15T10:00:00Z" }),
      mail("latest", { source: "slack", threadId: "waiting", body: "Could you send the details?", direction: "outbound" }),
    ]);
    const result = search("Who am I waiting for?", s);
    expect(result.results.map(item => item.id).sort()).toEqual(["latest", "sent"]);
    expect(result.results.every(item => item.reason.includes("no newer incoming message is loaded"))).toBe(true);
    expect(search("What have I sent?", s).results.every(item => item.direction === "outbound")).toBe(true);
  });

  test("unread query does not describe a newer read message as unread", () => {
    const s = state([mail("older", { threadId: "same", read: false, receivedAt: "2026-09-15T10:00:00Z", body: "An unread note." }), mail("newer", { threadId: "same", read: true, body: "A newer read note." })]);
    const result = search("Show unread messages", s);
    expect(result.results[0].id).toBe("older");
    expect(result.results[0].reason).toBe("This conversation contains unread messages.");
  });

  test("topic stems, sponsorship intent and named providers work", () => {
    const s = state([mail("sponsor", { source: "gmail", subject: "Hello", body: "We would love to work together.", category: "sponsors" }), mail("outlook-topic", { source: "outlook", body: "Our pricing options are flexible." }), mail("slack", { source: "slack", body: "The sponsorship looks good." })]);
    expect(search("Show Gmail sponsorships", s).results.map(item => item.id)).toEqual(["sponsor"]);
    expect(search("brand deals", s).results.map(item => item.id).sort()).toEqual(["slack", "sponsor"]);
    expect(search("price", s).results[0].id).toBe("outlook-topic");
  });

  test("conversational filler does not become a mandatory pricing topic", () => {
    const s = state([
      mail("pricing", { body: "Can you explain the pricing for the workshop?" }),
      mail("cost", { body: "What is the cost of the workshop?" }),
      mail("unrelated", { body: "People enjoyed the event yesterday." }),
    ]);
    expect(search("What did people ask about pricing?", s).results.map(item => item.id).sort()).toEqual(["cost", "pricing"]);
    expect(search("Did anyone ask anything regarding pricing?", s).results.map(item => item.id).sort()).toEqual(["cost", "pricing"]);
    expect(search("Show something related to pricing", s).results.map(item => item.id).sort()).toEqual(["cost", "pricing"]);
  });

  test("follow-up questions find current outgoing conversations with a qualified reason", () => {
    const s = state([
      mail("outgoing", { direction: "outbound", body: "Could you confirm the proposal?" }),
      mail("incoming", { direction: "inbound", body: "Could you confirm the appointment?" }),
    ]);
    for (const question of ["What should I follow up on?", "Any follow-up?", "Show followups"]) {
      const result = search(question, s);
      expect(result.results.map(item => item.id)).toEqual(["outgoing"]);
      expect(result.results[0].reason).toBe("The latest loaded message is yours; no newer incoming message is loaded.");
    }
  });

  test("today and this week constrain the actual matching message date", () => {
    const s = state([mail("today", { body: "Budget today." }), mail("monday", { body: "Budget monday.", receivedAt: "2026-09-14T10:00:00Z" }), mail("lastweek", { body: "Budget last week.", receivedAt: "2026-09-11T10:00:00Z" })]);
    expect(search("budget today", s).results.map(item => item.id)).toEqual(["today"]);
    expect(search("budget this week", s).results.map(item => item.id).sort()).toEqual(["monday", "today"]);
  });

  test("matches are capped at eight, counts are complete, and input state is unchanged", () => {
    const s = state(Array.from({ length: 12 }, (_, i) => mail(String(i), { body: "Budget notes." })));
    const before = JSON.stringify(s);
    const result = search("budget", s);
    expect(result.results).toHaveLength(8); expect(result.matchedCount).toBe(12); expect(result.totalSearched).toBe(12);
    expect(JSON.stringify(s)).toBe(before);
    expect(() => search("   ", s)).toThrow("between 1 and 600");
    expect(() => search("x".repeat(601), s)).toThrow("between 1 and 600");
  });
});
