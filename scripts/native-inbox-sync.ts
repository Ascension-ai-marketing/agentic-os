import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withConnectedRead, type ConnectedTool } from "./codex-connected-read";
import { importInboxSnapshot } from "./inbox-imports";
import { normalizeArchiveMessage, type mailArchive } from "./mail-archive";
import type { OperatorState } from "../src/lib/operator";

type Provider = "gmail" | "outlook" | "slack";
const PROVIDERS: Provider[] = ["gmail", "outlook", "slack"];
const names = { gmail: "Gmail", outlook: "Outlook", slack: "Slack" };
const readTools = { gmail: "gmail.search_emails", outlook: "microsoft_outlook_email.get_recent_emails", slack: "slack.slack_search_public_and_private" };
type Saved = { enabled: boolean; account: string; lastSync?: string; count?: number; error?: string };
type Store = Partial<Record<Provider, Saved>>;
const string = (v: unknown, max = 1000) => typeof v === "string" ? v.slice(0, max) : "";
const identity = (tool?: ConnectedTool) => {
  const profile = tool?._meta?.link_owner_profile;
  return string(tool?.name?.startsWith("slack.") ? profile?.workspace_id || profile?.id : profile?.email || profile?.id, 300);
};

export function gmailSearchMetadata(item: any) {
  if (!item || !string(item.id) || !Number.isFinite(Date.parse(item.email_ts))) throw new Error("Gmail returned incomplete message metadata.");
  const headers = [["From", item.from_], ["To", Array.isArray(item.to) ? item.to.join(", ") : item.to], ["Cc", Array.isArray(item.cc) ? item.cc.join(", ") : item.cc], ["Subject", item.subject]];
  return { id: item.id, threadId: item.thread_id, internalDate: String(Date.parse(item.email_ts)), labelIds: Array.isArray(item.labels) ? item.labels : [], snippet: string(item.snippet, 1000), payload: { headers: headers.map(([name, value]) => ({ name, value: string(value, 4000) })) } };
}

export function gmailReadBody(raw: any) {
  let parts = 0;
  function part(value: any, depth = 0): any {
    if (!value || typeof value !== "object" || value.filename) return {};
    if (++parts > 300 || depth > 20) throw new Error("This message has too many MIME parts. Open it in Gmail.");
    const type = value.mime_type || value.mimeType;
    const content = typeof value.body?.content === "string" ? value.body.content : "";
    return { mimeType: type, filename: value.filename, headers: value.headers,
      body: { ...(content && ["text/plain", "text/html"].includes(type) ? { data: Buffer.from(content).toString("base64url") } : {}), ...(value.body?.attachment_id ? { attachmentId: value.body.attachment_id } : {}) },
      parts: Array.isArray(value.parts) ? value.parts.map((p: any) => part(p, depth + 1)) : [] };
  }
  return { id: raw.id, internalDate: raw.internal_date, threadId: raw.thread_id, labelIds: raw.label_ids, snippet: raw.snippet, payload: part(raw.payload) };
}

/** Slack's supported tool returns structured result text. Require its source IDs and permalink to agree. */
export function slackSearchMessages(raw: any) {
  if (typeof raw?.results !== "string") throw new Error("Slack returned an unsupported result format.");
  const results = raw.results.slice(0, 250000), messages: any[] = [];
  const expected = Number(results.match(/^## Messages \((\d+) results?\)/m)?.[1]);
  const markers = [...results.matchAll(/^### Result (\d+) of (\d+)\s*$/gm)];
  if (markers.length && (!Number.isSafeInteger(expected) || expected > 20 || markers.length !== expected || markers.some((m, i) => Number(m[1]) !== i + 1 || Number(m[2]) !== expected))) throw new Error("Slack returned ambiguous message boundaries. Open the original results in Slack.");
  for (const block of results.split(/^### Result \d+ of \d+\s*$/m).slice(1, 21)) {
    const channel = block.match(/^Channel: (.+?) \(ID: ([A-Z0-9]+)\)/m), from = block.match(/^From: (.+?) \(ID: ([A-Z0-9]+)\)/m);
    const ts = block.match(/^Message_ts: (\d{10}\.\d{6})\s*$/m)?.[1];
    const link = block.match(/^Permalink: \[link\]\((https:\/\/[^\s)]+)\)/m)?.[1];
    const content = block.match(/^Text: ?\n([\s\S]*)/m)?.[1]?.replace(/\n---\s*$/, "").trim();
    if (!channel || !from || !ts || !link || !content) throw new Error("Slack returned an incomplete message. Saved messages were preserved.");
    const url = new URL(link);
    if (!url.hostname.endsWith(".slack.com") || url.username || url.password || url.pathname !== `/archives/${channel[2]}/p${ts.replace(".", "")}`) throw new Error("Slack returned an inconsistent message link.");
    messages.push({ id: `${channel[2]}:${ts}`, threadId: `${channel[2]}:${ts}`, from: from[1], subject: channel[1], body: content.slice(0, 12000), receivedAt: new Date(Number(ts) * 1000).toISOString(), url: url.href });
  }
  if (!messages.length && !/\b0 (?:results|messages)\b|no (?:messages|results) found/i.test(results)) throw new Error("Slack search could not confirm a message list.");
  return messages;
}

export function nativeInboxSync(root: string, options: { load: () => OperatorState; save: (state: OperatorState) => void; archive: ReturnType<typeof mailArchive>; connectedRead?: typeof withConnectedRead }) {
  const connectedRead = options.connectedRead || withConnectedRead;
  const file = join(root, ".operator-data", "native-connections.json");
  const read = (): Store => {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return Object.fromEntries(PROVIDERS.filter(p => raw[p] && typeof raw[p].account === "string").map(p => [p, { enabled: raw[p].enabled === true, account: string(raw[p].account, 300), lastSync: string(raw[p].lastSync, 40) || undefined, count: Number.isSafeInteger(raw[p].count) ? raw[p].count : undefined, error: string(raw[p].error, 300) || undefined }]));
  };
  const save = (state: Store) => { mkdirSync(join(root, ".operator-data"), { recursive: true, mode: 0o700 }); const tmp = `${file}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(tmp, file); };
  let cached: { at: number; providers: any[] } | undefined, discovery: Promise<any[]> | undefined, syncing = false;
  let inflight: Promise<any> | undefined;
  const discover = async () => {
    if (cached && Date.now() - cached.at < 60000) return cached.providers;
    if (!discovery) discovery = connectedRead(root, async client => PROVIDERS.map(provider => {
      const tool = client.tools[readTools[provider]];
      return { id: provider, name: names[provider], available: tool?.annotations?.readOnlyHint === true && !!identity(tool), account: identity(tool), workspace: string(tool?._meta?.link_owner_profile?.workspace_name, 100) };
    })).then(providers => { cached = { at: Date.now(), providers }; return providers; }).finally(() => { discovery = undefined; });
    return discovery;
  };
  return {
    async status() {
      const saved = read();
      try { return { providers: (await discover()).map(p => ({ ...p, ...saved[p.id as Provider], account: p.account, enabled: !!saved[p.id as Provider]?.enabled && saved[p.id as Provider]?.account === p.account })), readOnly: true, mode: "recent-snapshot", calendarAvailable: false }; }
      catch (error) { return { providers: PROVIDERS.map(id => ({ id, name: names[id], ...saved[id], available: false })), readOnly: true, error: (error as Error).message, calendarAvailable: false }; }
    },
    owns(provider: string, account: string) { const s = read()[provider as Provider]; return !!s?.enabled && s.account === account; },
    selectedEmailAccounts() {
      const selected = read();
      return (["gmail", "outlook"] as const).filter(provider => selected[provider]?.enabled)
        .map(provider => ({ provider, account: selected[provider]!.account }));
    },
    /** Live, bounded metadata for voice. No archive writes or full body requests. */
    async recentEmails(provider: "gmail" | "outlook", guard: () => void = () => {}) {
      guard();
      const selection = read()[provider];
      if (!selection?.enabled || !selection.account) throw new Error("This native mailbox is not selected.");
      const account = selection.account;
      const unchanged = () => {
        guard();
        const current = read()[provider];
        if (!current?.enabled || current.account !== account) throw Object.assign(new Error("The selected native mailbox changed during the lookup."), { code: "ACCOUNT_CHANGED" });
      };
      return connectedRead(root, async client => {
        const search = readTools[provider];
        const profile = provider === "gmail" ? "gmail.get_profile" : "microsoft_outlook_email.get_profile";
        const verify = async () => {
          unchanged();
          for (const name of [search, profile]) {
            const tool = client.tools[name];
            if (identity(tool) !== account || tool?.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint === true)
              throw Object.assign(new Error("The native mailbox identity or read permission changed. Reselect it in Connections."), { code: "ACCOUNT_CHANGED" });
          }
          const raw = await client.call(profile, {});
          unchanged();
          const value = raw?.profile || raw;
          const actual = value?.emailAddress || value?.email || value?.mail || value?.userPrincipalName;
          if (typeof actual !== "string" || actual.toLowerCase() !== account.toLowerCase())
            throw Object.assign(new Error("The native mailbox profile does not match the selected account."), { code: "ACCOUNT_CHANGED" });
        };
        await verify();
        unchanged();
        const raw = await client.call(search, provider === "gmail"
          ? { query: "in:inbox -in:drafts -in:sent -in:spam -in:trash", max_results: 10 }
          : { top_k: 10 });
        unchanged();
        const rows = provider === "gmail" ? raw?.emails : raw?.value;
        if (!Array.isArray(rows) || rows.length > 10) throw new Error("The native mailbox returned an invalid recent message list.");
        const items = rows.map((row: any) => {
          const metadata = provider === "gmail" ? gmailSearchMetadata(row) : { ...row, body: undefined };
          const item = normalizeArchiveMessage(provider, account, metadata);
          return { ...item, body: item.body.slice(0, 400), bodyStatus: "metadata" as const, bodyTruncated: true };
        }).filter((item, index) => item.direction !== "outbound" && !item.labelIds?.includes("DRAFT") && rows[index]?.isDraft !== true);
        await verify();
        return { account, items: items.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 10), checkedAt: new Date().toISOString() };
      });
    },
    async sync(selected?: unknown, replaceSelection = false) {
      // A second refresh while one is running simply waits for that one; nothing to report, nothing to show.
      if (inflight) return inflight;
      const previous = read();
      const providers = selected === undefined ? PROVIDERS.filter(p => previous[p]?.enabled) : selected;
      if (!Array.isArray(providers) || providers.length > 3 || providers.some(p => !PROVIDERS.includes(p)) || new Set(providers).size !== providers.length) throw new Error("Choose Gmail, Outlook or Slack.");
      if (!providers.length) { if (replaceSelection) { for (const p of PROVIDERS) if (previous[p]) previous[p]!.enabled = false; save(previous); } return { results: [], messages: 0, bounded: true }; }
      syncing = true;
      inflight = (async () => { try { return await connectedRead(root, async client => {
        const results: any[] = [], saved = read();
        const unchanged = (provider: Provider, current = read()) => JSON.stringify(current[provider]) === JSON.stringify(previous[provider]);
        if (replaceSelection) for (const p of PROVIDERS) if (saved[p]) saved[p]!.enabled = providers.includes(p);
        for (const provider of providers as Provider[]) {
          const tool = client.tools[readTools[provider]], account = identity(tool);
          try {
            if (!account) throw new Error(`${names[provider]} is not available through this Codex sign-in.`);
            if (!replaceSelection && saved[provider]?.account && saved[provider]?.account !== account) throw new Error(`${names[provider]} has a different signed-in account. Select it again in Connections before refreshing.`);
            let items: any[] = [], labels: any[] | undefined, metadata: any[] | undefined;
            if (provider === "slack") {
              const after = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
              const result = await client.call(readTools[provider], { query: `after:${after}`, content_types: "messages", limit: 20, sort: "timestamp", sort_dir: "desc", include_context: false, response_format: "detailed", only_my_channels: true });
              items = slackSearchMessages(result);
            } else {
              const raw = await client.call(readTools[provider], provider === "gmail" ? { query: "-in:spam -in:trash newer_than:14d", max_results: 30 } : { top_k: 30 });
              const rows = provider === "gmail" ? raw.emails : raw.value;
              if (!Array.isArray(rows) || rows.length > 30) throw new Error("The provider returned an invalid message list.");
              metadata = provider === "gmail" ? rows.map(gmailSearchMetadata) : rows.map((r: any) => ({ ...r, body: undefined }));
              if (provider === "gmail" && client.tools["gmail.list_labels"]?.annotations?.readOnlyHint && identity(client.tools["gmail.list_labels"]) === account) {
                try { const data = await client.call("gmail.list_labels", {}); if (Array.isArray(data.labels)) labels = data.labels.map((l: any) => ({ id: l.id, name: l.name, type: l.type })); } catch { /* Message sync succeeded; preserve existing labels. */ }
              }
            }
            if (!unchanged(provider)) throw new Error("This connection changed while refreshing. Saved messages were preserved.");
            if (metadata && provider !== "slack") items = options.archive.importMetadata(provider, account, metadata).map(item => ({ ...item, id: item.remoteId, body: item.body || "(No message preview)", remoteId: item.remoteId }));
            const state = options.load();
            const oldBodies = new Map(state.inbox.filter(i => i.source === provider && i.account === account && i.bodyStatus !== "metadata").map(i => [i.id, { body: i.body, bodyStatus: i.bodyStatus }]));
            if (items.length || labels !== undefined) importInboxSnapshot(state, { provider, account, messages: items, ...(labels !== undefined ? { labels } : {}), via: "codex" });
            if (provider !== "slack") for (const item of state.inbox) if (item.source === provider && item.account === account && items.some(i => i.remoteId === item.remoteId)) {
              const old = oldBodies.get(item.id); if (old) Object.assign(item, old); else { item.bodyStatus = "metadata"; item.bodyTruncated = true; }
            }
            options.save(state);
            saved[provider] = { enabled: true, account, lastSync: new Date().toISOString(), count: items.length };
            results.push({ provider, count: items.length, lastSync: saved[provider]!.lastSync, ok: true });
          } catch (error) {
            const message = (error as Error).message;
            if (saved[provider]) saved[provider] = { ...saved[provider]!, error: message };
            results.push({ provider, ok: false, error: message });
          }
        }
        const current = read();
        for (const p of PROVIDERS) if (unchanged(p, current) && saved[p]) current[p] = saved[p];
        save(current); cached = undefined;
        return { results, messages: results.reduce((sum, r) => sum + (r.count || 0), 0), bounded: true };
      }); } finally { syncing = false; inflight = undefined; } })();
      return inflight;
    },
    async message(id: string) {
      const item = options.archive.get(id);
      if (!item || item.bodyStatus !== "metadata") return item;
      if (!this.owns(item.source, item.account || "")) throw new Error("Refresh this mailbox through your Codex connection first.");
      return connectedRead(root, async client => {
        const provider = item.source as "gmail" | "outlook", account = identity(client.tools[readTools[provider]]);
        if (account !== item.account) throw new Error("The connected account changed. Refresh the correct mailbox before opening this message.");
        const tool = provider === "gmail" ? "gmail.read_email" : "microsoft_outlook_email.fetch_message";
        if (identity(client.tools[tool]) !== item.account) throw new Error("The message reader is connected to a different account. Reconnect this mailbox in Codex.");
        const raw = await client.call(tool, { message_id: item.remoteId, ...(provider === "gmail" ? { format: "full" } : {}) });
        const record = raw.message || raw;
        if (record.id !== item.remoteId) throw new Error("The provider returned a different message.");
        if (!this.owns(provider, account)) throw new Error("This connection was disabled while opening the message.");
        return options.archive.cacheBody(provider, account, provider === "gmail" ? gmailReadBody(record) : record);
      });
    },
  };
}
