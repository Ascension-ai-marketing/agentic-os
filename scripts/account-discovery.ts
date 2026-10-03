import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { commandLaunch, findExecutable, terminateChild, type LookupOptions, type PlatformOptions } from "./assistant-runtime";
import type { ConnectionDiscovery, ExistingAppConnection } from "../src/lib/operator";

const MAX_APPS = 500;
const PAGE_SIZE = 50;
const MAX_OUTPUT = 2 * 1024 * 1024;
type Reply = { result?: unknown; error?: { code?: number } };
type Options = PlatformOptions & {
  homeDir?: string;
  binary?: string | null;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
  start?: (binary: string, args: string[], cwd: string) => ChildProcessWithoutNullStreams;
};
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const flag = (value: unknown) => typeof value === "boolean" ? value : null;
const name = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";

/** The Codex CLI: PATH, then the npm/bun/volta shim folders. On Windows this is
 * `codex.cmd` (npm) or `codex.exe`; the caller launches a `.cmd` through cmd.exe. */
export function installedCodex(home = homedir(), path?: string, options: LookupOptions = {}) {
  // Tests and fixtures set this so no real Codex process is ever spawned for them.
  if ((options.env ?? process.env).AGENTIC_OS_NO_CODEX === "1") return null;
  return findExecutable("codex", { ...options, home, path }) ?? null;
}

export function normalizeExistingApps(list: unknown, installed: unknown) {
  const directory = record(list), runtime = record(installed);
  const metadata = Array.isArray(directory.data) ? directory.data : [];
  const observed = Array.isArray(runtime.apps) ? runtime.apps : [];
  const apps = new Map<string, ExistingAppConnection>();
  const idFor = (item: Record<string, any>) => typeof item.id === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(item.id) ? item.id : "";
  for (const value of metadata.slice(0, MAX_APPS)) {
    const item = record(value), id = idFor(item); if (!id) continue;
    apps.set(id, { id, name: name(item.name, 80) || "Unnamed app", isAccessible: flag(item.isAccessible), isEnabled: flag(item.isEnabled), runtimeEnabled: null, callable: null, observed: false, directAuthorization: false });
  }
  // Runtime observations take precedence in the bounded output, but never substitute for accessibility.
  for (const value of observed.slice(0, 500)) {
    const item = record(value), id = idFor(item); if (!id) continue;
    const prior = apps.get(id);
    apps.set(id, { id, name: prior?.name || name(item.runtimeName, 80) || "Unnamed app", isAccessible: prior?.isAccessible ?? null, isEnabled: prior?.isEnabled ?? null, runtimeEnabled: flag(item.enabled), callable: flag(item.callable), observed: true, directAuthorization: false });
  }
  const ranked = [...apps.values()].sort((a, b) => Number(b.callable === true) - Number(a.callable === true) || Number(b.observed) - Number(a.observed) || Number(b.isAccessible === true) - Number(a.isAccessible === true) || a.name.localeCompare(b.name));
  return { apps: ranked.slice(0, MAX_APPS), truncated: !!directory.nextCursor || metadata.length > MAX_APPS || observed.length > 500 || ranked.length > MAX_APPS };
}

/** Only supported capability metadata RPCs. No turns, tool calls, secret reads or config writes. */
export function existingConnectionDiscovery(root: string, options: Options = {}) {
  const now = options.now || Date.now;
  const ttl = Math.min(300000, Math.max(1000, options.ttlMs ?? 60000));
  const timeout = Math.min(30000, Math.max(10, options.timeoutMs ?? 20000));
  let cached: ConnectionDiscovery | undefined, pending: Promise<ConnectionDiscovery> | undefined;
  let closed = false, cancel: (() => void) | undefined;
  const result = (status: ConnectionDiscovery["status"], detail: string, payload: Partial<ConnectionDiscovery> = {}): ConnectionDiscovery => ({ version: 1, harness: "codex", scope: "global", status, checkedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + (status === "available" ? ttl : Math.min(ttl, 30000))).toISOString(), runtimeFresh: false, apps: [], truncated: false, detail, ...payload });
  async function probe(): Promise<ConnectionDiscovery> {
    const platform = { platform: options.platform, env: options.env };
    const binary = options.binary === undefined ? installedCodex(options.homeDir, undefined, platform) : options.binary;
    if (!binary) return result("unavailable", "Codex is optional. Open your existing AI app to use its connections, or install Codex to check them here.");
    return new Promise(resolve => {
      let child: ChildProcessWithoutNullStreams;
      // A Windows npm shim (codex.cmd) only runs through cmd.exe; a native binary starts directly.
      const launch = commandLaunch(binary, ["app-server", "--stdio"], platform);
      try { child = options.start ? options.start(launch.file, launch.args, root) : spawn(launch.file, launch.args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments, env: { ...process.env, RUST_LOG: "error" } }); }
      catch { resolve(result("unavailable", "The optional Codex connection check could not start. Use your native AI app or direct Connections.")); return; }
      let done = false, received = 0, stderrBytes = 0, buffer = "", initialized = false;
      const decoder = new StringDecoder("utf8");
      const replies = new Map<number, Reply>();
      const directoryPages: unknown[] = [];
      const cursors = new Set<string>();
      const finish = (value: ConnectionDiscovery) => {
        if (done) return; done = true; clearTimeout(timer); cancel = undefined;
        child.stdin.end(); terminateChild(child, "SIGTERM", platform);
        const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) terminateChild(child, "SIGKILL", platform); }, 300); kill.unref();
        resolve(value);
      };
      const timer = setTimeout(() => { aggregate(true); if (!done) finish(result("timeout", "Codex connection discovery timed out. Connection access is unknown; continue in your native app or use direct Connections.")); }, timeout);
      cancel = () => finish(result("unavailable", "Connection discovery is stopped."));
      const write = (message: unknown) => { if (!done) child.stdin.write(JSON.stringify(message) + "\n"); };
      const aggregate = (partial = false) => {
        if ((!replies.has(2) || !replies.has(3) || !replies.has(4)) && !partial) return;
        if (!replies.has(2) && !replies.has(3)) return;
        const listing = replies.get(2) || {}, runtime = replies.get(3) || {};
        const listOK = !listing.error && Array.isArray(record(listing.result).data);
        const runtimeOK = !runtime.error && Array.isArray(record(runtime.result).apps);
        if (!listOK && !runtimeOK) {
          const unsupported = listing.error?.code === -32601 && runtime.error?.code === -32601;
          finish(result(unsupported ? "unsupported" : "error", unsupported ? "This Codex version does not expose supported app discovery. Use connections in Codex directly." : "Codex could not verify app access. Sign in or check app settings in Codex; no direct account has been linked."));
          return;
        }
        const normalized = normalizeExistingApps(listOK ? listing.result : undefined, runtimeOK ? runtime.result : undefined);
        const pluginReply = replies.get(4);
        const marketplaces = record(pluginReply?.result).marketplaces;
        const plugins = (Array.isArray(marketplaces) ? marketplaces : []).flatMap((market: any) => Array.isArray(market.plugins) ? market.plugins : []).filter((plugin: any) => plugin.installed === true).slice(0, MAX_APPS).map((plugin: any) => ({ id: name(plugin.id, 256), name: name(plugin.interface?.displayName || plugin.name, 80), enabled: plugin.enabled === true }));
        finish(result("available", runtimeOK ? "Observed in the refreshed global Codex runtime. Tool access remains inside Codex and depends on each task's permissions. Direct email and calendar access here stays separate." : "App metadata is available, but runtime callability could not be verified. Use Codex to check access before a request.", { ...normalized, plugins, runtimeFresh: runtimeOK }));
      };
      const output = (chunk: Buffer, stdout: boolean) => {
        if (done) return;
        if (!stdout) { stderrBytes += chunk.length; if (stderrBytes > MAX_OUTPUT) finish(result("error", "Codex diagnostic output exceeded its bounded limit. Check the native app before retrying.")); return; }
        received += chunk.length;
        if (received > MAX_OUTPUT) { finish(result("error", "Connection discovery exceeded its metadata limit. Use Codex directly to inspect the full app list.")); return; }
        // stderr is separately bounded and discarded; it cannot consume the metadata response budget.
        buffer += decoder.write(chunk);
        let end: number;
        while (!done && (end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
          let message: Record<string, any>;
          try { message = record(JSON.parse(line)); } catch { finish(result("error", "Codex returned an unreadable metadata response.")); return; }
          if (message.method) continue; // Notifications are not proof of a fresh, completed discovery request.
          if (message.id === 1 && !initialized) {
            if (message.error || !message.result) { finish(result("unsupported", "This Codex runtime could not initialize supported app discovery.")); return; }
            initialized = true; write({ method: "initialized" });
            write({ id: 2, method: "app/list", params: { limit: PAGE_SIZE, forceRefetch: true } });
            write({ id: 3, method: "app/installed", params: { forceRefresh: true } });
            write({ id: 4, method: "plugin/installed", params: { cwds: [root] } });
          } else if (initialized && [2, 3, 4].includes(message.id) && !replies.has(message.id)) {
            if (message.id === 2 && !message.error && Array.isArray(message.result?.data)) {
              directoryPages.push(...message.result.data);
              const cursor = message.result.nextCursor;
              if (typeof cursor === "string" && cursor && !cursors.has(cursor) && directoryPages.length < MAX_APPS) {
                cursors.add(cursor); write({ id: 2, method: "app/list", params: { limit: PAGE_SIZE, cursor } }); continue;
              }
              message.result = { data: directoryPages, nextCursor: cursor };
            }
            replies.set(message.id, message); aggregate();
          }
        }
      };
      child.stdout.on("data", chunk => output(Buffer.from(chunk), true));
      child.stderr.on("data", chunk => output(Buffer.from(chunk), false));
      child.stdin.on("error", () => finish(result("unavailable", "The Codex metadata connection closed. Use Codex directly or direct Connections.")));
      child.on("error", () => finish(result("unavailable", "Codex could not start. It is optional; continue with another tool or direct Connections.")));
      child.on("close", () => { if (!done) finish(result("unavailable", "Codex exited before connection access could be verified.")); });
      write({ id: 1, method: "initialize", params: { clientInfo: { name: "agentic_os_connections", title: "Agentic OS connection discovery", version: "1" }, capabilities: { experimentalApi: true, optOutNotificationMethods: ["app/list/updated"] } } });
    });
  }
  return {
    async read(force = false): Promise<ConnectionDiscovery> {
      if (force) cached = undefined;
      if (closed) return result("unavailable", "Connection discovery is stopped.");
      if (cached && Date.parse(cached.expiresAt) > now()) return structuredClone(cached);
      if (pending) return structuredClone(await pending);
      pending = probe();
      try { cached = await pending; return structuredClone(cached); } finally { pending = undefined; }
    },
    close() { closed = true; cancel?.(); },
  };
}
