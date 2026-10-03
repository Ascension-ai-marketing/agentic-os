import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
const tool = (email: string) => ({ name: "x", annotations: { readOnlyHint: true }, _meta: { link_owner_profile: { email } } });

test("gmail pages through a year with page tokens, headers only, then catches up", async () => {
  const archive = fakeArchive();
  const calls: any[] = [];
  // 250 messages, one every day going back.
  const all = Array.from({ length: 250 }, (_, i) => ({
    id: `g${i}`,
    thread_id: `t${i}`,
    from_: "Ana <a@x.io>",
    to: ["me@x.io"],
    subject: `Message ${i}`,
    snippet: "hello",
    labels: ["INBOX"],
    email_ts: new Date(NOW - i * 864e5).toISOString(),
  }));
  const connectedRead = (async (_root: string, work: any) =>
    work({
      tools: { "gmail.search_emails": tool("me@x.io") },
      call: async (name: string, args: any) => {
        calls.push({ name, args });
        const start = Number(args.next_page_token || 0);
        return { emails: all.slice(start, start + 100), next_page_token: start + 100 < all.length ? String(start + 100) : "" };
      },
    })) as any;
  const backfill = mailBackfill(root(), { archive, connectedRead, now: () => NOW });
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done");
  const s = backfill.status().gmail!;
  expect(s.imported).toBe(250);
  expect(calls).toHaveLength(3);
  expect(calls[0].args.query).toContain("after:2025/");
  expect(calls[0].args.max_results).toBe(100);
  // A second run only reads from the newest message it already holds.
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done" && calls.length > 3);
  expect(calls[3].args.query).toContain("after:2026/09/26");
  expect(backfill.status().gmail!.imported).toBe(250);
});

test("outlook stops at the start of the window and never keeps bodies", async () => {
  const archive = fakeArchive();
  const seen: any[] = [];
  archive.importMetadata = ((provider: string, account: string, raw: any[]) => {
    seen.push(...raw);
    for (const m of raw) archive.rows.set(`${provider}:${m.id}`, { provider, account });
    return raw;
  }) as any;
  const all = Array.from({ length: 150 }, (_, i) => ({
    id: `o${i}`,
    subject: "Hi",
    body: { content: "secret body" },
    receivedDateTime: new Date(NOW - i * 5 * 864e5).toISOString(),
  }));
  const connectedRead = (async (_root: string, work: any) =>
    work({
      tools: { "microsoft_outlook_email.list_messages": tool("me@outlook.com") },
      call: async (_name: string, args: any) => ({
        value: all.slice(args.skip, args.skip + args.top),
        has_more: args.skip + args.top < all.length,
        next_from_index: args.skip + args.top,
      }),
    })) as any;
  const backfill = mailBackfill(root(), { archive, connectedRead, now: () => NOW, months: 12 });
  backfill.start(["outlook"]);
  await until(() => backfill.status().outlook?.status === "done");
  // 12 months at one message every five days is about 74 messages.
  expect(backfill.status().outlook!.imported).toBeGreaterThan(70);
  expect(backfill.status().outlook!.imported).toBeLessThan(80);
  expect(JSON.stringify(seen)).not.toContain("secret body");
});

test("a different signed-in account stops the import with a plain reason", async () => {
  const r = root();
  const archive = fakeArchive();
  let email = "one@x.io";
  const connectedRead = (async (_root: string, work: any) =>
    work({
      tools: { "gmail.search_emails": tool(email) },
      call: async () => ({ emails: [], next_page_token: "" }),
    })) as any;
  const backfill = mailBackfill(r, { archive, connectedRead, now: () => NOW });
  backfill.start(["gmail"]);
  await until(() => backfill.status().gmail?.status === "done");
  email = "two@x.io";
  const again = mailBackfill(r, { archive, connectedRead, now: () => NOW });
  // Forget the finished state so the first pass runs again for the new account.
  again.start(["gmail"]);
  await until(() => again.status().gmail?.status !== "running");
  expect(again.status().gmail!.status).toBe("error");
  expect(again.status().gmail!.error).toContain("different account");
});

test("the estimate scales by how much of the year is covered", () => {
  const since = new Date(NOW - 365 * 864e5).toISOString();
  expect(backfillEstimate(1000, since, new Date(NOW - 36.5 * 864e5).toISOString(), NOW)).toBe(10000);
  expect(backfillEstimate(0, since, undefined, NOW)).toBeUndefined();
});

test("a draft on a page does not end the outlook history early", async () => {
  const archive = fakeArchive();
  // Page size is larger than 2, so put a draft among recent mail on every page.
  const all = Array.from({ length: 150 }, (_, i) => ({
    id: `d${i}`,
    subject: "Hi",
    isDraft: i % 10 === 0,
    receivedDateTime: new Date(NOW - i * 5 * 864e5).toISOString(),
  }));
  const connectedRead = (async (_root: string, work: any) =>
    work({
      tools: { "microsoft_outlook_email.list_messages": tool("me@outlook.com") },
      call: async (_name: string, args: any) => ({ value: all.slice(args.skip, args.skip + args.top), has_more: args.skip + args.top < all.length, next_from_index: args.skip + args.top }),
    })) as any;
  const backfill = mailBackfill(root(), { archive, connectedRead, now: () => NOW, months: 12 });
  backfill.start(["outlook"]);
  await until(() => backfill.status().outlook?.status === "done");
  // About 74 messages in the year, minus one draft in ten.
  expect(backfill.status().outlook!.imported).toBeGreaterThan(60);
});
