import { expect, test } from "bun:test";
import { businessGoalContext } from "../src/lib/business-goal-context";
import type { BusinessWorkspace, ProgressGoal } from "../src/lib/business-workspace";
const week = { startDate: "2026-09-14", endDate: "2026-09-20", timeZone: "Europe/Vienna" };
const goal = (id: string, extra: Partial<ProgressGoal> = {}): ProgressGoal => ({ id, title: id, horizon: "week", status: "active", notes: "", updatedAt: "2026-09-16T12:00:00Z", period: week, ...extra });
test("advisor separates old and undated goals and never promotes a legacy quarter label", () => {
  const workspace: Pick<BusinessWorkspace, "profile" | "progress"> = {
    profile: { quarterGoal: "Old unreviewed quarter", longTermDirection: "A resilient business" },
    progress: { goals: [goal("Current"), goal("Already done", { status: "done" }), goal("Old", { period: { ...week, startDate: "2026-09-07", endDate: "2026-09-13" } }), goal("Undated", { period: undefined })], updates: [] },
  };
  const context = businessGoalContext(workspace, new Date("2026-09-20T21:59:59Z"));
  expect(context.goals.week).toBe("Current");
  expect(context.goals.quarter).toBe("");
  expect(context.goals.longTerm).toBe("A resilient business");
  expect(context.progress.goals.map(g => g.id)).toEqual(["Current", "Already done"]);
  expect(context.progress.history.map(g => g.periodState)).toEqual(["past", "undated"]);
  expect(context.progress.needsReview).not.toContain("week");
  const monday = businessGoalContext(workspace, new Date("2026-09-20T22:00:00Z"));
  expect(monday.goals.week).toBe("");
  expect(monday.progress.needsReview).toContain("week");
  expect(monday.progress.history).toHaveLength(4);
  expect(workspace.progress!.goals[0].status).toBe("active");
});
test("empty workspace has no implied commitments", () => {
  const context = businessGoalContext();
  expect(context.goals.week).toBe("");
  expect(context.progress.goals).toEqual([]);
  expect(context.progress.needsReview).toEqual(["quarter", "month", "week"]);
});
