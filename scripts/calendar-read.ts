import { createHash } from "node:crypto";
import type { CalendarEvent } from "../src/lib/operator";
export type CalendarRange = { timeMin: string; timeMax: string };
export type CalendarCoverage = CalendarRange & {
  syncedAt: string;
  calendarCount: number;
  eventCount: number;
  calendars: { id: string; name: string }[];
  complete: boolean;
};
export function calendarRange(input: { timeMin?: unknown; timeMax?: unknown } = {}): CalendarRange {
  const start =
    input.timeMin === undefined ? Date.now() - 90 * 86400000 : Date.parse(String(input.timeMin));
  const end =
    input.timeMax === undefined ? Date.now() + 365 * 86400000 : Date.parse(String(input.timeMax));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end - start > 740 * 86400000
  )
    throw new Error("Choose a calendar range of up to two years.");
  return { timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() };
}
/** Full paging within a visible date window. Provider reads remain read-only. */
export async function readCalendars(
  provider: "google" | "outlook" | "cal",
  get: (path: string, version?: string) => Promise<any>,
  prefix: string,
  range: CalendarRange,
) {
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 100000) : "");
  const events: CalendarEvent[] = [],
    calendars: { id: string; name: string }[] = [];
  async function paged(first: string, kind: "google" | "outlook" | "cal", key: string) {
    const rows: any[] = [],
      seen = new Set<string>();
    let path = first;
    for (let page = 0; page < 100; page++) {
      if (seen.has(path))
        throw new Error(
          "The calendar provider repeated a page. Sync again; your saved events are unchanged.",
        );
      seen.add(path);
      const data = await get(path, kind === "cal" ? "2026-05-01" : undefined);
      if (!Array.isArray(data[key]))
        throw new Error(
          "The calendar provider returned an incomplete page. Your saved events are unchanged.",
        );
      rows.push(...data[key]);
      if (rows.length > 20000)
        throw new Error(
          "This range contains more than 20,000 calendar records. Choose a shorter range.",
        );
      if (kind === "google") {
        if (!data.nextPageToken) return rows;
        const next = new URL(first, "https://www.googleapis.com");
        next.searchParams.set("pageToken", data.nextPageToken);
        path = next.pathname + next.search;
      } else if (kind === "outlook") {
        if (!data["@odata.nextLink"]) return rows;
        const next = new URL(data["@odata.nextLink"]);
        if (next.origin !== "https://graph.microsoft.com" || !next.pathname.startsWith("/v1.0/"))
          throw new Error("Outlook returned an unsafe calendar paging URL.");
        path = next.pathname.slice("/v1.0".length) + next.search;
      } else {
        if (!data.pagination?.hasMore) return rows;
        if (!data.pagination.nextCursor)
          throw new Error(
            "Cal.com did not return its next page cursor. Your saved bookings are unchanged.",
          );
        const next = new URL(first, "https://api.cal.com");
        next.searchParams.set("cursor", data.pagination.nextCursor);
        path = next.pathname + next.search;
      }
    }
    throw new Error("Calendar paging exceeded 100 pages. Choose a shorter date range.");
  }
  const overlapping = (start: string, end: string) =>
    Date.parse(start) < Date.parse(range.timeMax) && Date.parse(end) > Date.parse(range.timeMin);
  if (provider === "google") {
    const list = await paged(
      "/calendar/v3/users/me/calendarList?maxResults=250&showHidden=true&minAccessRole=reader",
      "google",
      "items",
    );
    for (const calendar of list.filter((x) => !x.deleted)) {
      const id = String(calendar.id),
        name = text(calendar.summaryOverride || calendar.summary) || "Google calendar";
      calendars.push({ id, name });
      const query = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
        timeMin: range.timeMin,
        timeMax: range.timeMax,
      });
      const rows = await paged(
        `/calendar/v3/calendars/${encodeURIComponent(id)}/events?${query}`,
        "google",
        "items",
      );
      for (const e of rows) {
        if (e.status === "cancelled" || !e.start || !e.end) continue;
        const start = e.start.dateTime || e.start.date + "T00:00:00",
          end = e.end.dateTime || e.end.date + "T00:00:00";
        if (!overlapping(start, end)) continue;
        const key = calendar.primary
          ? prefix + e.id
          : prefix + createHash("sha256").update(id).digest("hex").slice(0, 12) + ":" + e.id;
        events.push({
          id: key,
          title: text(e.summary) || "Busy",
          start,
          end,
          allDay: !!e.start.date,
          location: text(e.location),
          attendees: e.attendees
            ?.map((a: any) => a.email)
            .filter(Boolean)
            .join(", "),
          notes: text(e.description),
          actions: [],
          source: "google",
          calendarId: id,
          calendarName: name,
          // Repeating events stay in the calendar; Memory shows one entry per series.
          ...(typeof e.recurringEventId === "string" ? { series: e.recurringEventId.slice(0, 200) } : {}),
        });
      }
    }
  } else if (provider === "outlook") {
    const list = await paged("/me/calendars?$top=100", "outlook", "value");
    for (const calendar of list) {
      const id = String(calendar.id),
        name = text(calendar.name) || "Outlook calendar";
      calendars.push({ id, name });
      const query = new URLSearchParams({
        startDateTime: range.timeMin,
        endDateTime: range.timeMax,
        $top: "1000",
      });
      const rows = await paged(
        `/me/calendars/${encodeURIComponent(id)}/calendarView?${query}`,
        "outlook",
        "value",
      );
      for (const e of rows) {
        if (e.isCancelled || !e.start?.dateTime || !e.end?.dateTime) continue;
        const utc = (v: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : v + "Z");
        const start = e.isAllDay
            ? e.start.dateTime.slice(0, 10) + "T00:00:00"
            : utc(e.start.dateTime),
          end = e.isAllDay ? e.end.dateTime.slice(0, 10) + "T00:00:00" : utc(e.end.dateTime);
        if (!overlapping(start, end)) continue;
        const key = calendar.isDefaultCalendar
          ? prefix + e.id
          : prefix + createHash("sha256").update(id).digest("hex").slice(0, 12) + ":" + e.id;
        events.push({
          id: key,
          title: text(e.subject) || "Busy",
          start,
          end,
          allDay: !!e.isAllDay,
          location: text(e.location?.displayName),
          attendees: e.attendees
            ?.map((a: any) => a.emailAddress?.address)
            .filter(Boolean)
            .join(", "),
          notes: text(e.body?.content),
          actions: [],
          source: "outlook",
          calendarId: id,
          calendarName: name,
          ...(typeof e.seriesMasterId === "string" ? { series: e.seriesMasterId.slice(0, 200) } : {}),
        });
      }
    }
  } else {
    calendars.push({ id: "cal", name: "Cal.com bookings" });
    const query = new URLSearchParams({
      limit: "100",
      afterStart: range.timeMin,
      beforeEnd: range.timeMax,
    });
    const rows = await paged(`/bookings?${query}`, "cal", "data");
    for (const e of rows) {
      if (
        ["cancelled", "rejected"].includes(e.status) ||
        !e.start ||
        !e.end ||
        !overlapping(e.start, e.end)
      )
        continue;
      events.push({
        id: prefix + (e.uid || e.id),
        title: text(e.title) || "Booking",
        start: e.start,
        end: e.end,
        allDay: false,
        location: text(e.location),
        attendees: e.attendees
          ?.map((a: any) => a.name || a.email)
          .filter(Boolean)
          .join(", "),
        notes: text(e.description),
        actions: [],
        source: "cal",
        calendarId: "cal",
        calendarName: "Cal.com bookings",
      });
    }
  }
  const unique = [...new Map(events.map((e) => [e.id, e])).values()];
  const coverage: CalendarCoverage = {
    ...range,
    syncedAt: new Date().toISOString(),
    calendarCount: calendars.length,
    eventCount: unique.length,
    calendars,
    complete: true,
  };
  return { events: unique, coverage };
}
