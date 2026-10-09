#!/usr/bin/env bun
/**
 * doctor.ts
 *
 * One command that says what is wrong with the OS on this computer, and what to
 * do about it, in plain words:
 *
 *   bun run doctor
 *
 * It only reads: whether the three background jobs are loaded and answer, the
 * last lines of their logs, Claude Code's sign-in as the OS sees it, whether the
 * voice brain has an Anthropic key, the public tunnel's address, and OpenClaw.
 * It changes nothing, prints no key or token, and sends nothing anywhere but
 * this computer.
 */
import { execFile, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { assistantBinary, claudeSignInStatus } from "./assistant-runtime";
import { openclaw } from "./ceo-openclaw";
import { openclawLimits } from "./ceo-openclaw-limits";
import { BRAIN_PORT, DASHBOARD_PORT, JOB_NAMES, LABELS, tunnelHost, type JobName } from "./install-ceo-brain";
import { providerKey } from "./provider-config";

export type Finding = { area: string; status: "ok" | "warn" | "fail"; says: string; fix?: string };
/** What the probes saw. Every field is optional, so a probe that could not run leaves a gap rather than a guess. */
export type Seen = {
  /** `listening` is false when nothing took the connection at all, as opposed to a page that never came back. */
  jobs?: Partial<Record<JobName, { loaded: boolean; answered: boolean; ms: number; listening?: boolean }>>;
  logs?: Partial<Record<JobName, string>>;
  claude?: { installed: boolean; ready: boolean; detail: string; ms: number };
  anthropicKey?: boolean;
  tunnel?: { saved: string; live?: string[] };
  openclaw?: { installed: boolean; version?: string; agreed: boolean };
};

/** The OS gives up on Claude Code's sign-in check after this long (assistant-runtime.ts). */
export const CLAUDE_CHECK_MS = 4000;
const RESTART = (name: JobName) => `bun run install:ceo --apply --only ${name}`;

/** Known failures in a job's log, newest first. Only the part since the job last started counts as current. */
const SIGNS: { job: JobName; match: RegExp; says: string; fix: string }[] = [
  { job: "brain", match: /credit balance is too low/i, says: "Jarvis cannot think: the Anthropic API account has no credits left.",
    fix: "Add credits at console.anthropic.com → Settings → Billing, and turn on auto-reload. A Claude Pro or Max plan does not cover the API." },
  { job: "brain", match: /authentication_error|invalid x-api-key/i, says: "Anthropic refused the voice brain's API key.",
    fix: `Make a new key at console.anthropic.com → API Keys, put it in ~/.config/agentic-os.env as ANTHROPIC_API_KEY, then: ${RESTART("brain")}` },
  { job: "brain", match: /EADDRINUSE|address already in use/i, says: `Another program holds the brain's port (${BRAIN_PORT}).`,
    fix: `See which with: lsof -nP -iTCP:${BRAIN_PORT} -sTCP:LISTEN. Stop it, then: ${RESTART("brain")}` },
  { job: "dashboard", match: /Cannot find module|Failed to resolve import|SyntaxError/i, says: "The dashboard's code did not load: a package or file is missing or half-updated.",
    fix: `Run: git status && bun install, then: ${RESTART("dashboard")}` },
  { job: "dashboard", match: /Port \d+ is already in use/i, says: `The dashboard job could not start: another program holds port ${DASHBOARD_PORT}.`,
    fix: `See which with: lsof -nP -iTCP:${DASHBOARD_PORT} -sTCP:LISTEN. Stop it (a copy started with bun run start, say), then: ${RESTART("dashboard")}` },
];

/** The log since the job's most recent start, and what came before it. */
export function sinceStart(job: JobName, log: string) {
  const marker = job === "brain" ? /^Speech Engine /m : /VITE v[\d.]+\s+ready/m;
  const starts = [...log.matchAll(new RegExp(marker.source, "gm"))];
  const at = starts.at(-1)?.index ?? 0;
  return { before: log.slice(0, at), current: log.slice(at) };
}

/** Turns what was seen into findings, the worst first. Pure, so every message can be proven without a Mac. */
export function diagnose(seen: Seen): Finding[] {
  const found: Finding[] = [];
  for (const name of JOB_NAMES) {
    const job = seen.jobs?.[name];
    if (!job) continue;
    const area = name === "brain" ? "Jarvis's brain" : name === "tunnel" ? "Tunnel job" : "Dashboard";
    if (!job.loaded) found.push({ area, status: "fail", says: "The background job is not installed, so nothing keeps it running.", fix: RESTART(name) });
    else if (!job.answered) found.push({ area, status: "fail",
      says: job.listening === false
        ? `Installed, but nothing was listening on its port for ${Math.round(job.ms / 1000)} s: it stopped, or keeps failing to start.`
        : `Installed, but it did not answer within ${Math.round(job.ms / 1000)} s.`,
      fix: `Look at the end of its log: tail -n 40 .operator-data/ceo/logs/${name}.log. To restart it: ${RESTART(name)}` });
    else found.push({ area, status: job.ms > 5000 ? "warn" : "ok", says: job.ms > 5000 ? `Answering, but slowly (${(job.ms / 1000).toFixed(1)} s).` : "Running and answering." });
  }
  for (const sign of SIGNS) {
    const log = seen.logs?.[sign.job];
    if (!log) continue;
    const { before, current } = sinceStart(sign.job, log);
    if (sign.match.test(current)) found.push({ area: "Log", status: "fail", says: sign.says, fix: sign.fix });
    else if (sign.match.test(before)) found.push({ area: "Log", status: "warn", says: `Before its last restart: ${sign.says}`, fix: `If this has not been fixed since, it will happen again. ${sign.fix}` });
  }
  if (seen.claude) {
    const { installed, ready, detail, ms } = seen.claude;
    if (!installed) found.push({ area: "Claude Code", status: "fail", says: "The OS cannot find the claude program, so Chat and coding tasks cannot use Claude.",
      fix: "If `claude` works in Terminal, link it where the OS looks: mkdir -p ~/.local/bin && ln -sf \"$(which claude)\" ~/.local/bin/claude" });
    else if (!ready) found.push({ area: "Claude Code", status: "fail", says: detail, fix: "Run: claude auth login, then refresh Models in the OS." });
    else if (ms > CLAUDE_CHECK_MS) found.push({ area: "Claude Code", status: "warn", says: `Signed in, but the check took ${(ms / 1000).toFixed(1)} s; the OS gives up after ${CLAUDE_CHECK_MS / 1000} s, so it may show Claude as not signed in.`,
      fix: "Refresh Models once or twice; a second check is usually faster." });
    else found.push({ area: "Claude Code", status: "ok", says: "Signed in, and the OS can see it." });
  }
  if (seen.anthropicKey === false) found.push({ area: "Jarvis's brain", status: "fail", says: "No ANTHROPIC_API_KEY is set, so Jarvis falls back to another model or cannot answer.",
    fix: `Add ANTHROPIC_API_KEY=… to ~/.config/agentic-os.env (open -e ~/.config/agentic-os.env), then: ${RESTART("brain")}` });
  if (seen.tunnel) {
    const { saved, live } = seen.tunnel;
    if (!saved) found.push({ area: "Public tunnel", status: "warn", says: "No public address is saved, so ElevenLabs has nowhere to reach Jarvis.", fix: "Run: bun run speech:create wss://<your-ngrok-domain>/ws" });
    else if (live && !live.includes(saved)) found.push({ area: "Public tunnel", status: "fail", says: `ElevenLabs calls ${saved}, but the tunnel is open at ${live.join(", ") || "no address"}.`,
      fix: `Restart the tunnel on its saved address: ${RESTART("tunnel")}` });
    else if (live) found.push({ area: "Public tunnel", status: "ok", says: `Open at ${saved}, the address ElevenLabs calls.` });
  }
  if (seen.openclaw) {
    const { installed, version, agreed } = seen.openclaw;
    if (!installed) found.push({ area: "OpenClaw", status: "ok", says: "Not installed. Jarvis hands it nothing." });
    else found.push({ area: "OpenClaw", status: "ok", says: `Version ${version ?? "unknown"}; ${agreed ? "takes work from Jarvis within the limits you agreed to" : "takes no work until you agree to its limits on the OpenClaw page"}.` });
  }
  const order = { fail: 0, warn: 1, ok: 2 };
  return found.sort((a, b) => order[a.status] - order[b.status]);
}

/** Reads the end of a file without loading a large log whole. */
function tail(file: string, bytes = 64_000) {
  let handle: number | undefined;
  try {
    const size = statSync(file).size, length = Math.min(size, bytes), buffer = Buffer.alloc(length);
    handle = openSync(file, "r");
    readSync(handle, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch { return ""; }
  finally { if (handle !== undefined) closeSync(handle); }
}

async function timed<T>(work: () => Promise<T>) {
  const start = Date.now();
  const value = await work();
  return { value, ms: Date.now() - start };
}

/** Asks this computer, and only this computer, what is running. */
async function look(root: string): Promise<Seen> {
  // A job restarted a moment ago refuses connections until it is up, so a refusal is asked again for a while
  // before it counts. A connection that is taken but never answered is not asked again.
  const answers = (url: string) => timed(async () => {
    const until = Date.now() + 30_000;
    for (;;) {
      const tried = Date.now();
      const answer = await fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => r.ok, (error: Error) => (error.name === "TimeoutError" ? "slow" : "refused"));
      if (answer === true || answer === false) return { answered: answer, listening: true };
      if (answer === "slow" || Date.now() >= until) return { answered: false, listening: answer === "slow" };
      await Bun.sleep(Math.max(0, 1000 - (Date.now() - tried)));
    }
  });
  const urls: Record<JobName, string> = { brain: `http://127.0.0.1:${BRAIN_PORT}/health`, tunnel: "http://127.0.0.1:4040/api/tunnels", dashboard: `http://127.0.0.1:${DASHBOARD_PORT}/` };
  const domain = `gui/${process.getuid?.() ?? 501}`;
  const jobs: Seen["jobs"] = {}, logs: Seen["logs"] = {};
  // The background jobs are launchd's (install-ceo-brain.ts), so they exist only on a Mac.
  if (process.platform === "darwin") await Promise.all(JOB_NAMES.map(async (name) => {
    const { value, ms } = await answers(urls[name]);
    const loaded = spawnSync("launchctl", ["print", `${domain}/${LABELS[name]}`]).status === 0;
    jobs[name] = { loaded, ...value, ms };
    logs[name] = tail(join(root, ".operator-data", "ceo", "logs", `${name}.log`));
  }));

  // The same check the OS makes, given longer, so a slow answer shows as slow rather than as signed out.
  const claudeRun = async (file: string, args: string[], options: object) => {
    const result = await promisify(execFile)(file, args, { ...options, timeout: 20_000, encoding: "utf8" });
    return { stdout: String(result.stdout) };
  };
  const claude = await timed(() => claudeSignInStatus(assistantBinary("claude"), claudeRun));

  const saved = (() => {
    const file = join(root, ".operator-data", "speech-engine.json");
    try { return existsSync(file) ? tunnelHost(JSON.parse(readFileSync(file, "utf8")).wsUrl) : ""; } catch { return ""; }
  })();
  const live = jobs.tunnel?.answered
    ? await fetch(urls.tunnel, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then(
      (body: { tunnels?: { public_url?: unknown }[] }) =>
        (Array.isArray(body?.tunnels) ? body.tunnels.map((t) => String(t?.public_url ?? "").replace(/^https?:\/\//, "")).filter(Boolean) : []),
      () => undefined)
    : undefined;

  const claw = openclaw(), status = await claw.status(AbortSignal.timeout(15_000)).catch(() => ({ installed: claw.installed() }) as { installed: boolean; version?: string });

  return {
    jobs, logs,
    claude: { ...claude.value, ms: claude.ms },
    anthropicKey: !!providerKey(root, "ANTHROPIC_API_KEY"),
    tunnel: { saved, live },
    openclaw: { installed: status.installed, version: status.version, agreed: !!openclawLimits(root).read() },
  };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  console.log("Checking the OS on this computer…\n");
  const findings = diagnose(await look(root));
  const mark = { ok: "✅", warn: "⚠️ ", fail: "❌" };
  for (const item of findings) {
    console.log(`${mark[item.status]} ${item.area}: ${item.says}`);
    if (item.fix && item.status !== "ok") console.log(`   → ${item.fix}`);
  }
  const broken = findings.filter((item) => item.status === "fail").length;
  console.log(broken ? `\n${broken} thing${broken === 1 ? "" : "s"} to fix, the most important first.` : "\nNothing is broken.");
  process.exit(broken ? 1 : 0);
}
