import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { currentGoalPeriod, goalPeriodState, type GoalHorizon } from "../src/lib/goal-periods";
import { audienceMeasurementIdentity } from "../src/lib/audience-measurement";

const platforms = ["youtube", "instagram", "tiktok", "linkedin"];
const metrics = ["followers", "views", "likes", "posts", "videos"];
const profileKeys = ["businessName", "whatYouDo", "whoYouHelp", "quarterGoal", "personalPriorities", "preferredName", "longTermDirection"];
const defaultWidgets = { aiSpend: true, dream: true, inbox: true, calendar: true, memory: true, audience: true, cash: true, goals: true, dailyBrief: true };
const string = (v: unknown, limit = 3000) => typeof v === "string" ? v.trim().slice(0, limit) : "";
const iso = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v.slice(0,10) + "T00:00:00Z").toISOString().slice(0,10) !== v.slice(0,10)) throw new Error("Include a valid observation date.");
  return new Date(v).toISOString();
};
const monthlyIncome = (v: any) => {
  if (!v || typeof v !== "object" || typeof v.amount !== "number" || !Number.isFinite(v.amount) || v.amount < 0 || v.amount > 1e12)
    throw new Error("Monthly income needs a finite, non-negative amount.");
  if (typeof v.currency !== "string" || !/^[A-Z]{3}$/.test(v.currency)) throw new Error("Monthly income needs a three-letter currency code.");
  if (v.days !== 30) throw new Error("Monthly income covers the trailing 30 days.");
  if (!Number.isInteger(v.transactions) || v.transactions < 0 || v.transactions > 100000) throw new Error("Monthly income needs a transaction count.");
  const slice = (value: any) => value && typeof value === "object" && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount >= 0 && value.amount <= 1e12 && Number.isInteger(value.transactions) && value.transactions >= 0 && value.transactions <= 100000
    ? { amount: Math.round(value.amount * 100) / 100, transactions: value.transactions } : undefined;
  return { amount: Math.round(v.amount * 100) / 100, currency: v.currency, days: 30, recordedAt: iso(v.recordedAt), transactions: v.transactions,
    ...(slice(v.today) ? { today: slice(v.today) } : {}), ...(slice(v.week) ? { week: slice(v.week) } : {}),
    ...(typeof v.windowStart === "string" && Number.isFinite(Date.parse(v.windowStart)) ? { windowStart: new Date(v.windowStart).toISOString() } : {}),
    ...(typeof v.windowEnd === "string" && Number.isFinite(Date.parse(v.windowEnd)) ? { windowEnd: new Date(v.windowEnd).toISOString() } : {}) };
};
const sourceUrl = (v: unknown) => {
  if (!v) return undefined;
  let parsed: URL;
  try { parsed = new URL(string(v, 2000)); } catch { throw new Error("Use a valid source URL."); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password)
    throw new Error("Use an HTTP or HTTPS source URL without credentials.");
  return parsed.href;
};

export function businessWorkspace(root: string, options: { now?: () => Date; timeZone?: string } = {}) {
  const directory = join(root, ".operator-data"), file = join(directory, "business.json");
  const blank = () => ({ profile: {}, snapshots: [] as any[], widgets: { ...defaultWidgets }, progress: { goals: [] as any[], updates: [] as any[] } });
  const read = (): any => {
    if (!existsSync(file)) return blank();
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(data.snapshots) || !data.profile || !data.widgets) throw new Error();
      // Mercury accounts are US dollar accounts. Snapshots saved before the adapter
      // defaulted the currency keep their stored record; only the read fills USD in.
      const finances = data.finances && /^Mercury\b/.test(String(data.finances.sourceLabel || "")) && Array.isArray(data.finances.accounts)
        ? { ...data.finances, accounts: data.finances.accounts.map((a: any) => a && typeof a === "object" && !a.currency ? { ...a, currency: "USD" } : a) }
        : data.finances;
      // Observations for a platform this workspace does not track are ignored.
      const snapshots = data.snapshots.filter((s: any) => s && platforms.includes(s.platform));
      return { ...blank(), ...data, snapshots, ...(finances ? { finances } : {}), widgets: { ...defaultWidgets, ...data.widgets } };
    } catch { throw new Error("Business data could not be read. Existing records were left untouched."); }
  };
  const write = (visible: any) => {
    let data = visible;
    // Observations for a platform this edition does not track are hidden on read
    // and kept on write, so saving never deletes history.
    try {
      const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
      const hidden = Array.isArray(raw.snapshots) ? raw.snapshots.filter((s: any) => s && !platforms.includes(s.platform)) : [];
      if (hidden.length) data = { ...data, snapshots: [...(Array.isArray(data.snapshots) ? data.snapshots : []), ...hidden] };
    } catch { /* an unreadable file is handled by read() */ }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = file + "." + randomUUID();
    writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(temp, file);
    return visible;
  };
  return {
    read,
    update(body: any) {
      const data = read();
      if (body.profile && typeof body.profile === "object") {
        for (const key of profileKeys) if (typeof body.profile[key] === "string") data.profile[key] = string(body.profile[key]);
        if (body.profile.revenueTargetMonthly !== undefined) {
          const target = body.profile.revenueTargetMonthly;
          if (target === null) delete data.profile.revenueTargetMonthly;
          else {
            if (typeof target !== "number" || !Number.isFinite(target) || target <= 0 || target > 1e12) throw new Error("Enter a monthly revenue target above zero.");
            data.profile.revenueTargetMonthly = Math.round(target * 100) / 100;
          }
        }
      }
      if (body.widgets && typeof body.widgets === "object")
        for (const key of Object.keys(defaultWidgets)) if (typeof body.widgets[key] === "boolean") data.widgets[key] = body.widgets[key];
      return write(data);
    },
    importSnapshots(body: any) {
      if (!Array.isArray(body.snapshots) || !body.snapshots.length || body.snapshots.length > 500)
        throw new Error("Import between 1 and 500 observations at a time.");
      const incoming = body.snapshots.map((s: any) => {
        if (!s || !platforms.includes(s.platform) || !s.metrics || typeof s.metrics !== "object")
          throw new Error("Each observation needs a supported platform and its metrics.");
        const values: Record<string, number> = {};
        for (const key of metrics) if (s.metrics[key] !== undefined) {
          const n = s.metrics[key];
          if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)
            throw new Error("Metrics must be finite, non-negative numbers.");
          values[key] = n;
        }
        if (!Object.keys(values).length) throw new Error("Add at least one measured metric.");
        const recordedAt = iso(s.recordedAt);
        if (Date.parse(recordedAt) > Date.now() + 86400000) throw new Error("Observations cannot be future forecasts.");
        const origin = ["manual", "import", "connector"].includes(s.origin) ? s.origin : "import";
        const url = sourceUrl(s.sourceUrl), identity = audienceMeasurementIdentity(s.platform, s.measurementScope, url);
        if (s.measurementScope !== undefined && !identity) throw new Error("Use a supported measurement scope and matching channel or community source URL.");
        // Scoped observations cannot inherit unverified metrics from an older
        // import at the same timestamp. Existing legacy records keep their IDs.
        const identityParts = [s.platform, recordedAt, origin, ...(identity ? [s.measurementScope, identity] : [])];
        return { id: createHash("sha256").update(identityParts.join(":" )).digest("hex").slice(0,24),
          platform: s.platform, recordedAt, metrics: values, origin,
          sourceLabel: string(s.sourceLabel, 200) || (origin === "manual" ? "Entered by you" : "Imported observation"),
          sourceUrl: url, ...(identity ? { measurementScope: s.measurementScope } : {}) };
      });
      const data = read(), records = new Map(data.snapshots.map((s: any) => [s.id, s]));
      for (const snapshot of incoming) {
        const previous: any = records.get(snapshot.id);
        records.set(snapshot.id, { ...snapshot, metrics: { ...previous?.metrics, ...snapshot.metrics } });
      }
      if (records.size > 5000) throw new Error("This workspace supports up to 5,000 observations. Existing history was preserved.");
      data.snapshots = [...records.values()].sort((a: any, b: any) => a.recordedAt.localeCompare(b.recordedAt));
      return write(data);
    },
    progress(body: any) {
      const data = read(); data.progress ||= { goals: [], updates: [] };
      const p = data.progress, clock = options.now?.() || new Date(), at = clock.toISOString();
      const timeZone = typeof body.timeZone === "string" ? body.timeZone : options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      let updateText = "", goalId: string | undefined;
      const upsertGoal = (input: any, currentOnly = false) => {
        const previous = input.id ? p.goals.find((g: any) => g.id === input.id) : undefined;
        if (input.id && !previous) throw new Error("That goal was not found. Refresh and try again.");
        if (currentOnly && previous && goalPeriodState(previous, clock) !== "current") throw new Error("That goal belongs to an earlier period. Start a new goal to preserve its history.");
        const title = typeof input.title === "string" ? string(input.title, 300) : previous?.title;
        const horizon = input.horizon || previous?.horizon;
        const status = input.status || previous?.status || "planned";
        if (!title || !["quarter", "month", "week"].includes(horizon) || !["planned", "active", "done"].includes(status))
          throw new Error("Choose a title, time horizon and valid status.");
        if (previous && horizon !== previous.horizon) throw new Error("Create a new goal to change its time horizon.");
        const period = previous ? previous.period : currentGoalPeriod(horizon as GoalHorizon, clock, timeZone);
        const renewFrom = input.renewedFromId ? p.goals.find((g: any) => g.id === input.renewedFromId && g.horizon === horizon) : undefined;
        if (input.renewedFromId && (!renewFrom || goalPeriodState(renewFrom, clock) === "current" || goalPeriodState(renewFrom, clock) === "future")) throw new Error("Choose a previous goal to carry forward.");
        if (renewFrom && p.goals.some((g: any) => g.renewedFromId === renewFrom.id && goalPeriodState(g, clock) === "current")) throw new Error("That goal has already been carried into this period. Edit the current goal instead.");
        if (!previous && p.goals.length >= 100) throw new Error("Keep up to 100 goals in this workspace.");
        const goal = { id: previous?.id || randomUUID(), title, horizon, status,
          notes: typeof input.notes === "string" ? string(input.notes, 4000) : previous?.notes || "", updatedAt: at,
          ...(period ? { period } : {}), ...(renewFrom ? { renewedFromId: renewFrom.id } : {}) };
        if (previous) Object.assign(previous, goal); else p.goals.push(goal);
        return { goal, updateText: renewFrom ? `Carried forward ${horizon} goal: ${title}` : !previous ? `Added ${horizon} goal: ${title}` : `${status === "done" ? "Completed" : "Updated"}: ${title}` };
      };
      if (body.action === "setup-goals") {
        if (!Array.isArray(body.goals) || !body.goals.length || body.goals.length > 3 || new Set(body.goals.map((goal: any) => goal?.horizon)).size !== body.goals.length) throw new Error("Choose one goal per quarter, month and week.");
        for (const input of body.goals) {
          if (!input || typeof input !== "object") throw new Error("Choose a valid goal.");
          const result = upsertGoal(input, true);
          p.updates.unshift({ id: randomUUID(), text: result.updateText, createdAt: at, goalId: result.goal.id });
        }
        if (p.updates.length > 1000) throw new Error("This workspace has 1,000 progress updates. Export the history before adding more.");
        return write(data);
      } else if (body.action === "goal") {
        const result = upsertGoal(body);
        goalId = result.goal.id; updateText = result.updateText;
      } else if (body.action === "remove-goal") {
        const goal = p.goals.find((g: any) => g.id === body.id);
        if (!goal) throw new Error("That goal was not found.");
        p.goals = p.goals.filter((g: any) => g.id !== body.id); updateText = `Removed goal: ${goal.title}`;
      } else if (body.action === "check-in") {
        updateText = string(body.text, 4000);
        if (!updateText) throw new Error("Write a short progress update.");
        if (body.goalId && !p.goals.some((g: any) => g.id === body.goalId)) throw new Error("Choose an existing goal.");
        goalId = body.goalId || undefined;
      } else throw new Error("Choose a progress action.");
      p.updates.unshift({ id: randomUUID(), text: updateText, createdAt: at, ...(goalId ? { goalId } : {}) });
      if (p.updates.length > 1000) throw new Error("This workspace has 1,000 progress updates. Export the history before adding more.");
      return write(data);
    },
    importFinances(body: any) {
      if (!Array.isArray(body.accounts) || !body.accounts.length || body.accounts.length > 100)
        throw new Error("Include between 1 and 100 account balances.");
      const accounts = body.accounts.map((a: any) => {
        if (!a || !string(a.name, 200) || typeof a.balance !== "number" || !Number.isFinite(a.balance))
          throw new Error("Each account needs a name and finite balance.");
        if (a.currency && !/^[A-Z]{3}$/.test(a.currency)) throw new Error("Use a three-letter currency code or leave it unknown.");
        return { name: string(a.name, 200), balance: a.balance, currency: a.currency || null, sourceId: string(a.sourceId, 12) };
      });
      const data = read(), previous = data.finances || {};
      const finances: any = { accounts, recordedAt: iso(body.recordedAt), sourceLabel: string(body.sourceLabel, 200) || "Imported balances", sourceUrl: sourceUrl(body.sourceUrl) };
      if (body.monthlyIncome !== undefined && body.monthlyIncome !== null) finances.monthlyIncome = monthlyIncome(body.monthlyIncome);
      // A failed transaction read keeps the last dated income total; its own recordedAt says how old it is.
      else if (body.monthlyIncome === undefined && previous.monthlyIncome && previous.sourceLabel === finances.sourceLabel) finances.monthlyIncome = previous.monthlyIncome;
      const incomeError = string(body.monthlyIncomeError, 300);
      if (incomeError) finances.monthlyIncomeError = { message: incomeError, at: finances.recordedAt };
      data.finances = finances; return write(data);
    },
  };
}
