// Mail backfill: bring a year of Gmail and Outlook history into the local mail
// archive through the accounts connected in this app. Headers and
// snippets only, 100 messages a page, resumable, and read-only end to end.
// After the first pass it keeps catching up from the newest message it holds.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mailMetadataPath, outlookMetadataFields } from "./mail-provider";
import type { mailArchive } from "./mail-archive";

export type MailProvider = "gmail" | "outlook";
export type BackfillState = {
  account: string;
  since: string;
  status: "waiting" | "running" | "done" | "error";
  imported: number;
  estimate?: number;
  oldest?: string;
  newest?: string;
  cursor?: string | number;
  /** Set when this reader saved the cursor. A cursor without it came from the earlier reader and is not sent. */
  cursorFrom?: "account";
  startedAt?: string;
  updatedAt?: string;
  doneAt?: string;
  error?: string;
};
type Store = Partial<Record<MailProvider, BackfillState>>;
const DAY = 864e5;
const PAGE = 100;
// Each session takes a few pages so progress is saved often.
const PAGES_PER_SESSION = { gmail: 5, outlook: 8 } as const;

const gmailDate = (iso: string) => iso.slice(0, 10).replaceAll("-", "/");

/** Rough total: what we have, scaled by how much of the time window it covers. */
export function backfillEstimate(imported: number, since: string, oldest?: string, now = Date.now()) {
  if (!oldest || !imported) return undefined;
  const span = now - Date.parse(since),
    covered = now - Date.parse(oldest);
  if (!(span > 0) || !(covered > 0)) return undefined;
  const share = Math.min(1, covered / span);
  return Math.max(imported, Math.round(imported / Math.max(share, 0.02) / 100) * 100);
}

export function mailBackfill(
  root: string,
  options: {
    archive: ReturnType<typeof mailArchive>;
    identity: (provider: MailProvider) => Promise<string>;
    request: (provider: MailProvider, path: string, account?: string) => Promise<any>;
    months?: number;
    now?: () => number;
  },
) {
  const now = options.now || Date.now;
  const months = options.months ?? 12;
  const file = join(root, ".operator-data", "mail-backfill.json");
  const read = (): Store => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    } catch {
      return {};
    }
  };
  const write = (store: Store) => {
    mkdirSync(join(root, ".operator-data"), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const patch = (provider: MailProvider, value: Partial<BackfillState>) => {
    const store = read();
    store[provider] = { ...(store[provider] as BackfillState), ...value, updatedAt: new Date(now()).toISOString() };
    write(store);
    return store[provider]!;
  };
  const running = new Set<MailProvider>();
  const stored = (provider: MailProvider, account: string) => {
    try {
      const row = (options.archive.stats().accounts as any[]).find(
        (a) => a.provider === provider && a.account === account,
      );
      return Number(row?.count) || 0;
    } catch {
      return 0;
    }
  };

  /** One read session: a few pages, newest first, stopping at the window's start. */
  async function session(provider: MailProvider): Promise<"more" | "done"> {
    const account = await options.identity(provider);
    let state = read()[provider]!;
    if (state.account && state.account !== account) throw new Error("A different account is signed in now. Start the import again.");
    const sinceMs = Date.parse(state.since);
    // A cursor the earlier reader saved means something else; restart paging (imports are idempotent).
    if (typeof state.cursor !== "string" || state.cursorFrom !== "account") state = patch(provider, { cursor: undefined, cursorFrom: undefined });
    for (let page = 0; page < PAGES_PER_SESSION[provider]; page++) {
      let rows: any[] = [], next: string | undefined;
      const cursor = typeof state.cursor === "string" ? state.cursor : "";
      if (provider === "gmail") {
        const params = new URLSearchParams({ q: `-in:spam -in:trash after:${gmailDate(state.since)}`, maxResults: String(PAGE), ...(cursor ? { pageToken: cursor } : {}) });
        const raw = await options.request("gmail", "/messages?" + params, account);
        const listing = Array.isArray(raw?.messages) ? raw.messages.slice(0, PAGE).filter((row: any) => typeof row?.id === "string" && row.id) : [];
        next = typeof raw?.nextPageToken === "string" && raw.nextPageToken ? raw.nextPageToken : undefined;
        for (let offset = 0; offset < listing.length; offset += 4) rows.push(...await Promise.all(listing.slice(offset, offset + 4).map(async (row: any) => {
          const record = await options.request("gmail", mailMetadataPath("gmail", row.id), account);
          if (record?.id !== row.id) throw new Error("Gmail returned a different message. Saved mail was preserved.");
          return { ...record, payload: { headers: record.payload?.headers } };
        })));
        if (rows.length) options.archive.importMetadata("gmail", account, rows);
      } else {
        const first = "/messages?" + new URLSearchParams({ $top: String(PAGE), $orderby: "receivedDateTime desc", $select: outlookMetadataFields + ",isDraft" });
        const raw = await options.request("outlook", cursor || first, account);
        const all = Array.isArray(raw?.value) ? raw.value.slice(0, PAGE) : [];
        // The date boundary is only reached by an older message, never by a skipped draft.
        const reachedStart = all.some((r: any) => r?.isDraft !== true && Date.parse(r?.receivedDateTime) < sinceMs);
        rows = all.filter((r: any) => Date.parse(r?.receivedDateTime) >= sinceMs && r?.isDraft !== true);
        const link = raw?.["@odata.nextLink"];
        next = typeof link === "string" && link && !reachedStart ? link : undefined;
        if (rows.length) options.archive.importMetadata("outlook", account, rows.map((r: any) => ({ ...r, body: undefined })));
      }
      const times = rows.map((r: any) => provider === "gmail" ? Number(r.internalDate) : Date.parse(r.receivedDateTime)).filter(Number.isFinite);
      const oldest = times.length ? new Date(Math.min(...times)).toISOString() : state.oldest;
      const newest = times.length ? new Date(Math.max(...times)).toISOString() : undefined;
      // The count is what the archive really holds, so repeat passes never double count.
      const imported = stored(provider, account) || state.imported + rows.length;
      state = patch(provider, {
        account, imported, cursor: next, cursorFrom: next ? "account" : undefined,
        oldest: oldest && (!state.oldest || oldest < state.oldest) ? oldest : state.oldest,
        newest: newest && (!state.newest || newest > state.newest) ? newest : state.newest,
        estimate: next ? backfillEstimate(imported, state.since, oldest, now()) : imported,
      });
      if (!next) return "done";
    }
    return "more";
  }

  async function drain(provider: MailProvider) {
    try {
      let finished = false;
      for (let rounds = 0; rounds < 400; rounds++) {
        if ((await session(provider)) === "done") {
          finished = true;
          break;
        }
      }
      // Out of rounds with pages left: keep the cursor so the next start carries on.
      if (!finished) patch(provider, { status: "waiting", error: undefined });
      else patch(provider, { status: "done", doneAt: new Date(now()).toISOString(), cursor: undefined, cursorFrom: undefined, error: undefined });
    } catch (error) {
      patch(provider, { status: "error", error: (error as Error).message });
    } finally {
      running.delete(provider);
    }
  }

  return {
    status(): Store {
      return read();
    },
    /** Starts in the background and returns at once. A finished mailbox catches up from its newest message. */
    start(providers: MailProvider[]) {
      const started: MailProvider[] = [];
      for (const provider of providers) {
        if (running.has(provider)) continue;
        const prior = read()[provider];
        const firstPass = !prior || prior.status !== "done";
        const since = firstPass
          ? prior?.since || new Date(now() - months * 30.5 * DAY).toISOString()
          : new Date(Date.parse(prior!.newest || prior!.since) - 2 * DAY).toISOString();
        patch(provider, {
          account: prior?.account || "",
          since: firstPass ? since : prior!.since,
          status: "running",
          imported: prior?.imported || 0,
          startedAt: new Date(now()).toISOString(),
          error: undefined,
          // A catch-up pass reads from the newest message back to the last one we hold.
          cursor: firstPass ? prior?.cursor : undefined,
          cursorFrom: firstPass ? prior?.cursorFrom : undefined,
        });
        running.add(provider);
        started.push(provider);
        const catchUp = !firstPass;
        void (async () => {
          if (catchUp) {
            // Read only the new window, then put the full window back.
            const full = read()[provider]!.since;
            patch(provider, { since });
            await drain(provider);
            patch(provider, { since: full });
          } else await drain(provider);
        })();
      }
      return { started, status: read() };
    },
    running: () => [...running],
  };
}
