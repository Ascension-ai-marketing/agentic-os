import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type Provider = "google" | "outlook";
type Identity = { connected: boolean; email?: string; grantedScopes?: string[] };
type EventDraft = { title: string; start: string; end: string; timeZone: string; attendees: string[]; location: string; notes: string };
type Review = { reviewId: string; expiresAt: string; provider: Provider; account: string; calendar: { id: string; name: string }; event: EventDraft; invitations: boolean; state?: "attempting" | "created" | "uncertain"; result?: any };
export function calendarCreateAllowed(provider: string, identity: Identity) {
  return identity.connected && !!identity.email && !!identity.grantedScopes?.some(scope => provider === "google"
    ? ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events"].includes(scope)
    : provider === "outlook" && /^(?:https:\/\/graph\.microsoft\.com\/)?Calendars\.ReadWrite(?:\.Shared)?$/i.test(scope));
}
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
export function calendarWriter(options: {
  root: string; identity: (provider: Provider) => Identity;
  request: (provider: Provider, path: string, method: "GET" | "POST", payload?: unknown) => Promise<any>;
  now?: () => number;
}) {
  const now = options.now || Date.now, file = join(options.root, ".operator-data", "calendar-reviews.json");
  const read = (): Review[] => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const write = (rows: Review[]) => { mkdirSync(join(options.root, ".operator-data"), { recursive: true, mode: 0o700 }); writeFileSync(file + ".tmp", JSON.stringify(rows.slice(-100)), { mode: 0o600 }); renameSync(file + ".tmp", file); };
  const identity = (provider: Provider) => {
    if (!["google", "outlook"].includes(provider)) throw new Error("Choose Google or Outlook.");
    const account = options.identity(provider);
    if (!calendarCreateAllowed(provider, account)) throw new Error("Connect this calendar with permission to create events first.");
    return account;
  };
  const calendar = async (provider: Provider, id: string) => {
    if (!id || id.length > 1024) throw new Error("Choose a calendar.");
    const value = await options.request(provider, provider === "google" ? `/calendar/v3/users/me/calendarList/${encodeURIComponent(id)}` : `/me/calendars/${encodeURIComponent(id)}?$select=id,name,canEdit`, "GET");
    if (provider === "google" ? !["owner", "writer"].includes(value.accessRole) : value.canEdit !== true) throw new Error("The selected calendar is not writable.");
    if (!value.id) throw new Error("The calendar could not be verified.");
    return { id: String(value.id), name: text(value.summary || value.name, 200) || "Calendar" };
  };
  let tail = Promise.resolve();
  async function exclusive<T>(action: () => Promise<T>): Promise<T> { const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await prior; try { return await action(); } finally { release(); } }
  const api = {
    async options(provider: Provider) {
      identity(provider);
      const data = await options.request(provider, provider === "google" ? "/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=100" : "/me/calendars?$top=100&$select=id,name,canEdit", "GET");
      return { provider, calendars: (provider === "google" ? data.items || [] : data.value || []).filter((c: any) => provider === "google" ? ["owner", "writer"].includes(c.accessRole) : c.canEdit === true).slice(0, 100).map((c: any) => ({ id: String(c.id), name: text(c.summary || c.name, 200) || "Calendar" })), truncated: !!(data.nextPageToken || data["@odata.nextLink"]) };
    },
    async prepare(body: any) {
      const provider = body.provider as Provider, account = identity(provider);
      const title = text(body.title, 300), timeZone = text(body.timeZone, 100);
      const qualified = (v: unknown) => typeof v === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
      if (!title || !timeZone || !qualified(body.start) || !qualified(body.end) || Date.parse(body.end) <= Date.parse(body.start)) throw new Error("Review the title and start/end times, including their timezone offset.");
      try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { throw new Error("Choose a valid timezone."); }
      const attendees = Array.isArray(body.attendees) ? [...new Set(body.attendees.map((v: unknown) => text(v, 254).toLowerCase()))] as string[] : [];
      if (attendees.length > 50 || attendees.some(v => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v))) throw new Error("Review the attendee email addresses (maximum 50).");
      const target = await calendar(provider, text(body.calendarId, 1024));
      if (options.identity(provider).email !== account.email) throw new Error("The account changed. Review the event again.");
      const review: Review = { reviewId: randomUUID(), expiresAt: new Date(now() + 600000).toISOString(), provider, account: account.email!, calendar: target, event: { title, start: new Date(body.start).toISOString(), end: new Date(body.end).toISOString(), timeZone, attendees, location: text(body.location, 1000), notes: text(body.notes, 10000) }, invitations: attendees.length > 0 };
      write([...read().filter(r => r.state || Date.parse(r.expiresAt) > now()), review]);
      return review;
    },
    async create(body: any) {
      if (body.confirm !== true) throw new Error("Confirm the reviewed booking first.");
      const rows = read(), review = rows.find(r => r.reviewId === body.reviewId && r.provider === body.provider);
      if (!review) throw new Error("The review is missing. Prepare the booking again.");
      const account = identity(review.provider);
      if (account.email !== review.account) throw new Error("The account changed. Prepare the booking again.");
      if (review.state === "created") return review.result;
      const uncertain = { status: "uncertain", message: "The provider result is uncertain. Check your calendar before creating another booking. This review will not send again." };
      if (review.state) return uncertain;
      if (Date.parse(review.expiresAt) <= now()) throw new Error("The review expired. Prepare the booking again.");
      await calendar(review.provider, review.calendar.id);
      if (options.identity(review.provider).email !== review.account) throw new Error("The account changed. Prepare the booking again.");
      const e = review.event, path = review.provider === "google" ? `/calendar/v3/calendars/${encodeURIComponent(review.calendar.id)}/events?sendUpdates=all` : `/me/calendars/${encodeURIComponent(review.calendar.id)}/events`;
      const payload = review.provider === "google" ? { id: review.reviewId.replaceAll("-", ""), summary: e.title, start: { dateTime: e.start, timeZone: e.timeZone }, end: { dateTime: e.end, timeZone: e.timeZone }, attendees: e.attendees.map(email => ({ email })), location: e.location, description: e.notes } : { transactionId: review.reviewId, subject: e.title, start: { dateTime: e.start.replace(/Z$/, ""), timeZone: "UTC" }, end: { dateTime: e.end.replace(/Z$/, ""), timeZone: "UTC" }, attendees: e.attendees.map(address => ({ emailAddress: { address }, type: "required" })), location: { displayName: e.location }, body: { contentType: "text", content: e.notes } };
      review.state = "attempting"; write(rows);
      try {
        const result = await options.request(review.provider, path, "POST", payload);
        if (!result.id) throw new Error("No event identifier returned.");
        const url = result.htmlLink || result.webLink;
        review.result = { status: "created", eventId: String(result.id), ...(typeof url === "string" && url.startsWith("https://") ? { url } : {}) };
        review.state = "created"; write(rows); return review.result;
      } catch { review.state = "uncertain"; write(rows); return uncertain; }
    },
  };
  return { options: api.options, prepare: (body: any) => exclusive(() => api.prepare(body)), create: (body: any) => exclusive(() => api.create(body)) };
}
