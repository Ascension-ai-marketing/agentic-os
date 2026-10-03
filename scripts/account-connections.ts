import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { slackConnection } from "./slack-connection";
import { calendarWriter, calendarCreateAllowed } from "./calendar-write";
import {
  calendarRange,
  readCalendars,
  type CalendarCoverage,
  type CalendarRange,
} from "./calendar-read";
import {
  gmailMailbox,
  gmailCapabilities,
  grantedScopes,
  GmailProviderError,
  addressList,
} from "./gmail-mailbox";
import type { OperatorState, InboxItem, CalendarEvent } from "../src/lib/operator";
export type AccountProvider = "google" | "outlook" | "cal";
const providers: AccountProvider[] = ["google", "outlook", "cal"];
const redirect = (p: AccountProvider) =>
  `http://localhost:${Number(process.env.ARGENTIC_PORT || 8081)}/__operator/connections/callback/${p}`;
const spec = {
  google: {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope:
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
  },
  outlook: {
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access User.Read Mail.Read Calendars.Read Calendars.Read.Shared",
  },
};
type Account = {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expires?: number;
  email?: string;
  username?: string;
  lastSync?: string;
  lastError?: string;
  eventTypes?: any[];
  schedules?: any[];
  grantedScopes?: string[];
  labelsSyncedAt?: string;
  mailLimited?: boolean;
  calendarCoverage?: CalendarCoverage;
};
export function calendarAccess(provider: AccountProvider, scopes?: string[], verified = false) {
  if (provider === "cal") return "granted" as const;
  if (!scopes?.length) return verified ? "granted" as const : "unknown" as const;
  const granted = provider === "google"
    ? scopes.some(scope => ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"].includes(scope))
    : scopes.some(scope => /^(?:https:\/\/graph\.microsoft\.com\/)?Calendars\.(Read|ReadWrite)(\.Shared)?$/i.test(scope));
  return granted ? "granted" as const : "missing" as const;
}
const clean = (s: any) => String(s ?? "").slice(0, 100000);
/** Extract readable message content while excluding attachment payloads. */
export function gmailMessageText(payload: any): string {
  const plain: string[] = [],
    html: string[] = [];
  const walk = (part: any) => {
    if (
      !part ||
      part.filename ||
      part.headers?.some(
        (h: any) =>
          String(h.name).toLowerCase() === "content-disposition" &&
          /^attachment/i.test(String(h.value)),
      )
    )
      return;
    if (part.body?.data && ["text/plain", "text/html"].includes(part.mimeType)) {
      const text = Buffer.from(part.body.data, "base64url").toString("utf8");
      (part.mimeType === "text/plain" ? plain : html).push(text);
    }
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);
  if (plain.some((text) => text.trim())) return plain.join("\n");
  return html
    .map((markup) => {
      const document = parseHTML(markup).document;
      document.querySelectorAll("head,script,style,noscript").forEach((node) => node.remove());
      document.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
      document
        .querySelectorAll("p,div,li,tr,h1,h2,h3")
        .forEach((node) => node.appendChild(document.createTextNode("\n")));
      return Array.from(document.childNodes)
        .map((node) => node.textContent || "")
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    })
    .filter(Boolean)
    .join("\n");
}
export function classifyMessage(
  subject: string,
  body: string,
): { category: InboxItem["category"]; reason: string } {
  const s = (subject + " " + body).toLowerCase();
  if (/\b(sponsorship|brand deal|partnership|sponsor your)\b/.test(s))
    return { category: "sponsors", reason: "Contains sponsorship or partnership language." };
  if (/\b(newsletter|unsubscribe|digest|no.reply|receipt|verification code)\b/.test(s))
    return {
      category: "updates",
      reason: "Contains newsletter, receipt or automated-update language.",
    };
  return {
    category: "needs-you",
    reason: "Placed in Primary for your review; no automated-update rule matched.",
  };
}
export function mergeAccountSnapshot(
  state: OperatorState,
  inbox: InboxItem[],
  events: CalendarEvent[],
  provider: string,
  account: string,
  range?: CalendarRange,
  includeCalendar = true,
  /** Set for a Gmail sync: loaded messages Gmail no longer returns (trashed or deleted) are dropped. */
  gmail?: { limited: boolean },
) {
  const prefix = `${provider}:${createHash("sha256").update(account).digest("hex").slice(0, 12)}:`;
  // An empty list may be a hiccup, not an empty mailbox: never clear the inbox on one.
  if (gmail && inbox.length) {
    // Gmail lists the newest messages first. When the list was cut off, only drop
    // missing mail newer than the oldest message returned (drafts don't count: an
    // old draft would push that line back); older mail and drafts may still exist.
    const fresh = new Set(inbox.map((i) => i.id));
    const isDraft = (i: { gmailDraftId?: string; labelIds?: string[] }) => !!i.gmailDraftId || !!i.labelIds?.includes("DRAFT");
    const mail = inbox.filter((i) => !isDraft(i));
    const oldest = mail.length ? mail.reduce((min, i) => (i.receivedAt < min ? i.receivedAt : min), mail[0].receivedAt) : null;
    state.inbox = state.inbox.filter((i) => {
      if (!i.id.startsWith(prefix) || fresh.has(i.id) || i.gmailSendState === "uncertain") return true;
      if (!gmail.limited) return false;
      if (isDraft(i) || oldest === null) return true;
      // On the line itself the next page may still hold it: keep it.
      return i.receivedAt <= oldest;
    });
  }
  for (const item of inbox) {
    const old = state.inbox.find((i) => i.id === item.id);
    if (old)
      Object.assign(old, item, {
        status: item.source === "gmail" && item.remoteId && item.account ? item.status : old.status,
        category: old.category,
        draft: old.draft,
        ...(item.source === "gmail" && item.remoteId && item.account
          ? { read: item.read, readOverride: false }
          : old.readOverride
            ? { read: old.read, readOverride: true }
            : {}),
      });
    else state.inbox.push(item);
  }
  if (!includeCalendar) return state;
  // Calendar is a bounded provider snapshot; notes/actions survive refresh.
  const oldEvents = new Map(state.events.map((e) => [e.id, e]));
  const start = range ? Date.parse(range.timeMin) : Date.now() - 7 * 86400000,
    end = range ? Date.parse(range.timeMax) : Date.now() + 60 * 86400000;
  state.events = state.events.filter(
    (e) => !e.id.startsWith(prefix) || Date.parse(e.end) <= start || Date.parse(e.start) >= end,
  );
  for (const event of events) {
    const old = oldEvents.get(event.id);
    state.events = state.events.filter((e) => e.id !== event.id);
    state.events.push({ ...event, notes: old?.notes || event.notes, actions: old?.actions || [] });
  }
  return state;
}
export function accountConnections(
  root: string,
  load: () => OperatorState,
  save: (s: OperatorState) => void,
  options: { homeDir?: string } = {},
) {
  const slack = slackConnection(root, load, save, options);
  const directory = join(root, ".operator-data"),
    file = join(directory, "accounts.json");
  const read = (): Partial<Record<AccountProvider, Account>> => {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8"));
  };
  const write = (data: any) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = file + ".tmp";
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    renameSync(temp, file);
  };
  const account = (p: AccountProvider): Account => {
    const a = read()[p] || {};
    const prefix = p === "google" ? "GOOGLE" : p === "outlook" ? "MICROSOFT" : "CAL";
    return {
      ...a,
      clientId: a.clientId || process.env[prefix + "_CLIENT_ID"],
      clientSecret: a.clientSecret || process.env[prefix + "_CLIENT_SECRET"],
      accessToken: a.accessToken || (p === "cal" ? process.env.CAL_API_KEY : undefined),
    };
  };
  const update = (p: AccountProvider, patch: Partial<Account>) => {
    const data = read();
    data[p] = { ...data[p], ...patch };
    write(data);
  };
  const pending = new Map<
      string,
      { provider: AccountProvider; verifier: string; expires: number }
    >(),
    syncing = new Set<string>();
  const mutating = new Set<string>();
  async function locked<T>(provider: string, operation: () => Promise<T>): Promise<T> {
    if (mutating.has(provider)) throw new Error("Wait for the current account action to finish.");
    mutating.add(provider);
    try {
      return await operation();
    } finally {
      mutating.delete(provider);
    }
  }
  async function request(url: string, options: RequestInit = {}) {
    const r = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!r.ok)
      throw new Error(`Provider returned HTTP ${r.status}. Check permissions or reconnect.`);
    return r.json();
  }
  const refreshing = new Map<AccountProvider, Promise<string>>();
  async function access(p: AccountProvider): Promise<string> {
    const a = account(p);
    if (!a.accessToken) throw new Error("Connect this account first.");
    if (p === "cal" || (a.expires || 0) > Date.now() + 60000) return a.accessToken;
    if (!a.refreshToken) throw new Error("Sign in again to refresh this connection.");
    const refreshToken = a.refreshToken;
    const existing = refreshing.get(p); if (existing) return existing;
    const refresh = async () => {
    const s = spec[p];
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: a.clientId || "",
      ...(a.clientSecret ? { client_secret: a.clientSecret } : {}),
    });
    const t = await request(s.token, { method: "POST", body });
    if (!t.access_token) throw new Error("Provider did not return an access token.");
    const current = account(p);
    if (current.accessToken !== a.accessToken || current.refreshToken !== a.refreshToken || current.email !== a.email)
      throw new Error("The account changed while refreshing. Reconnect and try again.");
    update(p, {
      accessToken: t.access_token,
      refreshToken: t.refresh_token || a.refreshToken,
      expires: Date.now() + t.expires_in * 1000,
      ...(typeof t.scope === "string" ? { grantedScopes: grantedScopes(t.scope) } : {}),
    });
    return t.access_token;
    };
    const task = refresh(); refreshing.set(p, task);
    try { return await task; } finally { refreshing.delete(p); }
  }
  async function get(p: AccountProvider, path: string, version?: string) {
    const token = await access(p);
    const base =
      p === "google"
        ? "https://www.googleapis.com"
        : p === "outlook"
          ? "https://graph.microsoft.com/v1.0"
          : "https://api.cal.com/v2";
    return request(base + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(p === "outlook"
          ? { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' }
          : {}),
        ...(p === "cal" ? { "cal-api-version": version || "2024-06-11" } : {}),
      },
    });
  }
  const calendarWrites = calendarWriter({
    root,
    identity: p => { const a = account(p); return { ...a, connected: !!a.email && !!a.accessToken && ((a.expires || 0) > Date.now() + 60000 || !!a.refreshToken) }; },
    request: async (p, path, method, payload) => {
      const token = await access(p);
      return request((p === "google" ? "https://www.googleapis.com" : "https://graph.microsoft.com/v1.0") + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    },
  });
  const mailAction = gmailMailbox({
    root,
    load,
    save,
    identity: () => {
      const a = account("google");
      return {
        email: a.email,
        connected: !!a.email && !!a.accessToken,
        grantedScopes: a.grantedScopes,
      };
    },
    request: async (path, method, payload) => {
      const token = await access("google");
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!response.ok) throw new GmailProviderError(response.status);
      return response.json();
    },
  });
  async function profile(p: AccountProvider, calendarsOnly = false) {
    const d = await get(
      p,
      p === "google"
        ? calendarsOnly
          ? "/calendar/v3/calendars/primary"
          : "/gmail/v1/users/me/profile"
        : p === "outlook"
          ? "/me?$select=mail,userPrincipalName"
          : "/me",
    );
    const email =
      p === "google"
        ? calendarsOnly
          ? d.id
          : d.emailAddress
        : p === "outlook"
          ? d.mail || d.userPrincipalName
          : d.data?.email;
    if (!email) throw new Error("Could not verify this account.");
    update(p, { email, username: d.data?.username });
    return email;
  }
  async function sync(
    p: AccountProvider,
    options: { calendarOnly?: boolean; timeMin?: unknown; timeMax?: unknown } = {},
  ) {
    if (syncing.has(p)) throw new Error("This account is already syncing.");
    syncing.add(p);
    try {
      const range = calendarRange(options);
      const access = calendarAccess(p, account(p).grantedScopes, !!account(p).calendarCoverage);
      if (options.calendarOnly && access === "missing")
        throw new Error("Calendar access is missing. Reconnect this account in Connections and allow calendar access. Email access does not include calendars.");
      const email = await profile(p, options.calendarOnly === true),
        prefix = `${p}:${createHash("sha256").update(email).digest("hex").slice(0, 12)}:`;
      const inbox: InboxItem[] = [],
        events: CalendarEvent[] = [];
      let gmailLabels: OperatorState["gmailLabels"] | undefined;
      let mailLimited = false;

      const pushMessage = (
        id: string,
        from: string,
        subject: string,
        body: string,
        date: string,
        read?: boolean,
      ) => {
        const rule = classifyMessage(subject, body);
        inbox.push({
          id: prefix + id,
          from,
          subject: subject || "(No subject)",
          body: clean(body),
          receivedAt: date,
          category: rule.category,
          status: "open",
          source: p === "google" ? "gmail" : "outlook",
          read,
          triageReason: rule.reason,
        });
      };
      if (p === "google" && !options.calendarOnly) {
        const [list, labels, drafts] = await Promise.all([
          get(p, "/gmail/v1/users/me/messages?maxResults=100"),
          get(p, "/gmail/v1/users/me/labels"),
          get(p, "/gmail/v1/users/me/drafts?maxResults=100"),
        ]);
        const draftMap = new Map<string, string>(
          (drafts.drafts || []).map((d: any) => [d.message?.id, d.id]),
        );
        const messages = [
          ...new Map(
            [...(list.messages || []), ...(drafts.drafts || []).map((d: any) => d.message)]
              .filter((m: any) => m?.id)
              .map((m: any) => [m.id, m]),
          ).values(),
        ];
        mailLimited = !!list.nextPageToken || !!drafts.nextPageToken;
        const detailedLabels: any[] = [];
        for (let n = 0; n < (labels.labels || []).length; n += 6) {
          detailedLabels.push(
            ...(await Promise.all(
              labels.labels
                .slice(n, n + 6)
                .map((label: any) =>
                  get(p, `/gmail/v1/users/me/labels/${encodeURIComponent(label.id)}`),
                ),
            )),
          );
        }
        gmailLabels = detailedLabels.map((label: any) => ({
          id: label.id,
          name: label.name,
          type: label.type,
          color: label.color,
          messagesTotal: label.messagesTotal,
          messagesUnread: label.messagesUnread,
          account: email,
        }));
        for (let n = 0; n < messages.length; n += 5) {
          const batch = await Promise.all(
            messages
              .slice(n, n + 5)
              .map((m: any) =>
                get(p, `/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=full`),
              ),
          );
          for (const m of batch) {
            const h = (name: string) =>
              m.payload?.headers?.find((x: any) => x.name.toLowerCase() === name)?.value || "";
            const body = gmailMessageText(m.payload) || m.snippet || "";
            pushMessage(
              m.id,
              h("from"),
              h("subject"),
              body,
              new Date(Number(m.internalDate)).toISOString(),
              Array.isArray(m.labelIds) ? !m.labelIds.includes("UNREAD") : undefined,
            );
            const item = inbox[inbox.length - 1];
            const labelIds = Array.isArray(m.labelIds) ? m.labelIds : [];
            Object.assign(item, {
              remoteId: m.id,
              threadId: m.threadId,
              account: email,
              to: addressList(h("to")),
              cc: addressList(h("cc")),
              bcc: addressList(h("bcc")),
              replyTo: h("reply-to") || h("from"),
              rfcMessageId: labelIds.includes("DRAFT") ? h("in-reply-to") : h("message-id"),
              references: h("references"),
              labelIds,
              starred: labelIds.includes("STARRED"),
              ...(draftMap.has(m.id) ? { gmailDraftId: draftMap.get(m.id), draft: body } : {}),
              url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#all/${encodeURIComponent(m.threadId || m.id)}`,
              status: labelIds.includes("INBOX") ? "open" : "done",
            });
          }
        }
      } else if (p === "outlook" && !options.calendarOnly) {
        const mail = await get(
          p,
          "/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime%20desc&$select=id,from,subject,body,receivedDateTime,isRead",
        );
        for (const m of mail.value || [])
          pushMessage(
            m.id,
            m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Unknown",
            m.subject,
            m.body?.content || "",
            m.receivedDateTime,
            typeof m.isRead === "boolean" ? m.isRead : undefined,
          );
      }
      if (p === "cal") {
        const [types, schedules] = await Promise.all([
          get(p, "/event-types", "2024-06-14"),
          get(p, "/schedules"),
        ]);
        update(p, {
          eventTypes: Array.isArray(types.data) ? types.data : types.data?.eventTypes || [],
          schedules: Array.isArray(schedules.data) ? schedules.data : [],
        });
      }
      const calendarResult = access === "missing" ? undefined : await readCalendars(
        p,
        (path, version) => get(p, path, version),
        prefix,
        range,
      );
      if (calendarResult) events.push(...calendarResult.events);
      const latest = mergeAccountSnapshot(load(), inbox, events, p, email, range, !!calendarResult, p === "google" && !options.calendarOnly ? { limited: mailLimited } : undefined);
      const syncedAt = new Date().toISOString();
      if (gmailLabels)
        latest.gmailLabels = [
          ...(latest.gmailLabels || []).filter((x) => x.account !== email),
          ...gmailLabels,
        ];
      save(latest);
      update(p, {
        lastSync: syncedAt,
        lastError: "",
        ...(calendarResult ? { calendarCoverage: calendarResult.coverage } : {}),
        ...(p === "google" && !options.calendarOnly
          ? { labelsSyncedAt: syncedAt, mailLimited }
          : {}),
      });
      return {
        messages: inbox.length,
        events: events.length,
        coverage: calendarResult?.coverage,
        ...(access === "missing" ? { calendarWarning: "Email updated. Calendar access is missing; reconnect and allow calendar access." } : {}),
        ...(p === "google" && !options.calendarOnly
          ? { labels: gmailLabels?.length || 0, limited: mailLimited }
          : {}),
      };
    } catch (e) {
      update(p, { lastError: (e as Error).message });
      throw e;
    } finally {
      syncing.delete(p);
    }
  }
  const service = {
    async callback(path: string, url: URL, req: any, res: any) {
      const p = path.split("/").pop() as AccountProvider;
      const state = url.searchParams.get("state") || "",
        entry = pending.get(state),
        cookie = String(req.headers.cookie || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("argentic_oauth="))
          ?.slice(15);
      pending.delete(state);
      if (!entry || entry.provider !== p || entry.expires < Date.now() || cookie !== state)
        throw new Error(
          "This sign-in expired or did not start in this browser. Try connecting again.",
        );
      if (url.searchParams.has("error")) throw new Error("Account sign-in was not completed.");
      const a = account(p),
        s = spec[p as "google" | "outlook"];
      if (!s || !url.searchParams.get("code")) throw new Error("Missing authorization code.");
      const data = await request(s.token, {
        method: "POST",
        body: new URLSearchParams({
          client_id: a.clientId || "",
          ...(a.clientSecret ? { client_secret: a.clientSecret } : {}),
          code: url.searchParams.get("code")!,
          grant_type: "authorization_code",
          redirect_uri: redirect(p),
          code_verifier: entry.verifier,
        }),
      });
      if (!data.access_token) throw new Error("Provider did not return an access token.");
      update(p, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expires: Date.now() + data.expires_in * 1000,
        grantedScopes: grantedScopes(data.scope),
        email: undefined,
        lastSync: undefined,
        calendarCoverage: undefined,
        labelsSyncedAt: undefined,
        mailLimited: undefined,
        lastError: undefined,
      });
      const email = await profile(p);
      if (!data.refresh_token && a.refreshToken && a.email?.toLowerCase() === email.toLowerCase())
        update(p, { refreshToken: a.refreshToken });
      res.statusCode = 302;
      res.setHeader(
        "Set-Cookie",
        "argentic_oauth=; HttpOnly; SameSite=Lax; Path=/__operator/connections; Max-Age=0",
      );
      res.setHeader("Location", "/inbox?connected=" + p);
      res.setHeader("Referrer-Policy", "no-referrer");
      res.end();
    },
    async handle(path: string, method: string, body: any, res: any) {
      if (path === "/connections" && method === "GET")
        return {
          accounts: [
            ...providers.map((p) => {
              const a = account(p);
              const connected = !!a.accessToken && !!a.email && (p === "cal" || (a.expires || 0) > Date.now() + 60000 || !!a.refreshToken);
              return {
                id: p,
                configured:
                  p === "cal"
                    ? !!a.accessToken
                    : !!a.clientId && (p !== "google" || !!a.clientSecret),
                connected,
                calendarAccess: connected ? calendarAccess(p, a.grantedScopes, !!a.calendarCoverage) : "disconnected",
                email: a.email,
                lastSync: a.lastSync,
                error: a.lastError || (a.accessToken && a.email && !connected ? "Sign in again to refresh this connection." : undefined),
                redirectUri: redirect(p),
                calendarCoverage: a.calendarCoverage,
                capabilities: {
                  calendarCreate: calendarCreateAllowed(p, { ...a, connected }),
                  ...(p === "google"
                    ? gmailCapabilities(a.grantedScopes, connected)
                    : { modify: false, send: false, drafts: false, labels: false }),
                },
                ...(p === "google"
                  ? { labelsSyncedAt: a.labelsSyncedAt, mailLimited: a.mailLimited }
                  : {}),
              };
            }),
            slack.status(),
          ],
          eventTypes: account("cal").eventTypes || [],
          schedules: account("cal").schedules || [],
          calUsername: account("cal").username,
        };
      if (path === "/connections/gmail/action" && method === "POST") return mailAction(body);
      if (path === "/connections/calendar/options" && method === "POST") return calendarWrites.options(body.provider);
      if (path === "/connections/calendar/prepare" && method === "POST") return calendarWrites.prepare(body);
      if (path === "/connections/calendar/create" && method === "POST") return calendarWrites.create(body);
      if (body.provider === "slack" && method === "POST") return slack.handle(path, body);
      const p = body.provider as AccountProvider;
      if (!providers.includes(p)) throw new Error("Choose Google, Outlook or Cal.com.");
      if (path === "/connections/configure" && method === "POST") {
        if (p === "cal") {
          if (!body.apiKey) throw new Error("Enter your Cal.com API key.");
          update(p, {
            accessToken: clean(body.apiKey).trim(),
            email: undefined,
            lastSync: undefined,
          });
          await profile(p);
          return { ok: true };
        }
        if (!body.clientId) throw new Error("Enter the OAuth client ID.");
        if (p === "google" && !body.clientSecret)
          throw new Error("Enter the Google web client secret.");
        update(p, {
          clientId: clean(body.clientId).trim(),
          clientSecret: clean(body.clientSecret).trim(),
          accessToken: undefined,
          refreshToken: undefined,
          email: undefined,
          lastSync: undefined,
          grantedScopes: undefined,
          labelsSyncedAt: undefined,
          calendarCoverage: undefined,
          lastError: undefined,
          mailLimited: undefined,
        });
        return { ok: true };
      }
      if (path === "/connections/start" && method === "POST") {
        if (p === "cal") throw new Error("Connect Cal.com with an API key.");
        const a = account(p);
        if (!a.clientId || (p === "google" && !a.clientSecret))
          throw new Error("Set up the OAuth client first.");
        for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
        const state = randomBytes(32).toString("hex"),
          verifier = randomBytes(48).toString("base64url");
        pending.set(state, { provider: p, verifier, expires: Date.now() + 600000 });
        const s = spec[p],
          url = new URL(s.auth);
        url.search = new URLSearchParams({
          client_id: a.clientId,
          redirect_uri: redirect(p),
          response_type: "code",
          scope:
            body.access === "calendar"
              ? p === "google" ? `https://www.googleapis.com/auth/gmail.${gmailCapabilities(a.grantedScopes, true).modify ? "modify" : "readonly"} https://www.googleapis.com/auth/calendar` : "offline_access User.Read Mail.Read Calendars.ReadWrite"
              : p === "google" && body.access === "mail"
              ? `https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar${calendarCreateAllowed(p, { ...a, connected: true }) ? "" : ".readonly"}`
              : s.scope,
          state,
          code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          code_challenge_method: "S256",
          ...(p === "google" ? { access_type: "offline", prompt: "consent" } : {}),
        }).toString();
        res.setHeader(
          "Set-Cookie",
          `argentic_oauth=${state}; HttpOnly; SameSite=Lax; Path=/__operator/connections; Max-Age=600`,
        );
        return { url: url.href };
      }
      if (path === "/connections/sync" && method === "POST") return sync(p, body);
      if (path === "/connections/disconnect" && method === "POST") {
        if (syncing.has(p)) throw new Error("Wait for the current sync to finish.");
        update(p, {
          accessToken: undefined,
          refreshToken: undefined,
          email: undefined,
          expires: undefined,
          lastSync: undefined,
          eventTypes: [],
          schedules: [],
          grantedScopes: undefined,
          labelsSyncedAt: undefined,
          calendarCoverage: undefined,
          lastError: undefined,
          mailLimited: undefined,
        });
        return { ok: true };
      }
      throw new Error("Unknown account action.");
    },
  };
  return {
    mailIdentity: async (provider: "gmail" | "outlook") => {
      const p = provider === "gmail" ? "google" : "outlook";
      const a = account(p);
      if (!a.accessToken || !a.email) throw new Error(`Connect ${provider === "gmail" ? "Gmail" : "Outlook"} in Settings → Connections to search and index email directly on this computer.`);
      await access(p);
      return a.email;
    },
    readMail: async (provider: "gmail" | "outlook", path: string, expectedAccount?: string) => {
      const p = provider === "gmail" ? "google" : "outlook";
      const matchesAccount = () => !expectedAccount || account(p).email === expectedAccount;
      if (!matchesAccount()) throw new Error("The connected mailbox changed. Resume the import for the current account.");
      const base = provider === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me" : "https://graph.microsoft.com/v1.0/me";
      const url = new URL(path.startsWith("https://") ? path : base + path);
      const allowed = new URL(base);
      if (url.origin !== allowed.origin || !(url.pathname === allowed.pathname + "/messages" || url.pathname.startsWith(allowed.pathname + "/messages/")) || url.username || url.password)
        throw new Error("The provider returned an invalid mailbox cursor.");
      const token = await access(p);
      if (!matchesAccount()) throw new Error("The connected mailbox changed. Resume the import for the current account.");
      return request(url.href, { headers: { Authorization: "Bearer " + token } });
    },
    callback: (path: string, url: URL, req: any, res: any) =>
      locked(path.split("/").pop() || "google", () => service.callback(path, url, req, res)),
    handle: (path: string, method: string, body: any, res: any) =>
      method === "POST"
        ? locked(path === "/connections/gmail/action" ? "google" : String(body?.provider), () =>
            service.handle(path, method, body || {}, res),
          )
        : service.handle(path, method, body || {}, res),
  };
}
