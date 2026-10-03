import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryConnectAll } from "./memory-connect-all";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));
const root = () => {
  const p = mkdtempSync(join(tmpdir(), "connect-all-"));
  roots.push(p);
  return p;
};
const app = (id: string, over: any = {}) => ({
  id,
  name: id,
  enabled: false,
  available: true,
  canSync: true,
  status: "idle",
  progress: { processed: 0, total: 0, added: 0 },
  ...over,
});

test("one run brings in every signed-in source and reports one progress list", async () => {
  const log: string[] = [];
  const backfill = {
    status: () => ({ gmail: { status: "running", imported: 2400, estimate: 9000, since: "2025-09-28T00:00:00Z", oldest: "2026-06-01T00:00:00Z", account: "a" } }),
    start: (p: string[]) => {
      log.push(`backfill:${p.join(",")}`);
      return { started: p, status: {} };
    },
  } as any;
  const apps = [app("granola"), app("notion"), app("chatgpt", { available: false }), app("codex", { enabled: true, progress: { processed: 40, total: 80, added: 40, hasMore: true } })];
  const all = memoryConnectAll(root(), {
    native: {
      status: async () => ({ providers: [{ id: "gmail", name: "Gmail", available: true }, { id: "outlook", name: "Outlook", available: true }, { id: "slack", name: "Slack", available: true }] }),
      sync: async (providers) => {
        log.push(`sync:${providers.join(",")}`);
        return { results: providers.map((provider) => ({ provider, ok: true, count: 30 })) };
      },
    },
    backfill,
    apps: {
      list: async () => ({ apps }),
      configure: (id: string) => log.push(`on:${id}`),
      start: (id: string) => log.push(`start:${id}`),
    },
  });
  const first = await all.status();
  expect(first.ranAt).toBeUndefined();
  await all.start({ user: true });
  for (let i = 0; i < 50 && !log.includes("start:codex"); i++) await new Promise((r) => setTimeout(r, 5));
  // Slack is only kept if it was already chosen; mail comes in, then a year of history.
  expect(log).toEqual([
    "sync:gmail,outlook",
    "backfill:gmail,outlook",
    "on:granola",
    "start:granola",
    "on:notion",
    "start:notion",
    "start:codex",
  ]);
  const s = await all.status();
  expect(s.ranAt).toBeTruthy();
  const gmail = s.steps.find((x) => x.id === "gmail")!;
  expect(gmail.line).toBe("Importing 2,400 of ~9,000, back to Jun 2026");
  expect(s.steps.find((x) => x.id === "chatgpt")!.line).toContain("export");
  expect(s.steps.find((x) => x.id === "library")!.line).toContain("codex");
});

test("later runs keep the apps you switched off", async () => {
  const r = root();
  const log: string[] = [];
  const deps = {
    native: { status: async () => ({ providers: [] }), sync: async () => ({ results: [] }) },
    backfill: { status: () => ({}), start: () => ({ started: [], status: {} }) } as any,
    apps: { list: async () => ({ apps: [app("granola"), app("notion", { enabled: true })] }), configure: (id: string) => log.push(`on:${id}`), start: (id: string) => log.push(`start:${id}`) },
  };
  const firstRun = memoryConnectAll(r, deps);
  await firstRun.start({ user: true });
  for (let i = 0; i < 50 && !(await firstRun.status()).finishedAt; i++) await new Promise((res) => setTimeout(res, 5));
  expect(log).toContain("on:granola");
  log.length = 0;
  const secondRun = memoryConnectAll(r, deps);
  await secondRun.start();
  for (let i = 0; i < 50 && !log.includes("start:notion"); i++) await new Promise((res) => setTimeout(res, 5));
  expect(log).toEqual(["start:notion"]);
});

test("timers and refreshes never start the first import", async () => {
  const log: string[] = [];
  const all = memoryConnectAll(root(), {
    native: { status: async () => ({ providers: [{ id: "gmail", name: "Gmail", available: true }] }), sync: async (p) => { log.push(`sync:${p.join(",")}`); return { results: [] }; } },
    backfill: { status: () => ({}), start: () => { log.push("backfill"); return { started: [], status: {} }; } } as any,
    apps: { list: async () => ({ apps: [app("granola")] }), configure: (id: string) => log.push(`on:${id}`), start: (id: string) => log.push(`start:${id}`) },
  });
  await all.start();
  await new Promise((r) => setTimeout(r, 30));
  expect(log).toEqual([]);
  expect((await all.status()).ranAt).toBeUndefined();
});
