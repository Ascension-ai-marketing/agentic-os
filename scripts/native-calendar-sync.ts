import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { calendarRange, type CalendarCoverage } from "./calendar-read";

type Saved = { enabled: boolean; account?: string; calendarId?: string; coverage?: CalendarCoverage; error?: string };
export type CalendarLane = {
  account: () => Promise<{ connected: boolean; email?: string; calendarAccess?: string }>;
  sync: (input: { timeMin?: unknown; timeMax?: unknown }) => Promise<{ events: number; coverage?: CalendarCoverage }>;
};

/** Google Calendar through the account connected in this app. This adapter exposes no writes. */
export function nativeCalendarSync(root: string, options: { lane: CalendarLane }) {
  const lane = options.lane;
  const directory = join(root, ".operator-data"), file = join(directory, "native-calendar.json");
  const read = (): Saved => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { enabled: false };
  const save = (value: Saved) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  let syncing = false;
  /** The connected Google account when it can read calendars, otherwise "". */
  const discover = async () => {
    const account = await lane.account();
    return account.connected && account.email && account.calendarAccess !== "missing" ? account.email.toLowerCase() : "";
  };
  return {
    async status() {
      const saved = read();
      try {
        const account = await discover();
        const { error: _staleError, ...withoutError } = saved;
        return {
          ...withoutError, available: !!account, enabled: saved.enabled && saved.account === account && !!account, account, readOnly: true, syncing,
          error: saved.enabled && saved.account !== account ? "Your calendar connection changed. Connect the current account again." : undefined,
        };
      } catch (error) {
        return { ...saved, available: false, enabled: false, readOnly: true, syncing, error: (error as Error).message };
      }
    },
    disable() { save({ ...read(), enabled: false }); return { enabled: false }; },
    async sync(input: { enable?: boolean; timeMin?: unknown; timeMax?: unknown } = {}) {
      if (syncing) throw new Error("Google Calendar is already refreshing.");
      const previous = read();
      if (!previous.enabled && input.enable !== true) throw new Error("Connect Google Calendar before refreshing.");
      // With no window given, read the last 60 days and the next 39, inside the 100 day limit below.
      const range = calendarRange({ timeMin: input.timeMin ?? new Date(Date.now() - 60 * 86400000).toISOString(), timeMax: input.timeMax ?? new Date(Date.now() + 39 * 86400000).toISOString() });
      if (Date.parse(range.timeMax) - Date.parse(range.timeMin) > 100 * 86400000) throw new Error("Choose a calendar window of up to 100 days.");
      syncing = true;
      try {
        const account = await discover();
        if (!account) throw new Error("Connect Google in Settings → Connections and allow calendar access, then check again here.");
        if (previous.account && previous.account !== account && input.enable !== true) throw new Error("Your Google Calendar account changed. Connect it again before refreshing.");
        const result = await lane.sync({ timeMin: range.timeMin, timeMax: range.timeMax });
        if (JSON.stringify(read()) !== JSON.stringify(previous)) throw new Error("Calendar settings changed during refresh. Saved events were preserved.");
        if (await discover() !== account) throw new Error("Your Google Calendar account changed during refresh. Connect it again.");
        save({ enabled: true, account, calendarId: result.coverage?.calendars?.[0]?.id, coverage: result.coverage });
        return { events: result.events, account, coverage: result.coverage, readOnly: true };
      } catch (error) {
        if (JSON.stringify(read()) === JSON.stringify(previous)) save({ ...previous, error: (error as Error).message });
        throw error;
      } finally { syncing = false; }
    },
  };
}
