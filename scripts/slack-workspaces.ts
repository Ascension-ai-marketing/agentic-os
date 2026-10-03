import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SlackWorkspaceHint = { id: string; name: string; url: string };

/** Workspace names are hints, never proof that this app has Slack authorization. */
export function slackWorkspaceHints(homeDir = homedir()): SlackWorkspaceHint[] {
  try {
    const file = join(homeDir, "Library/Application Support/Slack/storage/root-state.json");
    if (statSync(file).size > 2 * 1024 * 1024) return [];
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (!state.workspaces || typeof state.workspaces !== "object") return [];
    const hints = new Map<string, SlackWorkspaceHint>();
    for (const entry of Object.values(state.workspaces).slice(0, 100)) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as Record<string, unknown>;
      if (typeof value.id !== "string" || !/^T[A-Z0-9]{5,30}$/.test(value.id)) continue;
      if (typeof value.name !== "string" || !value.name.trim() || typeof value.url !== "string") continue;
      let url: URL;
      try { url = new URL(value.url); } catch { continue; }
      if (url.protocol !== "https:" || !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) || url.username || url.password || url.port) continue;
      hints.set(value.id, { id: value.id, name: value.name.trim().slice(0, 200), url: `${url.origin}/` });
    }
    return [...hints.values()];
  } catch { return []; }
}
