import { expect, test } from "bun:test";
import { calendarRange, readCalendars } from "./calendar-read";

const range = { timeMin: "2026-09-01T00:00:00Z", timeMax: "2026-11-01T00:00:00Z" };
const googleEvent = (id: string) => ({
  id,
  summary: "Meeting",
  start: { dateTime: "2026-09-16T10:00:00Z" },
  end: { dateTime: "2026-09-16T11:00:00Z" },
});
const outlookEvent = (id: string) => ({
  id,
  subject: "Meeting",
  start: { dateTime: "2026-09-16T10:00:00" },
  end: { dateTime: "2026-09-16T11:00:00" },
});

test("Google reads every calendar and every event page, preserving separate calendar identities", async () => {
  const paths: string[] = [];
  const result = await readCalendars(
    "google",
    async (path) => {
      paths.push(path);
      const url = new URL(path, "https://www.googleapis.com");
      if (url.pathname.endsWith("calendarList")) {
        expect(url.searchParams.get("showHidden")).toBe("true");
        return url.searchParams.has("pageToken")
          ? { items: [{ id: "shared/calendar", summary: "Team" }] }
          : {
              items: [{ id: "qa@example.com", summary: "Personal", primary: true }],
              nextPageToken: "calendar-page2",
            };
      }
      expect(url.searchParams.get("singleEvents")).toBe("true");
      expect(url.searchParams.get("timeMin")).toBe(range.timeMin);
      if (path.includes("shared%2Fcalendar"))
        return {
          items: [googleEvent("same"), { ...googleEvent("cancelled"), status: "cancelled" }],
        };
      return url.searchParams.has("pageToken")
        ? {
            items: [
              {
                id: "all-day",
                summary: "Day off",
                start: { date: "2026-09-17" },
                end: { date: "2026-09-18" },
              },
            ],
          }
        : {
            items: [googleEvent("same"), googleEvent("series_20260916")],
            nextPageToken: "event-page2",
          };
    },
    "google:account:",
    range,
  );
  expect(paths).toHaveLength(5);
  expect(result.events).toHaveLength(4);
  expect(new Set(result.events.map((event) => event.id)).size).toBe(4);
  expect(result.events.find((event) => event.calendarName === "Team")?.id).not.toBe(
    "google:account:same",
  );
  expect(result.events.find((event) => event.allDay)?.start).toBe("2026-09-17T00:00:00");
  expect(result.coverage).toMatchObject({
    ...range,
    calendarCount: 2,
    eventCount: 4,
    complete: true,
  });
});

test("Outlook reads shared calendars and event pages with consistent UTC timestamps", async () => {
  const paths: string[] = [];
  const result = await readCalendars(
    "outlook",
    async (path) => {
      paths.push(path);
      if (path.startsWith("/me/calendars?"))
        return path.includes("skiptoken")
          ? { value: [{ id: "shared", name: "Team" }] }
          : {
              value: [{ id: "default", name: "Personal", isDefaultCalendar: true }],
              "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=next",
            };
      if (path.includes("/shared/")) return { value: [outlookEvent("same")] };
      return path.includes("skiptoken")
        ? { value: [outlookEvent("next"), { ...outlookEvent("cancelled"), isCancelled: true }] }
        : {
            value: [outlookEvent("same")],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/calendars/default/calendarView?$skiptoken=next",
          };
    },
    "outlook:account:",
    range,
  );
  expect(paths).toHaveLength(5);
  expect(result.events).toHaveLength(3);
  expect(result.events[0].start).toBe("2026-09-16T10:00:00Z");
  expect(new Set(result.events.map((event) => event.id)).size).toBe(3);
  expect(result.coverage.calendarCount).toBe(2);
});

test("Outlook rejects foreign pagination links before a second read", async () => {
  let calls = 0;
  await expect(
    readCalendars(
      "outlook",
      async () => {
        calls++;
        return { value: [], "@odata.nextLink": "https://elsewhere.example/steal" };
      },
      "outlook:account:",
      range,
    ),
  ).rejects.toThrow("unsafe");
  expect(calls).toBe(1);
});

test("Cal.com uses current cursor pagination and retains past and upcoming bookings within coverage", async () => {
  const cursors: Array<string | null> = [];
  const result = await readCalendars(
    "cal",
    async (path, version) => {
      const url = new URL(path, "https://api.cal.com");
      expect(version).toBe("2026-05-01");
      expect(url.searchParams.get("limit")).toBe("100");
      expect(url.searchParams.has("status")).toBe(false);
      cursors.push(url.searchParams.get("cursor"));
      return {
        data: [
          {
            uid: cursors.length === 1 ? "first" : "next",
            start: "2026-09-17T10:00:00Z",
            end: "2026-09-17T11:00:00Z",
            status: "accepted",
          },
        ],
        pagination:
          cursors.length === 1 ? { hasMore: true, nextCursor: "next-page" } : { hasMore: false },
      };
    },
    "cal:account:",
    range,
  );
  expect(cursors).toEqual([null, "next-page"]);
  expect(result.events).toHaveLength(2);
});

test("Incomplete paging is an error rather than a successful partial calendar", async () => {
  await expect(
    readCalendars("cal", async () => ({ data: [], pagination: { hasMore: true } }), "cal:", range),
  ).rejects.toThrow("cursor");
  await expect(
    readCalendars("google", async () => ({ items: [], nextPageToken: "same" }), "google:", range),
  ).rejects.toThrow("repeated");
  expect(() => calendarRange({ timeMin: "2020-01-01", timeMax: "2026-01-01" })).toThrow(
    "two years",
  );
  expect(() => calendarRange({ timeMin: "invalid" })).toThrow("two years");
});
