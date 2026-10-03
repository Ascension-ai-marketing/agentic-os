import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { etaSeconds, replyOutbox, type OutboxItem } from "./reply-outbox";

const commentId = "UgzFirstComment0000AaABAg", otherId = "UgzOtherComment0000AaABAg";

test("clicks queue replies and the worker sends them one at a time with a gap, newest click replacing a waiting one", async () => {
  const root = mkdtempSync(join(tmpdir(), "outbox-"));
  let clock = Date.parse("2026-09-19T12:00:00Z");
  const sent: string[] = [];
  const outbox = replyOutbox(root, {
    youtube: async item => { sent.push(`${item.targetId}:${item.content}:${item.id}`); return { status: "sent", messageId: "m1" }; },
  }, { now: () => clock, jitterMs: 0, paceMs: { youtube: 8000 } });
  const first = outbox.enqueue({ source: "youtube", targetId: commentId, content: "First", name: "Sam" });
  expect(first.status).toBe("queued");
  // The first click starts sending at once; a second click on the same card while it sends is refused.
  expect(() => outbox.enqueue({ source: "youtube", targetId: commentId, content: "Too fast", name: "Sam" })).toThrow(/being sent right now/);
  const early = outbox.enqueue({ source: "youtube", targetId: otherId, content: "Second", name: "Alex" });
  const second = outbox.enqueue({ source: "youtube", targetId: otherId, content: "Second, better", name: "Alex" });
  await new Promise(r => setTimeout(r, 20));
  let status = outbox.status();
  expect(status.items.find(i => i.id === first.id)?.status).toBe("sent");
  expect(status.items.find(i => i.id === early.id)?.status).toBe("cancelled");
  expect(status.items.find(i => i.id === second.id)?.status).toBe("queued");
  expect(sent).toEqual([`${commentId}:First:${first.id}`]);
  // Too soon for the second one.
  await outbox.tick();
  expect(outbox.status().items.find(i => i.id === second.id)?.status).toBe("queued");
  expect(etaSeconds(outbox.status().items as OutboxItem[], second.id, { youtube: 8 }, outbox.status().lastSentAt, clock)).toBe(8);
  clock += 8000;
  await outbox.tick();
  status = outbox.status();
  expect(status.items.find(i => i.id === second.id)?.status).toBe("sent");
  expect(sent).toHaveLength(2);
  expect(status.counts).toMatchObject({ queued: 0, sending: 0, sent: 2 });
});

test("a rate limit puts the reply back in line, a real failure stops it, and pause holds everything", async () => {
  const root = mkdtempSync(join(tmpdir(), "outbox-"));
  let clock = Date.parse("2026-09-19T12:00:00Z");
  let mode: "limit" | "fail" | "ok" = "limit";
  const outbox = replyOutbox(root, {
    youtube: async () => mode === "limit" ? { status: "failed", error: "YouTube declined this reply because its quota was reached.", retryable: true } : mode === "fail" ? { status: "failed", error: "YouTube declined this reply.", retryable: true } : { status: "sent" },
  }, { now: () => clock, jitterMs: 0 });
  const item = outbox.enqueue({ source: "youtube", targetId: commentId, content: "Hello", name: "Sam" });
  await new Promise(r => setTimeout(r, 20));
  let entry = outbox.status().items.find(i => i.id === item.id)!;
  expect(entry.status).toBe("queued");
  expect(entry.attempts).toBe(1);
  expect(entry.notBefore).toBeTruthy();
  await outbox.tick();
  expect(outbox.status().items.find(i => i.id === item.id)?.attempts).toBe(1);
  clock += 91000;
  mode = "fail";
  await outbox.tick();
  entry = outbox.status().items.find(i => i.id === item.id)!;
  expect(entry.status).toBe("failed");
  expect(entry.error).toBe("YouTube declined this reply.");
  mode = "ok";
  outbox.pause({ paused: true });
  const held = outbox.enqueue({ source: "youtube", targetId: "UgzHeldComment000000AaABAg", content: "Hi", name: "Viewer" });
  await new Promise(r => setTimeout(r, 20));
  expect(outbox.status().items.find(i => i.id === held.id)?.status).toBe("queued");
  outbox.pause({ paused: false });
  await new Promise(r => setTimeout(r, 20));
  expect(outbox.status().items.find(i => i.id === held.id)?.status).toBe("sent");
  expect(() => outbox.cancel({ id: held.id })).toThrow(/already finished/);
});

test("an item caught mid-send by a restart is settled from the sender's record, never re-sent", () => {
  const root = mkdtempSync(join(tmpdir(), "outbox-"));
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  const stuck = { id: "11111111-1111-4111-8111-111111111111", source: "youtube", targetId: commentId, name: "Sam", content: "Hi", queuedAt: "2026-09-19T11:00:00Z", status: "sending", attempts: 1 };
  writeFileSync(join(root, ".operator-data", "reply-outbox.json"), JSON.stringify({ version: 1, paused: false, items: [stuck, { ...stuck, id: "22222222-2222-4222-8222-222222222222", targetId: otherId }], lastSentAt: {} }));
  let sends = 0;
  const outbox = replyOutbox(root, { youtube: async () => { sends++; return { status: "sent" }; } }, { jitterMs: 0, resolvePending: item => item.id.startsWith("1") ? "sent" : undefined });
  const items = outbox.status().items;
  expect(items.find(i => i.id.startsWith("1"))?.status).toBe("sent");
  expect(items.find(i => i.id.startsWith("2"))).toMatchObject({ status: "uncertain" });
  expect(sends).toBe(0);
  expect(JSON.parse(readFileSync(join(root, ".operator-data", "reply-outbox.json"), "utf8")).items).toHaveLength(2);
});

test("saved entries for a channel this edition does not send to are ignored", () => {
  const root = mkdtempSync(join(tmpdir(), "outbox-"));
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  const known = { id: "33333333-3333-4333-8333-333333333333", source: "youtube", targetId: commentId, name: "Viewer", content: "Hi", queuedAt: "2026-09-19T11:00:00Z", status: "sent", attempts: 1 };
  const unknown = { ...known, id: "44444444-4444-4444-8444-444444444444", source: "forum" };
  writeFileSync(join(root, ".operator-data", "reply-outbox.json"), JSON.stringify({ version: 1, paused: false, items: [known, unknown], lastSentAt: { forum: "2026-09-19T11:00:00Z" } }));
  const outbox = replyOutbox(root, { youtube: async () => ({ status: "sent" }) }, { jitterMs: 0 });
  const status = outbox.status();
  expect(status.items.map(i => i.id)).toEqual([known.id]);
  expect(status.lastSentAt).toEqual({});
  expect(() => outbox.enqueue({ source: "forum", targetId: commentId, content: "Hi", name: "Viewer" })).toThrow(/Choose where this reply goes/);
});
