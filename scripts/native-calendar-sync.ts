import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { withConnectedRead, type ConnectedTool } from "./codex-connected-read";
import { calendarRange, type CalendarCoverage } from "./calendar-read";
import type { CalendarEvent, OperatorState } from "../src/lib/operator";

const required = [
  "google_calendar.get_profile",
  "google_calendar.list_calendars",
  "google_calendar.search_events",
];
type Saved = {
  enabled: boolean;
  account?: string;
  calendarId?: string;
  coverage?: CalendarCoverage;
  error?: string;
};
const text = (value: unknown, limit = 1000) =>
  typeof value === "string" ? value.slice(0, limit) : "";
function identity(tools: Record<string, ConnectedTool>) {
  const account = text(tools[required[0]]?._meta?.link_owner_profile?.email, 300).toLowerCase();
  return account &&
    required.every(
      (name) =>
        tools[name]?.annotations?.readOnlyHint === true &&
        tools[name]?.annotations?.destructiveHint !== true &&
        text(tools[name]?._meta?.link_owner_profile?.email, 300).toLowerCase() === account,
    )
    ? account
    : "";
}

export function nativeCalendarEvent(
  raw: any,
  account: string,
  calendar: { id: string; name: string },
): CalendarEvent {
  const start = text(raw?.start, 80),
    end = text(raw?.end, 80),
    id = text(raw?.id, 1024);
  if (
    !id ||
    !start ||
    !end ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    Date.parse(end) < Date.parse(start)
  )
    throw new Error("Google Calendar returned an incomplete event. Saved events were preserved.");
  const prefix = `google:${createHash("sha256").update(account).digest("hex").slice(0, 12)}:`;
  // The connector also serializes date-only boundaries as offset-free midnight.
  const dateBoundary = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?)?$/;
  const allDay =
    dateBoundary.test(start) && dateBoundary.test(end) && end.slice(0, 10) > start.slice(0, 10);
  return {
    id: prefix + id,
    title: text(raw.summary) || "Busy",
    start: allDay ? start.slice(0, 10) : start,
    end: allDay ? end.slice(0, 10) : end,
    allDay,
    location: text(raw.location),
    notes: text(raw.description, 8000),
    actions: [],
    source: "google",
    calendarId: calendar.id,
    calendarName: calendar.name,
  };
}

/** Primary calendar only. Credentials stay in Codex; this adapter exposes no writes. */
export function nativeCalendarSync(
  root: string,
  options: {
    load: () => OperatorState;
    save: (state: OperatorState) => void;
    connectedRead?: typeof withConnectedRead;
  },
) {
  const connectedRead = options.connectedRead || withConnectedRead;
  const directory = join(root, ".operator-data"),
    file = join(directory, "native-calendar.json");
  const read = (): Saved =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { enabled: false };
  const save = (value: Saved) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  let syncing = false;
  let cached: { at: number; account: string } | undefined;
  let discovering: Promise<string> | undefined;
  const discover = async () => {
    if (cached && Date.now() - cached.at < 60000) return cached.account;
    if (!discovering)
      discovering = connectedRead(root, async (client) => identity(client.tools))
        .then((account) => {
          cached = { at: Date.now(), account };
          return account;
        })
        .finally(() => {
          discovering = undefined;
        });
    return discovering;
  };
  return {
    async status() {
      const saved = read();
      try {
        const account = await discover();
        const { error: _staleError, ...withoutError } = saved;
        return {
          ...withoutError,
          available: !!account,
          enabled: saved.enabled && saved.account === account,
          account,
          readOnly: true,
          syncing,
          error:
            saved.enabled && saved.account !== account
              ? "Your calendar connection changed. Connect the current account again."
              : undefined,
        };
      } catch (error) {
        return {
          ...saved,
          available: false,
          enabled: false,
          readOnly: true,
          syncing,
          error: (error as Error).message,
        };
      }
    },
    disable() {
      save({ ...read(), enabled: false });
      return { enabled: false };
    },
    async sync(input: { enable?: boolean; timeMin?: unknown; timeMax?: unknown } = {}) {
      if (syncing) throw new Error("Google Calendar is already refreshing.");
      const previous = read();
      if (!previous.enabled && input.enable !== true)
        throw new Error("Connect Google Calendar before refreshing.");
      // With no window given, read the last 60 days and the next 39, inside the 100 day limit below.
      const range = calendarRange({
        timeMin: input.timeMin ?? new Date(Date.now() - 60 * 86400000).toISOString(),
        timeMax: input.timeMax ?? new Date(Date.now() + 39 * 86400000).toISOString(),
      });
      if (Date.parse(range.timeMax) - Date.parse(range.timeMin) > 100 * 86400000)
        throw new Error("Choose a calendar window of up to 100 days.");
      syncing = true;
      const unchanged = () => {
        if (JSON.stringify(read()) !== JSON.stringify(previous))
          throw new Error("Calendar settings changed during refresh. Saved events were preserved.");
      };
      try {
        return await connectedRead(root, async (client) => {
          const account = identity(client.tools);
          if (!account) throw new Error("Connect Google Calendar in Codex, then check again here.");
          if (previous.account && previous.account !== account && input.enable !== true)
            throw new Error(
              "Your Google Calendar account changed. Connect it again before refreshing.",
            );
          const verify = async () => {
            unchanged();
            const profile = await client.call(required[0], {});
            if (text((profile.profile || profile).email, 300).toLowerCase() !== account)
              throw new Error("The calendar profile does not match the connected account.");
            unchanged();
          };
          await verify();
          let calendar: { id: string; name: string } | undefined, pageToken: string | undefined;
          const seenCalendars = new Set<string>();
          for (let page = 0; page < 5 && !calendar; page++) {
            const result = await client.call(required[1], {
              max_results: 20,
              ...(pageToken ? { next_page_token: pageToken } : {}),
            });
            if (!Array.isArray(result.calendars) || result.calendars.length > 20)
              throw new Error("Google Calendar returned an incomplete calendar list.");
            const primary = result.calendars.find(
              (item: any) =>
                item.primary === true && ["owner", "writer", "reader"].includes(item.access_role),
            );
            if (primary && typeof primary.id === "string")
              calendar = { id: primary.id, name: text(primary.summary) || "Primary calendar" };
            if (calendar || !result.next_page_token) break;
            pageToken = text(result.next_page_token, 8000);
            if (!pageToken || seenCalendars.has(pageToken))
              throw new Error("Google Calendar repeated a calendar page.");
            seenCalendars.add(pageToken);
          }
          if (!calendar)
            throw new Error(
              "Your primary Google Calendar was not found. Saved events were preserved.",
            );
          const events = new Map<string, CalendarEvent>(),
            seen = new Set<string>();
          pageToken = undefined;
          let complete = false;
          for (let page = 0; page < 10; page++) {
            unchanged();
            const result = await client.call(required[2], {
              calendar_id: calendar.id,
              time_min: range.timeMin,
              time_max: range.timeMax,
              timezone_str: "UTC",
              max_results: 100,
              ...(pageToken ? { next_page_token: pageToken } : {}),
            });
            if (!Array.isArray(result.events) || result.events.length > 100)
              throw new Error("Google Calendar returned an incomplete event page.");
            for (const raw of result.events) {
              if (raw.status === "cancelled") continue;
              const event = nativeCalendarEvent(raw, account, calendar);
              if (
                Date.parse(event.start) < Date.parse(range.timeMax) &&
                Date.parse(event.end) >= Date.parse(range.timeMin)
              )
                events.set(event.id, event);
            }
            if (!result.next_page_token) {
              complete = true;
              break;
            }
            pageToken = text(result.next_page_token, 8000);
            if (!pageToken || seen.has(pageToken))
              throw new Error(
                "Google Calendar repeated an event page. Saved events were preserved.",
              );
            seen.add(pageToken);
          }
          if (!complete)
            throw new Error(
              "This window contains more than 1,000 events. Choose a shorter window.",
            );
          await verify();
          const state = options.load(),
            old = new Map(state.events.map((event) => [event.id, event]));
          const prefix = `google:${createHash("sha256").update(account).digest("hex").slice(0, 12)}:`;
          state.events = state.events.filter(
            (event) =>
              !events.has(event.id) &&
              !(
                event.id.startsWith(prefix) &&
                event.calendarId === calendar.id &&
                Date.parse(event.start) < Date.parse(range.timeMax) &&
                Date.parse(event.end) >= Date.parse(range.timeMin)
              ),
          );
          for (const event of events.values())
            state.events.push({
              ...event,
              notes: old.get(event.id)?.notes || event.notes,
              actions: old.get(event.id)?.actions || [],
            });
          const coverage: CalendarCoverage = {
            ...range,
            syncedAt: new Date().toISOString(),
            calendarCount: 1,
            eventCount: events.size,
            calendars: [calendar],
            complete: true,
          };
          options.save(state);
          save({ enabled: true, account, calendarId: calendar.id, coverage });
          cached = { at: Date.now(), account };
          return { events: events.size, account, coverage, readOnly: true };
        });
      } catch (error) {
        if (JSON.stringify(read()) === JSON.stringify(previous))
          save({ ...previous, error: (error as Error).message });
        throw error;
      } finally {
        syncing = false;
      }
    },
  };
}
