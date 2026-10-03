// Mail backfill: bring a year of Gmail and Outlook history into the local mail
// archive through the Codex connections that are already signed in. Headers and
// snippets only, 100 messages a page, resumable, and read-only end to end.
// After the first pass it keeps catching up from the newest message it holds.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withConnectedRead, type ConnectedTool } from "./codex-connected-read";
import { gmailSearchMetadata } from "./native-inbox-sync";
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
  startedAt?: string;
  updatedAt?: string;
  doneAt?: string;
  error?: string;
};
type Store = Partial<Record<MailProvider, BackfillState>>;
const DAY = 864e5;
const TOOLS = { gmail: "gmail.search_emails", outlook: "microsoft_outlook_email.list_messages" } as const;
const PAGE = 100;
// A Codex read session caps its total response size, so each session takes a few pages.
const PAGES_PER_SESSION = { gmail: 25, outlook: 8 } as const;

const identity = (tool?: ConnectedTool) => {
  const profile = tool?._meta?.link_owner_profile;
  const value = profile?.email || profile?.id;
  return typeof value === "string" ? value.slice(0, 300) : "";
};
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
    connectedRead?: typeof withConnectedRead;
    months?: number;
    now?: () => number;
  },
) {
  const connectedRead = options.connectedRead || withConnectedRead;
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
    return connectedRead(
      root,
      async (client) => {
        const account = identity(client.tools[TOOLS[provider]]);
        let state = read()[provider]!;
        if (!account) throw new Error(`${provider === "gmail" ? "Gmail" : "Outlook"} is not signed in to Codex.`);
        if (state.account && state.account !== account)
          throw new Error("A different account is signed in now. Start the import again.");
        const sinceMs = Date.parse(state.since);
        for (let page = 0; page < PAGES_PER_SESSION[provider]; page++) {
          let rows: any[] = [],
            next: string | number | undefined,
            reachedStart = false;
          if (provider === "gmail") {
            const raw = await client.call(TOOLS.gmail, {
              query: `-in:spam -in:trash after:${gmailDate(state.since)}`,
              max_results: PAGE,
              next_page_token: typeof state.cursor === "string" ? state.cursor : "",
            });
            rows = Array.isArray(raw?.emails) ? raw.emails.slice(0, PAGE) : [];
            next = typeof raw?.next_page_token === "string" && raw.next_page_token ? raw.next_page_token : undefined;
            const metadata = rows.map(gmailSearchMetadata);
            if (metadata.length) options.archive.importMetadata("gmail", account, metadata);
          } else {
            const skip = typeof state.cursor === "number" ? state.cursor : 0;
            const raw = await client.call(TOOLS.outlook, { top: PAGE, skip, order_by: "receivedDateTime desc" });
            const all = Array.isArray(raw?.value) ? raw.value.slice(0, PAGE) : [];
            // The date boundary is only reached by an older message, never by a
            // skipped draft (drafts are dropped, but they do not end the history).
            reachedStart = all.some((r: any) => r?.isDraft !== true && Date.parse(r?.receivedDateTime) < sinceMs);
            rows = all.filter((r: any) => Date.parse(r?.receivedDateTime) >= sinceMs && r?.isDraft !== true);
            next = raw?.has_more && !reachedStart ? Number(raw.next_from_index) || skip + all.length : undefined;
            if (rows.length)
              options.archive.importMetadata(
                "outlook",
                account,
                rows.map((r: any) => ({ ...r, body: undefined })),
              );
          }
          const times = rows
            .map((r: any) => Date.parse(provider === "gmail" ? r.email_ts : r.receivedDateTime))
            .filter(Number.isFinite);
          const oldest = times.length ? new Date(Math.min(...times)).toISOString() : state.oldest;
          const newest = times.length ? new Date(Math.max(...times)).toISOString() : undefined;
          // The count is what the archive really holds, so repeat passes never double count.
          const imported = stored(provider, account) || state.imported + rows.length;
          state = patch(provider, {
            account,
            imported,
            cursor: next,
            oldest: oldest && (!state.oldest || oldest < state.oldest) ? oldest : state.oldest,
            newest: newest && (!state.newest || newest > state.newest) ? newest : state.newest,
            estimate: next ? backfillEstimate(imported, state.since, oldest, now()) : imported,
          });
          if (!next) return "done";
        }
        return "more";
      },
      { timeoutMs: 300000, callTimeoutMs: 90000 },
    );
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
      else patch(provider, { status: "done", doneAt: new Date(now()).toISOString(), cursor: undefined, error: undefined });
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
