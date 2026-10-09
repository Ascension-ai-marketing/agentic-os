import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { importInboxSnapshot } from "./inbox-imports";
import { mailMetadataPath, outlookMetadataFields, type mailProvider } from "./mail-provider";
import type { mailArchive } from "./mail-archive";
import type { OperatorState } from "../src/lib/operator";

type Provider = "gmail" | "outlook" | "slack";
type MailProvider = "gmail" | "outlook";
const PROVIDERS: Provider[] = ["gmail", "outlook", "slack"];
const names = { gmail: "Gmail", outlook: "Outlook", slack: "Slack" };
type Saved = { enabled: boolean; account: string; lastSync?: string; count?: number; error?: string };
type Store = Partial<Record<Provider, Saved>>;
export type Lane = {
  identity: (provider: MailProvider) => Promise<string>;
  request: (provider: MailProvider, path: string, account?: string) => Promise<any>;
  slack: { status: () => Promise<{ connected: boolean; email?: string }>; sync: () => Promise<{ messages: number }> };
  mail: Pick<ReturnType<typeof mailProvider>, "recent" | "message">;
};
const string = (v: unknown, max = 1000) => typeof v === "string" ? v.slice(0, max) : "";

/** Recent mail and Slack through the accounts connected in this app. Read-only and bounded. */
export function nativeInboxSync(root: string, options: { load: () => OperatorState; save: (state: OperatorState) => void; archive: ReturnType<typeof mailArchive>; lane: Lane }) {
  const lane = options.lane;
  const file = join(root, ".operator-data", "native-connections.json");
  const read = (): Store => {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return Object.fromEntries(PROVIDERS.filter(p => raw[p] && typeof raw[p].account === "string").map(p => [p, { enabled: raw[p].enabled === true, account: string(raw[p].account, 300), lastSync: string(raw[p].lastSync, 40) || undefined, count: Number.isSafeInteger(raw[p].count) ? raw[p].count : undefined, error: string(raw[p].error, 300) || undefined }]));
  };
  const save = (state: Store) => { mkdirSync(join(root, ".operator-data"), { recursive: true, mode: 0o700 }); const tmp = `${file}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(tmp, file); };
  /** The connected account for a provider, or "" when this app is not connected to it. */
  const account = async (provider: Provider) => {
    if (provider === "slack") { const slack = await lane.slack.status(); return slack.connected ? string(slack.email, 300) || "Slack workspace" : ""; }
    try { return string(await lane.identity(provider), 300); } catch { return ""; }
  };
  let inflight: Promise<any> | undefined;
  async function recentMetadata(provider: MailProvider, who: string) {
    const params = new URLSearchParams(provider === "gmail"
      ? { q: "-in:spam -in:trash newer_than:14d", maxResults: "30", includeSpamTrash: "false" }
      : { $top: "30", $orderby: "receivedDateTime desc", $select: outlookMetadataFields });
    const page = await lane.request(provider, "/messages?" + params, who);
    const rows = provider === "gmail" ? page?.messages ?? (page?.resultSizeEstimate === 0 ? [] : undefined) : page?.value;
    if (!Array.isArray(rows) || rows.length > 30 || rows.some((row: any) => typeof row?.id !== "string" || !row.id)) throw new Error("The provider returned an invalid message list.");
    if (provider === "outlook") return rows.map((row: any) => ({ ...row, body: undefined }));
    const metadata: any[] = [];
    for (let offset = 0; offset < rows.length; offset += 4) metadata.push(...await Promise.all(rows.slice(offset, offset + 4).map(async (row: any) => {
      const record = await lane.request("gmail", mailMetadataPath("gmail", row.id), who);
      if (record?.id !== row.id) throw new Error("The provider returned a different message.");
      return { ...record, payload: { headers: record.payload?.headers } };
    })));
    return metadata;
  }
  return {
    async status() {
      const saved = read();
      const providers = await Promise.all(PROVIDERS.map(async id => {
        const who = await account(id);
        return { id, name: names[id], available: !!who, ...saved[id], account: who, enabled: !!saved[id]?.enabled && saved[id]?.account === who && !!who };
      }));
      return { providers, readOnly: true, mode: "recent-snapshot", calendarAvailable: false };
    },
    owns(provider: string, who: string) { const s = read()[provider as Provider]; return !!s?.enabled && s.account === who; },
    selectedEmailAccounts() {
      const selected = read();
      return (["gmail", "outlook"] as const).filter(provider => selected[provider]?.enabled).map(provider => ({ provider, account: selected[provider]!.account }));
    },
    /** Live, bounded metadata for voice. No archive writes or full body requests. */
    async recentEmails(provider: MailProvider, guard: () => void = () => {}) {
      guard();
      const selection = read()[provider];
      if (!selection?.enabled || !selection.account) throw new Error("This mailbox is not selected.");
      return lane.mail.recent(provider, selection.account, guard);
    },
    async sync(selected?: unknown, replaceSelection = false) {
      // A second refresh while one is running simply waits for that one; nothing to report, nothing to show.
      if (inflight) return inflight;
      const previous = read();
      const providers = selected === undefined ? PROVIDERS.filter(p => previous[p]?.enabled) : selected;
      if (!Array.isArray(providers) || providers.length > 3 || providers.some(p => !PROVIDERS.includes(p)) || new Set(providers).size !== providers.length) throw new Error("Choose Gmail, Outlook or Slack.");
      if (!providers.length) { if (replaceSelection) { for (const p of PROVIDERS) if (previous[p]) previous[p]!.enabled = false; save(previous); } return { results: [], messages: 0, bounded: true }; }
      inflight = (async () => { try {
        const results: any[] = [], saved = read();
        const unchanged = (provider: Provider, current = read()) => JSON.stringify(current[provider]) === JSON.stringify(previous[provider]);
        if (replaceSelection) for (const p of PROVIDERS) if (saved[p]) saved[p]!.enabled = providers.includes(p);
        for (const provider of providers as Provider[]) {
          try {
            const who = await account(provider);
            if (!who) throw new Error(`${names[provider]} is not connected. Connect it in Settings → Connections.`);
            if (!replaceSelection && saved[provider]?.account && saved[provider]?.account !== who) throw new Error(`${names[provider]} has a different signed-in account. Select it again in Connections before refreshing.`);
            let count = 0;
            if (provider === "slack") count = (await lane.slack.sync()).messages;
            else {
              const metadata = await recentMetadata(provider, who);
              if (!unchanged(provider)) throw new Error("This connection changed while refreshing. Saved messages were preserved.");
              const items = options.archive.importMetadata(provider, who, metadata).map(item => ({ ...item, id: item.remoteId, body: item.body || "(No message preview)", remoteId: item.remoteId }));
              const state = options.load();
              const oldBodies = new Map(state.inbox.filter(i => i.source === provider && i.account === who && i.bodyStatus !== "metadata").map(i => [i.id, { body: i.body, bodyStatus: i.bodyStatus }]));
              if (items.length) importInboxSnapshot(state, { provider, account: who, messages: items, via: "file" });
              for (const item of state.inbox) if (item.source === provider && item.account === who && items.some(i => i.remoteId === item.remoteId)) {
                const old = oldBodies.get(item.id); if (old) Object.assign(item, old); else { item.bodyStatus = "metadata"; item.bodyTruncated = true; }
              }
              options.save(state); count = items.length;
            }
            saved[provider] = { enabled: true, account: who, lastSync: new Date().toISOString(), count };
            results.push({ provider, count, lastSync: saved[provider]!.lastSync, ok: true });
          } catch (error) {
            const message = (error as Error).message;
            if (saved[provider]) saved[provider] = { ...saved[provider]!, error: message };
            results.push({ provider, ok: false, error: message });
          }
        }
        const current = read();
        for (const p of PROVIDERS) if (unchanged(p, current) && saved[p]) current[p] = saved[p];
        save(current);
        return { results, messages: results.reduce((sum, r) => sum + (r.count || 0), 0), bounded: true };
      } finally { inflight = undefined; } })();
      return inflight;
    },
    async message(id: string) {
      const item = options.archive.get(id);
      if (!item || item.bodyStatus !== "metadata") return item;
      if (!this.owns(item.source, item.account || "")) throw new Error("Refresh this mailbox in Connections first.");
      return lane.mail.message(id);
    },
  };
}
