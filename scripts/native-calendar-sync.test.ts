import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeCalendarEvent, nativeCalendarSync } from "./native-calendar-sync";
import type { OperatorState } from "../src/lib/operator";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const account = "owner@example.test";
const range = { timeMin: "2026-09-01T00:00:00Z", timeMax: "2026-10-01T00:00:00Z" };
const event = (id = "one") => ({
  id,
  summary: "Synthetic meeting",
  start: "2026-09-17T10:00:00Z",
  end: "2026-09-17T11:00:00Z",
  description: "Provider description",
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "native-calendar-"));
  roots.push(root);
  let state = { events: [], inbox: [] } as unknown as OperatorState;
  const tools = Object.fromEntries(
    ["get_profile", "list_calendars", "search_events"].map((suffix) => {
      const name = `google_calendar.${suffix}`;
      return [
        name,
        {
          name,
          annotations: { readOnlyHint: true },
          _meta: { link_owner_profile: { email: account } },
        },
      ];
    }),
  );
  const calls: Array<{ name: string; args: any }> = [];
  let respond = (name: string, _args: any): any =>
    name.endsWith("get_profile")
      ? { email: account }
      : name.endsWith("list_calendars")
        ? { calendars: [{ id: account, summary: "Primary", primary: true, access_role: "owner" }] }
        : { events: [event()] };
  const connectedRead = async (_root: string, work: any) =>
    work({
      tools,
      call: async (name: string, args: any) => {
        calls.push({ name, args });
        return respond(name, args);
      },
    });
  const api = nativeCalendarSync(root, {
    load: () => structuredClone(state),
    save: (next) => {
      state = structuredClone(next);
    },
    connectedRead,
  } as any);
  return {
    root,
    api,
    tools,
    calls,
    get state() {
      return state;
    },
    set state(value: OperatorState) {
      state = value;
    },
    respond(fn: typeof respond) {
      respond = fn;
    },
  };
}
test("calendar discovery does not import and requires explicit initial enablement", async () => {
  const f = fixture();
  expect(await f.api.status()).toMatchObject({ available: true, enabled: false, readOnly: true });
  expect(f.calls).toHaveLength(0);
  await expect(f.api.sync(range)).rejects.toThrow("Connect Google");
  expect(f.state.events).toHaveLength(0);
});
test("calendar sync verifies identity, uses bounded primary reads and persists only connection metadata", async () => {
  const f = fixture();
  expect(await f.api.sync({ ...range, enable: true })).toMatchObject({ events: 1, readOnly: true });
  expect(f.calls.filter((call) => call.name.endsWith("get_profile"))).toHaveLength(2);
  expect(f.calls.find((call) => call.name.endsWith("search_events"))?.args).toMatchObject({
    calendar_id: account,
    time_min: new Date(range.timeMin).toISOString(),
    time_max: new Date(range.timeMax).toISOString(),
    max_results: 100,
  });
  expect(f.state.events[0]).toMatchObject({
    source: "google",
    calendarId: account,
    title: "Synthetic meeting",
  });
  const file = join(f.root, ".operator-data/native-calendar.json");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, "utf8")).not.toContain("Provider description");
  expect(await f.api.status()).toMatchObject({
    enabled: true,
    coverage: { complete: true, eventCount: 1 },
  });
});
test("refresh preserves notes, actions, local events and other calendars without duplicating", async () => {
  const f = fixture();
  await f.api.sync({ ...range, enable: true });
  f.state.events[0].notes = "My preparation";
  f.state.events[0].actions = [{ id: "action", text: "Prepare", done: false }];
  f.state.events.push(
    { ...f.state.events[0], id: "local-one", source: "local" },
    { ...f.state.events[0], id: f.state.events[0].id + "-secondary", calendarId: "secondary" },
  );
  await f.api.sync(range);
  expect(f.state.events).toHaveLength(3);
  expect(
    f.state.events.find((item) => item.calendarId === account && item.source === "google"),
  ).toMatchObject({ notes: "My preparation", actions: [{ id: "action" }] });
});
test("complete empty refresh removes stale primary events but retains other source records", async () => {
  const f = fixture();
  await f.api.sync({ ...range, enable: true });
  f.state.events.push({ ...f.state.events[0], id: "local-one", source: "local" });
  f.respond((name) =>
    name.endsWith("get_profile")
      ? { email: account }
      : name.endsWith("list_calendars")
        ? { calendars: [{ id: account, primary: true, access_role: "owner" }] }
        : { events: [] },
  );
  await f.api.sync(range);
  expect(f.state.events.map((item) => item.id)).toEqual(["local-one"]);
});
test("repeated paging or malformed events fail without replacing saved events", async () => {
  const f = fixture();
  await f.api.sync({ ...range, enable: true });
  const saved = structuredClone(f.state);
  f.respond((name) =>
    name.endsWith("get_profile")
      ? { email: account }
      : name.endsWith("list_calendars")
        ? { calendars: [{ id: account, primary: true, access_role: "owner" }] }
        : { events: [event("two")], next_page_token: "repeated" },
  );
  await expect(f.api.sync(range)).rejects.toThrow("repeated");
  expect(f.state).toEqual(saved);
  expect(() =>
    nativeCalendarEvent({ ...event(), start: "invalid" }, account, {
      id: account,
      name: "Primary",
    }),
  ).toThrow("incomplete");
});
test("an account mismatch rejects before private calendar reads", async () => {
  const f = fixture();
  f.respond(() => ({ email: "someone-else@example.test" }));
  await expect(f.api.sync({ ...range, enable: true })).rejects.toThrow("profile");
  expect(f.calls).toHaveLength(1);
  expect(f.state.events).toHaveLength(0);
});
test("disconnect during a read prevents the result from being saved", async () => {
  const f = fixture();
  await f.api.sync({ ...range, enable: true });
  const saved = structuredClone(f.state);
  f.respond((name) => {
    if (name.endsWith("get_profile")) return { email: account };
    if (name.endsWith("list_calendars"))
      return { calendars: [{ id: account, primary: true, access_role: "owner" }] };
    f.api.disable();
    return { events: [event("two")] };
  });
  await expect(f.api.sync(range)).rejects.toThrow("settings changed");
  expect(f.state).toEqual(saved);
  expect(await f.api.status()).toMatchObject({ enabled: false });
});
test("all-day dates stay date-only and excessive windows are rejected", async () => {
  const f = fixture();
  expect(
    nativeCalendarEvent({ ...event(), start: "2026-09-17", end: "2026-09-18" }, account, {
      id: account,
      name: "Primary",
    }),
  ).toMatchObject({ allDay: true, start: "2026-09-17", end: "2026-09-18" });
  expect(
    nativeCalendarEvent(
      { ...event(), start: "2026-09-17T00:00:00", end: "2026-09-18T00:00:00" },
      account,
      { id: account, name: "Primary" },
    ),
  ).toMatchObject({ allDay: true, start: "2026-09-17", end: "2026-09-18" });
  expect(
    nativeCalendarEvent(
      { ...event(), start: "2026-09-17T00:00:00Z", end: "2026-09-18T00:00:00Z" },
      account,
      { id: account, name: "Primary" },
    ).allDay,
  ).toBe(false);
  await expect(
    f.api.sync({ enable: true, timeMin: range.timeMin, timeMax: "2027-09-01T00:00:00Z" }),
  ).rejects.toThrow("100 days");
  expect(f.calls).toHaveLength(0);
});

test("mismatched or writable tool identities cannot enable the calendar reader", async () => {
  const f = fixture();
  f.tools["google_calendar.search_events"].annotations.readOnlyHint = false;
  expect(await f.api.status()).toMatchObject({ available: false, enabled: false });
  await expect(f.api.sync({ ...range, enable: true })).rejects.toThrow("Connect Google");
  expect(f.calls).toHaveLength(0);
});
