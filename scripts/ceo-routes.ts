/**
 * ceo-routes.ts
 *
 * The dashboard's side of the voice CEO: what it handed out, what is waiting
 * for a yes, and the button that answers. These sit behind the OS's local-only,
 * token-checked route; the voice brain itself never calls the resolve route.
 */
import { hermesBoard } from "./ceo-hermes";
import { ceoStore, type CeoStore } from "./ceo-store";
import { ceoSync, type CeoSync, type OsJob } from "./ceo-sync";

/** Where the voice brain hands out a short-lived call token and the greeting (scripts/speech-engine.ts serve). */
export const VOICE_PAGE = "http://127.0.0.1:3002";

export function ceoRoutes(options: {
  root: string; jobs: () => OsJob[]; store?: CeoStore; sync?: CeoSync;
  voicePage?: string; fetcher?: typeof fetch;
}) {
  const store = options.store ?? ceoStore(options.root);
  let sync = options.sync;
  return {
    async handle(path: string, method: string, body: any) {
      if (path === "/ceo" && method === "GET") return { approvals: store.approvals(), tasks: store.tasks() };
      if (path === "/ceo/tasks" && method === "GET") {
        // Hermes is only looked up once something asks for the tasks.
        sync ??= ceoSync({ store, board: hermesBoard({ root: options.root }), jobs: options.jobs });
        await sync.refresh();
        return { tasks: store.tasks() };
      }
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
