/**
 * ceo-openclaw.ts
 *
 * What the OS knows about OpenClaw: whether it is installed, which version, and
 * whether its gateway answers. It only reads. Nothing is handed to OpenClaw from
 * here: OpenClaw can run commands and message people through its channels, so it
 * takes no work from Jarvis until its limits are set and the person has agreed to them.
 *
 * Every call is one of the fixed reads below. The gateway token never passes through
 * this file: no call asks for it, and none prints the Control UI address that carries it.
 *
 * CLI contracts verified against `openclaw --help` of 2026.9.9.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { findExecutable } from "./assistant-runtime";

export type Run = (args: string[], options?: { signal?: AbortSignal }) => Promise<{ code: number; stdout: string; stderr: string }>;
export type OpenclawStatus = { installed: boolean; version?: string; gateway?: "running" | "stopped" | "unknown"; address?: string };
export type Openclaw = ReturnType<typeof openclaw>;

/** The only commands this file runs. Each one reads and changes nothing. */
const READS = {
  version: ["--version"],
  gateway: ["gateway", "status", "--json", "--timeout", "5000"],
} as const;
/** Never passed, whatever is added later: these send a reply out through a channel. */
export const NEVER_FLAGS = ["--deliver", "--channel", "--reply-channel", "--reply-to", "--reply-account", "--to", "-t", "--token", "--password"];
/** Never run: these message people, connect accounts, change what OpenClaw may do, or print the gateway token. */
export const NEVER_COMMANDS = ["message", "channels", "pairing", "dashboard", "configure", "onboard", "setup", "config", "approvals", "exec-approvals", "exec-policy", "doctor", "reset", "uninstall", "agent"];
export const NOT_CLEARED = "OpenClaw is installed, but it is not cleared to take work from Jarvis yet. Hermes, Claude Code and Codex can take work.";
export const NOT_INSTALLED = "OpenClaw is not installed on this computer yet, so nothing can be handed to it. Hermes, Claude Code and Codex can take work.";

type Lookup = { home?: string; path?: string; exists?: (file: string) => boolean; list?: (folder: string) => string[] };

const versionOrder = (name: string) => name.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
const newestFirst = (a: string, b: string) => {
  const left = versionOrder(a), right = versionOrder(b);
  for (let index = 0; index < 3; index++) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (right[index] ?? 0) - (left[index] ?? 0);
  return 0;
};

/**
 * Where OpenClaw is, and the node beside it. npm puts it in the active Node's own folder, which the
 * dashboard has on its PATH and the voice brain does not, so the nvm folders are searched as well.
 */
export function openclawPaths(options: Lookup = {}): { bin: string; node?: string } | undefined {
  const home = options.home ?? homedir();
  const exists = options.exists ?? existsSync;
  const list = options.list ?? ((folder: string) => { try { return readdirSync(folder); } catch { return []; } });
  const versions = join(home, ".nvm", "versions", "node");
  const bin =
    findExecutable("openclaw", { home, path: options.path, exists }) ??
    list(versions).filter((name) => /^v\d+\.\d+\.\d+$/.test(name)).sort(newestFirst).map((name) => join(versions, name, "bin", "openclaw")).find(exists);
  if (!bin) return undefined;
  const node = join(dirname(bin), "node");
  return exists(node) ? { bin, node } : { bin };
}

function command(paths: { bin: string; node?: string } | undefined): Run {
  return (args, options = {}) =>
    new Promise((done, fail) => {
      if (!paths) return fail(new Error("OpenClaw is not installed on this computer."));
      // OpenClaw starts through `env node`; the node installed beside it is the one it was installed for.
      const child = spawn(paths.node ?? paths.bin, paths.node ? [paths.bin, ...args] : args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]),
      });
      let stdout = "", stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { if (stdout.length < 500_000) stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
      child.on("error", () => fail(new Error("OpenClaw did not answer.")));
      child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
    });
}

/** Refuses anything but the fixed reads, so a later change here cannot quietly start sending. */
function readsOnly(run: Run): Run {
  const allowed = Object.values(READS).map((args) => args.join(" "));
  return (args, options) => {
    if (!allowed.includes(args.join(" ")) || NEVER_COMMANDS.includes(args[0]) || args.some((arg) => NEVER_FLAGS.includes(arg.split("=")[0])))
      return Promise.reject(new Error("That is not something the OS asks of OpenClaw."));
    return run(args, options);
  };
}

export function openclaw(options: Lookup & { run?: Run } = {}) {
  const paths = options.run ? undefined : openclawPaths(options);
  const installed = options.run ? true : !!paths;
  const run = readsOnly(options.run ?? command(paths));

  return {
    installed: () => installed,
    /** Why nothing can be handed to OpenClaw. There is always a reason for now. */
    workerProblem: () => (installed ? NOT_CLEARED : NOT_INSTALLED),
    async status(signal?: AbortSignal): Promise<OpenclawStatus> {
      if (!installed) return { installed: false };
      const version = await run([...READS.version], { signal }).then(({ stdout }) => /OpenClaw\s+(\d[\w.-]*)/.exec(stdout)?.[1], () => undefined);
      return { installed: true, ...(version ? { version } : {}), gateway: "unknown" };
    },
  };
}
