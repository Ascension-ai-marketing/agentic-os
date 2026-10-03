import { expect, test } from "bun:test";
import { currentGoalPeriod, goalPeriodState, localDateInZone, validGoalPeriod } from "../src/lib/goal-periods";

test("weeks end Sunday in the saved timezone and renew at local Monday midnight", () => {
  const zone = "Europe/Vienna";
  const sunday = new Date("2026-09-20T21:59:59.999Z"), monday = new Date("2026-09-20T22:00:00Z");
  const period = currentGoalPeriod("week", sunday, zone);
  expect(period).toEqual({ startDate: "2026-09-14", endDate: "2026-09-20", timeZone: zone });
  expect(goalPeriodState({ period }, sunday)).toBe("current");
  expect(goalPeriodState({ period }, monday)).toBe("past");
  expect(currentGoalPeriod("week", monday, zone)).toMatchObject({ startDate: "2026-09-21", endDate: "2026-09-27" });
});

test("civil week arithmetic survives daylight saving and year boundaries", () => {
  const zone = "Europe/Vienna";
  expect(currentGoalPeriod("week", new Date("2026-03-29T21:59:59Z"), zone)).toMatchObject({ startDate: "2026-03-23", endDate: "2026-03-29" });
  expect(currentGoalPeriod("week", new Date("2026-03-29T22:00:00Z"), zone)).toMatchObject({ startDate: "2026-03-30", endDate: "2026-04-05" });
  expect(currentGoalPeriod("week", new Date("2026-10-25T22:59:59Z"), zone)).toMatchObject({ startDate: "2026-10-19", endDate: "2026-10-25" });
  expect(currentGoalPeriod("week", new Date("2026-10-25T23:00:00Z"), zone)).toMatchObject({ startDate: "2026-10-26", endDate: "2026-11-01" });
  expect(currentGoalPeriod("week", new Date("2027-01-01T12:00:00Z"), "UTC")).toMatchObject({ startDate: "2026-12-28", endDate: "2027-01-03" });
});

test("month and quarter periods use calendar endings, including leap February", () => {
  expect(currentGoalPeriod("month", new Date("2028-02-14T12:00:00Z"), "UTC")).toMatchObject({ startDate: "2028-02-01", endDate: "2028-02-29" });
  expect(currentGoalPeriod("quarter", new Date("2026-12-31T12:00:00Z"), "UTC")).toMatchObject({ startDate: "2026-10-01", endDate: "2026-12-31" });
  expect(currentGoalPeriod("quarter", new Date("2026-12-31T23:00:00Z"), "Europe/Vienna")).toMatchObject({ startDate: "2027-01-01", endDate: "2027-03-31" });
});

test("opposite timezones, undated history and invalid metadata remain explicit", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  expect(localDateInZone(now, "Pacific/Kiritimati")).toBe("2026-09-21");
  expect(localDateInZone(now, "America/Los_Angeles")).toBe("2026-09-20");
  expect(goalPeriodState({})).toBe("undated");
  expect(validGoalPeriod({ startDate: "2026-02-30", endDate: "2026-03-01", timeZone: "UTC" })).toBe(false);
  expect(validGoalPeriod({ startDate: "2026-09-14", endDate: "2026-09-19", timeZone: "UTC" }, "week")).toBe(false);
  expect(validGoalPeriod({ startDate: "2026-09-14", endDate: "2026-09-20", timeZone: "invalid" })).toBe(false);
  expect(goalPeriodState({ period: currentGoalPeriod("week", new Date("2026-09-28T12:00:00Z"), "UTC") }, now)).toBe("future");
});
