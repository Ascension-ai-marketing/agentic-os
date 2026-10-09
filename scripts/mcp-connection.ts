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
