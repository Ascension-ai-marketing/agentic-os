import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voiceCompanion, VOICE_CLIENT_TOOLS } from "./voice-companion";

let root: string;
const apiKey = "sk_unit_test_only_no_real_credentials";
const agentId = "agent_companion_fixture";
const voiceId = "voice_british_fixture";
const signedUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}&conversation_signature=fixture`;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentic-voice-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
const configPath = () => join(root, ".operator-data/voice-companion.json");
const read = () => JSON.parse(readFileSync(configPath(), "utf8"));
function saved(config: object) {
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config), { mode: 0o600 });
}
function privateAgent() {
  return {
    agent_id: agentId,
    platform_settings: { auth: { enable_auth: true } },
    conversation_config: {
      tts: { voice_id: voiceId },
      agent: { prompt: { tool_ids: [], tools: structuredClone(VOICE_CLIENT_TOOLS) } },
    },
  };
}
function provider(options: { agent?: any; failCreation?: number; signed?: string } = {}) {
  const calls: { path: string; method: string; body?: any }[] = [];
  const fetcher = (async (input: any, init: any) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.elevenlabs.io");
    expect(init.headers["xi-api-key"]).toBe(apiKey);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname + url.search, method: init.method, body });
    if (url.pathname === "/v2/voices")
      return Response.json({
        voices: [
          {
            voice_id: "voice_us_fixture",
            name: "American",
            labels: { accent: "american", gender: "male" },
          },
          {
            voice_id: voiceId,
            name: "British fixture",
            description: "Calm and warm",
            labels: { accent: "british", gender: "male" },
          },
        ],
      });
    if (url.pathname === `/v1/voices/${voiceId}`)
      return Response.json({ voice_id: voiceId, name: "British fixture" });
    if (url.pathname === `/v1/convai/agents/${agentId}`)
      return Response.json(options.agent || privateAgent());
    if (url.pathname === "/v1/convai/tools" && init.method === "POST")
      return Response.json({ id: "tool_" + body.tool_config.name });
    if (url.pathname.startsWith("/v1/convai/tools/") && init.method === "GET") {
      const name = url.pathname.slice("/v1/convai/tools/tool_".length);
      return Response.json({ tool_config: VOICE_CLIENT_TOOLS.find((tool) => tool.name === name) });
    }
    if (url.pathname === "/v1/convai/agents/create") {
      if (options.failCreation)
        return new Response("secret provider detail must not be exposed", {
          status: options.failCreation,
        });
      return Response.json({ agent_id: agentId });
    }
    if (url.pathname === "/v1/convai/conversation/get-signed-url") {
      expect(url.searchParams.get("agent_id")).toBe(agentId);
      expect(url.searchParams.get("include_conversation_id")).toBe("true");
      return Response.json({ signed_url: options.signed ?? signedUrl });
    }
    throw new Error("Unexpected test request");
  }) as typeof fetch;
  return { calls, fetcher };
}

test("status discovers only named credentials without contacting the provider or exposing secrets", () => {
  mkdirSync(join(root, ".hermes"));
  writeFileSync(
    join(root, ".hermes/.env"),
    `UNRELATED_SECRET=never-read-as-key\nexport ELEVEN_LABS_API_KEY='${apiKey}' # local\n`,
  );
  let calls = 0;
  const companion = voiceCompanion(root, {
    home: root,
    env: {},
    fetch: (async () => {
      calls++;
      throw new Error();
    }) as typeof fetch,
  });
  expect(companion.status()).toMatchObject({
    apiKeyConfigured: true,
    configured: false,
    toolsReady: false,
    setupRequired: true,
  });
  expect(JSON.stringify(companion.status())).not.toContain(apiKey);
  expect(calls).toBe(0);
  const absent = voiceCompanion(root, {
    home: join(root, "empty"),
    env: { SOME_OTHER_API_KEY: apiKey },
  });
  expect(absent.status().apiKeyConfigured).toBe(false);
});

test("explicit setup creates private dedicated resources, awaits tool results, and saves credentials privately", async () => {
  const { fetcher, calls } = provider();
  const companion = voiceCompanion(root, { home: root, env: {}, fetch: fetcher });
  const result = await companion.handle("/voice/configure", { apiKey });
  expect(result).toMatchObject({
    ok: true,
    created: true,
    configured: true,
    voiceId,
    voiceName: "British fixture",
  });
  expect(JSON.stringify(result)).not.toContain(apiKey);
  expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  const creation = calls.find((call) => call.path === "/v1/convai/agents/create")!.body;
  expect(creation.platform_settings.auth.enable_auth).toBe(true);
  expect(creation.platform_settings.privacy.record_voice).toBe(false);
  expect(creation.conversation_config.tts.voice_id).toBe(voiceId);
  expect(creation.conversation_config.agent.prompt.tool_ids).toEqual([
    "tool_navigate",
    "tool_search_memory",
    "tool_ask_workspace",
  ]);
  expect(calls.filter((call) => call.path === "/v1/convai/tools")).toHaveLength(3);
  for (const call of calls.filter((call) => call.path === "/v1/convai/tools"))
    expect(call.body.tool_config.expects_response).toBe(true);
  expect(calls.some((call) => call.path.includes("get-signed-url"))).toBe(false);
  expect(read().pendingCreation).toBeUndefined();
  await companion.handle("/voice/configure", {});
  expect(calls.filter((call) => call.path === "/v1/convai/agents/create")).toHaveLength(1);
  expect(await companion.handle("/voice/session")).toMatchObject({
    signedUrl,
    connectionType: "websocket",
    agentId,
  });
});

test("an existing private agent is verified and never overwritten or silently changed", async () => {
  const agent = privateAgent();
  agent.conversation_config.agent.prompt.tools = [] as any;
  agent.conversation_config.agent.prompt.tool_ids = VOICE_CLIENT_TOOLS.map(
    (tool) => "tool_" + tool.name,
  ) as any;
  const { fetcher, calls } = provider({ agent });
  const companion = voiceCompanion(root, {
    env: { ELEVENLABS_API_KEY: apiKey },
    home: root,
    fetch: fetcher,
  });
  expect(await companion.handle("/voice/configure", { agentId })).toMatchObject({
    created: false,
    configured: true,
  });
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  await expect(
    companion.handle("/voice/configure", { agentId, voiceId: "different_voice" }),
  ).rejects.toThrow("never overwritten");
  expect(read().voiceId).toBe(voiceId);
});

test("existing agents with external actions or missing wait-for-response tools are rejected", async () => {
  const bad = privateAgent();
  bad.conversation_config.agent.prompt.tools.push({ type: "webhook", name: "send_email" } as any);
  const one = provider({ agent: bad });
  await expect(
    voiceCompanion(root, { env: {}, home: root, fetch: one.fetcher }).handle("/voice/configure", {
      apiKey,
      agentId,
    }),
  ).rejects.toThrow("other actions");
  expect(one.calls.every((call) => call.method === "GET")).toBe(true);
  const missing = privateAgent();
  missing.conversation_config.agent.prompt.tools[0].expects_response = false;
  const two = provider({ agent: missing });
  await expect(
    voiceCompanion(root, { env: {}, home: root, fetch: two.fetcher }).handle("/voice/configure", {
      apiKey,
      agentId,
    }),
  ).rejects.toThrow("Wait for response");
  const publicAgent = privateAgent();
  publicAgent.platform_settings.auth.enable_auth = false;
  const three = provider({ agent: publicAgent });
  await expect(
    voiceCompanion(root, { env: {}, home: root, fetch: three.fetcher }).handle("/voice/configure", {
      apiKey,
      agentId,
    }),
  ).rejects.toThrow("Enable authentication");
});

test("uncertain creation blocks automatic retries and can recover by verifying the returned agent ID", async () => {
  const first = provider({ failCreation: 503 });
  const companion = voiceCompanion(root, { env: {}, home: root, fetch: first.fetcher });
  await expect(companion.handle("/voice/configure", { apiKey })).rejects.toThrow(
    "could not complete",
  );
  expect(companion.status()).toMatchObject({ setupUncertain: true, configured: false });
  expect(read().toolIds).toEqual({
    navigate: "tool_navigate",
    search_memory: "tool_search_memory",
    ask_workspace: "tool_ask_workspace",
  });
  await expect(companion.handle("/voice/configure", { apiKey })).rejects.toThrow(
    "may have created",
  );
  expect(first.calls.filter((call) => call.path === "/v1/convai/agents/create")).toHaveLength(1);
  await expect(companion.handle("/voice/session")).rejects.toThrow("Set up");
  const recovered = provider();
  const restored = voiceCompanion(root, { env: {}, home: root, fetch: recovered.fetcher });
  expect(await restored.handle("/voice/configure", { agentId })).toMatchObject({
    configured: true,
    created: false,
  });
  expect(restored.status().setupUncertain).toBe(false);
});

test("definite provider validation failure can retry while reusing already created tools", async () => {
  const first = provider({ failCreation: 422 });
  await expect(
    voiceCompanion(root, { env: {}, home: root, fetch: first.fetcher }).handle("/voice/configure", {
      apiKey,
    }),
  ).rejects.toThrow("configuration");
  expect(read().pendingCreation).toBeUndefined();
  const second = provider();
  expect(
    await voiceCompanion(root, { env: {}, home: root, fetch: second.fetcher }).handle(
      "/voice/configure",
      {},
    ),
  ).toMatchObject({ created: true });
  expect(second.calls.filter((call) => call.path === "/v1/convai/tools")).toHaveLength(0);
});

test("session URLs stay on ElevenLabs WSS and status cannot substitute for authorization", async () => {
  saved({ apiKey, agentId, voiceId, toolsReady: true });
  for (const signed of [
    "https://api.elevenlabs.io/v1/convai/conversation",
    "wss://evil.test/v1/convai/conversation",
    "wss://api.elevenlabs.io.evil.test/v1/convai/conversation",
    "wss://user:pass@api.elevenlabs.io/v1/convai/conversation",
    "wss://api.elevenlabs.io/other",
  ]) {
    const mock = provider({ signed });
    await expect(
      voiceCompanion(root, { env: {}, home: root, fetch: mock.fetcher }).handle("/voice/session"),
    ).rejects.toThrow("invalid voice session");
  }
  saved({ apiKey, agentId, toolsReady: false });
  const mock = provider();
  await expect(
    voiceCompanion(root, { env: {}, home: root, fetch: mock.fetcher }).handle("/voice/session"),
  ).rejects.toThrow("Set up");
  expect(mock.calls).toHaveLength(0);
});

test("a provider-side agent change is rechecked before each conversation", async () => {
  saved({ apiKey, agentId, voiceId, toolsReady: true });
  const changed = privateAgent();
  changed.conversation_config.agent.prompt.tools.push({ type: "webhook", name: "publish" } as any);
  const mock = provider({ agent: changed });
  await expect(
    voiceCompanion(root, { env: {}, home: root, fetch: mock.fetcher }).handle("/voice/session"),
  ).rejects.toThrow("other actions");
  expect(mock.calls.some((call) => call.path.includes("get-signed-url"))).toBe(false);
});

test("configuration validation, response bounds and provider errors never leak secrets", async () => {
  let calls = 0;
  const companion = voiceCompanion(root, {
    env: {},
    home: root,
    fetch: (async () => {
      calls++;
      return Response.json({});
    }) as typeof fetch,
  });
  await expect(companion.handle("/voice/configure", { apiKey: "bad\r\nkey" })).rejects.toThrow(
    "valid ElevenLabs",
  );
  await expect(
    companion.handle("/voice/configure", { apiKey, agentId: "../../secret" }),
  ).rejects.toThrow("valid ElevenLabs");
  await expect(companion.handle("/voice/configure", [])).rejects.toThrow("valid voice");
  expect(calls).toBe(0);
  const oversized = voiceCompanion(root, {
    env: {},
    home: root,
    fetch: (async () => new Response("x".repeat(1024 * 1024 + 1))) as typeof fetch,
  });
  await expect(oversized.handle("/voice/configure", { apiKey, agentId })).rejects.toThrow(
    "unreadable response",
  );
  const rejected = voiceCompanion(root, {
    env: {},
    home: root,
    fetch: (async () => new Response(apiKey, { status: 401 })) as typeof fetch,
  });
  try {
    await rejected.handle("/voice/configure", { apiKey, agentId });
    throw new Error("Should reject");
  } catch (error) {
    expect(String(error)).not.toContain(apiKey);
    expect(String(error)).toContain("permissions");
  }
});

test("concurrent setup is rejected so duplicate agents cannot be created", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mock = provider();
  const companion = voiceCompanion(root, {
    env: {},
    home: root,
    fetch: (async (input: any, init: any) => {
      if (String(input).includes("/v2/voices")) await waiting;
      return mock.fetcher(input, init);
    }) as typeof fetch,
  });
  const first = companion.handle("/voice/configure", { apiKey });
  await expect(companion.handle("/voice/configure", { apiKey })).rejects.toThrow("Wait");
  await expect(companion.handle("/voice/session")).rejects.toThrow("Wait");
  release();
  await first;
  expect(mock.calls.filter((call) => call.path === "/v1/convai/agents/create")).toHaveLength(1);
});

test("setup template contains no local secrets or workspace data", () => {
  saved({ apiKey, agentId, toolsReady: true });
  const template = voiceCompanion(root, { env: {}, home: root }).setup();
  expect(template.tools.map((tool) => tool.name)).toEqual([
    "navigate",
    "search_memory",
    "ask_workspace",
  ]);
  expect(JSON.stringify(template)).not.toContain(apiKey);
  expect(JSON.stringify(template)).not.toContain(agentId);
});
