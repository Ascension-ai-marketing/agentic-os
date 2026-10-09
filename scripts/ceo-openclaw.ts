/**
 * ceo-openclaw.ts
 *
 * What the OS knows about OpenClaw, and the one way Jarvis hands it work. The reads
 * say whether it is installed, which version, which model it uses and whether its
 * gateway answers. Work runs only after the person has agreed to its limits
 * (ceo-openclaw-limits.ts), as one headless `agent exec` turn in a folder of its own,
 * with a deadline.
 *
 * OpenClaw's everyday settings can let it run commands, drive a browser and message
 * people through its channels. So a hand-off never runs under them: each run is pinned
 * with `--config` to a small settings file the OS writes afresh (pinnedConfig below),
 * which gives it file tools inside its task folder and nothing else, no channels and
 * no plugins but the model's. Nothing in OpenClaw's own settings is read into that file
 * or changed. Every call here is one of the fixed shapes below, checked before it runs.
 *
 * The gateway token never passes through this file: no call asks for it, and the Control
 * UI address is passed on only as a bare address on this computer, with nothing after it.
 *
 * CLI contracts verified against `openclaw --help`, `openclaw agent exec --help` and
 * `openclaw config validate` of 2026.9.9.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { findExecutable } from "./assistant-runtime";
import { MODEL, overLimits, type OpenclawLimits } from "./ceo-openclaw-limits";
import type { CeoTask } from "./ceo-store";

export type Run = (args: string[], options?: { signal?: AbortSignal; input?: string; timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
/** How a piece of work ended, in the CEO's terms. `outside` names tools it used that its settings do not give it. */
export type OpenclawResult = { status: "done" | "failed"; note: string; costUsd?: number; outside?: string[] };
export type OpenclawStatus = {
  installed: boolean; version?: string; model?: string;
  gateway?: "running" | "stopped" | "unknown";
  /** The gateway listens on this computer only. */
  localOnly?: boolean;
  address?: string;
};
export type Openclaw = ReturnType<typeof openclaw>;

/** The only commands this file runs besides work. Each one reads and changes nothing. */
const READS = {
  version: ["--version"],
  gateway: ["gateway", "status", "--json", "--timeout", "5000"],
  /** The one read of OpenClaw's settings: the name of the model it uses, which is no secret. */
  model: ["config", "get", "agents.defaults.model", "--json"],
} as const;

/** What OpenClaw may use when Jarvis hands it work: its file tools, held to the task's folder by the settings below. */
export const WORK_TOOLS = ["read", "write", "edit"];
/** `write` brings `apply_patch` with it on models that edit that way; the same folder rule holds it. */
const FILE_TOOLS = [...WORK_TOOLS, "apply_patch"];
/** Refused by name as well, so a tool added to the list above by mistake still cannot run commands, browse or message. */
const DENIED = ["group:runtime", "group:web", "group:ui", "group:messaging", "group:automation", "group:nodes", "group:agents", "group:sessions", "group:media", "group:memory", "group:plugins"];

/**
 * The settings every hand-off runs under, whole. There are no channels in it, so nothing can be sent;
 * the only plugin is the model's provider; OpenClaw's own runtime does the work, so `fs.workspaceOnly`
 * is what holds the file tools to the task's folder (`--cwd`).
 */
export function pinnedConfig(model: string) {
  const [, provider, name] = MODEL.exec(model) ?? [];
  if (!provider || !name || model.length > 200) throw new Error("OpenClaw has not said which model it uses.");
  return {
    agents: { defaults: { model: { primary: model }, models: { [`${provider}/${name}`]: { agentRuntime: { id: "openclaw" } } } } },
    plugins: { allow: [provider], entries: { [provider]: { enabled: true } }, slots: { memory: "none" } },
    tools: { allow: [...WORK_TOOLS], deny: [...DENIED], fs: { workspaceOnly: true }, elevated: { enabled: false } },
  };
}
/** Where the OS keeps that file. It is written again before every run, so what is on disk is never what runs by accident. */
export const pinnedFile = (root: string) => join(root, ".operator-data", "ceo", "openclaw-worker.json");

/**
 * The one command that does work: a single headless turn under the pinned settings, whose files stay in
 * `cwd`, read from standard input, answered as JSON, stopped at a deadline. `agent exec` has no channel to deliver to.
 */
export const workArgs = (cwd: string, minutes: number, config: string) =>
  ["agent", "exec", "--message-file", "-", "--cwd", cwd, "--config", config, "--json", "--timeout", String(Math.round(minutes * 60))];
const isWork = (args: string[], config: string | undefined) => {
  const [cwd, seconds] = [args[5], Number(args[10])];
  return args.length === 11 && !!config && typeof cwd === "string" && cwd.startsWith("/") && Number.isInteger(seconds) && seconds > 0 && seconds <= 3600 &&
    workArgs(cwd, seconds / 60, config).join("\0") === args.join("\0");
};
/** Never passed, whatever is added later: these send a reply out through a channel. */
export const NEVER_FLAGS = ["--deliver", "--channel", "--reply-channel", "--reply-to", "--reply-account", "--to", "-t", "--token", "--password"];
/** Never run, but for the two exact shapes above (the work turn and the model's name): these message people, connect accounts, change what OpenClaw may do, or print the gateway token. */
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
function fixedCalls(run: Run, config: string | undefined): Run {
  const reads = Object.values(READS).map((args) => args.join("\0")), model = READS.model.join("\0");
  return (args, options) => {
    const shape = args.join("\0");
    const read = reads.includes(shape) && (!NEVER_COMMANDS.includes(args[0]) || shape === model);
    if ((!read && !isWork(args, config)) || args.some((arg) => NEVER_FLAGS.includes(arg.split("=")[0])))
      return Promise.reject(new Error("That is not something the OS asks of OpenClaw."));
    return run(args, options);
  };
}

/** The last JSON object a command printed, or nothing. OpenClaw may print a line or two before it. */
function lastJson(stdout: string): any {
  const text = stdout.trim();
  for (const candidate of [text.split("\n").filter((line) => line.startsWith("{")).at(-1), text.slice(Math.max(0, text.indexOf("{"))), text])
    try { if (candidate) return JSON.parse(candidate); } catch { /* try the next reading */ }
  return undefined;
}

/** The JSON envelope `agent exec --json` writes, as a result. Anything else is a failure that says what came back. */
export function readResult(code: number, stdout: string, stderr: string, minutes: number): OpenclawResult {
  const envelope = lastJson(stdout);
  const cost = typeof envelope?.costUsd === "number" && Number.isFinite(envelope.costUsd) && envelope.costUsd >= 0 ? { costUsd: envelope.costUsd } : {};
  // What it says it used. Its settings give it file tools only, so any other name means they did not hold.
  const used: unknown[] = Array.isArray(envelope?.toolSummary?.tools) ? envelope.toolSummary.tools : [];
  const outside = [...new Set(used.map((tool) => String((tool as any)?.name ?? tool)).filter((name) => !FILE_TOOLS.includes(name)))].slice(0, 12);
  if (outside.length) return { status: "failed", note: `It used tools outside its limits (${outside.join(", ").slice(0, 200)}), so nothing more is handed to it until you have looked. What it made is in its work folder.`, ...cost, outside };
  const final = typeof envelope?.final === "string" ? envelope.final.trim() : "";
  if (code === 0 && envelope?.ok === true && envelope.status === "ok") return { status: "done", note: final.slice(-1500) || "It finished without a summary.", ...cost };
  if (code === 2 || envelope?.status === "timeout") return { status: "failed", note: `It was stopped at the ${minutes}-minute limit before it finished.`, ...cost };
  const why = typeof envelope?.error?.message === "string" ? envelope.error.message : stderr.trim().split("\n").at(-1) ?? "";
  return { status: "failed", note: why.slice(0, 600) || "It failed without saying why.", ...cost };
}

/** What `gateway status --json` says, kept to whether it answers, whether it is local, and a bare local address. */
export function readGateway(stdout: string): Pick<OpenclawStatus, "gateway" | "localOnly" | "address"> {
  const report = lastJson(stdout);
  if (!report || typeof report !== "object") return { gateway: "unknown" };
  if (report.service?.runtime?.status !== "running" || report.rpc?.ok !== true) return { gateway: "stopped" };
  let address: string | undefined;
  try {
    const link = new URL(String(report.gateway?.controlUiLinks?.httpUrl ?? ""));
    // Only the plain address of this computer: nothing after it that could carry the token.
    if (link.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(link.hostname) && !link.username && !link.password && !link.search && !link.hash) address = `${link.origin}/`;
  } catch { /* no address to show */ }
  return { gateway: "running", ...(report.gateway?.bindMode === "loopback" ? { localOnly: true } : {}), ...(address ? { address } : {}) };
}

/** The model OpenClaw uses, from `config get agents.defaults.model --json`: a name, or the first of a list. */
export function readModel(stdout: string): string | undefined {
  let value: any;
  try { value = JSON.parse(stdout.trim()); } catch { return undefined; }
  const model = typeof value === "string" ? value : value?.primary;
  return typeof model === "string" && model.length <= 200 && MODEL.test(model) ? model : undefined;
}

function savePinned(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, file);
}

export function openclaw(options: Lookup & { run?: Run; /** The OS folder; without it there is nowhere to keep the pinned settings, and no work runs. */ root?: string; save?: (file: string, text: string) => void } = {}) {
  const paths = options.run ? undefined : openclawPaths(options);
  const installed = options.run ? true : !!paths;
  const config = options.root ? pinnedFile(options.root) : undefined;
  const run = fixedCalls(options.run ?? command(paths), config);
  /** Set when a run used a tool its settings do not give it. It stays set until the voice brain is restarted. */
  let stopped: string | undefined;

  return {
    installed: () => installed,
    /** Why the next task cannot go to OpenClaw, or nothing when it can: installed, limits agreed, and within them. */
    workerProblem(context: { limits?: OpenclawLimits; tasks?: CeoTask[] } = {}): string | undefined {
      if (!installed) return NOT_INSTALLED;
      if (!context.limits || !config) return NOT_CLEARED;
      return stopped ?? overLimits(context.limits, context.tasks ?? []);
    },
    /** Runs one task to the end in its own folder inside the agreed one. Resolves with how it ended; never throws. */
    async work(input: { id: string; prompt: string; limits: OpenclawLimits; signal?: AbortSignal; makeFolder?: (folder: string) => void }): Promise<OpenclawResult> {
      if (!/^[0-9a-f-]{36}$/.test(input.id)) return { status: "failed", note: "The task had no usable id." };
      if (!config || stopped) return { status: "failed", note: stopped ?? NOT_CLEARED };
      const folder = join(input.limits.folder, input.id), minutes = input.limits.minutes;
      try { (options.save ?? savePinned)(config, `${JSON.stringify(pinnedConfig(input.limits.model), null, 2)}\n`); }
      catch { return { status: "failed", note: "The settings it runs under could not be written, so it was not started." }; }
      try { (input.makeFolder ?? ((path) => mkdirSync(path, { recursive: true, mode: 0o700 })))(folder); }
      catch { return { status: "failed", note: `Its work folder could not be made: ${folder}` }; }
      // A minute past OpenClaw's own deadline, so its timeout answers first and cleans up after itself.
      const result = await run(workArgs(folder, minutes, config), { input: input.prompt, timeoutMs: (minutes + 1) * 60_000, signal: input.signal }).then(
        ({ code, stdout, stderr }) => readResult(code, stdout, stderr, minutes),
        (error): OpenclawResult => ({ status: "failed", note: (error as Error).name === "AbortError" || (error as Error).name === "TimeoutError" ? `It was stopped at the ${minutes}-minute limit.` : (error as Error).message }),
      );
      if (result.outside) stopped = `OpenClaw used tools outside its limits on its last task (${result.outside.join(", ").slice(0, 200)}), so it takes no more work until the person has looked and Jarvis is restarted. Hermes, Claude Code and Codex can take work.`;
      return result;
    },
    async status(signal?: AbortSignal): Promise<OpenclawStatus> {
      if (!installed) return { installed: false };
      const [version, gateway, model] = await Promise.all([
        run([...READS.version], { signal }).then(({ stdout }) => /OpenClaw\s+(\d[\w.-]*)/.exec(stdout)?.[1], () => undefined),
        run([...READS.gateway], { signal }).then(({ stdout }) => readGateway(stdout), (): ReturnType<typeof readGateway> => ({ gateway: "unknown" })),
        run([...READS.model], { signal }).then(({ code, stdout }) => (code === 0 ? readModel(stdout) : undefined), () => undefined),
      ]);
      return { installed: true, ...(version ? { version } : {}), ...(model ? { model } : {}), ...gateway };
    },
  };
}
