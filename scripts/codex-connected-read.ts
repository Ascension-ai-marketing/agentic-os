import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { installedCodex } from "./account-discovery";
import { commandLaunch, terminateChild, type PlatformOptions } from "./assistant-runtime";

// Deliberately not a general tool proxy. There are no writes, prompts, model turns or credential copies.
export const CONNECTED_READ_TOOLS = new Set([
  "gmail.get_profile", "gmail.search_emails", "gmail.read_email", "gmail.list_labels",
  "google_calendar.get_profile", "google_calendar.list_calendars", "google_calendar.search_events",
  "microsoft_outlook_email.get_profile", "microsoft_outlook_email.get_recent_emails", "microsoft_outlook_email.fetch_message", "microsoft_outlook_email.list_messages",
  "slack.slack_list_workspaces", "slack.slack_search_public_and_private",
  "mercury.getAccounts", "mercury.listTransactions", "granola.get_account_info", "granola.list_meetings", "granola.get_meetings",
  "notion.notion-list-recent-pages", "notion.fetch",
]);
export type ConnectedTool = { name: string; inputSchema?: any; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }; _meta?: any };
export type ConnectedLink = { id: string; linkName?: string; profileName?: string; profileEmail?: string };
const record = (v: any) => v && typeof v === "object" && !Array.isArray(v) ? v : {};

function validLinkId(value: unknown): value is string {
  return typeof value === "string" && /^link_[A-Za-z0-9]{16,}$/.test(value);
}

/** Read the non-secret account choices advertised by a Codex tool schema. */
export function connectedLinks(tool?: ConnectedTool): ConnectedLink[] {
  const schema = record(tool?.inputSchema), properties = record(schema.properties), link = record(properties.link_id);
  if (!link || (Array.isArray(schema.required) && !schema.required.includes("link_id"))) return [];
  const description = typeof link.description === "string" ? link.description : "";
  const start = description.indexOf("[");
  const end = description.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const entries = JSON.parse(description.slice(start, end + 1));
      if (Array.isArray(entries)) {
        const parsed = entries.flatMap((entry: any) => {
          const value = record(entry);
          return validLinkId(value.link_id) ? [{
            id: value.link_id,
            ...(typeof value.link_name === "string" ? { linkName: value.link_name } : {}),
            ...(typeof value.profile_name === "string" ? { profileName: value.profile_name } : {}),
            ...(typeof value.profile_email === "string" ? { profileEmail: value.profile_email } : {}),
          }] : [];
        });
        if (parsed.length) return parsed;
      }
    } catch { /* A schema can advertise a link without using JSON. */ }
  }
  const direct = [link.default, link.const, tool?._meta?.link_id, tool?._meta?.linkId].find(validLinkId);
  return direct ? [{ id: direct, profileEmail: tool?._meta?.link_owner_profile?.email }] : [];
}

function preferredConnectedAccount(root: string, toolName: string) {
  try {
    const preferences = record(JSON.parse(readFileSync(join(root, ".operator-data", "connected-account-preferences.json"), "utf8")));
    const provider = toolName.split(".", 1)[0];
    const value = preferences[provider];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/** Select a Codex link in memory; opaque link ids are never persisted by Agentic OS. */
export function selectConnectedTool(tool: ConnectedTool | undefined, preferredEmail = "") {
  if (!tool) return tool;
  const links = connectedLinks(tool);
  const normalized = preferredEmail.trim().toLowerCase();
  if (!links.length) {
    if (!normalized) return tool;
    return {
      ...tool,
      _meta: {
        ...record(tool._meta),
        connected_account_selection: "unmatched",
        link_id: "",
        link_owner_profile: { ...record(tool._meta?.link_owner_profile), email: "" },
      },
    };
  }
  const selected = normalized ? links.find(link => link.profileEmail?.trim().toLowerCase() === normalized) : links[0];
  if (!selected) {
    return {
      ...tool,
      _meta: {
        ...record(tool._meta),
        connected_account_selection: "unmatched",
        link_id: "",
        link_owner_profile: { ...record(tool._meta?.link_owner_profile), email: "" },
      },
    };
  }
  return {
    ...tool,
    _meta: {
      ...record(tool._meta),
      link_id: selected.id,
      link_owner_profile: {
        ...record(tool._meta?.link_owner_profile),
        ...(selected.profileEmail ? { email: selected.profileEmail } : {}),
        ...(selected.profileName ? { name: selected.profileName } : {}),
      },
    },
  };
}

/**
 * Codex app tools keep the account grant in Codex and require its opaque link id
 * on every call. The id is exposed in the tool's input-schema description, not
 * in the workspace and never needs to be copied into Agentic OS storage.
 */
export function connectedLinkId(tool?: ConnectedTool) {
  if (tool?._meta?.connected_account_selection === "unmatched") return "";
  const schema = record(tool?.inputSchema), properties = record(schema.properties), link = record(properties.link_id);
  if (!link || (Array.isArray(schema.required) && !schema.required.includes("link_id"))) return "";
  const direct = [link.default, link.const, tool?._meta?.link_id, tool?._meta?.linkId]
    .find(value => typeof value === "string" && /^link_[A-Za-z0-9]{16,}$/.test(value));
  if (direct) return direct;
  const description = typeof link.description === "string" ? link.description : "";
  return description.match(/\blink_[A-Za-z0-9]{16,}\b/)?.[0] || "";
}

function argumentsForConnectedRead(tool: ConnectedTool | undefined, input: unknown) {
  const args = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (args.link_id === undefined) {
    const linkId = connectedLinkId(tool);
    if (linkId) args.link_id = linkId;
  }
  return args;
}

export function unwrapConnectedRead(value: any, allowText = false) {
  if (value?.isError) throw new Error("The connected app could not complete this read. Check its connection in Codex.");
  if (value?.structuredContent && typeof value.structuredContent === "object") return value.structuredContent;
  for (const item of value?.content || []) if (item.type === "text") { try { return JSON.parse(item.text); } catch { /* Not structured provider data. */ } }
  if (allowText) { const text = (value?.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n"); if (text) return { text }; }
  throw new Error("The connected app returned no readable data.");
}

/** A short-lived supported app-server session. Incoming permission requests fail closed. */
export async function withConnectedRead<T>(root: string, work: (client: { tools: Record<string, ConnectedTool>; call: (name: string, args: unknown) => Promise<any> }) => Promise<T>, options: PlatformOptions & { callTimeoutMs?: number; binary?: string; launch?: typeof spawn; timeoutMs?: number } = {}): Promise<T> {
  const platform = { platform: options.platform, env: options.env };
  const binary = options.binary || installedCodex(undefined, undefined, platform);
  if (!binary) throw new Error("Install and sign in to Codex to use its existing connections.");
  // A Windows npm shim (codex.cmd) only runs through cmd.exe; a native binary starts directly.
  const launch = commandLaunch(binary, ["app-server", "--stdio"], platform);
  const child = (options.launch || spawn)(launch.file, launch.args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments, env: { ...process.env, RUST_LOG: "error" } });
  let id = 0, bytes = 0, buffer = "", stopped = false;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const decoder = new StringDecoder("utf8");
  const stop = (message = "The Codex connection closed. Try refreshing again.") => {
    if (stopped) return; stopped = true;
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(message)); } pending.clear();
    child.stdin.end(); terminateChild(child, "SIGTERM", platform);
    const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) terminateChild(child, "SIGKILL", platform); }, 300); kill.unref();
  };
  const lifetime = setTimeout(() => stop("The connected read timed out. Your saved data is unchanged."), options.timeoutMs ?? 240000);
  const rpc = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    if (stopped) { reject(new Error("The Codex connection closed.")); return; }
    // A slow answer fails this one read only; the session stays up for the reads that follow.
    const request = ++id, timer = setTimeout(() => { pending.delete(request); reject(new Error("Codex did not respond in time. Retry the connection.")); }, options.callTimeoutMs ?? 60000);
    pending.set(request, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: request, method, params }) + "\n");
  });
  child.stdout.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > 12 * 1024 * 1024) { stop("The connected read exceeded its response limit."); return; }
    buffer += decoder.write(chunk);
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0 && !stopped) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
      let reply: any; try { reply = JSON.parse(line); } catch { stop("Codex returned an unreadable response."); return; }
      if (reply.method) {
        if (reply.id !== undefined) stop("This app needs approval in Codex. Open its connection there, then retry.");
        continue;
      }
      const task = pending.get(reply.id); if (!task) continue;
      pending.delete(reply.id); clearTimeout(task.timer);
      if (reply.error) task.reject(new Error("Codex could not perform this supported read. Check your connection and Codex version."));
      else task.resolve(reply.result);
    }
  });
  child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) stop("Codex output exceeded its limit."); });
  child.on("error", () => stop("Codex could not start.")); child.on("close", () => stop()); child.stdin.on("error", () => stop());
  try {
    await rpc("initialize", { clientInfo: { name: "agentic_os_connected_read", version: "1" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    await rpc("app/installed", { forceRefresh: true });
    const session = await rpc("thread/start", { cwd: root, ephemeral: true, sandbox: "read-only", approvalPolicy: "never" });
    const threadId = session?.thread?.id;
    if (typeof threadId !== "string") throw new Error("Codex did not start a read session.");
    const status = await rpc("mcpServerStatus/list", { threadId, detail: "toolsAndAuthOnly", limit: 50 });
    const rawTools = record(status?.data?.find((s: any) => s.name === "codex_apps")?.tools) as Record<string, ConnectedTool>;
    const tools = Object.fromEntries(Object.entries(rawTools).map(([name, tool]) => [name, selectConnectedTool(tool, preferredConnectedAccount(root, name))])) as Record<string, ConnectedTool>;
    return await work({ tools, async call(name, args) {
      if (!CONNECTED_READ_TOOLS.has(name) || tools[name]?.annotations?.readOnlyHint !== true || tools[name]?.annotations?.destructiveHint === true) throw new Error("This read is not available through your Codex connection.");
      return unwrapConnectedRead(await rpc("mcpServer/tool/call", { threadId, server: "codex_apps", tool: name, arguments: argumentsForConnectedRead(tools[name], args) }), name.startsWith("granola."));
    } });
  } finally { clearTimeout(lifetime); stop(); }
}
