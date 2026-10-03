import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createHiggsfieldMcp, HiggsfieldUnlimitedChoiceError } from "./higgsfield-mcp";

const MCP = "https://mcp.higgsfield.ai/mcp";
const ISSUER = "https://clerk.higgsfield.ai";
const CALLBACK = "http://127.0.0.1:8081/api/design/higgsfield/account/callback";
const ID = "aabbbccc-1111-4444-9999-abcdefabcdef";
const NOW = 1_800_000_000_000;
const dirs: string[] = [];
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
const tools = [ ["models_get", "model_id"], ["estimate_image_cost", "params"], ["generate_image", "params"], ["jobs_wait", "jobs"] ].map(([name, property]) => ({ name, inputSchema: { type: "object", properties: { [property]: {} } } }));
const model = { id: "nano_banana_2", output_type: "image", aspect_ratios: ["auto", "1:1", "16:9"], parameters: [{ name: "resolution", type: "string", default: "1k", required: "optional", options: ["1k", "2k", "4k"] }] };
const PNG = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13]);
type Call = { url: string; init: RequestInit; body: any };
function setup(custom?: (call: Call) => Response | undefined | Promise<Response | undefined>, authorized = true) {
  const dir = mkdtempSync(join(tmpdir(), "hf-mcp-test-")); dirs.push(dir); const storePath = join(dir, "oauth.json");
  if (authorized) writeFileSync(storePath, JSON.stringify({ version: 1, client: { id: "own-app-client", redirectUri: CALLBACK }, tokens: { accessToken: "private-own-access-token", refreshToken: "private-own-refresh-token", expiresAt: NOW + 3600_000 } }));
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    let body: any; try { body = JSON.parse(String(init.body)); } catch { body = new URLSearchParams(String(init.body)); }
    const call = { url: String(url), init, body }; calls.push(call);
    const override = await custom?.(call); if (override) return override;
    if (call.url.endsWith("oauth-protected-resource/mcp")) return json({ resource: MCP, authorization_servers: [ISSUER] });
    if (call.url.endsWith("oauth-authorization-server")) return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token`, registration_endpoint: `${ISSUER}/oauth/register`, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    if (call.url.endsWith("oauth/register")) return json({ client_id: "own-app-client", token_endpoint_auth_method: "none", redirect_uris: [CALLBACK] });
    if (call.url.endsWith("oauth/token")) return json({ access_token: "new-private-access-token", refresh_token: "new-private-refresh-token", token_type: "Bearer", expires_in: 3600 });
    if (call.url === MCP) {
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      let result: any;
      if (body.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Higgsfield", version: "1" } };
      else if (body.method === "tools/list") result = { tools };
      else if (body.params.name === "models_get") result = { structuredContent: model };
      else if (body.params.name === "estimate_image_cost") result = { structuredContent: { cost: { credits: 1, credits_exact: 1.5 } } };
      else if (body.params.name === "generate_image") result = { structuredContent: { results: [{ id: ID, status: "pending" }] } };
      else if (body.params.name === "jobs_wait") result = { structuredContent: { jobs: [{ index: 0, job_id: ID, status: "completed", result_url: "https://cdn.higgsfield.ai/image.png" }], all_terminal: true } };
      else throw new Error("Unexpected tool");
      return json({ jsonrpc: "2.0", id: body.id, result }, { headers: { "Mcp-Session-Id": "private-mcp-session" } });
    }
    if (call.url === "https://cdn.higgsfield.ai/image.png") return new Response(PNG, { headers: { "Content-Type": "image/png" } });
    throw new Error("Unexpected URL");
  }) as typeof fetch;
  const adapter = createHiggsfieldMcp({ storePath, fetchImpl, now: () => NOW, sleep: async () => {}, lookupHost: async () => [{ address: "104.16.1.1" }] });
  return { adapter, calls, storePath, fetchImpl };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("Higgsfield app-owned OAuth", () => {
  test("registers a public client, PKCE state is single-use, private credentials never leave status", async () => {
    const { adapter, calls, storePath } = setup(undefined, false);
    const started = await adapter.begin(CALLBACK); const url = new URL(started.authorizationUrl);
    const saved = JSON.parse(readFileSync(storePath, "utf8"));
    expect(url.origin).toBe(ISSUER); expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(saved.pending.verifier).digest("base64url"));
    expect(url.searchParams.has("code_verifier")).toBe(false); expect(statSync(storePath).mode & 0o777).toBe(0o600);
    expect(calls.find(c => c.url.endsWith("oauth/register"))?.body.token_endpoint_auth_method).toBe("none");
    await expect(adapter.complete("code", "bad-state", CALLBACK)).rejects.toMatchObject({ code: "invalid_state" });
    expect(await adapter.complete("one-time-code", saved.pending.state, CALLBACK)).toMatchObject({ connected: true, requiresSignIn: false });
    await expect(adapter.complete("one-time-code", saved.pending.state, CALLBACK)).rejects.toMatchObject({ code: "invalid_state" });
    expect(calls.filter(c => c.url.endsWith("oauth/token"))).toHaveLength(1);
    expect(JSON.stringify(adapter.status())).not.toContain("private");
    expect(calls.every(c => !new Headers(c.init.headers).has("Authorization"))).toBe(true);
    await adapter.disconnect(); expect(adapter.status().connected).toBe(false);
    await expect(adapter.schema()).rejects.toMatchObject({ code: "sign_in_required" });
  });
  test("rejects external callbacks, untrusted discovery, and unsupported client registration", async () => {
    const a = setup(undefined, false);
    await expect(a.adapter.begin("https://evil.example/callback")).rejects.toMatchObject({ code: "invalid_redirect" });
    expect(a.calls).toHaveLength(0);
    const b = setup(c => c.url.endsWith("oauth-authorization-server") ? json({ issuer: ISSUER, token_endpoint: "https://evil.example/token" }) : undefined, false);
    await expect(b.adapter.begin(CALLBACK)).rejects.toMatchObject({ code: "oauth_unsupported" });
    expect(b.calls.some(c => c.url.endsWith("oauth/register"))).toBe(false);
    const d = setup(c => c.url.endsWith("oauth/register") ? json({ error: "blocked" }, { status: 403 }) : undefined, false);
    await expect(d.adapter.begin(CALLBACK)).rejects.toMatchObject({ code: "oauth_unavailable" });
    expect(d.adapter.status().connected).toBe(false);
  });
  test("expired states cannot exchange a code, and failed exchange cannot be replayed", async () => {
    const a = setup(undefined, false); await a.adapter.begin(CALLBACK);
    const saved = JSON.parse(readFileSync(a.storePath, "utf8")); saved.pending.expiresAt = NOW - 1; writeFileSync(a.storePath, JSON.stringify(saved));
    const reopened = createHiggsfieldMcp({ storePath: a.storePath, fetchImpl: a.fetchImpl, now: () => NOW });
    await expect(reopened.complete("code", saved.pending.state, CALLBACK)).rejects.toMatchObject({ code: "invalid_state" });
    const b = setup(c => c.url.endsWith("oauth/token") ? json({ error: "secret-response-text" }, { status: 400 }) : undefined, false);
    const result = await b.adapter.begin(CALLBACK); const state = new URL(result.authorizationUrl).searchParams.get("state")!;
    await expect(b.adapter.complete("code", state, CALLBACK)).rejects.toThrow("HTTP 400");
    await expect(b.adapter.complete("code", state, CALLBACK)).rejects.toMatchObject({ code: "invalid_state" });
    expect(b.calls.filter(c => c.url.endsWith("oauth/token"))).toHaveLength(1);
  });
  test("a rejected refresh clears expired authorization rather than claiming connected", async () => {
    const a = setup(c => c.url.endsWith("oauth/token") ? json({ error: "invalid_grant", detail: "private diagnostic" }, { status: 400 }) : undefined);
    const saved = JSON.parse(readFileSync(a.storePath, "utf8")); saved.tokens.expiresAt = NOW - 1; writeFileSync(a.storePath, JSON.stringify(saved));
    const reopened = createHiggsfieldMcp({ storePath: a.storePath, fetchImpl: a.fetchImpl, now: () => NOW });
    await expect(reopened.schema()).rejects.toMatchObject({ code: "sign_in_required" });
    expect(reopened.status()).toEqual({ connected: false, requiresSignIn: true });
    expect(JSON.parse(readFileSync(a.storePath, "utf8")).tokens).toBeUndefined();
  });
  test("disconnect during token exchange cannot resurrect the app grant", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let exchanging!: () => void;
    const entered = new Promise<void>(resolve => { exchanging = resolve; });
    const a = setup(async c => { if (c.url.endsWith("oauth/token")) { exchanging(); await gate; } }, false);
    const started = await a.adapter.begin(CALLBACK); const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const completion = a.adapter.complete("code", state, CALLBACK);
    await entered; await a.adapter.disconnect(); release();
    await expect(completion).rejects.toMatchObject({ code: "sign_in_required" });
    expect(a.adapter.status().connected).toBe(false);
  });
  test("refreshes its own app grant once for concurrent reads", async () => {
    const a = setup(); const store = JSON.parse(readFileSync(a.storePath, "utf8")); store.tokens.expiresAt = NOW - 1; writeFileSync(a.storePath, JSON.stringify(store));
    const reopened = createHiggsfieldMcp({ storePath: a.storePath, fetchImpl: a.fetchImpl, now: () => NOW });
    await Promise.all([reopened.schema(), reopened.schema()]);
    const refreshes = a.calls.filter(c => c.url.endsWith("oauth/token")); expect(refreshes).toHaveLength(1);
    expect(refreshes[0].body.get("grant_type")).toBe("refresh_token");
    expect(refreshes[0].body.get("refresh_token")).toBe("private-own-refresh-token");
  });
});

describe("Higgsfield native MCP", () => {
  test("native explore and declared cost-only generation are supported without submitting a job", async () => {
    const { adapter, calls } = setup(c => {
      const result = (data: unknown) => json({ jsonrpc: "2.0", id: c.body.id, result: data });
      if (c.body.method === "tools/list") return result({ tools: [
        {name:"models_explore", inputSchema:{properties:{action:{enum:["get"]},model_id:{}}}},
        {name:"generate_image", inputSchema:{properties:{params:{anyOf:[{properties:{get_cost:{type:"boolean"}}},{type:"string"}]}}}},
        {name:"jobs_wait", inputSchema:{properties:{jobs:{}}}},
      ] });
      if (c.body.params?.name === "models_explore") return result({ structuredContent: model });
      if (c.body.params?.name === "generate_image") {
        expect(c.body.params.arguments.params.get_cost).toBe(true);
        return result({ structuredContent: {cost:{credits:2,credits_exact:2.5}} });
      }
    });
    expect(await adapter.estimate({params:{resolution:"1k"}})).toMatchObject({creditsExact:2.5});
    expect(calls.find(c => c.body.params?.name === "models_explore")?.body.params.arguments).toEqual({action:"get",model_id:"nano_banana_2"});
    expect(calls.filter(c => c.body.params?.name === "generate_image")).toHaveLength(1);
  });
  test("initializes, verifies native tools, preserves session and exposes schema and exact credit estimate", async () => {
    const { adapter, calls } = setup();
    expect(await adapter.schema()).toMatchObject({ model: "nano_banana_2", params: [{ name: "aspect_ratio", enum: ["auto", "1:1", "16:9"] }, { name: "resolution", enum: ["1k", "2k", "4k"] }] });
    expect(await adapter.estimate({ params: { resolution: "1k" } })).toMatchObject({ credits: 1, creditsExact: 1.5 });
    expect(calls.filter(c => c.body.method === "initialize")).toHaveLength(1);
    expect(calls.filter(c => c.body.method === "tools/list")).toHaveLength(1);
    const estimated = calls.find(c => c.body.params?.name === "estimate_image_cost")!;
    expect(estimated.body.params.arguments).toEqual({ params: { model: "nano_banana_2", count: 1, aspect_ratio: "1:1", resolution: "1k" } });
    expect(new Headers(estimated.init.headers).get("Mcp-Session-Id")).toBe("private-mcp-session");
    expect(new Headers(estimated.init.headers).get("Authorization")).toBe("Bearer private-own-access-token");
    expect(calls.every(c => c.init.redirect === "error")).toBe(true);
  });
  test("stops before generation when the native tool contract is absent", async () => {
    const { adapter, calls } = setup(c => c.body.method === "tools/list" ? json({ id: c.body.id, result: { tools: [{ name: "generate_image", inputSchema: { properties: { arbitrary: {} } } }] } }) : undefined);
    await expect(adapter.generate({ prompt: "Test" })).rejects.toMatchObject({ code: "tools_unavailable" });
    expect(calls.some(c => c.body.params?.name === "generate_image")).toBe(false);
  });
  test("handles SSE result frames and cancels the response stream without waiting for EOF", async () => {
    let canceled = false;
    const { adapter } = setup(c => {
      if (c.body.params?.name !== "estimate_image_cost") return;
      const payload = JSON.stringify({ id: c.body.id, result: { content: [{ type: "text", text: JSON.stringify({ cost: { credits: 1, credits_exact: 1.5 } }) }] } });
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'));
        controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
      }, cancel() { canceled = true; } }), { headers: { "Content-Type": "text/event-stream" } });
    });
    expect((await adapter.estimate({})).creditsExact).toBe(1.5); expect(canceled).toBe(true);
  });
  test("rejects reference images, extra outputs, and unsupported model options before submission", async () => {
    const { adapter, calls } = setup();
    await expect(adapter.generate({ prompt: "Test", references: ["/private.png"] })).rejects.toMatchObject({ code: "references_unsupported" });
    await expect(adapter.generate({ prompt: "Test", count: 2 })).rejects.toMatchObject({ code: "invalid_count" });
    await expect(adapter.generate({ prompt: "Test", params: { resolution: "8k" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(adapter.generate({ prompt: "Test", params: { model: "other-model" } })).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls.some(c => c.body.params?.name === "generate_image")).toBe(false);
  });
  test("generates once, polls the exact job ID, downloads without credentials and writes only private journal IDs", async () => {
    const { adapter, calls, storePath } = setup();
    const result = await adapter.generate({ prompt: "Private prompt stays out of journal", params: { resolution: "2k", aspect_ratio: "16:9" }, useUnlim: false });
    expect(result.requestIds).toEqual([ID]); expect(result.ext).toBe("png"); expect(result.buf.equals(PNG)).toBe(true);
    expect(calls.filter(c => c.body.params?.name === "generate_image")).toHaveLength(1);
    const waited = calls.find(c => c.body.params?.name === "jobs_wait")!;
    expect(waited.body.params.arguments).toEqual({ jobs: [{ index: 0, job_id: ID }], timeout_seconds: 15 });
    const download = calls.find(c => c.url.startsWith("https://cdn."))!; expect(download.init.headers).toBeUndefined();
    const journal = readFileSync(`${storePath}.requests.json`, "utf8");
    expect(JSON.parse(journal)[0]).toMatchObject({ status: "completed", requestIds: [ID] });
    expect(journal).not.toContain("private"); expect(statSync(`${storePath}.requests.json`).mode & 0o777).toBe(0o600);
  });
  test("never chooses unlimited versus credits on the user's behalf", async () => {
    const { adapter, calls } = setup(c => c.body.params?.name === "generate_image" ? json({ id: c.body.id, result: { structuredContent: { unlim_choice: { model: "nano_banana_2", remaining: 3 } } } }) : undefined);
    await expect(adapter.generate({ prompt: "Test" })).rejects.toBeInstanceOf(HiggsfieldUnlimitedChoiceError);
    expect(calls.filter(c => c.body.params?.name === "generate_image")).toHaveLength(1);
    expect(calls.some(c => c.body.params?.name === "jobs_wait")).toBe(false);
    expect(calls.find(c => c.body.params?.name === "generate_image")!.body.params.arguments.params.use_unlim).toBeUndefined();
  });
  test("uncertain paid submission records an attempt and does not retry or echo provider secrets", async () => {
    const { adapter, calls, storePath } = setup(c => { if (c.body.params?.name === "generate_image") throw new Error("raw-token-secret-network-error"); });
    let failure: any; try { await adapter.generate({ prompt: "Test" }); } catch (error) { failure = error; }
    expect(failure.code).toBe("generation_uncertain"); expect(failure.message).not.toContain("raw-token"); expect(failure.attemptId).toBeString();
    expect(calls.filter(c => c.body.params?.name === "generate_image")).toHaveLength(1);
    expect(JSON.parse(readFileSync(`${storePath}.requests.json`, "utf8"))[0].status).toBe("needs_attention");
  });
  test("journal write failures after acceptance cannot erase the paid job ID", async () => {
    let journal = "";
    const a = setup(c => {
      if (c.body.params?.name === "generate_image") { rmSync(journal); mkdirSync(journal); }
    });
    journal = `${a.storePath}.requests.json`;
    await expect(a.adapter.generate({ prompt: "Test" })).rejects.toMatchObject({ code: "generation_uncertain", requestIds: [ID] });
    expect(a.calls.filter(c => c.body.params?.name === "generate_image")).toHaveLength(1);
  });
  test("preserves accepted IDs on polling failure and abort; recovery does not resubmit", async () => {
    const { adapter, calls, storePath } = setup(c => c.body.params?.name === "jobs_wait" ? new Response("private provider diagnostic", { status: 500 }) : undefined);
    let failure: any; try { await adapter.generate({ prompt: "Test" }); } catch (error) { failure = error; }
    expect(failure.requestIds).toEqual([ID]); expect(failure.message).toContain(ID); expect(failure.message).not.toContain("private provider");
    expect(JSON.parse(readFileSync(`${storePath}.requests.json`, "utf8"))[0].requestIds).toEqual([ID]);
    await expect(adapter.wait([ID])).rejects.toThrow();
    expect(calls.filter(c => c.body.params?.name === "generate_image")).toHaveLength(1);
    const controller = new AbortController(); const b = setup(c => { if (c.body.params?.name === "jobs_wait") { controller.abort(); throw new DOMException("stopped", "AbortError"); } });
    let stopped: any; try { await b.adapter.generate({ prompt: "Test" }, controller.signal); } catch (error) { stopped = error; }
    expect(stopped.name).toBe("AbortError"); expect(stopped.requestIds).toEqual([ID]);
  });
  test("refuses media hosts resolving to private addresses without fetching them", async () => {
    const a = setup();
    const adapter = createHiggsfieldMcp({ storePath: a.storePath, fetchImpl: a.fetchImpl, now: () => NOW, lookupHost: async () => [{ address: "104.16.1.1" }, { address: "127.0.0.1" }] });
    await expect(adapter.generate({ prompt: "Test" })).rejects.toMatchObject({ requestIds: [ID] });
    expect(a.calls.some(c => c.url.startsWith("https://cdn."))).toBe(false);
  });
  test("malformed MCP JSON never exposes the provider response", async () => {
    const a = setup(c => c.body.params?.name === "estimate_image_cost" ? new Response("private-secret-invalid-json", { headers: { "Content-Type": "application/json" } }) : undefined);
    let error: any; try { await a.adapter.estimate({}); } catch (caught) { error = caught; }
    expect(error.code).toBe("invalid_response"); expect(error.message).not.toContain("private-secret");
  });
  test("blocks private asset destinations, invalid image data and oversized responses", async () => {
    const a = setup(c => c.body.params?.name === "jobs_wait" ? json({ id: c.body.id, result: { structuredContent: { jobs: [{ job_id: ID, status: "completed", result_url: "http://127.0.0.1/private" }] } } }) : undefined);
    await expect(a.adapter.generate({ prompt: "Test" })).rejects.toMatchObject({ requestIds: [ID] });
    expect(a.calls.some(c => c.url.startsWith("http:"))).toBe(false);
    const b = setup(c => c.url.startsWith("https://cdn.") ? new Response("<script>not an image</script>", { headers: { "Content-Type": "image/png" } }) : undefined);
    await expect(b.adapter.generate({ prompt: "Test" })).rejects.toMatchObject({ requestIds: [ID] });
    const d = setup(c => c.body.params?.name === "estimate_image_cost" ? json({}, { headers: { "Content-Length": "3000000" } }) : undefined);
    await expect(d.adapter.estimate({})).rejects.toMatchObject({ code: "response_limit" });
  });
});
