import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountConnections,
  classifyMessage,
  mergeAccountSnapshot,
  gmailMessageText,
  calendarAccess,
} from "./account-connections";
import { EMPTY_STATE, type OperatorState } from "../src/lib/operator";
let root: string, state: OperatorState, service: ReturnType<typeof accountConnections>;
const originalFetch = globalThis.fetch;
const response = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const res = () => ({
  headers: {} as Record<string, string>,
  statusCode: 200,
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  },
  end() {},
});
test("email-only grants do not imply calendar access and calendar sync explains the missing grant", async () => {
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  writeFileSync(join(root, ".operator-data/accounts.json"), JSON.stringify({ google: { accessToken: "test-access", email: "qa@example.com", expires: Date.now() + 3600000, grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"] } }));
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected request"); };
  const status = await service.handle("/connections", "GET", {}, res());
  expect(status.accounts[0]).toMatchObject({ connected: true, calendarAccess: "missing" });
  await expect(service.handle("/connections/sync", "POST", { provider: "google", calendarOnly: true }, res())).rejects.toThrow("Calendar access is missing");
  expect(calls).toBe(0);
  expect(calendarAccess("outlook", ["Mail.Read"])).toBe("missing");
  expect(calendarAccess("outlook", ["Calendars.Read.Shared"])).toBe("granted");
  expect(calendarAccess("google")).toBe("unknown");
});
test("mail-only Outlook refresh preserves calendar snapshots and reports missing calendar access", async () => {
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  writeFileSync(join(root, ".operator-data/accounts.json"), JSON.stringify({ outlook: { accessToken: "test-access", email: "qa@example.com", expires: Date.now() + 3600000, grantedScopes: ["Mail.Read", "User.Read"] } }));
  const event = { id: "saved-calendar", source: "outlook", title: "Saved", start: new Date().toISOString(), end: new Date(Date.now() + 60000).toISOString(), notes: "Keep me", actions: [] } as OperatorState["events"][number];
  state.events.push(event);
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes("/me?$select=")) return response({ mail: "qa@example.com" });
    if (url.includes("/messages?")) return response({ value: [] });
    throw new Error("No calendar request allowed");
  };
  const result = await service.handle("/connections/sync", "POST", { provider: "outlook" }, res());
  expect(result.calendarWarning).toContain("Calendar access is missing"); expect(state.events).toEqual([event]);
});
test("mail transport rejects foreign cursors and a switched account before reading tokens", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return response({}); };
  await expect(service.readMail("gmail", "https://example.test/messages")).rejects.toThrow("invalid mailbox cursor");
  await expect(service.readMail("outlook", "/messages-other")).rejects.toThrow("invalid mailbox cursor");
  await expect(service.readMail("gmail", "/messages/id", "wrong@example.com")).rejects.toThrow("mailbox changed");
  expect(calls).toBe(0);
});
test("concurrent metadata reads share one token refresh and disconnect cannot resurrect credentials", async () => {
  const file = join(root, ".operator-data/accounts.json"); mkdirSync(join(root, ".operator-data"), { recursive: true });
  const credentials = { accessToken: "expired", refreshToken: "refresh", email: "qa@example.com", expires: 0, clientId: "id" };
  writeFileSync(file, JSON.stringify({ outlook: credentials }));
  let refreshes = 0;
  globalThis.fetch = async (input: any) => {
    if (String(input).includes("/token")) { refreshes++; await Promise.resolve(); return response({ access_token: "fresh", refresh_token: "next", expires_in: 3600 }); }
    return response({ value: [] });
  };
  await Promise.all([service.readMail("outlook", "/messages", "qa@example.com"), service.readMail("outlook", "/messages", "qa@example.com")]);
  expect(refreshes).toBe(1);
  writeFileSync(file, JSON.stringify({ outlook: credentials }));
  let release!: () => void, began!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { began = resolve; });
  globalThis.fetch = async () => { began(); await gate; return response({ access_token: "must-not-save", expires_in: 3600 }); };
  const pending = service.readMail("outlook", "/messages", "qa@example.com");
  await requested; await service.handle("/connections/disconnect", "POST", { provider: "outlook" }, res()); release();
  await expect(pending).rejects.toThrow("account changed");
  expect(JSON.parse(readFileSync(file, "utf8")).outlook.accessToken).toBeUndefined();
});
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "argentic-accounts-"));
  state = structuredClone(EMPTY_STATE);
  service = accountConnections(
    root,
    () => structuredClone(state),
    (s) => {
      state = s;
    },
    { homeDir: join(root, "fake-home") },
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
});
test("separate previews register OAuth callbacks on their own port", async () => {
  const previous = process.env.ARGENTIC_PORT;
  try {
    process.env.ARGENTIC_PORT = "8092";
    const status = await service.handle("/connections", "GET", {}, res());
    expect(status.accounts[0].redirectUri).toBe(
      "http://localhost:8092/__operator/connections/callback/google",
    );
    await service.handle(
      "/connections/configure",
      "POST",
      { provider: "google", clientId: "test-client", clientSecret: "test-secret" },
      res(),
    );
    const start = await service.handle("/connections/start", "POST", { provider: "google" }, res());
    expect(new URL(start.url).searchParams.get("redirect_uri")).toBe(
      status.accounts[0].redirectUri,
    );
  } finally {
    if (previous === undefined) delete process.env.ARGENTIC_PORT;
    else process.env.ARGENTIC_PORT = previous;
  }
});
test("connection status never exposes credentials; private file permissions", async () => {
  await service.handle(
    "/connections/configure",
    "POST",
    { provider: "google", clientId: "test-client", clientSecret: "test-secret" },
    res(),
  );
  const status = await service.handle("/connections", "GET", {}, res());
  expect(JSON.stringify(status)).not.toContain("test-secret");
  expect(status.accounts[0].configured).toBe(true);
  expect(status.accounts[0].connected).toBe(false);
  expect(statSync(join(root, ".operator-data/accounts.json")).mode & 0o777).toBe(0o600);
});
test("OAuth binds state to browser cookie, provider and one-time PKCE exchange", async () => {
  await service.handle(
    "/connections/configure",
    "POST",
    { provider: "google", clientId: "test-client", clientSecret: "test-secret" },
    res(),
  );
  const r = res(),
    start = await service.handle("/connections/start", "POST", { provider: "google" }, r),
    url = new URL(start.url);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).not.toContain("gmail.send");
  expect(r.headers["Set-Cookie"]).toContain("HttpOnly");
  const callback = new URL("http://localhost:8081/__operator/connections/callback/google");
  callback.searchParams.set("code", "test-code");
  callback.searchParams.set("state", url.searchParams.get("state")!);
  await expect(
    service.callback(
      "/connections/callback/google",
      callback,
      { headers: { cookie: "argentic_oauth=wrong" } },
      res(),
    ),
  ).rejects.toThrow("expired");
  const r2 = res(),
    start2 = await service.handle("/connections/start", "POST", { provider: "google" }, r2),
    auth = new URL(start2.url);
  callback.searchParams.set("state", auth.searchParams.get("state")!);
  let tokenCalls = 0;
  globalThis.fetch = async (input: any, init: any) => {
    const u = String(input);
    if (u.includes("/token")) {
      tokenCalls++;
      expect(init.body.get("code_verifier").length).toBeGreaterThan(40);
      return response({
        access_token: "token-secret",
        refresh_token: "refresh-secret",
        expires_in: 3600,
      });
    }
    if (u.includes("/profile")) return response({ emailAddress: "qa@example.com" });
    throw new Error("Unexpected request");
  };
  const req = { headers: { cookie: r2.headers["Set-Cookie"].split(";")[0] } },
    done = res();
  await service.callback("/connections/callback/google", callback, req, done);
  expect(done.statusCode).toBe(302);
  expect(tokenCalls).toBe(1);
  expect(JSON.stringify(await service.handle("/connections", "GET", {}, res()))).not.toContain(
    "token-secret",
  );
  await expect(
    service.callback("/connections/callback/google", callback, req, res()),
  ).rejects.toThrow("expired");
  expect(tokenCalls).toBe(1);
});
test("Cal.com sync imports verified data, preserves local notes and never writes to provider", async () => {
  const requests: string[] = [];
  const stamp = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 90000000).toISOString();
  globalThis.fetch = async (input: any, init: any) => {
    const u = String(input);
    requests.push(u);
    expect(init?.method || "GET").toBe("GET");
    if (u.endsWith("/me")) return response({ data: { email: "qa@example.com", username: "qa" } });
    if (u.includes("/bookings")) {
      expect(init.headers["cal-api-version"]).toBe("2026-05-01");
      return response({
        data: [{ uid: "b1", title: "QA meeting", start: stamp, end, status: "accepted" }],
      });
    }
    if (u.endsWith("/event-types"))
      return response({
        data: [{ id: 1, title: "Discovery", slug: "discovery", lengthInMinutes: 30 }],
      });
    if (u.endsWith("/schedules"))
      return response({ data: [{ id: 1, name: "Working hours", timeZone: "Europe/Vienna" }] });
    throw new Error("Unexpected request");
  };
  await service.handle(
    "/connections/configure",
    "POST",
    { provider: "cal", apiKey: "cal-secret" },
    res(),
  );
  await service.handle("/connections/sync", "POST", { provider: "cal" }, res());
  expect(state.events).toHaveLength(1);
  state.events[0].notes = "My actual notes";
  state.events[0].actions = [{ id: "action1", text: "Send proposal", done: false }];
  await service.handle("/connections/sync", "POST", { provider: "cal" }, res());
  expect(state.events).toHaveLength(1);
  expect(state.events[0].notes).toBe("My actual notes");
  expect(state.events[0].actions).toHaveLength(1);
  const safe = await service.handle("/connections", "GET", {}, res());
  expect(safe.accounts[2].email).toBe("qa@example.com");
  expect(safe.eventTypes[0].title).toBe("Discovery");
  expect(JSON.stringify(safe)).not.toContain("cal-secret");
  await service.handle("/connections/disconnect", "POST", { provider: "cal" }, res());
  expect((await service.handle("/connections", "GET", {}, res())).accounts[2].connected).toBe(
    false,
  );
  expect(state.events[0].notes).toBe("My actual notes");
});
test("provider failure does not erase an existing workspace snapshot", async () => {
  state.events = [
    {
      id: "existing",
      title: "Keep me",
      start: new Date().toISOString(),
      end: new Date(Date.now() + 3600000).toISOString(),
      allDay: false,
      source: "local",
      notes: "Important",
      actions: [],
    },
  ];
  globalThis.fetch = async () => response({ error: "unauthorized" }, 401);
  await expect(
    service.handle("/connections/configure", "POST", { provider: "cal", apiKey: "invalid" }, res()),
  ).rejects.toThrow("401");
  expect(state.events[0].notes).toBe("Important");
  expect((await service.handle("/connections", "GET", {}, res())).accounts[2].connected).toBe(
    false,
  );
});
test("calendar-only sync skips mail, reads every page and preserves saved notes when a later refresh fails", async () => {
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  writeFileSync(
    join(root, ".operator-data/accounts.json"),
    JSON.stringify({ google: { accessToken: "test-access", expires: Date.now() + 3600000 } }),
  );
  let failNextPage = false;
  const reads: string[] = [];
  globalThis.fetch = async (input: any, init: any) => {
    const url = String(input);
    reads.push(url);
    expect(init?.method || "GET").toBe("GET");
    if (url.endsWith("/calendars/primary")) return response({ id: "qa@example.com" });
    if (url.includes("/calendarList?"))
      return response({ items: [{ id: "qa@example.com", primary: true, summary: "Personal" }] });
    if (url.includes("/events?")) {
      if (url.includes("pageToken"))
        return failNextPage
          ? response({}, 503)
          : response({
              items: [
                {
                  id: "next",
                  summary: "Second page",
                  start: { dateTime: "2026-10-01T10:00:00Z" },
                  end: { dateTime: "2026-10-01T11:00:00Z" },
                },
              ],
            });
      return response({
        items: [
          {
            id: "first",
            summary: "First page",
            start: { dateTime: "2026-09-16T10:00:00Z" },
            end: { dateTime: "2026-09-16T11:00:00Z" },
          },
        ],
        nextPageToken: "next",
      });
    }
    throw new Error("Unexpected request: only calendar reads are expected");
  };
  const payload = {
    provider: "google",
    calendarOnly: true,
    timeMin: "2026-09-01T00:00:00Z",
    timeMax: "2026-11-01T00:00:00Z",
  };
  const first = await service.handle("/connections/sync", "POST", payload, res());
  expect(first.events).toBe(2);
  expect(reads.every((url) => !url.includes("/gmail/"))).toBe(true);
  state.events[0].notes = "Preserve my meeting notes";
  state.events[0].actions = [{ id: "todo", text: "Follow up", done: false }];
  await service.handle("/connections/sync", "POST", payload, res());
  expect(state.events[0].notes).toBe("Preserve my meeting notes");
  const saved = structuredClone(state);
  failNextPage = true;
  await expect(service.handle("/connections/sync", "POST", payload, res())).rejects.toThrow("503");
  expect(state).toEqual(saved);
  const status = await service.handle("/connections", "GET", {}, res());
  expect(status.accounts[0].calendarCoverage).toMatchObject({
    calendarCount: 1,
    eventCount: 2,
    complete: true,
  });
  expect(status.accounts[0].error).toContain("503");
});
test("synced mail preserves local drafts, archive and category decisions", () => {
  state.inbox = [
    {
      id: "m1",
      from: "Someone",
      subject: "Old",
      body: "Old",
      receivedAt: "2026-09-16T10:00:00Z",
      status: "done",
      category: "waiting",
      draft: "Keep my reply",
      source: "gmail",
    },
  ];
  const incoming = {
    ...state.inbox[0],
    subject: "Updated",
    draft: undefined,
    status: "open" as const,
    category: "updates" as const,
  };
  mergeAccountSnapshot(state, [incoming], [], "google", "qa@example.com");
  expect(state.inbox[0]).toMatchObject({
    subject: "Updated",
    draft: "Keep my reply",
    status: "done",
    category: "waiting",
  });
  expect(classifyMessage("Sponsorship enquiry", "Let us sponsor your video").category).toBe(
    "sponsors",
  );
  expect(classifyMessage("Weekly digest", "Unsubscribe here").category).toBe("updates");
});

for (const provider of ["google", "outlook"] as const)
  test(`${provider} sync decodes messages and normalizes calendar records without provider writes`, async () => {
    mkdirSync(join(root, ".operator-data"), { recursive: true });
    writeFileSync(
      join(root, ".operator-data/accounts.json"),
      JSON.stringify({ [provider]: { accessToken: "test-access", expires: Date.now() + 3600000 } }),
    );
    globalThis.fetch = async (input: any, init: any) => {
      const url = String(input);
      expect(init?.method || "GET").toBe("GET");
      if (url.includes("/profile")) return response({ emailAddress: "qa@example.com" });
      if (url.includes("/me?$select=")) return response({ mail: "qa@example.com" });
      if (url.includes("/gmail/v1/users/me/labels/"))
        return response({
          id: "Label_1",
          name: "Customers",
          type: "user",
          messagesTotal: 12,
          messagesUnread: 3,
        });
      if (url.endsWith("/gmail/v1/users/me/labels"))
        return response({ labels: [{ id: "Label_1", name: "Customers", type: "user" }] });
      if (url.includes("/gmail/v1/users/me/drafts?")) return response({ drafts: [] });
      if (url.includes("/gmail/v1/users/me/labels/"))
        return response({
          id: "Label_1",
          name: "Customers",
          type: "user",
          messagesTotal: 12,
          messagesUnread: 3,
        });
      if (url.endsWith("/gmail/v1/users/me/labels"))
        return response({
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "UNREAD", name: "UNREAD", type: "system" },
          ],
        });
      if (url.includes("/gmail/v1/users/me/messages?"))
        return response({ messages: [{ id: "m1" }] });
      if (url.includes("/messages/m1"))
        return response({
          id: "m1",
          labelIds: ["INBOX", "UNREAD"],
          internalDate: String(Date.now()),
          payload: {
            headers: [
              { name: "From", value: "QA sender" },
              { name: "Subject", value: "QA sponsor your video" },
            ],
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: {
                  data: Buffer.from("Hello — review this sponsorship proposal.").toString(
                    "base64url",
                  ),
                },
              },
            ],
          },
        });
      if (url.includes("/calendar/v3/users/me/calendarList"))
        return response({ items: [{ id: "qa@example.com", primary: true, summary: "Personal" }] });
      if (url.includes("/me/calendars?"))
        return response({ value: [{ id: "default", isDefaultCalendar: true, name: "Personal" }] });
      if (url.includes("/calendar/v3/"))
        return response({
          items: [
            {
              id: "e1",
              summary: "QA Google",
              start: { date: "2026-09-18" },
              end: { date: "2026-09-19" },
            },
          ],
        });
      if (url.includes("/mailFolders/inbox/messages"))
        return response({
          value: [
            {
              id: "m1",
              from: { emailAddress: { name: "QA sender" } },
              subject: "QA sponsor your video",
              body: { content: "Hello — review this sponsorship proposal." },
              receivedDateTime: new Date().toISOString(),
              isRead: true,
            },
          ],
        });
      if (url.includes("/calendarView")) {
        expect(init.headers.Prefer).toContain("UTC");
        return response({
          value: [
            {
              id: "e1",
              subject: "QA Outlook",
              start: { dateTime: "2026-09-18T10:00:00.0000000" },
              end: { dateTime: "2026-09-18T11:00:00.0000000" },
              body: { content: "Meeting notes" },
              isAllDay: false,
            },
          ],
        });
      }
      throw new Error("Unexpected " + url);
    };
    await service.handle("/connections/sync", "POST", { provider }, res());
    expect(state.inbox).toHaveLength(1);
    expect(state.inbox[0].body).toContain("Hello —");
    expect(state.inbox[0].category).toBe("sponsors");
    expect(state.inbox[0].read).toBe(provider === "outlook");
    expect(state.events).toHaveLength(1);
    expect(state.events[0].source).toBe(provider);
    if (provider === "google") expect(state.events[0].allDay).toBe(true);
    else expect(state.events[0].start).toEndWith("Z");
  });

test("local read overrides survive provider sync while untouched messages follow the provider", () => {
  const mail = {
    id: "m-read",
    from: "Sender",
    subject: "Read sync",
    body: "Body",
    receivedAt: new Date().toISOString(),
    category: "needs-you" as const,
    status: "open" as const,
    source: "gmail" as const,
    read: false,
  };
  state.inbox = [{ ...mail }];
  mergeAccountSnapshot(state, [{ ...mail, read: true }], [], "google", "qa@example.com");
  expect(state.inbox[0].read).toBe(true);
  state.inbox[0].read = false;
  state.inbox[0].readOverride = true;
  mergeAccountSnapshot(state, [{ ...mail, read: true }], [], "google", "qa@example.com");
  expect(state.inbox[0]).toMatchObject({ read: false, readOverride: true });
  state.inbox[0].read = true;
  mergeAccountSnapshot(state, [{ ...mail, read: false }], [], "google", "qa@example.com");
  expect(state.inbox[0]).toMatchObject({ read: true, readOverride: true });
});

test("Gmail mail access is explicit and capabilities follow actual scopes returned by OAuth", async () => {
  await service.handle(
    "/connections/configure",
    "POST",
    { provider: "google", clientId: "client", clientSecret: "secret" },
    res(),
  );
  const readonly = await service.handle(
    "/connections/start",
    "POST",
    { provider: "google" },
    res(),
  );
  expect(new URL(readonly.url).searchParams.get("scope")).toContain("gmail.readonly");
  expect(new URL(readonly.url).searchParams.get("scope")).not.toContain("gmail.modify");
  const r = res(),
    start = await service.handle(
      "/connections/start",
      "POST",
      { provider: "google", access: "mail" },
      r,
    ),
    auth = new URL(start.url);
  expect(auth.searchParams.get("scope")).toContain("gmail.modify");
  expect(auth.searchParams.get("scope")).toContain("calendar.readonly");
  globalThis.fetch = async (input: any) =>
    String(input).includes("/token")
      ? response({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        })
      : response({ emailAddress: "qa@example.com" });
  const callback = new URL(
    "http://localhost:8081/__operator/connections/callback/google?code=code&state=" +
      auth.searchParams.get("state"),
  );
  await service.callback(
    "/connections/callback/google",
    callback,
    { headers: { cookie: r.headers["Set-Cookie"].split(";")[0] } },
    res(),
  );
  const status = await service.handle("/connections", "GET", {}, res());
  expect(status.accounts[0].capabilities).toEqual({
    calendarCreate: false,
    modify: false,
    send: false,
    drafts: false,
    labels: false,
  });
  const saved = JSON.parse(readFileSync(join(root, ".operator-data/accounts.json"), "utf8"));
  expect(saved.google.grantedScopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
});

test("Gmail scope upgrade enables provider actions and disconnect cannot race an action", async () => {
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  writeFileSync(
    join(root, ".operator-data/accounts.json"),
    JSON.stringify({
      google: {
        accessToken: "access",
        expires: Date.now() + 3600000,
        email: "qa@example.com",
        grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
      },
    }),
  );
  state.inbox = [
    {
      id: "local-mail",
      remoteId: "remote1",
      threadId: "thread1",
      account: "qa@example.com",
      from: "from@example.com",
      subject: "Hi",
      body: "Message",
      source: "gmail",
      status: "open",
      category: "needs-you",
      receivedAt: new Date().toISOString(),
      read: false,
      labelIds: ["INBOX", "UNREAD"],
    },
  ];
  let complete!: (value: Response) => void;
  const pendingResponse = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  let started!: (value: void) => void;
  const startSignal = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (input: any, init: any) => {
    expect(String(input)).toContain("/messages/remote1/modify");
    expect(JSON.parse(init.body)).toEqual({ addLabelIds: [], removeLabelIds: ["UNREAD"] });
    started();
    return pendingResponse;
  };
  const action = service.handle(
    "/connections/gmail/action",
    "POST",
    { id: "local-mail", action: "read" },
    res(),
  );
  await startSignal;
  await expect(
    service.handle("/connections/disconnect", "POST", { provider: "google" }, res()),
  ).rejects.toThrow("current account action");
  await expect(
    service.handle(
      "/connections/configure",
      "POST",
      { provider: "google", clientId: "different", clientSecret: "different" },
      res(),
    ),
  ).rejects.toThrow("current account action");
  state.inbox[0].draft = "Preserve concurrent note";
  complete(response({ id: "remote1", labelIds: ["INBOX"] }));
  await action;
  expect(state.inbox[0]).toMatchObject({ read: true, draft: "Preserve concurrent note" });
  expect(
    (await service.handle("/connections", "GET", {}, res())).accounts[0].capabilities.send,
  ).toBe(true);
  await service.handle("/connections/disconnect", "POST", { provider: "google" }, res());
  expect(
    (await service.handle("/connections", "GET", {}, res())).accounts[0].capabilities.send,
  ).toBe(false);
});

test("Gmail sync imports full label names and draft metadata and exposes snapshot limits", async () => {
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  writeFileSync(
    join(root, ".operator-data/accounts.json"),
    JSON.stringify({
      google: { accessToken: "access", expires: Date.now() + 3600000, email: "qa@example.com" },
    }),
  );
  globalThis.fetch = async (input: any, init: any) => {
    const url = String(input);
    expect(init?.method || "GET").toBe("GET");
    if (url.endsWith("/profile")) return response({ emailAddress: "qa@example.com" });
    if (url.includes("/labels/"))
      return response({
        id: "Label_A",
        name: "Clients / Proposals",
        type: "user",
        messagesTotal: 42,
        messagesUnread: 7,
        color: { backgroundColor: "#16a765", textColor: "#ffffff" },
      });
    if (url.endsWith("/labels"))
      return response({ labels: [{ id: "Label_A", name: "Clients / Proposals", type: "user" }] });
    if (url.includes("/drafts?"))
      return response({ drafts: [{ id: "draft_A", message: { id: "mDraft" } }] });
    if (url.includes("/messages?"))
      return response({ messages: [{ id: "m1" }], nextPageToken: "there-are-more" });
    if (url.includes("/calendar/v3/users/me/calendarList"))
      return response({ items: [{ id: "qa@example.com", primary: true, summary: "Personal" }] });
    if (url.includes("/calendar/v3/")) return response({ items: [] });
    if (url.includes("/messages/")) {
      const draft = url.includes("mDraft");
      return response({
        id: draft ? "mDraft" : "m1",
        threadId: "thread1",
        labelIds: draft ? ["DRAFT"] : ["INBOX", "UNREAD", "Label_A"],
        internalDate: String(Date.now()),
        payload: {
          mimeType: "text/plain",
          body: { data: Buffer.from(draft ? "Draft body" : "Mail body").toString("base64url") },
          headers: [
            { name: "To", value: "Client <client@example.com>" },
            { name: "From", value: "Sender <sender@example.com>" },
            { name: "Reply-To", value: "reply@example.com" },
            { name: "Cc", value: '"Smith, Jane" <jane@example.com>, copy@example.com' },
            { name: "Bcc", value: "private@example.com" },
            { name: "Subject", value: "Our proposal" },
            { name: "Message-ID", value: "<m1@example.com>" },
            { name: "In-Reply-To", value: "<original@example.com>" },
          ],
        },
      });
    }
    throw new Error("Unexpected " + url);
  };
  const result = await service.handle("/connections/sync", "POST", { provider: "google" }, res());
  expect(result).toMatchObject({ messages: 2, labels: 1, limited: true });
  expect(state.gmailLabels).toEqual([
    {
      id: "Label_A",
      name: "Clients / Proposals",
      type: "user",
      account: "qa@example.com",
      messagesTotal: 42,
      messagesUnread: 7,
      color: { backgroundColor: "#16a765", textColor: "#ffffff" },
    },
  ]);
  expect(state.inbox.find((x) => x.remoteId === "m1")).toMatchObject({
    account: "qa@example.com",
    threadId: "thread1",
    replyTo: "reply@example.com",
    cc: ['"Smith, Jane" <jane@example.com>', "copy@example.com"],
    bcc: ["private@example.com"],
    rfcMessageId: "<m1@example.com>",
    to: ["Client <client@example.com>"],
  });
  expect(state.inbox.find((x) => x.remoteId === "mDraft")).toMatchObject({
    gmailDraftId: "draft_A",
    draft: "Draft body",
    rfcMessageId: "<original@example.com>",
    labelIds: ["DRAFT"],
  });
  const status = await service.handle("/connections", "GET", {}, res());
  expect(status.accounts[0].labelsSyncedAt).toBeTruthy();
  expect(status.accounts[0].mailLimited).toBe(true);
});

test("HTML-only Gmail mail extracts nested readable text without attachment, script or head content", () => {
  const encoded = (text: string) => ({ data: Buffer.from(text).toString("base64url") });
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/related",
        parts: [
          {
            mimeType: "text/html",
            body: encoded(
              "<html><head><title>Ignore title</title><style>Secret CSS</style></head><body><p>Hello <b>Alex</b></p><div>Second line &amp; detail<script>evil()</script></div></body></html>",
            ),
          },
        ],
      },
      {
        mimeType: "text/plain",
        filename: "attachment.txt",
        body: encoded("Do not read attachment"),
      },
    ],
  };
  const text = gmailMessageText(payload);
  expect(text).toContain("Hello Alex");
  expect(text).toContain("Second line & detail");
  expect(text).not.toContain("Ignore title");
  expect(text).not.toContain("evil");
  expect(text).not.toContain("attachment");
});

test("mail deleted in Gmail leaves the OS on the next sync, but an empty or cut-off list never wipes older mail", () => {
  const { createHash } = require("node:crypto");
  const prefix = `google:${createHash("sha256").update("qa@example.com").digest("hex").slice(0, 12)}:`;
  const mail = (id: string, day: string) => ({ id: prefix + id, from: "Sender", subject: id, body: "Body", receivedAt: `2026-09-${day}T10:00:00.000Z`, category: "needs-you" as const, status: "open" as const, source: "gmail" as const });
  state.inbox = [mail("old", "01"), mail("gone", "20"), mail("kept", "25"), { ...mail("other", "21"), id: "outlook:abc:other" }];
  // A cut-off list: the deleted newer message goes, the older one may still exist.
  mergeAccountSnapshot(state, [mail("kept", "25"), mail("mid", "15")], [], "google", "qa@example.com", undefined, true, { limited: true });
  expect(state.inbox.map((i) => i.subject).sort()).toEqual(["kept", "mid", "old", "other"]);
  // An empty answer is treated as a hiccup: nothing is removed.
  mergeAccountSnapshot(state, [], [], "google", "qa@example.com", undefined, true, { limited: false });
  expect(state.inbox).toHaveLength(4);
  // A complete list: anything Gmail no longer has is removed; other accounts are untouched.
  mergeAccountSnapshot(state, [mail("kept", "25")], [], "google", "qa@example.com", undefined, true, { limited: false });
  expect(state.inbox.map((i) => i.subject).sort()).toEqual(["kept", "other"]);
});

test("an old draft never makes a cut-off Gmail list delete mail that still exists", () => {
  const { createHash } = require("node:crypto");
  const prefix = `google:${createHash("sha256").update("qa@example.com").digest("hex").slice(0, 12)}:`;
  const mail = (id: string, when: string, extra: any = {}) => ({ id: prefix + id, from: "Sender", subject: id, body: "Body", receivedAt: when, category: "needs-you" as const, status: "open" as const, source: "gmail" as const, ...extra });
  state.inbox = [mail("sept", "2026-09-10T10:00:00.000Z")];
  mergeAccountSnapshot(state, [mail("oct", "2026-10-01T10:00:00.000Z"), mail("jan-draft", "2026-01-05T10:00:00.000Z", { gmailDraftId: "d1" })], [], "google", "qa@example.com", undefined, true, { limited: true });
  expect(state.inbox.map((i) => i.subject).sort()).toEqual(["jan-draft", "oct", "sept"]);
});

test("on a cut-off list, mail exactly on the line and DRAFT-labelled mail are kept", () => {
  const { createHash } = require("node:crypto");
  const prefix = `google:${createHash("sha256").update("qa@example.com").digest("hex").slice(0, 12)}:`;
  const mail = (id: string, when: string, extra: any = {}) => ({ id: prefix + id, from: "Sender", subject: id, body: "Body", receivedAt: when, category: "needs-you" as const, status: "open" as const, source: "gmail" as const, ...extra });
  const line = "2026-09-20T10:00:00.000Z";
  state.inbox = [mail("same-time", line, { draft: "my saved reply" }), mail("label-draft", "2026-01-01T10:00:00.000Z", { labelIds: ["DRAFT"] })];
  mergeAccountSnapshot(state, [mail("newest", "2026-10-01T10:00:00.000Z"), mail("oldest-returned", line)], [], "google", "qa@example.com", undefined, true, { limited: true });
  expect(state.inbox.map((i) => i.subject).sort()).toEqual(["label-draft", "newest", "oldest-returned", "same-time"]);
});
