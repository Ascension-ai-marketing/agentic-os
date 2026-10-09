# Connectors Without Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every connector reads through a connection Agentic OS owns (direct provider API or the provider's official MCP), and `scripts/codex-connected-read.ts` is deleted.

**Architecture:** Mail, calendar, Slack and Granola already have app-owned lanes (`account-connections.ts`, `mail-provider.ts`, `slack-connection.ts`, `granola-api.ts`). The `native-*` modules keep their names, route shapes and state files, but their internals call those lanes instead of the Codex bridge. Notion and Mercury get one new app-owned MCP client, `scripts/mcp-connection.ts`, which hands callers the same `{ tools, call }` reader shape the bridge gave.

**Tech Stack:** TypeScript, Bun (`bun test`), Vite dev-server plugin (`scripts/operator-plugin.ts`), React + TanStack Query in `src/`.

**Spec:** `docs/superpowers/specs/2026-10-08-connectors-without-codex-design.md`

## Global Constraints

- Read-only. No task adds a write to any provider.
- Tests use synthetic fixtures and injected fetchers/readers only. No real sign-in, no real provider call, no write to a real `.operator-data` (use `mkdtempSync(join(tmpdir(), "aos-"))`).
- Never copy or reuse another app's grant. Codex `link_id` handling and `connected-account-preferences.json` are removed, not migrated.
- Tokens, raw provider payloads and response text never appear in error messages, logs or HTTP responses.
- Private files: directory mode `0o700`, file mode `0o600`, atomic write (temp file then `renameSync`).
- Out of scope, do not touch: `agent-jobs-codex.ts`, `assistant-runtime.ts`, chat model lanes, usage/plan-limit panels, `higgsfield-mcp.ts`.
- Do not edit `MANIFEST.sha256` by hand.
- Match the surrounding file's style (several of these files use dense one-line functions; keep that density there).
- Commit after each task on a new branch `connectors-without-codex` created from the current branch.
- Each task ends with `bun test scripts` passing (baseline: 1082 pass, 0 fail).

## Review Focus

1. **A stored Outlook backfill cursor from the Codex lane is a number (`skip`).** The direct lane's cursor is an `@odata.nextLink` URL. A numeric cursor must be discarded and paging restarted, not sent to Graph. (Task 6)
2. **The connected account differs from the account saved in `native-connections.json` / `native-calendar.json` / `mail-backfill.json`.** Expect a clear "connect the current account again" message and no data written under the old account. (Tasks 5, 6, 7)
3. **An MCP server lists a tool with the right name but without `readOnlyHint: true`, or with `destructiveHint: true`.** `call` must refuse it. (Task 1)
4. **MCP discovery names an authorization server or endpoint on an unexpected host, or over plain HTTP.** `begin` must fail closed before registering a client. (Task 1)
5. **Token refresh is rejected (400/401/403).** The connection must drop to "needs sign-in" and saved balances/pages must stay untouched. (Tasks 1, 2)

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/mcp-connection.ts` | Create | App-owned OAuth + MCP client; read-only reader |
| `scripts/mcp-connection.test.ts` | Create | Discovery pinning, PKCE, refresh, store, gate |
| `scripts/native-business-sync.ts` | Modify | Mercury through an injected `McpReader` |
| `scripts/notion-connected.ts` | Modify | Notion through an injected `McpReader` |
| `scripts/native-inbox-sync.ts` | Modify | Recent mail + Slack through the account lane |
| `scripts/mail-backfill.ts` | Modify | Year of mail headers through `readMail` |
| `scripts/native-calendar-sync.ts` | Modify | Google calendar through the account lane |
| `scripts/voice-recent-emails.ts` | Modify | Single lane for live mail lookups |
| `scripts/agent-jobs.ts` | Modify | No connector-tool listing |
| `scripts/native-connection-discovery.ts`, `scripts/account-discovery.ts` | Modify | Drop the Codex app inventory |
| `scripts/memory-apps.ts`, `scripts/operator-plugin.ts` | Modify | Wiring, MCP routes, method names |
| `scripts/codex-connected-read.ts` (+ test), `scripts/granola-connected.ts` (+ test) | Delete | |
| `scripts/no-codex-connectors.test.ts` | Create | Guard: nothing imports the bridge |
| `src/components/**` listed in Task 10 | Modify | Copy and Notion/Mercury connect controls |
| Docs listed in Task 11 | Modify | Setup text |

---

### Task 1: App-owned MCP connection

**Files:**
- Create: `scripts/mcp-connection.ts`
- Test: `scripts/mcp-connection.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type McpTool = { name: string; inputSchema?: any; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
  export type McpClient = { tools: Record<string, McpTool>; call: (name: string, args: unknown) => Promise<any> };
  export type McpReader = <T>(work: (client: McpClient) => Promise<T>) => Promise<T>;
  export class McpConnectionError extends Error { code: string; httpStatus?: number }
  export function mcpConnection(options: {
    name: string;                 // "Notion", "Mercury" — used in messages only
    url: string;                  // e.g. "https://mcp.mercury.com/mcp"
    storePath: string;            // .operator-data/mcp/<id>.json
    allowedTools: readonly string[];
    scopes?: readonly string[];   // sent as `scope` on the authorization request; omit to use the server default
    allowText?: boolean;          // accept plain-text tool results as { text }
    fetchImpl?: typeof fetch;
    now?: () => number;
  }): {
    status(): { connected: boolean; requiresSignIn: boolean };
    begin(redirectUri: string): Promise<{ authorizationUrl: string; expiresAt: number }>;
    complete(code: string, state: string, redirectUri: string): Promise<{ connected: boolean; requiresSignIn: boolean }>;
    disconnect(): { connected: boolean; requiresSignIn: boolean };
    read: McpReader;
  };
  ```

- [ ] **Step 1: Write the failing tests**

Create `scripts/mcp-connection.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpConnection, McpConnectionError } from "./mcp-connection";

const URL_ = "https://mcp.example.test/mcp", ORIGIN = "https://mcp.example.test";
const REDIRECT = "http://localhost:8081/__operator/connections/callback/mcp-example";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const auth = (over: Record<string, unknown> = {}) => ({
  issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/authorize`, token_endpoint: `${ORIGIN}/token`,
  registration_endpoint: `${ORIGIN}/register`, code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"], ...over,
});
type Tool = { name: string; annotations?: Record<string, boolean> };
function server(options: { auth?: Record<string, unknown>; resource?: Record<string, unknown>; tools?: Tool[]; tokenStatus?: number; result?: unknown } = {}) {
  const seen: Array<{ url: string; body: string }> = [];
  const tools = options.tools ?? [{ name: "getAccounts", annotations: { readOnlyHint: true } }];
  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = String(input), body = typeof init.body === "string" ? init.body : String(init.body ?? "");
    seen.push({ url, body });
    if (url === `${ORIGIN}/.well-known/oauth-protected-resource/mcp`) return json({}, 404);
    if (url === `${ORIGIN}/.well-known/oauth-protected-resource`) return json(options.resource ?? { resource: URL_, authorization_servers: [ORIGIN] });
    if (url === `${ORIGIN}/.well-known/oauth-authorization-server`) return json(options.auth ?? auth());
    if (url === `${ORIGIN}/register`) return json({ client_id: "client-abc", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    if (url === `${ORIGIN}/token`) return options.tokenStatus ? json({ error: "invalid_grant" }, options.tokenStatus)
      : json({ access_token: "access-token-1234", refresh_token: "refresh-token-1234", token_type: "Bearer", expires_in: 3600 });
    if (url === URL_) {
      const rpc = JSON.parse(body);
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = rpc.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {} }
        : rpc.method === "tools/list" ? { tools }
        : options.result ?? { structuredContent: { accounts: [{ id: "a" }] } };
      return json({ jsonrpc: "2.0", id: rpc.id, result });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const fresh = (over: Partial<Parameters<typeof mcpConnection>[0]> = {}) => {
  const storePath = join(mkdtempSync(join(tmpdir(), "aos-")), "mcp", "example.json");
  return { storePath, connection: mcpConnection({ name: "Example", url: URL_, storePath, allowedTools: ["getAccounts"], ...over }) };
};
async function signIn(connection: ReturnType<typeof mcpConnection>) {
  const started = await connection.begin(REDIRECT);
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  await connection.complete("auth-code", state, REDIRECT);
  return started;
}

test("sign-in uses PKCE, the resource parameter and a private store", async () => {
  const { fetchImpl, seen } = server();
  const { connection, storePath } = fresh({ fetchImpl });
  expect(connection.status()).toEqual({ connected: false, requiresSignIn: true });
  const started = await signIn(connection);
  const url = new URL(started.authorizationUrl);
  expect(url.origin + url.pathname).toBe(`${ORIGIN}/authorize`);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("resource")).toBe(URL_);
  expect(url.searchParams.get("client_id")).toBe("client-abc");
  expect(url.searchParams.has("scope")).toBe(false);
  const scoped = await fresh({ fetchImpl, scopes: ["read", "offline_access"] }).connection.begin(REDIRECT);
  expect(new URL(scoped.authorizationUrl).searchParams.get("scope")).toBe("read offline_access");
  expect(connection.status()).toEqual({ connected: true, requiresSignIn: false });
  expect(statSync(storePath).mode & 0o777).toBe(0o600);
  expect(seen.find(call => call.url === `${ORIGIN}/token`)!.body).toContain("code_verifier=");
  expect(readFileSync(storePath, "utf8")).not.toContain("pending");
});

test("discovery on an unexpected host, plain HTTP or without S256 fails before registering", async () => {
  for (const bad of [
    { auth: auth({ token_endpoint: "https://evil.test/token" }) },
    { auth: auth({ authorization_endpoint: "http://mcp.example.test/authorize" }) },
    { auth: auth({ code_challenge_methods_supported: ["plain"] }) },
    { resource: { resource: URL_, authorization_servers: ["https://evil.test"] } },
    { resource: { resource: "https://other.test/mcp", authorization_servers: [ORIGIN] } },
  ]) {
    const { fetchImpl, seen } = server(bad);
    const { connection } = fresh({ fetchImpl });
    await expect(connection.begin(REDIRECT)).rejects.toBeInstanceOf(McpConnectionError);
    expect(seen.some(call => call.url.endsWith("/register"))).toBe(false);
  }
});

test("a callback with the wrong state, or replayed, cannot redeem a code", async () => {
  const { fetchImpl } = server();
  const { connection } = fresh({ fetchImpl });
  await connection.begin(REDIRECT);
  await expect(connection.complete("auth-code", "wrong-state", REDIRECT)).rejects.toThrow(/Start sign-in again/);
  const started = await connection.begin(REDIRECT);
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  await connection.complete("auth-code", state, REDIRECT);
  await expect(connection.complete("auth-code", state, REDIRECT)).rejects.toThrow(/Start sign-in again/);
});

test("only allowlisted tools marked read-only can be called", async () => {
  const { fetchImpl } = server({ tools: [
    { name: "getAccounts", annotations: { readOnlyHint: true } },
    { name: "sendMoney", annotations: { readOnlyHint: true } },
    { name: "listTransactions" },
    { name: "getCards", annotations: { readOnlyHint: true, destructiveHint: true } },
  ] });
  const { connection } = fresh({ fetchImpl, allowedTools: ["getAccounts", "listTransactions", "getCards"] });
  await signIn(connection);
  await connection.read(async client => {
    expect(Object.keys(client.tools).sort()).toEqual(["getAccounts", "getCards", "listTransactions"]);
    expect(await client.call("getAccounts", {})).toEqual({ accounts: [{ id: "a" }] });
    for (const name of ["sendMoney", "listTransactions", "getCards", "missing"])
      await expect(client.call(name, {})).rejects.toThrow(/not available/);
  });
});

test("a rejected refresh drops to needs-sign-in without leaking the provider response", async () => {
  let clock = 0;
  const good = server();
  const { connection, storePath } = fresh({ fetchImpl: good.fetchImpl, now: () => clock });
  await signIn(connection);
  clock = 2 * 3600_000;
  const rejecting = mcpConnection({ name: "Example", url: URL_, storePath, allowedTools: ["getAccounts"], fetchImpl: server({ tokenStatus: 400 }).fetchImpl, now: () => clock });
  const error = await rejecting.read(async client => client.call("getAccounts", {})).catch(e => e);
  expect(error).toBeInstanceOf(McpConnectionError);
  expect(error.code).toBe("sign_in_required");
  expect(error.message).not.toMatch(/invalid_grant|refresh-token/);
  expect(rejecting.status()).toEqual({ connected: false, requiresSignIn: true });
});

test("a tool error, an oversized body and a non-loopback redirect all fail closed", async () => {
  const { connection } = fresh({ fetchImpl: server({ result: { isError: true, content: [{ type: "text", text: "secret detail" }] } }).fetchImpl });
  await signIn(connection);
  const error = await connection.read(client => client.call("getAccounts", {})).catch(e => e);
  expect(error.message).not.toContain("secret detail");
  await expect(fresh({ fetchImpl: server().fetchImpl }).connection.begin("https://example.com/callback")).rejects.toThrow(/loopback/);
});

test("disconnect removes the store", async () => {
  const { fetchImpl } = server();
  const { connection, storePath } = fresh({ fetchImpl });
  await signIn(connection);
  expect(connection.disconnect()).toEqual({ connected: false, requiresSignIn: true });
  expect(() => statSync(storePath)).toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/mcp-connection.test.ts`
Expected: FAIL, `Cannot find module './mcp-connection'`.

- [ ] **Step 3: Implement**

Create `scripts/mcp-connection.ts`:

```ts
/** Server-only, app-owned OAuth for a provider's native MCP. Read-only; no CLI or other-app tokens. */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

type Json = Record<string, any>;
type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };
type Store = {
  version: 1;
  client?: { id: string; redirectUri: string };
  endpoints?: { authorization: string; token: string };
  pending?: { state: string; verifier: string; redirectUri: string; expiresAt: number };
  tokens?: Tokens;
};
export type McpTool = { name: string; inputSchema?: any; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
export type McpClient = { tools: Record<string, McpTool>; call: (name: string, args: unknown) => Promise<any> };
export type McpReader = <T>(work: (client: McpClient) => Promise<T>) => Promise<T>;
export class McpConnectionError extends Error {
  httpStatus?: number;
  constructor(message: string, public code: string) { super(message); this.name = "McpConnectionError"; }
}
const BODY_LIMIT = 2_000_000;
const object = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function mcpConnection(options: {
  name: string; url: string; storePath: string; allowedTools: readonly string[]; scopes?: readonly string[];
  allowText?: boolean; fetchImpl?: typeof fetch; now?: () => number;
}) {
  const fetcher = options.fetchImpl ?? fetch, now = options.now ?? Date.now, name = options.name;
  const resource = new URL(options.url);
  const allowed = new Set(options.allowedTools);
  const fail = (message: string, code = "provider_error") => new McpConnectionError(message, code);
  const parseJson = (text: string): Json => {
    try { const data = JSON.parse(text); if (object(data)) return data; } catch { /* Never include response text in errors. */ }
    throw fail(`${name} returned an invalid response.`, "invalid_response");
  };
  const persist = () => {
    mkdirSync(dirname(options.storePath), { recursive: true, mode: 0o700 });
    if (existsSync(options.storePath) && lstatSync(options.storePath).isSymbolicLink()) throw fail(`The ${name} private store must be a regular file.`, "private_store");
    const temp = `${options.storePath}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, JSON.stringify(store), { mode: 0o600, flag: "wx" }); chmodSync(temp, 0o600); renameSync(temp, options.storePath); }
    finally { rmSync(temp, { force: true }); }
  };
  let store: Store = { version: 1 };
  if (existsSync(options.storePath)) {
    if (!lstatSync(options.storePath).isFile() || lstatSync(options.storePath).size > 100_000) throw fail(`The ${name} private store is invalid.`, "private_store");
    const data = parseJson(readFileSync(options.storePath, "utf8"));
    if (data.version === 1) store = data as Store;
    chmodSync(options.storePath, 0o600);
  }
  let epoch = 0, sessionId: string | undefined, protocol = "2025-06-18";
  let refreshing: Promise<string> | undefined;

  function status() {
    const tokens = store.tokens;
    const connected = Boolean(tokens?.accessToken && (tokens.expiresAt > now() || tokens.refreshToken));
    return { connected, requiresSignIn: !connected };
  }
  async function bounded(response: Response, limit: number) {
    if (Number(response.headers.get("content-length") || 0) > limit) throw fail(`${name} response exceeds the size limit.`, "response_limit");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > limit) throw fail(`${name} response exceeds the size limit.`, "response_limit");
    return buffer.toString("utf8");
  }
  async function jsonFetch(url: string, init: RequestInit = {}, optional = false): Promise<Json | undefined> {
    let response: Response;
    try { response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
    catch { throw fail(`${name} is unavailable. Try again.`, "oauth_unavailable"); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (optional && response.status >= 400 && response.status < 500) return undefined;
      const error = fail(`${name} connection failed (HTTP ${response.status}).`, response.status === 401 ? "sign_in_required" : "oauth_unavailable");
      error.httpStatus = response.status; throw error;
    }
    return parseJson(await bounded(response, 150_000));
  }
  const https = (value: unknown, host: string) => {
    try { const url = new URL(String(value)); return url.protocol === "https:" && url.host === host && !url.username && !url.password ? url.href : ""; }
    catch { return ""; }
  };
  /** Pinned discovery: every endpoint is HTTPS on the authorization server the protected resource names. */
  async function discover() {
    const suffixed = await jsonFetch(`${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`, {}, true);
    const meta = suffixed ?? await jsonFetch(`${resource.origin}/.well-known/oauth-protected-resource`);
    const servers = Array.isArray(meta?.authorization_servers) ? meta!.authorization_servers : [];
    const issuer = https(servers[0], resource.host);
    if (![resource.href, resource.origin, resource.origin + "/"].includes(String(meta?.resource)) || !issuer)
      throw fail(`${name} does not currently advertise the required app-owned sign-in.`, "oauth_unsupported");
    const auth = await jsonFetch(`${new URL(issuer).origin}/.well-known/oauth-authorization-server`);
    const authorization = https(auth?.authorization_endpoint, resource.host), token = https(auth?.token_endpoint, resource.host),
      registration = https(auth?.registration_endpoint, resource.host);
    if (!authorization || !token || !registration || !auth?.code_challenge_methods_supported?.includes("S256") ||
      (Array.isArray(auth.token_endpoint_auth_methods_supported) && !auth.token_endpoint_auth_methods_supported.includes("none")))
      throw fail(`${name} does not currently advertise the required app-owned sign-in.`, "oauth_unsupported");
    return { authorization, token, registration };
  }
  function redirectUrl(raw: string) {
    let url: URL;
    try { url = new URL(raw); } catch { throw fail("Use a loopback sign-in callback URL.", "invalid_redirect"); }
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.hash || url.search)
      throw fail("Use an HTTP loopback sign-in callback with an explicit port and no query string.", "invalid_redirect");
    return url.href;
  }
  async function begin(redirectUri: string) {
    const callback = redirectUrl(redirectUri), startedEpoch = epoch;
    const endpoints = await discover();
    if (!store.client || store.client.redirectUri !== callback) {
      const client = await jsonFetch(endpoints.registration, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: "Agentic OS", redirect_uris: [callback], token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
      if (typeof client?.client_id !== "string" || !client.client_id || client.client_id.length > 1000 || client.client_secret ||
        (client.redirect_uris && !client.redirect_uris.includes(callback)))
        throw fail(`${name} could not register this app for sign-in.`, "registration_unsupported");
      store.client = { id: client.client_id, redirectUri: callback };
    }
    if (epoch !== startedEpoch) throw fail(`${name} sign-in was disconnected.`, "sign_in_required");
    const state = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url"), expiresAt = now() + 10 * 60_000;
    store.endpoints = { authorization: endpoints.authorization, token: endpoints.token };
    store.pending = { state, verifier, redirectUri: callback, expiresAt }; persist();
    const url = new URL(endpoints.authorization);
    url.search = new URLSearchParams({ response_type: "code", client_id: store.client.id, redirect_uri: callback, state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: resource.href,
      ...(options.scopes?.length ? { scope: options.scopes.join(" ") } : {}) }).toString();
    return { authorizationUrl: url.href, expiresAt };
  }
  function tokensFrom(data: Json | undefined): Tokens {
    const token = /^[\x21-\x7e]{8,32000}$/;
    if (typeof data?.access_token !== "string" || !token.test(data.access_token) || String(data.token_type).toLowerCase() !== "bearer" ||
      (data.refresh_token != null && (typeof data.refresh_token !== "string" || !token.test(data.refresh_token))))
      throw fail(`${name} returned an invalid sign-in grant.`, "invalid_grant");
    const seconds = Number.isFinite(data.expires_in) && data.expires_in > 0 ? Math.min(data.expires_in, 365 * 86400) : 3600;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: now() + seconds * 1000 };
  }
  const tokenRequest = (fields: Record<string, string>) => jsonFetch(store.endpoints!.token, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  async function complete(code: string, state: string, redirectUri: string) {
    const callback = redirectUrl(redirectUri), pending = store.pending, startedEpoch = epoch;
    if (!pending || pending.state !== state || pending.redirectUri !== callback || pending.expiresAt <= now() || !store.client || !store.endpoints ||
      typeof code !== "string" || !code || code.length > 4000)
      throw fail(`${name} sign-in expired or did not match this app. Start sign-in again.`, "invalid_state");
    // Consume before network I/O: replayed callbacks cannot redeem twice.
    delete store.pending; persist();
    const tokens = tokensFrom(await tokenRequest({ grant_type: "authorization_code", client_id: store.client.id, code,
      redirect_uri: callback, code_verifier: pending.verifier, resource: resource.href }));
    if (epoch !== startedEpoch) throw fail(`${name} sign-in was disconnected.`, "sign_in_required");
    store.tokens = tokens; sessionId = undefined; persist(); return status();
  }
  function disconnect() {
    ++epoch; store = { version: 1 }; sessionId = undefined;
    rmSync(options.storePath, { force: true });
    return status();
  }
  async function accessToken(): Promise<string> {
    if (store.tokens?.accessToken && store.tokens.expiresAt > now() + 30_000) return store.tokens.accessToken;
    if (!store.tokens?.refreshToken || !store.client || !store.endpoints) throw fail(`Connect ${name} in Connections first.`, "sign_in_required");
    if (!refreshing) {
      const startedEpoch = epoch, previous = store.tokens, clientId = store.client.id;
      refreshing = (async () => {
        const tokens = tokensFrom(await tokenRequest({ grant_type: "refresh_token", client_id: clientId, refresh_token: previous.refreshToken!, resource: resource.href }));
        tokens.refreshToken ||= previous.refreshToken;
        if (epoch !== startedEpoch) throw fail(`${name} was disconnected.`, "sign_in_required");
        store.tokens = tokens; persist(); return tokens.accessToken;
      })().catch(error => {
        if (error instanceof McpConnectionError && [400, 401, 403].includes(error.httpStatus ?? 0) && epoch === startedEpoch) {
          delete store.tokens; sessionId = undefined; persist();
          throw fail(`Your ${name} sign-in expired. Connect it again in Connections.`, "sign_in_required");
        }
        throw error;
      }).finally(() => { refreshing = undefined; });
    }
    return refreshing;
  }
  async function rpc(method: string, params: Json, notification = false): Promise<Json> {
    const token = await accessToken(), id = randomUUID();
    let response: Response;
    try {
      response = await fetcher(resource.href, { method: "POST", redirect: "error", signal: AbortSignal.timeout(method === "tools/call" ? 60_000 : 20_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": protocol, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }) });
    } catch { throw fail(`${name} did not respond in time. Try again.`, "mcp_timeout"); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([401, 403, 404].includes(response.status)) sessionId = undefined;
      throw fail(`${name} request failed (HTTP ${response.status}).`, response.status === 401 ? "sign_in_required" : "mcp_http_error");
    }
    const nextSession = response.headers.get("mcp-session-id");
    if (nextSession && /^[\x21-\x7e]{1,1000}$/.test(nextSession)) sessionId = nextSession;
    if (notification) { await response.body?.cancel().catch(() => {}); return {}; }
    const text = await bounded(response, BODY_LIMIT);
    // Streamable HTTP may answer as JSON or as SSE frames; take the frame that carries this id.
    const frames = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n\r?\n/).map(frame => frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n")).filter(Boolean)
      : [text];
    const data = frames.map(parseJson).find(frame => frame.id === id);
    if (!data || data.error || !object(data.result)) throw fail(`${name} could not complete the request.`, "mcp_error");
    return data.result;
  }
  function unwrap(result: Json) {
    if (result.isError) throw fail(`${name} could not complete this read. Check its connection in Connections.`, "tool_error");
    if (object(result.structuredContent)) return result.structuredContent;
    const texts = (Array.isArray(result.content) ? result.content : []).filter((block: any) => block?.type === "text" && typeof block.text === "string").map((block: any) => block.text as string);
    for (const text of texts) { try { return parseJson(text); } catch { /* Not structured provider data. */ } }
    if (options.allowText && texts.length) return { text: texts.join("\n") };
    throw fail(`${name} returned no readable data.`, "invalid_response");
  }
  const read: McpReader = async work => {
    const initialized = await rpc("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "Agentic OS", version: "1" } });
    if (!["2025-06-18", "2025-03-26", "2024-11-05"].includes(initialized.protocolVersion)) throw fail(`${name} negotiated an unsupported MCP version.`, "protocol_unsupported");
    protocol = initialized.protocolVersion;
    await rpc("notifications/initialized", {}, true);
    const tools: Record<string, McpTool> = {};
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const listed = await rpc("tools/list", cursor ? { cursor } : {});
      for (const tool of Array.isArray(listed.tools) ? listed.tools : [])
        if (typeof tool?.name === "string" && allowed.has(tool.name)) tools[tool.name] = { name: tool.name, inputSchema: tool.inputSchema, annotations: tool.annotations };
      cursor = typeof listed.nextCursor === "string" && listed.nextCursor.length <= 1000 ? listed.nextCursor : undefined;
      if (!cursor) break;
    }
    return work({ tools, async call(tool, args) {
      const known = tools[tool];
      if (!allowed.has(tool) || known?.annotations?.readOnlyHint !== true || known.annotations?.destructiveHint === true)
        throw fail(`This read is not available through your ${name} connection.`, "tool_unavailable");
      return unwrap(await rpc("tools/call", { name: tool, arguments: object(args) ? args : {} }));
    } });
  };
  return { status, begin, complete, disconnect, read };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test scripts/mcp-connection.test.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git checkout -b connectors-without-codex
git add scripts/mcp-connection.ts scripts/mcp-connection.test.ts
git commit -m "Add an app-owned read-only MCP connection"
```

---

### Task 2: Mercury through MCP

**Files:**
- Modify: `scripts/native-business-sync.ts:1,86-139`
- Modify: `scripts/operator-plugin.ts:489` (Mercury connection wiring)
- Test: `scripts/native-business-sync.test.ts`

**Interfaces:**
- Consumes: `McpReader`, `McpClient` from `./mcp-connection`.
- Produces: `MERCURY_TOOLS = ["getAccounts", "listTransactions"] as const`; `nativeBusinessSync(root, options: { read: McpReader; connected?: () => boolean; now?: () => Date })` with the same methods as today (`status`, `balances`, `financeSnapshot`, `monthlyIncome`). `status()` now resolves to `{ mercury: { available: boolean; transactions: boolean; requiresSignIn: boolean }, checkedAt: string }`.

- [ ] **Step 1: Update the tests**

In `scripts/native-business-sync.test.ts`:
- Replace `import type { withConnectedRead } from "./codex-connected-read";` with `import type { McpReader } from "./mcp-connection";`.
- Every fake currently shaped `(async (_root, work) => work({ tools, call })) as typeof withConnectedRead` becomes `(async (work: any) => work({ tools, call })) as McpReader`, passed as `{ read }` instead of `{ connectedRead }`.
- Rename tool keys and call names: `"mercury.getAccounts"` → `"getAccounts"`, `"mercury.listTransactions"` → `"listTransactions"`.
- Replace the two discovery tests ("discovery reads metadata only…" and "manual rescan refreshes Granola…") with:

```ts
test("status reports Mercury only, from tool metadata, and never calls a tool", async () => {
  const calls: string[] = [];
  const read = (async (work: any) => work({ tools: { getAccounts: { name: "getAccounts", annotations: { readOnlyHint: true } } }, call: async (name: string) => { calls.push(name); return { accounts: [account], page: {} }; } })) as McpReader;
  const service = nativeBusinessSync("/synthetic", { read });
  expect(await service.status()).toMatchObject({ mercury: { available: true, transactions: false, requiresSignIn: false } });
  expect(Object.keys(await service.status())).toEqual(["mercury", "checkedAt"]);
  expect(calls).toEqual([]);
  await service.balances(); expect(calls).toEqual(["getAccounts"]);
});
test("a signed-out Mercury connection is unavailable without opening a session", async () => {
  let sessions = 0;
  const read = (async () => { sessions++; throw new Error("unreachable"); }) as unknown as McpReader;
  const service = nativeBusinessSync("/synthetic", { read, connected: () => false });
  expect(await service.status()).toMatchObject({ mercury: { available: false, transactions: false, requiresSignIn: true } });
  expect(sessions).toBe(0);
});
test("a forced status check bypasses the one-minute cache", async () => {
  let probes = 0, listed = false;
  const read = (async (work: any) => { probes++; return work({ tools: listed ? { getAccounts: { name: "getAccounts", annotations: { readOnlyHint: true } } } : {}, call: async () => ({}) }); }) as McpReader;
  const service = nativeBusinessSync("/synthetic", { read });
  expect((await service.status()).mercury.available).toBe(false); listed = true;
  expect((await service.status()).mercury.available).toBe(false); expect(probes).toBe(1);
  expect((await service.status(true)).mercury.available).toBe(true); expect(probes).toBe(2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/native-business-sync.test.ts`
Expected: FAIL (the module still imports `./codex-connected-read` and expects `connectedRead`).

- [ ] **Step 3: Implement**

In `scripts/native-business-sync.ts`:
- Line 1: replace the import with `import type { McpClient, McpReader } from "./mcp-connection";` and add `export const MERCURY_TOOLS = ["getAccounts", "listTransactions"] as const;` below the imports.
- Replace the head of `nativeBusinessSync` and `status`:

```ts
export function nativeBusinessSync(root: string, options: { read: McpReader; connected?: () => boolean; now?: () => Date }) {
  const read = options.read;
  let cache: { at: number; value: any } | undefined, pending: Promise<any> | undefined;
  const clock = () => options.now?.() || new Date();
  const readIncome = async (client: McpClient, ownAccountIds: string[]) => {
    const now = clock(), start = new Date(now.getTime() - INCOME_WINDOW_DAYS * 86400000);
    const pages: any[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < INCOME_MAX_PAGES; index++) {
      const page = await client.call("listTransactions", { status: ["sent"], start: start.toISOString(), end: now.toISOString(), limit: INCOME_PAGE_SIZE, order: "desc", ...(cursor ? { start_after: cursor } : {}) });
      pages.push(page);
      const list = transactionList(page);
      if (!list || list.length < INCOME_PAGE_SIZE) break;
      const last = clean(list.at(-1)?.id, 100);
      if (!last) break;
      cursor = last;
    }
    return mercuryMonthlyIncome(pages, { ownAccountIds, now });
  };
  return {
    async status(force = false) {
      if (options.connected && !options.connected()) return { mercury: { available: false, transactions: false, requiresSignIn: true }, checkedAt: new Date().toISOString() };
      if (force) cache = undefined;
      if (cache && Date.now() - cache.at < 60000) return cache.value;
      if (!pending) pending = read(async ({ tools }) => {
        const readOnly = (name: string) => tools[name]?.annotations?.readOnlyHint === true && tools[name]?.annotations?.destructiveHint !== true;
        return { mercury: { available: readOnly("getAccounts"), transactions: readOnly("listTransactions"), requiresSignIn: false }, checkedAt: new Date().toISOString() };
      }).then(value => { cache = { at: Date.now(), value }; return value; }).finally(() => { pending = undefined; });
      return pending;
    },
```

- In `balances`, `financeSnapshot` and `monthlyIncome`: replace `connectedRead(root, async client => …)` with `read(async client => …)` and `"mercury.getAccounts"` with `"getAccounts"`. `root` stays in the signature (unused is fine; `operator-plugin` passes it).

- [ ] **Step 4: Wire the Mercury connection in `operator-plugin.ts`**

`nativeBusinessSync(root)` with no options would now throw when the plugin is built, so the wiring belongs to this task. Add `import { mcpConnection } from "./mcp-connection";`, extend the existing import to `import { MERCURY_TOOLS, nativeBusinessSync } from "./native-business-sync";`, and replace line 489 with:

```ts
  const mcp = {
    // "read" keeps the grant read-only; "offline_access" lets the app refresh it.
    mercury: mcpConnection({ name: "Mercury", url: "https://mcp.mercury.com/mcp", storePath: join(root, ".operator-data", "mcp", "mercury.json"), allowedTools: MERCURY_TOOLS, scopes: ["read", "offline_access"] }),
  };
  const mcpRedirect = (id: keyof typeof mcp) => `http://localhost:${Number(process.env.ARGENTIC_PORT || 8081)}/__operator/connections/callback/mcp-${id}`;
  const nativeBusiness = nativeBusinessSync(root, { read: mcp.mercury.read, connected: () => mcp.mercury.status().connected });
```

Lines 651, 663 and 668 still read `.granola` / `.notion` from `nativeBusiness.status()`. All three are inside `try/catch`, so they fall through safely at runtime; Task 4 replaces them. `bun run typecheck` reports those three lines until Task 4.

- [ ] **Step 5: Run to verify pass**

Run: `bun test scripts/native-business-sync.test.ts scripts/operator-plugin.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/native-business-sync.ts scripts/native-business-sync.test.ts scripts/operator-plugin.ts
git commit -m "Read Mercury through its own MCP connection"
```

---

### Task 3: Notion through MCP

**Files:**
- Modify: `scripts/notion-connected.ts:1,38-52`
- Test: `scripts/notion-connected.test.ts`

**Interfaces:**
- Consumes: `McpReader` from `./mcp-connection`.
- Produces: `NOTION_TOOLS = ["notion-list-recent-pages", "notion-fetch"] as const`; `connectedNotionPages(read: McpReader): Promise<{ documents: Array<{ id: string; title: string; text: string }>; hasMore: false; skipped: number }>`; `notionAvailable(read: McpReader): Promise<boolean>`.

- [ ] **Step 1: Update the tests**

In `scripts/notion-connected.test.ts`: fakes become `(async (work: any) => work({ tools, call })) as McpReader`; calls become `connectedNotionPages(read)`; tool names lose the `notion.` prefix (`"notion.notion-list-recent-pages"` → `"notion-list-recent-pages"`, `"notion.fetch"` → `"notion-fetch"`). Add:

```ts
test("Notion is available only when both read tools are marked read-only", async () => {
  const tool = (name: string, readOnlyHint = true) => [name, { name, annotations: { readOnlyHint } }];
  const reader = (entries: any[]) => (async (work: any) => work({ tools: Object.fromEntries(entries), call: async () => ({}) })) as McpReader;
  expect(await notionAvailable(reader([tool("notion-list-recent-pages"), tool("notion-fetch")]))).toBe(true);
  expect(await notionAvailable(reader([tool("notion-list-recent-pages"), tool("notion-fetch", false)]))).toBe(false);
  expect(await notionAvailable(reader([tool("notion-fetch")]))).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/notion-connected.test.ts` — Expected: FAIL (`notionAvailable` not exported).

- [ ] **Step 3: Implement**

In `scripts/notion-connected.ts`, replace line 1 with:

```ts
import type { McpReader } from "./mcp-connection";

export const NOTION_TOOLS = ["notion-list-recent-pages", "notion-fetch"] as const;
```

and replace `connectedNotionPages` with:

```ts
export async function notionAvailable(read: McpReader) {
  return read(async ({ tools }) => NOTION_TOOLS.every(name => tools[name]?.annotations?.readOnlyHint === true && tools[name]?.annotations?.destructiveHint !== true));
}

/** Recently edited pages through the app's own Notion connection. Read-only; pages that fail are skipped. */
export async function connectedNotionPages(read: McpReader) {
  return read(async client => {
    const pages = notionRecentPages(await client.call("notion-list-recent-pages", { limit: MAX_PAGES }));
    const documents: Array<{ id: string; title: string; text: string }> = [];
    let skipped = 0;
    for (const page of pages) {
      try {
        const document = notionPageDocument(await client.call("notion-fetch", { id: page.url }), page);
        if (document.text) documents.push(document); else skipped++;
      } catch { skipped++; }
    }
    return { documents, hasMore: false, skipped };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test scripts/notion-connected.test.ts` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/notion-connected.ts scripts/notion-connected.test.ts
git commit -m "Read Notion through its own MCP connection"
```

---

### Task 4: MCP routes, Granola on its API, plugin wiring

**Files:**
- Modify: `scripts/operator-plugin.ts` (imports 11-12, ~486-489, ~646-671, ~866-871, ~1221)
- Modify: `scripts/memory-apps.ts:853-855,1012`
- Delete: `scripts/granola-connected.ts`, `scripts/granola-connected.test.ts`
- Test: `scripts/operator-plugin.test.ts`, `scripts/memory-apps.test.ts`

**Interfaces:**
- Consumes: `mcpConnection`, `MERCURY_TOOLS`, `NOTION_TOOLS`, `notionAvailable`, `connectedNotionPages(read)`, `nativeBusinessSync(root, { read, connected })`.
- Produces: HTTP routes under the operator API: `GET /mcp/status` → `{ notion: Status, mercury: Status }`; `POST /mcp/connect` `{ provider }` → `{ authorizationUrl }`; `POST /mcp/disconnect` `{ provider }` → `Status`; `GET /connections/callback/mcp-(notion|mercury)`. `memory-apps` method names: Granola `"api" | undefined`; Notion `"mcp" | undefined`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/memory-apps.test.ts`. The file's helper is `make(extra)` (line 49), which spreads `extra` into the `memoryApps` options and returns an object whose `api` is the service; check its return statement for the exact property name before writing:

```ts
test("Granola and Notion report app-owned connection methods, never Codex", async () => {
  const { api } = make({ granolaConnection: async () => "api", notionConnection: async () => "mcp" });
  const listed = (await api.list(true)).apps;
  expect(listed.find(app => app.id === "granola")?.connectionMethod).toBe("api");
  expect(listed.find(app => app.id === "notion")?.connectionMethod).toBe("mcp");
  expect(JSON.stringify(listed)).not.toMatch(/through Codex/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/memory-apps.test.ts` — Expected: FAIL on the type/`"mcp"` assertion.

- [ ] **Step 3: Implement `memory-apps.ts`**

- Lines 853-855 become:
```ts
  granolaConnection?: (force?: boolean) => Promise<"api" | undefined>;
  granolaNotes?: (cursor?: string) => Promise<{ documents: Array<{ id: string; title: string; text: string }>; hasMore: boolean; cursor?: string }>;
  notionConnection?: (force?: boolean) => Promise<"mcp" | undefined>;
```
- Line 1012: replace the `granolaMethod === "codex" ? "Uses your existing Granola connection through Codex…" : "Connected to Granola API…"` ternary with the API string alone: `"Connected to Granola API. Sync imports up to 20 meeting notes per pass; more notes resume on the next sync."`
- Every call `granolaNotes(cursor, method)` becomes `granolaNotes(cursor)`; delete branches that test `=== "codex"` for the Granola/Notion connection method (not the `app === "codex"` branches, which are the Codex chat-history importer and stay).
- Any Notion note that says "through Codex" becomes "Connected to Notion. Sync imports your recently edited pages."

- [ ] **Step 4: Implement `operator-plugin.ts`**

Imports: remove `connectedGranolaNotes`; change the Notion import to `import { connectedNotionPages, notionAvailable, NOTION_TOOLS } from "./notion-connected";`.

Add Notion to the `mcp` object Task 2 created (Notion's server takes no scope parameter beyond its default):
```ts
    notion: mcpConnection({ name: "Notion", url: "https://mcp.notion.com/mcp", storePath: join(root, ".operator-data", "mcp", "notion.json"), allowedTools: NOTION_TOOLS, allowText: true }),
```

Replace the Granola/Notion wiring (~646-671):
```ts
    recentMeetings: async () => {
      if (granola.configured()) return { ...await granola.notes(), scope: "The first page of up to 20 Granola notes" };
      throw new Error("Granola is not connected. Add your Granola API key in Memory.");
    },
```
```ts
    granolaConnection: async () => granola.configured() ? "api" : undefined,
    granolaNotes: async (cursor) => granola.notes(cursor),
    notionConnection: async () => {
      if (!mcp.notion.status().connected) return undefined;
      try { return await notionAvailable(mcp.notion.read) ? "mcp" : undefined; } catch { return undefined; }
    },
    notionPages: () => connectedNotionPages(mcp.notion.read),
```

Callback (next to the existing Google/Outlook callback branch, before the origin check):
```ts
          const mcpCallback = (req.method || "GET") === "GET" && callbackUrl.pathname.match(/^\/connections\/callback\/mcp-(notion|mercury)$/);
          if (mcpCallback) {
            const id = mcpCallback[1] as keyof typeof mcp;
            let ok = false;
            try {
              if (callbackUrl.searchParams.has("error")) throw new Error("not completed");
              await mcp[id].complete(callbackUrl.searchParams.get("code") ?? "", callbackUrl.searchParams.get("state") ?? "", mcpRedirect(id));
              ok = true;
            } catch { /* Do not echo provider codes or credential-bearing URLs into an HTML document. */ }
            res.statusCode = ok ? 200 : 400;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
            return res.end(`<!doctype html><title>Connection</title><body style="margin:0;padding:48px;background:#101016;color:#efebff;font:16px system-ui">${ok ? "Connected. You can close this tab and return to Agentic OS." : "Sign-in was not completed. Close this tab and try again from Connections."}</body>`);
          }
```

Routes (next to `/business/native-connections`):
```ts
          if (method === "GET" && path === "/mcp/status") return send({ notion: mcp.notion.status(), mercury: mcp.mercury.status() });
          if (method === "POST" && (path === "/mcp/connect" || path === "/mcp/disconnect")) {
            if (body.provider !== "notion" && body.provider !== "mercury") throw new Error("Choose Notion or Mercury.");
            const id = body.provider as keyof typeof mcp;
            if (path === "/mcp/disconnect") return send(mcp[id].disconnect());
            return send({ authorizationUrl: (await mcp[id].begin(mcpRedirect(id))).authorizationUrl });
          }
```

- [ ] **Step 5: Add a route test**

In `scripts/operator-plugin.test.ts`. The helper is `request(path, body?)` (line 44): no body is a GET, a body is a POST with the test token, and it returns `{ status, data }`. Paths are bare (`request("/state")`), with no prefix.

```ts
test("MCP status starts signed out and rejects unknown providers", async () => {
  expect((await request("/mcp/status")).data).toEqual({ notion: { connected: false, requiresSignIn: true }, mercury: { connected: false, requiresSignIn: true } });
  const rejected = await request("/mcp/connect", { provider: "gmail" });
  expect(rejected.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(rejected.data)).toMatch(/Notion or Mercury/);
  expect((await request("/business/native-connections")).data.mercury).toMatchObject({ available: false, requiresSignIn: true });
});
```

- [ ] **Step 6: Delete the Granola bridge reader and verify**

```bash
git rm scripts/granola-connected.ts scripts/granola-connected.test.ts
bun test scripts/memory-apps.test.ts scripts/operator-plugin.test.ts scripts/voice-memory.test.ts
```
Expected: all pass. If `granolaMeetings` from the deleted file is imported anywhere else, `grep -rn "granola-connected" scripts src` must return nothing before committing.

- [ ] **Step 7: Commit**

```bash
git add -A scripts/operator-plugin.ts scripts/operator-plugin.test.ts scripts/memory-apps.ts scripts/memory-apps.test.ts
git commit -m "Wire Notion and Mercury sign-in routes; Granola uses its API only"
```

---

### Task 5: Recent mail and Slack on the account lane

**Files:**
- Modify: `scripts/native-inbox-sync.ts` (whole `nativeInboxSync` function; delete `gmailSearchMetadata`, `gmailReadBody`, `slackSearchMessages`, `identity`, `readTools`)
- Modify: `scripts/voice-recent-emails.ts:10,47-62`
- Modify: `scripts/operator-plugin.ts:487,494`
- Test: `scripts/native-inbox-sync.test.ts`, `scripts/voice-recent-emails.test.ts`

**Interfaces:**
- Consumes: `mailProvider` (`recent`, `message`), `mailMetadataPath`, `outlookMetadataFields` from `./mail-provider`; `accounts.mailIdentity`, `accounts.readMail`, `accounts.handle` from `./account-connections`.
- Produces:
  ```ts
  type Lane = {
    identity: (provider: "gmail" | "outlook") => Promise<string>;                       // throws when not connected
    request: (provider: "gmail" | "outlook", path: string, account?: string) => Promise<any>;
    slack: { status: () => Promise<{ connected: boolean; email?: string }>; sync: () => Promise<{ messages: number }> };
    mail: { recent: ReturnType<typeof mailProvider>["recent"]; message: ReturnType<typeof mailProvider>["message"] };
  };
  nativeInboxSync(root, { load, save, archive, lane: Lane })
  ```
  Returned methods and their result shapes are unchanged: `status`, `owns`, `selectedEmailAccounts`, `recentEmails`, `sync`, `message`. `importInboxSnapshot(..., via: "file")` replaces `via: "codex"`.

- [ ] **Step 1: Rewrite the tests**

Replace the tests in `scripts/native-inbox-sync.test.ts` with tests against a fake `Lane`. Keep the file's `roots`/`archives` arrays and its `afterEach` cleanup; delete `metadata`, `body`, `slackBlock`, the old `fixture()` and the tests of the three deleted converters. Each test starts with `const { root, archive, load, save } = setup();`.

```ts
function setup() {
  const root = mkdtempSync(join(tmpdir(), "native-inbox-test-")); roots.push(root);
  const archive = mailArchive(root); archives.push(archive);
  let state = { inbox: [], gmailLabels: [], inboxImports: [] } as unknown as OperatorState;
  return { root, archive, load: () => structuredClone(state), save: (next: OperatorState) => { state = structuredClone(next); } };
}
const gmailMeta = (id: string, ms: number) => ({ id, threadId: "t-" + id, internalDate: String(ms), labelIds: ["INBOX"], snippet: "hello", payload: { headers: [{ name: "From", value: "Ada <ada@example.test>" }, { name: "Subject", value: "Subject " + id }] } });
function lane(over: Partial<Lane> = {}): Lane & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    identity: async provider => { if (provider === "outlook") throw new Error("Connect Outlook in Settings → Connections."); return "me@example.test"; },
    request: async (_provider, path) => { calls.push(path); return path.startsWith("/messages?") ? { messages: [{ id: "m1" }, { id: "m2" }] } : gmailMeta(path.split("/")[2].split("?")[0], Date.parse("2026-10-01T10:00:00Z")); },
    slack: { status: async () => ({ connected: false }), sync: async () => ({ messages: 0 }) },
    mail: { recent: async (_p, account) => ({ account, items: [], checkedAt: "2026-10-01T10:00:00.000Z" }), message: async () => undefined } as any,
    ...over,
  };
}

test("status lists what the app itself is connected to", async () => {
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  const status = await service.status();
  expect(status.providers.map(p => [p.id, p.available, p.account])).toEqual([["gmail", true, "me@example.test"], ["outlook", false, ""], ["slack", false, ""]]);
  expect(status.readOnly).toBe(true);
});
test("sync imports recent Gmail metadata, bounded, and records the selection", async () => {
  const fake = lane();
  const service = nativeInboxSync(root, { load, save, archive, lane: fake });
  const result = await service.sync(["gmail"], true);
  expect(result).toMatchObject({ messages: 2, bounded: true, results: [{ provider: "gmail", ok: true, count: 2 }] });
  expect(fake.calls[0]).toContain("maxResults=30");
  expect(service.owns("gmail", "me@example.test")).toBe(true);
  expect(load().inbox.filter(item => item.source === "gmail")).toHaveLength(2);
});
test("a different connected account refuses to refresh the saved selection", async () => {
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  await service.sync(["gmail"], true);
  const other = nativeInboxSync(root, { load, save, archive, lane: lane({ identity: async () => "other@example.test" }) });
  const result = await other.sync();
  expect(result.results[0]).toMatchObject({ provider: "gmail", ok: false });
  expect(result.results[0].error).toMatch(/different signed-in account/);
  expect((await other.status()).providers[0].enabled).toBe(false);
});
test("a provider that is not connected reports a plain error and keeps saved mail", async () => {
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  const result = await service.sync(["outlook"], true);
  expect(result.results[0]).toMatchObject({ provider: "outlook", ok: false });
  expect(result.results[0].error).not.toMatch(/Codex/);
});
test("Slack refresh delegates to the Slack connection", async () => {
  let synced = 0;
  const service = nativeInboxSync(root, { load, save, archive, lane: lane({ slack: { status: async () => ({ connected: true, email: "Acme" }), sync: async () => { synced++; return { messages: 3 }; } } }) });
  expect((await service.sync(["slack"], true)).results[0]).toMatchObject({ provider: "slack", ok: true, count: 3 });
  expect(synced).toBe(1);
});
test("an invalid provider list is rejected", async () => {
  const service = nativeInboxSync(root, { load, save, archive, lane: lane() });
  await expect(service.sync(["gmail", "gmail"], true)).rejects.toThrow(/Choose Gmail, Outlook or Slack/);
});
```

In `scripts/voice-recent-emails.test.ts`: the fake `nativeInbox` no longer needs `recentEmails`; assertions that distinguished a "native" lookup from a "direct" one collapse to one lookup through `providerMail.recent`. Keep every assertion about `ACCOUNT_CHANGED`, the 10-item bound and disabled email.

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/native-inbox-sync.test.ts scripts/voice-recent-emails.test.ts` — Expected: FAIL (`lane` option unknown).

- [ ] **Step 3: Implement `native-inbox-sync.ts`**

Replace the file's imports and everything from `const readTools` through the end with:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { importInboxSnapshot } from "./inbox-imports";
import { mailMetadataPath, outlookMetadataFields, type mailProvider } from "./mail-provider";
import type { mailArchive } from "./mail-archive";
import type { OperatorState } from "../src/lib/operator";

type Provider = "gmail" | "outlook" | "slack";
type MailProvider = "gmail" | "outlook";
const PROVIDERS: Provider[] = ["gmail", "outlook", "slack"];
const names = { gmail: "Gmail", outlook: "Outlook", slack: "Slack" };
type Saved = { enabled: boolean; account: string; lastSync?: string; count?: number; error?: string };
type Store = Partial<Record<Provider, Saved>>;
export type Lane = {
  identity: (provider: MailProvider) => Promise<string>;
  request: (provider: MailProvider, path: string, account?: string) => Promise<any>;
  slack: { status: () => Promise<{ connected: boolean; email?: string }>; sync: () => Promise<{ messages: number }> };
  mail: Pick<ReturnType<typeof mailProvider>, "recent" | "message">;
};
const string = (v: unknown, max = 1000) => typeof v === "string" ? v.slice(0, max) : "";

/** Recent mail and Slack through the accounts connected in this app. Read-only and bounded. */
export function nativeInboxSync(root: string, options: { load: () => OperatorState; save: (state: OperatorState) => void; archive: ReturnType<typeof mailArchive>; lane: Lane }) {
  const lane = options.lane;
  const file = join(root, ".operator-data", "native-connections.json");
  const read = (): Store => {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return Object.fromEntries(PROVIDERS.filter(p => raw[p] && typeof raw[p].account === "string").map(p => [p, { enabled: raw[p].enabled === true, account: string(raw[p].account, 300), lastSync: string(raw[p].lastSync, 40) || undefined, count: Number.isSafeInteger(raw[p].count) ? raw[p].count : undefined, error: string(raw[p].error, 300) || undefined }]));
  };
  const save = (state: Store) => { mkdirSync(join(root, ".operator-data"), { recursive: true, mode: 0o700 }); const tmp = `${file}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(tmp, file); };
  /** The connected account for a provider, or "" when this app is not connected to it. */
  const account = async (provider: Provider) => {
    if (provider === "slack") { const slack = await lane.slack.status(); return slack.connected ? string(slack.email, 300) || "Slack workspace" : ""; }
    try { return string(await lane.identity(provider), 300); } catch { return ""; }
  };
  let inflight: Promise<any> | undefined;
  async function recentMetadata(provider: MailProvider, who: string) {
    const params = new URLSearchParams(provider === "gmail"
      ? { q: "-in:spam -in:trash newer_than:14d", maxResults: "30", includeSpamTrash: "false" }
      : { $top: "30", $orderby: "receivedDateTime desc", $select: outlookMetadataFields });
    const page = await lane.request(provider, "/messages?" + params, who);
    const rows = provider === "gmail" ? page?.messages ?? (page?.resultSizeEstimate === 0 ? [] : undefined) : page?.value;
    if (!Array.isArray(rows) || rows.length > 30 || rows.some((row: any) => typeof row?.id !== "string" || !row.id)) throw new Error("The provider returned an invalid message list.");
    if (provider === "outlook") return rows.map((row: any) => ({ ...row, body: undefined }));
    const metadata: any[] = [];
    for (let offset = 0; offset < rows.length; offset += 4) metadata.push(...await Promise.all(rows.slice(offset, offset + 4).map(async (row: any) => {
      const record = await lane.request("gmail", mailMetadataPath("gmail", row.id), who);
      if (record?.id !== row.id) throw new Error("The provider returned a different message.");
      return { ...record, payload: { headers: record.payload?.headers } };
    })));
    return metadata;
  }
  return {
    async status() {
      const saved = read();
      const providers = await Promise.all(PROVIDERS.map(async id => {
        const who = await account(id);
        return { id, name: names[id], available: !!who, ...saved[id], account: who, enabled: !!saved[id]?.enabled && saved[id]?.account === who && !!who };
      }));
      return { providers, readOnly: true, mode: "recent-snapshot", calendarAvailable: false };
    },
    owns(provider: string, who: string) { const s = read()[provider as Provider]; return !!s?.enabled && s.account === who; },
    selectedEmailAccounts() {
      const selected = read();
      return (["gmail", "outlook"] as const).filter(provider => selected[provider]?.enabled).map(provider => ({ provider, account: selected[provider]!.account }));
    },
    /** Live, bounded metadata for voice. No archive writes or full body requests. */
    async recentEmails(provider: MailProvider, guard: () => void = () => {}) {
      guard();
      const selection = read()[provider];
      if (!selection?.enabled || !selection.account) throw new Error("This mailbox is not selected.");
      return lane.mail.recent(provider, selection.account, guard);
    },
    async sync(selected?: unknown, replaceSelection = false) {
      // A second refresh while one is running simply waits for that one; nothing to report, nothing to show.
      if (inflight) return inflight;
      const previous = read();
      const providers = selected === undefined ? PROVIDERS.filter(p => previous[p]?.enabled) : selected;
      if (!Array.isArray(providers) || providers.length > 3 || providers.some(p => !PROVIDERS.includes(p)) || new Set(providers).size !== providers.length) throw new Error("Choose Gmail, Outlook or Slack.");
      if (!providers.length) { if (replaceSelection) { for (const p of PROVIDERS) if (previous[p]) previous[p]!.enabled = false; save(previous); } return { results: [], messages: 0, bounded: true }; }
      inflight = (async () => { try {
        const results: any[] = [], saved = read();
        const unchanged = (provider: Provider, current = read()) => JSON.stringify(current[provider]) === JSON.stringify(previous[provider]);
        if (replaceSelection) for (const p of PROVIDERS) if (saved[p]) saved[p]!.enabled = providers.includes(p);
        for (const provider of providers as Provider[]) {
          try {
            const who = await account(provider);
            if (!who) throw new Error(`${names[provider]} is not connected. Connect it in Settings → Connections.`);
            if (!replaceSelection && saved[provider]?.account && saved[provider]?.account !== who) throw new Error(`${names[provider]} has a different signed-in account. Select it again in Connections before refreshing.`);
            let count = 0;
            if (provider === "slack") count = (await lane.slack.sync()).messages;
            else {
              const metadata = await recentMetadata(provider, who);
              if (!unchanged(provider)) throw new Error("This connection changed while refreshing. Saved messages were preserved.");
              const items = options.archive.importMetadata(provider, who, metadata).map(item => ({ ...item, id: item.remoteId, body: item.body || "(No message preview)", remoteId: item.remoteId }));
              const state = options.load();
              const oldBodies = new Map(state.inbox.filter(i => i.source === provider && i.account === who && i.bodyStatus !== "metadata").map(i => [i.id, { body: i.body, bodyStatus: i.bodyStatus }]));
              if (items.length) importInboxSnapshot(state, { provider, account: who, messages: items, via: "file" });
              for (const item of state.inbox) if (item.source === provider && item.account === who && items.some(i => i.remoteId === item.remoteId)) {
                const old = oldBodies.get(item.id); if (old) Object.assign(item, old); else { item.bodyStatus = "metadata"; item.bodyTruncated = true; }
              }
              options.save(state); count = items.length;
            }
            saved[provider] = { enabled: true, account: who, lastSync: new Date().toISOString(), count };
            results.push({ provider, count, lastSync: saved[provider]!.lastSync, ok: true });
          } catch (error) {
            const message = (error as Error).message;
            if (saved[provider]) saved[provider] = { ...saved[provider]!, error: message };
            results.push({ provider, ok: false, error: message });
          }
        }
        const current = read();
        for (const p of PROVIDERS) if (unchanged(p, current) && saved[p]) current[p] = saved[p];
        save(current);
        return { results, messages: results.reduce((sum, r) => sum + (r.count || 0), 0), bounded: true };
      } finally { inflight = undefined; } })();
      return inflight;
    },
    async message(id: string) {
      const item = options.archive.get(id);
      if (!item || item.bodyStatus !== "metadata") return item;
      if (!this.owns(item.source, item.account || "")) throw new Error("Refresh this mailbox in Connections first.");
      return lane.mail.message(id);
    },
  };
}
```

Before committing, confirm `importInboxSnapshot`'s `via` field accepts `"file"` (it does: `scripts/inbox-imports.ts:144`) and that the Gmail label list was the only thing the old code passed as `labels` (it is; labels are now left untouched, which the function treats as "preserve").

- [ ] **Step 4: Implement the callers**

`scripts/operator-plugin.ts` — move the `providerMail` line above `nativeInbox` and build the lane:
```ts
  const providerMail = mailProvider({ archive, identity: accounts.mailIdentity, request: accounts.readMail });
  const nativeInbox = nativeInboxSync(root, { load, save, archive, lane: {
    identity: accounts.mailIdentity, request: accounts.readMail, mail: providerMail,
    slack: {
      status: async () => ((await accounts.handle("/connections", "GET", {}, undefined)) as any).accounts.find((a: any) => a.id === "slack") || { connected: false },
      sync: () => accounts.handle("/connections/sync", "POST", { provider: "slack" }, undefined) as Promise<{ messages: number }>,
    },
  } });
```
Checked against `account-connections.ts`: `handle` is async; `GET /connections` returns `accounts` with a Slack row `{ id: "slack", connected, email: <workspace name> }` (`slack-connection.ts:63`); `POST /connections/sync` with `{ provider: "slack" }` reads the chosen channel, writes the messages into inbox state itself and returns `{ messages }` (`slack-connection.ts:102-147`).

`scripts/voice-recent-emails.ts` — `nativeInbox` type drops `recentEmails`; line 62 becomes `const result = await options.providerMail.recent(provider, selected.account, guard);`. Keep `useNative` only for choosing which selection list `stillSelected` re-reads.

- [ ] **Step 5: Run to verify pass**

Run: `bun test scripts/native-inbox-sync.test.ts scripts/voice-recent-emails.test.ts scripts/operator-plugin.test.ts scripts/inbox-imports.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/native-inbox-sync.ts scripts/native-inbox-sync.test.ts scripts/voice-recent-emails.ts scripts/voice-recent-emails.test.ts scripts/operator-plugin.ts
git commit -m "Refresh recent mail and Slack through the app's own accounts"
```

---

### Task 6: Mail history backfill on the account lane

**Files:**
- Modify: `scripts/mail-backfill.ts:1-9,29-38,51-60,95-157`
- Modify: `scripts/operator-plugin.ts:691`
- Test: `scripts/mail-backfill.test.ts`

**Interfaces:**
- Consumes: `accounts.mailIdentity`, `accounts.readMail`; `mailMetadataPath`, `outlookMetadataFields`.
- Produces: `mailBackfill(root, { archive, identity, request, months?, now? })` with unchanged `status()`, `start(providers)`, `running()` and unchanged `BackfillState` (its `cursor` is now always a string or undefined at write time).

- [ ] **Step 1: Rewrite the tests**

Replace the bridge fakes in `scripts/mail-backfill.test.ts` with `identity`/`request` fakes. Keep the existing `backfillEstimate` tests unchanged. Add or adapt:

```ts
const wait = async (service: ReturnType<typeof mailBackfill>) => { for (let i = 0; i < 200 && service.running().length; i++) await new Promise(r => setTimeout(r, 5)); };
const meta = (id: string, iso: string) => ({ id, threadId: id, internalDate: String(Date.parse(iso)), labelIds: ["INBOX"], snippet: "s", payload: { headers: [{ name: "From", value: "a@example.test" }, { name: "Subject", value: id }] } });

test("Gmail history pages by token and finishes when no token is returned", async () => {
  const paths: string[] = [];
  const request = async (_p: string, path: string) => {
    paths.push(path);
    if (path.startsWith("/messages?")) return path.includes("pageToken=next") ? { messages: [{ id: "b" }] } : { messages: [{ id: "a" }], nextPageToken: "next" };
    return meta(path.split("/")[2].split("?")[0], "2026-09-01T10:00:00Z");
  };
  const service = mailBackfill(root, { archive, identity: async () => "me@example.test", request, now: () => Date.parse("2026-10-01T00:00:00Z") });
  service.start(["gmail"]); await wait(service);
  expect(service.status().gmail).toMatchObject({ status: "done", account: "me@example.test" });
  expect(service.status().gmail!.cursor).toBeUndefined();
  expect(paths.filter(p => p.startsWith("/messages?"))[0]).toMatch(/after%3A2025%2F/);
});
test("a numeric Outlook cursor left by the old lane is discarded, not sent to Graph", async () => {
  writeFileSync(join(root, ".operator-data", "mail-backfill.json"), JSON.stringify({ outlook: { account: "me@example.test", since: "2025-10-01T00:00:00.000Z", status: "waiting", imported: 300, cursor: 300 } }));
  const paths: string[] = [];
  const request = async (_p: string, path: string) => { paths.push(path); return { value: [] }; };
  const service = mailBackfill(root, { archive, identity: async () => "me@example.test", request });
  service.start(["outlook"]); await wait(service);
  expect(paths[0].startsWith("/messages?")).toBe(true);
  expect(paths.join(" ")).not.toContain("300");
  expect(service.status().outlook!.status).toBe("done");
});
test("Outlook follows the provider's next link and stops at the window start", async () => {
  const next = "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc";
  const request = async (_p: string, path: string) => path === next
    ? { value: [{ id: "old", receivedDateTime: "2020-01-01T00:00:00Z" }], "@odata.nextLink": next + "2" }
    : { value: [{ id: "new", receivedDateTime: "2026-09-20T00:00:00Z" }], "@odata.nextLink": next };
  const service = mailBackfill(root, { archive, identity: async () => "me@example.test", request, now: () => Date.parse("2026-10-01T00:00:00Z") });
  service.start(["outlook"]); await wait(service);
  expect(service.status().outlook).toMatchObject({ status: "done", imported: 1 });
});
test("a different connected account stops the import with a plain message", async () => {
  writeFileSync(join(root, ".operator-data", "mail-backfill.json"), JSON.stringify({ gmail: { account: "old@example.test", since: "2025-10-01T00:00:00.000Z", status: "waiting", imported: 5 } }));
  const service = mailBackfill(root, { archive, identity: async () => "new@example.test", request: async () => ({ messages: [] }) });
  service.start(["gmail"]); await wait(service);
  expect(service.status().gmail).toMatchObject({ status: "error", imported: 5 });
  expect(service.status().gmail!.error).toMatch(/different account/);
});
test("a mailbox that is not connected reports the connection message", async () => {
  const service = mailBackfill(root, { archive, identity: async () => { throw new Error("Connect Gmail in Settings → Connections to search and index email directly on this computer."); }, request: async () => ({}) });
  service.start(["gmail"]); await wait(service);
  expect(service.status().gmail!.error).toMatch(/Connect Gmail/);
});
```

That file's helpers are `root()` (a fresh temp directory, line 9), `fakeArchive()` (line 18) and `until(check)` (line 14). Start each test with `const dir = root(), archive = fakeArchive();`, use `dir` wherever the code above says `root`, and call `mkdirSync(join(dir, ".operator-data"), { recursive: true })` before writing a fixture file. Delete the old `tool(email)` helper and the bridge fakes.

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/mail-backfill.test.ts` — Expected: FAIL (`identity`/`request` not accepted).

- [ ] **Step 3: Implement**

In `scripts/mail-backfill.ts`:
- Header comment lines 1-4: "through the accounts connected in this app" replaces "through the Codex connections that are already signed in".
- Imports: drop `./codex-connected-read` and `./native-inbox-sync`; add `import { mailMetadataPath, outlookMetadataFields } from "./mail-provider";`.
- Delete `TOOLS` and `identity`. Replace `PAGES_PER_SESSION` with `const PAGES_PER_SESSION = { gmail: 5, outlook: 8 } as const;` and its comment with `// Each session takes a few pages so progress is saved often.`
- Options become `{ archive; identity: (provider: MailProvider) => Promise<string>; request: (provider: MailProvider, path: string, account?: string) => Promise<any>; months?; now? }`; delete the `connectedRead` line.
- Replace `session` with:

```ts
  /** One read session: a few pages, newest first, stopping at the window's start. */
  async function session(provider: MailProvider): Promise<"more" | "done"> {
    const account = await options.identity(provider);
    let state = read()[provider]!;
    if (state.account && state.account !== account) throw new Error("A different account is signed in now. Start the import again.");
    const sinceMs = Date.parse(state.since);
    // A numeric cursor is a leftover from the earlier reader; restart paging (imports are idempotent).
    if (typeof state.cursor !== "string") state = patch(provider, { cursor: undefined });
    for (let page = 0; page < PAGES_PER_SESSION[provider]; page++) {
      let rows: any[] = [], next: string | undefined;
      const cursor = typeof state.cursor === "string" ? state.cursor : "";
      if (provider === "gmail") {
        const params = new URLSearchParams({ q: `-in:spam -in:trash after:${gmailDate(state.since)}`, maxResults: String(PAGE), ...(cursor ? { pageToken: cursor } : {}) });
        const raw = await options.request("gmail", "/messages?" + params, account);
        const listing = Array.isArray(raw?.messages) ? raw.messages.slice(0, PAGE).filter((row: any) => typeof row?.id === "string" && row.id) : [];
        next = typeof raw?.nextPageToken === "string" && raw.nextPageToken ? raw.nextPageToken : undefined;
        for (let offset = 0; offset < listing.length; offset += 4) rows.push(...await Promise.all(listing.slice(offset, offset + 4).map(async (row: any) => {
          const record = await options.request("gmail", mailMetadataPath("gmail", row.id), account);
          if (record?.id !== row.id) throw new Error("Gmail returned a different message. Saved mail was preserved.");
          return { ...record, payload: { headers: record.payload?.headers } };
        })));
        if (rows.length) options.archive.importMetadata("gmail", account, rows);
      } else {
        const first = "/messages?" + new URLSearchParams({ $top: String(PAGE), $orderby: "receivedDateTime desc", $select: outlookMetadataFields + ",isDraft" });
        const raw = await options.request("outlook", cursor || first, account);
        const all = Array.isArray(raw?.value) ? raw.value.slice(0, PAGE) : [];
        // The date boundary is only reached by an older message, never by a skipped draft.
        const reachedStart = all.some((r: any) => r?.isDraft !== true && Date.parse(r?.receivedDateTime) < sinceMs);
        rows = all.filter((r: any) => Date.parse(r?.receivedDateTime) >= sinceMs && r?.isDraft !== true);
        const link = raw?.["@odata.nextLink"];
        next = typeof link === "string" && link && !reachedStart ? link : undefined;
        if (rows.length) options.archive.importMetadata("outlook", account, rows.map((r: any) => ({ ...r, body: undefined })));
      }
      const times = rows.map((r: any) => provider === "gmail" ? Number(r.internalDate) : Date.parse(r.receivedDateTime)).filter(Number.isFinite);
      const oldest = times.length ? new Date(Math.min(...times)).toISOString() : state.oldest;
      const newest = times.length ? new Date(Math.max(...times)).toISOString() : undefined;
      // The count is what the archive really holds, so repeat passes never double count.
      const imported = stored(provider, account) || state.imported + rows.length;
      state = patch(provider, {
        account, imported, cursor: next,
        oldest: oldest && (!state.oldest || oldest < state.oldest) ? oldest : state.oldest,
        newest: newest && (!state.newest || newest > state.newest) ? newest : state.newest,
        estimate: next ? backfillEstimate(imported, state.since, oldest, now()) : imported,
      });
      if (!next) return "done";
    }
    return "more";
  }
```

Checked: `accounts.readMail` (`account-connections.ts:717-728`) accepts an absolute `https://` path, requires the Graph origin and a `/v1.0/me/messages` path, and rejects anything else with "The provider returned an invalid mailbox cursor." The next link is validated there; no change to `readMail` is needed.

- `scripts/operator-plugin.ts:691` and its comment:
```ts
  // A year of mail history, headers and snippets only, through the accounts connected in this app.
  const mailHistory = mailBackfill(root, { archive, identity: accounts.mailIdentity, request: accounts.readMail });
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test scripts/mail-backfill.test.ts scripts/memory-connect-all.test.ts` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/mail-backfill.ts scripts/mail-backfill.test.ts scripts/operator-plugin.ts
git commit -m "Backfill mail history through the app's own accounts"
```

---

### Task 7: Calendar on the account lane

**Files:**
- Modify: `scripts/native-calendar-sync.ts` (remove `required`, `identity`, `nativeCalendarEvent`; rewrite `nativeCalendarSync`)
- Modify: `scripts/operator-plugin.ts:488`
- Test: `scripts/native-calendar-sync.test.ts`

**Interfaces:**
- Consumes: `accounts.handle("/connections", "GET", …)` → `{ accounts: Array<{ id, connected, email?, calendarAccess, calendarCoverage? }> }`; `accounts.handle("/connections/sync", "POST", { provider: "google", calendarOnly: true, timeMin?, timeMax? })` → `{ events: number; coverage?: CalendarCoverage }`.
- Produces:
  ```ts
  type CalendarLane = {
    account: () => Promise<{ connected: boolean; email?: string; calendarAccess?: string }>;
    sync: (input: { timeMin?: unknown; timeMax?: unknown }) => Promise<{ events: number; coverage?: CalendarCoverage }>;
  };
  nativeCalendarSync(root, { lane: CalendarLane })
  ```
  `status()`, `disable()`, `sync()` keep their result shapes (`available`, `enabled`, `account`, `readOnly`, `syncing`, `error`, `coverage`). Events are written by the account lane's own sync. Checked: primary-calendar events get the id `google:<sha256(account)[:12]>:<event id>` (`calendar-read.ts:108`), identical to the old adapter, so existing events are replaced in place, not duplicated. A calendar-only sync passes an empty inbox and leaves mail untouched (`account-connections.ts:132-163`). Behaviour change: the lane reads every calendar the account can read, not only the primary one.

- [ ] **Step 1: Rewrite the tests**

Replace `scripts/native-calendar-sync.test.ts` (drop the `nativeCalendarEvent` tests; that parser is deleted):

```ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeCalendarSync } from "./native-calendar-sync";

const coverage = { timeMin: "2026-09-01T00:00:00.000Z", timeMax: "2026-12-01T00:00:00.000Z", syncedAt: "2026-10-01T00:00:00.000Z", calendarCount: 1, eventCount: 4, calendars: [{ id: "primary", name: "Primary" }], complete: true };
const fresh = (lane: any) => nativeCalendarSync(mkdtempSync(join(tmpdir(), "aos-")), { lane });
const connected = (email = "me@example.test", calendarAccess = "granted") => async () => ({ connected: true, email, calendarAccess });

test("status is available only for a connected Google account with calendar access", async () => {
  expect(await fresh({ account: connected(), sync: async () => ({ events: 0 }) }).status()).toMatchObject({ available: true, enabled: false, account: "me@example.test", readOnly: true });
  expect(await fresh({ account: async () => ({ connected: false }), sync: async () => ({ events: 0 }) }).status()).toMatchObject({ available: false, enabled: false });
  expect(await fresh({ account: connected("me@example.test", "missing"), sync: async () => ({ events: 0 }) }).status()).toMatchObject({ available: false });
});
test("sync enables the calendar, passes the window through and records coverage", async () => {
  const seen: any[] = [];
  const service = fresh({ account: connected(), sync: async (input: any) => { seen.push(input); return { events: 4, coverage }; } });
  await expect(service.sync()).rejects.toThrow(/Connect Google Calendar before refreshing/);
  const result = await service.sync({ enable: true, timeMin: coverage.timeMin, timeMax: coverage.timeMax });
  expect(result).toMatchObject({ events: 4, account: "me@example.test", readOnly: true });
  expect(seen[0]).toMatchObject({ timeMin: coverage.timeMin, timeMax: coverage.timeMax });
  expect(await service.status()).toMatchObject({ enabled: true, coverage });
});
test("a different connected account must be connected again before refreshing", async () => {
  let email = "me@example.test";
  const service = fresh({ account: async () => ({ connected: true, email, calendarAccess: "granted" }), sync: async () => ({ events: 1, coverage }) });
  await service.sync({ enable: true });
  email = "other@example.test";
  expect(await service.status()).toMatchObject({ enabled: false, error: "Your calendar connection changed. Connect the current account again." });
  await expect(service.sync()).rejects.toThrow(/account changed/);
});
test("a window over 100 days and a not-connected account are refused before any provider call", async () => {
  let calls = 0;
  const service = fresh({ account: connected(), sync: async () => { calls++; return { events: 0 }; } });
  await expect(service.sync({ enable: true, timeMin: "2026-01-01T00:00:00Z", timeMax: "2026-12-31T00:00:00Z" })).rejects.toThrow(/up to 100 days/);
  const off = fresh({ account: async () => ({ connected: false }), sync: async () => { calls++; return { events: 0 }; } });
  await expect(off.sync({ enable: true })).rejects.toThrow(/Connect Google in Settings/);
  expect(calls).toBe(0);
});
test("disable keeps saved events and switches the calendar off", async () => {
  const service = fresh({ account: connected(), sync: async () => ({ events: 1, coverage }) });
  await service.sync({ enable: true });
  expect(service.disable()).toEqual({ enabled: false });
  expect(await service.status()).toMatchObject({ enabled: false, available: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/native-calendar-sync.test.ts` — Expected: FAIL (`lane` not accepted).

- [ ] **Step 3: Implement**

Replace `scripts/native-calendar-sync.ts` with:

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { calendarRange, type CalendarCoverage } from "./calendar-read";

type Saved = { enabled: boolean; account?: string; calendarId?: string; coverage?: CalendarCoverage; error?: string };
export type CalendarLane = {
  account: () => Promise<{ connected: boolean; email?: string; calendarAccess?: string }>;
  sync: (input: { timeMin?: unknown; timeMax?: unknown }) => Promise<{ events: number; coverage?: CalendarCoverage }>;
};

/** Google Calendar through the account connected in this app. This adapter exposes no writes. */
export function nativeCalendarSync(root: string, options: { lane: CalendarLane }) {
  const lane = options.lane;
  const directory = join(root, ".operator-data"), file = join(directory, "native-calendar.json");
  const read = (): Saved => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { enabled: false };
  const save = (value: Saved) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  let syncing = false;
  /** The connected Google account when it can read calendars, otherwise "". */
  const discover = async () => {
    const account = await lane.account();
    return account.connected && account.email && account.calendarAccess !== "missing" ? account.email.toLowerCase() : "";
  };
  return {
    async status() {
      const saved = read();
      try {
        const account = await discover();
        const { error: _staleError, ...withoutError } = saved;
        return {
          ...withoutError, available: !!account, enabled: saved.enabled && saved.account === account && !!account, account, readOnly: true, syncing,
          error: saved.enabled && saved.account !== account ? "Your calendar connection changed. Connect the current account again." : undefined,
        };
      } catch (error) {
        return { ...saved, available: false, enabled: false, readOnly: true, syncing, error: (error as Error).message };
      }
    },
    disable() { save({ ...read(), enabled: false }); return { enabled: false }; },
    async sync(input: { enable?: boolean; timeMin?: unknown; timeMax?: unknown } = {}) {
      if (syncing) throw new Error("Google Calendar is already refreshing.");
      const previous = read();
      if (!previous.enabled && input.enable !== true) throw new Error("Connect Google Calendar before refreshing.");
      const range = calendarRange(input);
      if (Date.parse(range.timeMax) - Date.parse(range.timeMin) > 100 * 86400000) throw new Error("Choose a calendar window of up to 100 days.");
      syncing = true;
      try {
        const account = await discover();
        if (!account) throw new Error("Connect Google in Settings → Connections and allow calendar access, then check again here.");
        if (previous.account && previous.account !== account && input.enable !== true) throw new Error("Your Google Calendar account changed. Connect it again before refreshing.");
        const result = await lane.sync({ timeMin: range.timeMin, timeMax: range.timeMax });
        if (JSON.stringify(read()) !== JSON.stringify(previous)) throw new Error("Calendar settings changed during refresh. Saved events were preserved.");
        if (await discover() !== account) throw new Error("Your Google Calendar account changed during refresh. Connect it again.");
        save({ enabled: true, account, calendarId: result.coverage?.calendars?.[0]?.id, coverage: result.coverage });
        return { events: result.events, account, coverage: result.coverage, readOnly: true };
      } catch (error) {
        if (JSON.stringify(read()) === JSON.stringify(previous)) save({ ...previous, error: (error as Error).message });
        throw error;
      } finally { syncing = false; }
    },
  };
}
```

`scripts/operator-plugin.ts:488`:
```ts
  const nativeCalendar = nativeCalendarSync(root, { lane: {
    account: async () => ((await accounts.handle("/connections", "GET", {}, undefined)) as any).accounts?.find((a: any) => a.id === "google") || { connected: false },
    sync: input => accounts.handle("/connections/sync", "POST", { provider: "google", calendarOnly: true, ...input }, undefined) as Promise<{ events: number; coverage?: CalendarCoverage }>,
  } });
```
Add `import type { CalendarCoverage } from "./calendar-read";` if not already imported there.

- [ ] **Step 4: Run to verify pass**

Run: `bun test scripts/native-calendar-sync.test.ts scripts/memory-connect-all.test.ts scripts/operator-plugin.test.ts`
Expected: all pass. If any other file imports `nativeCalendarEvent`, `grep -rn nativeCalendarEvent scripts src` must be empty before committing.

- [ ] **Step 5: Commit**

```bash
git add scripts/native-calendar-sync.ts scripts/native-calendar-sync.test.ts scripts/operator-plugin.ts
git commit -m "Sync Google Calendar through the app's own account"
```

---

### Task 8: Remove the bridge and the Codex app inventory

**Files:**
- Modify: `scripts/agent-jobs.ts:14,286-315`
- Modify: `scripts/native-connection-discovery.ts`, `scripts/account-discovery.ts`
- Delete: `scripts/codex-connected-read.ts`, `scripts/codex-connected-read.test.ts`
- Create: `scripts/no-codex-connectors.test.ts`
- Test: `scripts/agent-jobs.test.ts`, `scripts/account-discovery.test.ts`, `scripts/native-connection-discovery.test.ts` (if present)

**Interfaces:**
- Produces: `agentJobs().status()` returns `tools: []` for both `codex` and `claude`. `nativeConnectionDiscovery(root, options).read(force)` returns `{ apps, harnesses: [{ id: "claude", detail }], detail }` with Claude entries only. `installedCodex` stays exported from `account-discovery.ts` (the Codex model/agent runtime may use it); `existingConnectionDiscovery` and `normalizeExistingApps` are removed if nothing else imports them.

- [ ] **Step 1: Write the guard test**

Create `scripts/no-codex-connectors.test.ts`:

```ts
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
function files(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (name === "node_modules" || name === "dist") return [];
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const sources = [...files(join(root, "scripts")), ...files(join(root, "src"))].filter(path => !path.endsWith("no-codex-connectors.test.ts"));

test("no connector routes through the Codex app-server bridge", () => {
  expect(existsSync(join(root, "scripts", "codex-connected-read.ts"))).toBe(false);
  for (const path of sources) {
    const text = readFileSync(path, "utf8");
    expect([path, /codex-connected-read|withConnectedRead|codex_apps|mcpServer\/tool\/call/.test(text)]).toEqual([path, false]);
  }
});
test("connector modules do not start Codex", () => {
  for (const name of ["native-inbox-sync", "mail-backfill", "native-calendar-sync", "native-business-sync", "notion-connected", "mcp-connection"]) {
    const text = readFileSync(join(root, "scripts", name + ".ts"), "utf8");
    expect([name, /child_process|app-server|installedCodex/.test(text)]).toEqual([name, false]);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/no-codex-connectors.test.ts` — Expected: FAIL (bridge file exists; `agent-jobs.ts` imports it).

- [ ] **Step 3: Implement**

`scripts/agent-jobs.ts`: delete the `withConnectedRead` import; in `status()` replace the block from `let tools: string[] = [];` through the closing `}` of `if (codex.ready) { … }` with nothing, and set the Codex entry's `tools: []`. Update `scripts/agent-jobs.test.ts`: any assertion expecting listed Codex tools becomes `expect(codexEntry.tools).toEqual([])`; remove fakes that existed only to feed the tool list.

`scripts/native-connection-discovery.ts`: remove the `existingConnectionDiscovery` import and the `codex` constant; `read` becomes:
```ts
    async read(force = false) {
      if (stopped) return { apps: [], harnesses: [], detail: "Discovery stopped." };
      const mcp = await claude(force);
      return { apps: mcp.apps, harnesses: [{ id: "claude", detail: mcp.detail }], detail: mcp.detail };
    },
    close() { stopped = true; cancel?.(); },
```
Keep the option type by declaring it locally: `options: { homeDir?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; claudeBinary?: string | null; claudeStart?: typeof spawn } = {}`.

`scripts/account-discovery.ts`: run `grep -rn "existingConnectionDiscovery\|normalizeExistingApps" scripts src`. If the only hits are this file and its test, delete both functions and their tests, keeping `installedCodex` and its tests. If something else uses them, leave them and note it in the commit message.

```bash
git rm scripts/codex-connected-read.ts scripts/codex-connected-read.test.ts
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test scripts && bun run typecheck`
Expected: 0 fail; typecheck clean. Fix any leftover reference the typecheck names (they will all be removed identifiers from Tasks 2-8).

- [ ] **Step 5: Commit**

```bash
git add -A scripts
git commit -m "Remove the Codex connector bridge and its app inventory"
```

---

### Task 9: Connect controls for Notion and Mercury

**Files:**
- Modify: `src/components/business/connections-panel.tsx:61-62,158,216-221`
- Modify: `src/components/operator/memory-connections.tsx:47` and its Notion card
- Test: `scripts/chat-release.test.ts`-style source assertions are not needed; verify in the browser (Step 4)

**Interfaces:**
- Consumes: `GET /mcp/status`, `POST /mcp/connect`, `POST /mcp/disconnect`; `GET /business/native-connections` → `{ mercury: { available, transactions, requiresSignIn } }`.

- [ ] **Step 1: Mercury card (`connections-panel.tsx`)**

Add next to the existing `native` query:
```tsx
  const mcp = useQuery<{ mercury: { connected: boolean } }>({ queryKey: ["mcp-status"], queryFn: () => operatorRequest("/mcp/status") });
  const connectMercury = async () => {
    const { authorizationUrl } = await operatorRequest<{ authorizationUrl: string }>("/mcp/connect", { provider: "mercury" });
    window.open(authorizationUrl, "_blank", "noopener");
  };
  const disconnectMercury = async () => {
    await operatorRequest("/mcp/disconnect", { provider: "mercury" });
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["mcp-status"] }), queryClient.invalidateQueries({ queryKey: ["business-native-connections"] })]);
  };
```
Refetch both queries on window focus (`refetchOnWindowFocus: true` on each) so the card updates when the user returns from the sign-in tab.

Copy changes:
| Old | New |
|---|---|
| `` `${result.accounts} Mercury account balances refreshed through Codex.` `` | `` `${result.accounts} Mercury account balances refreshed.` `` |
| `"Checking Codex…"` | `"Checking Mercury…"` |
| `"Codex access couldn’t be checked"` | `"Mercury couldn’t be checked"` |
| `"Connect Mercury in Codex, then recheck"` | `"Connect Mercury to read balances and income"` |
| `"Via Codex"` | `"Connected"` |

Next to the status, render `<button type="button" onClick={connectMercury}>Connect Mercury</button>` when `!mcp.data?.mercury.connected`, otherwise `<button type="button" onClick={disconnectMercury}>Disconnect</button>`. Use the button class the neighbouring provider cards in this file use.

- [ ] **Step 2: Notion card (`memory-connections.tsx`)**

Line 47: `connectionMethod?: "mcp" | "api";`. In the Notion card, add the same Connect/Disconnect pair calling `/mcp/connect` and `/mcp/disconnect` with `{ provider: "notion" }`, shown when `app.id === "notion"`; "Connected" when `app.connectionMethod === "mcp"`. After either action invalidate `["memory-connected-apps"]` and `["mcp-status"]`.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — Expected: clean.

- [ ] **Step 4: Check in the browser**

Start the local server the way `START-HERE.md` describes, open the Business connections panel and Memory connections. Confirm: both cards show "Connect"; clicking opens the provider's sign-in page in a new tab; the page layout holds at a narrow width; buttons are reachable by keyboard. Do not complete a real sign-in unless the user asks.

- [ ] **Step 5: Commit**

```bash
git add src/components/business/connections-panel.tsx src/components/operator/memory-connections.tsx
git commit -m "Add Notion and Mercury sign-in to the connection screens"
```

---

### Task 10: Connector copy in the interface

**Files:**
- Modify: `src/components/operator/account-connections.tsx:35-40,680-683,900`
- Modify: `src/components/operator/native-calendar-connection.tsx:112-113`
- Modify: `src/components/operator/inbox-workspace.tsx:496,853`
- Modify: `src/components/brain/brain-connect.tsx:238-239,273-274`
- Modify: `src/components/operator/setup-scan-connections.tsx:19,23,37,72,110-118,134-136,198-236,369-375,411`
- Modify: `src/components/operator/agent-jobs-panel.tsx` (no change needed: the tools line already hides when the list is empty; confirm)

Rule for every string in these files: a sentence that says a **connector** (Gmail, Outlook, Slack, Calendar, Notion, Granola, Mercury) is found in, exposed by, refreshed through or connected in Codex is rewritten to name the in-app connection. Sentences about Codex as an **AI tool** (installed, signed in, chat history, model) stay.

- [ ] **Step 1: Apply the replacements**

| File | Old | New |
|---|---|---|
| `native-calendar-connection.tsx` | `"Use the Google Calendar account already connected in Codex."` | `"Use the Google account connected in Settings → Connections."` |
| `native-calendar-connection.tsx` | `"Connect Google Calendar in Codex, then check again here."` | `"Connect Google in Settings → Connections and allow calendar access, then check again here."` |
| `inbox-workspace.tsx:496` | `` `Refreshed through Codex · ${…}` `` | `` `Refreshed · ${…}` `` |
| `inbox-workspace.tsx:853` | `"Recent messages through Codex · refreshes each minute…"` | `"Recent messages · refreshes each minute…"` (rest unchanged) |
| `account-connections.tsx:680` | `"…refresh recent messages through Codex."` | `"…refresh recent messages."` |
| `account-connections.tsx:683` | `"Select your accounts above to refresh recent messages through Codex. Direct sign-in below is optional and provides separate account permissions."` | `"Select your accounts above to refresh recent messages. Sign in to each account below first."` |
| `account-connections.tsx:900` | `"Enabled Codex …"` clause | Delete the clause about Codex connections; keep the rest of the sentence |
| `account-connections.tsx:35` | Codex and Claude logos + `"Use your existing connections"` | Remove the two logos; heading `"Your connected accounts"` |
| `account-connections.tsx:40` | `"…This Inbox refresh uses supported Codex connections…"` | `"Claude can use its own connected tools in Chat. Inbox refresh uses the accounts you sign in to below."` |
| `brain-connect.tsx:273` | `` `${name} comes in through Codex, which you already use.` `` | `` `${name} comes in once you connect it.` `` |
| `brain-connect.tsx:274` | ``[`Open Codex, then Settings, then Connectors, and add ${connector}.`, "Memory brings it in by itself within a minute."]`` | ``[`Open Settings, then Connections, and connect ${connector}.`, "Memory brings it in by itself within a minute."]`` |
| `brain-connect.tsx:238-239` | comment about Codex | `// Email, meetings and Notion come in from the accounts connected in this app; they only need you when one is not connected.` |
| `setup-scan-connections.tsx:134` | `"None connected in Codex"` | `"None connected yet"` |
| `setup-scan-connections.tsx:135` | `"Not connected in Codex"` | `"Not connected yet"` |
| `setup-scan-connections.tsx:136` | `"No bank connected in Codex"` | `"No bank connected yet"` |
| `setup-scan-connections.tsx:202` | `"Connected via Codex · meeting notes"` branch | Remove the `viaCodex` branch; keep `"API connected · meeting notes"` |
| `setup-scan-connections.tsx:203` | `viaCodex ? "Connected via Codex · recent pages" : available ? "Page export ready" : "Not connected in Codex"` | `app?.connectionMethod === "mcp" ? "Connected · recent pages" : available ? "Page export ready" : "Not connected yet"` |
| `setup-scan-connections.tsx:215` | `` `${who ? who + " · " : ""}via Codex` `` / `"Connect in Codex"` | `` who || "Connected" `` / `"Connect in Settings"` |
| `setup-scan-connections.tsx:216` | `` `${name}'s read connection is exposed by Codex…` `` | `` `${name} is connected in this app${who ? ` as ${who}` : ""}. Import refreshes recent messages; it does not import the entire account.` `` |
| `setup-scan-connections.tsx:220` | `via Codex` / `"Connect in Codex"` | `calendar.account || "Connected"` / `"Connect in Settings"` |
| `setup-scan-connections.tsx:221` | `"Google Calendar's read tools are exposed by Codex. Import reads…"` | `"Google Calendar is connected in this app. Import reads events from a month back to two months ahead; nothing is written to your calendar."` |
| `setup-scan-connections.tsx:234-236` | Mercury strings with `Codex` | `"Connect in Settings"`, `` `${count(…)} · ${money(…)}` ``, `"Reading balances…"`, `"Connected · balances unavailable"`, evidence `"Mercury is connected in this app, read-only. Import refreshes account balances and recent income."` |
| `setup-scan-connections.tsx:37` | `"Connected apps in Codex and Claude"` | `"Connected apps"` |
| `setup-scan-connections.tsx:369-375` | The "One sign-in brings most of this in… through Codex" guide card (both variants) | `{ title: "Connect each account once.", copy: "Gmail, Outlook, Slack and Google Calendar connect in Settings → Connections. Notion and Mercury use their own sign-in. Granola uses an API key." }` shown when nothing is connected; no second variant |

Also in `setup-scan-connections.tsx`:
- Line 23: `type NativeBusiness = { mercury?: { available: boolean; requiresSignIn?: boolean } };`
- Remove the finance rows for `paypal`, `stripe`, `instagram`, `tiktok` (they only reported Codex tool presence and had no import).
- Lines 110-118: the "everything else" category now lists Claude entries only; `const via = "Claude";`.
- Line 19 (`WINDOWS_PROMPT`) and line 411 (evidence dialog): replace the sentence saying the OS reads Gmail, Calendar, Slack, Notion, Granola through Codex with "The OS connects to Gmail, Outlook, Slack, Google Calendar, Notion, Mercury and Granola directly from Settings → Connections."

- [ ] **Step 2: Confirm nothing connector-related still says Codex**

Run:
```bash
grep -rnE "(through|via|in|by|to) Codex" src/components/operator src/components/business src/components/brain | grep -viE "chat|model|history|installed|sign(ed)? in to Codex|Claude or Codex|agent"
```
Expected: no output. Read any remaining line and decide by the rule above.

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test scripts` — Expected: clean, 0 fail. Update any test that asserts an old string (`scripts/chat-release.test.ts`, `scripts/business-workspace.test.ts`, `scripts/memory-apps.test.ts` are the likely ones) to the new string from the table.

- [ ] **Step 4: Check in the browser**

Open onboarding scan, Inbox, Calendar connection and Memory. Confirm empty states read correctly with nothing connected, labels fit at narrow width, and no row mentions Codex for a connector.

- [ ] **Step 5: Commit**

```bash
git add -A src scripts
git commit -m "Point connector copy at in-app connections"
```

---

### Task 11: Docs and release checks

**Files:**
- Modify: `docs/ASSISTANT-SETUP.md`, `docs/ADVANCED-ASSISTANT-SETUP.md`, `docs/COMMUNITY-START.md`, `docs/MEMORY-RELEASE.md`, `docs/MEMORY-ARCHITECTURE.md`, `START-HERE.md`, `START-HERE.html`, `public/community-guide.html`, `PRIVACY-AND-SHARING.md`, `CHANGELOG.md`

- [ ] **Step 1: Find the passages**

Run: `grep -nE "Codex" docs/*.md START-HERE.md START-HERE.html public/community-guide.html PRIVACY-AND-SHARING.md`
For each hit apply the Task 10 rule: connector passages are rewritten, Codex-as-AI-tool passages stay.

- [ ] **Step 2: Rewrite connector passages**

Use this wording wherever a doc explains how accounts connect:

> Agentic OS connects to each account itself. Gmail, Outlook, Slack and Google Calendar are connected in Settings → Connections (Google and Outlook need your own OAuth client ID). Notion and Mercury use their own browser sign-in. Granola uses an API key. All of these are read-only. Codex is not needed for any of them.

In `PRIVACY-AND-SHARING.md`, replace any statement that account credentials "stay in Codex" with: "Sign-in tokens for connected accounts are stored only on this computer, in `.operator-data`, readable by your user account only. They are never copied to or from another app."

- [ ] **Step 3: Changelog**

Add at the top of `CHANGELOG.md`, in the file's existing entry format:

> **Connectors no longer go through Codex.** Gmail, Outlook, Slack, Google Calendar and Granola use the app's own connections; Notion and Mercury use their official MCP sign-in. Reconnect each account once in Settings → Connections. Slack now reads the channel you choose instead of searching every channel. The agent-jobs panel no longer lists Codex connector tools.

- [ ] **Step 4: Full verification**

Run each and read the output:
```bash
bun test scripts
bun run typecheck
bun run build
git grep -nE "codex-connected-read|withConnectedRead" -- scripts src
```
Expected: 0 failing tests; typecheck clean; build succeeds; the last command prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A docs START-HERE.md START-HERE.html public/community-guide.html PRIVACY-AND-SHARING.md CHANGELOG.md
git commit -m "Document app-owned connections"
```

---

## Departures from the approved spec

- Routes are `GET /mcp/status`, `POST /mcp/connect` and `POST /mcp/disconnect` with `{ provider }` in the body, not `/mcp/<id>/…`. This matches how `/connections/*` routes already take the provider.
- The client method is `complete(code, state, redirectUri)`, not `finish(url)`, and it takes `scopes`.
- The MCP client, Mercury and Notion come first; mail, calendar and Slack follow. The spec listed mail first. Each task still leaves the suite passing.
- Spec §5 mentions Outlook calendar. The Codex adapter was Google-only and so is this one; Outlook calendar already syncs with the Outlook account in Connections and is unchanged.
- Not in the spec, added here: the setup scan's Codex app inventory is removed (Task 8); the PayPal, Stripe, Instagram and TikTok "found in Codex" rows are removed and the onboarding guide card is rewritten (Task 10).
- Google Calendar now covers all readable calendars instead of the primary one only (Task 7).

## Checked on 2026-10-08, and still to confirm

Public discovery metadata, fetched without signing in: both `mcp.notion.com` and `mcp.mercury.com` name an authorization server on their own host, with `/authorize`, `/token` and `/register` on that host, S256 and the `none` client auth method. Both pass the pinning in Task 1. Mercury advertises `read` and `offline_access` scopes, which Task 2 requests.

Two names in this plan come from each vendor's published MCP tool list rather than from a live session, because listing tools requires a real sign-in:

- Mercury: `getAccounts`, `listTransactions` (Task 2).
- Notion: `notion-list-recent-pages`, `notion-fetch` (Task 3).

If the user signs in during Task 9 and a card reports the connection as connected but unavailable, the server's tool name differs. Read the names with a one-off `read(async ({ tools }) => Object.keys(tools))` after temporarily widening `allowedTools`, update the constant and the tests, and do not ship the widened list.
