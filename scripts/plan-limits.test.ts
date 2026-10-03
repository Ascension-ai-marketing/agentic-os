import { describe, expect, test } from "bun:test";
import {
  claudeLimitsFromAppHistory,
  claudeLimitsFromOAuth,
  codexLimitsFromSnapshots,
  codexSnapshotFromLog,
  planName,
  windowLabel,
} from "./plan-limits";

describe("plan limits", () => {
  test("labels windows by their real length", () => {
    expect(windowLabel(10080)).toBe("Weekly");
    expect(windowLabel(300)).toBe("5-hour");
    expect(windowLabel(1440)).toBe("Daily");
  });

  test("reads the plan from keychain metadata", () => {
    expect(planName("max", "default_claude_max_20x")).toBe("Max 20x");
    expect(planName("max", null)).toBe("Max");
    expect(planName("pro", null)).toBe("Pro");
    expect(planName(null, null)).toBeNull();
  });

  test("Claude OAuth response keeps every window and its reset", () => {
    const r = claudeLimitsFromOAuth(
      {
        five_hour: { utilization: 12, resets_at: "2026-09-28T15:00:00Z" },
        seven_day: { utilization: 9.4, resets_at: "2026-09-29T14:00:00Z" },
        seven_day_opus: { utilization: 3, resets_at: "2026-09-29T14:00:00Z" },
        seven_day_sonnet: null,
        seven_day_oauth_apps: { utilization: 1 },
        extra_usage: { is_enabled: true },
      },
      "2026-09-28T14:50:00Z",
      "Max 20x",
    );
    expect(r?.source).toBe("oauth-usage-api");
    expect(r?.windows.map((w) => [w.label, w.pct, w.resetsAt])).toEqual([
      ["5-hour", 12, "2026-09-28T15:00:00Z"],
      ["Weekly", 9, "2026-09-29T14:00:00Z"],
      ["Weekly Opus", 3, "2026-09-29T14:00:00Z"],
    ]);
  });

  test("Claude OAuth error bodies give no windows", () => {
    expect(claudeLimitsFromOAuth({ error: "nope" }, "x", null)).toBeNull();
    expect(claudeLimitsFromOAuth(null, "x", null)).toBeNull();
  });

  test("Claude app history uses the newest fresh sample, never a stale one", () => {
    const now = Date.parse("2026-09-28T15:00:00Z");
    const json = {
      samples: [
        { t: now - 3 * 36e5, u: { fh: 40, sd: 50 } },
        { t: now - 10 * 6e4, u: { fh: 11, sd: 9 } },
      ],
    };
    const r = claudeLimitsFromAppHistory(json, now, "Max");
    expect(r?.source).toBe("claude-app");
    expect(r?.windows.map((w) => [w.id, w.pct, w.resetsAt])).toEqual([
      ["five_hour", 11, null],
      ["seven_day", 9, null],
    ]);
    expect(claudeLimitsFromAppHistory(json, now + 5 * 36e5, "Max")).toBeNull();
  });

  test("Codex: the newest snapshot across files wins", () => {
    const line = (ts: string, pct: number) =>
      JSON.stringify({ timestamp: ts, payload: { type: "token_count", rate_limits: { primary: { used_percent: pct, window_minutes: 10080, resets_at: 1791051015 }, secondary: null, plan_type: "pro" } } });
    const a = codexSnapshotFromLog([line("2026-09-28T14:00:00Z", 9), line("2026-09-28T14:10:00Z", 10), '{"x":1}'].join("\n"));
    const b = codexSnapshotFromLog(line("2026-09-28T14:50:00Z", 11));
    expect(a?.rateLimits.primary.used_percent).toBe(10);
    const r = codexLimitsFromSnapshots([a, b, null]);
    expect(r?.plan).toBe("Pro");
    expect(r?.windows).toEqual([{ id: "primary", label: "Weekly", pct: 11, resetsAt: new Date(1791051015 * 1000).toISOString(), minutes: 10080 }]);
  });

  test("Codex: both windows, shortest first", () => {
    const text = JSON.stringify({
      timestamp: "2026-09-28T14:00:00Z",
      payload: { rate_limits: { primary: { used_percent: 30, window_minutes: 300, resets_at: 1 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: 2 } } },
    });
    const r = codexLimitsFromSnapshots([codexSnapshotFromLog(text)]);
    expect(r?.windows.map((w) => w.label)).toEqual(["5-hour", "Weekly"]);
  });
});
