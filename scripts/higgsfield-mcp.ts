/** Server-only, app-owned OAuth for Higgsfield's native MCP. No CLI or other-app tokens. */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { publicAddress, type HiggsfieldParam } from "./higgsfield-api";

const MCP = "https://mcp.higgsfield.ai/mcp";
const ISSUER = "https://clerk.higgsfield.ai";
const MODEL = "nano_banana_2";
const SCOPES = "openid email offline_access";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Json = Record<string, any>;
type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };
type Store = {
  version: 1;
  client?: { id: string; redirectUri: string };
  pending?: { state: string; verifier: string; redirectUri: string; expiresAt: number };
  tokens?: Tokens;
};
export type HiggsfieldMcpInput = {
  prompt?: string;
  params?: Record<string, unknown>;
  references?: unknown[];
  count?: number;
  useUnlim?: boolean;
};
export type HiggsfieldMcpRequest = {
  attemptId: string;
  requestIds: string[];
  status: "submitting" | "accepted" | "completed" | "needs_attention";
  updatedAt: number;
};
export class HiggsfieldMcpError extends Error {
  httpStatus?: number;
  constructor(message: string, public code: string, public requestIds: string[] = [], public attemptId?: string) {
    super(message);
    this.name = "HiggsfieldMcpError";
  }
}
export class HiggsfieldUnlimitedChoiceError extends HiggsfieldMcpError {
  constructor(public choice: { model: string; remaining: number | null; expiresAt?: string }) {
    super("Choose whether to use Higgsfield's unlimited allowance or credits. No generation was submitted.", "unlimited_choice");
  }
}
const fail = (message: string, code = "provider_error") => new HiggsfieldMcpError(message, code);
function signalWithTimeout(signal: AbortSignal | undefined, ms: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}
function object(value: unknown): value is Json { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function parseJson(text: string): Json {
  try { const data = JSON.parse(text); if (object(data)) return data; } catch { /* Never include response text in errors. */ }
  throw fail("Higgsfield returned an invalid response.", "invalid_response");
}
function privateWrite(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw fail("The Higgsfield private store must be a regular file.", "private_store");
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}
function redirectUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw fail("Use a loopback OAuth callback URL.", "invalid_redirect"); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.port || url.username || url.password || url.hash || url.search)
    throw fail("Use an HTTP loopback OAuth callback with an explicit port and no query string.", "invalid_redirect");
  return url.href;
}
async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length") || 0) > limit) throw fail("Higgsfield response exceeds the size limit.", "response_limit");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw fail("Higgsfield response exceeds the size limit.", "response_limit");
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}
/** Stop reading SSE as soon as this RPC's result arrives, even when the stream stays open. */
async function rpcBody(response: Response, id: string): Promise<Json> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = parseJson((await boundedBody(response, 2_000_000)).toString("utf8"));
    if (data.id !== id) throw fail("Higgsfield returned an unrelated MCP response.", "invalid_response");
    return data;
  }
  if (!response.body) throw fail("Higgsfield returned an empty MCP response.", "invalid_response");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = ""; let bytes = 0;
  const event = (frame: string): Json | null => {
    const lines = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, ""));
    if (!lines.length) return null;
    const data = parseJson(lines.join("\n"));
    return data.id === id ? data : null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { const last = event(buffered); if (last) return last; break; }
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw fail("Higgsfield MCP response exceeds the size limit.", "response_limit");
      buffered += decoder.decode(value, { stream: true });
      while (true) {
        const split = /\r?\n\r?\n/.exec(buffered); if (!split) break;
        const frame = buffered.slice(0, split.index); buffered = buffered.slice(split.index + split[0].length);
        const data = event(frame); if (data) return data;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  throw fail("Higgsfield returned no matching MCP response.", "invalid_response");
}
function toolData(result: Json): Json {
  if (result.isError) throw fail("Higgsfield rejected the tool request. Check the selected settings and account connection.", "tool_error");
  if (object(result.structuredContent)) return result.structuredContent;
  for (const block of Array.isArray(result.content) ? result.content : []) {
    if (block.type === "text" && typeof block.text === "string") {
      try { return parseJson(block.text); } catch { /* Skip non-JSON tool annotations. */ }
    }
  }
  throw fail("Higgsfield returned no structured tool result.", "invalid_response");
}
function safeAdjustments(value: unknown): Json | undefined {
  if (!object(value)) return undefined;
  const out: Json = {};
  for (const [key, item] of Object.entries(value).slice(0, 15)) {
    if (!/^[a-z_]{1,40}$/.test(key) || !object(item)) continue;
    if ([item.requested, item.used].every(v => ["string", "number", "boolean"].includes(typeof v) && String(v).length < 120))
      out[key] = { requested: item.requested, used: item.used, reason: "Higgsfield adjusted this setting." };
  }
  return Object.keys(out).length ? out : undefined;
}

export function createHiggsfieldMcp(options: {
  storePath: string;
  requestLogPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  lookupHost?: (hostname: string) => Promise<Array<{ address: string }>>;
}) {
  const fetcher = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const resolveHost = options.lookupHost ?? ((host: string) => lookup(host, { all: true }));
  const pause = options.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Stopped waiting for Higgsfield.", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  }));
  let epoch = 0;
  let store: Store = { version: 1 };
  if (existsSync(options.storePath)) {
    if (!lstatSync(options.storePath).isFile() || lstatSync(options.storePath).size > 100_000)
      throw fail("The Higgsfield private store is invalid.", "private_store");
    try { const data = parseJson(readFileSync(options.storePath, "utf8")); if (data.version === 1) store = data as Store; }
    catch { throw fail("The Higgsfield private store could not be read.", "private_store"); }
    chmodSync(options.storePath, 0o600);
  }
  const persist = () => privateWrite(options.storePath, store);
  const logPath = options.requestLogPath ?? `${options.storePath}.requests.json`;
  let sessionId: string | undefined;
  let protocol = "2025-06-18";
  let initialization: Promise<void> | undefined;
  let refreshing: Promise<string> | undefined;
  let modelTool = "models_get";
  let separateEstimate = true;
  function status() {
    const tokens = store.tokens;
    const connected = Boolean(tokens?.accessToken && (tokens.expiresAt > now() || tokens.refreshToken));
    return { connected, requiresSignIn: !connected, ...(tokens ? { expiresAt: tokens.expiresAt } : {}) };
  }
  async function jsonFetch(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Json> {
    try {
      const response = await fetcher(url, { ...init, redirect: "error", signal: signalWithTimeout(signal, 20_000) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const error = fail(`Higgsfield connection failed (HTTP ${response.status}).`, response.status === 401 ? "sign_in_required" : "oauth_unavailable");
        error.httpStatus = response.status;
        throw error;
      }
      return parseJson((await boundedBody(response, 150_000)).toString("utf8"));
    } catch (error) {
      if (error instanceof HiggsfieldMcpError) throw error;
      if (signal?.aborted) throw new DOMException("Higgsfield connection was stopped.", "AbortError");
      throw fail("Higgsfield connection is unavailable. Try sign-in again.", "oauth_unavailable");
    }
  }
  async function discover() {
    const [resource, auth] = await Promise.all([
      jsonFetch("https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp"),
      jsonFetch(`${ISSUER}/.well-known/oauth-authorization-server`),
    ]);
    if (resource.resource !== MCP || !resource.authorization_servers?.includes(ISSUER) || auth.issuer !== ISSUER ||
      auth.authorization_endpoint !== `${ISSUER}/oauth/authorize` || auth.token_endpoint !== `${ISSUER}/oauth/token` ||
      auth.registration_endpoint !== `${ISSUER}/oauth/register` || !auth.code_challenge_methods_supported?.includes("S256") ||
      !auth.token_endpoint_auth_methods_supported?.includes("none"))
      throw fail("Higgsfield does not currently advertise the required app-owned OAuth flow.", "oauth_unsupported");
  }
  let beginning = false;
  async function begin(redirectUri: string) {
    if (beginning) throw fail("Higgsfield sign-in is already being prepared.", "oauth_in_progress");
    beginning = true; const startedEpoch = epoch;
    try {
      const callback = redirectUrl(redirectUri); await discover();
      if (!store.client || store.client.redirectUri !== callback) {
        const client = await jsonFetch(`${ISSUER}/oauth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_name: "Agentic OS", redirect_uris: [callback], token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: SCOPES }),
        });
        if (typeof client.client_id !== "string" || !client.client_id || client.client_id.length > 1000 || client.client_secret ||
          (client.token_endpoint_auth_method && client.token_endpoint_auth_method !== "none") ||
          (client.redirect_uris && !client.redirect_uris.includes(callback)))
          throw fail("Higgsfield could not register a public local client. App sign-in is unavailable.", "registration_unsupported");
        if (epoch !== startedEpoch) throw fail("Higgsfield sign-in was disconnected.", "sign_in_required");
        store.client = { id: client.client_id, redirectUri: callback };
      }
      if (epoch !== startedEpoch) throw fail("Higgsfield sign-in was disconnected.", "sign_in_required");
      const state = randomBytes(32).toString("base64url"); const verifier = randomBytes(48).toString("base64url");
      const expiresAt = now() + 10 * 60_000;
      store.pending = { state, verifier, redirectUri: callback, expiresAt }; persist();
      const url = new URL(`${ISSUER}/oauth/authorize`);
      url.search = new URLSearchParams({ response_type: "code", client_id: store.client.id, redirect_uri: callback,
        scope: SCOPES, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256", resource: MCP }).toString();
      return { authorizationUrl: url.href, expiresAt };
    } finally { beginning = false; }
  }
  function tokensFrom(data: Json): Tokens {
    if (typeof data.access_token !== "string" || !/^[\x21-\x7e]{8,32000}$/.test(data.access_token) ||
      String(data.token_type).toLowerCase() !== "bearer" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      (data.refresh_token != null && (typeof data.refresh_token !== "string" || !/^[\x21-\x7e]{8,32000}$/.test(data.refresh_token))))
      throw fail("Higgsfield returned an invalid authorization grant.", "invalid_grant");
    return { accessToken: data.access_token, refreshToken: data.refresh_token,
      expiresAt: now() + Math.min(data.expires_in, 365 * 86400) * 1000 };
  }
  async function tokenRequest(fields: Record<string, string>) {
    return jsonFetch(`${ISSUER}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
  }
  async function complete(code: string, state: string, redirectUri: string) {
    const callback = redirectUrl(redirectUri); const pending = store.pending; const startedEpoch = epoch;
    if (!pending || pending.state !== state || pending.redirectUri !== callback || pending.expiresAt <= now() || !store.client ||
      typeof code !== "string" || !code || code.length > 4000)
      throw fail("Higgsfield sign-in expired or did not match this app. Start sign-in again.", "invalid_state");
    // Consume before network I/O: replayed callbacks cannot redeem twice.
    delete store.pending; persist();
    const data = await tokenRequest({ grant_type: "authorization_code", client_id: store.client.id, code,
      redirect_uri: callback, code_verifier: pending.verifier, resource: MCP });
    const tokens = tokensFrom(data);
    if (epoch !== startedEpoch) throw fail("Higgsfield sign-in was disconnected.", "sign_in_required");
    store.tokens = tokens; sessionId = undefined; initialization = undefined; persist(); return status();
  }
  async function disconnect() {
    ++epoch; store = { version: 1 }; sessionId = undefined; initialization = undefined;
    rmSync(options.storePath, { force: true });
    return status();
  }
  async function accessToken(): Promise<string> {
    if (store.tokens?.accessToken && store.tokens.expiresAt > now() + 30_000) return store.tokens.accessToken;
    if (!store.tokens?.refreshToken || !store.client) throw fail("Connect your Higgsfield account to use Nano Banana 2.", "sign_in_required");
    if (!refreshing) {
      const startedEpoch = epoch; const previous = store.tokens; const clientId = store.client.id;
      refreshing = (async () => {
        const data = await tokenRequest({ grant_type: "refresh_token", client_id: clientId, refresh_token: previous.refreshToken!, resource: MCP });
        const tokens = tokensFrom(data); tokens.refreshToken ||= previous.refreshToken;
        if (epoch !== startedEpoch) throw fail("Higgsfield was disconnected.", "sign_in_required");
        store.tokens = tokens; persist(); return tokens.accessToken;
      })().catch(error => {
        if (error instanceof HiggsfieldMcpError && [400, 401, 403].includes(error.httpStatus ?? 0) && epoch === startedEpoch) {
          delete store.tokens; sessionId = undefined; initialization = undefined; persist();
          throw fail("Your Higgsfield sign-in expired. Connect your account again.", "sign_in_required");
        }
        throw error;
      }).finally(() => { refreshing = undefined; });
    }
    return refreshing;
  }
  async function rpc(method: string, params: Json, signal?: AbortSignal, notification = false): Promise<Json> {
    const startedEpoch = epoch; const token = await accessToken(); const id = randomUUID();
    if (epoch !== startedEpoch) throw fail("Higgsfield was disconnected.", "sign_in_required");
    const response = await fetcher(MCP, { method: "POST", redirect: "error", signal: signalWithTimeout(signal, method === "tools/call" ? 60_000 : 20_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": protocol, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([401, 403, 404].includes(response.status)) { sessionId = undefined; initialization = undefined; }
      throw fail(`Higgsfield MCP request failed (HTTP ${response.status}).`, response.status === 401 ? "sign_in_required" : "mcp_http_error");
    }
    const nextSession = response.headers.get("mcp-session-id");
    if (nextSession && /^[\x21-\x7e]{1,1000}$/.test(nextSession)) sessionId = nextSession;
    if (notification) { await response.body?.cancel().catch(() => {}); return {}; }
    const data = await rpcBody(response, id);
    if (data.error || !object(data.result)) throw fail("Higgsfield could not complete the MCP request.", "mcp_error");
    return data.result;
  }
  async function initialize(signal?: AbortSignal) {
    if (!initialization) initialization = (async () => {
      const data = await rpc("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "Agentic OS", version: "3.6.0" } }, signal);
      if (!["2025-06-18", "2025-03-26", "2024-11-05"].includes(data.protocolVersion))
        throw fail("Higgsfield negotiated an unsupported MCP version.", "protocol_unsupported");
      protocol = data.protocolVersion;
      await rpc("notifications/initialized", {}, signal, true);
      // Resolve exact native tool names, without trusting connector name prefixes.
      const required: Record<string, string> = { generate_image: "params", jobs_wait: "jobs" };
      let modelFound = false, estimateFound = false, safeCostFlag = false;
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const listed = await rpc("tools/list", cursor ? { cursor } : {}, signal);
        for (const tool of Array.isArray(listed.tools) ? listed.tools : []) {
          const props = tool.inputSchema?.properties;
          if (object(props)) {
            if (tool.name === "models_get" && props.model_id) { modelTool = "models_get"; modelFound = true; }
            if (tool.name === "models_explore" && !modelFound && props.model_id && props.action?.enum?.includes("get")) { modelTool = "models_explore"; modelFound = true; }
            if (tool.name === "estimate_image_cost" && props.params) estimateFound = true;
            if (tool.name === "generate_image") {
              const schemas = [props.params, ...(props.params?.anyOf || [])];
              safeCostFlag = schemas.some(part => part?.properties?.get_cost?.type === "boolean");
            }
          }
          if (Object.hasOwn(required, tool.name) && object(tool.inputSchema?.properties) && Object.hasOwn(tool.inputSchema.properties, required[tool.name]))
            delete required[tool.name];
        }
        if (!Object.keys(required).length && modelFound && (estimateFound || safeCostFlag)) break;
        cursor = typeof listed.nextCursor === "string" && listed.nextCursor.length <= 1000 ? listed.nextCursor : undefined;
        if (!cursor) break;
      }
      if (Object.keys(required).length || !modelFound || (!estimateFound && !safeCostFlag)) throw fail("Higgsfield's native MCP does not expose the required Nano Banana 2 tools and inputs.", "tools_unavailable");
      separateEstimate = estimateFound;
    })().catch(error => {
      initialization = undefined; sessionId = undefined;
      if (error instanceof HiggsfieldMcpError) throw error;
      if (signal?.aborted) throw new DOMException("Higgsfield connection was stopped.", "AbortError");
      throw fail("Higgsfield MCP connection is unavailable.", "mcp_transport_error");
    });
    return initialization;
  }
  async function call(name: string, args: Json, signal?: AbortSignal) {
    await initialize(signal);
    try { return toolData(await rpc("tools/call", { name, arguments: args }, signal)); }
    catch (error) {
      if (error instanceof HiggsfieldMcpError) throw error;
      if (signal?.aborted) throw new DOMException("Stopped waiting for Higgsfield.", "AbortError");
      throw fail("Higgsfield's tool response could not be confirmed.", "mcp_transport_error");
    }
  }
  let modelCache: { data: Json; at: number } | undefined;
  async function schema(signal?: AbortSignal) {
    if (!modelCache || modelCache.at < now() - 10 * 60_000) {
      await initialize(signal);
      const data = await call(modelTool, { ...(modelTool === "models_explore" ? { action: "get" } : {}), model_id: MODEL }, signal);
      if (data.error || data.id !== MODEL || data.output_type !== "image") throw fail("Nano Banana 2 is not available through this Higgsfield connection.", "model_unavailable");
      modelCache = { data, at: now() };
    }
    const data = modelCache.data;
    const params: HiggsfieldParam[] = [];
    const ratios = Array.isArray(data.aspect_ratios) ? data.aspect_ratios.filter((v: unknown) => typeof v === "string" && /^(auto|\d+:\d+)$/.test(v as string)) : [];
    if (ratios.length) params.push({ name: "aspect_ratio", type: "string", default: ratios.includes("1:1") ? "1:1" : ratios[0], required: false, enum: ratios });
    for (const item of Array.isArray(data.parameters) ? data.parameters : []) {
      if (item.name !== "resolution" || !Array.isArray(item.options)) continue;
      const values = item.options.filter((v: unknown) => ["1k", "2k", "4k"].includes(String(v))).map(String);
      if (values.length) params.push({ name: "resolution", type: "string", default: values.includes(item.default) ? item.default : values[0], required: item.required === "required", enum: values });
    }
    if (!params.some(p => p.name === "resolution")) throw fail("Higgsfield did not return Nano Banana 2 resolution settings.", "invalid_schema");
    return { model: MODEL, params };
  }
  async function input(input: HiggsfieldMcpInput, requirePrompt: boolean, signal?: AbortSignal) {
    if (input.references != null && (!Array.isArray(input.references) || input.references.length)) throw fail("Reference images are not supported by this Higgsfield connection yet. Remove them before generating.", "references_unsupported");
    if (input.count != null && input.count !== 1) throw fail("Generate one Nano Banana 2 image at a time.", "invalid_count");
    if (input.useUnlim != null && typeof input.useUnlim !== "boolean") throw fail("Choose an explicit Higgsfield allowance option.", "invalid_input");
    if (requirePrompt && (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 30_000)) throw fail("Enter an image prompt up to 30,000 characters.", "invalid_prompt");
    if (input.prompt != null && (typeof input.prompt !== "string" || input.prompt.length > 30_000)) throw fail("The image prompt is invalid.", "invalid_prompt");
    const spec = await schema(signal); const given = input.params ?? {};
    if (!object(given) || Object.keys(given).some(k => !spec.params.some(p => p.name === k))) throw fail("Unsupported Nano Banana 2 setting.", "invalid_input");
    const params: Json = { model: MODEL, count: 1 };
    for (const param of spec.params) {
      const value = given[param.name] ?? param.default;
      if (!param.enum?.includes(String(value))) throw fail(`Unsupported Nano Banana 2 ${param.name}.`, "invalid_input");
      params[param.name] = value;
    }
    if (input.prompt) params.prompt = input.prompt;
    if (input.useUnlim != null) params.use_unlim = input.useUnlim;
    return params;
  }
  async function estimate(request: HiggsfieldMcpInput, signal?: AbortSignal) {
    const params = await input(request, false, signal);
    // Older native MCP exposes read-only pricing as an explicitly declared
    // get_cost flag. Never fall back to an ordinary generation for a quote.
    const data = await call(separateEstimate ? "estimate_image_cost" : "generate_image", { params: separateEstimate ? params : { ...params, get_cost: true } }, signal);
    if (data.error || !object(data.cost) || !Number.isFinite(data.cost.credits_exact) || data.cost.credits_exact < 0 || !Number.isFinite(data.cost.credits) || data.cost.credits < 0)
      throw fail("Higgsfield could not provide a credit estimate for these settings.", "estimate_unavailable");
    return { credits: data.cost.credits as number, creditsExact: data.cost.credits_exact as number, adjustments: safeAdjustments(data.adjustments) };
  }
  function record(attemptId: string, requestIds: string[], status: HiggsfieldMcpRequest["status"]) {
    let rows: HiggsfieldMcpRequest[] = [];
    try {
      if (lstatSync(logPath).isFile() && lstatSync(logPath).size <= 100_000) {
        const value = JSON.parse(readFileSync(logPath, "utf8")); if (Array.isArray(value)) rows = value.slice(0, 100);
      }
    } catch { /* New journal. */ }
    privateWrite(logPath, [{ attemptId, requestIds, status, updatedAt: now() }, ...rows.filter(r => r.attemptId !== attemptId)].slice(0, 100));
  }
  async function download(raw: unknown, signal?: AbortSignal) {
    let url: URL;
    try { url = new URL(String(raw)); } catch { throw fail("Higgsfield returned no image URL.", "invalid_image_url"); }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !url.hostname.includes(".") ||
      url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":"))
      throw fail("Higgsfield returned an unsafe image URL.", "invalid_image_url");
    const addresses = await new Promise<Array<{ address: string }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(fail("Higgsfield image host lookup timed out.", "download_failed")), 10_000);
      resolveHost(url.hostname).then(resolve, () => reject(fail("Higgsfield image host could not be resolved.", "download_failed"))).finally(() => clearTimeout(timer));
    });
    signal?.throwIfAborted();
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw fail("Higgsfield image host is not public.", "invalid_image_url");
    // No session, cookie, bearer or OAuth key is ever forwarded to the image host.
    const response = await fetcher(url, { redirect: "error", signal: signalWithTimeout(signal, 60_000) });
    if (!response.ok) throw fail("The Higgsfield image could not be downloaded.", "download_failed");
    const buf = await boundedBody(response, 30_000_000);
    const ext = buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png" :
      buf[0] === 255 && buf[1] === 216 && buf[2] === 255 ? "jpg" :
      buf.subarray(0,4).toString() === "RIFF" && buf.subarray(8,12).toString() === "WEBP" ? "webp" : null;
    if (!ext) throw fail("Higgsfield returned unsupported image data.", "invalid_image");
    return { buf, ext };
  }
  async function wait(requestIds: string[], signal?: AbortSignal) {
    if (requestIds.length !== 1 || !UUID.test(requestIds[0])) throw fail("A valid Higgsfield job ID is required.", "invalid_job");
    const deadline = now() + 8 * 60_000;
    for (let poll = 0; poll < 100 && now() < deadline; poll++) {
      signal?.throwIfAborted();
      const data = await call("jobs_wait", { jobs: [{ index: 0, job_id: requestIds[0] }], timeout_seconds: 15 }, signal);
      const job = Array.isArray(data.jobs) ? data.jobs.find((j: Json) => j.job_id === requestIds[0]) : null;
      if (!job) throw fail("Higgsfield did not return this job's status.", "invalid_job_result");
      if (job.status === "completed") return { ...await download(job.result_url, signal), requestIds };
      if (["failed", "canceled", "nsfw", "ip_detected"].includes(job.status) || (job.status === "lookup_failed" && !job.retryable))
        throw fail("Higgsfield could not complete this image. Check the job in your Higgsfield account.", "job_failed");
      await pause(Math.max(1000, Math.min(10_000, Number(data.poll_after_seconds || 2) * 1000)), signal);
    }
    throw fail("Higgsfield is still processing this image. Check the existing job before retrying.", "job_pending");
  }
  async function generate(request: HiggsfieldMcpInput & { prompt: string }, signal?: AbortSignal) {
    const params = await input(request, true, signal); await initialize(signal); signal?.throwIfAborted();
    const attemptId = randomUUID(); let requestIds: string[] = []; let dispatched = false;
    record(attemptId, requestIds, "submitting");
    try {
      // Exactly one paid call. A timeout is an uncertain submission, never a retry signal.
      dispatched = true;
      const data = await call("generate_image", { params }, signal);
      if (data.unlim_choice) {
        record(attemptId, [], "completed");
        throw new HiggsfieldUnlimitedChoiceError({ model: MODEL,
          remaining: Number.isFinite(data.unlim_choice.remaining) ? data.unlim_choice.remaining : null,
          ...(typeof data.unlim_choice.expires_at === "string" ? { expiresAt: data.unlim_choice.expires_at.slice(0, 50) } : {}) });
      }
      const results = Array.isArray(data.results) ? data.results : [];
      requestIds = results.map((r: Json) => r.id).filter((id: unknown) => typeof id === "string" && UUID.test(id));
      if (requestIds.length) record(attemptId, requestIds, "accepted");
      if (data.error || requestIds.length !== 1) throw fail("Higgsfield did not confirm one image job. Check your account before retrying.", "submission_unknown");
      const result = await wait(requestIds, signal);
      record(attemptId, requestIds, "completed");
      return { ...result, adjustments: safeAdjustments(data.adjustments) };
    } catch (error) {
      if (error instanceof HiggsfieldUnlimitedChoiceError) throw error;
      if (dispatched) {
        try { record(attemptId, requestIds, "needs_attention"); }
        catch { /* A journal write failure must not erase accepted job IDs from the error. */ }
      }
      const detail = requestIds.length ? ` Job ${requestIds.join(", ")}.` : ` Attempt ${attemptId}.`;
      const wrapped = new HiggsfieldMcpError(`The Higgsfield generation could not be confirmed.${detail} Check Higgsfield before retrying; this request was not resubmitted.`, "generation_uncertain", requestIds, attemptId);
      if (signal?.aborted) wrapped.name = "AbortError";
      throw wrapped;
    }
  }
  return { begin, complete, status, disconnect, discover, schema, estimate, generate, wait };
}
