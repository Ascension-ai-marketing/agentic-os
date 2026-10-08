/**
 * ceo-routes.ts
 *
 * The dashboard's side of the voice CEO: what it handed out, what is waiting
 * for a yes, the button that answers, and what its scheduled check-ins read and wrote. These sit behind the OS's local-only,
 * token-checked route; the voice brain itself never calls the resolve route.
 */
import { hermesBoard } from "./ceo-hermes";
import { openclaw, type Openclaw } from "./ceo-openclaw";
import { hermesCheckIns } from "./ceo-reports";
import { redactSecrets } from "./hermes-progress";
import { ago, ceoStore, type CeoStore } from "./ceo-store";
import { ceoSync, type CeoSync, type OsJob } from "./ceo-sync";

/** Where the voice brain hands out a short-lived call token and the greeting (scripts/speech-engine.ts serve). */
export const VOICE_PAGE = "http://127.0.0.1:3002";

type Goals = { longTerm?: string; quarter?: string; month?: string; week?: string };

/** Goals, each handed-out task with the start of what its agent last said, and the actions waiting for a yes, as plain lines. */
export function briefing(goals: Goals | null | undefined, store: Pick<CeoStore, "tasks" | "approvals">, now = new Date()) {
  const line = (label: string, value: unknown) => (typeof value === "string" && value.trim() ? [`- ${label}: ${value.trim().slice(0, 600)}`] : []);
  const set = goals ? [...line("Long term", goals.longTerm), ...line("This quarter", goals.quarter), ...line("This month", goals.month), ...line("This week", goals.week)] : [];
  const part = (options: Intl.DateTimeFormatOptions) => now.toLocaleDateString("en-GB", options);
  const tasks = store.tasks().slice(-15).reverse(), waiting = store.approvals().filter((item) => item.status === "pending").slice(-10);
  return [
    `Today is ${part({ weekday: "long" })} ${now.getDate()} ${part({ month: "long" })} ${now.getFullYear()}.`,
    "",
    "The person's goals:",
    ...(set.length ? set : ["- None are written down in the OS."]),
    "",
    "Work Jarvis has handed to agents, newest first:",
    ...(tasks.length
      ? tasks.map((task) => `- ${task.agent} "${task.title}": ${task.status}, updated ${ago(task.updatedAt, now.getTime())}${task.note ? `. It said: ${redactSecrets(task.note).replace(/\s+/g, " ").slice(0, 400)}` : ""}`)
      : ["- Nothing."]),
    "",
    "Waiting for the person's yes:",
    ...(waiting.length ? waiting.map((item) => `- "${item.action}", asked ${ago(item.createdAt, now.getTime())}`) : ["- Nothing."]),
  ].join("\n");
}

export function ceoRoutes(options: {
  root: string; jobs: () => OsJob[]; store?: CeoStore; sync?: CeoSync;
  voicePage?: string; fetcher?: typeof fetch;
  /** The person's current goals, or nothing when they keep business out of what assistants read. */
  goals?: () => Goals | null | undefined;
  checkIns?: Pick<ReturnType<typeof hermesCheckIns>, "importInto">;
  openclaw?: () => Pick<Openclaw, "status">;
}) {
  const store = options.store ?? ceoStore(options.root), checkIns = options.checkIns ?? hermesCheckIns();
  let sync = options.sync;
  // Hermes is only looked up once something asks for the tasks.
  const refresh = () => (sync ??= ceoSync({ store, board: hermesBoard({ root: options.root }), jobs: options.jobs })).refresh();
  return {
    async handle(path: string, method: string, body: any) {
      if (path === "/ceo" && method === "GET") {
        // A check-in that cannot be read leaves the page with what is already on record.
        try { checkIns.importInto(store); } catch { /* read again on the next request */ }
        return { approvals: store.approvals(), tasks: store.tasks(), reports: store.reports() };
      }
      if (path === "/ceo/tasks" && method === "GET") {
        await refresh();
        return { tasks: store.tasks() };
      }
      // What a scheduled check-in is given to think about. It reads this and nothing else of the OS.
      if (path === "/ceo/briefing" && method === "GET") {
        await refresh().catch(() => undefined);
        return { briefing: briefing(options.goals?.(), store) };
      }
      // Looked up afresh each time, so an install or a stopped gateway shows without a restart. It only reads.
      if (path === "/ceo/openclaw" && method === "GET") return { openclaw: await (options.openclaw ?? openclaw)().status(AbortSignal.timeout(12_000)) };
      if (path === "/ceo/approvals/resolve" && method === "POST") {
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "id" && key !== "decision"))
          throw new Error("Choose an approval and a decision.");
        if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id)) throw new Error("That approval is no longer on record.");
        if (body.decision !== "approved" && body.decision !== "declined") throw new Error("Choose approve or decline.");
        return { approval: store.resolve(body.id, body.decision, "button") };
      }
      // POST, so the page's own token is checked before it answers.
      if (path === "/ceo/voice-token" && method === "POST") {
        // The brain already issues the token and reads the greeting; the ElevenLabs key stays with it.
        const down = "Jarvis's voice is not running. Check it with: bun run install:ceo --status";
        const response = await (options.fetcher ?? fetch)(`${options.voicePage ?? VOICE_PAGE}/token`, { signal: AbortSignal.timeout(8000) }).catch(() => { throw new Error(down); });
        const reply: any = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof reply?.error === "string" && reply.error ? reply.error : down);
        if (typeof reply?.token !== "string" || !reply.token) throw new Error("Jarvis's voice did not issue a call token.");
        return { token: reply.token, ...(typeof reply.firstMessage === "string" && reply.firstMessage.trim() ? { firstMessage: reply.firstMessage } : {}) };
      }
      throw new Error("Unknown CEO request.");
    },
  };
}
