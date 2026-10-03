export type GoalHorizon = "quarter" | "month" | "week";
export interface GoalPeriod { startDate: string; endDate: string; timeZone: string }
export type GoalPeriodState = "current" | "past" | "future" | "undated";

export function localDateInZone(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {
  if (!Number.isFinite(now.getTime())) throw new Error("Choose a valid goal date.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function periodAtDate(horizon: GoalHorizon, localDate: string, timeZone: string): GoalPeriod {
  const day = new Date(`${localDate}T12:00:00Z`), start = new Date(day), end = new Date(day);
  if (horizon === "week") {
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    start.setUTCDate(day.getUTCDate() - mondayOffset);
    // Civil-date arithmetic avoids 23/25-hour days at daylight-saving boundaries.
    end.setTime(start.getTime()); end.setUTCDate(start.getUTCDate() + 6);
  } else {
    const startMonth = horizon === "quarter" ? Math.floor(day.getUTCMonth() / 3) * 3 : day.getUTCMonth();
    start.setUTCDate(1); start.setUTCMonth(startMonth);
    end.setTime(start.getTime()); end.setUTCMonth(startMonth + (horizon === "quarter" ? 3 : 1), 0);
  }
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), timeZone };
}

export function currentGoalPeriod(horizon: GoalHorizon, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"): GoalPeriod {
  if (!["quarter", "month", "week"].includes(horizon)) throw new Error("Choose a quarter, month or week goal.");
  return periodAtDate(horizon, localDateInZone(now, timeZone), timeZone);
}

export function validGoalPeriod(period: unknown, horizon?: GoalHorizon): period is GoalPeriod {
  if (!period || typeof period !== "object") return false;
  const candidate = period as GoalPeriod;
  if (![candidate.startDate, candidate.endDate].every(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) || typeof candidate.timeZone !== "string") return false;
  try {
    for (const value of [candidate.startDate, candidate.endDate]) if (new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) return false;
    localDateInZone(new Date(), candidate.timeZone);
    if (candidate.startDate > candidate.endDate) return false;
    if (horizon) {
      const expected = periodAtDate(horizon, candidate.startDate, candidate.timeZone);
      return expected.startDate === candidate.startDate && expected.endDate === candidate.endDate;
    }
    return true;
  } catch { return false; }
}

export function goalPeriodState(goal: { period?: GoalPeriod; horizon?: GoalHorizon }, now = new Date()): GoalPeriodState {
  if (!validGoalPeriod(goal.period, goal.horizon)) return "undated";
  const today = localDateInZone(now, goal.period.timeZone);
  return today < goal.period.startDate ? "future" : today > goal.period.endDate ? "past" : "current";
}
