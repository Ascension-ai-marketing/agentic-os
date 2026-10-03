import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalGate, confirmQuestion, type ApprovalGate } from "./ceo-approval-gate";
import type { HermesCard } from "./ceo-hermes";
import { ceoKey, ceoStore } from "./ceo-store";
import { brainTools } from "./ceo-tools";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const BASE = "http://127.0.0.1:8081";
const TASK = "List three competitors and their prices.";
const queuedJob = (agent: string, status = "queued") => Response.json({ job: { id: "job-1", runs: [{ agent, status }] } }, { status: 202 });

/** The voice's tools over temporary records, a made-up Hermes board and a made-up local OS. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ceo-tools-"));
  roots.push(root);
  const store = ceoStore(root);
  const gates = new Map<string, ApprovalGate>();
  const gate = (id: string) => gates.get(id) ?? gates.set(id, approvalGate()).get(id)!;
  const world = {
    dashboardDown: false,
    hermes: async (input: { title: string }): Promise<HermesCard> => ({ id: `t_${world.cards.length}`, title: input.title, status: "queued" }),
    os: (_path: string, _body?: any): Response => Response.json({ result: { jobs: [] } }),
    cards: [] as { title: string; task: string; key: string }[],
    refreshes: [] as boolean[],
    seen: [] as { path: string; method: string; body?: any; headers: Record<string, string> }[],
  };
  const board = { dispatch: async (input: { title: string; task: string; key: string }) => { world.cards.push({ title: input.title, task: input.task, key: input.key }); return world.hermes(input); } };
  const sync = { refresh: async (_signal?: AbortSignal, force = false) => { world.refreshes.push(force); } };
  const request = async (url: string, init?: RequestInit) => {
    if (world.dashboardDown) throw new TypeError("fetch failed");
    const path = url.replace(BASE, ""), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    world.seen.push({ path, method: init?.method ?? "GET", body, headers: (init?.headers ?? {}) as Record<string, string> });
    return path === "/__token" ? Response.json({ token: "fixture-token-0123456789" }) : world.os(path, body);
  };
  const made = brainTools({ baseUrl: BASE, request, ceo: { store, board, sync, gate } });
  const call = (name: string, input: unknown, conversationId = "conv-1") =>
    made.runTool(name, input, new AbortController().signal, { conversationId, transcript: [{ role: "user", content: "Sample request." }] });
  return { ...made, store, gate, world, call };
}

test("with the CEO records the voice can hand out work and propose, and still cannot approve, answer, cancel or send", () => {
  const { tools } = fixture();
  expect(tools.map((t) => t.name)).toEqual(["os_lookup", "search_memory", "task_status", "dispatch_agent", "propose_external_action", "list_pending"]);
  for (const t of tools) {
    expect(t.name).not.toMatch(/approv|resolv|respond|confirm|cancel|send|publish|shell|bash|exec|write|delete/i);
    expect(t.eager_input_streaming).toBe(true);
    expect((t.input_schema as any).additionalProperties).toBe(false);
  }
});

test("work for Hermes goes onto its board once per conversation, however the request is worded again", async () => {
  const { call, store, world } = fixture();
  expect(await call("dispatch_agent", { agent: "hermes", title: "Competitor pricing", task: TASK })).toBe(`Handed to Hermes as "Competitor pricing". It works in the background; task_status reports on it.`);
  expect(world.cards).toEqual([{ title: "Competitor pricing", task: TASK, key: ceoKey("conv-1", "hermes", TASK) }]);
  expect(store.tasks()).toMatchObject([{ agent: "hermes", title: "Competitor pricing", task: TASK, ref: "t_1", status: "queued", conversationId: "conv-1" }]);

  expect(await call("Dispatch_Agent", { agent: "hermes", task: "list three competitors,  and their prices" })).toContain(`Already handed to Hermes as "Competitor pricing" (queued, just now). Nothing new was started.`);
  expect(world.cards).toHaveLength(1);
  // Another conversation asking for the same thing is new work; with no title, the first words name it.
  expect(await call("dispatch_agent", { agent: "hermes", task: TASK }, "conv-2")).toContain(`Handed to Hermes as "List three competitors and their prices."`);
  expect(world.cards).toHaveLength(2);
  expect(store.tasks()).toHaveLength(2);
  expect(world.seen).toEqual([]);
});

test("work for Claude Code and Codex becomes an OS agent job that keeps its own permission prompts", async () => {
  const { call, store, world } = fixture();
  world.os = () => queuedJob("claude");
  expect(await call("dispatch_agent", { agent: "claude_code", title: "Fix the sample script", task: "Fix the failing test in the sample script." }))
    .toBe(`Handed to Claude Code as "Fix the sample script". It works in the OS, and if it needs a permission it waits on screen for the person. task_status reports on it.`);
  expect(world.seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /__token", "POST /__operator/agent-jobs"]);
  const sent = world.seen[1];
  expect(Object.keys(sent.body).sort()).toEqual(["autonomous", "model", "prompt", "requestId", "targets"]);
  expect(sent.body).toMatchObject({ requestId: `ceo-${ceoKey("conv-1", "claude_code", "Fix the failing test in the sample script.")}`, targets: ["claude"], autonomous: true, model: "claude-opus-5-5" });
  expect(sent.body.requestId).toMatch(/^[a-zA-Z0-9-]{16,80}$/);
  expect(sent.body.prompt).toStartWith("You were started by Jarvis");
  expect(sent.body.prompt).toContain("Never send, post, publish, book, buy or message anyone.");
  expect(sent.body.prompt).toEndWith("The task:\nFix the failing test in the sample script.");
  expect(sent.headers).toMatchObject({ "x-claude-os-token": "fixture-token-0123456789", "Content-Type": "application/json", Origin: BASE });
  expect(store.tasks()).toMatchObject([{ agent: "claude_code", ref: "job-1", status: "queued" }]);

  world.os = () => queuedJob("codex", "failed");
  expect(await call("dispatch_agent", { agent: "codex", title: "Tidy the sample folder", task: "Tidy the sample folder and list what moved." }))
    .toBe(`Handed to Codex as "Tidy the sample folder", but it stopped straight away. task_status says why.`);
  expect(world.seen.at(-1)!.body.targets).toEqual(["codex"]);
  expect(world.seen.at(-1)!.body.model).toBeUndefined();
  expect(store.tasks().at(-1)).toMatchObject({ agent: "codex", status: "failed" });
});

test("work that cannot be handed out says why and records nothing", async () => {
  const { call, store, world } = fixture();
  await expect(call("dispatch_agent", { agent: "openclaw", task: TASK })).rejects.toThrow("OpenClaw is not installed on this computer yet");
  await expect(call("dispatch_agent", { agent: "email", task: TASK })).rejects.toThrow("agent must be one of: hermes, claude_code, codex, openclaw.");
  await expect(call("dispatch_agent", { agent: "hermes", task: "Do it" })).rejects.toThrow("needs a task that says what to do");
  await expect(call("dispatch_agent", "not an object")).rejects.toThrow("agent must be one of");
  expect(world.cards).toHaveLength(0);

  world.hermes = async () => { throw new Error(`Hermes has no "ceo-worker" profile yet, so nothing can be handed to it until that is set up.`); };
  await expect(call("dispatch_agent", { agent: "hermes", task: TASK })).rejects.toThrow("nothing can be handed to it until that is set up");
  world.os = () => Response.json({ error: "Four agents are already working. Stop one or wait for it to finish." }, { status: 400 });
  await expect(call("dispatch_agent", { agent: "codex", task: TASK })).rejects.toThrow("Four agents are already working. Stop one or wait for it to finish.");
  world.os = () => Response.json({ job: {} }, { status: 202 });
  await expect(call("dispatch_agent", { agent: "codex", task: TASK })).rejects.toThrow("The OS could not start that task.");
  world.dashboardDown = true;
  await expect(call("dispatch_agent", { agent: "claude_code", task: TASK })).rejects.toThrow("dashboard is not running");
  expect(store.tasks()).toEqual([]);
});

test("an outside action is filed for the person and read back by code, one at a time, and nothing is carried out", async () => {
  const { call, store, gate, world } = fixture();
  const action = "Email Dana Lee the March invoice";
  const filed = await call("propose_external_action", { action, detail: "Hello Dana, the March invoice is attached." });
  expect(filed).toStartWith("Filed for the person's approval. Nothing has been done.");
  expect(filed).toContain(`"${confirmQuestion(action)}"`);
  expect(store.approvals()).toMatchObject([{ action, detail: "Hello Dana, the March invoice is attached.", status: "pending", conversationId: "conv-1" }]);
  expect(gate("conv-1").unasked()).toBe(confirmQuestion(action));

  const held = await call("propose_external_action", { action: "Publish the March update" });
  expect(held).toContain("it will not be asked aloud now");
  expect(held).toContain(`"${action}" is being asked in this reply`);
  expect(store.approvals().map((item) => item.status)).toEqual(["pending", "pending"]);
  expect(gate("conv-1").unasked()).toBe(confirmQuestion(action));
  // Another conversation has its own question.
  expect(gate("conv-2").unasked()).toBeUndefined();

  await expect(call("propose_external_action", { action: "Send" })).rejects.toThrow("needs the action as one full sentence");
  await expect(call("propose_external_action", {})).rejects.toThrow("needs the action as one full sentence");
  expect(store.approvals()).toHaveLength(2);
  expect(world.seen).toEqual([]);
  expect(world.cards).toEqual([]);
});

test("list_pending tells what is waiting and what the person decided, and that nothing sends it yet", async () => {
  const { call, store } = fixture();
  await call("propose_external_action", { action: "Email Dana Lee the March invoice", detail: "Hello Dana." });
  const decided = store.propose({ action: "Publish the March update" });
  store.resolve(decided.id, "declined", "button");
  const voiced = store.propose({ action: "Book the sample venue for Friday" });
  store.resolve(voiced.id, "approved", "voice");
  expect(JSON.parse(await call("list_pending", {}))).toEqual({
    waiting_for_the_persons_yes: [{ action: "Email Dana Lee the March invoice", asked: "just now", detail: "Hello Dana." }],
    decided_lately: [
      { action: "Book the sample venue for Friday", decision: "approved", by: "the person's spoken answer", when: "just now" },
      { action: "Publish the March update", decision: "declined", by: "the button in the OS", when: "just now" },
    ],
    note: "An approved action is recorded and waits in the OS. Nothing sends it yet.",
  });
});

test("task_status brings the records up to date first, and still answers with the dashboard stopped", async () => {
  const { call, store, world } = fixture();
  const { task } = store.addTask({ key: "key-1", agent: "hermes", title: "Competitor pricing", task: TASK, ref: "t_1" });
  store.updateTask(task.id, { status: "done", note: "Three competitors found." });
  world.os = () => Response.json({ result: { jobs: [{ title: "Started by hand", status: "running" }] } });
  const told = await call("task_status", {});
  expect(world.refreshes).toEqual([true]);
  expect(told).toContain(`Work you handed out, newest first:\n[{"agent":"Hermes","title":"Competitor pricing","status":"done","updated":"just now","agent_said":"Three competitors found."}]`);
  expect(told).toContain(`The OS's own agent tasks:\n{"jobs":[{"title":"Started by hand","status":"running"}]}`);
  expect(world.seen.at(-1)).toMatchObject({ path: "/__voice/tool", body: { name: "agent_jobs", args: {} } });

  world.dashboardDown = true;
  const offline = await call("task_status", {});
  expect(offline).toContain("Competitor pricing");
  expect(offline).toContain("The Agentic OS dashboard is not running");
});

test("every tool together only ever reaches the token, lookup and new-agent-job routes", async () => {
  const { call, world } = fixture();
  world.os = (path) => (path === "/__operator/agent-jobs" ? queuedJob("claude") : Response.json({ result: { ok: true } }));
  await call("os_lookup", { name: "inbox" });
  await call("search_memory", { query: "pricing notes" });
  await call("task_status", {});
  await call("dispatch_agent", { agent: "hermes", task: TASK });
  await call("dispatch_agent", { agent: "claude_code", task: TASK });
  await call("propose_external_action", { action: "Email Dana Lee the March invoice" });
  await call("list_pending", {});
  await expect(call("approve_action", { id: "anything" })).rejects.toThrow("no tool called approve_action");
  expect([...new Set(world.seen.map((s) => `${s.method} ${s.path}`))].sort()).toEqual(["GET /__token", "POST /__operator/agent-jobs", "POST /__voice/tool"]);
  for (const s of world.seen) expect(s.path).not.toMatch(/respond|resolve|cancel|continue|outbox|ceo/);
});

test("the next reply can wait for work still being handed out, and a turn answered twice makes one record", async () => {
  const { call, settled, store, world } = fixture();
  const landing: ((card: HermesCard) => void)[] = [];
  world.hermes = () => new Promise<HermesCard>((done) => { landing.push(done); });
  const first = call("dispatch_agent", { agent: "hermes", title: "Competitor pricing", task: TASK });
  const second = call("dispatch_agent", { agent: "hermes", title: "Competitor pricing", task: TASK });
  let waited = false;
  const waiting = settled("conv-1").then(() => { waited = true; });
  await settled("conv-2");
  await new Promise((tick) => setTimeout(tick, 5));
  expect(waited).toBe(false);
  expect(store.tasks()).toEqual([]);

  // Hermes answers both askings with the one card its idempotency key stands for.
  expect(world.cards.map((card) => card.key)).toEqual([ceoKey("conv-1", "hermes", TASK), ceoKey("conv-1", "hermes", TASK)]);
  for (const land of landing) land({ id: "t_same", title: "Competitor pricing", status: "queued" });
  await Promise.all([first, second, waiting]);
  expect(waited).toBe(true);
  expect(store.tasks()).toHaveLength(1);
});
