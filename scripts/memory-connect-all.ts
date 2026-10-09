// Connect everything: on first open (and from onboarding or Refresh all) bring
// in every source that is already signed in on this Mac, with one progress
// list. Gmail and Outlook recent mail plus a year of history, Granola, Notion,
// a ChatGPT export found in Downloads, and any half-finished imports.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { mailBackfill, MailProvider } from "./mail-backfill";
import type { ExportZip } from "./chatgpt-export";

type NativeProvider = { id: string; name: string; available: boolean; enabled?: boolean };
type App = {
  id: string;
  name: string;
  enabled: boolean;
  available: boolean;
  canSync?: boolean;
  status: string;
  queued?: boolean;
  progress: { processed: number; total: number; added: number; hasMore?: boolean; remaining?: number };
  lastSync?: string;
  lastImport?: string;
  error?: string;
};
export type ConnectStep = {
  id: string;
  name: string;
  state: "waiting" | "running" | "done" | "skipped" | "error";
  line: string;
  done?: number;
  total?: number;
};

const n = (v: number) => v.toLocaleString("en-GB");
const month = (iso?: string) =>
  iso && Number.isFinite(Date.parse(iso))
    ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : "";

export function memoryConnectAll(
  root: string,
  deps: {
    native: {
      status: () => Promise<{ providers: NativeProvider[]; error?: string }>;
      sync: (providers: string[], replaceSelection: boolean) => Promise<{ results: Array<{ provider: string; ok: boolean; count?: number; error?: string }> }>;
    };
    backfill: ReturnType<typeof mailBackfill>;
    apps: {
      list: (force?: boolean) => Promise<{ apps: App[] }>;
      configure: (id: string, body: unknown) => unknown;
      start: (id: string, options?: { catchUp?: boolean }) => unknown;
    };
    calendar?: {
      status: () => Promise<{ available?: boolean; enabled?: boolean; count?: number; error?: string; coverage?: { eventCount?: number } }>;
      sync: (input?: { timeMin?: string; timeMax?: string }) => Promise<unknown>;
    };
    chatgpt?: {
      find: () => ExportZip | undefined;
      extract: (zip: string) => Promise<{ path: string }>;
      target: () => string;
    };
    now?: () => number;
  },
) {
  const now = deps.now || Date.now;
  const file = join(root, ".operator-data", "connect-all.json");
  const read = (): { ranAt?: string; finishedAt?: string; mail?: string[]; notes?: Record<string, string> } => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    } catch {
      return {};
    }
  };
  const write = (value: ReturnType<typeof read>) => {
    mkdirSync(join(root, ".operator-data"), { recursive: true, mode: 0o700 });
    writeFileSync(file + ".tmp", JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  };
  let running: Promise<void> | undefined;
  const notes: Record<string, string> = {};

  async function run() {
    const saved = read();
    // The first run is the one you start with a click: it may switch on apps you
    // are signed in to. Later runs (Refresh all, daily) keep your opt-outs.
    const first = !saved.ranAt;
    write({ ...saved, ranAt: new Date(now()).toISOString(), finishedAt: undefined });
    // 1. Mail: the accounts connected in this app, recent first, then a year back.
    let mail: MailProvider[] = [];
    try {
      const { providers } = await deps.native.status();
      mail = providers
        .filter((p) => (p.id === "gmail" || p.id === "outlook") && p.available && (first || p.enabled))
        .map((p) => p.id as MailProvider);
      const keep = providers.filter((p) => p.id === "slack" && p.enabled).map((p) => p.id);
      if (mail.length) {
        notes.mail = "Reading recent mail";
        // The first run chooses the signed-in accounts; later runs only refresh your choice.
        const result = await deps.native.sync([...mail, ...keep], first);
        for (const r of result.results) if (!r.ok && r.error) notes[r.provider] = r.error;
        deps.backfill.start(mail);
      }
    } catch (error) {
      notes.mail = (error as Error).message;
    }
    // Calendar: meetings from Google Calendar, when the Google account is connected.
    if (deps.calendar) {
      try {
        const cal = await deps.calendar.status();
        if (cal.available && (first || cal.enabled)) {
          notes.calendar = "Reading your calendar";
          // The calendar sync takes at most 100 days: the last 60 and the next 39.
          await deps.calendar.sync({ timeMin: new Date(Date.now() - 60 * 864e5).toISOString(), timeMax: new Date(Date.now() + 39 * 864e5).toISOString() });
          notes.calendar = "";
        }
      } catch (error) {
        notes.calendar = (error as Error).message;
      }
    }
    // 2. ChatGPT: an export zip in Downloads that is newer than what Memory holds.
    const chatgptOn = first || !!(await deps.apps.list().catch(() => ({ apps: [] as App[] }))).apps.find((a) => a.id === "chatgpt")?.enabled;
    if (deps.chatgpt && chatgptOn) {
      try {
        const zip = deps.chatgpt.find();
        const target = deps.chatgpt.target();
        const current = existsSync(target) ? statSync(target).mtimeMs : 0;
        if (zip && Date.parse(zip.modifiedAt) > current) {
          notes.chatgpt = `Unpacking ${zip.name}`;
          await deps.chatgpt.extract(zip.path);
          notes.chatgpt = "";
        }
      } catch (error) {
        notes.chatgpt = (error as Error).message;
      }
    }
    // 3. Connected apps: Granola, Notion, ChatGPT once its file is there, and any
    //    import that stopped part way (the skills that said "more to import").
    try {
      const { apps } = await deps.apps.list(true);
      for (const app of apps) {
        const connected = ["granola", "notion", "chatgpt"].includes(app.id) && app.available && app.canSync !== false;
        const unfinished = app.enabled && !!app.progress?.hasMore;
        if (!connected && !unfinished) continue;
        if (!app.enabled) {
          if (!first) continue;
          deps.apps.configure(app.id, { enabled: true, autoSync: true });
        }
        try {
          deps.apps.start(app.id, { catchUp: true });
        } catch (error) {
          notes[app.id] = (error as Error).message;
        }
      }
    } catch (error) {
      notes.apps = (error as Error).message;
    }
    write({ ...read(), mail, finishedAt: new Date(now()).toISOString() });
  }

  async function status() {
    const saved = read();
    const steps: ConnectStep[] = [];
    const back = deps.backfill.status();
    let providers: NativeProvider[] = [];
    try {
      providers = (await deps.native.status()).providers;
    } catch {
      /* the list below still shows what was stored */
    }
    for (const id of ["gmail", "outlook"] as const) {
      const p = providers.find((x) => x.id === id);
      const b = back[id];
      const name = id === "gmail" ? "Gmail" : "Outlook";
      // An error saved while the account was connected says nothing useful once it is not.
      if (!p?.available && (!b || b.status === "error")) {
        steps.push({ id, name, state: "skipped", line: "Not connected yet" });
        continue;
      }
      if (b?.status === "running")
        steps.push({
          id,
          name,
          state: "running",
          done: b.imported,
          total: b.estimate,
          line: `Importing ${n(b.imported)}${b.estimate ? ` of ~${n(b.estimate)}` : ""}${b.oldest ? `, back to ${month(b.oldest)}` : ""}`,
        });
      else if (b?.status === "done")
        steps.push({ id, name, state: "done", done: b.imported, total: b.imported, line: `${n(b.imported)} messages since ${month(b.since)}` });
      else if (b?.status === "error")
        steps.push({ id, name, state: "error", line: b.error || notes[id] || "Could not import" });
      else steps.push({ id, name, state: running ? "running" : "waiting", line: notes[id] || "Ready" });
    }
    if (deps.calendar) {
      try {
        const cal = await deps.calendar.status();
        const count = cal.coverage?.eventCount ?? cal.count;
        if (cal.available || cal.enabled)
          steps.push(
            notes.calendar === "Reading your calendar"
              ? { id: "calendar", name: "Calendar", state: "running", line: "Reading your calendar" }
              : notes.calendar
                ? { id: "calendar", name: "Calendar", state: "error", line: notes.calendar }
                : { id: "calendar", name: "Calendar", state: "done", line: count ? `${n(count)} events` : "Up to date" },
          );
      } catch {
        /* calendar is optional */
      }
    }
    let apps: App[] = [];
    try {
      apps = (await deps.apps.list()).apps;
    } catch {
      /* shown as waiting */
    }
    const label: Record<string, string> = { granola: "Meetings (Granola)", notion: "Notion", chatgpt: "ChatGPT" };
    for (const id of ["granola", "notion", "chatgpt"]) {
      const app = apps.find((a) => a.id === id);
      const name = label[id];
      if (!app) continue;
      const busy = app.queued || ["scanning", "syncing"].includes(app.status);
      if (busy)
        steps.push({
          id,
          name,
          state: "running",
          done: app.progress.processed,
          total: app.progress.total || undefined,
          line: app.progress.total ? `Importing ${n(app.progress.processed)} of ${n(app.progress.total)}` : "Importing",
        });
      else if (app.error || app.status === "error") steps.push({ id, name, state: "error", line: app.error || "Could not import" });
      else if (app.enabled && (app.lastSync || app.lastImport))
        steps.push({ id, name, state: "done", line: app.progress.added ? `${n(app.progress.added)} added` : "Up to date" });
      else if (id === "chatgpt" && !app.available)
        steps.push({ id, name, state: "skipped", line: notes.chatgpt || "Waiting for your export in Downloads" });
      else if (!app.available) steps.push({ id, name, state: "skipped", line: "Not connected yet" });
      else steps.push({ id, name, state: running ? "running" : "waiting", line: notes[id] || "Ready" });
    }
    const unfinished = apps.filter((a) => a.enabled && a.progress?.hasMore && !["granola", "notion", "chatgpt"].includes(a.id));
    const catching = apps.filter(
      (a) => a.enabled && !["granola", "notion", "chatgpt"].includes(a.id) && (a.queued || ["scanning", "syncing"].includes(a.status)),
    );
    if (unfinished.length || catching.length)
      steps.push({
        id: "library",
        name: "Skills and saved notes",
        state: catching.length ? "running" : "waiting",
        line: `${[...new Set([...catching, ...unfinished].map((a) => a.name))].join(", ")}: finishing the last batches`,
      });
    const busy = !!running || steps.some((s) => s.state === "running");
    return { ranAt: saved.ranAt, finishedAt: saved.finishedAt, running: busy, steps };
  }

  return {
    status,
    /**
     * Starts every available import in the background. Safe to call again; a run
     * in progress is reused. The very first run needs your click (`user: true`):
     * timers and refreshes never start it on their own.
     */
    async start(options: { user?: boolean } = {}) {
      if (!options.user && !read().ranAt) return status();
      if (!running)
        running = run().finally(() => {
          running = undefined;
        });
      return status();
    },
  };
}
