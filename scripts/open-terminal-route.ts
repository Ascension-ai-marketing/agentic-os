import type { ViteDevServer } from "vite";
import type { IncomingMessage } from "node:http";
import { execFile } from "node:child_process";
import { jevJson, readJevJson } from "./jev-routes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The shell line to run in Terminal: resume the agent's own session in the OS folder. */
export function terminalCommand(input: { agent: unknown; sessionId?: unknown; root: string }) {
  if (input.agent !== "claude" && input.agent !== "codex") throw new Error("Choose claude or codex");
  const sid = typeof input.sessionId === "string" && UUID.test(input.sessionId) ? input.sessionId : "";
  const cli = input.agent === "claude" ? (sid ? `claude --resume ${sid}` : "claude") : sid ? `codex resume ${sid}` : "codex";
  const dir = `'${input.root.replace(/'/g, `'\\''`)}'`;
  return `cd ${dir} && ${cli}`;
}

/** AppleScript that opens a new Terminal window running the command. */
export function terminalAppleScript(command: string) {
  const quoted = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [`tell application "Terminal" to do script "${quoted}"`, `tell application "Terminal" to activate`];
}

/** POST /__open_terminal { agent, sessionId? } — opens the real Terminal app on this Mac. */
export function installOpenTerminalRoute(server: ViteDevServer, options: { root: string; token: string; isLoopback: (req: IncomingMessage) => boolean }) {
  server.middlewares.use("/__open_terminal", async (req, res) => {
    if (!options.isLoopback(req) || req.headers["x-claude-os-token"] !== options.token) return jevJson(res, { error: "Local workspace token required" }, 403);
    if (req.method !== "POST") return jevJson(res, { error: "POST only" }, 405);
    if (process.platform !== "darwin") return jevJson(res, { error: "Opening Terminal is available on macOS only" }, 400);
    try {
      const body = await readJevJson(req, 4_000);
      const command = terminalCommand({ agent: body.agent, sessionId: body.sessionId, root: options.root });
      const args = terminalAppleScript(command).flatMap((line) => ["-e", line]);
      await new Promise<void>((resolve, reject) => execFile("osascript", args, { timeout: 10_000 }, (err) => (err ? reject(err) : resolve())));
      jevJson(res, { ok: true });
    } catch (e) {
      jevJson(res, { error: e instanceof Error && /Choose/.test(e.message) ? e.message : "Terminal could not be opened" }, 400);
    }
  });
}

/** Links the OS may hand to macOS `open`: a memory record's original (including files the OS saved for you), nothing else. */
export function allowedOpenUrl(url: unknown, port?: number): string | null {
  if (typeof url !== "string" || url.length > 2000) return null;
  // A saved OS file, on this server only (never another local port).
  const local = url.match(/^http:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})\/__memory_file\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/);
  if (local) return port !== undefined && Number(local[1]) === port ? url : null;
  return /^(obsidian:\/\/|https:\/\/mail\.google\.com\/|https:\/\/outlook\.office\.com\/|https:\/\/www\.notion\.so\/)/.test(url) ? url : null;
}

/** The command that hands an allowed link to the system's default app, as an argument list (no shell). */
export function openUrlCommand(url: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

/** POST /__open_url { url } — opens a record's original (Obsidian, Gmail, Outlook, Notion) on this computer.
 *  Server side, so it works after a voice command, where a browser would block the pop-up. */
export function installOpenUrlRoute(server: ViteDevServer, options: { token: string; isLoopback: (req: IncomingMessage) => boolean }) {
  server.middlewares.use("/__open_url", async (req, res) => {
    if (!options.isLoopback(req) || req.headers["x-claude-os-token"] !== options.token) return jevJson(res, { error: "Local workspace token required" }, 403);
    if (req.method !== "POST") return jevJson(res, { error: "POST only" }, 405);
    try {
      const body = await readJevJson(req, 4_000);
      const address = server.httpServer?.address();
      const url = allowedOpenUrl(body.url, typeof address === "object" && address ? address.port : undefined);
      if (!url) return jevJson(res, { error: "That link cannot be opened" }, 400);
      const [cmd, args] = openUrlCommand(url);
      await new Promise<void>((resolve, reject) => execFile(cmd, args, { timeout: 10_000 }, (err) => (err ? reject(err) : resolve())));
      jevJson(res, { ok: true });
    } catch {
      jevJson(res, { error: "Could not open it" }, 400);
    }
  });
}
