#!/usr/bin/env bun
/**
 * install-ceo-brain.ts
 *
 * Keeps Jarvis running without a terminal, on macOS via launchd. Three jobs, each
 * restarted if it stops and started again at login:
 *
 *   com.agentic-os.ceo-brain   the voice brain (scripts/speech-engine.ts serve, port 3001; test page 3002)
 *   com.agentic-os.ceo-tunnel  the public tunnel ElevenLabs reaches the brain through (ngrok, to port 3001)
 *   com.agentic-os.dashboard   the OS itself on port 8081, where wake listening lives
 *
 * Nothing is installed unless you pass --apply. Without it the jobs are only shown.
 *
 *   bun run install:ceo                    # show the three jobs, change nothing
 *   bun run install:ceo --apply            # install and start them
 *   bun run install:ceo --only brain       # limit either of the above (brain, tunnel, dashboard)
 *   bun run install:ceo --status           # what is loaded and what answers
 *   bun run uninstall:ceo                  # stop and remove them
 *
 * The tunnel job carries no ngrok token: ngrok reads its own config file.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type JobName = "brain" | "tunnel" | "dashboard";
export type Job = { name: JobName; label: string; does: string; log: string; plist: string };
export type Missing = { name: JobName; why: string };

export const JOB_NAMES: JobName[] = ["brain", "tunnel", "dashboard"];
export const LABELS: Record<JobName, string> = {
  brain: "com.agentic-os.ceo-brain",
  tunnel: "com.agentic-os.ceo-tunnel",
  dashboard: "com.agentic-os.dashboard",
};
export const BRAIN_PORT = 3001;
export const DASHBOARD_PORT = 8081;

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tunnel's public host, from the address the Speech Engine was created with. */
export function tunnelHost(wsUrl: unknown) {
  return /^wss:\/\/([a-z0-9.-]+)\/ws$/i.exec(typeof wsUrl === "string" ? wsUrl : "")?.[1] ?? "";
}

function plist(options: { label: string; args: string[]; repo: string; home: string; path: string[]; log: string; throttle: number }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${options.label}</string>
  <key>ProgramArguments</key>
  <array>
${options.args.map((arg) => `    <string>${escape(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${escape(options.repo)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${escape([...new Set([...options.path, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])].join(":"))}</string>
    <key>HOME</key><string>${escape(options.home)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>${options.throttle}</integer>
  <key>StandardOutPath</key><string>${escape(options.log)}</string>
  <key>StandardErrorPath</key><string>${escape(options.log)}</string>
</dict>
</plist>
`;
}

/** The jobs as they would be installed. A job whose program or address is missing is listed under `missing` instead. */
export function ceoJobs(options: { repo: string; home: string; bun: string; node: string; ngrok: string; wsUrl?: unknown }): { jobs: Job[]; missing: Missing[] } {
  const { repo, home } = options;
  const logs = join(repo, ".operator-data", "ceo", "logs");
  const jobs: Job[] = [];
  const missing: Missing[] = [];
  // launchd gives a job none of the shell's PATH. ~/.local/bin is where Hermes, Claude Code and Codex are installed.
  const add = (name: JobName, does: string, args: string[], path: string[], throttle: number) => {
    const log = join(logs, `${name}.log`);
    jobs.push({ name, label: LABELS[name], does, log, plist: plist({ label: LABELS[name], args, repo, home, path: [...path, join(home, ".local", "bin")], log, throttle }) });
  };

  // A brain that cannot start (bad key, port taken) checks its key on each try, so it waits a minute between tries.
  if (options.bun) add("brain", `the voice brain on port ${BRAIN_PORT}, with its test page on 3002`,
    [options.bun, "run", join(repo, "scripts", "speech-engine.ts"), "serve"], [dirname(options.bun)], 60);
  else missing.push({ name: "brain", why: "bun was not found." });

  const host = tunnelHost(options.wsUrl);
  if (!options.ngrok) missing.push({ name: "tunnel", why: "ngrok was not found." });
  else if (!host) missing.push({ name: "tunnel", why: "no public address is saved yet. Run: bun run speech:create wss://<public-host>/ws" });
  else add("tunnel", `the public tunnel from ${host} to port ${BRAIN_PORT}`,
    [options.ngrok, "http", `--url=${host}`, String(BRAIN_PORT), "--log=stdout"], [dirname(options.ngrok)], 30);

  // Vite directly, not `bun run start`: that re-seeds data and opens a browser tab on every restart.
  if (options.node) add("dashboard", `the OS on port ${DASHBOARD_PORT}`,
    [options.node, join(repo, "node_modules", "vite", "bin", "vite.js"), "dev", "--port", String(DASHBOARD_PORT), "--strictPort"],
    [dirname(options.node), ...(options.bun ? [dirname(options.bun)] : [])], 10);
  else missing.push({ name: "dashboard", why: "node was not found." });

  return { jobs, missing };
}

if (import.meta.main) {
  const HOME = homedir();
  const REPO = resolve(import.meta.dir, "..");
  const AGENTS = join(HOME, "Library", "LaunchAgents");
  const domain = `gui/${process.getuid?.() ?? 501}`;
  const launchctl = (args: string[]) => spawnSync("launchctl", args, { encoding: "utf8" });
  const which = (name: string) => { const found = spawnSync("which", [name], { encoding: "utf8" }); return found.status === 0 ? found.stdout.trim() : ""; };
  const stop = (message: string): never => { console.error(`\n${message}\n`); process.exit(1); };

  const index = process.argv.indexOf("--only");
  const only = index > 0 ? (process.argv[index + 1] ?? "").split(",").filter(Boolean) : JOB_NAMES;
  const unknown = only.filter((name) => !JOB_NAMES.includes(name as JobName));
  if (unknown.length || !only.length) stop(`Use --only with any of: ${JOB_NAMES.join(", ")}`);
  const wanted = JOB_NAMES.filter((name) => only.includes(name));
  const path = (name: JobName) => join(AGENTS, `${LABELS[name]}.plist`);

  if (process.argv.includes("--uninstall")) {
    for (const name of wanted) {
      launchctl(["bootout", `${domain}/${LABELS[name]}`]);
      if (existsSync(path(name))) unlinkSync(path(name));
      console.log(`Removed ${LABELS[name]}.`);
    }
  } else if (process.argv.includes("--status")) {
    const answers = async (url: string) => { try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
    const up: Record<JobName, boolean> = {
      brain: await answers(`http://127.0.0.1:${BRAIN_PORT}/health`),
      tunnel: await answers("http://127.0.0.1:4040/api/tunnels"),
      dashboard: await answers(`http://127.0.0.1:${DASHBOARD_PORT}/`),
    };
    for (const name of wanted) {
      const loaded = launchctl(["print", `${domain}/${LABELS[name]}`]).status === 0;
      console.log(`${LABELS[name].padEnd(28)} ${loaded ? "installed    " : "not installed"}  ${up[name] ? "answering" : "not answering"}`);
    }
  } else {
    if (process.platform !== "darwin") stop("This installer is for macOS (launchd).");
    const saved = join(REPO, ".operator-data", "speech-engine.json");
    const wsUrl = existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")).wsUrl : undefined;
    const all = ceoJobs({ repo: REPO, home: HOME, bun: process.execPath, node: which("node"), ngrok: which("ngrok"), wsUrl });
    const jobs = all.jobs.filter((job) => wanted.includes(job.name));
    const missing = all.missing.filter((job) => wanted.includes(job.name));
    for (const job of missing) console.error(`Cannot set up ${LABELS[job.name]}: ${job.why}`);

    if (!process.argv.includes("--apply")) {
      for (const job of jobs) console.log(`\n# ${job.label}: ${job.does}\n# would be written to ${path(job.name)}\n${job.plist}`);
      console.log(`Nothing was installed. To install ${jobs.length === 1 ? "this job" : `these ${jobs.length} jobs`}: bun run install:ceo --apply${index > 0 ? ` --only ${wanted.join(",")}` : ""}`);
      if (jobs.some((job) => job.name === "dashboard")) console.log(`Once the dashboard job holds port ${DASHBOARD_PORT}, anything else started on that port (bun run start, a preview) will fail until the job is removed.`);
    } else {
      if (missing.length) stop("Nothing was installed. Fix the above, or leave that job out with --only.");
      mkdirSync(AGENTS, { recursive: true });
      mkdirSync(join(REPO, ".operator-data", "ceo", "logs"), { recursive: true, mode: 0o700 });
      for (const job of jobs) {
        // A job that is already running takes a moment to stop, and launchd refuses to start it again until it has.
        launchctl(["bootout", `${domain}/${job.label}`]);
        for (let tries = 0; tries < 40 && launchctl(["print", `${domain}/${job.label}`]).status === 0; tries++) await Bun.sleep(250);
        writeFileSync(path(job.name), job.plist);
        const load = launchctl(["bootstrap", domain, path(job.name)]);
        if (load.status !== 0) stop(`launchctl could not start ${job.label}: ${(load.stderr || load.stdout || "").trim()}`);
        console.log(`Installed ${job.label}: ${job.does}.\n  Log: ${job.log}`);
      }
      console.log("\nCheck them with: bun run install:ceo --status\nRemove them with: bun run uninstall:ceo");
    }
  }
}
