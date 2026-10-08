/**
 * ceo-reports.ts
 *
 * Reads what Jarvis's two scheduled check-ins wrote and keeps it with the CEO
 * records. The check-ins are Hermes cron jobs in the worker profile
 * (scripts/install-ceo-heartbeat.ts prints them; the person creates them).
 * Hermes saves each run as <profile>/cron/output/<job id>/<time>.md. This only
 * reads those files: the scheduled agent itself never writes into the OS.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WORKER } from "./ceo-hermes";
import type { CeoReport, CeoStore } from "./ceo-store";

/** The check-ins, by the name each job is created with. */
export const CHECK_INS: Record<string, { kind: CeoReport["kind"]; title: string }> = {
  "jarvis-morning-plan": { kind: "plan", title: "Morning plan" },
  "jarvis-work-review": { kind: "review", title: "Work review" },
};
export type CheckIn = { id: string; name: string; enabled: boolean; schedule: string; lastRun?: string };

const MAX_FILE = 512 * 1024;
const NEWEST_RUNS = 5;
const count = (value: string) => [...value].length;

/** What the agent answered in one saved run, without the prompt Hermes stores above it. "" when it said nothing worth keeping. */
export function runAnswer(document: string) {
  let answer: string | undefined;
  // Hermes stamps the answer's length in characters, so a heading quoted inside the prompt or the answer is not taken for the real one.
  for (const frame of document.matchAll(/^\*\*Response Characters:\*\* (\d+)\n## Response\n\n/gm)) {
    const rest = document.slice(frame.index + frame[0].length);
    if (count(rest) === Number(frame[1]) + 1 && rest.endsWith("\n")) { answer = rest; break; }
  }
  // Runs with no agent answer (an error, a blocked prompt) are kept whole, without the stored prompt.
  answer ??= document.includes("## Response") ? document.slice(document.lastIndexOf("## Response") + 11) : document.split(/^## Prompt$/m)[0];
  answer = answer.trim();
  return /^\[?(SILENT|NO_REPLY)\]?$/i.test(answer) || /wakeAgent=false/.test(answer) ? "" : answer;
}

function safeFile(file: string) {
  const info = lstatSync(file);
  return info.isFile() && info.size <= MAX_FILE ? info : undefined;
}

export function hermesCheckIns(options: { home?: string } = {}) {
  const cron = join(options.home ?? join(homedir(), ".hermes"), "profiles", WORKER, "cron");
  /** The check-in jobs Hermes has, if any. Reading only. */
  function jobs(): CheckIn[] {
    const file = join(cron, "jobs.json");
    if (!existsSync(file) || !safeFile(file)) return [];
    const stored = JSON.parse(readFileSync(file, "utf8"));
    const list: unknown[] = Array.isArray(stored) ? stored : Array.isArray(stored?.jobs) ? stored.jobs : [];
    return list.flatMap((job: any) =>
      job && typeof job.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(job.id) && typeof job.name === "string" && Object.hasOwn(CHECK_INS, job.name)
        ? [{
            id: job.id, name: job.name, enabled: job.enabled !== false && job.state !== "paused" && !job.paused_at,
            schedule: String(job.schedule_display ?? job.schedule?.display ?? job.schedule?.expr ?? "").slice(0, 80),
            ...(typeof job.last_run_at === "string" ? { lastRun: job.last_run_at } : {}),
          }]
        : [],
    );
  }
  /** Runs that said nothing, so they are read once. */
  const empty = new Set<string>();
  return {
    jobs,
    /** Records each check-in's newest runs that are not on record yet. Answers how many it added. */
    importInto(store: CeoStore) {
      let known: Set<string> | undefined, added = 0;
      for (const job of jobs()) {
        const directory = join(cron, "output", job.id);
        if (!existsSync(directory)) continue;
        const runs = readdirSync(directory).filter((name) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/.test(name)).sort().slice(-NEWEST_RUNS);
        for (const name of runs) {
          const key = `${job.id}/${name}`;
          known ??= new Set(store.reports().map((item) => item.key));
          if (known.has(key) || empty.has(key)) continue;
          const info = safeFile(join(directory, name));
          if (!info) continue;
          const document = readFileSync(join(directory, name), "utf8"), text = runAnswer(document);
          if (!text) { empty.add(key); continue; }
          // A run Hermes stopped or refused has no answer, only its own account of why.
          const { kind, title } = CHECK_INS[job.name];
          store.addReport({ key, kind, title: document.includes("## Response") ? title : `${title}: did not run`, text, at: info.mtime.toISOString() });
          known.add(key);
          added++;
        }
      }
      return added;
    },
  };
}
