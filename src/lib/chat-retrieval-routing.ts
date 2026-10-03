/** Local memory is always searched first. Inbox retrieval needs a mail request. */
export function needsChatEmail(request: string, hasEmailPageContext = false): boolean {
  return /\b(?:e-?mails?|gmail|outlook|inbox|mailbox|sender|subject\s+line)\b/i.test(request)
    || (hasEmailPageContext && /\b(?:reply|respond|draft|summari[sz]e|this\s+(?:message|thread)|that\s+(?:message|thread))\b/i.test(request));
}

/** A date window the user named, in local time: today, this morning, yesterday, a weekday or an explicit date. */
export type ChatTimeWindow = { label: string; start: number; end: number };

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// "This morning" runs to 13:00: a session that starts before lunch and ends
// just after noon still belongs to the morning the user is asking about.
const PARTS: Record<string, [number, number]> = { morning: [4, 13], afternoon: [12, 17], evening: [17, 24], night: [17, 24] };
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const shift = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const at = (d: Date, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime();
export const formatWindowDay = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear()}`;
const day = (d: Date, label: string, part?: string): ChatTimeWindow => {
  const [from, to] = part && PARTS[part] ? PARTS[part] : [0, 24];
  const clock = part && PARTS[part] ? `, ${String(from).padStart(2, "0")}:00–${to === 24 ? "24:00" : String(to).padStart(2, "0") + ":00"}` : "";
  return { label: `${label} (${formatWindowDay(d)}${clock})`, start: at(d, from), end: at(d, to) };
};
const exact = (d: Date): ChatTimeWindow => ({ label: "on " + formatWindowDay(d), start: at(d, 0), end: at(d, 24) });
const monthIndex = (name: string) => MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3)));

/** Parse the date window a question refers to, or null when it names none. */
export function chatTimeWindow(request: string, now = new Date()): ChatTimeWindow | null {
  const text = request.toLowerCase();
  const today = dayStart(now);
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return exact(d);
  }
  const monthNames = MONTHS.map((m) => m.slice(0, 3) + "(?:" + m.slice(3) + ")?").join("|");
  const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b(?:,?\\s+(\\d{4}))?`));
  const monthFirst = text.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`));
  const explicit = dayFirst
    ? { dayOfMonth: Number(dayFirst[1]), month: monthIndex(dayFirst[2]), year: dayFirst[3] }
    : monthFirst
      ? { dayOfMonth: Number(monthFirst[2]), month: monthIndex(monthFirst[1]), year: monthFirst[3] }
      : null;
  if (explicit && explicit.month >= 0 && explicit.dayOfMonth >= 1 && explicit.dayOfMonth <= 31) {
    let d = new Date(explicit.year ? Number(explicit.year) : now.getFullYear(), explicit.month, explicit.dayOfMonth);
    // Without a year, a date later than today means the most recent one.
    if (!explicit.year && d.getTime() > today.getTime()) d = new Date(d.getFullYear() - 1, explicit.month, explicit.dayOfMonth);
    if (d.getMonth() === explicit.month) return exact(d);
  }
  if (/\blast\s+night\b/.test(text)) {
    const yesterday = shift(today, -1);
    return { label: `last night (${formatWindowDay(yesterday)} evening)`, start: at(yesterday, 18), end: at(today, 6) };
  }
  const yesterday = text.match(/\byesterday(?:\s+(morning|afternoon|evening))?\b/);
  if (yesterday) return day(shift(today, -1), yesterday[1] ? `yesterday ${yesterday[1]}` : "yesterday", yesterday[1]);
  const todayPart = text.match(/\b(?:this|earlier\s+this)\s+(morning|afternoon|evening)\b|\b(tonight)\b/);
  if (todayPart) {
    const part = todayPart[1] || "evening";
    return day(today, todayPart[2] ? "tonight" : `this ${part}`, part);
  }
  if (/\b(?:today|earlier\s+today|so\s+far\s+today)\b/.test(text)) return day(today, "today");
  const week = text.match(/\b(this|last)\s+week\b/);
  if (week) {
    const monday = shift(today, -((today.getDay() + 6) % 7));
    const start = week[1] === "last" ? shift(monday, -7) : monday;
    const end = week[1] === "last" ? monday : shift(today, 1);
    return { label: `${week[1]} week (${formatWindowDay(start)} to ${formatWindowDay(shift(end, -1))})`, start: start.getTime(), end: end.getTime() };
  }
  const weekday = text.match(new RegExp(`\\b(last\\s+|this\\s+|on\\s+)?(${WEEKDAYS.join("|")})(?:'s)?\\b`));
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]);
    let back = (today.getDay() - target + 7) % 7;
    if (back === 0 && /^last\s+/.test(weekday[1] || "")) back = 7;
    const d = shift(today, -back);
    return day(d, weekday[2].replace(/^./, (c) => c.toUpperCase()));
  }
  return null;
}

/** When a memory record's underlying activity happened, from the sync stamp or a dated name. */
export function recordActivityRange(record: {
  title?: string;
  connector?: { path?: string; activityAt?: string };
}): { start: number; end: number } | null {
  const named = `${record.title || ""} ${record.connector?.path || ""}`;
  const stamped = named.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  const dated = stamped || named.match(/(\d{4})[-/](\d{2})[-/](\d{2})(?![\d-])/);
  const start = dated
    ? new Date(Number(dated[1]), Number(dated[2]) - 1, Number(dated[3]), Number(dated[4] || 0), Number(dated[5] || 0), Number(dated[6] || 0)).getTime()
    : NaN;
  const end = record.connector?.activityAt ? Date.parse(record.connector.activityAt) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) return { start: end, end };
  if (Number.isNaN(end) || end < start) return { start, end: stamped ? start : start + DAY - 1 };
  return { start, end };
}

export function inTimeWindow(range: { start: number; end: number }, window: ChatTimeWindow): boolean {
  return range.start < window.end && range.end >= window.start;
}

/** How far a record sits outside the window, when it happened on the window's local day.
 * 0 inside the window; null on another day. Lets an empty window fall back to the
 * nearest same-day record instead of nothing. */
export function sameDayDistance(range: { start: number; end: number }, window: ChatTimeWindow): number | null {
  if (inTimeWindow(range, window)) return 0;
  const day = dayStart(new Date(window.start)).getTime();
  if (range.end < day || range.start >= day + DAY) return null;
  return range.start >= window.end ? range.start - window.end : window.start - range.end;
}

/** Apps a question names. Retrieval then prefers that app's records and the reply
 * must not present another app's record as the answer. */
export type ChatAppFocus = { id: string; name: string };
const APP_NAMES: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  hermes: "Hermes",
  gmail: "Gmail",
  outlook: "Outlook",
  slack: "Slack",
  notion: "Notion",
  granola: "Granola",
  obsidian: "Obsidian",
  chatgpt: "ChatGPT",
};
export function chatAppFocus(request: string): ChatAppFocus[] {
  const seen = new Set<string>();
  const found: ChatAppFocus[] = [];
  for (const match of request.toLowerCase().matchAll(/\b(codex|claude|hermes|gmail|outlook|slack|notion|granola|obsidian|chatgpt|chat\s?gpt)\b/g)) {
    const id = match[1].replace(/\s/g, "");
    if (seen.has(id)) continue;
    seen.add(id);
    found.push({ id, name: APP_NAMES[id] });
  }
  return found;
}

/** Which memory app a record came from: its connector first, then the import
 * title prefix ("Codex · …"), then the origin. Null for notes, web pages and
 * business observations. */
export type AppRecord = { title?: string; origin?: string; connector?: { provider?: string } };
const PROVIDER_APP: Record<string, string> = { codex: "codex", claude: "claude", hermes: "hermes", gmail: "gmail", google: "gmail", outlook: "outlook", slack: "slack", notion: "notion", granola: "granola", obsidian: "obsidian", chatgpt: "chatgpt" };
const ORIGIN_APP: Record<string, string> = { codex: "codex", claude: "claude", hermes: "hermes", slack: "slack", notion: "notion", obsidian: "obsidian", chatgpt: "chatgpt", meetings: "granola" };
export function recordApp(record: AppRecord): string | null {
  const provider = record.connector?.provider?.toLowerCase();
  if (provider && PROVIDER_APP[provider]) return PROVIDER_APP[provider];
  const prefix = (record.title || "").match(/^(Codex|Claude|Hermes|Obsidian|ChatGPT|Granola) · /);
  if (prefix) return prefix[1].toLowerCase();
  const origin = record.origin?.toLowerCase();
  if (origin && ORIGIN_APP[origin]) return ORIGIN_APP[origin];
  if (origin === "email") return "email";
  return null;
}
export function recordMatchesApp(record: AppRecord, appId: string): boolean {
  const app = recordApp(record);
  if (app === appId) return true;
  // Saved mail without a provider label answers a question about either mail app.
  return app === "email" && (appId === "gmail" || appId === "outlook");
}
export const appDisplayName = (appId: string) => APP_NAMES[appId] || appId.replace(/^./, (c) => c.toUpperCase());

/** "12:31 Codex session": the deterministic name of the nearest record when a window is empty. */
export function closestRecordLabel(record: AppRecord & { connector?: { provider?: string; path?: string; activityAt?: string } }, range: { start: number; end: number }): string {
  const at = new Date(range.start);
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const app = recordApp(record);
  const noun = app === "granola" ? "meeting" : app === "gmail" || app === "outlook" || app === "email" ? "email" : ["codex", "claude", "hermes", "chatgpt"].includes(app || "") ? "session" : "record";
  return `${clock} ${app && app !== "email" ? appDisplayName(app) + " " : ""}${noun}`;
}

/** Model instruction when the user names an app: other apps' records are context, never the answer. */
export function appFocusInstruction(focus: ChatAppFocus[]): string {
  if (!focus.length) return "";
  const names = list(focus.map((app) => app.name));
  return `APP FOCUS: the user asked about ${names}. Only records from ${names} (titles starting "${focus.map((app) => app.name).join('" or "')} ·", or that app's connector) can answer what they said or did there. Never present a record from another app as the answer; if only other apps' records were retrieved, say that no ${names} record matched.`;
}

export type MemoryAppImportStatus = {
  id: string;
  name: string;
  enabled?: boolean;
  status?: string;
  queued?: boolean;
  progress?: { hasMore?: boolean; remaining?: number };
};
const list = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "";

/** Plain words for the model and for the reply footer when a dated question meets an unfinished import.
 * `focus.app` names the app the question was about; `focus.closest` names the nearest
 * same-day record ("12:31 Codex session") when nothing sits inside the window. */
export function timeWindowCoverage(
  window: ChatTimeWindow,
  matched: number,
  apps: MemoryAppImportStatus[],
  focus: { app?: string; closest?: string } = {},
) {
  const relevant = focus.app ? apps.filter((app) => app.name === focus.app) : apps;
  const pending = relevant.filter((app) => app.enabled !== false && app.progress?.hasMore).map((app) => ({ id: app.id, name: app.name, remaining: app.progress?.remaining || 0 }));
  const syncing = relevant.filter((app) => app.enabled !== false && !pending.some((p) => p.id === app.id) && (app.queued || app.status === "syncing" || app.status === "scanning")).map((app) => app.name);
  const action = pending.length
    ? `${list(pending.map((p) => p.name))} import ${pending.length === 1 ? "is" : "are"} still pending: ${pending.map((p) => `${p.remaining} ${p.name} file${p.remaining === 1 ? "" : "s"}`).join(", ")} remaining. Open Memory and sync ${list(pending.map((p) => p.name))} again.`
    : syncing.length
      ? `${list(syncing)} ${syncing.length === 1 ? "is" : "are"} syncing now; ask again in a minute.`
      : "";
  const records = focus.app ? `${focus.app} records` : "memory records";
  if (matched > 0)
    return {
      pending,
      instruction: `TIME WINDOW: the user asked about ${window.label}. ${matched} retrieved ${focus.app ? focus.app + " " : ""}source${matched === 1 ? " falls" : "s fall"} inside that window; answer from those first and say which date each comes from. Do not describe import or sync status yourself; the app appends it after your reply.`,
      footer: action ? `More from ${window.label} may exist. ${action}` : "",
    };
  const closest = focus.closest ? ` Closest today: ${focus.closest}.` : "";
  return {
    pending,
    instruction: `TIME WINDOW: the user asked about ${window.label}. No imported ${focus.app ? focus.app + " " : "memory "}record falls inside that window. Say that plainly in one sentence${focus.closest ? `, then summarise the nearest same-day record (the ${focus.closest}) as the closest match, stating its time` : ""}. Never present a record from another date as if it were from ${window.label}, and do not describe import or sync status yourself; the app appends the exact status after your reply.`,
    footer: `No imported ${records} fall inside ${window.label}.${closest}${action ? " " + action : focus.app ? ` ${focus.app} is fully imported, so nothing else from that window was saved.` : " Every enabled memory app is fully imported, so nothing from that window was saved."}`,
  };
}

/** A short follow-up ("How about Claude?", "and Codex?", "what about yesterday's?")
 * that names no date of its own. It reuses the previous question's window and
 * swaps in the app it names, or keeps the previous app when it names none. */
export function isFollowUpQuestion(request: string): boolean {
  const text = request.trim().replace(/[?!.]+$/, "").trim();
  if (!text) return false;
  const words = text.split(/\s+/).length;
  if (words > 8) return false;
  const opener = /^(?:and|or|but|so|also|now|then|ok(?:ay)?|what about|how about|same (?:for|with|question for)|(?:and\s+)?for|(?:and\s+)?with|(?:and\s+)?in)\b/i.test(text);
  const closer = /\b(?:too|as well|instead|the same|same thing|that one|those|there|else|again)$/i.test(text);
  const bareApp = words <= 3 && chatAppFocus(text).length > 0;
  return opener || closer || bareApp;
}

export type ChatRetrievalContext = { window: ChatTimeWindow | null; focus: ChatAppFocus[]; inherited: boolean };

/** The window and app focus a question retrieves with. A follow-up inherits what
 * it does not name from the previous user turns (newest first); a question with
 * its own date or a full sentence starts fresh. */
export function inheritRetrievalContext(request: string, previousRequests: string[], now = new Date()): ChatRetrievalContext {
  const ownWindow = chatTimeWindow(request, now);
  const ownFocus = chatAppFocus(request);
  if (!isFollowUpQuestion(request) || (ownWindow && ownFocus.length)) return { window: ownWindow, focus: ownFocus, inherited: false };
  let window = ownWindow;
  let focus = ownFocus;
  let inherited = false;
  for (const previous of previousRequests.slice(0, 6)) {
    if (!window) {
      const earlier = chatTimeWindow(previous, now);
      if (earlier) { window = earlier; inherited = true; }
    }
    if (!focus.length) {
      const earlier = chatAppFocus(previous);
      if (earlier.length) { focus = earlier; inherited = true; }
    }
    if (window && focus.length) break;
    // A full question that named neither a date nor an app ends the chain.
    if (!isFollowUpQuestion(previous) && !chatTimeWindow(previous, now) && !chatAppFocus(previous).length) break;
  }
  return { window, focus, inherited };
}

/** What the chat checked for one answer: each app's records in memory, how many
 * matched, the time window and the apps still importing. Built from /search and
 * GET /memory/apps, never from the model. */
export type ChatCheckedApp = { id: string; name: string; records: number; matched: number; remaining: number };
export type ChatChecked = {
  apps: ChatCheckedApp[];
  matched: number;
  window?: string;
  focus: string[];
  importing: Array<{ id: string; name: string; remaining: number }>;
};
export function buildChatChecked(
  results: AppRecord[],
  appRecords: Record<string, number>,
  apps: MemoryAppImportStatus[],
  focus: ChatAppFocus[],
  window: ChatTimeWindow | null,
): ChatChecked {
  const matchedBy: Record<string, number> = {};
  for (const hit of results) {
    const app = recordApp(hit);
    const id = app === "email" ? "gmail" : app;
    if (id) matchedBy[id] = (matchedBy[id] || 0) + 1;
  }
  const importing = apps
    .filter((app) => app.enabled !== false && app.progress?.hasMore)
    .map((app) => ({ id: app.id, name: app.name, remaining: app.progress?.remaining || 0 }));
  const ids = new Set<string>([...Object.keys(appRecords).filter((id) => appRecords[id] > 0), ...Object.keys(matchedBy), ...focus.map((app) => app.id), ...importing.map((app) => app.id)]);
  const rank = (id: string) => (focus.some((app) => app.id === id) ? 0 : 1);
  const list = [...ids]
    .map((id) => ({
      id,
      name: apps.find((app) => app.id === id)?.name || appDisplayName(id),
      records: appRecords[id] || 0,
      matched: matchedBy[id] || 0,
      remaining: importing.find((app) => app.id === id)?.remaining || 0,
    }))
    .sort((a, b) => rank(a.id) - rank(b.id) || b.matched - a.matched || b.records - a.records || a.name.localeCompare(b.name));
  return { apps: list, matched: results.length, ...(window ? { window: window.label } : {}), focus: focus.map((app) => app.name), importing };
}

/** One plain sentence for the same facts, for the transcript and for tests. */
export function chatCheckedSummary(checked: ChatChecked): string {
  const apps = checked.apps.map((app) => `${app.name} ${app.matched}/${app.records}`).join(", ");
  const parts = [`Checked ${apps || "memory"}`];
  if (checked.window) parts.push(checked.window);
  if (checked.importing.length) parts.push(`${list(checked.importing.map((app) => app.name))} still importing`);
  return parts.join(" · ");
}
