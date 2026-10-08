/**
 * ceo-store.ts
 *
 * What the voice CEO keeps between conversations: the work it handed out, the
 * outside actions waiting for the person's yes, and what its scheduled check-ins
 * wrote. The voice brain and the dashboard both change these files, so each
 * change takes a lock, re-reads the file and replaces it whole.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CeoAgent = "hermes" | "claude_code" | "codex";
export type CeoTaskStatus = "queued" | "running" | "blocked" | "done" | "failed";
export type CeoTask = {
  id: string;
  /** A spoken turn can run twice; the same request in the same conversation is the same task. */
  key: string;
  agent: CeoAgent; title: string; task: string;
  /** The agent's own id for it: a Hermes card or an OS agent job. */
  ref?: string;
  /** Last known. The agent's own record is the truth (ceo-sync.ts). */
  status: CeoTaskStatus;
  /** What the agent last said about it: a result, or why it stopped. */
  note?: string;
  conversationId?: string; createdAt: string; updatedAt: string;
};
export type CeoApproval = {
  id: string; key: string;
  /** One sentence, read aloud to the person word for word. */
  action: string;
  detail?: string;
  status: "pending" | "approved" | "declined";
  /** Who decided: the person's spoken yes or no, or the button in the OS. Never the model. */
  by?: "voice" | "button";
  conversationId?: string; createdAt: string; resolvedAt?: string;
};
/** What a scheduled check-in wrote: the morning plan, or a review of the handed-out work. */
export type CeoReport = {
  id: string;
  /** The run it came from. The same run is never recorded twice. */
  key: string;
  kind: "plan" | "review"; title: string; text: string;
  /** When the check-in ran. */
  at: string;
};
export type CeoStore = ReturnType<typeof ceoStore>;

const FINISHED: CeoTaskStatus[] = ["done", "failed"];
const AGENT: Record<CeoAgent, string> = { hermes: "Hermes", claude_code: "Claude Code", codex: "Codex" };
const iso = () => new Date().toISOString();
const text = (value: unknown, max: number) => (typeof value === "string" ? value : "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

/** The same words, whatever their case, spacing or punctuation, make the same key. */
export const ceoKey = (...parts: string[]) =>
  createHash("sha256").update(parts.map((part) => part.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()).join("\n")).digest("hex").slice(0, 32);

export const ago = (at: string, now = Date.now()) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
};

/** One change at a time, across programs. A change takes milliseconds, so an old lock was left by a program that stopped. */
function locked<T>(directory: string, work: () => T): T {
  const lock = join(directory, ".lock");
  for (let tries = 0; ; tries++) {
    try { mkdirSync(lock); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (tries > 300) throw new Error("The CEO records are busy. Try again.");
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; }
      if (age > 5_000) { try { rmdirSync(lock); } catch { /* another program cleared it first */ } }
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return work(); }
  finally { try { rmdirSync(lock); } catch { /* cleared as stale by another program */ } }
}

/** Drops the oldest finished records beyond the limit; ones still open are always kept. */
function trim<T>(items: T[], max: number, finished: (item: T) => boolean) {
  for (let i = 0; items.length > max && i < items.length; ) if (finished(items[i])) items.splice(i, 1); else i++;
}

export function ceoStore(root: string) {
  const directory = join(root, ".operator-data", "ceo");
  function read<T>(name: string): T[] {
    const file = join(directory, `${name}.json`);
    if (!existsSync(file)) return [];
    const info = lstatSync(file);
    if (info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error("The CEO records cannot be opened safely.");
    let stored: { version?: number; items?: T[] };
    try { stored = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("The CEO records could not be read. They were left untouched."); }
    if (stored?.version !== 1 || !Array.isArray(stored.items)) throw new Error("The CEO records have an unsupported format.");
    return stored.items;
  }
  function change<T, R>(name: string, work: (items: T[]) => R): R {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return locked(directory, () => {
      const items = read<T>(name), result = work(items);
      const file = join(directory, `${name}.json`), temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 });
      renameSync(temporary, file);
      chmodSync(file, 0o600);
      return result;
    });
  }

  return {
    tasks: () => read<CeoTask>("tasks"),
    /** Records handed-out work. Asked twice with the same key, it answers with the first record. */
    addTask(input: { key: string; agent: CeoAgent; title: string; task: string; ref?: string; status?: CeoTaskStatus; conversationId?: string }) {
      return change<CeoTask, { task: CeoTask; existing: boolean }>("tasks", (items) => {
        const known = items.find((item) => item.key === input.key);
        if (known) return { task: structuredClone(known), existing: true };
        const at = iso(), ref = text(input.ref, 200), conversationId = text(input.conversationId, 200);
        const task: CeoTask = {
          id: randomUUID(), key: input.key, agent: input.agent, title: text(input.title, 160), task: text(input.task, 8000),
          ...(ref ? { ref } : {}), status: input.status ?? "queued", ...(conversationId ? { conversationId } : {}), createdAt: at, updatedAt: at,
        };
        items.push(task);
        trim(items, 100, (item) => FINISHED.includes(item.status));
        return { task: structuredClone(task), existing: false };
      });
    },
    updateTask(id: string, patch: { status?: CeoTaskStatus; note?: string }) {
      return change<CeoTask, CeoTask | undefined>("tasks", (items) => {
        const task = items.find((item) => item.id === id);
        if (!task) return undefined;
        if (patch.status) task.status = patch.status;
        if (patch.note !== undefined) task.note = text(patch.note, 2000);
        task.updatedAt = iso();
        return structuredClone(task);
      });
    },
    approvals: () => read<CeoApproval>("approvals"),
    /** Files an outside action as pending. The same action still pending is the same record, asked again. */
    propose(input: { action: string; detail?: string; conversationId?: string }) {
      const action = text(input.action, 300), detail = text(input.detail, 4000), conversationId = text(input.conversationId, 200);
      if (!action) throw new Error("Say what the action is.");
      const key = ceoKey(action);
      return change<CeoApproval, CeoApproval>("approvals", (items) => {
        const waiting = items.find((item) => item.key === key && item.status === "pending");
        if (waiting) {
          if (detail) waiting.detail = detail;
          return structuredClone(waiting);
        }
        const approval: CeoApproval = { id: randomUUID(), key, action, ...(detail ? { detail } : {}), status: "pending", ...(conversationId ? { conversationId } : {}), createdAt: iso() };
        items.push(approval);
        trim(items, 100, (item) => item.status !== "pending");
        return structuredClone(approval);
      });
    },
    /** The person's decision. The first one stands: a decided action comes back as it is. */
    resolve(id: string, decision: "approved" | "declined", by: "voice" | "button") {
      return change<CeoApproval, CeoApproval>("approvals", (items) => {
        const approval = items.find((item) => item.id === id);
        if (!approval) throw new Error("That approval is no longer on record.");
        if (approval.status === "pending") Object.assign(approval, { status: decision, by, resolvedAt: iso() });
        return structuredClone(approval);
      });
    },
    reports: () => read<CeoReport>("reports"),
    /** Keeps what a check-in wrote. A run already on record is left as it is. */
    addReport(input: { key: string; kind: CeoReport["kind"]; title: string; text: string; at: string }) {
      return change<CeoReport, CeoReport>("reports", (items) => {
        const known = items.find((item) => item.key === input.key);
        if (known) return structuredClone(known);
        const report: CeoReport = {
          id: randomUUID(), key: text(input.key, 200), kind: input.kind, title: text(input.title, 160), text: text(input.text, 12_000),
          at: Number.isNaN(Date.parse(input.at)) ? iso() : new Date(input.at).toISOString(),
        };
        items.push(report);
        items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        trim(items, 40, () => true);
        return structuredClone(report);
      });
    },
    /** A few lines for the voice's prompt: what is waiting for a yes and what was handed out. Titles only; results are read with task_status. */
    digest(now = Date.now()) {
      const waiting = read<CeoApproval>("approvals").filter((item) => item.status === "pending");
      const work = read<CeoTask>("tasks").filter((item) => !FINISHED.includes(item.status) || now - Date.parse(item.updatedAt) < 24 * 3600_000);
      const written = read<CeoReport>("reports").filter((item) => now - Date.parse(item.at) < 24 * 3600_000);
      return [
        waiting.length
          ? `Waiting for the person's yes (${waiting.length}): ${waiting.slice(-5).map((item) => `"${item.action}" (asked ${ago(item.createdAt, now)})`).join("; ")}.`
          : "Nothing is waiting for the person's approval.",
        work.length
          ? `Work you handed out: ${work.slice(-6).map((item) => `${AGENT[item.agent]} "${item.title}", ${item.status} (${ago(item.updatedAt, now)})`).join("; ")}.`
          : "No work is handed out.",
        // Only that they exist; task_status reads them out.
        ...(written.length ? [`Scheduled check-ins wrote: ${written.slice(-3).map((item) => `"${item.title}" (${ago(item.at, now)})`).join("; ")}.`] : []),
      ].join("\n");
    },
  };
}
