import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInboxSorter } from "./jev-inbox";
import type { JevDecideRequest, JevDecision } from "../src/lib/jev-types";
const roots: string[] = []; afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const temp = () => { const r = mkdtempSync(join(tmpdir(), "jev-inbox-")); roots.push(r); return r; };
const d: JevDecision = { id: "test", at: "", surface: "inbox", purpose: "Sort", input: "Saved mail", answers: { needs_reply: { type: "noul", noul: 0.9 }, urgency: { type: "score", score: 2, probabilities: { "0": 0, "1": 0.1, "2": 0.9, "3": 0 }, confidence: 0.9 } }, picked: "reply-today", escalated: false, costUsd: 0.00002, ms: 300 };
test("sends only sender, subject and 500 body characters, caches by id and content", async () => {
  const root = temp(); const requests: JevDecideRequest[] = [];
  const sorter = createInboxSorter(root, async req => { requests.push(req); return d; });
  const message = { id: "synthetic-id", from: "sample@example.test", subject: "Please review", body: "a".repeat(500) + "NEVER SEND THIS TAIL", attachment: "secret" };
  const row = await sorter.sort(message); await sorter.sort(message);
  expect(requests).toHaveLength(1); expect(Object.keys(requests[0].state as object)).toEqual(["sender", "subject", "body"]); expect((requests[0].state as any).body.length).toBe(500); expect(row.needsReply).toBe(0.9);
  const disk = readFileSync(join(root, ".operator-data/jev/inbox-labels.jsonl"), "utf8"); expect(disk).not.toContain(message.from); expect(disk).not.toContain(message.body);
  await sorter.sort({ ...message, subject: "Changed subject" }); expect(requests).toHaveLength(2); expect(sorter.labels()).toHaveLength(1);
});
test("provider errors never save an invented label", async () => {
  const sorter = createInboxSorter(temp(), async () => ({ ...d, error: "Jev HTTP 503" }));
  await expect(sorter.sort({ id: "fake", from: "a", subject: "b", body: "c" })).rejects.toThrow("Jev HTTP 503"); expect(sorter.labels()).toHaveLength(0);
});
test("concurrent repeats of a message share a single call", async () => {
  let calls = 0; const sorter = createInboxSorter(temp(), async () => { calls++; return d; }); const message = { id: "same", from: "a", subject: "b", body: "c" };
  await Promise.all([sorter.sort(message), sorter.sort(message)]); expect(calls).toBe(1);
});
