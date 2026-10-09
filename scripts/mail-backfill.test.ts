import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfillEstimate, mailBackfill } from "./mail-backfill";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));
const root = () => {
  const p = mkdtempSync(join(tmpdir(), "mail-backfill-"));
  roots.push(p);
  return p;
};
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

function fakeArchive() {
  const rows = new Map<string, any>();
  return {
    rows,
    importMetadata(provider: string, account: string, raw: any[]) {
      if (raw.length > 100) throw new Error("batch too big");
      for (const m of raw) rows.set(`${provider}:${m.id}`, { provider, account });
      return raw;
    },
    stats() {
      const counts = new Map<string, any>();
      for (const r of rows.values()) {
        const key = `${r.provider}:${r.account}`;
        counts.set(key, { provider: r.provider, account: r.account, count: (counts.get(key)?.count || 0) + 1 });
      }
      return { accounts: [...counts.values()] };
    },
  } as any;
}

const NOW = Date.parse("2026-09-28T12:00:00Z");
const query = (path: string) => new URLSearchParams(path.split("?")[1] || "");
const seed = (dir: string, store: unknown) => { mkdirSync(join(dir, ".operator-data"), { recursive: true }); writeFileSync(join(dir, ".operator-data", "mail-backfill.json"), JSON.stringify(store)); };
const LINK = "https://graph.microsoft.com/v1.0/me/messages?$skip=";
/** A Graph mailbox that pages by next link, 100 rows at a time. */
const outlookPages = (all: any[], paths: string[] = []) => async (_provider: string, path: string) => {
  paths.push(path);
  const skip = path.startsWith(LINK) ? Number(path.slice(LINK.length)) : 0;
  return { value: all.slice(skip, skip + 100), ...(skip + 100 < all.length ? { "@odata.nextLink": LINK + (skip + 100) } : {}) };
};

test("gmail pages through a year with page tokens, headers only, then catches up", async () => {
  const archive = fakeArchive();
  const lists: URLSearchParams[] = [];
  // 250 messages, one every day going back.
  const all = Array.from({ length: 250 }, (_, i) => ({ id: `g${i}`, threadId: `t${i}`, internalDate: String(NOW - i * 864e5), labelIds: ["INBOX"], snippet: "hello", payload: { headers: [{ name: "Subject", value: `Message ${i}` }], body: { data: "c2VjcmV0" } } }));
  const seen: any[] = [];
  const base = archive.importMetadata;
  archive.importMetadata = ((provider: string, account: string, raw: any[]) => { seen.push(...raw); return base(provider, account, raw); }) as any;
  const request = async (_provider: string, path: string) => {
    if (!path.startsWith("/messages?")) return all.find((m) => m.id === path.split("/")[2].split("?")[0]);
    const q = query(path);
    lists.push(q);
    const start = Number(q.get("pageToken") || 0);
    return { messages: all.slice(start, start + 100).map((m) => ({ id: m.id })), ...(start + 100 < all.length ? { nextPageToken: String(start + 100) } : {}) };
  };
  const backfill = mailBackfill(root(), { archive, identity: async () => "me@x.io", request, now: () => NOW });
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done");
  const s = backfill.status().gmail!;
  expect(s.imported).toBe(250);
  expect(s.cursor).toBeUndefined();
  expect(lists).toHaveLength(3);
  expect(lists[0].get("q")).toContain("after:2025/");
  expect(lists[0].get("maxResults")).toBe("100");
  expect(JSON.stringify(seen)).not.toContain("c2VjcmV0");
  // A second run only reads from the newest message it already holds.
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done" && lists.length > 3);
  expect(lists[3].get("q")).toContain("after:2026/09/26");
  expect(backfill.status().gmail!.imported).toBe(250);
});

test("outlook follows the next link, stops at the start of the window and never keeps bodies", async () => {
  const archive = fakeArchive();
  const seen: any[] = [];
  archive.importMetadata = ((provider: string, account: string, raw: any[]) => {
    seen.push(...raw);
    for (const m of raw) archive.rows.set(`${provider}:${m.id}`, { provider, account });
    return raw;
  }) as any;
  const all = Array.from({ length: 150 }, (_, i) => ({ id: `o${i}`, subject: "Hi", body: { content: "secret body" }, receivedDateTime: new Date(NOW - i * 5 * 864e5).toISOString() }));
  const paths: string[] = [];
  const backfill = mailBackfill(root(), { archive, identity: async () => "me@outlook.com", request: outlookPages(all, paths), now: () => NOW, months: 12 });
  backfill.start(["outlook"]);
  await until(() => backfill.status().outlook?.status === "done");
  // 12 months at one message every five days is about 74 messages.
  expect(backfill.status().outlook!.imported).toBeGreaterThan(70);
  expect(backfill.status().outlook!.imported).toBeLessThan(80);
  expect(query(paths[0]).get("$top")).toBe("100");
  // The window ended on the first page, so the next link is never followed.
  expect(paths).toHaveLength(1);
  expect(JSON.stringify(seen)).not.toContain("secret body");
});

test("a numeric outlook cursor left by the old reader is discarded, not sent to the provider", async () => {
  const dir = root();
  seed(dir, { outlook: { account: "me@outlook.com", since: new Date(NOW - 366 * 864e5).toISOString(), status: "waiting", imported: 300, cursor: 300 } });
  const paths: string[] = [];
  const backfill = mailBackfill(dir, { archive: fakeArchive(), identity: async () => "me@outlook.com", request: outlookPages([], paths), now: () => NOW });
  backfill.start(["outlook"]);
  await until(() => backfill.status().outlook?.status === "done");
  expect(paths).toHaveLength(1);
  expect(paths[0].startsWith("/messages?")).toBe(true);
  expect(paths[0]).not.toContain("300");
});

/** A Gmail mailbox with no messages that records each list request. */
const emptyGmail = (lists: URLSearchParams[]) => async (_provider: string, path: string) => { lists.push(query(path)); return { resultSizeEstimate: 0 }; };
test("a gmail page token left by the old reader is discarded, not sent to the provider", async () => {
  const dir = root();
  seed(dir, { gmail: { account: "me@x.io", since: new Date(NOW - 366 * 864e5).toISOString(), status: "error", imported: 400, cursor: "old-reader-token", error: "Gmail is not signed in to Codex." } });
  const lists: URLSearchParams[] = [];
  const backfill = mailBackfill(dir, { archive: fakeArchive(), identity: async () => "me@x.io", request: emptyGmail(lists), now: () => NOW });
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done");
  expect(lists).toHaveLength(1);
  expect(lists[0].has("pageToken")).toBe(false);
});
test("a gmail page token this reader saved is sent when the import resumes", async () => {
  const dir = root();
  seed(dir, { gmail: { account: "me@x.io", since: new Date(NOW - 366 * 864e5).toISOString(), status: "waiting", imported: 100, cursor: "100", cursorFrom: "account" } });
  const lists: URLSearchParams[] = [];
  const backfill = mailBackfill(dir, { archive: fakeArchive(), identity: async () => "me@x.io", request: emptyGmail(lists), now: () => NOW });
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done");
  expect(lists[0].get("pageToken")).toBe("100");
});

test("a saved outlook next link resumes where the last session stopped", async () => {
  const dir = root();
  seed(dir, { outlook: { account: "me@outlook.com", since: new Date(NOW - 366 * 864e5).toISOString(), status: "waiting", imported: 100, cursor: LINK + "100", cursorFrom: "account" } });
  const all = Array.from({ length: 150 }, (_, i) => ({ id: `r${i}`, receivedDateTime: new Date(NOW - i * 864e5).toISOString() }));
  const paths: string[] = [];
  const backfill = mailBackfill(dir, { archive: fakeArchive(), identity: async () => "me@outlook.com", request: outlookPages(all, paths), now: () => NOW });
  backfill.start(["outlook"]);
  await until(() => backfill.status().outlook?.status === "done");
  expect(paths).toEqual([LINK + "100"]);
});

test("a different signed-in account stops the import with a plain reason", async () => {
  const r = root();
  const archive = fakeArchive();
  let email = "one@x.io";
  const options = { archive, identity: async () => email, request: async () => ({ resultSizeEstimate: 0 }), now: () => NOW };
  const backfill = mailBackfill(r, options);
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done");
  email = "two@x.io";
  const again = mailBackfill(r, options);
  again.start(["gmail"]);
  await until(() => again.status().gmail?.status !== "running");
  expect(again.status().gmail!.status).toBe("error");
  expect(again.status().gmail!.error).toContain("different account");
});

test("a mailbox that is not connected reports the in-app connection message", async () => {
  const backfill = mailBackfill(root(), { archive: fakeArchive(), identity: async () => { throw new Error("Connect Gmail in Settings → Connections to search and index email directly on this computer."); }, request: async () => ({}), now: () => NOW });
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status !== "running");
  expect(backfill.status().gmail!.status).toBe("error");
  expect(backfill.status().gmail!.error).toMatch(/Connect Gmail/);
  expect(backfill.status().gmail!.error).not.toMatch(/Codex/);
});

test("the estimate scales by how much of the year is covered", () => {
  const since = new Date(NOW - 365 * 864e5).toISOString();
  expect(backfillEstimate(1000, since, new Date(NOW - 36.5 * 864e5).toISOString(), NOW)).toBe(10000);
  expect(backfillEstimate(0, since, undefined, NOW)).toBeUndefined();
});

test("a draft on a page does not end the outlook history early", async () => {
  const archive = fakeArchive();
  const all = Array.from({ length: 150 }, (_, i) => ({ id: `d${i}`, subject: "Hi", isDraft: i % 10 === 0, receivedDateTime: new Date(NOW - i * 5 * 864e5).toISOString() }));
  const backfill = mailBackfill(root(), { archive, identity: async () => "me@outlook.com", request: outlookPages(all), now: () => NOW, months: 12 });
  backfill.start(["outlook"]);
  await until(() => backfill.status().outlook?.status === "done");
  // About 74 messages in the year, minus one draft in ten.
  expect(backfill.status().outlook!.imported).toBeGreaterThan(60);
});
