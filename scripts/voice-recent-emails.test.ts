import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voiceRecentEmails } from "./voice-recent-emails";
import { nativeInboxSync } from "./native-inbox-sync";
import { mailProvider } from "./mail-provider";
import type { InboxItem, OperatorState } from "../src/lib/operator";
const owner = "owner@example.test";
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
const item = (id = "one", source: "gmail" | "outlook" = "gmail", receivedAt = "2026-09-17T10:00:00Z"): InboxItem => ({ id, remoteId: id, threadId: id, source, account: owner, from: "sender@example.test", subject: id, body: "x".repeat(600), receivedAt, read: false, status: "open", category: "updates", direction: "inbound" });
function fixture() {
  let state = { inbox: [], brainSources: { email: true }, brainRevision: 1 } as unknown as OperatorState;
  let native: Array<{ provider: "gmail" | "outlook"; account: string }> = [{ provider: "gmail", account: owner }];
  let direct: typeof native = [];
  const calls: string[] = [];
  let lookup = async (provider: "gmail" | "outlook", guard: () => void) => { guard(); return { account: owner, items: [item("new", provider)], checkedAt: new Date().toISOString() }; };
  const api = voiceRecentEmails({ load: () => state,
    nativeInbox: { selectedEmailAccounts: () => native, recentEmails: async (provider, guard) => { calls.push("native:" + provider); return lookup(provider, guard); } },
    providerMail: { recent: async (provider, _account, guard) => { calls.push("direct:" + provider); return lookup(provider, guard); } },
    directAccounts: async () => direct,
  });
  return { api, calls, get state() { return state; }, set state(value) { state = value; }, get native() { return native; }, set native(value) { native = value; }, get direct() { return direct; }, set direct(value) { direct = value; }, respond(fn: typeof lookup) { lookup = fn; } };
}
test("live recent emails carry provenance, bounded snippets and preserve local drafts/read flags", async () => {
  const f = fixture(); f.state.inbox = [{ ...item(), draft: "Unsent", read: true, readOverride: true }]; const before = structuredClone(f.state);
  const result = await f.api.recent(); expect(result.mode).toBe("live"); expect(result.items[0].evidence).toBe("live"); expect(result.items[0].body).toHaveLength(400);
  expect(result.providers).toMatchObject([{ provider: "gmail", status: "live" }, { provider: "outlook", status: "not-connected" }]); expect(f.state).toEqual(before);
});
test("disabled email sources do not call providers or expose saved email", async () => {
  const f = fixture(); f.state.brainSources = { email: false }; f.state.inbox = [item()]; const result = await f.api.recent();
  expect(result.mode).toBe("unavailable"); expect(result.items).toEqual([]); expect(f.calls).toEqual([]);
});
test("source or revision changes during a lookup discard all returned data", async () => {
  const f = fixture(); f.respond(async () => { f.state.brainSources = { email: false }; return { account: owner, items: [item()], checkedAt: "now" }; });
  await expect(f.api.recent()).rejects.toThrow("access changed");
  f.state.brainSources = { email: true }; f.respond(async () => { f.state.brainRevision = 2; return { account: owner, items: [item()], checkedAt: "now" }; });
  await expect(f.api.recent()).rejects.toThrow("access changed");
});
test("connection selection change prevents fallback to the old account", async () => {
  const f = fixture(); f.state.inbox = [item()]; f.respond(async () => { f.native = [{ provider: "gmail", account: "other@example.test" }]; return { account: owner, items: [item()], checkedAt: "now" }; });
  const result = await f.api.recent(); expect(result.items).toEqual([]); expect(result.providers[0].status).toBe("unavailable");
});
test("live identity mismatch does not return an old saved snapshot", async () => {
  const f = fixture(); f.state.inbox = [item()]; f.respond(async () => { throw Object.assign(new Error("Changed"), { code: "ACCOUNT_CHANGED" }); });
  const result = await f.api.recent(); expect(result.items).toEqual([]); expect(result.mode).toBe("unavailable");
});
test("failure returns only selected-account saved messages and never calls them live", async () => {
  const f = fixture(); f.state.inbox = [item("saved"), { ...item("other"), account: "other@example.test" }]; f.respond(async () => { throw new Error("Provider failed token=secret"); });
  const result = await f.api.recent(); expect(result.mode).toBe("saved"); expect(result.items.map(row => row.id)).toEqual(["saved"]); expect(result.items[0].evidence).toBe("saved"); expect(result.providers[0].checkedAt).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("token=secret");
});
test("successful empty results are live and never fall back to stale saved messages", async () => {
  const f = fixture(); f.state.inbox = [item("old")]; f.respond(async () => ({ account: owner, items: [], checkedAt: "2026-09-17T10:00:00Z" }));
  const result = await f.api.recent(); expect(result.mode).toBe("live"); expect(result.items).toEqual([]); expect(result.providers[0].status).toBe("live");
});
test("provider date sorting combines at most ten, labels mixed provenance and omits sent/drafts", async () => {
  const f = fixture(); f.native.push({ provider: "outlook", account: owner }); f.state.inbox = [item("old-outlook", "outlook", "2026-09-17T11:00:00Z")];
  f.respond(async provider => { if (provider === "outlook") throw new Error("offline"); return { account: owner, checkedAt: "now", items: Array.from({ length: 10 }, (_, index) => ({ ...item(String(index), "gmail", `2026-09-17T10:${String(index).padStart(2, "0")}:00Z`), ...(index === 1 ? { labelIds: ["DRAFT"] } : {}) })) }; });
  const result = await f.api.recent(); expect(result.mode).toBe("mixed"); expect(result.items).toHaveLength(10); expect(result.items[0].id).toBe("old-outlook"); expect(result.items[1].id).toBe("9"); expect(result.items.some(row => row.id === "1")).toBe(false);
});
test("direct accounts work independently; native selection wins without account substitution", async () => {
  const f = fixture(); f.direct = [{ provider: "gmail", account: owner }, { provider: "outlook", account: owner }]; await f.api.recent();
  expect(f.calls).toEqual(["native:gmail", "direct:outlook"]);
});
test("malformed live rows fail instead of generating misleading metadata", async () => {
  const f = fixture(); f.state.inbox = [item("old-account-snapshot")]; f.respond(async () => ({ account: owner, items: [{ ...item(), account: "wrong@example.test" }], checkedAt: "now" }));
  const result = await f.api.recent(); expect(result.items).toEqual([]); expect(result.providers[0].status).toBe("unavailable");
});
function nativeFixture() {
  const root = mkdtempSync(join(tmpdir(), "voice-recent-")); roots.push(root); mkdirSync(join(root, ".operator-data"));
  const path = join(root, ".operator-data/native-connections.json"); writeFileSync(path, JSON.stringify({ gmail: { account: owner, enabled: true } }));
  const tools: any = {};
  for (const name of ["gmail.search_emails", "gmail.get_profile"]) tools[name] = { name, annotations: { readOnlyHint: true }, _meta: { link_owner_profile: { email: owner } } };
  const calls: any[] = []; let respond = (name: string): any => name === "gmail.get_profile" ? { emailAddress: owner } : { emails: [{ id: "new", email_ts: "2026-09-17T10:00:00Z", subject: "Hello", from_: "sender@example.test", snippet: "s".repeat(1000), labels: ["INBOX"] }] };
  const api = nativeInboxSync(root, { load: () => ({ inbox: [] }) as any, save: () => { throw new Error("Must not write state"); }, archive: { importMetadata: () => { throw new Error("Must not write archive"); } } as any,
    connectedRead: (async (_root: string, work: any) => work({ tools, call: async (name: string, args: any) => { calls.push({ name, args }); return respond(name); } })) as any });
  return { api, tools, calls, path, respond(fn: typeof respond) { respond = fn; } };
}
test("native live lookup uses fixed bounded metadata and fresh profile checks, never body/import", async () => {
  const f = nativeFixture(); const result = await f.api.recentEmails("gmail");
  expect(result.items[0].body).toHaveLength(400); expect(f.calls.map(call => call.name)).toEqual(["gmail.get_profile", "gmail.search_emails", "gmail.get_profile"]);
  expect(f.calls[1].args).toEqual({ query: "in:inbox -in:drafts -in:sent -in:spam -in:trash", max_results: 10 });
});
test("native disabled selections and mismatched tool/profile identities cannot read messages", async () => {
  const first = nativeFixture(); writeFileSync(first.path, JSON.stringify({ gmail: { account: owner, enabled: false } })); await expect(first.api.recentEmails("gmail")).rejects.toThrow("not selected"); expect(first.calls).toHaveLength(0);
  const second = nativeFixture(); second.tools["gmail.search_emails"]._meta.link_owner_profile.email = "wrong@example.test"; await expect(second.api.recentEmails("gmail")).rejects.toThrow("identity"); expect(second.calls).toHaveLength(0);
  const third = nativeFixture(); third.respond(() => ({ emailAddress: "wrong@example.test" })); await expect(third.api.recentEmails("gmail")).rejects.toThrow("profile"); expect(third.calls).toHaveLength(1);
});
test("native account changes after metadata retrieval discard the result", async () => {
  const f = nativeFixture(); let profiles = 0; f.respond(name => name === "gmail.get_profile" ? { emailAddress: ++profiles === 1 ? owner : "changed@example.test" } : { emails: [] });
  await expect(f.api.recentEmails("gmail")).rejects.toThrow("profile");
});
test("direct Gmail lookup requests metadata only and rechecks account without indexing", async () => {
  const calls: string[] = []; let identities = 0;
  const api = mailProvider({ archive: { importMetadata: () => { throw new Error("Must not index"); } } as any, identity: async () => { identities++; return owner; }, request: async (_provider, path) => {
    calls.push(path); if (path.startsWith("/messages?")) return { messages: [{ id: "new" }] };
    return { id: "new", internalDate: String(Date.parse("2026-09-17T10:00:00Z")), snippet: "Preview", payload: { headers: [{ name: "From", value: "sender@example.test" }], body: { data: Buffer.from("Never expose full body").toString("base64url") }, mimeType: "text/plain" } };
  } });
  const result = await api.recent("gmail", owner); expect(result.items[0].body).toBe("Preview"); expect(identities).toBe(2); expect(calls[0]).toContain("maxResults=10"); expect(calls[1]).toContain("format=metadata");
});
test("direct Outlook orders recent metadata, omits body and rejects account changes", async () => {
  let account = owner; const api = mailProvider({ archive: {} as any, identity: async () => account, request: async (_provider, path) => {
    const q = new URL("https://example.test" + path).searchParams; expect(q.get("$top")).toBe("10"); expect(q.get("$orderby")).toBe("receivedDateTime desc"); expect(q.get("$select")?.split(",")).not.toContain("body");
    account = "changed@example.test"; return { value: [] };
  } });
  await expect(api.recent("outlook", owner)).rejects.toThrow("changed");
});
