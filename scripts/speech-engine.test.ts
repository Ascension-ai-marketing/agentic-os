import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentGreeting, openAiReply, profileContext, startBrain, type Reply } from "./speech-engine";

let root: string;
const apiKey = "sk_unit_test_only_no_real_credentials";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentic-speech-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("streams model text chunks and maps agent turns to assistant", async () => {
  let sent: any;
  const sse = ['data: {"choices":[{"delta":{"content":"Good "}}]}', 'data: {"choices":[{"delta":{"content":"evening."}}]}', "data: [DONE]", ""].join("\n");
  const fetcher = async (_: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(sse, { status: 200 });
  };
  const reply = openAiReply({ apiKey, model: "fixture-model", system: "persona", fetcher });
  const out: string[] = [];
  for await (const text of reply([{ role: "agent", content: "Hello." }, { role: "user", content: "Hi" }], new AbortController().signal)) out.push(text);
  expect(out.join("")).toBe("Good evening.");
  expect(sent.messages.map((m: any) => m.role)).toEqual(["system", "assistant", "user"]);
  expect(sent.stream).toBe(true);
});

test("profile context keeps curated notes and leaves chat imports out", () => {
  const dir = join(root, ".operator-data/vault/personal");
  mkdirSync(dir, { recursive: true });
  const note = (id: string, provider: string, text: string) => {
    writeFileSync(join(dir, `${id}.md`), `---\ntitle: "${id}"\ncollection: "personal"\nsource_provider: "${provider}"\n---\n\n${text}\n`);
    return [id, { path: `personal/${id}.md`, hash: "h", signature: "s", trashed: false }];
  };
  const entries = Object.fromEntries([note("profile", "workspace-profile", "Sample project: a weekend reading list."), note("chat", "codex", "raw transcript")]);
  writeFileSync(join(root, ".operator-data/memory-vault.json"), JSON.stringify({ version: 1, entries, conflicts: {} }));
  const context = profileContext(root);
  expect(context).toContain("weekend reading list");
  expect(context).not.toContain("raw transcript");
});

test("a transcript over the brain socket comes back as streamed agent_response chunks", async () => {
  const reply: Reply = async function* (transcript) {
    yield "You said: ";
    yield transcript.at(-1)!.content;
  };
  const brain = await startBrain({ engineId: "seng_fixture", apiKey, reply, port: 0, disableAuth: true });
  const port = (brain.server.address() as AddressInfo).port;
  const received: any[] = [];
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const done = new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("socket error"));
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        received.push(message);
        if (message.is_final) resolve();
      };
    });
    await new Promise((open) => (ws.onopen = open));
    ws.send(JSON.stringify({ type: "init", conversation_id: "conv_fixture" }));
    ws.send(JSON.stringify({ type: "user_transcript", event_id: 7, user_transcript: [{ role: "user", content: "hello there" }] }));
    await done;
    ws.close();
  } finally {
    await brain.close();
  }
  const responses = received.filter((m) => m.type === "agent_response");
  expect(responses.map((m) => m.content).join("")).toBe("You said: hello there");
  expect(responses.every((m) => m.event_id === 7)).toBe(true);
  expect(responses.at(-1).is_final).toBe(true);
});

test("the brain answers /health and says nothing else about itself", async () => {
  const brain = await startBrain({ engineId: "seng_fixture", apiKey, reply: async function* () {}, port: 0, disableAuth: true });
  const base = `http://127.0.0.1:${(brain.server.address() as AddressInfo).port}`;
  try {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
  } finally {
    await brain.close();
  }
});

test("the greeting is the agent's current first message, and nothing when it cannot be read", async () => {
  const seen: { url: string; key: unknown }[] = [];
  const answer = (status: number, body: unknown) => async (url: string, init?: RequestInit) => {
    seen.push({ url, key: (init?.headers as Record<string, string>)["xi-api-key"] });
    return new Response(JSON.stringify(body), { status });
  };
  const agent = (first_message: unknown) => ({ conversation_config: { agent: { first_message } } });
  expect(await agentGreeting({ apiKey, agentId: "agent fixture/1", fetcher: answer(200, agent("[calm] Good morning.")) })).toBe("[calm] Good morning.");
  expect(seen).toEqual([{ url: "https://api.elevenlabs.io/v1/convai/agents/agent%20fixture%2F1", key: apiKey }]);
  expect(await agentGreeting({ apiKey, agentId: "a", fetcher: answer(200, agent("   ")) })).toBeUndefined();
  expect(await agentGreeting({ apiKey, agentId: "a", fetcher: answer(200, {}) })).toBeUndefined();
  expect(await agentGreeting({ apiKey, agentId: "a", fetcher: answer(401, agent("not this")) })).toBeUndefined();
  expect(await agentGreeting({ apiKey, agentId: "a", fetcher: async () => { throw new Error("offline"); } })).toBeUndefined();
});
