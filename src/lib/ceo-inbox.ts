/**
 * What the Jarvis page shows: what is waiting for the person's yes, and the
 * work Jarvis has handed out. Kept free of the browser so it is tested directly.
 */
export type InboxApproval = {
  id: string;
  /** The sentence that was read aloud. */
  action: string;
  detail?: string;
  status: "pending" | "approved" | "declined";
  by?: "voice" | "button";
  createdAt: string;
  resolvedAt?: string;
};
export type InboxTask = {
  id: string;
  agent: "hermes" | "claude_code" | "codex" | "openclaw";
  title: string;
  task: string;
  ref?: string;
  status: "queued" | "running" | "blocked" | "done" | "failed";
  note?: string;
  createdAt: string;
  updatedAt: string;
};
export type InboxReport = { id: string; kind: "plan" | "review"; title: string; text: string; at: string };
export type InboxView = {
  /** Waiting for a yes or no, the oldest first. */
  waiting: InboxApproval[];
  decided: InboxApproval[];
  /** Work run by Claude Code or Codex carries its OS job; `card` says the OS has that job, with its own approve and deny, to show. */
  tasks: (InboxTask & { job?: { id: string; agent: "claude" | "codex" }; card: boolean })[];
  needsYou: number;
  /** What the scheduled check-ins wrote, the newest first. */
  reports: InboxReport[];
};

export const AGENT_LABEL: Record<InboxTask["agent"], string> = { hermes: "Hermes", claude_code: "Claude Code", codex: "Codex", openclaw: "OpenClaw" };
export const STATUS_LABEL: Record<InboxTask["status"], string> = { queued: "Starting", running: "Working", blocked: "Needs you", done: "Done", failed: "Stopped" };

const DECIDED_SHOWN = 5;
const TASKS_SHOWN = 20;
const REPORTS_SHOWN = 6;
const FINISHED: InboxTask["status"][] = ["done", "failed"];
/** An OS job's state in the words used for Jarvis's tasks, as the server records it on its next sync. */
const LIVE: Record<string, InboxTask["status"]> = { queued: "queued", running: "running", needs_input: "blocked", completed: "done", cancelled: "failed", failed: "failed" };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown) => (Array.isArray(value) ? value.filter(record) : []);
const newest = (a: { createdAt: string }, b: { createdAt: string }) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

export function ago(at: string, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return minutes < 1440 ? `${Math.floor(minutes / 60)} h ago` : `${Math.floor(minutes / 1440)} d ago`;
}

/** `jobs` is the OS's own job list. A task follows its job from there, which changes sooner than the saved record. */
export function inboxView(reply: { approvals?: unknown; tasks?: unknown; reports?: unknown } | null | undefined, jobs?: unknown): InboxView {
  const approvals = list(reply?.approvals).filter(
    (item) => typeof item.id === "string" && typeof item.action === "string" && typeof item.createdAt === "string" && ["pending", "approved", "declined"].includes(item.status as string),
  ) as InboxApproval[];
  const runs = new Map<string, string>();
  for (const job of list(jobs))
    for (const run of list(job.runs)) if (typeof job.id === "string" && typeof run.agent === "string" && typeof run.status === "string") runs.set(`${job.id} ${run.agent}`, run.status);
  const saved = list(reply?.tasks).filter(
    (item) => typeof item.id === "string" && typeof item.title === "string" && typeof item.createdAt === "string" && Object.hasOwn(AGENT_LABEL, String(item.agent)) && Object.hasOwn(STATUS_LABEL, String(item.status)),
  ) as InboxTask[];
  const tasks = saved.map((task) => {
    // Only Claude Code and Codex work is an OS job; OpenClaw's runs in the voice brain.
    const job = (task.agent === "claude_code" || task.agent === "codex") && task.ref ? { id: task.ref, agent: task.agent === "codex" ? ("codex" as const) : ("claude" as const) } : undefined;
    const live = job && runs.get(`${job.id} ${job.agent}`);
    return { ...task, ...(job ? { job } : {}), card: live !== undefined, status: live !== undefined && Object.hasOwn(LIVE, live) ? LIVE[live] : task.status };
  });
  const open = tasks.filter((task) => !FINISHED.includes(task.status)).sort(newest);
  const finished = tasks.filter((task) => FINISHED.includes(task.status)).sort(newest);
  const waiting = approvals.filter((item) => item.status === "pending").sort((a, b) => newest(b, a));
  return {
    waiting,
    decided: approvals
      .filter((item) => item.status !== "pending")
      .sort((a, b) => Date.parse(b.resolvedAt ?? b.createdAt) - Date.parse(a.resolvedAt ?? a.createdAt))
      .slice(0, DECIDED_SHOWN),
    tasks: [...open, ...finished].slice(0, TASKS_SHOWN),
    needsYou: waiting.length + open.filter((task) => task.status === "blocked").length,
    reports: (list(reply?.reports).filter(
      (item) => typeof item.id === "string" && typeof item.title === "string" && typeof item.text === "string" && !Number.isNaN(Date.parse(String(item.at))) && (item.kind === "plan" || item.kind === "review"),
    ) as InboxReport[])
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, REPORTS_SHOWN),
  };
}
