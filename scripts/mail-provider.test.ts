import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mailArchive } from "./mail-archive";
import { mailProvider } from "./mail-provider";
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(close => close()); });
const owner = "owner@example.com";
const gmail = (id: string, text = "fullbodykeyword") => ({ id, internalDate: "1609459200000", snippet: "previewkeyword", payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: "Mail " + id }], body: { data: Buffer.from(text).toString("base64url") } } });
function fixture(request: (provider: string, path: string, account?: string) => Promise<any>, options: Parameters<typeof mailArchive>[1] = {}) {
  const root = mkdtempSync(join(tmpdir(), "mail-provider-")), archive = mailArchive(root, options);
  cleanup.push(() => { archive.close(); rmSync(root, { recursive: true, force: true }); });
  const service = mailProvider({ archive, identity: async () => owner, request });
  return { root, archive, service };
}
test("Gmail native search indexes bounded metadata, excludes full bodies and preserves existing full mail", async () => {
  const calls: string[] = [];
  const f = fixture(async (_provider, path, account) => {
    calls.push(path); expect(account).toBe(owner);
    if (path.startsWith("/messages?")) {
      const params = new URL("https://example.test" + path).searchParams;
      expect(params.get("q")).toBe("from:someone@example.com"); expect(params.get("maxResults")).toBe("30");
      return { messages: [{ id: "old" }, { id: "new" }], nextPageToken: "later" };
    }
    expect(path).toContain("format=metadata"); return gmail(path.includes("/old?") ? "old" : "new", "SHOULD_NOT_STORE_RAW");
  });
  f.archive.import("gmail", owner, [gmail("old", "Preserved original")]);
  const result = await f.service.search("gmail", "from:someone@example.com");
  expect(result).toMatchObject({ total: 2, bounded: true, hasMore: true });
  expect(result.items.every(item => item.bodyStatus === "metadata")).toBe(true);
  expect(f.archive.stats()).toMatchObject({ fullBodies: 1, metadata: 1 });
  expect(f.archive.get(result.items[0].id)?.body).toBe("Preserved original");
  expect(f.archive.search("SHOULD_NOT_STORE_RAW").total).toBe(0);
  const db = new Database(join(f.root, ".operator-data/mail-archive.sqlite"), { readonly: true });
  expect(db.query("SELECT raw_json FROM messages WHERE remote_id='new'").get()).toEqual({ raw_json: "{}" }); db.close();
  expect(calls).toHaveLength(3);
});
test("opening a message coalesces requests, caches only its readable body and never fetches attachments", async () => {
  let reads = 0;
  const f = fixture(async (_provider, path) => { reads++; expect(path).toBe("/messages/new?format=full"); return gmail("new"); });
  const [metadata] = f.archive.importMetadata("gmail", owner, [gmail("new")]);
  const [first, second] = await Promise.all([f.service.message(metadata.id), f.service.message(metadata.id)]);
  expect(first).toEqual(second); expect(first?.body).toBe("fullbodykeyword"); expect(first?.bodyStatus).toBe("cached");
  await f.service.message(metadata.id); expect(reads).toBe(1);
  expect(f.archive.stats()).toMatchObject({ fullBodies: 0, metadata: 1, cache: { count: 1 } });
  expect(f.archive.search("fullbodykeyword").total).toBe(0);
  expect(f.archive.search("previewkeyword").total).toBe(1);
  f.archive.import("gmail", owner, [gmail("new", "Preserved legacy body")]);
  expect((await f.service.message(metadata.id))?.body).toBe("Preserved legacy body");
  expect(reads).toBe(1);
});
test("cache enforces byte budget and expiry without deleting legacy mail or metadata", async () => {
  let time = 1000;
  const f = fixture(async () => ({}), { cacheBudgetBytes: 2200, cacheTtlMs: 100, now: () => time });
  f.archive.import("gmail", owner, [gmail("legacy", "Legacy original")]);
  const entries = f.archive.importMetadata("gmail", owner, [gmail("a"), gmail("b"), gmail("c")]);
  for (const entry of entries) { f.archive.cacheBody("gmail", owner, gmail(entry.remoteId!, "x".repeat(500))); time++; }
  expect(f.archive.stats().cache.bytes).toBeLessThanOrEqual(2200);
  expect(f.archive.stats().cache.count).toBeLessThan(3);
  expect(f.archive.get(entries[0].id)?.bodyStatus).toBe("metadata");
  expect(f.archive.get(entries[2].id)?.bodyStatus).toBe("cached");
  time += 101;
  expect(f.archive.stats().cache.count).toBe(0); expect(f.archive.stats().total).toBe(4);
  expect(f.archive.search("Legacy original").total).toBe(1);
  expect(() => f.archive.cacheBody("gmail", owner, gmail("a", "x".repeat(4000)))).toThrow("budget");
});
test("Outlook search sends native search plus metadata projection and clamps its result cap", async () => {
  const f = fixture(async (_provider, path) => {
    const params = new URL("https://example.test" + path).searchParams;
    expect(params.get("$search")).toBe(JSON.stringify('quarterly "review"')); expect(params.get("$top")).toBe("50");
    expect(params.get("$select")?.split(",")).not.toContain("body");
    return { value: [{ id: "outlook", receivedDateTime: "2020-01-01T00:00:00Z", bodyPreview: "preview", body: { content: "omitted full content" } }] };
  });
  const result = await f.service.search("outlook", 'quarterly "review"', 5000);
  expect(result.items[0].body).toBe("preview"); expect(result).toMatchObject({ total: 1, bounded: true, hasMore: false });
});
test("missing OAuth and wrong accounts cannot fetch a body; arbitrary IDs and URLs are never requested", async () => {
  let requests = 0;
  const f = fixture(async () => { requests++; return {}; });
  const [metadata] = f.archive.importMetadata("gmail", owner, [gmail("new")]);
  const blocked = mailProvider({ archive: f.archive, identity: async () => { throw new Error("Connect Gmail"); }, request: async () => { requests++; return {}; } });
  await expect(blocked.search("gmail", "query")).rejects.toThrow("Connect Gmail");
  await expect(blocked.message(metadata.id)).rejects.toThrow("Connect Gmail");
  const wrong = mailProvider({ archive: f.archive, identity: async () => "other@example.com", request: async () => { requests++; return {}; } });
  await expect(wrong.message(metadata.id)).rejects.toThrow("owns this email");
  expect(await f.service.message("https://example.test/steal")).toBeUndefined(); expect(requests).toBe(0);
});
test("missing and external message bodies fail without falling back to a misleading cached preview", async () => {
  let external = false, calls = 0;
  const f = fixture(async () => { calls++; return external ? { ...gmail("new"), payload: { mimeType: "text/plain", body: { attachmentId: "external" } } } : { id: "new" }; });
  const [metadata] = f.archive.importMetadata("gmail", owner, [gmail("new")]);
  await expect(f.service.message(metadata.id)).rejects.toThrow("omitted"); external = true;
  await expect(f.service.message(metadata.id)).rejects.toThrow("external text body");
  expect(calls).toBe(2); expect(f.archive.stats().cache.count).toBe(0);
});
