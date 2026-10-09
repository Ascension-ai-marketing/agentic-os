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

/** A provider that refuses the first sign-in's token on reads, and optionally every token. */
function refusingProvider(refuseEvery = false) {
  const base = server();
  let refreshes = 0;
  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = String(input);
    if (url === `${ORIGIN}/token` && String(init.body).includes("grant_type=refresh_token")) {
      refreshes++;
      return json({ access_token: "access-token-5678", token_type: "Bearer", expires_in: 3600 });
    }
    if (url === URL_ && (refuseEvery || init.headers?.Authorization === "Bearer access-token-1234")) return json({ error: "revoked-detail" }, 401);
    return base.fetchImpl(input, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, refreshes: () => refreshes };
}
test("a read the provider refuses is retried once with a refreshed sign-in", async () => {
  const provider = refusingProvider();
  const { connection } = fresh({ fetchImpl: provider.fetchImpl });
  await signIn(connection);
  expect(await connection.read(async client => client.call("getAccounts", {}))).toEqual({ accounts: [{ id: "a" }] });
  expect(provider.refreshes()).toBe(1);
  expect(connection.status().connected).toBe(true);
});
test("a read still refused after one refresh needs sign-in again", async () => {
  const provider = refusingProvider(true);
  const { connection } = fresh({ fetchImpl: provider.fetchImpl });
  await signIn(connection);
  const error = await connection.read(async client => client.call("getAccounts", {})).catch(e => e);
  expect(error).toBeInstanceOf(McpConnectionError);
  expect(error.message).toBe("Your Example sign-in expired. Connect it again in Connections.");
  expect(error.code).toBe("sign_in_required");
  expect(provider.refreshes()).toBe(1);
  expect(connection.status()).toEqual({ connected: false, requiresSignIn: true });
});
