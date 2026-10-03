import { expect, test } from "bun:test";
import { needsChatEmail } from "../src/lib/chat-retrieval-routing";

test("saved preference questions do not trigger email even with an inbox page attached", () => {
  const request = "Hey there, what is Alex Example' favourite colour and what is his favourite animal?";
  expect(needsChatEmail(request)).toBe(false);
  expect(needsChatEmail(request, true)).toBe(false);
  expect(needsChatEmail("What did I just save in memory?")).toBe(false);
  expect(needsChatEmail("Who was in my latest Granola meeting?")).toBe(false);
});

test("explicit mailbox requests retain email retrieval", () => {
  for (const request of ["Find the email from Sam", "Check my Gmail", "Summarize my Outlook inbox", "Search e-mails about the invoice", "Who was the sender?"]) {
    expect(needsChatEmail(request)).toBe(true);
  }
});

test("a reply needs attached email context to imply mailbox retrieval", () => {
  expect(needsChatEmail("Draft a reply", true)).toBe(true);
  expect(needsChatEmail("Summarise this message", true)).toBe(true);
  expect(needsChatEmail("Draft a reply", false)).toBe(false);
  expect(needsChatEmail("Summarise this message", false)).toBe(false);
});

import {
  appFocusInstruction,
  chatAppFocus,
  chatTimeWindow,
  closestRecordLabel,
  inTimeWindow,
  recordActivityRange,
  recordApp,
  recordMatchesApp,
  sameDayDistance,
  timeWindowCoverage,
} from "../src/lib/chat-retrieval-routing";

// Friday 18 September 2026, 10:30 local time. Dates are built locally so the
// expectations hold in any timezone.
const now = new Date(2026, 8, 18, 10, 30);
const local = (day: number, hour = 0, month = 8, year = 2026) => new Date(year, month, day, hour).getTime();

test("dated questions resolve to a local-time window with a plain label", () => {
  const morning = chatTimeWindow("Hey, what was a conversation I had with Codex this morning?", now)!;
  expect(morning).toEqual({ label: "this morning (18 Sep 2026, 04:00–13:00)", start: local(18, 4), end: local(18, 13) });
  expect(chatTimeWindow("What did I work on today?", now)).toEqual({ label: "today (18 Sep 2026)", start: local(18), end: local(19) });
  expect(chatTimeWindow("Summarise yesterday afternoon", now)).toEqual({ label: "yesterday afternoon (17 Sep 2026, 12:00–17:00)", start: local(17, 12), end: local(17, 17) });
  expect(chatTimeWindow("What happened last night?", now)).toEqual({ label: "last night (17 Sep 2026 evening)", start: local(17, 18), end: local(18, 6) });
  expect(chatTimeWindow("Tonight's plan?", now)!.start).toBe(local(18, 17));
});

test("weekdays, explicit dates and weeks resolve to the most recent matching day", () => {
  expect(chatTimeWindow("What did we decide on Monday?", now)).toMatchObject({ label: "Monday (14 Sep 2026)", start: local(14), end: local(15) });
  expect(chatTimeWindow("last Friday's session", now)).toMatchObject({ start: local(11), end: local(12) });
  expect(chatTimeWindow("the Friday session", now)).toMatchObject({ start: local(18), end: local(19) });
  for (const request of ["what happened on 16 September", "September 16 notes", "notes from 2026-09-16", "on the 16th of Sep"])
    expect(chatTimeWindow(request, now)).toMatchObject({ label: "on 16 Sep 2026", start: local(16), end: local(17) });
  expect(chatTimeWindow("the launch on December 3", now)).toMatchObject({ start: local(3, 0, 11, 2025), end: local(4, 0, 11, 2025) });
  expect(chatTimeWindow("what did I do last week", now)).toMatchObject({ start: local(7), end: local(14) });
  expect(chatTimeWindow("this week so far", now)).toMatchObject({ start: local(14), end: local(19) });
});

test("questions without a date name no window", () => {
  for (const request of ["Good morning! What is our churn rate?", "What did we decide about pricing?", "Find the Granola meeting with Sam", "Remember: buy milk"])
    expect(chatTimeWindow(request, now)).toBeNull();
});

test("record activity comes from the sync stamp or a dated name, and overlaps the window", () => {
  const morning = chatTimeWindow("this morning", now)!;
  const afternoon = chatTimeWindow("this afternoon", now)!;
  const codex = recordActivityRange({ title: "Codex · rollout-2026-09-18T09-12-33-abc", connector: { path: "~/.codex/sessions/2026/09/18/rollout-2026-09-18T09-12-33-abc.jsonl", activityAt: new Date(2026, 8, 18, 11, 40).toISOString() } })!;
  expect(codex).toEqual({ start: new Date(2026, 8, 18, 9, 12, 33).getTime(), end: new Date(2026, 8, 18, 11, 40).getTime() });
  expect(inTimeWindow(codex, morning)).toBe(true);
  expect(inTimeWindow(codex, afternoon)).toBe(false);
  const claude = recordActivityRange({ title: "Claude · 8f2c", connector: { path: "~/.claude/projects/x/8f2c.jsonl", activityAt: new Date(2026, 8, 18, 13, 5).toISOString() } })!;
  expect(claude.start).toBe(claude.end);
  expect(inTimeWindow(claude, afternoon)).toBe(true);
  const dated = recordActivityRange({ title: "Codex · rollout-2026-09-16T08-00-00-old", connector: { path: "~/.codex/sessions/2026/09/16/rollout.jsonl" } })!;
  expect(inTimeWindow(dated, chatTimeWindow("on 16 September", now)!)).toBe(true);
  expect(inTimeWindow(dated, morning)).toBe(false);
  expect(recordActivityRange({ title: "Pricing notes" })).toBeNull();
});

test("coverage text names the window, the pending import and the exact next action", () => {
  const morning = chatTimeWindow("this morning", now)!;
  const apps = [
    { id: "codex", name: "Codex", enabled: true, status: "idle", progress: { hasMore: true, remaining: 301 } },
    { id: "claude", name: "Claude", enabled: true, status: "idle", progress: { hasMore: false, remaining: 0 } },
    { id: "hermes", name: "Hermes", enabled: false, status: "idle", progress: { hasMore: true, remaining: 9 } },
  ];
  const empty = timeWindowCoverage(morning, 0, apps);
  expect(empty.footer).toBe("No imported memory records fall inside this morning (18 Sep 2026, 04:00–13:00). Codex import is still pending: 301 Codex files remaining. Open Memory and sync Codex again.");
  expect(empty.instruction).toContain("No imported memory record falls inside that window");
  expect(empty.instruction).toContain("do not describe import or sync status yourself");
  expect(empty.pending).toEqual([{ id: "codex", name: "Codex", remaining: 301 }]);
  const found = timeWindowCoverage(morning, 2, apps);
  expect(found.instruction).toContain("2 retrieved sources fall inside that window");
  expect(found.footer).toBe("More from this morning (18 Sep 2026, 04:00–13:00) may exist. Codex import is still pending: 301 Codex files remaining. Open Memory and sync Codex again.");
  const complete = timeWindowCoverage(morning, 0, apps.slice(1));
  expect(complete.footer).toContain("Every enabled memory app is fully imported");
  const syncing = timeWindowCoverage(morning, 0, [{ id: "codex", name: "Codex", enabled: true, status: "syncing", progress: { hasMore: false } }]);
  expect(syncing.footer).toContain("Codex is syncing now; ask again in a minute.");
  const two = timeWindowCoverage(morning, 0, [apps[0], { ...apps[1], progress: { hasMore: true, remaining: 1186 } }]);
  expect(two.footer).toContain("Codex and Claude import are still pending: 301 Codex files, 1186 Claude files remaining. Open Memory and sync Codex and Claude again.");
});

test("a session that runs past noon still belongs to this morning", () => {
  const morning = chatTimeWindow("what did I say to Codex this morning?", new Date(2026, 8, 18, 13, 45))!;
  const session = recordActivityRange({
    title: "Codex · rollout-2026-09-18T12-31-08-abc",
    connector: { path: "~/.codex/sessions/2026/09/18/rollout-2026-09-18T12-31-08-abc.jsonl", activityAt: new Date(2026, 8, 18, 12, 52, 54).toISOString() },
  })!;
  expect(inTimeWindow(session, morning)).toBe(true);
  expect(sameDayDistance(session, morning)).toBe(0);
  const lunch = recordActivityRange({ title: "Codex · rollout-2026-09-18T13-30-14-def" })!;
  expect(inTimeWindow(lunch, morning)).toBe(false);
  expect(sameDayDistance(lunch, morning)).toBe((30 * 60 + 14) * 1000);
  const yesterday = recordActivityRange({ title: "Codex · rollout-2026-09-17T13-30-14-old" })!;
  expect(sameDayDistance(yesterday, morning)).toBeNull();
  expect(closestRecordLabel({ title: "Codex · rollout-2026-09-18T13-30-14-def", connector: { provider: "codex" } }, lunch)).toBe("13:30 Codex session");
  expect(closestRecordLabel({ title: "Weekly sync", origin: "meetings", connector: { provider: "granola" } }, { start: new Date(2026, 8, 18, 9, 5).getTime(), end: 0 })).toBe("09:05 Granola meeting");
  expect(closestRecordLabel({ title: "Invoice", origin: "email" }, { start: new Date(2026, 8, 18, 7, 0).getTime(), end: 0 })).toBe("07:00 email");
});

test("a question that names an app focuses retrieval on that app's records", () => {
  expect(chatAppFocus("what did I say to Codex this morning?")).toEqual([{ id: "codex", name: "Codex" }]);
  expect(chatAppFocus("Compare my Claude and Codex sessions")).toEqual([{ id: "claude", name: "Claude" }, { id: "codex", name: "Codex" }]);
  expect(chatAppFocus("Find the Granola meeting with Sam")).toEqual([{ id: "granola", name: "Granola" }]);
  expect(chatAppFocus("What is our churn rate?")).toEqual([]);
  const codex = { title: "Codex · rollout-2026-09-18T12-31-08-abc", origin: "codex", connector: { provider: "codex" } };
  const claude = { title: "Claude · 8f2c", origin: "claude", connector: { provider: "claude" } };
  const skill = { title: "Codex · agent-reach", origin: "skills", connector: { provider: "codex" } };
  const notionPage = { title: "Base 44", origin: "chatgpt", connector: { provider: "notion" } };
  const mail = { title: "Invoice 42", origin: "email" };
  expect(recordApp(codex)).toBe("codex");
  expect(recordApp(skill)).toBe("codex");
  expect(recordApp(notionPage)).toBe("notion");
  expect(recordApp({ title: "Pricing notes", origin: "manual" })).toBeNull();
  expect(recordMatchesApp(codex, "codex")).toBe(true);
  expect(recordMatchesApp(claude, "codex")).toBe(false);
  expect(recordMatchesApp(mail, "gmail")).toBe(true);
  expect(recordMatchesApp(mail, "outlook")).toBe(true);
  expect(recordMatchesApp({ ...mail, connector: { provider: "outlook" } }, "gmail")).toBe(false);
  expect(appFocusInstruction([{ id: "codex", name: "Codex" }])).toContain("Never present a record from another app as the answer");
  expect(appFocusInstruction([])).toBe("");
});

test("an empty window names the closest same-day record and only the named app's import status", () => {
  const morning = chatTimeWindow("what did I say to Codex this morning?", now)!;
  const apps = [
    { id: "codex", name: "Codex", enabled: true, status: "idle", progress: { hasMore: true, remaining: 220 } },
    { id: "claude", name: "Claude", enabled: true, status: "idle", progress: { hasMore: true, remaining: 1186 } },
  ];
  const nothing = timeWindowCoverage(morning, 0, apps, { app: "Codex", closest: "13:30 Codex session" });
  expect(nothing.footer).toBe("No imported Codex records fall inside this morning (18 Sep 2026, 04:00–13:00). Closest today: 13:30 Codex session. Codex import is still pending: 220 Codex files remaining. Open Memory and sync Codex again.");
  expect(nothing.instruction).toContain("No imported Codex record falls inside that window");
  expect(nothing.instruction).toContain("nearest same-day record (the 13:30 Codex session)");
  expect(nothing.pending).toEqual([{ id: "codex", name: "Codex", remaining: 220 }]);
  const complete = timeWindowCoverage(morning, 0, apps.slice(1), { app: "Codex" });
  expect(complete.footer).toBe("No imported Codex records fall inside this morning (18 Sep 2026, 04:00–13:00). Codex is fully imported, so nothing else from that window was saved.");
  const found = timeWindowCoverage(morning, 1, apps, { app: "Codex" });
  expect(found.instruction).toContain("1 retrieved Codex source falls inside that window");
  expect(found.footer).toBe("More from this morning (18 Sep 2026, 04:00–13:00) may exist. Codex import is still pending: 220 Codex files remaining. Open Memory and sync Codex again.");
});

import { buildChatChecked, chatCheckedSummary, inheritRetrievalContext, isFollowUpQuestion } from "../src/lib/chat-retrieval-routing";

test("a short follow-up inherits the previous question's window and swaps or keeps the app", () => {
  const asked = new Date(2026, 8, 18, 13, 45);
  const morning = chatTimeWindow("what did I say to Codex this morning?", asked)!;
  const previous = ["what did I say to Codex this morning?"];
  for (const request of ["How about Claude?", "and Codex?", "what about yesterday's?", "Claude?", "same for Hermes", "ok and Notion"]) expect(isFollowUpQuestion(request)).toBe(true);
  for (const request of ["What is our churn rate?", "Find the Granola meeting with Sam", "Summarise the Granola meeting with Sam about the sponsorship deck", "Remember: buy milk"]) expect(isFollowUpQuestion(request)).toBe(false);
  expect(inheritRetrievalContext("How about Claude?", previous, asked)).toEqual({ window: morning, focus: [{ id: "claude", name: "Claude" }], inherited: true });
  const yesterday = inheritRetrievalContext("what about yesterday's?", previous, asked);
  expect(yesterday.window).toEqual(chatTimeWindow("yesterday", asked));
  expect(yesterday.focus).toEqual([{ id: "codex", name: "Codex" }]);
  expect(yesterday.inherited).toBe(true);
  // A chain of follow-ups still reaches the question that set the window.
  expect(inheritRetrievalContext("and Hermes?", ["How about Claude?", ...previous], asked)).toEqual({ window: morning, focus: [{ id: "hermes", name: "Hermes" }], inherited: true });
  // A full question starts over; a follow-up with nothing to inherit stays plain; one that names date and app needs nothing.
  expect(inheritRetrievalContext("What is our churn rate?", previous, asked)).toEqual({ window: null, focus: [], inherited: false });
  expect(inheritRetrievalContext("How about Claude?", ["What is our churn rate?"], asked)).toEqual({ window: null, focus: [{ id: "claude", name: "Claude" }], inherited: false });
  expect(inheritRetrievalContext("How about Claude?", [], asked).inherited).toBe(false);
  expect(inheritRetrievalContext("and Claude yesterday?", previous, asked)).toMatchObject({ focus: [{ id: "claude", name: "Claude" }], inherited: false });
});

test("the Checked line counts each app's records and matches, names the window and the pending imports", () => {
  const results = [
    { title: "Claude · 8f2c", origin: "claude", connector: { provider: "claude" } },
    { title: "Claude · 9a1d", origin: "claude", connector: { provider: "claude" } },
    { title: "Codex · rollout-2026-09-18T12-31-08-abc", origin: "codex", connector: { provider: "codex" } },
    { title: "Pricing notes", origin: "manual" },
  ];
  const apps = [
    { id: "codex", name: "Codex", enabled: true, status: "idle", progress: { hasMore: true, remaining: 301 } },
    { id: "claude", name: "Claude", enabled: true, status: "idle", progress: { hasMore: false, remaining: 0 } },
    { id: "hermes", name: "Hermes", enabled: false, status: "idle", progress: { hasMore: true, remaining: 9 } },
  ];
  const morning = chatTimeWindow("this morning", now)!;
  const checked = buildChatChecked(results, { claude: 412, codex: 88, granola: 12 }, apps, [{ id: "claude", name: "Claude" }], morning);
  expect(checked.apps).toEqual([
    { id: "claude", name: "Claude", records: 412, matched: 2, remaining: 0 },
    { id: "codex", name: "Codex", records: 88, matched: 1, remaining: 301 },
    { id: "granola", name: "Granola", records: 12, matched: 0, remaining: 0 },
  ]);
  expect(checked).toMatchObject({ matched: 4, window: morning.label, focus: ["Claude"], importing: [{ id: "codex", name: "Codex", remaining: 301 }] });
  expect(chatCheckedSummary(checked)).toBe(`Checked Claude 2/412, Codex 1/88, Granola 0/12 · ${morning.label} · Codex still importing`);
  const bare = buildChatChecked([], {}, [], [], null);
  expect(bare).toEqual({ apps: [], matched: 0, focus: [], importing: [] });
  expect(chatCheckedSummary(bare)).toBe("Checked memory");
});
