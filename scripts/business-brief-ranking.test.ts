import { expect, test } from "bun:test";
import { authoredMailText, rankBriefInbox } from "./business-brief-ranking";

const asOf = new Date("2026-09-16T20:00:00Z");
const imports = [{ provider: "gmail", account: "owner@company.test" }];
const mail = (id: string, overrides: Record<string, unknown> = {}) => ({ id, threadId: id, source: "gmail", account: "owner@company.test", from: "client@example.test", status: "open", receivedAt: "2026-09-16T10:00:00Z", subject: "Message", body: "Hello", ...overrides });

test("an older paid delivery obligation wins over recent low-value pitches and quoted price lists", () => {
  const rows = Array.from({ length: 35 }, (_, i) => mail(`pitch-${i}`, { subject: "Review Inquiry: our new app", body: "We are reaching out with $200 for a product review today. Please confirm your interest." }));
  rows.push(mail("delivery", { receivedAt: "2026-09-14T10:00:00Z", subject: "Agreed campaign delivery", body: "Our signed contract has a deadline tomorrow. Please send the final deliverable and invoice for payment." }));
  rows.push(mail("newsletter", { subject: "Newsletter: grow your business", body: "Our client earns $500,000,000. Subscribe to our newsletter for more stories.\nOn Tue, someone wrote:\n> Please send the contract today." }));
  const ranked = rankBriefInbox(rows, imports, asOf, 20);
  expect(ranked.scannedMessages).toBe(37);
  expect(ranked.selected[0].latest.id).toBe("delivery");
  expect(ranked.ranked.find(row => row.latest.id === "newsletter")!.score).toBeLessThan(ranked.selected[0].score);
  expect(ranked.ranked.find(row => row.latest.id === "pitch-0")!.score).toBeLessThan(0);
});

test("thread state follows latest delivered message, keeps an unsent draft separate, and demotes waiting or resolved work", () => {
  const rows = [
    mail("old-request", { threadId: "replied", body: "Please send your contract and confirm the deadline today.", receivedAt: "2026-09-15T10:00:00Z" }),
    mail("reply", { threadId: "replied", from: "owner@company.test", body: "Here is the agreement you requested. Please let us know your decision." }),
    mail("draft", { threadId: "replied", from: "owner@company.test", labelIds: ["DRAFT"], receivedAt: "2026-09-16T11:00:00Z", body: "Please confirm your decision." }),
    mail("paused", { subject: "Campaign decision", body: "The project is on hold for the time being." }),
    mail("waiting", { subject: "Re: Sponsor agreement", body: "I'll discuss this with the brand and get back to you." }),
    mail("active", { subject: "Paid delivery", body: "Please send the link and invoice for payment." }),
  ];
  const ranked = rankBriefInbox(rows, imports, asOf);
  expect(ranked.scannedThreads).toBe(4);
  const replied = ranked.ranked.find(row => row.latest.threadId === "replied")!;
  expect(replied.latest.id).toBe("reply");
  expect(replied.latestDraft.id).toBe("draft");
  expect(replied.state).toBe("account-or-team-replied");
  expect(ranked.selected[0].latest.id).toBe("active");
  expect(ranked.ranked.find(row => row.latest.id === "paused")!.state).toBe("closed-or-paused");
  expect(ranked.ranked.find(row => row.latest.id === "waiting")!.state).toBe("counterparty-follow-up");
});

test("quoted pricing cannot become latest deal value and known commitments outweigh boilerplate follow-up", () => {
  expect(authoredMailText("Thanks, all done.\n\nOn Wed, Person <p@example.test>\nwrote:\n> Please approve $1,000,000 today.")).toBe("Thanks, all done.");
  const rows = [mail("reminder", { subject: "Your collaboration goes live tomorrow", body: "Please confirm your scheduled slot tomorrow. We'll reach out after your content goes live to collect the report." }),
    mail("quoted", { subject: "Re: Sponsor contract", body: "I'll discuss with the brand and get back to you.\nOn Tue, Person wrote:\n> Please approve $1,000,000 today." })];
  const ranked = rankBriefInbox(rows, imports, asOf);
  expect(ranked.selected[0].latest.id).toBe("reminder");
  expect(ranked.selected[0].state).not.toBe("counterparty-follow-up");
  expect(ranked.ranked.find(row => row.latest.id === "quoted")!.reasons.join(" ")).not.toContain("Amount mentioned");
});
