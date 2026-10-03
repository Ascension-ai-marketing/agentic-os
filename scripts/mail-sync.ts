import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { mailArchive } from "./mail-archive";
import { mailMetadataPath } from "./mail-provider";

type Provider = "gmail" | "outlook";
type Job = { provider: Provider; account: string; status: "running" | "paused" | "needs-attention" | "complete"; cursor: string | null; visited: string[]; pending: string[]; downloaded: number; enumerated: number; stored: number; exhausted: boolean; updatedAt: string; error?: string };
type Options = { root: string; archive: ReturnType<typeof mailArchive>; identity: (provider: Provider) => Promise<string>; request: (provider: Provider, path: string, account?: string) => Promise<any> };
const now = () => new Date().toISOString();
const valid = (provider: string): provider is Provider => provider === "gmail" || provider === "outlook";

/** Provider responses stay in this process and SQLite. HTTP responses contain progress only. */
export function createMailSync(options: Options) {
  const directory = join(options.root, ".operator-data"), file = join(directory, "mail-sync.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state: Partial<Record<Provider, Job>> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const tasks = new Map<Provider, Promise<void>>();
  const starting = new Map<Provider, Promise<ReturnType<typeof status>>>();
  let closed = false;
  function save() { const temporary = file + ".tmp"; writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 }); renameSync(temporary, file); }
  for (const job of Object.values(state)) if (job.status === "running") { job.status = "paused"; job.error = "Paused after restart. Resume to continue."; }
  if (Object.keys(state).length) save();
  for (const account of options.archive.stats().accounts) if (account.status === "importing" && valid(String(account.provider))) {
    options.archive.progress(account.provider as Provider, String(account.account), Math.max(Number(account.enumerated), Number(account.count)), false, null, "paused");
  }
  function publicJob(job: Job) { return { provider: job.provider, account: job.account, status: job.status, mode: "metadata", indexed: job.stored, enumerated: job.enumerated, pending: job.pending.length, updatedAt: job.updatedAt, error: job.error }; }
  function status(): { jobs: ReturnType<typeof publicJob>[]; active: boolean } { return { jobs: Object.values(state).map(publicJob), active: tasks.size > 0 || starting.size > 0 }; }
  const stored = (provider: Provider, account: string) => new Set(options.archive.ids(provider, account));
  function checkpoint(job: Job) {
    job.updatedAt = now(); save();
    const count = job.stored;
    options.archive.progress(job.provider, job.account, Math.max(job.enumerated, count), job.status === "complete", job.error || null, job.status);
  }
  function seed(provider: Provider, account: string, reuseLegacy: boolean): Job {
    const stage = join(directory, "mail-staging"), existing = stored(provider, account), pending = new Set<string>();
    let cursor: string | null = null, exhausted = false;
    if (provider === "gmail") {
      // The saved listing has no account field. Reuse it only for the archived account.
      const knownAccount = options.archive.stats().accounts.find(a => a.provider === provider)?.account;
      const ids = join(stage, "gmail-ids"), progress = join(stage, "gmail-enumeration-progress.json");
      if (reuseLegacy && knownAccount === account && existsSync(ids) && existsSync(progress)) {
        for (const name of readdirSync(ids).filter(name => name.endsWith(".json")).sort()) {
          const page = JSON.parse(readFileSync(join(ids, name), "utf8"));
          for (const id of page.message_ids || []) if (!existing.has(id)) pending.add(id);
        }
        const saved = JSON.parse(readFileSync(progress, "utf8"));
        cursor = saved.next_page_token || null; exhausted = saved.complete === true;
      }
    }
    // Outlook restarts ID-only enumeration. Existing full bodies are never downloaded twice.
    return { provider, account, status: "paused", cursor, visited: [], pending: [...pending], downloaded: 0, enumerated: existing.size + pending.size, stored: existing.size, exhausted, updatedAt: now() };
  }
  async function run(job: Job) {
    try {
      const known = stored(job.provider, job.account);
      job.stored = known.size;
      while (!closed && job.status === "running") {
        job.pending = job.pending.filter(id => !known.has(id));
        if (job.pending.length) {
          const ids = job.pending.slice(0, 4);
          // All responses are fully verified before advancing the cursor.
          const results = await Promise.allSettled(ids.map(async id => {
            const record = await options.request(job.provider, mailMetadataPath(job.provider, id), job.account);
            if (record?.id !== id) throw new Error("Provider returned a different message. Import paused.");
            return record;
          }));
          if (closed) break;
          const failed = results.find(result => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          const records = results.map(result => (result as PromiseFulfilledResult<any>).value);
          options.archive.importMetadata(job.provider, job.account, records);
          ids.forEach(id => known.add(id)); job.pending.splice(0, ids.length); job.downloaded += ids.length; job.stored = known.size;
          checkpoint(job); continue;
        }
        if (job.exhausted) { job.status = "complete"; job.enumerated = known.size; checkpoint(job); break; }
        let ids: string[], next: string | null;
        if (job.provider === "gmail") {
          const params = new URLSearchParams({ maxResults: "500", includeSpamTrash: "true", q: "in:anywhere" });
          if (job.cursor) params.set("pageToken", job.cursor);
          const page = await options.request("gmail", "/messages?" + params, job.account);
          // Gmail omits messages only for an explicitly empty mailbox.
          if (!page || (!Array.isArray(page.messages) && !(page.messages === undefined && page.resultSizeEstimate === 0 && !page.nextPageToken)))
            throw new Error("Provider did not return a complete mail listing. Resume to retry.");
          ids = (page.messages || []).map((record: { id: string }) => record?.id);
          next = page.nextPageToken || null;
        } else {
          const page = await options.request("outlook", job.cursor || "/messages?$top=500&$select=id&$orderby=receivedDateTime%20desc", job.account);
          if (!Array.isArray(page.value)) throw new Error("Provider did not return a mail listing.");
          ids = page.value.map((record: { id: string }) => record?.id);
          next = page["@odata.nextLink"] || null;
        }
        if (closed) break;
        if (ids.length > 500 || ids.some(id => typeof id !== "string" || !id) || (next && (typeof next !== "string" || next === job.cursor || job.visited.includes(next)))) throw new Error("Provider pagination did not advance.");
        if (job.cursor) job.visited.push(job.cursor);
        job.pending = [...new Set(ids)].filter(id => !known.has(id));
        job.cursor = next; job.exhausted = !next; job.enumerated += job.pending.length; checkpoint(job);
      }
    } catch (error) {
      if (closed) return;
      job.status = "needs-attention";
      // Transport errors contain status/instructions only, never provider response bodies.
      job.error = (error instanceof Error ? error.message : "Import stopped. Resume to retry.").slice(0, 240);
      checkpoint(job);
    }
  }
  return {
    status,
    async start(provider: string) {
      if (!valid(provider)) throw new Error("Choose Gmail or Outlook.");
      if (closed) throw new Error("The importer is shutting down.");
      if (tasks.has(provider)) return status();
      if (starting.has(provider)) return starting.get(provider)!;
      const begin = async () => {
      let account: string;
      try { account = await options.identity(provider); }
      catch (error) {
        if (closed) throw error;
        const message = (error instanceof Error ? error.message : "Connect this account to resume.").slice(0, 240);
        const job = state[provider];
        if (job) { job.status = "needs-attention"; job.error = message; checkpoint(job); }
        else for (const saved of options.archive.stats().accounts.filter(a => a.provider === provider && a.status !== "complete"))
          options.archive.progress(provider, String(saved.account), Math.max(Number(saved.enumerated), Number(saved.count)), false, message, "needs-attention");
        throw error;
      }
      if (closed) throw new Error("The importer is shutting down.");
      let job = state[provider];
      if (!job || job.account !== account || job.status === "complete") job = state[provider] = seed(provider, account, !job);
      job.stored = stored(provider, account).size;
      job.status = "running"; delete job.error; checkpoint(job);
      const task = Promise.resolve().then(() => run(job!)).finally(() => tasks.delete(provider)); tasks.set(provider, task);
      return status();
      };
      const promise = begin(); starting.set(provider, promise);
      try { return await promise; } finally { starting.delete(provider); }
    },
    pause(provider: string) {
      if (!valid(provider)) throw new Error("Choose Gmail or Outlook.");
      const job = state[provider]; if (job && job.status === "running") { job.status = "paused"; checkpoint(job); }
      return status();
    },
    async idle() { await Promise.all([...tasks.values()]); },
    close() { if (closed) return; closed = true; for (const job of Object.values(state)) if (job.status === "running") { job.status = "paused"; checkpoint(job); } save(); },
  };
}
