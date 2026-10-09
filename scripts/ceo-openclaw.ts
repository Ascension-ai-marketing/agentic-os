/**
 * ceo-openclaw.ts
 *
 * What the OS knows about OpenClaw, and the one way Jarvis hands it work. The reads
 * say whether it is installed, which version, and whether its gateway answers. Work
 * runs only after the person has agreed to its limits (ceo-openclaw-limits.ts), as one
 * headless `agent exec` turn in a folder of its own: no channel, no delivery, a deadline.
 * OpenClaw can run commands and message people through its channels, so every call
 * here is one of the fixed shapes below, checked before it runs.
 *
 * The gateway token never passes through this file: no call asks for it, and none prints
 * the Control UI address that carries it.
 *
 * CLI contracts verified against `openclaw --help` and `openclaw agent exec --help` of 2026.9.9.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { findExecutable } from "./assistant-runtime";
import { overLimits, type OpenclawLimits } from "./ceo-openclaw-limits";
import type { CeoTask } from "./ceo-store";

export type Run = (args: string[], options?: { signal?: AbortSignal; input?: string; timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
/** How a piece of work ended, in the CEO's terms. */
export type OpenclawResult = { status: "done" | "failed"; note: string; costUsd?: number };
export type OpenclawStatus = { installed: boolean; version?: string; gateway?: "running" | "stopped" | "unknown"; address?: string };
export type Openclaw = ReturnType<typeof openclaw>;

/** The only commands this file runs. Each one reads and changes nothing. */
const READS = {
  version: ["--version"],
  gateway: ["gateway", "status", "--json", "--timeout", "5000"],
} as const;
/**
 * The one command that does work: a single headless turn whose files stay in `cwd`, read from
 * standard input, answered as JSON, stopped at a deadline. `agent exec` has no channel to deliver to.
 */
export const workArgs = (cwd: string, minutes: number) => ["agent", "exec", "--message-file", "-", "--cwd", cwd, "--json", "--timeout", String(Math.round(minutes * 60))];
const isWork = (args: string[]) => {
  const [cwd, seconds] = [args[5], Number(args[8])];
  return args.length === 9 && typeof cwd === "string" && cwd.startsWith("/") && Number.isInteger(seconds) && seconds > 0 && seconds <= 3600 &&
    workArgs(cwd, seconds / 60).join("\0") === args.join("\0");
};
/** Never passed, whatever is added later: these send a reply out through a channel. */
export const NEVER_FLAGS = ["--deliver", "--channel", "--reply-channel", "--reply-to", "--reply-account", "--to", "-t", "--token", "--password"];
/** Never run: these message people, connect accounts, change what OpenClaw may do, or print the gateway token. */
export const NEVER_COMMANDS = ["message", "channels", "pairing", "dashboard", "configure", "onboard", "setup", "config", "approvals", "exec-approvals", "exec-policy", "doctor", "reset", "uninstall", "agent"];
export const NOT_CLEARED = "OpenClaw is installed, but it is not cleared to take work from Jarvis yet: the person sets and agrees to its limits on the OpenClaw page in the OS. Hermes, Claude Code and Codex can take work.";
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
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 15_000), ...(options.signal ? [options.signal] : [])]),
      });
      // A child that exits before reading its task closes the pipe; that shows as its exit, not as an error here.
      if (options.input !== undefined) child.stdin!.on("error", () => {}).end(options.input);
      let stdout = "", stderr = "";
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on("data", (chunk) => { if (stdout.length < 500_000) stdout += chunk; });
      child.stderr!.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
      // The name stays, so a deadline reads as a deadline.
      child.on("error", (error) => fail(Object.assign(new Error("OpenClaw did not answer."), { name: error.name })));
      child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
    });
}

/** Refuses anything but the fixed reads and the one work shape, so a later change here cannot quietly start sending. */
function fixedCalls(run: Run): Run {
  const allowed = Object.values(READS).map((args) => args.join(" "));
  return (args, options) => {
    const read = allowed.includes(args.join(" ")) && !NEVER_COMMANDS.includes(args[0]);
    if ((!read && !isWork(args)) || args.some((arg) => NEVER_FLAGS.includes(arg.split("=")[0])))
      return Promise.reject(new Error("That is not something the OS asks of OpenClaw."));
    return run(args, options);
  };
}

/** The JSON envelope `agent exec --json` writes, as a result. Anything else is a failure that says what came back. */
export function readResult(code: number, stdout: string, stderr: string, minutes: number): OpenclawResult {
  let envelope: any;
  try { envelope = JSON.parse(stdout.trim().split("\n").filter((line) => line.startsWith("{")).at(-1) ?? stdout); } catch { envelope = undefined; }
  const cost = typeof envelope?.costUsd === "number" && Number.isFinite(envelope.costUsd) && envelope.costUsd >= 0 ? { costUsd: envelope.costUsd } : {};
  const final = typeof envelope?.final === "string" ? envelope.final.trim() : "";
  if (code === 0 && envelope?.ok === true && envelope.status === "ok") return { status: "done", note: final.slice(-1500) || "It finished without a summary.", ...cost };
  if (code === 2 || envelope?.status === "timeout") return { status: "failed", note: `It was stopped at the ${minutes}-minute limit before it finished.`, ...cost };
  const why = typeof envelope?.error?.message === "string" ? envelope.error.message : stderr.trim().split("\n").at(-1) ?? "";
  return { status: "failed", note: why.slice(0, 600) || "It failed without saying why.", ...cost };
}

export function openclaw(options: Lookup & { run?: Run } = {}) {
  const paths = options.run ? undefined : openclawPaths(options);
  const installed = options.run ? true : !!paths;
  const run = fixedCalls(options.run ?? command(paths));

  return {
    installed: () => installed,
    /** Why the next task cannot go to OpenClaw, or nothing when it can: installed, limits agreed, and within them. */
    workerProblem(context: { limits?: OpenclawLimits; tasks?: CeoTask[] } = {}): string | undefined {
      if (!installed) return NOT_INSTALLED;
      if (!context.limits) return NOT_CLEARED;
      return overLimits(context.limits, context.tasks ?? []);
    },
    /** Runs one task to the end in its own folder inside the agreed one. Resolves with how it ended; never throws. */
    async work(input: { id: string; prompt: string; limits: OpenclawLimits; signal?: AbortSignal; makeFolder?: (folder: string) => void }): Promise<OpenclawResult> {
      if (!/^[0-9a-f-]{36}$/.test(input.id)) return { status: "failed", note: "The task had no usable id." };
      const folder = join(input.limits.folder, input.id), minutes = input.limits.minutes;
      try { (input.makeFolder ?? ((path) => mkdirSync(path, { recursive: true, mode: 0o700 })))(folder); }
      catch { return { status: "failed", note: `Its work folder could not be made: ${folder}` }; }
      // A minute past OpenClaw's own deadline, so its timeout answers first and cleans up after itself.
      return run(workArgs(folder, minutes), { input: input.prompt, timeoutMs: (minutes + 1) * 60_000, signal: input.signal }).then(
        ({ code, stdout, stderr }) => readResult(code, stdout, stderr, minutes),
        (error) => ({ status: "failed" as const, note: (error as Error).name === "AbortError" || (error as Error).name === "TimeoutError" ? `It was stopped at the ${minutes}-minute limit.` : (error as Error).message }),
      );
    },
    async status(signal?: AbortSignal): Promise<OpenclawStatus> {
      if (!installed) return { installed: false };
      const version = await run([...READS.version], { signal }).then(({ stdout }) => /OpenClaw\s+(\d[\w.-]*)/.exec(stdout)?.[1], () => undefined);
      return { installed: true, ...(version ? { version } : {}), gateway: "unknown" };
    },
  };
}
