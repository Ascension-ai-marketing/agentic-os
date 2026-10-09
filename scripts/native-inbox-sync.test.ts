import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nativeInboxSync, type Lane } from "./native-inbox-sync";
import { mailArchive } from "./mail-archive";
import type { OperatorState } from "../src/lib/operator";

const roots: string[] = [];
const archives: ReturnType<typeof mailArchive>[] = [];
afterEach(() => { for (const archive of archives.splice(0)) archive.close(); for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "native-inbox-test-")); roots.push(root);
  const archive = mailArchive(root); archives.push(archive);
  let state = { inbox: [], gmailLabels: [], inboxImports: [] } as unknown as OperatorState;
  return { root, archive, load: () => structuredClone(state), save: (next: OperatorState) => { state = structuredClone(next); } };
}
const gmailMeta = (id: string, ms: number) => ({ id, threadId: "t-" + id, internalDate: String(ms), labelIds: ["INBOX"], snippet: "hello", payload: { headers: [{ name: "From", value: "Ada <ada@example.test>" }, { name: "Subject", value: "Subject " + id }] } });
function lane(over: Partial<Lane> = {}): Lane & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    identity: async provider => { if (provider === "outlook") throw new Error("Connect Outlook in Settings → Connections."); return "me@example.test"; },
    request: async (_provider, path) => { calls.push(path); return path.startsWith("/messages?") ? { messages: [{ id: "m1" }, { id: "m2" }] } : gmailMeta(path.split("/")[2].split("?")[0], Date.parse("2026-10-01T10:00:00Z")); },
    slack: { status: async () => ({ connected: false }), sync: async () => ({ messages: 0 }) },
    mail: { recent: async (_p, account) => ({ account, items: [], checkedAt: "2026-10-01T10:00:00.000Z" }), message: async () => undefined } as any,
    ...over,
  };
}

test("status lists what the app itself is connected to", async () => {
  const { root, archive, load, save } = setup();
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  const status = await service.status();
  expect(status.providers.map(p => [p.id, p.available, p.account])).toEqual([["gmail", true, "me@example.test"], ["outlook", false, ""], ["slack", false, ""]]);
  expect(status.readOnly).toBe(true);
});
test("sync imports recent Gmail metadata, bounded, and records the selection", async () => {
  const { root, archive, load, save } = setup();
  const fake = lane();
  const service = nativeInboxSync(root, { load, save, archive, lane: fake });
  const result = await service.sync(["gmail"], true);
  expect(result).toMatchObject({ messages: 2, bounded: true, results: [{ provider: "gmail", ok: true, count: 2 }] });
  expect(fake.calls[0]).toContain("maxResults=30");
  expect(service.owns("gmail", "me@example.test")).toBe(true);
  expect(load().inbox.filter(item => item.source === "gmail")).toHaveLength(2);
});
test("a different connected account refuses to refresh the saved selection", async () => {
  const { root, archive, load, save } = setup();
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  await service.sync(["gmail"], true);
  const other = nativeInboxSync(root, { load, save, archive, lane: lane({ identity: async () => "other@example.test" }) });
  const result = await other.sync();
  expect(result.results[0]).toMatchObject({ provider: "gmail", ok: false });
  expect(result.results[0].error).toMatch(/different signed-in account/);
  expect((await other.status()).providers[0].enabled).toBe(false);
});
test("a provider that is not connected reports a plain error and keeps saved mail", async () => {
  const { root, archive, load, save } = setup();
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  const result = await service.sync(["outlook"], true);
  expect(result.results[0]).toMatchObject({ provider: "outlook", ok: false });
  expect(result.results[0].error).not.toMatch(/Codex/);
});
test("Slack refresh delegates to the Slack connection", async () => {
  const { root, archive, load, save } = setup();
  let synced = 0;
  const service = nativeInboxSync(root, { load, save, archive, lane: lane({ slack: { status: async () => ({ connected: true, email: "Acme" }), sync: async () => { synced++; return { messages: 3 }; } } }) });
  expect((await service.sync(["slack"], true)).results[0]).toMatchObject({ provider: "slack", ok: true, count: 3 });
  expect(synced).toBe(1);
});
test("an invalid provider list is rejected", async () => {
  const { root, archive, load, save } = setup();
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  await expect(service.sync(["gmail", "gmail"], true)).rejects.toThrow(/Choose Gmail, Outlook or Slack/);
});
