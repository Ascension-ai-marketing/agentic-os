import type { BusinessWorkspace } from "./business-workspace";
import { goalPeriodState } from "./goal-periods";

/** Keep expired commitments available as history without presenting them as this week's work. */
export function businessGoalContext(workspace?: Pick<BusinessWorkspace, "profile" | "progress">, now = new Date()) {
  const all = workspace?.progress?.goals || [];
  const current = all.filter(goal => goalPeriodState(goal, now) === "current");
  const titleFor = (horizon: string) => current
    .filter(goal => goal.horizon === horizon && goal.status !== "done")
    .map(goal => goal.title).join("; ");
  const compact = (goal: typeof all[number]) => ({ ...goal, notes: (goal.notes || "").slice(0, 500) });
  return {
    goals: {
      longTerm: workspace?.profile.longTermDirection || "",
      quarter: titleFor("quarter"), month: titleFor("month"), week: titleFor("week"), metrics: [],
    },
    progress: {
      interpretation: "Goals are current only within their saved local date period. History and undated goals are context, not renewed commitments. Ask for a new weekly goal after Sunday; never silently carry one forward.",
      goals: current.slice(0, 30).map(compact),
      history: all.filter(goal => goalPeriodState(goal, now) !== "current").slice(-20)
        .map(goal => ({ ...compact(goal), periodState: goalPeriodState(goal, now) })),
      needsReview: ["quarter", "month", "week"].filter(horizon => !current.some(goal => goal.horizon === horizon)),
      updates: (workspace?.progress?.updates || []).slice(0, 10).map(update => ({ ...update, text: update.text.slice(0, 500) })),
    },
  };
}
