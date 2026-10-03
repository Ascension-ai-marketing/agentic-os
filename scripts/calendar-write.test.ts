import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calendarWriter } from "./calendar-write";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const draft = { provider: "google", calendarId: "primary", title: "Review", start: "2026-09-18T10:00:00+04:00", end: "2026-09-18T11:00:00+04:00", timeZone: "Asia/Dubai", attendees: ["guest@example.com"] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "calendar-review-")); roots.push(root);
  let email = "owner@example.com", scopes = ["https://www.googleapis.com/auth/calendar", "Calendars.ReadWrite"], now = Date.now();
  const calls: any[] = []; let fail = false;
  let onPost = async () => {};
  const settings = { root, now: () => now, identity: () => ({ connected: true, email, grantedScopes: scopes }), request: async (provider: string, path: string, method: string, payload?: any) => {
    calls.push({ provider, path, method, payload });
    if (method === "POST") { await onPost(); if (fail) throw Error("synthetic timeout"); return { id: "created-event", htmlLink: "https://calendar.google.com/event" }; }
    return { id: "primary", summary: "My calendar", name: "My calendar", accessRole: "owner", canEdit: true };
  } };
  return { api: calendarWriter(settings), restart: () => calendarWriter(settings), calls, account: (value: string) => email = value, scopes: (value: string[]) => scopes = value, advance: () => now += 600001, fail: () => fail = true, post: (fn: () => Promise<void>) => onPost = fn };
}
test("prepare is read-only, immutable review includes invitations, only confirm creates once", async () => {
  const f = fixture(), review = await f.api.prepare(draft);
  expect(review.event.start).toBe("2026-09-18T06:00:00.000Z");
  expect(review).toMatchObject({ account: "owner@example.com", invitations: true, calendar: { id: "primary" } });
  expect(f.calls.every(c => c.method === "GET")).toBe(true);
  await expect(f.api.create({ provider: "google", reviewId: review.reviewId })).rejects.toThrow("Confirm");
  const body = { provider: "google", reviewId: review.reviewId, confirm: true, title: "Injected title" };
  const first = await f.api.create(body), again = await f.restart().create(body);
  expect(first.status).toBe("created"); expect(again).toEqual(first);
  const posts = f.calls.filter(c => c.method === "POST"); expect(posts).toHaveLength(1);
  expect(posts[0].payload.summary).toBe("Review");
  expect(posts[0].payload.attendees).toEqual([{ email: "guest@example.com" }]);
});
test("missing write scope, invalid times, account changes and expired review never write", async () => {
  const f = fixture();
  f.scopes(["https://www.googleapis.com/auth/calendar.readonly"]);
  await expect(f.api.prepare(draft)).rejects.toThrow("permission");
  f.scopes(["https://www.googleapis.com/auth/calendar"]);
  for (const patch of [{ start: "2026-09-18T10:00:00" }, { timeZone: undefined }, { attendees: ["bad"] }]) await expect(f.api.prepare({ ...draft, ...patch })).rejects.toThrow();
  const review = await f.api.prepare(draft), body = { provider: "google", reviewId: review.reviewId, confirm: true };
  f.account("other@example.com"); await expect(f.api.create(body)).rejects.toThrow("account changed");
  f.account("owner@example.com"); f.advance(); await expect(f.api.create(body)).rejects.toThrow("expired");
  expect(f.calls.filter(c => c.method === "POST")).toHaveLength(0);
});
test("ambiguous provider response is persisted and never retried after restart", async () => {
  const f = fixture(), review = await f.api.prepare({ ...draft, provider: "outlook" });
  f.fail(); const body = { provider: "outlook", reviewId: review.reviewId, confirm: true };
  expect((await f.api.create(body)).status).toBe("uncertain");
  expect((await f.restart().create(body)).status).toBe("uncertain");
  const posts = f.calls.filter(c => c.method === "POST"); expect(posts).toHaveLength(1);
  expect(posts[0].payload.transactionId).toBe(review.reviewId);
  expect(posts[0].payload.start).toEqual({ dateTime: "2026-09-18T06:00:00.000", timeZone: "UTC" });
});
test("same-review confirmation and prepare during a provider write preserve every review", async () => {
  const f = fixture(), review = await f.api.prepare(draft);
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  f.post(() => gate);
  const body = { provider: "google", reviewId: review.reviewId, confirm: true };
  const first = f.api.create(body), second = f.api.create(body), next = f.api.prepare({ ...draft, provider: "outlook", title: "Second review" });
  await new Promise(resolve => setTimeout(resolve, 5)); release();
  const [one, two, later] = await Promise.all([first, second, next]);
  expect(one).toEqual(two); expect(f.calls.filter(c => c.method === "POST")).toHaveLength(1);
  expect((await f.restart().create({ provider: "outlook", reviewId: later.reviewId, confirm: true })).status).toBe("created");
  expect(f.calls.filter(c => c.method === "POST")).toHaveLength(2);
});
