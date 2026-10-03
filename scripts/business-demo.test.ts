import { expect, test } from "bun:test";
import { demoAudience, demoBrief } from "../src/lib/business-demo";
import { BUSINESS_SAMPLE, monthTotal } from "../src/lib/business-intel";
test("the presentation scenario keeps cash, income, goal and audience consistent", () => {
  expect(BUSINESS_SAMPLE.accounts.reduce((sum, account) => sum + account.balance, 0)).toBe(1_000_000);
  expect(BUSINESS_SAMPLE.balanceHistory.at(-1)).toBe(1_000_000);
  expect(monthTotal(BUSINESS_SAMPLE.months.at(-1)!)).toBe(400_000);
  expect(BUSINESS_SAMPLE.months.slice(-3).reduce((sum, month) => sum + monthTotal(month), 0)).toBe(1_200_000);
  expect(BUSINESS_SAMPLE.expensesThisMonth.reduce((sum, line) => sum + line.amount, 0)).toBe(BUSINESS_SAMPLE.months.at(-1)!.expenses);
  const date = new Date("2026-09-17T12:00:00Z");
  const points = demoAudience(date);
  expect(points).toHaveLength(124);
  expect(points.every(point => point.sourceLabel.startsWith("Demo"))).toBe(true);
  expect(points.filter(point => point.platform === "youtube").at(-1)?.metrics.followers).toBe(284600);
  const report = demoBrief(0, date), refreshed = demoBrief(1, date);
  expect(report.priorityActions[0].text).toContain("284,600");
  expect(refreshed.priorityActions[0].text).toContain("$300,000");
  expect(refreshed.summary).toBe(report.summary);
});
