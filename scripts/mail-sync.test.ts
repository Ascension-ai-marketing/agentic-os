import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mailArchive } from "./mail-archive";
import { createMailSync } from "./mail-sync";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture(request: (provider: string, path: string) => Promise<any>) {
  const root = mkdtempSync(join(tmpdir(), "mail-sync-")), archive = mailArchive(root);
  cleanup.push(() => { archive.close(); rmSync(root, { recursive: true, force: true }); });
  const options = { root, archive, identity: async () => "owner@example.com", request };
  return { root, archive, options, sync: createMailSync(options) };
}
const gmail = (id: string, body = "Original body " + id) => ({ id, internalDate: "1609459200000", payload: { mimeType: "text/plain", body: { data: Buffer.from(body).toString("base64url") } } });
test("resumes saved Gmail IDs as metadata, preserves stored bodies and never downloads attachments", async () => {
  const calls: string[] = [];
  const f = fixture(async (_p, path) => {
    calls.push(path);
    if (path.startsWith("/messages?")) { expect(path).toContain("pageToken=next-page"); return { messages: [{ id: "c" }] }; }
    expect(path).toContain("format=metadata");
    if (path.startsWith("/messages/b?")) return { ...gmail("b"), snippet: "external searchable preview", payload: { mimeType: "text/plain", body: { attachmentId: "external" } } };
    return gmail("c");
  });
  f.archive.import("gmail", "owner@example.com", [gmail("a")]);
  const stage = join(f.root, ".operator-data/mail-staging"); mkdirSync(join(stage, "gmail-ids"), { recursive: true });
  writeFileSync(join(stage, "gmail-ids/000000.json"), JSON.stringify({ message_ids: ["a", "b"] }));
  writeFileSync(join(stage, "gmail-enumeration-progress.json"), JSON.stringify({ next_page_token: "next-page", complete: false }));
  expect(calls).toHaveLength(0);
  await f.sync.start("gmail"); await f.sync.idle();
  expect(f.archive.stats().total).toBe(3); expect(f.archive.search("external").total).toBe(1);
  expect(f.archive.stats().fullBodies).toBe(1); expect(f.archive.stats().metadata).toBe(2);
  expect(calls.some(path => path.includes("/attachments/") || path.includes("format=full"))).toBe(false);
  expect(calls.some(path => path.startsWith("/messages/a?"))).toBe(false);
  expect(f.sync.status().jobs[0].status).toBe("complete");
  expect(JSON.stringify(f.sync.status())).not.toContain("searchable body");
  expect(f.archive.stats().accounts[0].status).toBe("complete"); f.sync.close();
});
test("malformed Gmail listings cannot mark an incomplete index complete", async () => {
  const f = fixture(async () => ({}));
  await f.sync.start("gmail"); await f.sync.idle();
  expect(f.sync.status().active).toBe(false);
  expect(f.sync.status().jobs[0].status).toBe("needs-attention");
  expect(f.archive.stats().accounts[0].status).toBe("needs-attention");
  f.sync.close();
});
test("concurrent start reserves identity verification and an empty index can be restarted", async () => {
  let identities = 0, listings = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async () => { listings++; return { resultSizeEstimate: 0 }; });
  const sync = createMailSync({ ...f.options, identity: async () => { identities++; await gate; return "owner@example.com"; } });
  const first = sync.start("gmail"), second = sync.start("gmail");
  release(); await Promise.all([first, second]); await sync.idle();
  expect(identities).toBe(1); expect(listings).toBe(1); expect(sync.status().active).toBe(false);
  await sync.start("gmail"); await sync.idle(); expect(listings).toBe(2); sync.close();
});
test("metadata requests stay at most four in flight", async () => {
  let active = 0, maximum = 0;
  const f = fixture(async (_provider, path) => {
    if (path.startsWith("/messages?")) return { messages: Array.from({ length: 11 }, (_, i) => ({ id: String(i) })) };
    active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--;
    return gmail(decodeURIComponent(path.split("/messages/")[1].split("?")[0]));
  });
  await f.sync.start("gmail"); await f.sync.idle();
  expect(maximum).toBe(4); expect(f.archive.stats().metadata).toBe(11); f.sync.close();
});
test("missing authorization persists a blocked status for preserved legacy mail", async () => {
  const f = fixture(async () => { throw new Error("Unexpected network call"); });
  f.archive.import("gmail", "owner@example.com", [gmail("legacy")]);
  const sync = createMailSync({ ...f.options, identity: async () => { throw new Error("Connect Gmail in Connections."); } });
  await expect(sync.start("gmail")).rejects.toThrow("Connect Gmail");
  expect(f.archive.stats().accounts[0]).toMatchObject({ status: "needs-attention", count: 1 });
  sync.close();
});
test("closing during a request preserves pending IDs and restart never refetches committed metadata", async () => {
  let release!: () => void, began!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { began = resolve; });
  const f = fixture(async (_provider, path) => {
    if (path.startsWith("/messages?")) return { messages: [{ id: "a" }] };
    began(); await gate; return gmail("a");
  });
  await f.sync.start("gmail"); await requested; f.sync.close(); f.sync.close();
  expect(f.archive.stats().accounts[0].status).toBe("paused");
  release(); await f.sync.idle(); expect(f.archive.stats().total).toBe(0);
  // Simulate a commit that reached SQLite before its JSON checkpoint was written.
  f.archive.importMetadata("gmail", "owner@example.com", [gmail("a")]);
  let requests = 0;
  const resumed = createMailSync({ ...f.options, request: async () => { requests++; throw new Error("Should not refetch"); } });
  await resumed.start("gmail"); await resumed.idle();
  expect(requests).toBe(0); expect(resumed.status().jobs[0].status).toBe("complete"); resumed.close();
});
test("failed batches retain pending IDs and a resumed process deduplicates completed pages", async () => {
  let fail = true, bodyReads = 0;
  const f = fixture(async (_p, path) => {
    if (path.startsWith("/messages?")) return { messages: [{ id: "a" }, { id: "b" }] };
    bodyReads++; if (path.startsWith("/messages/b?") && fail) throw new Error("Provider returned HTTP 429. Resume later.");
    return gmail(path.startsWith("/messages/a?") ? "a" : "b");
  });
  await f.sync.start("gmail"); await f.sync.idle(); expect(f.archive.stats().total).toBe(0);
  expect(f.sync.status().jobs[0].status).toBe("needs-attention"); expect(f.sync.status().jobs[0].pending).toBe(2);
  f.sync.close(); fail = false;
  const resumed = createMailSync(f.options); await resumed.start("gmail"); await resumed.idle();
  expect(f.archive.stats().total).toBe(2); expect(bodyReads).toBe(4); resumed.close();
});
test("Outlook ID-only enumeration skips existing bodies and rejects repeating pagination", async () => {
  let reads = 0;
  const f = fixture(async (_p, path) => {
    if (path.startsWith("/messages/")) { reads++; return { id: "b", receivedDateTime: "2020-01-01T00:00:00Z", body: { content: "Outlook original" } }; }
    if (path === "cursor-b") return { value: [], "@odata.nextLink": "cursor-a" };
    if (path === "cursor-a") return { value: [], "@odata.nextLink": "cursor-b" };
    return { value: [{ id: "a" }, { id: "b" }], "@odata.nextLink": "cursor-a" };
  });
  f.archive.import("outlook", "owner@example.com", [{ id: "a", receivedDateTime: "2019-01-01T00:00:00Z", body: { content: "Existing" } }]);
  await f.sync.start("outlook"); await f.sync.idle();
  expect(reads).toBe(1); expect(f.archive.stats().total).toBe(2); expect(f.sync.status().jobs[0].status).toBe("needs-attention"); f.sync.close();
});
test("missing local OAuth makes no provider requests and interrupted state is paused on restart", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return {}; });
  const blocked = createMailSync({ ...f.options, identity: async () => { throw new Error("Connect Gmail in Settings"); } });
  await expect(blocked.start("gmail")).rejects.toThrow("Connect Gmail"); expect(calls).toBe(0); blocked.close();
  writeFileSync(join(f.root, ".operator-data/mail-sync.json"), JSON.stringify({ gmail: { provider: "gmail", account: "owner@example.com", status: "running", cursor: null, visited: [], pending: ["a"], downloaded: 0, stored: 0, enumerated: 1, exhausted: true, updatedAt: new Date().toISOString() } }));
  const restarted = createMailSync(f.options); expect(restarted.status().jobs[0].status).toBe("paused");
  expect(JSON.parse(readFileSync(join(f.root, ".operator-data/mail-sync.json"), "utf8")).gmail.status).toBe("paused"); restarted.close();
});
