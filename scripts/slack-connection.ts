import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { slackWorkspaceHints } from "./slack-workspaces";
import type { OperatorState, InboxItem } from "../src/lib/operator";

type SlackAccount = {
  token: string;
  channel: string;
  team: string;
  teamId: string;
  lastSync?: string;
};
export function slackConnection(
  root: string,
  load: () => OperatorState,
  save: (state: OperatorState) => void,
  options: { homeDir?: string } = {},
) {
  const directory = join(root, ".operator-data"),
    file = join(directory, "slack.json");
  let syncing = false;
  const read = (): Partial<SlackAccount> =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const write = (value: Partial<SlackAccount>) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  };
  async function request(
    method: "auth.test" | "conversations.history",
    token: string,
    params: Record<string, string> = {},
  ) {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (response.status === 429)
      throw new Error("Slack is limiting refreshes. Try again in a minute.");
    if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}. Try again.`);
    const result = await response.json();
    if (!result.ok) {
      const reason =
        result.error === "not_in_channel"
          ? "Invite this Slack app to the selected channel first."
          : result.error === "missing_scope"
            ? "Allow channels:history (or groups:history for a private channel), then reinstall the Slack app."
            : result.error === "channel_not_found"
              ? "The channel was not found or this Slack app cannot access it."
              : "Slack could not authorize this request. Check the app token and channel access.";
      throw new Error(reason);
    }
    return result;
  }
  return {
    status() {
      const account = read();
      return {
        id: "slack",
        configured: !!account.token,
        connected: !!account.token && !!account.teamId,
        email: account.team,
        channel: account.channel,
        lastSync: account.lastSync,
        redirectUri: "http://localhost:8081/inbox",
        detectedWorkspaces: slackWorkspaceHints(options.homeDir),
      };
    },
    async handle(path: string, body: any) {
      if (syncing) throw new Error("Wait for the Slack refresh to finish.");
      syncing = true;
      try {
        if (path === "/connections/configure") {
          const token = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
          const channel = typeof body.channel === "string" ? body.channel.trim().toUpperCase() : "";
          if (!/^xox[bp]-[A-Za-z0-9-]{10,}$/.test(token))
            throw new Error("Enter a Slack bot or user OAuth token.");
          if (!/^[CGD][A-Z0-9]{7,30}$/.test(channel))
            throw new Error("Enter the channel ID from Slack's channel details.");
          const identity = await request("auth.test", token);
          if (!identity.team_id) throw new Error("Slack did not identify this workspace.");
          await request("conversations.history", token, { channel, limit: "1" });
          write({
            token,
            channel,
            team: identity.team || "Slack workspace",
            teamId: identity.team_id,
          });
          return { ok: true };
        }
        if (path === "/connections/disconnect") {
          write({});
          return { ok: true };
        }
        if (path !== "/connections/sync") throw new Error("Choose Connect or Sync for Slack.");
        const account = read();
        if (!account.token || !account.channel || !account.teamId)
          throw new Error("Connect Slack first.");
        const data = await request("conversations.history", account.token, {
          channel: account.channel,
          limit: "15",
          oldest: String(Math.floor(Date.now() / 1000) - 7 * 86400),
        });
        const prefix = `slack:${createHash("sha256").update(account.teamId).digest("hex").slice(0, 12)}:${account.channel}:`;
        const incoming: InboxItem[] = (data.messages || [])
          .filter(
            (m: any) =>
              typeof m.text === "string" &&
              m.text.trim() &&
              Number.isFinite(Number(m.ts)) &&
              Number(m.ts) > 0,
          )
          .map((m: any) => ({
            id: prefix + m.ts,
            from: m.bot_profile?.name || (m.user ? `Slack user ${m.user}` : "Slack"),
            subject: `${account.channel} · ${m.text.replace(/\s+/g, " ").slice(0, 90)}`,
            body: m.text.slice(0, 100000),
            receivedAt: new Date(Number(m.ts) * 1000).toISOString(),
            category: "needs-you",
            triageReason: "Imported from your selected Slack channel for review.",
            status: "open",
            source: "slack",
          }));
        const state = load();
        for (const item of incoming) {
          const old = state.inbox.find((i) => i.id === item.id);
          if (old)
            Object.assign(old, item, {
              category: old.category,
              status: old.status,
              draft: old.draft,
              read: old.read,
              readOverride: old.readOverride,
            });
          else state.inbox.push(item);
        }
        save(state);
        const lastSync = new Date().toISOString();
        write({ ...account, lastSync });
        return { messages: incoming.length, events: 0, limited: !!data.has_more };
      } finally {
        syncing = false;
      }
    },
  };
}
