// Plan limits: the real server-side rate-limit windows for Claude and Codex,
// normalised into one shape the dashboard draws. Pure helpers so they can be
// tested without running the aggregator.
//
// Every number here comes from the provider itself:
//   - Claude, live: Anthropic's OAuth /usage endpoint (same data as /usage).
//   - Claude, app: the Claude desktop app's own plan-usage-history.json, which
//     the app fills from the same endpoint every ~15 minutes. It carries the
//     5-hour and weekly percentages but no reset times.
//   - Codex: OpenAI's rate-limit snapshot stamped into every Codex session log.
// Nothing is estimated. When no source is readable the result says why.

export type LimitWindow = {
  id: string;
  label: string;
  pct: number;
  /** ISO time the window resets, or null when the source does not say. */
  resetsAt: string | null;
  minutes: number | null;
};

export type PlanLimits = {
  source: "oauth-usage-api" | "claude-app" | "codex-logs" | null;
  /** When the provider produced these numbers (ISO). */
  asOf: string | null;
  plan: string | null;
  windows: LimitWindow[];
  /** Plain reason shown when there is nothing live to draw. */
  reason?: string;
};

// Both providers report 0-100 percentages.
const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function windowLabel(minutes: number): string {
  if (minutes >= 7 * 24 * 60 - 60) return "Weekly";
  if (minutes >= 24 * 60 - 30 && minutes <= 24 * 60 + 30) return "Daily";
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}

export function planName(subscriptionType?: string | null, rateLimitTier?: string | null): string | null {
  const tier = `${rateLimitTier ?? ""}`.toLowerCase();
  const sub = `${subscriptionType ?? ""}`.toLowerCase();
  if (/20x/.test(tier) || /20x/.test(sub)) return "Max 20x";
  if (/5x/.test(tier) || /5x/.test(sub)) return "Max 5x";
  if (sub === "max") return "Max";
  if (sub === "pro") return "Pro";
  if (sub === "team") return "Team";
  if (sub === "enterprise") return "Enterprise";
  return sub ? sub[0].toUpperCase() + sub.slice(1) : null;
}

/** The plan Claude Code itself stored beats the usage guess. A bare "Max" does not say 5x or 20x, so the guess stands. */
export function resolveClaudePlan(signInPlan: string | null, planGuess: string): { plan: string; known: boolean } {
  const known = !!signInPlan && signInPlan !== "Max";
  return { plan: known ? `Claude ${signInPlan}` : planGuess, known };
}

const MODEL_WINDOW_SKIP = new Set(["oauth_apps"]);

/** Claude OAuth /usage response → windows, in the order the Claude app lists them. */
export function claudeLimitsFromOAuth(data: any, asOf: string, plan: string | null): PlanLimits | null {
  if (!data || typeof data !== "object") return null;
  const windows: LimitWindow[] = [];
  const add = (id: string, label: string, minutes: number) => {
    const w = data[id];
    if (!w || typeof w.utilization !== "number") return;
    windows.push({ id, label, pct: clampPct(w.utilization), resetsAt: w.resets_at ?? null, minutes });
  };
  add("five_hour", "5-hour", 300);
  add("seven_day", "Weekly", 10080);
  for (const key of Object.keys(data)) {
    const m = /^seven_day_(.+)$/.exec(key);
    if (!m || MODEL_WINDOW_SKIP.has(m[1])) continue;
    const model = m[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    add(key, `Weekly ${model}`, 10080);
  }
  if (windows.length === 0) return null;
  return { source: "oauth-usage-api", asOf, plan, windows };
}

/**
 * The Claude desktop app's plan-usage-history.json → the newest sample.
 * Samples look like { t: ms, org, u: { fh: 5h %, sd: 7d %, xu: extra % } }.
 * A sample older than `maxAgeMs` is treated as not live.
 */
export function claudeLimitsFromAppHistory(json: any, now: number, plan: string | null, maxAgeMs = 2 * 36e5): PlanLimits | null {
  const samples: any[] = Array.isArray(json?.samples) ? json.samples : [];
  let best: any = null;
  for (const s of samples) if (s && typeof s.t === "number" && s.u && (!best || s.t > best.t)) best = s;
  if (!best || now - best.t > maxAgeMs) return null;
  const windows: LimitWindow[] = [];
  // A 5-hour reading older than five hours has already rolled over.
  if (typeof best.u.fh === "number" && now - best.t < 5 * 36e5) windows.push({ id: "five_hour", label: "5-hour", pct: clampPct(best.u.fh), resetsAt: null, minutes: 300 });
  if (typeof best.u.sd === "number") windows.push({ id: "seven_day", label: "Weekly", pct: clampPct(best.u.sd), resetsAt: null, minutes: 10080 });
  if (windows.length === 0) return null;
  return { source: "claude-app", asOf: new Date(best.t).toISOString(), plan, windows };
}

/**
 * Codex session log text → the newest rate-limit snapshot in it, with the time
 * it was recorded. Reads from the end, so the last snapshot in the file wins.
 */
export function codexSnapshotFromLog(text: string): { at: number; rateLimits: any } | null {
  let end = text.length;
  while (end > 0) {
    const idx = text.lastIndexOf('"rate_limits"', end);
    if (idx < 0) return null;
    const lineStart = text.lastIndexOf("\n", idx) + 1;
    let lineEnd = text.indexOf("\n", idx);
    if (lineEnd < 0) lineEnd = text.length;
    end = lineStart - 1;
    try {
      const row = JSON.parse(text.slice(lineStart, lineEnd));
      const rl = row?.payload?.rate_limits ?? row?.rate_limits;
      if (!rl || (!rl.primary && !rl.secondary)) continue;
      const at = Date.parse(row.timestamp ?? "");
      return { at: Number.isFinite(at) ? at : 0, rateLimits: rl };
    } catch {
      continue;
    }
  }
  return null;
}

/** Newest of several snapshots → windows (primary and secondary, whichever exist). */
export function codexLimitsFromSnapshots(snaps: ({ at: number; rateLimits: any } | null)[]): PlanLimits | null {
  let best: { at: number; rateLimits: any } | null = null;
  for (const s of snaps) if (s && (!best || s.at > best.at)) best = s;
  if (!best) return null;
  const rl = best.rateLimits;
  const windows: LimitWindow[] = [];
  for (const [id, w] of [["primary", rl.primary], ["secondary", rl.secondary]] as const) {
    if (!w || typeof w.used_percent !== "number") continue;
    const minutes = Number(w.window_minutes) || null;
    windows.push({
      id,
      label: minutes ? windowLabel(minutes) : id === "primary" ? "Primary" : "Secondary",
      pct: clampPct(w.used_percent),
      resetsAt: w.resets_at ? new Date(Number(w.resets_at) * 1000).toISOString() : null,
      minutes,
    });
  }
  // Shortest window first, so the order matches Claude (5-hour, then weekly).
  windows.sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));
  if (windows.length === 0) return null;
  const plan = typeof rl.plan_type === "string" ? rl.plan_type[0].toUpperCase() + rl.plan_type.slice(1) : null;
  return { source: "codex-logs", asOf: best.at ? new Date(best.at).toISOString() : null, plan, windows };
}
