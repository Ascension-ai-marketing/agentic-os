import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeCalendarSync } from "./native-calendar-sync";

const coverage = { timeMin: "2026-09-01T00:00:00.000Z", timeMax: "2026-12-01T00:00:00.000Z", syncedAt: "2026-10-01T00:00:00.000Z", calendarCount: 1, eventCount: 4, calendars: [{ id: "primary", name: "Primary" }], complete: true };
const fresh = (lane: any) => nativeCalendarSync(mkdtempSync(join(tmpdir(), "aos-")), { lane });
const connected = (email = "me@example.test", calendarAccess = "granted") => async () => ({ connected: true, email, calendarAccess });

test("status is available only for a connected Google account with calendar access", async () => {
  expect(await fresh({ account: connected(), sync: async () => ({ events: 0 }) }).status()).toMatchObject({ available: true, enabled: false, account: "me@example.test", readOnly: true });
  expect(await fresh({ account: async () => ({ connected: false }), sync: async () => ({ events: 0 }) }).status()).toMatchObject({ available: false, enabled: false });
  expect(await fresh({ account: connected("me@example.test", "missing"), sync: async () => ({ events: 0 }) }).status()).toMatchObject({ available: false });
});
test("sync enables the calendar, passes the window through and records coverage", async () => {
  const seen: any[] = [];
  const service = fresh({ account: connected(), sync: async (input: any) => { seen.push(input); return { events: 4, coverage }; } });
  await expect(service.sync()).rejects.toThrow(/Connect Google Calendar before refreshing/);
  const result = await service.sync({ enable: true, timeMin: coverage.timeMin, timeMax: coverage.timeMax });
  expect(result).toMatchObject({ events: 4, account: "me@example.test", readOnly: true });
  expect(seen[0]).toMatchObject({ timeMin: coverage.timeMin, timeMax: coverage.timeMax });
  expect(await service.status()).toMatchObject({ enabled: true, coverage });
});
test("a different connected account must be connected again before refreshing", async () => {
  let email = "me@example.test";
  const service = fresh({ account: async () => ({ connected: true, email, calendarAccess: "granted" }), sync: async () => ({ events: 1, coverage }) });
  await service.sync({ enable: true });
  email = "other@example.test";
  expect(await service.status()).toMatchObject({ enabled: false, error: "Your calendar connection changed. Connect the current account again." });
  await expect(service.sync()).rejects.toThrow(/account changed/);
});
test("a window over 100 days and a not-connected account are refused before any provider call", async () => {
  let calls = 0;
  const service = fresh({ account: connected(), sync: async () => { calls++; return { events: 0 }; } });
  await expect(service.sync({ enable: true, timeMin: "2026-01-01T00:00:00Z", timeMax: "2026-12-31T00:00:00Z" })).rejects.toThrow(/up to 100 days/);
  const off = fresh({ account: async () => ({ connected: false }), sync: async () => { calls++; return { events: 0 }; } });
  await expect(off.sync({ enable: true })).rejects.toThrow(/Connect Google in Settings/);
  expect(calls).toBe(0);
});
test("disable keeps saved events and switches the calendar off", async () => {
  const service = fresh({ account: connected(), sync: async () => ({ events: 1, coverage }) });
  await service.sync({ enable: true });
  expect(service.disable()).toEqual({ enabled: false });
  expect(await service.status()).toMatchObject({ enabled: false, available: true });
});
test("a refresh with no window asks for the last 60 days and the next 39", async () => {
  const seen: any[] = [];
  const service = fresh({ account: connected(), sync: async (input: any) => { seen.push(input); return { events: 0 }; } });
  const now = Date.now();
  await service.sync({ enable: true });
  expect(Math.round((now - Date.parse(seen[0].timeMin)) / 86400000)).toBe(60);
  expect(Math.round((Date.parse(seen[0].timeMax) - now) / 86400000)).toBe(39);
});
